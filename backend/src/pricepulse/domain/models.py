"""Pure domain entities, value objects, and business rules for PricePulse."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum

APP_VERSION: str = "0.2.1"

TAG_COLORS: tuple[str, ...] = (
    "purple",
    "amber",
    "emerald",
    "blue",
    "rose",
    "cyan",
    "slate",
)


class ItemStatus(StrEnum):
    """Monitoring status for a tracked item."""

    ACTIVE = "ACTIVE"
    DISCOUNT = "DISCOUNT"


class PriceEventType(StrEnum):
    """Lifecycle event types recorded in Price_History."""

    INITIAL = "INITIAL"
    CHECK = "CHECK"
    BOUGHT = "BOUGHT"
    RESUMED = "RESUMED"


class RunStatus(StrEnum):
    """Batch execution status recorded in Telemetry_Logs."""

    SUCCESS = "SUCCESS"
    PARTIAL = "PARTIAL"
    ERROR = "ERROR"


@dataclass(frozen=True)
class Tag:
    """Flat 1-level tag entity stored in the Tags sheet."""

    tag_id: str
    name: str
    color: str
    created_at: str


@dataclass(frozen=True)
class ItemTag:
    """Many-to-many junction linking an item to a tag."""

    item_id: str
    tag_id: str
    assigned_at: str


@dataclass(frozen=True)
class PriceSnapshot:
    """Append-only historical price observation."""

    history_id: str
    item_id: str
    recorded_at: str
    price: float
    delta_pct: float
    event_type: PriceEventType


@dataclass
class TrackedItem:
    """Active product position monitored by PricePulse."""

    item_id: str
    name: str
    url: str
    image_url: str
    currency: str
    initial_price: float
    current_price: float
    target_price: float
    lowest_price: float
    last_checked: str
    tag_ids: list[str] = field(default_factory=list)

    @property
    def status(self) -> ItemStatus:
        """Evaluate current status against target_price."""
        return compute_status(self.current_price, self.target_price)

    @property
    def drop_pct(self) -> float:
        """Compute rounded percentage drop relative to initial_price."""
        return compute_drop_pct(self.initial_price, self.current_price)


@dataclass
class BoughtItem:
    """Purchased & archived product position with frozen polling."""

    item_id: str
    name: str
    url: str
    image_url: str
    currency: str
    initial_price: float
    purchased_price: float
    purchased_date: str
    tag_ids: list[str] = field(default_factory=list)

    @property
    def saved_cost(self) -> float:
        """Compute non-negative realized savings."""
        return compute_saved_cost(self.initial_price, self.purchased_price)


@dataclass(frozen=True)
class TelemetryRun:
    """Batch scraper execution telemetry record."""

    run_id: str
    started_at: str
    status: RunStatus
    items_checked: int
    breakdown: str
    duration_ms: int
    errors: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ConfigEntry:
    """Key-value setting stored in the Config sheet."""

    key: str
    value: str
    description: str = ""


@dataclass(frozen=True)
class ScrapePreview:
    """Extracted metadata returned for a single product URL preview."""

    url: str
    title: str
    price: float
    currency: str
    image_url: str
    extraction_tier: str
    suggested_tags: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ScrapeOutcome:
    """Result of scraping a single tracked item during a batch run."""

    item_id: str
    success: bool
    price: float | None = None
    currency: str | None = None
    extraction_tier: str | None = None
    error: str | None = None


@dataclass(frozen=True)
class WorkspaceState:
    """Complete snapshot of all 7 workbook entities."""

    items: list[TrackedItem]
    bought_items: list[BoughtItem]
    tags: list[Tag]
    item_tags: list[ItemTag]
    price_history: list[PriceSnapshot]
    telemetry_logs: list[TelemetryRun]
    config: list[ConfigEntry]


def utc_now_iso() -> str:
    """Return current UTC timestamp in ISO 8601 Z format."""
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def compute_drop_pct(initial_price: float, current_price: float) -> float:
    """Compute percentage drop from initial_price (positive = price dropped)."""
    if initial_price <= 0:
        return 0.0
    return round(((initial_price - current_price) / initial_price) * 100.0, 1)


def compute_delta_pct(initial_price: float, observed_price: float) -> float:
    """Compute signed delta percentage for Price_History (negative = drop)."""
    if initial_price <= 0:
        return 0.0
    return round(((observed_price - initial_price) / initial_price) * 100.0, 1)


def compute_status(current_price: float, target_price: float) -> ItemStatus:
    """Return DISCOUNT when current_price <= target_price, else ACTIVE."""
    if current_price <= target_price:
        return ItemStatus.DISCOUNT
    return ItemStatus.ACTIVE


def compute_saved_cost(initial_price: float, purchased_price: float) -> float:
    """Return realized savings clamped to >= 0."""
    return round(max(0.0, initial_price - purchased_price), 2)


def aggregate_savings_by_currency(bought_items: list[BoughtItem]) -> dict[str, float]:
    """Group and sum realized savings by currency symbol (REQ-DATA-06)."""
    totals: dict[str, float] = {}
    for item in bought_items:
        saved = item.saved_cost
        totals[item.currency] = round(totals.get(item.currency, 0.0) + saved, 2)
    return totals


def format_currency_totals(totals: dict[str, float]) -> str:
    """Format multi-currency totals into a single display string."""
    if not totals:
        return "$0.00"
    parts = [f"{symbol}{amount:,.2f}" for symbol, amount in totals.items()]
    return " + ".join(parts)


def should_alert(
    previous_status: ItemStatus,
    previous_lowest_price: float,
    new_price: float,
    target_price: float,
) -> bool:
    """Return True when item transitions ACTIVE->DISCOUNT or hits new lowest_price."""
    new_status = compute_status(new_price, target_price)
    if new_status != ItemStatus.DISCOUNT:
        return False
    if previous_status == ItemStatus.ACTIVE:
        return True
    return new_price < previous_lowest_price

