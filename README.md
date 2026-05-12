# Visual Diff Tool

PNG, SVG, PDF, TIFF, Excalidraw files can be compared in a local web UI. The backend converts inputs to images, aligns image B to image A with OpenCV, and returns side-by-side diff data with an overlay, mask, and changed rectangles.

The first implementation focuses on the web app and local Backend API. VSCode extension integration is planned but not included yet.

## Current Capabilities

- Upload or paste two inputs and preview the selected page before comparing.
- Compare PNG, SVG, PDF, TIFF, Excalidraw JSON, and Obsidian Excalidraw Markdown.
- Select pages independently for multi-page PDF/TIFF inputs.
- Align image B to image A with staged OpenCV feature matching and ECC refinement.
- Switch between aligned B, diff overlay, and mask views.
- Adjust the diff threshold after comparison without rerunning alignment.

## Run

Install Python 3.12 or a compatible Python 3 version first.

### macOS

```bash
./start_mac.sh
```

### Windows

```bat
start_windows.bat
```

Both scripts create `.venv` if needed, run `pip install -r requirements.txt`, and start the FastAPI server.
After startup, open:

```text
http://127.0.0.1:8002/
```

## API

- `GET /api/health`
- `POST /api/analyze`
- `POST /api/convert`
- `POST /api/diff`
- `POST /api/rediff`

`/api/diff` returns a short-lived `result_id` in addition to the encoded result images. The UI uses that ID with `/api/rediff` when only the diff threshold changes, so threshold tuning reuses the aligned images instead of converting and aligning the files again.

## Performance Notes

- Upload rasterization is cached by file content, extension, and DPI. This avoids repeating the same conversion across analyze, preview, and compare calls.
- Diff result images are cached behind `result_id` for quick threshold recalculation.
- Both caches have item and memory limits, so large documents may be evicted and recalculated when needed.
- Feature matching stops early when a detector produces a high-confidence transform; harder cases still fall through to the remaining detectors.

## Frontend Distribution

`frontend/dist` is intentionally committed so Windows offline users do not need Node.js or `npm install`.
When changing the frontend, rebuild it before committing:

```bash
cd frontend
npm install
npm run build
```

The FastAPI backend serves the built frontend from `frontend/dist`, so deployment only needs Python dependencies plus the committed repository contents.

## Verification

```bash
.venv/bin/python -m unittest discover -s tests
```

To generate a contact sheet that checks all sample alignments:

```bash
.venv/bin/python scripts/verify_samples.py
```
