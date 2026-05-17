from __future__ import annotations

import hashlib
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

from .image_io import RasterPage, rasterize_upload, rasterize_upload_page


MAX_CACHE_ITEMS = 16
MAX_CACHE_BYTES = 512 * 1024 * 1024


@dataclass(frozen=True)
class CachedRaster:
    fmt: str
    pages: list[RasterPage]
    size_bytes: int


_cache: OrderedDict[str, CachedRaster] = OrderedDict()
_cache_bytes = 0
_lock = Lock()


def rasterize_upload_cached(filename: str, content: bytes, dpi: int = 180) -> tuple[str, list[RasterPage]]:
    key = _cache_key(filename, content, dpi)
    with _lock:
        cached = _cache.get(key)
        if cached:
            _cache.move_to_end(key)
            return cached.fmt, cached.pages

    fmt, pages = rasterize_upload(filename, content, dpi=dpi)
    size_bytes = _estimate_pages_bytes(pages)
    if size_bytes > MAX_CACHE_BYTES:
        return fmt, pages

    with _lock:
        global _cache_bytes
        replaced = _cache.pop(key, None)
        if replaced:
            _cache_bytes -= replaced.size_bytes
        _cache[key] = CachedRaster(fmt=fmt, pages=pages, size_bytes=size_bytes)
        _cache_bytes += size_bytes
        _cache.move_to_end(key)
        _evict_if_needed()
    return fmt, pages


def rasterize_upload_page_cached(filename: str, content: bytes, page: int = 0, dpi: int = 180) -> tuple[str, RasterPage]:
    key = _cache_key(filename, content, dpi, page=page)
    with _lock:
        cached = _cache.get(key)
        if cached:
            _cache.move_to_end(key)
            return cached.fmt, cached.pages[0]

    fmt, raster_page = rasterize_upload_page(filename, content, page=page, dpi=dpi)
    size_bytes = _estimate_pages_bytes([raster_page])
    if size_bytes > MAX_CACHE_BYTES:
        return fmt, raster_page

    with _lock:
        global _cache_bytes
        replaced = _cache.pop(key, None)
        if replaced:
            _cache_bytes -= replaced.size_bytes
        _cache[key] = CachedRaster(fmt=fmt, pages=[raster_page], size_bytes=size_bytes)
        _cache_bytes += size_bytes
        _cache.move_to_end(key)
        _evict_if_needed()
    return fmt, raster_page


def _cache_key(filename: str, content: bytes, dpi: int, page: int | None = None) -> str:
    suffix = Path(filename or "upload").suffix.lower()
    digest = hashlib.sha256(content).hexdigest()
    page_part = "all" if page is None else f"page-{page}"
    return f"{suffix}:{dpi}:{page_part}:{digest}"


def _estimate_pages_bytes(pages: list[RasterPage]) -> int:
    total = 0
    for page in pages:
        bands = len(page.image.getbands())
        total += page.image.width * page.image.height * bands
    return total


def _evict_if_needed() -> None:
    global _cache_bytes
    while len(_cache) > MAX_CACHE_ITEMS or _cache_bytes > MAX_CACHE_BYTES:
        _, removed = _cache.popitem(last=False)
        _cache_bytes -= removed.size_bytes
