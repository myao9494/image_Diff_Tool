import os
import unittest
import json
from datetime import datetime, timedelta, timezone
from io import BytesIO

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from backend.app.attachments import ATTACHMENTS_DIR, cleanup_expired_attachments
from backend.app.diffing import build_visual_diff
from backend.app.main import app


class TestBackendPipeline(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        root = os.path.dirname(os.path.dirname(__file__))
        self.samples_dir = os.path.join(root, "samples")

    def test_health(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_serves_built_frontend(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/html", response.headers["content-type"])
        self.assertIn("Visual Diff Tool", response.text)

    def test_analyze_png(self):
        with open(os.path.join(self.samples_dir, "gear_a.png"), "rb") as image:
            response = self.client.post("/api/analyze", files={"file": ("gear_a.png", image, "image/png")})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["page_count"], 1)
        self.assertEqual(body["pages"][0]["width"], 800)
        self.assertEqual(body["pages"][0]["height"], 600)

    def test_convert_png_suggests_anchor_regions(self):
        with open(os.path.join(self.samples_dir, "gear_a.png"), "rb") as image:
            response = self.client.post(
                "/api/convert",
                files={"file": ("gear_a.png", image, "image/png")},
                data={"page": "0"},
            )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("regions", body)
        self.assertGreater(len(body["regions"]), 0)
        first_region = body["regions"][0]
        self.assertIn("label", first_region)
        self.assertGreater(first_region["width"], 20)
        self.assertGreater(first_region["height"], 20)

    def test_convert_graph_suggests_plot_frame_region(self):
        with open(os.path.join(self.samples_dir, "bathtub_curve_a.png"), "rb") as image:
            response = self.client.post(
                "/api/convert",
                files={"file": ("bathtub_curve_a.png", image, "image/png")},
                data={"page": "0"},
            )
        self.assertEqual(response.status_code, 200)
        regions = response.json()["regions"]
        frame = next((region for region in regions if region["label"] == "枠線候補"), None)
        self.assertIsNotNone(frame)
        self.assertLess(frame["x"], 90)
        self.assertLess(frame["y"], 45)
        self.assertGreater(frame["width"], 680)
        self.assertGreater(frame["height"], 480)

    def test_attachment_upload_saves_file_and_cleanup_removes_old_files(self):
        with open(os.path.join(self.samples_dir, "gear_a.png"), "rb") as image:
            response = self.client.post("/api/attachments", files={"file": ("clipboard.png", image, "image/png")})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        saved_path = ATTACHMENTS_DIR / body["stored_as"]
        self.assertTrue(saved_path.exists())
        self.assertEqual(body["retention_days"], 3)

        old_time = (datetime.now(timezone.utc) - timedelta(days=4)).timestamp()
        os.utime(saved_path, (old_time, old_time))
        self.assertEqual(cleanup_expired_attachments(), 1)
        self.assertFalse(saved_path.exists())

    def test_diff_png_pair(self):
        with open(os.path.join(self.samples_dir, "gear_a.png"), "rb") as a, open(
            os.path.join(self.samples_dir, "gear_b.png"), "rb"
        ) as b:
            response = self.client.post(
                "/api/diff",
                files={
                    "file_a": ("gear_a.png", a, "image/png"),
                    "file_b": ("gear_b.png", b, "image/png"),
                },
                data={"page_a": "0", "page_b": "0", "category": "図面"},
            )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertGreater(body["diff_pixels"], 0)
        self.assertIn("overlay", body)
        self.assertIn("image_b_aligned", body)
        self.assertIsInstance(body["diff_rects"], list)

    def test_visual_diff_keeps_thin_line_changes(self):
        reference = np.full((80, 80, 3), 255, dtype=np.uint8)
        changed = reference.copy()
        changed[40, 10:70] = (0, 0, 0)

        diff = build_visual_diff(reference, changed, threshold=0.1)

        self.assertGreater(diff["diff_pixels"], 0)
        self.assertTrue(any(rect["width"] >= 55 and rect["height"] <= 5 for rect in diff["rects"]))

    def test_visual_diff_distinguishes_added_and_removed_ink(self):
        reference = np.full((80, 80, 3), 255, dtype=np.uint8)
        changed = reference.copy()
        reference[15:35, 15:35] = (0, 0, 0)
        changed[45:65, 45:65] = (0, 0, 0)

        diff = build_visual_diff(reference, changed, threshold=0.1)

        self.assertGreaterEqual(len(diff["rects"]), 2)

    def test_visual_diff_keeps_larger_candidate_canvas(self):
        reference = np.full((80, 100, 3), 255, dtype=np.uint8)
        changed = np.full((110, 140, 3), 255, dtype=np.uint8)
        changed[90:105, 115:135] = (0, 0, 0)

        diff = build_visual_diff(reference, changed, threshold=0.1)

        self.assertEqual(diff["overlay"].shape[:2], (110, 140))
        self.assertTrue(any(rect["x"] >= 110 and rect["y"] >= 85 for rect in diff["rects"]))

    def test_excalidraw_rasterizes_elements_outside_default_canvas(self):
        payload = {
            "type": "excalidraw",
            "elements": [
                {
                    "id": "far-rect",
                    "type": "rectangle",
                    "x": 2200,
                    "y": -500,
                    "width": 120,
                    "height": 80,
                    "strokeColor": "#000000",
                    "backgroundColor": "transparent",
                    "strokeWidth": 2,
                    "isDeleted": False,
                }
            ],
            "appState": {},
        }
        response = self.client.post(
            "/api/analyze",
            files={"file": ("far.excalidraw", BytesIO(json.dumps(payload).encode("utf-8")), "application/json")},
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["page_count"], 1)
        self.assertGreaterEqual(body["pages"][0]["width"], 260)
        self.assertGreaterEqual(body["pages"][0]["height"], 220)

    def test_diff_accepts_anchor_region(self):
        anchor_region = {"x": 0, "y": 0, "width": 800, "height": 600, "label": "全体枠候補"}
        with open(os.path.join(self.samples_dir, "gear_a.png"), "rb") as a, open(
            os.path.join(self.samples_dir, "gear_b.png"), "rb"
        ) as b:
            response = self.client.post(
                "/api/diff",
                files={
                    "file_a": ("gear_a.png", a, "image/png"),
                    "file_b": ("gear_b.png", b, "image/png"),
                },
                data={"page_a": "0", "page_b": "0", "category": "図面", "anchor_region": json.dumps(anchor_region)},
            )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["alignment"]["success"], body["alignment"]["warning"])
        self.assertIn("anchor region", body["alignment"]["method"])

    def test_diff_accepts_different_size_and_aspect_ratio_screenshots(self):
        source = Image.open(os.path.join(self.samples_dir, "gear_a.png")).convert("RGB")
        reference = source.crop((50, 50, 650, 260)).resize((584, 158))
        candidate = source.crop((30, 30, 760, 460)).resize((502, 296))

        reference_buf = BytesIO()
        candidate_buf = BytesIO()
        reference.save(reference_buf, format="PNG")
        candidate.save(candidate_buf, format="PNG")
        reference_buf.seek(0)
        candidate_buf.seek(0)

        response = self.client.post(
            "/api/diff",
            files={
                "file_a": ("reference-crop.png", reference_buf, "image/png"),
                "file_b": ("candidate-crop.png", candidate_buf, "image/png"),
            },
            data={"page_a": "0", "page_b": "0", "category": "汎用"},
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["alignment"]["success"], body["alignment"]["warning"])
        self.assertGreaterEqual(body["width"], 584)
        self.assertGreaterEqual(body["height"], 158)

    def test_diff_response_keeps_larger_unmatched_candidate_area(self):
        reference = Image.new("RGB", (100, 80), "white")
        candidate = Image.new("RGB", (140, 110), "white")
        for x in range(115, 135):
            for y in range(90, 105):
                candidate.putpixel((x, y), (0, 0, 0))

        reference_buf = BytesIO()
        candidate_buf = BytesIO()
        reference.save(reference_buf, format="PNG")
        candidate.save(candidate_buf, format="PNG")
        reference_buf.seek(0)
        candidate_buf.seek(0)

        response = self.client.post(
            "/api/diff",
            files={
                "file_a": ("small.png", reference_buf, "image/png"),
                "file_b": ("large.png", candidate_buf, "image/png"),
            },
            data={"page_a": "0", "page_b": "0", "category": "汎用"},
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["width"], 140)
        self.assertEqual(body["height"], 110)
        self.assertTrue(any(rect["x"] >= 110 and rect["y"] >= 85 for rect in body["diff_rects"]))

    def test_diff_threshold_controls_sensitivity(self):
        def request_with_threshold(value):
            with open(os.path.join(self.samples_dir, "gear_a.png"), "rb") as a, open(
                os.path.join(self.samples_dir, "gear_b.png"), "rb"
            ) as b:
                return self.client.post(
                    "/api/diff",
                    files={
                        "file_a": ("gear_a.png", a, "image/png"),
                        "file_b": ("gear_b.png", b, "image/png"),
                    },
                    data={"page_a": "0", "page_b": "0", "category": "図面", "diff_threshold": str(value)},
                ).json()

        sensitive = request_with_threshold(0.03)
        tolerant = request_with_threshold(0.4)
        self.assertEqual(sensitive["diff_threshold"], 0.03)
        self.assertEqual(tolerant["diff_threshold"], 0.4)
        self.assertGreaterEqual(sensitive["diff_pixels"], tolerant["diff_pixels"])

    def test_rediff_reuses_aligned_images_without_realigning(self):
        with open(os.path.join(self.samples_dir, "gear_a.png"), "rb") as a, open(
            os.path.join(self.samples_dir, "gear_b.png"), "rb"
        ) as b:
            response = self.client.post(
                "/api/diff",
                files={
                    "file_a": ("gear_a.png", a, "image/png"),
                    "file_b": ("gear_b.png", b, "image/png"),
                },
                data={"page_a": "0", "page_b": "0", "category": "図面", "diff_threshold": "0.03"},
            )
        self.assertEqual(response.status_code, 200)
        diff_body = response.json()
        self.assertTrue(diff_body["result_id"])

        rediff_response = self.client.post(
            "/api/rediff",
            json={
                "result_id": diff_body["result_id"],
                "diff_threshold": 0.4,
            },
        )
        self.assertEqual(rediff_response.status_code, 200)
        rediff_body = rediff_response.json()
        self.assertEqual(rediff_body["diff_threshold"], 0.4)
        self.assertLessEqual(rediff_body["diff_pixels"], diff_body["diff_pixels"])
        self.assertIn("overlay", rediff_body)
        self.assertIn("mask", rediff_body)

        fallback_response = self.client.post(
            "/api/rediff",
            json={
                "result_id": "expired",
                "image_a": diff_body["image_a"],
                "image_b_aligned": diff_body["image_b_aligned"],
                "diff_threshold": 0.4,
            },
        )
        self.assertEqual(fallback_response.status_code, 200)
        self.assertEqual(fallback_response.json()["diff_pixels"], rediff_body["diff_pixels"])
        self.assertTrue(fallback_response.json()["result_id"])

    def test_bom_alignment_stays_sane(self):
        with open(os.path.join(self.samples_dir, "bom_a.png"), "rb") as a, open(
            os.path.join(self.samples_dir, "bom_b.png"), "rb"
        ) as b:
            response = self.client.post(
                "/api/diff",
                files={
                    "file_a": ("bom_a.png", a, "image/png"),
                    "file_b": ("bom_b.png", b, "image/png"),
                },
                data={"page_a": "0", "page_b": "0", "category": "書類"},
            )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["alignment"]["success"], body["alignment"]["warning"])
        self.assertLess(body["diff_ratio"], 0.01)
        matrix = body["alignment"]["matrix"]
        self.assertIsNotNone(matrix)
        self.assertAlmostEqual(matrix[0][0], 1.0, places=2)
        self.assertAlmostEqual(matrix[1][1], 1.0, places=2)
        self.assertAlmostEqual(matrix[0][2], 0.0, delta=2.0)
        self.assertAlmostEqual(matrix[1][2], 0.0, delta=2.0)


if __name__ == "__main__":
    unittest.main()
