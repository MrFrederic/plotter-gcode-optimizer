"""Contract-focused tests for v2 API endpoints.

Validates typed request/response shapes and backward compatibility.
"""

import io
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.state import jobs

client = TestClient(app)

# Sample minimal G-code file
SAMPLE_GCODE = """\
G28
G0 Z2
G0 X10 Y10
G0 Z0
G1 X20 Y20 F1000
G1 X30 Y10
G0 Z2
G0 X50 Y50
G0 Z0
G1 X60 Y60 F1000
G1 X70 Y50
G0 Z2
"""


def _upload_gcode(endpoint: str = "/api/v2/upload"):
    """Helper to upload sample G-code and return response JSON."""
    jobs.clear()
    return client.post(
        endpoint,
        files={"file": ("test.gcode", io.BytesIO(SAMPLE_GCODE.encode()), "text/plain")},
        data={"settings": '{"z_up": 2, "z_down": 0, "feedrate": 1000}'},
    )


class TestV2Upload:
    def test_upload_returns_typed_response(self):
        resp = _upload_gcode()
        assert resp.status_code == 200
        body = resp.json()
        assert "job_id" in body
        assert "paths" in body
        assert "path_count" in body
        assert "settings" in body
        assert "source" in body
        assert body["source"] == "gcode"
        assert isinstance(body["paths"], list)
        assert body["path_count"] == len(body["paths"])

    def test_upload_settings_shape(self):
        resp = _upload_gcode()
        body = resp.json()
        settings = body["settings"]
        assert "z_up" in settings
        assert "z_down" in settings
        assert "feedrate" in settings
        assert "pen_width" in settings
        assert "merge_threshold" in settings
        assert "gcode_header" in settings
        assert "gcode_footer" in settings

    def test_upload_paths_point_shape(self):
        resp = _upload_gcode()
        body = resp.json()
        for path in body["paths"]:
            assert isinstance(path, list)
            for point in path:
                assert "x" in point
                assert "y" in point
                assert isinstance(point["x"], (int, float))
                assert isinstance(point["y"], (int, float))


class TestV2JobStatus:
    def test_get_job_exists(self):
        resp = _upload_gcode()
        job_id = resp.json()["job_id"]
        status_resp = client.get(f"/api/v2/job/{job_id}")
        assert status_resp.status_code == 200
        body = status_resp.json()
        assert body["job_id"] == job_id
        assert body["status"] == "uploaded"
        assert "path_count" in body
        assert "settings" in body

    def test_get_job_not_found(self):
        jobs.clear()
        resp = client.get("/api/v2/job/nonexistent-id")
        assert resp.status_code == 404


class TestV2Download:
    def test_download_not_completed(self):
        resp = _upload_gcode()
        job_id = resp.json()["job_id"]
        dl = client.get(f"/api/v2/download/{job_id}")
        assert dl.status_code == 400

    def test_download_not_found(self):
        jobs.clear()
        resp = client.get("/api/v2/download/nonexistent-id")
        assert resp.status_code == 404


class TestV2SettingsSchema:
    def test_schema_endpoint(self):
        resp = client.get("/api/v2/settings/schema")
        assert resp.status_code == 200
        schema = resp.json()
        assert "properties" in schema
        props = schema["properties"]
        assert "z_up" in props
        assert "feedrate" in props
        assert "pen_width" in props


class TestLegacyBackwardCompatibility:
    """Verify existing v1 endpoints still work."""

    def test_legacy_upload(self):
        jobs.clear()
        resp = client.post(
            "/upload",
            files={"file": ("test.gcode", io.BytesIO(SAMPLE_GCODE.encode()), "text/plain")},
            data={"settings": '{"z_up": 2, "z_down": 0}'},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "job_id" in body
        assert "paths" in body

    def test_legacy_download_not_found(self):
        jobs.clear()
        resp = client.get("/download/nonexistent-id")
        assert resp.status_code == 200  # Legacy returns JSON error, not 404
        body = resp.json()
        assert "error" in body

    def test_legacy_root_serves_html(self):
        resp = client.get("/")
        assert resp.status_code == 200
        assert "PLOTTERTOOL" in resp.text
