# Visual Diff Tool

PNG, SVG, PDF, TIFF, Excalidraw files can be compared in a local web UI. The backend converts inputs to images, aligns image B to image A with OpenCV, and returns side-by-side diff data with an overlay, mask, and changed rectangles.

The first implementation focuses on the web app and local Backend API. VSCode extension integration is planned but not included yet.

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
http://127.0.0.1:8000/
```

## API

- `GET /api/health`
- `POST /api/analyze`
- `POST /api/convert`
- `POST /api/diff`

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
