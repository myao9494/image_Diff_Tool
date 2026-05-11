from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


CATEGORY_PARAMS = {
    "汎用": {"features": 5000, "ratio": 0.78, "min_matches": 12},
    "図面": {"features": 8000, "ratio": 0.82, "min_matches": 14},
    "グラフ": {"features": 6000, "ratio": 0.80, "min_matches": 12},
    "書類": {"features": 7000, "ratio": 0.78, "min_matches": 10},
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

    detector = cv2.ORB_create(nfeatures=params["features"], fastThreshold=7)
    kp_a, des_a = detector.detectAndCompute(fixed, None)
    kp_b, des_b = detector.detectAndCompute(moving, None)
    if des_a is None or des_b is None or len(kp_a) < 4 or len(kp_b) < 4:
        return _failed(candidate_bgr, "Not enough keypoints for alignment")

    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    knn = matcher.knnMatch(des_b, des_a, k=2)
    good = []
    for pair in knn:
        if len(pair) < 2:
            continue
        first, second = pair
        if first.distance < params["ratio"] * second.distance:
            good.append(first)

    if len(good) < params["min_matches"]:
        return _failed(candidate_bgr, f"Not enough stable matches ({len(good)})")

    src = np.float32([kp_b[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kp_a[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    matrix, mask = cv2.findHomography(src, dst, cv2.RANSAC, 4.0)
    if matrix is None or mask is None:
        return _failed(candidate_bgr, "Homography estimation failed", matches=len(good))

    inliers = int(mask.ravel().sum())
    if inliers < max(6, params["min_matches"] // 2):
        return _failed(candidate_bgr, f"Homography was unstable ({inliers} inliers)", matches=len(good), inliers=inliers)
    warning = _validate_homography(matrix, reference_bgr.shape[:2], candidate_bgr.shape[:2])
    if warning:
        return _failed(candidate_bgr, warning, matches=len(good), inliers=inliers)

    h, w = reference_bgr.shape[:2]
    aligned = cv2.warpPerspective(candidate_bgr, matrix, (w, h), flags=cv2.INTER_LINEAR, borderValue=(255, 255, 255))
    return AlignmentResult(
        image=aligned,
        success=True,
        method="ORB + RANSAC homography",
        warning=None,
        matches=len(good),
        inliers=inliers,
        matrix=matrix.tolist(),
    )


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
    if area < ref_area * 0.35 or area > ref_area * 2.5:
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
