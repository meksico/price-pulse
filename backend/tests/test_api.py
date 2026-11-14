"""Integration tests for FastAPI endpoints and diagnostic observability."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pricepulse.adapters.local_json import (
    DeterministicScraperAdapter,
    InMemoryNotificationAdapter,
    LocalJsonRepository,
)
from pricepulse.api.app import create_app


def _make_client(tmp_path: Path) -> TestClient:
    """Build a TestClient backed by an isolated temporary JSON state."""
    repo = LocalJsonRepository(tmp_path / "api_state.json")
    app = create_app(
        repo=repo,
        scraper=DeterministicScraperAdapter(),
        notifier=InMemoryNotificationAdapter(),
    )
    return TestClient(app)


def test_health_exposes_runtime_diagnostics(tmp_path: Path) -> None:
    """Verify /api/health exposes full REQ-DIAG-01 runtime context."""
    client = _make_client(tmp_path)
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["app_version"] == "0.2.1"
    assert body["python_executable"]
    assert body["python_version"]
    assert body["platform"]
    assert body["workspace_dir"]
    assert "fastapi" in body["dependency_versions"]


def test_preview_and_run_check_flow(tmp_path: Path) -> None:
    """Verify URL preview and batch run-check append telemetry."""
    client = _make_client(tmp_path)
    preview = client.post(
        "/api/scrape/preview",
        json={"url": "https://example.com/sony-xm5"},
    )
    assert preview.status_code == 200
    assert preview.json()["price"] == 149.99

    run_resp = client.post("/api/scrape/run-check")
    assert run_resp.status_code == 200
    assert run_resp.json()["telemetry"]["status"] == "SUCCESS"
    assert run_resp.json()["telemetry"]["items_checked"] == 3


def test_spa_fallback_serves_index_and_preserves_api_404(tmp_path: Path) -> None:
    """Verify non-API routes fall back to index.html while /api/* returns 404."""
    dist_dir = tmp_path / "dist"
    assets_dir = dist_dir / "assets"
    assets_dir.mkdir(parents=True)
    (dist_dir / "index.html").write_text("<html><body>PricePulse SPA</body></html>")
    (assets_dir / "app.js").write_text("console.log('ok');")

    repo = LocalJsonRepository(tmp_path / "spa_state.json")
    app = create_app(
        repo=repo,
        scraper=DeterministicScraperAdapter(),
        notifier=InMemoryNotificationAdapter(),
        frontend_dist_dir=dist_dir,
    )
    client = TestClient(app)

    for route in ("/", "/tags", "/items/item-1", "/items/new"):
        resp = client.get(route)
        assert resp.status_code == 200
        assert "PricePulse SPA" in resp.text

    asset_resp = client.get("/assets/app.js")
    assert asset_resp.status_code == 200
    assert "console.log('ok');" in asset_resp.text

    api_404 = client.get("/api/nonexistent")
    assert api_404.status_code == 404


def test_cron_run_check_enforces_secret(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify /api/cron/run-check requires X-Cron-Secret when CRON_SECRET is set."""
    monkeypatch.setenv("CRON_SECRET", "top-secret-cron-token")
    client = _make_client(tmp_path)
    forbidden = client.post("/api/cron/run-check")
    assert forbidden.status_code == 403

    wrong = client.post("/api/cron/run-check", headers={"X-Cron-Secret": "wrong"})
    assert wrong.status_code == 403

    allowed = client.post(
        "/api/cron/run-check",
        headers={"X-Cron-Secret": "top-secret-cron-token"},
    )
    assert allowed.status_code == 200
    assert allowed.json()["telemetry"]["status"] == "SUCCESS"

