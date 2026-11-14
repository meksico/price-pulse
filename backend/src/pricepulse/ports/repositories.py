"""Hexagonal ports (abstract interfaces) for PricePulse."""

from __future__ import annotations

from typing import Protocol

from pricepulse.domain.models import (
    BoughtItem,
    ConfigEntry,
    PriceSnapshot,
    ScrapeOutcome,
    ScrapePreview,
    Tag,
    TelemetryRun,
    TrackedItem,
    WorkspaceState,
)


class StateRepositoryPort(Protocol):
    """Port for reading and mutating the 7-tab PricePulse datastore."""

    def load_state(self) -> WorkspaceState:
        """Load the full workspace state across all tabs."""
        ...

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
        """Create a new tracked item, auto-register tags, and record INITIAL snapshot."""
        ...

    def update_item(
        self,
        item_id: str,
        name: str | None = None,
        target_price: float | None = None,
        tag_names: list[str] | None = None,
    ) -> TrackedItem:
        """Update editable fields and tags on an active tracked item."""
        ...

    def mark_bought(self, item_id: str, purchased_price: float) -> BoughtItem:
        """Move an active item to Bought_Items, preserving item_id and history."""
        ...

    def resume_tracking(self, item_id: str) -> TrackedItem:
        """Move an archived item back to Items, preserving item_id and history."""
        ...

    def delete_item(self, item_id: str) -> None:
        """Permanently delete an item from active or bought storage."""
        ...

    def apply_price_checks(
        self,
        outcomes: list[ScrapeOutcome],
        telemetry: TelemetryRun,
    ) -> list[PriceSnapshot]:
        """Batch-update active items with scrape outcomes and append telemetry."""
        ...

    def create_tag(self, name: str, color: str) -> Tag:
        """Register a new 1-level flat tag."""
        ...

    def update_tag(
        self,
        tag_id: str,
        name: str | None = None,
        color: str | None = None,
    ) -> Tag:
        """Rename or recolor an existing tag atomically."""
        ...

    def delete_tag(self, tag_id: str) -> None:
        """Delete a tag and remove all Item_Tags links."""
        ...

    def save_config(self, entries: list[ConfigEntry]) -> list[ConfigEntry]:
        """Persist workspace configuration entries."""
        ...

    def ensure_schema(self) -> list[str]:
        """Verify or bootstrap the 7-tab schema; return initialized tab names."""
        ...


class ScraperPort(Protocol):
    """Port for extracting product metadata and prices from arbitrary URLs."""

    async def preview_url(self, url: str) -> ScrapePreview:
        """Fetch and extract title, price, currency, and image for one URL."""
        ...

    async def check_items(self, items: list[TrackedItem]) -> list[ScrapeOutcome]:
        """Scrape all provided items with bounded concurrency."""
        ...


class NotificationPort(Protocol):
    """Port for dispatching consolidated target-price alerts."""

    def send_discount_digest(
        self,
        recipient: str,
        discounted_items: list[TrackedItem],
    ) -> bool:
        """Send a consolidated digest email; return True if dispatched."""
        ...

