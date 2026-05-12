from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


CATEGORY_PARAMS = {
    "汎用": {"features": 7000, "ratio": 0.74, "min_matches": 12, "ransac": 3.0},
    "図面": {"features": 10000, "ratio": 0.78, "min_matches": 14, "ransac": 2.5},
    "グラフ": {"features": 8000, "ratio": 0.76, "min_matches": 12, "ransac": 3.0},
    "書類": {"features": 9000, "ratio": 0.74, "min_matches": 10, "ransac": 2.5},
}


@dataclass
class AlignmentResult:
    image: np.ndarray
    success: bool
    method: str
    warning: str | None
    matches: int
    inliers: int
    matrix: list[list[float]] | None


def align_to_reference(reference_bgr: np.ndarray, candidate_bgr: np.ndarray, category: str = "汎用") -> AlignmentResult:
    params = CATEGORY_PARAMS.get(category, CATEGORY_PARAMS["汎用"])
    fixed = _prepare_gray(reference_bgr, category)
    moving = _prepare_gray(candidate_bgr, category)

    attempts = []
    for detector_name, detector, norm, ratio_scale in _detector_candidates(params["features"]):
        kp_a, des_a = detector.detectAndCompute(fixed, None)
        kp_b, des_b = detector.detectAndCompute(moving, None)
        if des_a is None or des_b is None or len(kp_a) < 4 or len(kp_b) < 4:
            continue

        good = _match_descriptors(des_b, des_a, norm, params["ratio"] * ratio_scale)
        if len(good) < params["min_matches"]:
            continue

        detector_attempts = []
        src = np.float32([kp_b[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
        dst = np.float32([kp_a[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
        for transform_name, matrix, mask in _estimate_transforms(src, dst, params["ransac"]):
            if matrix is None or mask is None:
                continue

            inliers = int(mask.ravel().sum())
            if inliers < max(6, params["min_matches"] // 2):
                continue
            warning = _validate_homography(matrix, reference_bgr.shape[:2], candidate_bgr.shape[:2])
            if warning:
                continue
            attempt = (inliers, len(good), f"{detector_name} {transform_name}", matrix)
            attempts.append(attempt)
            detector_attempts.append(attempt)

        if _has_confident_detector_result(detector_attempts, params["min_matches"]):
            break

    if not attempts:
        return _failed(candidate_bgr, "Could not estimate a stable feature transform")

    inliers, matches, transform_label, matrix = max(attempts, key=lambda item: (item[0], item[1]))
    matrix, refined = _refine_with_ecc(fixed, moving, matrix, reference_bgr.shape[:2])

    h, w = reference_bgr.shape[:2]
    aligned = cv2.warpPerspective(candidate_bgr, matrix, (w, h), flags=cv2.INTER_LINEAR, borderValue=(255, 255, 255))
    return AlignmentResult(
        image=aligned,
        success=True,
        method=f"{transform_label} + robust transform" + (" + ECC refine" if refined else ""),
        warning=None,
        matches=matches,
        inliers=inliers,
        matrix=matrix.tolist(),
    )


def _detector_candidates(features: int):
    if hasattr(cv2, "SIFT_create"):
        yield "SIFT", cv2.SIFT_create(nfeatures=features, contrastThreshold=0.025, edgeThreshold=12), cv2.NORM_L2, 1.0
    yield "AKAZE", cv2.AKAZE_create(threshold=0.0006), cv2.NORM_HAMMING, 1.05
    yield "ORB", cv2.ORB_create(nfeatures=features, fastThreshold=5, scoreType=cv2.ORB_HARRIS_SCORE), cv2.NORM_HAMMING, 1.08


def _has_confident_detector_result(attempts: list[tuple[int, int, str, np.ndarray]], min_matches: int) -> bool:
    if not attempts:
        return False
    inliers, matches, _, _ = max(attempts, key=lambda item: (item[0], item[1]))
    return inliers >= max(80, min_matches * 6) and inliers / max(1, matches) >= 0.75


def _match_descriptors(des_moving: np.ndarray, des_fixed: np.ndarray, norm: int, ratio: float):
    matcher = cv2.BFMatcher(norm)
    knn = matcher.knnMatch(des_moving, des_fixed, k=2)
    good = []
    for pair in knn:
        if len(pair) < 2:
            continue
        first, second = pair
        if first.distance < ratio * second.distance:
            good.append(first)
    return good


def _estimate_transforms(src: np.ndarray, dst: np.ndarray, ransac_threshold: float):
    method = getattr(cv2, "USAC_MAGSAC", cv2.RANSAC)
    try:
        matrix, mask = cv2.findHomography(src, dst, method, ransac_threshold, maxIters=4000, confidence=0.999)
    except cv2.error:
        try:
            matrix, mask = cv2.findHomography(src, dst, cv2.RANSAC, ransac_threshold)
        except cv2.error:
            matrix, mask = None, None
    yield "homography", matrix, mask

    try:
        affine, affine_mask = cv2.estimateAffinePartial2D(
            src,
            dst,
            method=cv2.RANSAC,
            ransacReprojThreshold=ransac_threshold,
            maxIters=4000,
            confidence=0.995,
            refineIters=20,
        )
    except cv2.error:
        affine, affine_mask = None, None
    if affine is not None:
        matrix = np.vstack([affine, [0.0, 0.0, 1.0]]).astype(np.float64)
        yield "similarity", matrix, affine_mask


def _refine_with_ecc(fixed: np.ndarray, moving: np.ndarray, matrix: np.ndarray, reference_shape: tuple[int, int]):
    ref_h, ref_w = reference_shape
    scale = min(1.0, 1200.0 / max(ref_h, ref_w))
    fixed_small = _resize_for_registration(fixed, scale)
    moving_small = _resize_for_registration(moving, scale)
    scale_matrix = np.array([[scale, 0, 0], [0, scale, 0], [0, 0, 1]], dtype=np.float32)
    try:
        inverse_matrix = np.linalg.inv(matrix)
    except np.linalg.LinAlgError:
        return matrix, False
    warp = (scale_matrix @ inverse_matrix @ np.linalg.inv(scale_matrix)).astype(np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 80, 1e-5)
    try:
        _, refined = cv2.findTransformECC(
            fixed_small,
            moving_small,
            warp,
            cv2.MOTION_HOMOGRAPHY,
            criteria,
            inputMask=None,
            gaussFiltSize=3,
        )
    except cv2.error:
        return matrix, False

    try:
        refined_full = np.linalg.inv(np.linalg.inv(scale_matrix) @ refined @ scale_matrix)
    except np.linalg.LinAlgError:
        return matrix, False
    warning = _validate_homography(refined_full, reference_shape, moving.shape[:2])
    if warning:
        return matrix, False
    return refined_full.astype(np.float64), True


def _resize_for_registration(image: np.ndarray, scale: float) -> np.ndarray:
    if scale >= 1.0:
        return image
    h, w = image.shape[:2]
    resized = cv2.resize(image, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
    return resized


def _prepare_gray(image: np.ndarray, category: str) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    if category in {"図面", "書類"}:
        gray = cv2.equalizeHist(gray)
        gray = cv2.GaussianBlur(gray, (3, 3), 0)
    elif category == "グラフ":
        gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    return gray


def _failed(image: np.ndarray, warning: str, matches: int = 0, inliers: int = 0) -> AlignmentResult:
    return AlignmentResult(
        image=image,
        success=False,
        method="none",
        warning=warning,
        matches=matches,
        inliers=inliers,
        matrix=None,
    )


def _validate_homography(matrix: np.ndarray, reference_shape: tuple[int, int], candidate_shape: tuple[int, int]) -> str | None:
    ref_h, ref_w = reference_shape
    mov_h, mov_w = candidate_shape
    corners = np.float32([[0, 0], [mov_w, 0], [mov_w, mov_h], [0, mov_h]]).reshape(-1, 1, 2)
    projected = cv2.perspectiveTransform(corners, matrix).reshape(-1, 2)
    if not np.isfinite(projected).all():
        return "Estimated transform contains invalid coordinates"

    area = abs(cv2.contourArea(projected.astype(np.float32)))
    ref_area = float(ref_w * ref_h)
    if area < ref_area * 0.03 or area > ref_area * 8.0:
        return "Estimated transform changes image area too much"

    x_min, y_min = projected.min(axis=0)
    x_max, y_max = projected.max(axis=0)
    margin_x = ref_w * 0.75
    margin_y = ref_h * 0.75
    if x_max < -margin_x or y_max < -margin_y or x_min > ref_w + margin_x or y_min > ref_h + margin_y:
        return "Estimated transform moves image outside the reference canvas"

    top = np.linalg.norm(projected[1] - projected[0])
    bottom = np.linalg.norm(projected[2] - projected[3])
    left = np.linalg.norm(projected[3] - projected[0])
    right = np.linalg.norm(projected[2] - projected[1])
    width_ratio = max(top, bottom) / max(1.0, min(top, bottom))
    height_ratio = max(left, right) / max(1.0, min(left, right))
    if width_ratio > 2.2 or height_ratio > 2.2:
        return "Estimated transform perspective skew is too strong"

    return None
