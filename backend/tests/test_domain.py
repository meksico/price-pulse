"""Unit tests for pure domain models and business rules."""

from __future__ import annotations

from pricepulse.domain.models import (
    APP_VERSION,
    BoughtItem,
    ItemStatus,
    aggregate_savings_by_currency,
    compute_delta_pct,
    compute_drop_pct,
    compute_saved_cost,
    compute_status,
    format_currency_totals,
    should_alert,
)


def test_app_version_matches_srs() -> None:
    """Verify domain APP_VERSION matches SRS 0.2.1."""
    assert APP_VERSION == "0.2.1"


def test_drop_and_delta_calculations() -> None:
    """Verify positive drop_pct and negative delta_pct on price drops."""
    assert compute_drop_pct(400.0, 300.0) == 25.0
    assert compute_delta_pct(400.0, 300.0) == -25.0
    assert compute_drop_pct(0.0, 100.0) == 0.0


def test_status_and_saved_cost() -> None:
    """Verify DISCOUNT threshold and non-negative saved_cost."""
    assert compute_status(299.99, 320.00) == ItemStatus.DISCOUNT
    assert compute_status(320.00, 320.00) == ItemStatus.DISCOUNT
    assert compute_status(350.00, 320.00) == ItemStatus.ACTIVE
    assert compute_saved_cost(249.0, 189.0) == 60.0
    assert compute_saved_cost(100.0, 120.0) == 0.0


def test_multi_currency_aggregation() -> None:
    """Verify savings are grouped by currency without external FX conversion."""
    bought = [
        BoughtItem(
            item_id="b-1",
            name="Headphones",
            url="https://example.com/1",
            image_url="",
            currency="$",
            initial_price=200.0,
            purchased_price=150.0,
            purchased_date="2026-11-10",
        ),
        BoughtItem(
            item_id="b-2",
            name="Monitor",
            url="https://example.com/2",
            image_url="",
            currency="₴",
            initial_price=10000.0,
            purchased_price=8500.0,
            purchased_date="2026-11-11",
        ),
    ]
    totals = aggregate_savings_by_currency(bought)
    assert totals == {"$": 50.0, "₴": 1500.0}
    assert format_currency_totals(totals) == "$50.00 + ₴1,500.00"
    assert format_currency_totals({}) == "$0.00"


def test_alert_trigger_policy() -> None:
    """Verify alert fires on ACTIVE->DISCOUNT transition or new lowest_price."""
    assert should_alert(ItemStatus.ACTIVE, 350.0, 300.0, 320.0) is True
    assert should_alert(ItemStatus.DISCOUNT, 300.0, 300.0, 320.0) is False
    assert should_alert(ItemStatus.DISCOUNT, 300.0, 280.0, 320.0) is True
    assert should_alert(ItemStatus.ACTIVE, 350.0, 340.0, 320.0) is False

