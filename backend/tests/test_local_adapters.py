"""Unit tests for LocalJsonRepository lifecycle and tag cascading."""

from __future__ import annotations

from pathlib import Path

from pricepulse.adapters.local_json import LocalJsonRepository


def test_add_buy_and_resume_preserves_item_id(tmp_path: Path) -> None:
    """Verify item_id and Price_History persist across Buy and Resume Tracking."""
    state_file = tmp_path / "state.json"
    repo = LocalJsonRepository(state_file)
    created = repo.add_item(
        name="Test Mouse",
        url="https://example.com/mouse",
        image_url="",
        currency="$",
        initial_price=100.0,
        target_price=80.0,
        tag_names=["Peripherals", "Workstation"],
    )
    assert created.item_id.startswith("item-")

    bought = repo.mark_bought(created.item_id, 75.0)
    assert bought.item_id == created.item_id
    assert bought.saved_cost == 25.0

    restored = repo.resume_tracking(created.item_id)
    assert restored.item_id == created.item_id
    history = [h for h in repo.load_state().price_history if h.item_id == created.item_id]
    assert [h.event_type.value for h in history] == ["INITIAL", "BOUGHT", "RESUMED"]


def test_tag_rename_and_delete_cascade(tmp_path: Path) -> None:
    """Verify tag rename and delete propagate cleanly."""
    repo = LocalJsonRepository(tmp_path / "state.json")
    tag = repo.create_tag("Holiday", "rose")
    item = repo.add_item(
        name="Lamp",
        url="https://example.com/lamp",
        image_url="",
        currency="$",
        initial_price=50.0,
        target_price=40.0,
        tag_names=["Holiday"],
    )
    assert tag.tag_id in item.tag_ids

    renamed = repo.update_tag(tag.tag_id, name="Holiday 2026", color="amber")
    assert renamed.name == "Holiday 2026"
    assert renamed.color == "amber"

    repo.delete_tag(tag.tag_id)
    state = repo.load_state()
    assert all(t.tag_id != tag.tag_id for t in state.tags)
    assert all(link.tag_id != tag.tag_id for link in state.item_tags)

