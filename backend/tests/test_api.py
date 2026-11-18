"""Integration tests for FastAPI endpoints and diagnostic observability."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from pricepulse.adapters.gemini_search_fallback import GeminiSearchFallbackClient
from pricepulse.adapters.local_json import (
    DeterministicScraperAdapter,
    InMemoryNotificationAdapter,
    LocalJsonRepository,
)
from pricepulse.api.app import create_app
from pricepulse.domain.models import (
    BatchPreviewOutcome,
    ScrapeOutcome,
    ScrapePreview,
    TrackedItem,
)


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
    assert body["app_version"] == "0.5.0"
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


def test_batch_preview_and_batch_create_items(tmp_path: Path) -> None:
    """Verify /api/scrape/preview-batch and /api/items/batch handle mixed results."""
    client = _make_client(tmp_path)

    batch_preview = client.post(
        "/api/scrape/preview-batch",
        json={
            "urls": [
                "https://example.com/products/desk-lamp",
                "https://example.com/products/fail-403",
                "https://example.com/products/usb-hub",
            ]
        },
    )
    assert batch_preview.status_code == 200
    results = batch_preview.json()["results"]
    assert len(results) == 3
    assert results[0]["success"] is True
    assert results[0]["preview"]["title"] == "Desk Lamp"
    assert results[1]["success"] is False
    assert "403" in results[1]["error"]
    assert results[2]["success"] is True
    assert results[2]["preview"]["title"] == "Usb Hub"

    create_resp = client.post(
        "/api/items/batch",
        json={
            "items": [
                {
                    "name": "Desk Lamp",
                    "url": "https://example.com/products/desk-lamp",
                    "image_url": "",
                    "currency": "$",
                    "initial_price": 149.99,
                    "target_price": 127.49,
                    "tag_names": ["Workstation", "BatchImport"],
                },
                {
                    "name": "Usb Hub",
                    "url": "https://example.com/products/usb-hub",
                    "image_url": "",
                    "currency": "$",
                    "initial_price": 199.99,
                    "target_price": 169.99,
                    "tag_names": ["BatchImport"],
                },
            ]
        },
    )
    assert create_resp.status_code == 200
    created_items = create_resp.json()["items"]
    assert len(created_items) == 2

    state_resp = client.get("/api/state")
    assert state_resp.status_code == 200
    state_body = state_resp.json()
    assert len(state_body["items"]) == 5
    created_ids = {item["item_id"] for item in created_items}
    initial_snaps = [
        snap
        for snap in state_body["price_history"]
        if snap["item_id"] in created_ids and snap["event_type"] == "INITIAL"
    ]
    assert len(initial_snaps) == 2


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


def test_google_oauth_verifies_client_id_and_allows_test_users(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify google_oauth mode checks client_id and allows Console test users."""
    import httpx

    monkeypatch.setenv("AUTH_MODE", "google_oauth")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "pricepulse-client.apps.googleusercontent.com")
    monkeypatch.delenv("ALLOWED_OWNER_EMAIL", raising=False)
    client = _make_client(tmp_path)

    assert client.get("/api/state").status_code == 401

    class _FakeResp:
        def __init__(self, status_code: int, payload: dict[str, str]) -> None:
            self.status_code = status_code
            self._payload = payload

        def json(self) -> dict[str, str]:
            return self._payload

    monkeypatch.setattr(
        httpx,
        "get",
        lambda *_a, **_kw: _FakeResp(
            200,
            {"email": "tester@gmail.com", "aud": "wrong-client.apps.googleusercontent.com"},
        ),
    )
    assert client.get("/api/state", headers={"Authorization": "Bearer tok"}).status_code == 403

    monkeypatch.setattr(
        httpx,
        "get",
        lambda *_a, **_kw: _FakeResp(
            200,
            {
                "email": "tester@gmail.com",
                "aud": "pricepulse-client.apps.googleusercontent.com",
            },
        ),
    )
    assert client.get("/api/state", headers={"Authorization": "Bearer tok"}).status_code == 200


def test_default_cors_allows_github_pages_origin(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify default CORS policy allows https://meksico.github.io."""
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    client = _make_client(tmp_path)
    origin = "https://meksico.github.io"
    preflight = client.options(
        "/api/state",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers.get("access-control-allow-origin") == origin

    health_resp = client.get("/api/health", headers={"Origin": origin})
    assert health_resp.status_code == 200
    assert health_resp.headers.get("access-control-allow-origin") == origin


def test_captcha_blocked_preview_returns_422_and_manual_price_update(
    tmp_path: Path,
) -> None:
    """Verify CaptchaBlockedError maps to HTTP 422 and PATCH supports current_price."""
    from pricepulse.adapters.playwright_scraper import CaptchaBlockedError

    class CaptchaScraper:
        async def preview_url(self, url: str) -> Any:
            raise CaptchaBlockedError(f"CAPTCHA_BLOCKED (HTTP 403): {url}")

        async def preview_urls(self, urls: list[str]) -> list[Any]:
            return []

        async def run_check(self, items: list[Any]) -> list[Any]:
            return []

    repo = LocalJsonRepository(tmp_path / "state.json")
    app = create_app(repo=repo, scraper=CaptchaScraper(), notifier=InMemoryNotificationAdapter())
    client = TestClient(app)

    resp = client.post("/api/scrape/preview", json={"url": "https://kaplya.com.ua/p"})
    assert resp.status_code == 422
    assert "CAPTCHA_BLOCKED" in resp.json()["detail"]

    item = repo.load_state().items[0]
    patch_resp = client.patch(
        f"/api/items/{item.item_id}",
        json={"current_price": 123.45},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["current_price"] == 123.45
    snaps = [s for s in repo.load_state().price_history if s.item_id == item.item_id]
    assert any(s.event_type == "MANUAL" and s.price == 123.45 for s in snaps)

    # Saving the exact same current_price still records a MANUAL snapshot
    prev_count = len([s for s in repo.load_state().price_history if s.item_id == item.item_id])
    same_resp = client.patch(
        f"/api/items/{item.item_id}",
        json={"current_price": 123.45},
    )
    assert same_resp.status_code == 200
    new_count = len([s for s in repo.load_state().price_history if s.item_id == item.item_id])
    assert new_count == prev_count + 1


def test_daily_captcha_report_sent_once_per_day(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify run-check dispatches CAPTCHA report once per day with deduplication."""
    from pricepulse.domain.models import ConfigEntry, ScrapeOutcome

    monkeypatch.setenv("ALLOWED_OWNER_EMAIL", "owner@example.com")
    monkeypatch.setenv("FRONTEND_BASE_URL", "https://meksico.github.io/price-pulse")

    class CaptchaCheckScraper:
        async def preview_url(self, url: str) -> Any:
            raise ValueError("unused")

        async def preview_urls(self, urls: list[str]) -> list[Any]:
            return []

        async def check_items(self, items: list[Any]) -> list[ScrapeOutcome]:
            return [
                ScrapeOutcome(
                    item_id=items[0].item_id,
                    success=False,
                    error=f"CAPTCHA_BLOCKED (HTTP 403): {items[0].url}",
                )
            ]

    repo = LocalJsonRepository(tmp_path / "state.json")
    seed_state = repo.load_state()
    repo.update_item(seed_state.items[0].item_id, tag_names=["manual check"])
    repo.save_config([ConfigEntry(key="gmail_alert_recipient", value="owner@example.com")])
    notifier = InMemoryNotificationAdapter()
    app = create_app(repo=repo, scraper=CaptchaCheckScraper(), notifier=notifier)
    client = TestClient(app)

    first = client.post("/api/scrape/run-check")
    assert first.status_code == 200
    assert first.json()["captcha_report_sent"] is True
    assert len(notifier.sent_captcha_reports) == 1
    assert notifier.sent_captcha_reports[0][2] == "https://meksico.github.io/price-pulse"
    updated = repo.load_state()
    manual_tag = next((t for t in updated.tags if t.name.lower() == "manual check"), None)
    assert manual_tag is None

    second = client.post("/api/scrape/run-check")
    assert second.status_code == 200
    assert second.json()["captcha_report_sent"] is False
    assert len(notifier.sent_captcha_reports) == 1


def test_gemini_fallback_recovers_captcha_preview_and_tracks_usage(
    tmp_path: Path,
) -> None:
    """Verify Gemini fallback recovers 422 CAPTCHA preview and increments Config."""
    import httpx

    from pricepulse.adapters.gemini_search_fallback import GeminiSearchFallbackClient
    from pricepulse.adapters.playwright_scraper import CaptchaBlockedError
    from pricepulse.domain.models import utc_now_iso

    class CaptchaScraper:
        async def preview_url(self, url: str) -> Any:
            raise CaptchaBlockedError(f"CAPTCHA_BLOCKED (HTTP 403): {url}")

        async def preview_urls(self, urls: list[str]) -> list[Any]:
            return []

        async def check_items(self, items: list[Any]) -> list[Any]:
            return []

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": (
                                        '{"price": 800, "currency": "PLN", '
                                        '"title": "Cashmere Jumper"}'
                                    )
                                }
                            ]
                        },
                        "groundingMetadata": {
                            "webSearchQueries": ["cos.com 1288193001 price"],
                        },
                    }
                ]
            },
        )

    repo = LocalJsonRepository(tmp_path / "state.json")
    gemini = GeminiSearchFallbackClient(
        api_key="test-key",
        monthly_cap=4500,
        transport=httpx.MockTransport(handler),
    )
    app = create_app(
        repo=repo,
        scraper=CaptchaScraper(),
        notifier=InMemoryNotificationAdapter(),
        gemini_fallback=gemini,
    )
    client = TestClient(app)

    resp = client.post(
        "/api/scrape/preview",
        json={"url": "https://www.cos.com/pl-pl/product/1288193001"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["price"] == 800.0
    assert body["currency"] == "zł"
    assert body["title"] == "Cashmere Jumper"

    current_month = utc_now_iso()[:7]
    usage = next(
        (c.value for c in repo.load_state().config if c.key == "gemini_grounding_usage"),
        "",
    )
    assert usage == f"{current_month}:1"


def test_gemini_fallback_batch_respects_cooldown_and_monthly_cap(
    tmp_path: Path,
) -> None:
    """Verify batch fallback skips cooling-down items and stops at monthly cap."""
    from pricepulse.adapters.gemini_search_fallback import GeminiSearchResult
    from pricepulse.domain.models import ConfigEntry, ScrapeOutcome, utc_now_iso

    class FakeGeminiClient:
        def __init__(self, monthly_cap: int, cooldown_hours: int) -> None:
            self.calls = 0
            self.monthly_cap = monthly_cap
            self.cooldown_hours = cooldown_hours

        @property
        def is_enabled(self) -> bool:
            return self.monthly_cap > 0

        async def extract_price(
            self,
            url: str,
            title: str = "",
            currency_hint: str = "",
        ) -> GeminiSearchResult | None:
            self.calls += 1
            return GeminiSearchResult(
                price=550.0,
                currency=currency_hint or "zł",
                title=title or "Item",
                queries_used=1,
            )

    class CaptchaBatchScraper:
        async def preview_url(self, url: str) -> Any:
            raise ValueError("unused")

        async def preview_urls(self, urls: list[str]) -> list[Any]:
            return []

        async def check_items(self, items: list[Any]) -> list[ScrapeOutcome]:
            return [
                ScrapeOutcome(
                    item_id=item.item_id,
                    success=False,
                    error=f"CAPTCHA_BLOCKED (HTTP 403): {item.url}",
                )
                for item in items
            ]

    repo = LocalJsonRepository(tmp_path / "state.json")
    current_month = utc_now_iso()[:7]
    # Seed items: default seed items have recent last_checked (<48h), so set one stale
    state = repo.load_state()
    stale_item = state.items[0]
    stale_item.last_checked = "2020-01-01T00:00:00Z"
    repo._persist()  # noqa: SLF001

    # Cap at 1 query so only the 1 stale item runs, and recent items are skipped by cooldown
    gemini = FakeGeminiClient(monthly_cap=1, cooldown_hours=48)
    app = create_app(
        repo=repo,
        scraper=CaptchaBatchScraper(),
        notifier=InMemoryNotificationAdapter(),
        gemini_fallback=gemini,  # type: ignore[arg-type]
    )
    client = TestClient(app)

    resp = client.post("/api/cron/run-check")
    assert resp.status_code == 200
    assert gemini.calls == 1

    # Second run: cap is now 1/1, so even stale items must not trigger Gemini
    repo.save_config([ConfigEntry(key="gemini_grounding_usage", value=f"{current_month}:1")])
    resp2 = client.post("/api/cron/run-check")
    assert resp2.status_code == 200
    assert gemini.calls == 1


def test_http_403_preview_triggers_gemini_fallback_and_maps_to_422_without_key(
    tmp_path: Path,
) -> None:
    """Verify generic HTTP 403 triggers Gemini fallback (or 422 instead of 502)."""
    import httpx

    from pricepulse.adapters.gemini_search_fallback import GeminiSearchFallbackClient

    class Forbidden403Scraper:
        async def preview_url(self, url: str) -> Any:
            raise ValueError(f"HTTP 403 for URL: {url}")

        async def preview_urls(self, urls: list[str]) -> list[Any]:
            return []

        async def check_items(self, items: list[Any]) -> list[Any]:
            return []

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": (
                                        '{"price": 900, "currency": "PLN", '
                                        '"title": "Trullo Flap Bag"}'
                                    )
                                }
                            ]
                        },
                    }
                ]
            },
        )

    repo = LocalJsonRepository(tmp_path / "state.json")
    gemini = GeminiSearchFallbackClient(
        api_key="test-key",
        transport=httpx.MockTransport(handler),
    )
    app = create_app(
        repo=repo,
        scraper=Forbidden403Scraper(),
        notifier=InMemoryNotificationAdapter(),
        gemini_fallback=gemini,
    )
    client = TestClient(app)

    ok_resp = client.post(
        "/api/scrape/preview",
        json={"url": "https://www.cos.com/pl-pl/product/trullo-flap-bag-1349970001"},
    )
    assert ok_resp.status_code == 200
    assert ok_resp.json()["price"] == 900.0
    assert ok_resp.json()["currency"] == "zł"

    # Without Gemini enabled, HTTP 403 returns 422 (never 502 retry storm)
    app_no_key = create_app(
        repo=repo,
        scraper=Forbidden403Scraper(),
        notifier=InMemoryNotificationAdapter(),
        gemini_fallback=GeminiSearchFallbackClient(api_key=""),
    )
    resp_422 = TestClient(app_no_key).post(
        "/api/scrape/preview",
        json={"url": "https://www.cos.com/pl-pl/product/trullo-flap-bag-1349970001"},
    )
    assert resp_422.status_code == 422


def test_single_item_recheck_updates_price_and_bypasses_cooldown(tmp_path: Path) -> None:
    """Verify POST /api/items/{item_id}/recheck checks one item and bypasses 48h cooldown."""

    class Forbidden403Scraper:
        async def preview_url(self, url: str) -> ScrapePreview:
            raise ValueError(f"HTTP 403 for URL: {url}")

        async def preview_urls(self, urls: list[str]) -> list[BatchPreviewOutcome]:
            return []

        async def check_items(self, items: list[TrackedItem]) -> list[ScrapeOutcome]:
            return [
                ScrapeOutcome(
                    item_id=item.item_id,
                    success=False,
                    error=f"{item.item_id} ({item.url}): HTTP 403",
                )
                for item in items
            ]

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": (
                                        '{"price": 800, "currency": "PLN", '
                                        '"title": "Cashmere Crew-Neck Jumper"}'
                                    )
                                }
                            ]
                        },
                    }
                ]
            },
        )

    repo = LocalJsonRepository(tmp_path / "state.json")
    created = repo.add_item(
        url="https://www.cos.com/pl-pl/product/cashmere-1288193001",
        name="Cashmere Crew-Neck Jumper",
        initial_price=1150.0,
        target_price=900.0,
        currency="zł",
        image_url="",
        tag_names=["Knitwear"],
    )
    gemini = GeminiSearchFallbackClient(
        api_key="test-key",
        cooldown_hours=48,
        transport=httpx.MockTransport(handler),
    )
    app = create_app(
        repo=repo,
        scraper=Forbidden403Scraper(),
        notifier=InMemoryNotificationAdapter(),
        gemini_fallback=gemini,
    )
    client = TestClient(app)

    resp = client.post(f"/api/items/{created.item_id}/recheck")
    assert resp.status_code == 200
    body = resp.json()
    assert body["item"]["current_price"] == 800.0
    assert body["item"]["status"] == "DISCOUNT"
    assert body["telemetry"]["items_checked"] == 1
    assert client.post("/api/items/item-missing/recheck").status_code == 404


def test_bulk_tags_recheck_and_delete(tmp_path: Path) -> None:
    """Verify bulk-tags (add/replace/remove), bulk-recheck, and bulk-delete."""
    client = _make_client(tmp_path)
    state = client.get("/api/state").json()
    active_ids = [it["item_id"] for it in state["items"][:2]]
    assert len(active_ids) == 2

    # 1. Bulk add tag (including auto-creating a new tag)
    add_resp = client.post(
        "/api/items/bulk-tags",
        json={
            "item_ids": active_ids,
            "action": "add",
            "tag_names": ["Wishlist"],
        },
    )
    assert add_resp.status_code == 200
    updated_items = add_resp.json()["items"]
    assert len(updated_items) == 2

    state_after_add = client.get("/api/state").json()
    wishlist_tag = next(
        (t for t in state_after_add["tags"] if t["name"] == "Wishlist"),
        None,
    )
    assert wishlist_tag is not None
    for it in state_after_add["items"]:
        if it["item_id"] in active_ids:
            assert wishlist_tag["tag_id"] in it["tag_ids"]

    # 2. Bulk remove tag
    rem_resp = client.post(
        "/api/items/bulk-tags",
        json={
            "item_ids": active_ids,
            "action": "remove",
            "tag_names": ["Wishlist"],
        },
    )
    assert rem_resp.status_code == 200
    state_after_rem = client.get("/api/state").json()
    for it in state_after_rem["items"]:
        if it["item_id"] in active_ids:
            assert wishlist_tag["tag_id"] not in it["tag_ids"]

    # 3. Bulk replace tags
    rep_resp = client.post(
        "/api/items/bulk-tags",
        json={
            "item_ids": active_ids,
            "action": "replace",
            "tag_names": ["Priority"],
        },
    )
    assert rep_resp.status_code == 200
    state_after_rep = client.get("/api/state").json()
    priority_tag = next(
        t for t in state_after_rep["tags"] if t["name"] == "Priority"
    )
    for it in state_after_rep["items"]:
        if it["item_id"] in active_ids:
            assert it["tag_ids"] == [priority_tag["tag_id"]]

    # 4. Bulk re-check
    recheck_resp = client.post(
        "/api/items/bulk-recheck",
        json={"item_ids": active_ids},
    )
    assert recheck_resp.status_code == 200
    assert recheck_resp.json()["telemetry"]["items_checked"] == 2
    assert (
        client.post(
            "/api/items/bulk-recheck",
            json={"item_ids": ["item-missing"]},
        ).status_code
        == 404
    )

    # 5. Bulk delete (mix of active + bought)
    bought_id = state_after_rep["bought_items"][0]["item_id"]
    del_resp = client.post(
        "/api/items/bulk-delete",
        json={"item_ids": [active_ids[0], bought_id]},
    )
    assert del_resp.status_code == 200
    assert set(del_resp.json()["deleted_ids"]) == {active_ids[0], bought_id}
    final_state = client.get("/api/state").json()
    remaining_ids = {
        *(it["item_id"] for it in final_state["items"]),
        *(b["item_id"] for b in final_state["bought_items"]),
    }
    assert active_ids[0] not in remaining_ids
    assert bought_id not in remaining_ids
    assert all(
        link["item_id"] not in {active_ids[0], bought_id}
        for link in final_state["item_tags"]
    )


def test_resources_inventory_masks_secrets_and_aggregates_webshare(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify /api/resources aggregates all providers and never leaks secrets."""
    monkeypatch.setenv("WEBSHARE_API_KEY", "ws-secret-xyz")
    monkeypatch.setenv("GEMINI_API_KEY", "gem-secret-abc")
    monkeypatch.setenv("SCRAPER_PROXY_URL", "198.51.100.1:8080:proxyuser:proxypass")

    async def _fake_webshare(
        api_key: str,
        client: httpx.AsyncClient | None = None,
        *,
        force_refresh: bool = False,
    ) -> dict[str, Any]:
        _ = force_refresh
        assert api_key == "ws-secret-xyz"
        assert client is not None
        return {
            "subscription": {
                "bandwidth_limit": 1.0,
                "proxy_limit": 10,
                "plan_type": "free",
                "end_date": "2026-12-01T00:00:00Z",
            },
            "stats": {
                "bandwidth_total": 52_428_800,  # 50 MB
                "requests_total": 120,
                "requests_successful": 115,
                "requests_failed": 5,
                "number_of_proxies_used": 8,
                "last_request_sent_at": "2026-11-18T14:00:00Z",
            },
            "transactions": [
                {
                    "id": "tx-001",
                    "amount": 0.0,
                    "currency": "USD",
                    "status": "completed",
                    "reason": "Free Tier Monthly Renewal",
                    "created_at": "2026-11-14T16:29:15Z",
                }
            ],
        }

    monkeypatch.setattr("pricepulse.diagnostics.fetch_webshare_telemetry", _fake_webshare)

    client = _make_client(tmp_path)
    resp = client.get("/api/resources")
    assert resp.status_code == 200
    raw_text = resp.text
    assert "ws-secret-xyz" not in raw_text
    assert "gem-secret-abc" not in raw_text
    assert "proxyuser" not in raw_text
    assert "proxypass" not in raw_text

    body = resp.json()
    assert body["probed"] is False
    assert "fastapi" in body["backend_packages"]
    by_id = {r["resource_id"]: r for r in body["resources"]}
    assert set(by_id.keys()) >= {
        "google_sheets",
        "gmail_api",
        "google_oauth",
        "gemini_grounding",
        "webshare_proxies",
        "playwright_chromium",
    }

    ws = by_id["webshare_proxies"]
    assert ws["mode"] == "live"
    assert ws["status"] == "operational"
    assert ws["quota_used"] == 50.0
    assert ws["quota_limit"] == 1024.0
    assert ws["quota_unit"] == "MB"
    assert ws["details"]["proxy_pool_count"] == 1
    assert ws["details"]["proxy_hosts"] == ["198.51.100.1:8080"]
    assert ws["details"]["requests_successful"] == 115
    assert body["total_charges_usd"] == 0.0
    assert len(body["charges"]) == 1
    assert body["charges"][0]["charge_id"] == "tx-001"


def test_resources_probe_handles_fault_isolation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify POST /api/resources/probe isolates provider failures cleanly."""
    monkeypatch.setenv("WEBSHARE_API_KEY", "ws-secret-xyz")
    monkeypatch.setenv("GEMINI_API_KEY", "gem-secret-abc")

    async def _failing_webshare(
        _api_key: str,
        client: httpx.AsyncClient | None = None,
        *,
        force_refresh: bool = False,
    ) -> dict[str, Any]:
        _ = force_refresh
        raise RuntimeError("Webshare upstream timeout")

    async def _ok_gemini(
        _api_key: str,
        _model: str,
        _client: httpx.AsyncClient,
    ) -> bool:
        return True

    monkeypatch.setattr("pricepulse.diagnostics.fetch_webshare_telemetry", _failing_webshare)
    monkeypatch.setattr("pricepulse.diagnostics._probe_gemini", _ok_gemini)

    client = _make_client(tmp_path)
    resp = client.post("/api/resources/probe")
    assert resp.status_code == 200
    body = resp.json()
    assert body["probed"] is True
    by_id = {r["resource_id"]: r for r in body["resources"]}
    assert by_id["webshare_proxies"]["status"] == "warning"
    assert "Webshare upstream timeout" in (by_id["webshare_proxies"]["error"] or "")
    assert by_id["gemini_grounding"]["status"] == "operational"
    assert by_id["gemini_grounding"]["details"]["probe_verified"] is True


def test_resources_aggregates_gcp_bigquery_billing_charges(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify GCP BigQuery Billing Export charges populate Gemini, Cloud Run, and ledger."""
    monkeypatch.setenv("GCP_BILLING_PROJECT_ID", "pricepulse-514709")

    async def _fake_gcp_billing(
        client: httpx.AsyncClient | None = None,
        *,
        force_refresh: bool = False,
    ) -> dict[str, Any]:
        _ = (client, force_refresh)
        return {
            "status": "active",
            "invoice_month": "202611",
            "services": [
                {
                    "service_name": "Cloud Run",
                    "gross_cost": 0.27,
                    "credits_amount": -0.24,
                    "net_cost": 0.03,
                    "currency": "USD",
                },
                {
                    "service_name": "Gemini API",
                    "gross_cost": 0.02,
                    "credits_amount": 0.0,
                    "net_cost": 0.02,
                    "currency": "USD",
                },
            ],
        }

    monkeypatch.setattr("pricepulse.diagnostics.fetch_gcp_billing_charges", _fake_gcp_billing)

    client = _make_client(tmp_path)
    resp = client.get("/api/resources")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_charges_usd"] == 0.05
    assert len(body["charges"]) == 2
    by_id = {r["resource_id"]: r for r in body["resources"]}
    assert by_id["cloud_run"]["monthly_cost_usd"] == 0.03
    assert by_id["gemini_grounding"]["monthly_cost_usd"] == 0.02


def test_allowed_owner_email_drives_all_report_recipients(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify ALLOWED_OWNER_EMAIL is the single source of truth for all report recipients."""
    from pricepulse.domain.models import ConfigEntry, ScrapeOutcome

    monkeypatch.setenv(
        "ALLOWED_OWNER_EMAIL",
        "owner@example.com, partner@example.com, OWNER@example.com",
    )

    class DiscountAndCaptchaScraper:
        async def preview_url(self, url: str) -> Any:
            raise ValueError("unused")

        async def preview_urls(self, urls: list[str]) -> list[Any]:
            return []

        async def check_items(self, items: list[Any]) -> list[ScrapeOutcome]:
            outcomes: list[ScrapeOutcome] = []
            for idx, item in enumerate(items):
                if idx == 0:
                    outcomes.append(
                        ScrapeOutcome(
                            item_id=item.item_id,
                            success=True,
                            price=round(min(item.target_price, item.lowest_price) - 10.0, 2),
                        )
                    )
                elif idx == 1:
                    outcomes.append(
                        ScrapeOutcome(
                            item_id=item.item_id,
                            success=False,
                            error=f"CAPTCHA_BLOCKED (HTTP 403): {item.url}",
                        )
                    )
                else:
                    outcomes.append(
                        ScrapeOutcome(
                            item_id=item.item_id,
                            success=True,
                            price=item.current_price,
                        )
                    )
            return outcomes

    repo = LocalJsonRepository(tmp_path / "state.json")
    repo.save_config([ConfigEntry(key="gmail_alert_recipient", value="stale@example.com")])
    notifier = InMemoryNotificationAdapter()
    app = create_app(repo=repo, scraper=DiscountAndCaptchaScraper(), notifier=notifier)
    client = TestClient(app)

    cron_resp = client.post("/api/cron/run-check")
    assert cron_resp.status_code == 200
    assert cron_resp.json()["digest_sent"] is True
    assert cron_resp.json()["captcha_report_sent"] is True
    assert notifier.sent_digests[0][0] == "owner@example.com, partner@example.com"
    assert notifier.sent_captcha_reports[0][0] == "owner@example.com, partner@example.com"

    res_resp = client.get("/api/resources")
    assert res_resp.status_code == 200
    gmail_res = next(
        r for r in res_resp.json()["resources"] if r["resource_id"] == "gmail_api"
    )
    assert gmail_res["details"]["alert_recipient"] == "owner@example.com, partner@example.com"





