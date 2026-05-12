from __future__ import annotations

import cv2
import numpy as np


def resize_to_match(reference_bgr: np.ndarray, candidate_bgr: np.ndarray) -> np.ndarray:
    h, w = reference_bgr.shape[:2]
    if candidate_bgr.shape[:2] == (h, w):
        return candidate_bgr
    canvas = np.full((h, w, 3), 255, dtype=candidate_bgr.dtype)
    src_h, src_w = candidate_bgr.shape[:2]
    copy_h = min(h, src_h)
    copy_w = min(w, src_w)
    canvas[:copy_h, :copy_w] = candidate_bgr[:copy_h, :copy_w]
    return canvas


def build_visual_diff(reference_bgr: np.ndarray, aligned_bgr: np.ndarray, threshold: float = 0.1) -> dict:
    aligned_bgr = resize_to_match(reference_bgr, aligned_bgr)
    threshold = float(np.clip(threshold, 0.0, 1.0))
    delta = _yiq_delta(reference_bgr, aligned_bgr)
    max_delta = 35215.0 * threshold * threshold
    mask = np.where(delta > max_delta, 255, 0).astype(np.uint8)
    mask = _remove_small_components(mask, min_pixels=3)
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.dilate(mask, kernel, iterations=1)

    gray_a = cv2.cvtColor(reference_bgr, cv2.COLOR_BGR2GRAY)
    gray_b = cv2.cvtColor(aligned_bgr, cv2.COLOR_BGR2GRAY)
    ink_a = cv2.inRange(gray_a, 0, 245)
    ink_b = cv2.inRange(gray_b, 0, 245)
    removed = cv2.bitwise_and(mask, cv2.bitwise_and(ink_a, cv2.bitwise_not(ink_b)))
    added = cv2.bitwise_and(mask, cv2.bitwise_and(ink_b, cv2.bitwise_not(ink_a)))
    changed = cv2.bitwise_and(mask, cv2.bitwise_and(ink_a, ink_b))

    overlay = reference_bgr.copy()
    red = np.full_like(overlay, (40, 40, 230))
    blue = np.full_like(overlay, (230, 110, 40))
    amber = np.full_like(overlay, (40, 190, 255))
    overlay = np.where(removed[:, :, None] > 0, cv2.addWeighted(overlay, 0.35, red, 0.65, 0), overlay)
    overlay = np.where(added[:, :, None] > 0, cv2.addWeighted(overlay, 0.35, blue, 0.65, 0), overlay)
    overlay = np.where(changed[:, :, None] > 0, cv2.addWeighted(overlay, 0.35, amber, 0.65, 0), overlay)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    rects = []
    for contour in contours:
        area = int(cv2.contourArea(contour))
        if area < 20:
            continue
        x, y, w, h = cv2.boundingRect(contour)
        rects.append({"x": int(x), "y": int(y), "width": int(w), "height": int(h), "area": area})
        cv2.rectangle(overlay, (x, y), (x + w, y + h), (0, 80, 255), 2)

    diff_pixels = int(np.count_nonzero(mask))
    total = int(mask.shape[0] * mask.shape[1])
    return {
        "overlay": overlay,
        "mask": mask,
        "rects": sorted(rects, key=lambda item: item["area"], reverse=True),
        "diff_pixels": diff_pixels,
        "diff_ratio": diff_pixels / total if total else 0.0,
        "threshold": threshold,
    }


def _remove_small_components(mask: np.ndarray, min_pixels: int) -> np.ndarray:
    component_count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if component_count <= 1:
        return mask
    filtered = np.zeros_like(mask)
    for label in range(1, component_count):
        if stats[label, cv2.CC_STAT_AREA] >= min_pixels:
            filtered[labels == label] = 255
    return filtered


def _yiq_delta(image_a_bgr: np.ndarray, image_b_bgr: np.ndarray) -> np.ndarray:
    a = image_a_bgr.astype(np.float32)
    b = image_b_bgr.astype(np.float32)
    b1, g1, r1 = cv2.split(a)
    b2, g2, r2 = cv2.split(b)

    y = (r1 - r2) * 0.29889531 + (g1 - g2) * 0.58662247 + (b1 - b2) * 0.11448223
    i = (r1 - r2) * 0.59597799 - (g1 - g2) * 0.27417610 - (b1 - b2) * 0.32180189
    q = (r1 - r2) * 0.21147017 - (g1 - g2) * 0.52261711 + (b1 - b2) * 0.31114694
    return 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q
