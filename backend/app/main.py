from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .alignment import align_to_reference
from .diffing import build_visual_diff, resize_to_match
from .image_io import ConversionError, cv_to_pil, encode_png, pil_to_cv, rasterize_upload
from .models import AlignmentInfo, AnalyzeResponse, DiffResponse, ImagePayload, PageInfo


app = FastAPI(title="Visual Diff Tool API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DIST_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"
ASSETS_DIR = DIST_DIR / "assets"


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze(file: UploadFile = File(...)) -> AnalyzeResponse:
    content = await file.read()
    fmt, pages = _convert_or_400(file.filename or "upload", content)
    return AnalyzeResponse(
        filename=file.filename or "upload",
        format=fmt,
        page_count=len(pages),
        pages=[PageInfo(index=page.index, width=page.image.width, height=page.image.height) for page in pages],
    )


@app.post("/api/convert")
async def convert(file: UploadFile = File(...), page: int = Form(0)) -> JSONResponse:
    content = await file.read()
    fmt, pages = _convert_or_400(file.filename or "upload", content)
    selected = _select_page(pages, page)
    return JSONResponse(
        {
            "filename": file.filename,
            "format": fmt,
            "page": selected.index,
            "width": selected.image.width,
            "height": selected.image.height,
            "image": {"mime_type": "image/png", "data": encode_png(selected.image)},
        }
    )


@app.post("/api/diff", response_model=DiffResponse)
async def diff(
    file_a: UploadFile = File(...),
    file_b: UploadFile = File(...),
    page_a: int = Form(0),
    page_b: int = Form(0),
    category: str = Form("汎用"),
) -> DiffResponse:
    content_a = await file_a.read()
    content_b = await file_b.read()
    _, pages_a = _convert_or_400(file_a.filename or "a", content_a)
    _, pages_b = _convert_or_400(file_b.filename or "b", content_b)
    raster_a = _select_page(pages_a, page_a)
    raster_b = _select_page(pages_b, page_b)

    image_a = pil_to_cv(raster_a.image)
    image_b = resize_to_match(image_a, pil_to_cv(raster_b.image))
    alignment = align_to_reference(image_a, image_b, category=category)
    diff_result = build_visual_diff(image_a, alignment.image)

    return DiffResponse(
        page_a=raster_a.index,
        page_b=raster_b.index,
        category=category,
        width=raster_a.image.width,
        height=raster_a.image.height,
        alignment=AlignmentInfo(
            success=alignment.success,
            method=alignment.method,
            warning=alignment.warning,
            matches=alignment.matches,
            inliers=alignment.inliers,
            matrix=alignment.matrix,
        ),
        image_a=ImagePayload(data=encode_png(raster_a.image)),
        image_b_aligned=ImagePayload(data=encode_png(cv_to_pil(alignment.image))),
        overlay=ImagePayload(data=encode_png(cv_to_pil(diff_result["overlay"]))),
        mask=ImagePayload(data=encode_png(cv_to_pil(diff_result["mask"]))),
        diff_rects=diff_result["rects"],
        diff_pixels=diff_result["diff_pixels"],
        diff_ratio=diff_result["diff_ratio"],
    )


def _convert_or_400(filename: str, content: bytes):
    try:
        return rasterize_upload(filename, content)
    except ConversionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not read {filename}: {exc}") from exc


def _select_page(pages, index: int):
    if index < 0 or index >= len(pages):
        raise HTTPException(status_code=400, detail=f"Page index {index} is out of range")
    return pages[index]


if ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")


@app.get("/")
def serve_frontend() -> FileResponse:
    index = DIST_DIR / "index.html"
    if not index.exists():
        raise HTTPException(status_code=404, detail="frontend/dist/index.html not found. Run npm run build in frontend.")
    return FileResponse(index)


@app.get("/{path:path}", include_in_schema=False)
def serve_spa(path: str) -> FileResponse:
    if path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")
    index = DIST_DIR / "index.html"
    if not index.exists():
        raise HTTPException(status_code=404, detail="frontend/dist/index.html not found. Run npm run build in frontend.")
    return FileResponse(index)
