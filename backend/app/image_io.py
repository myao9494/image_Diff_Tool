from __future__ import annotations

import base64
import binascii
import io
import json
import math
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


WHITE = (255, 255, 255, 255)
DEFAULT_CANVAS = (1600, 1200)
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
MAX_PAGE_COUNT = 60
MAX_RASTER_PIXELS = 90_000_000
MAX_TOTAL_RASTER_PIXELS = 180_000_000


@dataclass(frozen=True)
class RasterPage:
    index: int
    image: Image.Image
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class RasterInfo:
    index: int
    width: int
    height: int
    warnings: tuple[str, ...] = ()


class ConversionError(ValueError):
    pass


class PageRangeError(ConversionError):
    pass


def encode_png(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def decode_png(data: str) -> Image.Image:
    try:
        raw = base64.b64decode(data, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ConversionError("Image payload is not valid base64") from exc
    _validate_upload_size(raw, "rediff image")
    return _load_pil_image(raw, "rediff image")


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


def analyze_upload(filename: str, content: bytes, dpi: int = 180) -> tuple[str, list[RasterInfo]]:
    _validate_upload_size(content, filename)
    fmt = sniff_format(filename, content)
    if fmt == "pdf":
        return fmt, _analyze_pdf(content, dpi=dpi)
    if fmt in {"tif", "tiff"}:
        return "tiff", _analyze_tiff(content)
    fmt, pages = rasterize_upload_pages(filename, content, dpi=dpi, selected_pages={0})
    return fmt, [_info_from_page(page) for page in pages]


def rasterize_upload(filename: str, content: bytes, dpi: int = 180) -> tuple[str, list[RasterPage]]:
    return rasterize_upload_pages(filename, content, dpi=dpi)


def rasterize_upload_page(filename: str, content: bytes, page: int = 0, dpi: int = 180) -> tuple[str, RasterPage]:
    fmt, pages = rasterize_upload_pages(filename, content, dpi=dpi, selected_pages={page})
    if not pages:
        raise PageRangeError(f"Page index {page} is out of range")
    return fmt, pages[0]


def rasterize_upload_pages(
    filename: str,
    content: bytes,
    dpi: int = 180,
    selected_pages: set[int] | None = None,
) -> tuple[str, list[RasterPage]]:
    _validate_upload_size(content, filename)
    selected_pages = _normalize_selected_pages(selected_pages)
    fmt = sniff_format(filename, content)
    if fmt == "pdf":
        return fmt, _rasterize_pdf(content, dpi=dpi, selected_pages=selected_pages)
    if fmt == "svg":
        _require_single_page(selected_pages)
        return fmt, [_single_page(_rasterize_svg(content))]
    if fmt in {"tif", "tiff"}:
        return "tiff", _rasterize_tiff(content, selected_pages=selected_pages)
    if fmt in {"excalidraw", "excalidraw-md"}:
        _require_single_page(selected_pages)
        image, warnings = _rasterize_excalidraw(content, markdown=(fmt == "excalidraw-md"))
        return fmt, [_single_page(image, warnings=warnings)]
    _require_single_page(selected_pages)
    return fmt, [_single_page(_load_pil_image(content, filename))]


def _single_page(image: Image.Image, warnings: tuple[str, ...] = ()) -> RasterPage:
    normalized = normalize_page_image(image)
    _validate_raster_dimensions(normalized.width, normalized.height, "image")
    return RasterPage(index=0, image=normalized, warnings=warnings)


def _analyze_pdf(content: bytes, dpi: int) -> list[RasterInfo]:
    try:
        import fitz
    except ImportError as exc:
        raise ConversionError("PyMuPDF is required for PDF conversion") from exc

    infos: list[RasterInfo] = []
    with fitz.open(stream=content, filetype="pdf") as doc:
        _validate_page_count(len(doc), "PDF")
        scale = dpi / 72
        for i, page in enumerate(doc):
            width = int(math.ceil(page.rect.width * scale))
            height = int(math.ceil(page.rect.height * scale))
            _validate_raster_dimensions(width, height, f"PDF page {i + 1}")
            infos.append(RasterInfo(index=i, width=width, height=height))
    return infos


def _rasterize_pdf(content: bytes, dpi: int, selected_pages: set[int] | None) -> list[RasterPage]:
    try:
        import fitz
    except ImportError as exc:
        raise ConversionError("PyMuPDF is required for PDF conversion") from exc

    pages: list[RasterPage] = []
    with fitz.open(stream=content, filetype="pdf") as doc:
        _validate_page_count(len(doc), "PDF")
        indices = _selected_or_all_indices(selected_pages, len(doc))
        scale = dpi / 72
        matrix = fitz.Matrix(scale, scale)
        total_pixels = 0
        for i in indices:
            page = doc[i]
            pix = page.get_pixmap(matrix=matrix, alpha=True)
            _validate_raster_dimensions(pix.width, pix.height, f"PDF page {i + 1}")
            total_pixels += pix.width * pix.height
            if selected_pages is None:
                _validate_total_raster_pixels(total_pixels, "PDF")
            mode = "RGBA" if pix.alpha else "RGB"
            img = Image.frombytes(mode, [pix.width, pix.height], pix.samples)
            pages.append(RasterPage(index=i, image=normalize_page_image(img)))
    return pages


def _analyze_tiff(content: bytes) -> list[RasterInfo]:
    infos: list[RasterInfo] = []
    with Image.open(io.BytesIO(content)) as img:
        frame_count = getattr(img, "n_frames", None)
        if frame_count is not None:
            _validate_page_count(int(frame_count), "TIFF")
        i = 0
        while True:
            _validate_raster_dimensions(img.width, img.height, f"TIFF frame {i + 1}")
            infos.append(RasterInfo(index=i, width=img.width, height=img.height))
            i += 1
            try:
                img.seek(i)
            except EOFError:
                break
        _validate_page_count(len(infos), "TIFF")
    return infos


def _rasterize_tiff(content: bytes, selected_pages: set[int] | None) -> list[RasterPage]:
    pages: list[RasterPage] = []
    with Image.open(io.BytesIO(content)) as img:
        frame_count = getattr(img, "n_frames", None)
        if frame_count is not None:
            _validate_page_count(int(frame_count), "TIFF")
        selected = set(selected_pages) if selected_pages is not None else None
        total_pixels = 0
        i = 0
        while True:
            if selected is None or i in selected:
                _validate_raster_dimensions(img.width, img.height, f"TIFF frame {i + 1}")
                total_pixels += img.width * img.height
                if selected is None:
                    _validate_total_raster_pixels(total_pixels, "TIFF")
                pages.append(RasterPage(index=i, image=normalize_page_image(img.copy())))
                if selected is not None:
                    selected.discard(i)
            i += 1
            try:
                img.seek(i)
            except EOFError:
                break
        _validate_page_count(i, "TIFF")
        if selected:
            missing = min(selected)
            raise PageRangeError(f"Page index {missing} is out of range")
    return pages


def _rasterize_svg(content: bytes) -> Image.Image:
    errors = []
    raster_content = _prepare_svg_for_rasterization(content)
    try:
        import cairosvg
        png = cairosvg.svg2png(bytestring=raster_content, background_color="white")
        return _load_pil_image(png, "SVG")
    except Exception as exc:
        errors.append(f"CairoSVG: {exc}")

    try:
        import fitz

        with fitz.open(stream=raster_content, filetype="svg") as doc:
            if len(doc) < 1:
                raise ConversionError("SVG has no pages")
            page = doc[0]
            pix = page.get_pixmap(alpha=True)
            _validate_raster_dimensions(pix.width, pix.height, "SVG")
            mode = "RGBA" if pix.alpha else "RGB"
            image = Image.frombytes(mode, [pix.width, pix.height], pix.samples)
            return normalize_page_image(image)
    except Exception as exc:
        errors.append(f"PyMuPDF: {exc}")

    raise ConversionError("Could not convert SVG. " + "; ".join(errors))


def _prepare_svg_for_rasterization(content: bytes) -> bytes:
    """Make draw.io's HTML text fallback usable by SVG rasterizers.

    draw.io exports labels as a ``foreignObject`` plus an SVG ``text`` fallback
    inside ``switch``. Rasterizers used by this backend do not consistently
    support the HTML branch and can therefore render a label as blank. Removing
    that branch lets the portable SVG fallback be selected.
    """
    if b"foreignObject" not in content:
        return content

    try:
        root = ET.fromstring(content)
    except ET.ParseError:
        return content

    changed = False
    for parent in root.iter():
        if _svg_local_name(parent.tag) != "switch":
            continue
        children = list(parent)
        has_fallback = any(_svg_local_name(child.tag) != "foreignObject" for child in children)
        if not has_fallback:
            continue
        for child in children:
            if _svg_local_name(child.tag) == "foreignObject":
                parent.remove(child)
                changed = True

    if not changed:
        return content
    return ET.tostring(root, encoding="utf-8")


def _svg_local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _rasterize_excalidraw(content: bytes, markdown: bool) -> tuple[Image.Image, tuple[str, ...]]:
    payload = _extract_excalidraw_json(content) if markdown else json.loads(content.decode("utf-8"))
    elements = [el for el in payload.get("elements", []) if not el.get("isDeleted")]
    app_state = payload.get("appState", {})
    warnings = _excalidraw_warnings(elements)
    bounds = _element_bounds(elements)
    if bounds:
        x0, y0, x1, y1 = bounds
        pad = 80
        width = max(1, int(np.ceil(x1 - x0 + pad * 2)))
        height = max(1, int(np.ceil(y1 - y0 + pad * 2)))
        _validate_raster_dimensions(width, height, "Excalidraw canvas")
        offset_x = pad - x0
        offset_y = pad - y0
        canvas = Image.new("RGBA", (width, height), WHITE)
        drawable_elements = [_translated_element(element, offset_x, offset_y) for element in elements]
    else:
        _validate_raster_dimensions(DEFAULT_CANVAS[0], DEFAULT_CANVAS[1], "Excalidraw canvas")
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
    return normalize_page_image(canvas), warnings


def _extract_excalidraw_json(content: bytes) -> dict:
    text = content.decode("utf-8", errors="ignore")
    fenced = re.search(r"```json\s*(\{.*?\})\s*```", text, flags=re.S)
    if fenced:
        return json.loads(fenced.group(1))
    raw = re.search(r"(\{\s*\"type\"\s*:\s*\"excalidraw\".*\})", text, flags=re.S)
    if raw:
        return json.loads(raw.group(1))
    raise ConversionError("Could not find Excalidraw JSON in markdown")


def _excalidraw_warnings(elements: list[dict]) -> tuple[str, ...]:
    warnings = []
    if any(element.get("type") == "image" for element in elements):
        warnings.append("Excalidraw image elements are not rendered")
    if any(abs(_float_or_zero(element.get("angle"))) > 1e-6 for element in elements):
        warnings.append("Excalidraw element rotation is approximated")
    if any(element.get("type") == "arrow" and (element.get("startArrowhead") or element.get("endArrowhead")) for element in elements):
        warnings.append("Excalidraw arrow heads are not rendered")
    if any(element.get("type") == "text" and element.get("fontSize") not in (None, 20) for element in elements):
        warnings.append("Excalidraw text styling is approximated")
    if any(element.get("opacity") not in (None, 100) for element in elements):
        warnings.append("Excalidraw opacity is approximated")
    return tuple(warnings)


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


def _float_or_zero(value) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _info_from_page(page: RasterPage) -> RasterInfo:
    return RasterInfo(index=page.index, width=page.image.width, height=page.image.height, warnings=page.warnings)


def _load_pil_image(content: bytes, label: str) -> Image.Image:
    with Image.open(io.BytesIO(content)) as image:
        _validate_raster_dimensions(image.width, image.height, label)
        return normalize_page_image(image)


def _normalize_selected_pages(selected_pages: set[int] | None) -> set[int] | None:
    if selected_pages is None:
        return None
    normalized = {int(page) for page in selected_pages}
    if any(page < 0 for page in normalized):
        raise PageRangeError("Page index must be zero or greater")
    return normalized


def _require_single_page(selected_pages: set[int] | None) -> None:
    if selected_pages is None:
        return
    if selected_pages != {0}:
        page = min(selected_pages)
        raise PageRangeError(f"Page index {page} is out of range")


def _selected_or_all_indices(selected_pages: set[int] | None, page_count: int) -> list[int]:
    if selected_pages is None:
        return list(range(page_count))
    missing = [page for page in selected_pages if page >= page_count]
    if missing:
        raise PageRangeError(f"Page index {min(missing)} is out of range")
    return sorted(selected_pages)


def _validate_upload_size(content: bytes, label: str) -> None:
    if len(content) > MAX_UPLOAD_BYTES:
        size_mb = len(content) / (1024 * 1024)
        limit_mb = MAX_UPLOAD_BYTES / (1024 * 1024)
        raise ConversionError(f"{label} is too large ({size_mb:.1f} MB); limit is {limit_mb:.0f} MB")


def _validate_page_count(page_count: int, label: str) -> None:
    if page_count > MAX_PAGE_COUNT:
        raise ConversionError(f"{label} has {page_count} pages; limit is {MAX_PAGE_COUNT} pages")


def _validate_raster_dimensions(width: int, height: int, label: str) -> None:
    if width <= 0 or height <= 0:
        raise ConversionError(f"{label} has invalid dimensions")
    pixels = int(width) * int(height)
    if pixels > MAX_RASTER_PIXELS:
        mp = pixels / 1_000_000
        limit = MAX_RASTER_PIXELS / 1_000_000
        raise ConversionError(f"{label} is too large to rasterize ({mp:.1f} MP); limit is {limit:.0f} MP")


def _validate_total_raster_pixels(total_pixels: int, label: str) -> None:
    if total_pixels > MAX_TOTAL_RASTER_PIXELS:
        mp = total_pixels / 1_000_000
        limit = MAX_TOTAL_RASTER_PIXELS / 1_000_000
        raise ConversionError(f"{label} pages are too large to rasterize together ({mp:.1f} MP); limit is {limit:.0f} MP")
