# Visual Diff Tool Backend

```bash
../.venv/bin/python run.py
```

API:

- `GET /api/health`
- `POST /api/attachments`
- `POST /api/analyze`
- `POST /api/convert`
- `POST /api/diff`
- `POST /api/rediff`
- `POST /api/git/images`
- `POST /api/git/diff`

The backend also serves the built web app from `../frontend/dist` at `/`.

`/api/diff` performs conversion, alignment, and initial diff generation. It returns a `result_id` that points to short-lived aligned images in memory. `/api/rediff` accepts that `result_id` plus a new threshold and regenerates only the overlay/mask/rect metrics. If the in-memory entry has expired, callers can fall back by sending `image_a` and `image_b_aligned` directly; successful fallback responses include a refreshed `result_id`.

`/api/analyze` returns page metadata and conversion warnings without rasterizing every page of PDF/TIFF files. `/api/convert` and `/api/diff` rasterize only the requested page. Excalidraw support is implemented by the built-in Python renderer; unsupported or approximated Excalidraw features are surfaced through `warnings` and `conversion_warnings`.

`/api/git/images` lists changed image files under a repository folder. `/api/git/diff` compares the working-tree image to the HEAD-side image and accepts `head_path` for staged renames/copies.

Runtime caches:

- `raster_cache.py`: content-hash cache for rasterized uploads keyed by extension, DPI, and page.
- `result_cache.py`: bounded cache for aligned image pairs used by rediff.

Input limits:

- Upload size: 100 MB per file.
- PDF/TIFF page count: 60 pages.
- Rasterized page size: 90 megapixels per page.
- Full-document rasterization guard: 180 megapixels total.
