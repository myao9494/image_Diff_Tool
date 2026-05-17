# Visual Diff Tool

PNG, SVG, PDF, TIFF, Excalidraw files can be compared in a local web UI. The backend converts inputs to images, aligns image B to image A with OpenCV, and returns side-by-side diff data with an overlay, mask, and changed rectangles.

The first implementation focuses on the web app and local Backend API. VSCode extension integration is planned but not included yet.

## Current Capabilities

- Upload or paste two inputs and preview the selected page before comparing.
- Compare PNG, SVG, PDF, TIFF, Excalidraw JSON, and Obsidian Excalidraw Markdown.
- Select pages independently for multi-page PDF/TIFF inputs.
- Compare changed image files in a local Git working tree, including staged renames where the HEAD-side path differs.
- Align image B to image A with staged OpenCV feature matching and ECC refinement.
- Switch between aligned B, diff overlay, and mask views.
- Adjust the diff threshold after comparison without rerunning alignment.
- Preserve thin drawing-line changes in the diff mask while filtering isolated single-pixel noise.
- Open a separate diff memo tab after comparison. The memo view uses a draggable A/B comparison slider, lets users place independent text notes on the image, and can copy image A or B with those notes rendered into the clipboard from the right-click menu.
- Excalidraw conversion is a lightweight built-in renderer. It handles basic shapes and text, and returns warnings for approximated or unsupported features such as embedded images, rotation, arrow heads, text styling, and opacity.

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
http://127.0.0.1:8078/
```

## API

- `GET /api/health`
- `POST /api/attachments`
- `POST /api/analyze`
- `POST /api/convert`
- `POST /api/diff`
- `POST /api/rediff`
- `POST /api/git/images`
- `POST /api/git/diff`

`/api/diff` returns a short-lived `result_id` in addition to the encoded result images. The UI uses that ID with `/api/rediff` when only the diff threshold changes, so threshold tuning reuses the aligned images instead of converting and aligning the files again.

## Performance Notes

- Upload rasterization is cached by file content, extension, DPI, and selected page. This avoids repeating the same conversion across previews and comparisons while keeping multi-page documents from being fully rasterized for every selected page.
- Diff result images are cached behind `result_id` for quick threshold recalculation.
- Both caches have item and memory limits, so large documents may be evicted and recalculated when needed.
- Uploaded files are limited to 100 MB each. PDF/TIFF inputs are limited to 60 pages, 90 megapixels per rasterized page, and 180 megapixels when a full-document rasterization path is used.
- Feature matching stops early when a detector produces a high-confidence transform; harder cases still fall through to the remaining detectors.
- Feature detection is downscaled for very large images and the estimated transform is mapped back to full-resolution coordinates before warping.
- The diff memo tab keeps the selected compared images in IndexedDB, with a localStorage fallback for older browsers, so it can open independently from the main comparison screen while avoiding the small localStorage quota for normal use. The notes are UI annotations only and are not part of the image-diff calculation or Backend API data model.

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
