# Visual Diff Tool Backend

```bash
../.venv/bin/python run.py
```

API:

- `GET /api/health`
- `POST /api/analyze`
- `POST /api/convert`
- `POST /api/diff`
- `POST /api/rediff`

The backend also serves the built web app from `../frontend/dist` at `/`.

`/api/diff` performs conversion, alignment, and initial diff generation. It returns a `result_id` that points to short-lived aligned images in memory. `/api/rediff` accepts that `result_id` plus a new threshold and regenerates only the overlay/mask/rect metrics. If the in-memory entry has expired, callers can fall back by sending `image_a` and `image_b_aligned` directly; successful fallback responses include a refreshed `result_id`.

Runtime caches:

- `raster_cache.py`: content-hash cache for rasterized uploads used by analyze, convert, and diff.
- `result_cache.py`: bounded cache for aligned image pairs used by rediff.
