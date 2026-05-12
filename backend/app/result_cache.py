from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from threading import Lock
from uuid import uuid4

import numpy as np


MAX_CACHE_ITEMS = 32
MAX_CACHE_BYTES = 512 * 1024 * 1024


@dataclass(frozen=True)
class DiffImages:
    image_a: np.ndarray
    image_b_aligned: np.ndarray
    size_bytes: int


_cache: OrderedDict[str, DiffImages] = OrderedDict()
_cache_bytes = 0
_lock = Lock()


def store_diff_images(image_a: np.ndarray, image_b_aligned: np.ndarray) -> str:
    result_id = uuid4().hex
    size_bytes = int(image_a.nbytes + image_b_aligned.nbytes)
    if size_bytes > MAX_CACHE_BYTES:
        return result_id

    with _lock:
        global _cache_bytes
        _cache[result_id] = DiffImages(image_a=image_a, image_b_aligned=image_b_aligned, size_bytes=size_bytes)
        _cache_bytes += size_bytes
        _cache.move_to_end(result_id)
        _evict_if_needed()
    return result_id


def get_diff_images(result_id: str) -> DiffImages | None:
    with _lock:
        cached = _cache.get(result_id)
        if cached:
            _cache.move_to_end(result_id)
        return cached


def _evict_if_needed() -> None:
    global _cache_bytes
    while len(_cache) > MAX_CACHE_ITEMS or _cache_bytes > MAX_CACHE_BYTES:
        _, removed = _cache.popitem(last=False)
        _cache_bytes -= removed.size_bytes
