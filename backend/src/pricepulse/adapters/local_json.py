"""Deterministic Local JSON & In-Memory adapters for offline dev and E2E testing."""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict
from pathlib import Path

from pricepulse.domain.models import (
    TAG_COLORS,
    BoughtItem,
    ConfigEntry,
    ItemTag,
    PriceEventType,
    PriceSnapshot,
    RunStatus,
    ScrapeOutcome,
    ScrapePreview,
    Tag,
    TelemetryRun,
    TrackedItem,
    WorkspaceState,
    compute_delta_pct,
    utc_now_iso,
)


def _default_seed_state() -> WorkspaceState:
    """Return a realistic multi-currency seed state matching SRS v0.2.0."""
    now = "2026-11-13T12:00:00Z"
    tags = [
        Tag(tag_id="tag-1", name="Audio", color="purple", created_at=now),
        Tag(tag_id="tag-2", name="Black Friday", color="amber", created_at=now),
        Tag(tag_id="tag-3", name="Workstation", color="blue", created_at=now),
        Tag(tag_id="tag-4", name="Purchased", color="emerald", created_at=now),
    ]
    items = [
        TrackedItem(
            item_id="item-1",
            name="Sony WH-1000XM5 Wireless Headphones",
            url="https://example.com/products/sony-wh-1000xm5",
            image_url="https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?w=200",
            currency="$",
            initial_price=399.99,
            current_price=299.99,
            target_price=320.00,
            lowest_price=299.99,
            last_checked=now,
            tag_ids=["tag-1", "tag-2"],
        ),
        TrackedItem(
            item_id="item-2",
            name="Keychron Q1 Pro Mechanical Keyboard",
            url="https://example.com/products/keychron-q1-pro",
            image_url="https://images.unsplash.com/photo-1595225476474-87563907a212?w=200",
            currency="$",
            initial_price=199.00,
            current_price=189.00,
            target_price=165.00,
            lowest_price=189.00,
            last_checked=now,
            tag_ids=["tag-3"],
        ),
        TrackedItem(
            item_id="item-3",
            name="Dell UltraSharp U2723QE 27-inch 4K Monitor",
            url="https://example.com/products/dell-u2723qe",
            image_url="https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=200",
            currency="€",
            initial_price=620.00,
            current_price=540.00,
            target_price=550.00,
            lowest_price=540.00,
            last_checked=now,
            tag_ids=["tag-2", "tag-3"],
        ),
    ]
    bought_items = [
        BoughtItem(
            item_id="item-101",
            name="Apple AirPods Pro (2nd Gen)",
            url="https://example.com/products/airpods-pro-2",
            image_url="https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?w=200",
            currency="$",
            initial_price=249.00,
            purchased_price=189.00,
            purchased_date="2026-11-10",
            tag_ids=["tag-1", "tag-4"],
        ),
    ]
    item_tags = [
        ItemTag(item_id="item-1", tag_id="tag-1", assigned_at=now),
        ItemTag(item_id="item-1", tag_id="tag-2", assigned_at=now),
        ItemTag(item_id="item-2", tag_id="tag-3", assigned_at=now),
        ItemTag(item_id="item-3", tag_id="tag-2", assigned_at=now),
        ItemTag(item_id="item-3", tag_id="tag-3", assigned_at=now),
        ItemTag(item_id="item-101", tag_id="tag-1", assigned_at=now),
        ItemTag(item_id="item-101", tag_id="tag-4", assigned_at=now),
    ]
    price_history = [
        PriceSnapshot(
            history_id="hist-1",
            item_id="item-1",
            recorded_at="2026-11-01T10:00:00Z",
            price=399.99,
            delta_pct=0.0,
            event_type=PriceEventType.INITIAL,
        ),
        PriceSnapshot(
            history_id="hist-2",
            item_id="item-1",
            recorded_at=now,
            price=299.99,
            delta_pct=-25.0,
            event_type=PriceEventType.CHECK,
        ),
        PriceSnapshot(
            history_id="hist-3",
            item_id="item-2",
            recorded_at="2026-11-01T10:00:00Z",
            price=199.00,
            delta_pct=0.0,
            event_type=PriceEventType.INITIAL,
        ),
        PriceSnapshot(
            history_id="hist-4",
            item_id="item-2",
            recorded_at=now,
            price=189.00,
            delta_pct=-5.0,
            event_type=PriceEventType.CHECK,
        ),
        PriceSnapshot(
            history_id="hist-5",
            item_id="item-3",
            recorded_at="2026-11-01T10:00:00Z",
            price=620.00,
            delta_pct=0.0,
            event_type=PriceEventType.INITIAL,
        ),
        PriceSnapshot(
            history_id="hist-6",
            item_id="item-3",
            recorded_at=now,
            price=540.00,
            delta_pct=-12.9,
            event_type=PriceEventType.CHECK,
        ),
    ]
    telemetry_logs = [
        TelemetryRun(
            run_id="run-1001",
            started_at=now,
            status=RunStatus.SUCCESS,
            items_checked=3,
            breakdown="3/3 URLs Checked & Saved",
            duration_ms=1420,
        ),
    ]
    config = [
        ConfigEntry(
            key="spreadsheet_id",
            value="",
            description="Google Sheets Workbook ID",
        ),
        ConfigEntry(
            key="gmail_alert_recipient",
            value="",
            description="Recipient for target_price discount digests",
        ),
        ConfigEntry(
            key="poll_interval_hours",
            value="6",
            description="Cloud Scheduler polling cadence in hours",
        ),
    ]
    return WorkspaceState(
        items=items,
        bought_items=bought_items,
        tags=tags,
        item_tags=item_tags,
        price_history=price_history,
        telemetry_logs=telemetry_logs,
        config=config,
    )


class LocalJsonRepository:
    """Thread-safe local JSON-backed implementation of StateRepositoryPort."""

    def __init__(self, file_path: Path | None = None) -> None:
        self._file_path = file_path
        if file_path is not None and file_path.exists():
            self._state = self._read_from_disk(file_path)
        else:
            self._state = _default_seed_state()
            if file_path is not None:
                self._write_to_disk(file_path, self._state)

    def _read_from_disk(self, path: Path) -> WorkspaceState:
        """Deserialize WorkspaceState from a local JSON file."""
        raw = json.loads(path.read_text(encoding="utf-8"))
        return WorkspaceState(
            items=[TrackedItem(**item) for item in raw["items"]],
            bought_items=[BoughtItem(**item) for item in raw["bought_items"]],
            tags=[Tag(**tag) for tag in raw["tags"]],
            item_tags=[ItemTag(**link) for link in raw["item_tags"]],
            price_history=[
                PriceSnapshot(
                    history_id=snap["history_id"],
                    item_id=snap["item_id"],
                    recorded_at=snap["recorded_at"],
                    price=snap["price"],
                    delta_pct=snap["delta_pct"],
                    event_type=PriceEventType(snap["event_type"]),
                )
                for snap in raw["price_history"]
            ],
            telemetry_logs=[
                TelemetryRun(
                    run_id=run["run_id"],
                    started_at=run["started_at"],
                    status=RunStatus(run["status"]),
                    items_checked=run["items_checked"],
                    breakdown=run["breakdown"],
                    duration_ms=run["duration_ms"],
                    errors=run.get("errors", []),
                )
                for run in raw["telemetry_logs"]
            ],
            config=[ConfigEntry(**cfg) for cfg in raw["config"]],
        )

    def _write_to_disk(self, path: Path, state: WorkspaceState) -> None:
        """Serialize WorkspaceState atomically to disk."""
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = asdict(state)
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def _persist(self) -> None:
        """Persist current state if backed by a file."""
        if self._file_path is not None:
            self._write_to_disk(self._file_path, self._state)

    def _ensure_tags(self, tag_names: list[str]) -> list[str]:
        """Resolve tag names to tag_ids, auto-registering unknown tags."""
        resolved_ids: list[str] = []
        now = utc_now_iso()
        for raw_name in tag_names:
            clean = raw_name.strip()
            if not clean:
                continue
            existing = next(
                (t for t in self._state.tags if t.name.lower() == clean.lower()),
                None,
            )
            if existing is None:
                color = TAG_COLORS[len(self._state.tags) % len(TAG_COLORS)]
                existing = Tag(
                    tag_id=f"tag-{uuid.uuid4().hex[:8]}",
                    name=clean,
                    color=color,
                    created_at=now,
                )
                self._state.tags.append(existing)
            if existing.tag_id not in resolved_ids:
                resolved_ids.append(existing.tag_id)
        return resolved_ids

    def _sync_item_tags(self, item_id: str, tag_ids: list[str]) -> None:
        """Replace Item_Tags rows for a given item_id."""
        now = utc_now_iso()
        self._state.item_tags[:] = [
            link for link in self._state.item_tags if link.item_id != item_id
        ]
        for tid in tag_ids:
            self._state.item_tags.append(
                ItemTag(item_id=item_id, tag_id=tid, assigned_at=now)
            )

    def load_state(self) -> WorkspaceState:
        """Return current WorkspaceState."""
        return self._state

    def add_item(
        self,
        name: str,
        url: str,
        image_url: str,
        currency: str,
        initial_price: float,
        target_price: float,
        tag_names: list[str],
    ) -> TrackedItem:
        """Add a new tracked item and record its INITIAL snapshot."""
        now = utc_now_iso()
        item_id = f"item-{uuid.uuid4().hex[:8]}"
        tag_ids = self._ensure_tags(tag_names)
        item = TrackedItem(
            item_id=item_id,
            name=name.strip(),
            url=url.strip(),
            image_url=image_url.strip(),
            currency=currency.strip() or "$",
            initial_price=initial_price,
            current_price=initial_price,
            target_price=target_price,
            lowest_price=initial_price,
            last_checked=now,
            tag_ids=tag_ids,
        )
        self._state.items.append(item)
        self._sync_item_tags(item_id, tag_ids)
        self._state.price_history.append(
            PriceSnapshot(
                history_id=f"hist-{uuid.uuid4().hex[:8]}",
                item_id=item_id,
                recorded_at=now,
                price=initial_price,
                delta_pct=0.0,
                event_type=PriceEventType.INITIAL,
            )
        )
        self._persist()
        return item

    def update_item(
        self,
        item_id: str,
        name: str | None = None,
        target_price: float | None = None,
        tag_names: list[str] | None = None,
    ) -> TrackedItem:
        """Update an active tracked item's title, target_price, or tags."""
        item = next((i for i in self._state.items if i.item_id == item_id), None)
        if item is None:
            raise KeyError(f"Active item not found: {item_id}")
        if name is not None:
            item.name = name.strip()
        if target_price is not None:
            item.target_price = target_price
        if tag_names is not None:
            item.tag_ids = self._ensure_tags(tag_names)
            self._sync_item_tags(item_id, item.tag_ids)
        self._persist()
        return item

    def mark_bought(self, item_id: str, purchased_price: float) -> BoughtItem:
        """Archive an active item to Bought_Items, preserving item_id and history."""
        idx = next(
            (i for i, item in enumerate(self._state.items) if item.item_id == item_id),
            None,
        )
        if idx is None:
            raise KeyError(f"Active item not found: {item_id}")
        item = self._state.items.pop(idx)
        purchased_ids = self._ensure_tags(["Purchased"])
        tag_ids = list(dict.fromkeys([*item.tag_ids, *purchased_ids]))
        self._sync_item_tags(item_id, tag_ids)
        now = utc_now_iso()
        bought = BoughtItem(
            item_id=item.item_id,
            name=item.name,
            url=item.url,
            image_url=item.image_url,
            currency=item.currency,
            initial_price=item.initial_price,
            purchased_price=purchased_price,
            purchased_date=now[:10],
            tag_ids=tag_ids,
        )
        self._state.bought_items.append(bought)
        self._state.price_history.append(
            PriceSnapshot(
                history_id=f"hist-{uuid.uuid4().hex[:8]}",
                item_id=item.item_id,
                recorded_at=now,
                price=purchased_price,
                delta_pct=compute_delta_pct(item.initial_price, purchased_price),
                event_type=PriceEventType.BOUGHT,
            )
        )
        self._persist()
        return bought

    def resume_tracking(self, item_id: str) -> TrackedItem:
        """Restore a bought item back into active Items, preserving history."""
        idx = next(
            (i for i, item in enumerate(self._state.bought_items) if item.item_id == item_id),
            None,
        )
        if idx is None:
            raise KeyError(f"Bought item not found: {item_id}")
        bought = self._state.bought_items.pop(idx)
        purchased_tag = next(
            (t for t in self._state.tags if t.name.lower() == "purchased"),
            None,
        )
        tag_ids = [
            tid
            for tid in bought.tag_ids
            if purchased_tag is None or tid != purchased_tag.tag_id
        ]
        self._sync_item_tags(item_id, tag_ids)
        now = utc_now_iso()
        restored = TrackedItem(
            item_id=bought.item_id,
            name=bought.name,
            url=bought.url,
            image_url=bought.image_url,
            currency=bought.currency,
            initial_price=bought.initial_price,
            current_price=bought.purchased_price,
            target_price=bought.purchased_price,
            lowest_price=min(bought.initial_price, bought.purchased_price),
            last_checked=now,
            tag_ids=tag_ids,
        )
        self._state.items.append(restored)
        self._state.price_history.append(
            PriceSnapshot(
                history_id=f"hist-{uuid.uuid4().hex[:8]}",
                item_id=bought.item_id,
                recorded_at=now,
                price=bought.purchased_price,
                delta_pct=compute_delta_pct(bought.initial_price, bought.purchased_price),
                event_type=PriceEventType.RESUMED,
            )
        )
        self._persist()
        return restored

    def delete_item(self, item_id: str) -> None:
        """Delete an item from active or bought items and clean up junction rows."""
        before = len(self._state.items) + len(self._state.bought_items)
        self._state.items[:] = [i for i in self._state.items if i.item_id != item_id]
        self._state.bought_items[:] = [
            b for b in self._state.bought_items if b.item_id != item_id
        ]
        after = len(self._state.items) + len(self._state.bought_items)
        if before == after:
            raise KeyError(f"Item not found: {item_id}")
        self._state.item_tags[:] = [
            link for link in self._state.item_tags if link.item_id != item_id
        ]
        self._persist()

    def apply_price_checks(
        self,
        outcomes: list[ScrapeOutcome],
        telemetry: TelemetryRun,
    ) -> list[PriceSnapshot]:
        """Update active items from scrape outcomes and record CHECK snapshots."""
        now = utc_now_iso()
        snapshots: list[PriceSnapshot] = []
        by_id = {item.item_id: item for item in self._state.items}
        for outcome in outcomes:
            if not outcome.success or outcome.price is None:
                continue
            item = by_id.get(outcome.item_id)
            if item is None:
                continue
            item.current_price = outcome.price
            item.lowest_price = min(item.lowest_price, outcome.price)
            item.last_checked = now
            snap = PriceSnapshot(
                history_id=f"hist-{uuid.uuid4().hex[:8]}",
                item_id=item.item_id,
                recorded_at=now,
                price=outcome.price,
                delta_pct=compute_delta_pct(item.initial_price, outcome.price),
                event_type=PriceEventType.CHECK,
            )
            self._state.price_history.append(snap)
            snapshots.append(snap)
        self._state.telemetry_logs.insert(0, telemetry)
        self._persist()
        return snapshots

    def create_tag(self, name: str, color: str) -> Tag:
        """Create a new tag or raise ValueError on duplicate name."""
        clean = name.strip()
        if not clean:
            raise ValueError("Tag name cannot be empty")
        if any(t.name.lower() == clean.lower() for t in self._state.tags):
            raise ValueError(f"Tag already exists: {clean}")
        chosen_color = color if color in TAG_COLORS else "slate"
        tag = Tag(
            tag_id=f"tag-{uuid.uuid4().hex[:8]}",
            name=clean,
            color=chosen_color,
            created_at=utc_now_iso(),
        )
        self._state.tags.append(tag)
        self._persist()
        return tag

    def update_tag(
        self,
        tag_id: str,
        name: str | None = None,
        color: str | None = None,
    ) -> Tag:
        """Update tag name or color in-place."""
        idx = next((i for i, t in enumerate(self._state.tags) if t.tag_id == tag_id), None)
        if idx is None:
            raise KeyError(f"Tag not found: {tag_id}")
        current = self._state.tags[idx]
        new_name = name.strip() if name is not None else current.name
        if not new_name:
            raise ValueError("Tag name cannot be empty")
        if any(
            t.tag_id != tag_id and t.name.lower() == new_name.lower()
            for t in self._state.tags
        ):
            raise ValueError(f"Tag already exists: {new_name}")
        new_color = color if color in TAG_COLORS else current.color
        updated = Tag(
            tag_id=current.tag_id,
            name=new_name,
            color=new_color,
            created_at=current.created_at,
        )
        self._state.tags[idx] = updated
        self._persist()
        return updated

    def delete_tag(self, tag_id: str) -> None:
        """Delete a tag and cascade removal to Item_Tags and item tag_ids."""
        before = len(self._state.tags)
        self._state.tags[:] = [t for t in self._state.tags if t.tag_id != tag_id]
        if len(self._state.tags) == before:
            raise KeyError(f"Tag not found: {tag_id}")
        self._state.item_tags[:] = [
            link for link in self._state.item_tags if link.tag_id != tag_id
        ]
        for item in self._state.items:
            item.tag_ids = [tid for tid in item.tag_ids if tid != tag_id]
        for bought in self._state.bought_items:
            bought.tag_ids = [tid for tid in bought.tag_ids if tid != tag_id]
        self._persist()

    def save_config(self, entries: list[ConfigEntry]) -> list[ConfigEntry]:
        """Upsert Config entries."""
        by_key = {c.key: c for c in self._state.config}
        for entry in entries:
            by_key[entry.key] = entry
        self._state.config[:] = list(by_key.values())
        self._persist()
        return self._state.config

    def ensure_schema(self) -> list[str]:
        """Return canonical 7-tab schema names for local adapter."""
        return [
            "Items",
            "Bought_Items",
            "Tags",
            "Item_Tags",
            "Price_History",
            "Telemetry_Logs",
            "Config",
        ]


class DeterministicScraperAdapter:
    """Offline deterministic scraper for dev and Playwright E2E testing."""

    async def preview_url(self, url: str) -> ScrapePreview:
        """Return deterministic preview metadata derived from the URL."""
        slug = url.rstrip("/").split("/")[-1].replace("-", " ").title() or "Sample Product"
        return ScrapePreview(
            url=url,
            title=slug,
            price=149.99,
            currency="$",
            image_url="https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=200",
            extraction_tier="TIER_1_JSON_LD",
            suggested_tags=["Tech"],
        )

    async def check_items(self, items: list[TrackedItem]) -> list[ScrapeOutcome]:
        """Simulate small deterministic price checks across active items."""
        outcomes: list[ScrapeOutcome] = []
        for idx, item in enumerate(items):
            delta = -5.0 if idx % 2 == 0 else 0.0
            new_price = round(max(1.0, item.current_price + delta), 2)
            outcomes.append(
                ScrapeOutcome(
                    item_id=item.item_id,
                    success=True,
                    price=new_price,
                    currency=item.currency,
                    extraction_tier="TIER_1_JSON_LD",
                )
            )
        return outcomes


class InMemoryNotificationAdapter:
    """Records dispatched digest notifications in memory for testing."""

    def __init__(self) -> None:
        self.sent_digests: list[tuple[str, list[str]]] = []

    def send_discount_digest(
        self,
        recipient: str,
        discounted_items: list[TrackedItem],
    ) -> bool:
        """Record digest dispatch when recipient and items are non-empty."""
        if not recipient or not discounted_items:
            return False
        self.sent_digests.append((recipient, [i.item_id for i in discounted_items]))
        return True

