from __future__ import annotations

import base64
import io
import json
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


WHITE = (255, 255, 255, 255)
DEFAULT_CANVAS = (1600, 1200)


@dataclass(frozen=True)
class RasterPage:
    index: int
    image: Image.Image


class ConversionError(ValueError):
    pass


def encode_png(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def decode_png(data: str) -> Image.Image:
    return normalize_page_image(Image.open(io.BytesIO(base64.b64decode(data))))


def pil_to_cv(image: Image.Image) -> np.ndarray:
    rgb = image.convert("RGB")
    return np.array(rgb)[:, :, ::-1].copy()


def cv_to_pil(image: np.ndarray) -> Image.Image:
    if image.ndim == 2:
        return Image.fromarray(image)
    return Image.fromarray(image[:, :, ::-1]).convert("RGB")


def normalize_page_image(image: Image.Image) -> Image.Image:
    if image.mode in ("RGBA", "LA") or ("transparency" in image.info):
        rgba = image.convert("RGBA")
        bg = Image.new("RGBA", rgba.size, WHITE)
        bg.alpha_composite(rgba)
        return bg.convert("RGB")
    return image.convert("RGB")


def sniff_format(filename: str, content: bytes) -> str:
    suffix = Path(filename).suffix.lower().lstrip(".")
    head = content[:512].lstrip()
    if head.startswith(b"%PDF"):
        return "pdf"
    if head.startswith((b"<svg", b"<?xml")) and b"<svg" in head[:256]:
        return "svg"
    if suffix in {"excalidraw", "json"}:
        return "excalidraw"
    if suffix == "md" and b"excalidraw" in content[:4096].lower():
        return "excalidraw-md"
    if suffix in {"tif", "tiff"}:
        return "tiff"
    if suffix:
        return suffix
    return "unknown"


def rasterize_upload(filename: str, content: bytes, dpi: int = 180) -> tuple[str, list[RasterPage]]:
    fmt = sniff_format(filename, content)
    if fmt == "pdf":
        return fmt, _rasterize_pdf(content, dpi=dpi)
    if fmt == "svg":
        return fmt, [_single_page(_rasterize_svg(content))]
    if fmt in {"tif", "tiff"}:
        return "tiff", _rasterize_tiff(content)
    if fmt in {"excalidraw", "excalidraw-md"}:
        return fmt, [_single_page(_rasterize_excalidraw(content, markdown=(fmt == "excalidraw-md")))]
    return fmt, [_single_page(normalize_page_image(Image.open(io.BytesIO(content))))]


def _single_page(image: Image.Image) -> RasterPage:
    return RasterPage(index=0, image=normalize_page_image(image))


def _rasterize_pdf(content: bytes, dpi: int) -> list[RasterPage]:
    try:
        import fitz
    except ImportError as exc:
        raise ConversionError("PyMuPDF is required for PDF conversion") from exc

    pages: list[RasterPage] = []
    with fitz.open(stream=content, filetype="pdf") as doc:
        scale = dpi / 72
        matrix = fitz.Matrix(scale, scale)
        for i, page in enumerate(doc):
            pix = page.get_pixmap(matrix=matrix, alpha=True)
            mode = "RGBA" if pix.alpha else "RGB"
            img = Image.frombytes(mode, [pix.width, pix.height], pix.samples)
            pages.append(RasterPage(index=i, image=normalize_page_image(img)))
    return pages


def _rasterize_tiff(content: bytes) -> list[RasterPage]:
    pages: list[RasterPage] = []
    with Image.open(io.BytesIO(content)) as img:
        i = 0
        while True:
            pages.append(RasterPage(index=i, image=normalize_page_image(img.copy())))
            i += 1
            try:
                img.seek(i)
            except EOFError:
                break
    return pages


def _rasterize_svg(content: bytes) -> Image.Image:
    try:
        import cairosvg
    except ImportError as exc:
        raise ConversionError("CairoSVG is required for SVG conversion") from exc
    png = cairosvg.svg2png(bytestring=content, background_color="white")
    return normalize_page_image(Image.open(io.BytesIO(png)))


def _rasterize_excalidraw(content: bytes, markdown: bool) -> Image.Image:
    payload = _extract_excalidraw_json(content) if markdown else json.loads(content.decode("utf-8"))
    elements = [el for el in payload.get("elements", []) if not el.get("isDeleted")]
    app_state = payload.get("appState", {})
    bounds = _element_bounds(elements)
    if bounds:
        x0, y0, x1, y1 = bounds
        pad = 80
        width = max(1, int(np.ceil(x1 - x0 + pad * 2)))
        height = max(1, int(np.ceil(y1 - y0 + pad * 2)))
        offset_x = pad - x0
        offset_y = pad - y0
        canvas = Image.new("RGBA", (width, height), WHITE)
        drawable_elements = [_translated_element(element, offset_x, offset_y) for element in elements]
    else:
        canvas = Image.new("RGBA", DEFAULT_CANVAS, WHITE)
        drawable_elements = elements
    draw = ImageDraw.Draw(canvas)

    for element in drawable_elements:
        _draw_excalidraw_element(draw, element)

    bg = app_state.get("viewBackgroundColor") or "#ffffff"
    if bg != "#ffffff":
        background = Image.new("RGBA", canvas.size, _hex_to_rgba(bg))
        background.alpha_composite(canvas)
        canvas = background
    return normalize_page_image(canvas)


def _extract_excalidraw_json(content: bytes) -> dict:
    text = content.decode("utf-8", errors="ignore")
    fenced = re.search(r"```json\s*(\{.*?\})\s*```", text, flags=re.S)
    if fenced:
        return json.loads(fenced.group(1))
    raw = re.search(r"(\{\s*\"type\"\s*:\s*\"excalidraw\".*\})", text, flags=re.S)
    if raw:
        return json.loads(raw.group(1))
    raise ConversionError("Could not find Excalidraw JSON in markdown")


def _draw_excalidraw_element(draw: ImageDraw.ImageDraw, element: dict) -> None:
    x = float(element.get("x", 0))
    y = float(element.get("y", 0))
    w = float(element.get("width", 0))
    h = float(element.get("height", 0))
    color = element.get("strokeColor") or "#000000"
    fill = element.get("backgroundColor")
    stroke = max(1, int(element.get("strokeWidth") or 1))
    kind = element.get("type")
    box = [x, y, x + w, y + h]

    fill_color = None if not fill or fill == "transparent" else _hex_to_rgba(fill)
    line_color = _hex_to_rgba(color)
    if kind in {"rectangle", "diamond"}:
        if kind == "diamond":
            pts = [(x + w / 2, y), (x + w, y + h / 2), (x + w / 2, y + h), (x, y + h / 2)]
            draw.polygon(pts, fill=fill_color, outline=line_color)
        else:
            draw.rectangle(box, fill=fill_color, outline=line_color, width=stroke)
    elif kind == "ellipse":
        draw.ellipse(box, fill=fill_color, outline=line_color, width=stroke)
    elif kind in {"line", "arrow", "freedraw"}:
        points = element.get("points") or []
        if points:
            pts = [(x + float(px), y + float(py)) for px, py in points]
            draw.line(pts, fill=line_color, width=stroke, joint="curve")
    elif kind == "text":
        text = element.get("text") or ""
        draw.multiline_text((x, y), text, fill=line_color, spacing=4)


def _translated_element(element: dict, offset_x: float, offset_y: float) -> dict:
    translated = dict(element)
    translated["x"] = float(element.get("x", 0)) + offset_x
    translated["y"] = float(element.get("y", 0)) + offset_y
    return translated


def _element_bounds(elements: list[dict]) -> tuple[float, float, float, float] | None:
    boxes = []
    for el in elements:
        x = float(el.get("x", 0))
        y = float(el.get("y", 0))
        boxes.append((x, y, x + float(el.get("width", 0)), y + float(el.get("height", 0))))
    if not boxes:
        return None
    return (
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    )


def _hex_to_rgba(value: str) -> tuple[int, int, int, int]:
    value = value.strip()
    if value.startswith("#") and len(value) in {4, 7}:
        if len(value) == 4:
            value = "#" + "".join(ch * 2 for ch in value[1:])
        return tuple(int(value[i : i + 2], 16) for i in (1, 3, 5)) + (255,)
    return (0, 0, 0, 255)
