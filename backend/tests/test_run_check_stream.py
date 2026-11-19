"""Unit tests for streaming Run Check SSE endpoint and progress callbacks."""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from pricepulse.adapters.local_json import (
    InMemoryNotificationAdapter,
    LocalJsonRepository,
)
from pricepulse.adapters.playwright_scraper import check_items_pooled
from pricepulse.api.app import create_app
from pricepulse.domain.models import (
    ScrapeOutcome,
    ScrapePreview,
    TrackedItem,
)


class _MixedOutcomeScraper:
    """Fake scraper emitting mixed success and HTTP 403 outcomes with progress."""

    async def preview_url(self, url: str) -> ScrapePreview:
        """Return a minimal preview."""
        return ScrapePreview(
            url=url,
            title="Item",
            price=100.0,
            currency="$",
            image_url="",
            extraction_tier="TIER_1_JSON_LD",
        )

    async def preview_urls(self, urls: list[str]) -> list[Any]:
        """Return empty batch previews."""
        return []

    async def check_items(
        self,
        items: list[TrackedItem],
        on_progress: Callable[[ScrapeOutcome], Awaitable[None]] | None = None,
    ) -> list[ScrapeOutcome]:
        """Emit one success and one 403 failure."""
        outcomes: list[ScrapeOutcome] = []
        for idx, item in enumerate(items):
            if idx % 2 == 1:
                outcome = ScrapeOutcome(
                    item_id=item.item_id,
                    success=False,
                    error=f"{item.item_id} ({item.url}): attempt 1: HTTP 403 Forbidden",
                )
            else:
                outcome = ScrapeOutcome(
                    item_id=item.item_id,
                    success=True,
                    price=round(max(1.0, item.current_price - 10.0), 2),
                    currency=item.currency,
                    extraction_tier="TIER_1_JSON_LD",
                )
            outcomes.append(outcome)
            if on_progress is not None:
                await on_progress(outcome)
        return outcomes


def _parse_sse_events(body: str) -> list[dict[str, Any]]:
    """Parse SSE data lines into JSON dicts."""
    events: list[dict[str, Any]] = []
    for line in body.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[6:]))
    return events


def test_run_check_stream_emits_started_items_phases_and_complete(tmp_path: Path) -> None:
    """Verify POST /api/scrape/run-check/stream emits full SSE lifecycle."""
    repo = LocalJsonRepository(tmp_path / "stream_state.json")
    item_ok = repo.add_item(
        name="Merino Sweater",
        url="https://www.cos.com/en/sweater.html",
        image_url="",
        currency="PLN",
        initial_price=400.0,
        target_price=350.0,
        tag_names=[],
    )
    item_err = repo.add_item(
        name="Dyson Airstrait",
        url="https://glowtech.com.ua/dyson-ht01",
        image_url="",
        currency="UAH",
        initial_price=20000.0,
        target_price=18000.0,
        tag_names=[],
    )
    app = create_app(
        repo=repo,
        scraper=_MixedOutcomeScraper(),
        notifier=InMemoryNotificationAdapter(),
    )
    client = TestClient(app)

    resp = client.post("/api/scrape/run-check/stream")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")

    events = _parse_sse_events(resp.text)
    types = [ev["type"] for ev in events]
    assert types[0] == "started"
    assert types[-1] == "complete"
    assert "item_done" in types
    assert "phase" in types

    started = events[0]
    total_count = len(repo.load_state().items)
    assert started["total"] == total_count
    by_id = {it["item_id"]: it for it in started["items"]}
    assert by_id[item_ok.item_id]["domain"] == "cos.com"
    assert by_id[item_err.item_id]["domain"] == "glowtech.com.ua"

    item_events = [ev for ev in events if ev["type"] == "item_done"]
    assert len(item_events) == total_count
    assert item_events[0]["success"] is True
    assert item_events[0]["completed"] == 1
    assert item_events[1]["success"] is False
    assert item_events[1]["error_code"] == "403"
    assert item_events[-1]["completed"] == total_count

    complete = events[-1]
    assert complete["telemetry"]["status"] == "PARTIAL"
    assert complete["telemetry"]["items_checked"] == total_count


@pytest.mark.asyncio
async def test_check_items_pooled_invokes_on_progress() -> None:
    """Verify check_items_pooled calls on_progress for every finished item."""
    items = [
        TrackedItem(
            item_id="itm-1",
            name="Item One",
            url="https://example.com/1",
            image_url="",
            currency="$",
            initial_price=100.0,
            current_price=100.0,
            target_price=80.0,
            lowest_price=100.0,
            last_checked="",
        ),
        TrackedItem(
            item_id="itm-2",
            name="Item Two",
            url="https://example.com/2",
            image_url="",
            currency="$",
            initial_price=200.0,
            current_price=200.0,
            target_price=160.0,
            lowest_price=200.0,
            last_checked="",
        ),
    ]

    async def _fake_fetch(_url: str) -> str:
        return (
            '<html><script type="application/ld+json">'
            '{"@type":"Product","name":"X","offers":'
            '{"price":"90.00","priceCurrency":"USD"}}'
            "</script></html>"
        )

    seen: list[str] = []

    async def _on_progress(outcome: ScrapeOutcome) -> None:
        seen.append(outcome.item_id)

    outcomes = await check_items_pooled(
        items=items,
        fetch_fn=_fake_fetch,
        concurrency=2,
        retries=0,
        on_progress=_on_progress,
    )
    assert len(outcomes) == 2
    assert set(seen) == {"itm-1", "itm-2"}
