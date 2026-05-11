import os
import unittest

from fastapi.testclient import TestClient

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
