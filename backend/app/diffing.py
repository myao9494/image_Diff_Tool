from __future__ import annotations

import cv2
import numpy as np


def resize_to_match(reference_bgr: np.ndarray, candidate_bgr: np.ndarray) -> np.ndarray:
    h, w = reference_bgr.shape[:2]
    if candidate_bgr.shape[:2] == (h, w):
        return candidate_bgr
    return cv2.resize(candidate_bgr, (w, h), interpolation=cv2.INTER_AREA)


def build_visual_diff(reference_bgr: np.ndarray, aligned_bgr: np.ndarray, threshold: int = 24) -> dict:
    aligned_bgr = resize_to_match(reference_bgr, aligned_bgr)
    gray_a = cv2.cvtColor(reference_bgr, cv2.COLOR_BGR2GRAY)
    gray_b = cv2.cvtColor(aligned_bgr, cv2.COLOR_BGR2GRAY)
    delta = cv2.absdiff(gray_a, gray_b)
    _, mask = cv2.threshold(delta, threshold, 255, cv2.THRESH_BINARY)
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.dilate(mask, kernel, iterations=1)

    removed = cv2.bitwise_and(mask, cv2.inRange(gray_a, 0, 245))
    added = cv2.bitwise_and(mask, cv2.inRange(gray_b, 0, 245))

    overlay = reference_bgr.copy()
    red = np.full_like(overlay, (40, 40, 230))
    blue = np.full_like(overlay, (230, 110, 40))
    overlay = np.where(removed[:, :, None] > 0, cv2.addWeighted(overlay, 0.35, red, 0.65, 0), overlay)
    overlay = np.where(added[:, :, None] > 0, cv2.addWeighted(overlay, 0.35, blue, 0.65, 0), overlay)

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
    }
