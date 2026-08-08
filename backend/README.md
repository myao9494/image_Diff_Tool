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
- `POST /api/git/files`
- `POST /api/git/markdown` / `GET /api/git/markdown?path=...`
- `POST /api/git/item`
- `POST /api/git/diff`
- `GET /api/settings/obsidian`
- `PUT /api/settings/obsidian`
- `POST /api/reports/save`

The backend also serves the built web app from `../frontend/dist` at `/`.
The normal launch disables Uvicorn's file watcher to reduce idle CPU and avoid a second process. Set `VISUAL_DIFF_RELOAD=1` only during backend development when automatic reload is useful.

`/api/diff` performs conversion, alignment, and initial diff generation. It normally returns a `result_id` that points to bounded aligned images in memory. If a pair is too large for the cache, `result_id` is `null`. `/api/rediff` accepts that `result_id` plus a new threshold and regenerates only the overlay/mask/rect metrics. If the in-memory entry has been evicted, callers can fall back by sending `image_a` and `image_b_aligned` directly.

Obsidian integrations can send the active note path to `/api/git/markdown`. The response includes a `diff_url` such as `/?markdown_path=...`; opening it loads the Markdown diff and changed linked images/diagrams recursively. The endpoint accepts `markdown_path`, `markdown_file`, `path`, or `folder` in a JSON request.

`GET/PUT /api/settings/obsidian` persists the Obsidian vault and report output directories in the backend settings file. `/api/reports/save` writes a self-contained HTML report of up to 50 MB only to that configured report directory; request payloads cannot override the destination.

`/api/analyze` returns page metadata and conversion warnings without rasterizing every page of PDF/TIFF files. `/api/convert` and `/api/diff` rasterize only the requested page. Excalidraw support is implemented by the built-in Python renderer, including Obsidian `compressed-json` blocks; unsupported or approximated Excalidraw features are surfaced through `warnings` and `conversion_warnings`. Draw.io SVG `foreignObject` labels are converted to portable SVG text with line breaks before rasterization.

`/api/git/images` is the compatibility endpoint for changed images. `/api/git/files` lists changed images and configured text extensions, including added, deleted, and untracked files. `/api/git/item` returns one-sided image previews or structured side-by-side text rows. Text files are limited to 5 MB and 30,000 lines per side. `/api/git/diff` compares the working-tree image to the HEAD-side image and accepts `head_path` for staged renames/copies.

Runtime caches:

- `raster_cache.py`: content-hash cache for rasterized uploads keyed by extension, DPI, and page.
- `result_cache.py`: bounded cache for aligned image pairs used by rediff.

Input limits:

- Upload size: 100 MB per file.
- PDF/TIFF page count: 60 pages.
- Rasterized page size: 90 megapixels per page.
- Full-document rasterization guard: 180 megapixels total.
