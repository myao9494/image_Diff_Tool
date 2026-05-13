from __future__ import annotations

import json
import subprocess
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .attachments import RETENTION_DAYS, cleanup_expired_attachments, save_attachment
from .alignment import align_to_reference
from .diffing import build_visual_diff, resize_to_match
from .image_io import ConversionError, cv_to_pil, decode_png, encode_png, pil_to_cv
from .models import AlignmentInfo, AnalyzeResponse, DiffResponse, ImagePayload, PageInfo, RediffRequest, RediffResponse
from .raster_cache import rasterize_upload_cached
from .regions import suggest_anchor_regions
from .result_cache import get_diff_images, store_diff_images


app = FastAPI(title="Visual Diff Tool API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8078",
        "http://127.0.0.1:8078",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DIST_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"
ASSETS_DIR = DIST_DIR / "assets"
IMAGE_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".bmp",
    ".gif",
    ".tif",
    ".tiff",
    ".svg",
    ".pdf",
    ".excalidraw",
}


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/attachments")
async def upload_attachment(file: UploadFile = File(...)) -> JSONResponse:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Attachment is empty")
    deleted_expired = cleanup_expired_attachments()
    path = save_attachment(file.filename or "clipboard.png", content)
    return JSONResponse(
        {
            "filename": file.filename or "clipboard.png",
            "stored_as": path.name,
            "size": len(content),
            "retention_days": RETENTION_DAYS,
            "deleted_expired": deleted_expired,
        }
    )


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
            "regions": suggest_anchor_regions(pil_to_cv(selected.image)),
        }
    )


@app.post("/api/diff", response_model=DiffResponse)
async def diff(
    file_a: UploadFile = File(...),
    file_b: UploadFile = File(...),
    page_a: int = Form(0),
    page_b: int = Form(0),
    category: str = Form("汎用"),
    diff_threshold: float = Form(0.1),
    anchor_region: str | None = Form(None),
) -> DiffResponse:
    content_a = await file_a.read()
    content_b = await file_b.read()
    _, pages_a = _convert_or_400(file_a.filename or "a", content_a)
    _, pages_b = _convert_or_400(file_b.filename or "b", content_b)
    raster_a = _select_page(pages_a, page_a)
    raster_b = _select_page(pages_b, page_b)

    image_a = pil_to_cv(raster_a.image)
    image_b = pil_to_cv(raster_b.image)
    alignment = align_to_reference(image_a, image_b, category=category, anchor_region=_parse_anchor_region(anchor_region))
    comparison_a = alignment.reference_image if alignment.reference_image is not None else image_a
    comparison_a = resize_to_match(alignment.image, comparison_a)
    comparison_b = resize_to_match(comparison_a, alignment.image)
    diff_result = build_visual_diff(comparison_a, comparison_b, threshold=diff_threshold)
    result_id = store_diff_images(comparison_a, comparison_b)

    return DiffResponse(
        result_id=result_id,
        page_a=raster_a.index,
        page_b=raster_b.index,
        category=category,
        width=comparison_a.shape[1],
        height=comparison_a.shape[0],
        alignment=AlignmentInfo(
            success=alignment.success,
            method=alignment.method,
            warning=alignment.warning,
            matches=alignment.matches,
            inliers=alignment.inliers,
            matrix=alignment.matrix,
        ),
        image_a=ImagePayload(data=encode_png(cv_to_pil(comparison_a))),
        image_a_original=ImagePayload(data=encode_png(cv_to_pil(image_a))),
        image_b_original=ImagePayload(data=encode_png(cv_to_pil(image_b))),
        image_b_aligned=ImagePayload(data=encode_png(cv_to_pil(comparison_b))),
        overlay=ImagePayload(data=encode_png(cv_to_pil(diff_result["overlay"]))),
        mask=ImagePayload(data=encode_png(cv_to_pil(diff_result["mask"]))),
        diff_rects=diff_result["rects"],
        diff_pixels=diff_result["diff_pixels"],
        diff_ratio=diff_result["diff_ratio"],
        diff_threshold=diff_result["threshold"],
    )


@app.post("/api/rediff", response_model=RediffResponse)
async def rediff(payload: RediffRequest) -> RediffResponse:
    result_id = payload.result_id
    if payload.result_id:
        cached = get_diff_images(payload.result_id)
        if cached:
            image_a = cached.image_a
            image_b_aligned = cached.image_b_aligned
        elif payload.image_a is None or payload.image_b_aligned is None:
            raise HTTPException(status_code=404, detail="Diff result cache expired")
        else:
            image_a, image_b_aligned = _decode_rediff_images(payload)
            result_id = store_diff_images(image_a, image_b_aligned)
    else:
        image_a, image_b_aligned = _decode_rediff_images(payload)
        result_id = store_diff_images(image_a, image_b_aligned)
    diff_result = build_visual_diff(image_a, image_b_aligned, threshold=payload.diff_threshold)
    return RediffResponse(
        result_id=result_id,
        overlay=ImagePayload(data=encode_png(cv_to_pil(diff_result["overlay"]))),
        mask=ImagePayload(data=encode_png(cv_to_pil(diff_result["mask"]))),
        diff_rects=diff_result["rects"],
        diff_pixels=diff_result["diff_pixels"],
        diff_ratio=diff_result["diff_ratio"],
        diff_threshold=diff_result["threshold"],
    )


@app.post("/api/git/images")
async def git_images(payload: dict) -> JSONResponse:
    folder = _payload_folder(payload)
    repo = _git_repo_root(folder)
    files = _changed_image_files(repo, folder)
    return JSONResponse(
        {
            "folder": str(folder),
            "repo_root": str(repo),
            "files": files,
        }
    )


@app.post("/api/git/diff", response_model=DiffResponse)
async def git_diff(payload: dict) -> DiffResponse:
    folder = _payload_folder(payload)
    repo = _git_repo_root(folder)
    path = str(payload.get("path") or "")
    if not path:
        raise HTTPException(status_code=422, detail="path is required")
    rel_path = _safe_git_path(repo, path)
    current_path = repo / rel_path
    if not current_path.exists() or not current_path.is_file():
        raise HTTPException(status_code=404, detail=f"Current file not found: {rel_path}")
    previous = _git_show(repo, rel_path)
    current = current_path.read_bytes()
    return _build_diff_response(
        filename_a=f"HEAD:{rel_path}",
        content_a=previous,
        filename_b=rel_path,
        content_b=current,
        category=str(payload.get("category") or "汎用"),
        diff_threshold=float(payload.get("diff_threshold") or 0.1),
    )


def _decode_rediff_images(payload: RediffRequest):
    if payload.image_a is None or payload.image_b_aligned is None:
        raise HTTPException(status_code=422, detail="result_id or both diff images are required")
    try:
        return pil_to_cv(decode_png(payload.image_a.data)), pil_to_cv(decode_png(payload.image_b_aligned.data))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not read diff images: {exc}") from exc


def _convert_or_400(filename: str, content: bytes):
    try:
        return rasterize_upload_cached(filename, content)
    except ConversionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not read {filename}: {exc}") from exc


def _select_page(pages, index: int):
    if index < 0 or index >= len(pages):
        raise HTTPException(status_code=400, detail=f"Page index {index} is out of range")
    return pages[index]


def _parse_anchor_region(anchor_region: str | None) -> dict | None:
    if not anchor_region:
        return None
    try:
        value = json.loads(anchor_region)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="anchor_region must be JSON") from exc
    if not isinstance(value, dict):
        raise HTTPException(status_code=400, detail="anchor_region must be an object")
    return value


def _build_diff_response(
    *,
    filename_a: str,
    content_a: bytes,
    filename_b: str,
    content_b: bytes,
    category: str,
    diff_threshold: float,
) -> DiffResponse:
    _, pages_a = _convert_or_400(filename_a, content_a)
    _, pages_b = _convert_or_400(filename_b, content_b)
    raster_a = _select_page(pages_a, 0)
    raster_b = _select_page(pages_b, 0)
    image_a = pil_to_cv(raster_a.image)
    image_b = pil_to_cv(raster_b.image)
    alignment = align_to_reference(image_a, image_b, category=category, anchor_region=None)
    comparison_a = alignment.reference_image if alignment.reference_image is not None else image_a
    comparison_a = resize_to_match(alignment.image, comparison_a)
    comparison_b = resize_to_match(comparison_a, alignment.image)
    diff_result = build_visual_diff(comparison_a, comparison_b, threshold=diff_threshold)
    result_id = store_diff_images(comparison_a, comparison_b)
    return DiffResponse(
        result_id=result_id,
        page_a=raster_a.index,
        page_b=raster_b.index,
        category=category,
        width=comparison_a.shape[1],
        height=comparison_a.shape[0],
        alignment=AlignmentInfo(
            success=alignment.success,
            method=alignment.method,
            warning=alignment.warning,
            matches=alignment.matches,
            inliers=alignment.inliers,
            matrix=alignment.matrix,
        ),
        image_a=ImagePayload(data=encode_png(cv_to_pil(comparison_a))),
        image_a_original=ImagePayload(data=encode_png(cv_to_pil(image_a))),
        image_b_original=ImagePayload(data=encode_png(cv_to_pil(image_b))),
        image_b_aligned=ImagePayload(data=encode_png(cv_to_pil(comparison_b))),
        overlay=ImagePayload(data=encode_png(cv_to_pil(diff_result["overlay"]))),
        mask=ImagePayload(data=encode_png(cv_to_pil(diff_result["mask"]))),
        diff_rects=diff_result["rects"],
        diff_pixels=diff_result["diff_pixels"],
        diff_ratio=diff_result["diff_ratio"],
        diff_threshold=diff_result["threshold"],
    )


def _payload_folder(payload: dict) -> Path:
    raw_folder = str(payload.get("folder") or "").strip()
    if not raw_folder:
        raise HTTPException(status_code=422, detail="folder is required")
    folder = Path(raw_folder).expanduser()
    try:
        folder = folder.resolve(strict=True)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Folder not found") from exc
    if not folder.is_dir():
        raise HTTPException(status_code=422, detail="folder must be a directory")
    return folder


def _git_repo_root(folder: Path) -> Path:
    try:
        completed = subprocess.run(
            ["git", "-C", str(folder), "rev-parse", "--show-toplevel"],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except subprocess.CalledProcessError as exc:
        raise HTTPException(status_code=422, detail="指定フォルダはgitリポジトリではありません") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="git repository check timed out") from exc
    return Path(completed.stdout.strip()).resolve()


def _changed_image_files(repo: Path, folder: Path) -> list[dict]:
    output = _git(["status", "--porcelain=v1", "-z", "--", str(folder)], repo)
    entries = [item for item in output.split("\0") if item]
    files = []
    i = 0
    while i < len(entries):
        entry = entries[i]
        status = entry[:2]
        path = entry[3:]
        if status.startswith("R") or status.startswith("C"):
            i += 1
            if i < len(entries):
                path = entries[i]
        i += 1
        if Path(path).suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        comparable = "?" not in status and "A" not in status and "D" not in status
        files.append(
            {
                "path": path,
                "status": status.strip() or "M",
                "comparable": comparable,
                "reason": None if comparable else "HEAD側の画像がないため比較できません",
            }
        )
    return files


def _safe_git_path(repo: Path, path: str) -> str:
    rel = Path(path)
    if rel.is_absolute() or ".." in rel.parts:
        raise HTTPException(status_code=422, detail="path must be a repository-relative path")
    resolved = (repo / rel).resolve()
    if repo != resolved and repo not in resolved.parents:
        raise HTTPException(status_code=422, detail="path is outside repository")
    if rel.suffix.lower() not in IMAGE_EXTENSIONS:
        raise HTTPException(status_code=422, detail="path is not a supported image file")
    return rel.as_posix()


def _git_show(repo: Path, rel_path: str) -> bytes:
    try:
        completed = subprocess.run(
            ["git", "-C", str(repo), "show", f"HEAD:{rel_path}"],
            check=True,
            capture_output=True,
            timeout=20,
        )
    except subprocess.CalledProcessError as exc:
        raise HTTPException(status_code=404, detail=f"HEAD側の画像を取得できません: {rel_path}") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="git show timed out") from exc
    return completed.stdout


def _git(args: list[str], repo: Path) -> str:
    try:
        completed = subprocess.run(
            ["git", "-C", str(repo), *args],
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
    except subprocess.CalledProcessError as exc:
        raise HTTPException(status_code=422, detail=exc.stderr.strip() or "git command failed") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="git command timed out") from exc
    return completed.stdout


if ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")


@app.get("/")
def serve_frontend() -> FileResponse:
    index = DIST_DIR / "index.html"
    if not index.exists():
        raise HTTPException(status_code=404, detail="frontend/dist/index.html not found. Run npm run build in frontend.")
    return FileResponse(index)


@app.get("/{filename}", include_in_schema=False)
def serve_frontend_file(filename: str) -> FileResponse:
    path = DIST_DIR / filename
    if path.exists() and path.is_file():
        return FileResponse(path)
    raise HTTPException(status_code=404, detail="Not found")


@app.get("/{path:path}", include_in_schema=False)
def serve_spa(path: str) -> FileResponse:
    if path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")
    index = DIST_DIR / "index.html"
    if not index.exists():
        raise HTTPException(status_code=404, detail="frontend/dist/index.html not found. Run npm run build in frontend.")
    return FileResponse(index)
