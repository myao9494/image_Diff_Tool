from __future__ import annotations

from pathlib import Path
import sys

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.alignment import align_to_reference
from backend.app.diffing import build_visual_diff
from backend.app.image_io import cv_to_pil, pil_to_cv, rasterize_upload


SAMPLES = ROOT / "samples"
OUTPUT = ROOT / "debug_outputs"


def main() -> None:
    OUTPUT.mkdir(exist_ok=True)
    pairs = sorted(path.name[: -len("_a.png")] for path in SAMPLES.glob("*_a.png"))
    tiles = []

    print("pair,success,matches,inliers,diff_ratio,warning")
    for pair in pairs:
        _, pages_a = rasterize_upload(f"{pair}_a.png", (SAMPLES / f"{pair}_a.png").read_bytes())
        _, pages_b = rasterize_upload(f"{pair}_b.png", (SAMPLES / f"{pair}_b.png").read_bytes())
        image_a = pil_to_cv(pages_a[0].image)
        image_b = pil_to_cv(pages_b[0].image)
        alignment = align_to_reference(image_a, image_b, "汎用")
        diff = build_visual_diff(image_a, alignment.image)

        aligned = cv_to_pil(alignment.image)
        overlay = cv_to_pil(diff["overlay"])
        aligned.save(OUTPUT / f"{pair}_aligned.png")
        overlay.save(OUTPUT / f"{pair}_overlay.png")

        warning = alignment.warning or ""
        print(f"{pair},{alignment.success},{alignment.matches},{alignment.inliers},{diff['diff_ratio']:.6f},{warning}")
        tiles.append(_tile(pair, pages_a[0].image, aligned, alignment.success, alignment.matches, alignment.inliers, diff["diff_ratio"], warning))

    _contact_sheet(tiles).save(OUTPUT / "all_aligned_contact_sheet.png")
    print(f"contact_sheet={OUTPUT / 'all_aligned_contact_sheet.png'}")


def _tile(pair: str, image_a: Image.Image, aligned: Image.Image, success: bool, matches: int, inliers: int, diff_ratio: float, warning: str) -> Image.Image:
    tile = Image.new("RGB", (360, 230), "white")
    tile.paste(image_a.resize((160, 120)), (10, 34))
    tile.paste(aligned.resize((160, 120)), (190, 34))
    draw = ImageDraw.Draw(tile)
    draw.text((10, 8), pair, fill="black")
    draw.text((10, 160), f"ok={success} m={matches} i={inliers}", fill="black")
    draw.text((10, 182), f"diff={diff_ratio * 100:.2f}% {warning}", fill="black")
    return tile


def _contact_sheet(tiles: list[Image.Image]) -> Image.Image:
    cols = 3
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * 360, rows * 230), "#f0f0f0")
    for index, tile in enumerate(tiles):
        sheet.paste(tile, ((index % cols) * 360, (index // cols) * 230))
    return sheet


if __name__ == "__main__":
    main()
