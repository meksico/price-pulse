"""Unit tests for GoogleSheetsRepository and GmailDigestNotifier using mocks."""

from __future__ import annotations

from typing import Any

from pricepulse.adapters.gmail_notifier import GmailDigestNotifier
from pricepulse.adapters.google_sheets import GoogleSheetsRepository
from pricepulse.domain.models import TrackedItem


class _Exec:
    """Minimal mock for Google API .execute() calls."""

    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    def execute(self) -> dict[str, Any]:
        return self._payload


class _FakeValues:
    """Mock for spreadsheets().values()."""

    def __init__(self, state: dict[str, Any]) -> None:
        self._state = state

    def batchGet(self, **_kwargs: Any) -> _Exec:
        return _Exec({"valueRanges": self._state.get("valueRanges", [])})

    def batchUpdate(self, **kwargs: Any) -> _Exec:
        self._state["last_value_batch_update"] = kwargs["body"]
        return _Exec({})

    def append(self, **kwargs: Any) -> _Exec:
        self._state.setdefault("appends", []).append(kwargs)
        return _Exec({})


class _FakeSpreadsheets:
    """Mock for spreadsheets()."""

    def __init__(self, state: dict[str, Any]) -> None:
        self._state = state

    def get(self, **_kwargs: Any) -> _Exec:
        return _Exec({"sheets": self._state.get("sheets", [])})

    def batchUpdate(self, **kwargs: Any) -> _Exec:
        self._state["last_sheet_batch_update"] = kwargs["body"]
        return _Exec({})

    def values(self) -> _FakeValues:
        return _FakeValues(self._state)


class _FakeSheetsService:
    """Mock for Google Sheets v4 service."""

    def __init__(self, state: dict[str, Any]) -> None:
        self._state = state

    def spreadsheets(self) -> _FakeSpreadsheets:
        return _FakeSpreadsheets(self._state)


class _FakeGmailMessages:
    """Mock for users().messages()."""

    def __init__(self, sent: list[dict[str, Any]]) -> None:
        self._sent = sent

    def send(self, **kwargs: Any) -> _Exec:
        self._sent.append(kwargs)
        return _Exec({"id": "msg-1"})


class _FakeGmailUsers:
    """Mock for users()."""

    def __init__(self, sent: list[dict[str, Any]]) -> None:
        self._sent = sent

    def messages(self) -> _FakeGmailMessages:
        return _FakeGmailMessages(self._sent)


class _FakeGmailService:
    """Mock for Gmail v1 service."""

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    def users(self) -> _FakeGmailUsers:
        return _FakeGmailUsers(self.sent)


def test_ensure_schema_bootstraps_missing_tabs() -> None:
    """Verify ensure_schema creates only missing tabs and header rows."""
    state: dict[str, Any] = {
        "sheets": [{"properties": {"title": "Items", "sheetId": 0}}],
    }
    repo = GoogleSheetsRepository("sheet-123", _FakeSheetsService(state))
    created = repo.ensure_schema()
    assert "Items" not in created
    assert set(created) == {
        "Bought_Items",
        "Tags",
        "Item_Tags",
        "Price_History",
        "Telemetry_Logs",
        "Config",
    }
    assert len(state["last_sheet_batch_update"]["requests"]) == 6
    assert len(state["last_value_batch_update"]["data"]) == 6


def test_gmail_digest_notifier_sends_single_email() -> None:
    """Verify consolidated Gmail digest sends when recipient and items exist."""
    svc = _FakeGmailService()
    notifier = GmailDigestNotifier(svc)
    items = [
        TrackedItem(
            item_id="item-1",
            name="Headphones",
            url="https://example.com/hp",
            image_url="",
            currency="$",
            initial_price=300.0,
            current_price=220.0,
            target_price=250.0,
            lowest_price=220.0,
            last_checked="2026-11-13T12:00:00Z",
        )
    ]
    assert notifier.send_discount_digest("", items) is False
    assert notifier.send_discount_digest("user@example.com", []) is False
    assert notifier.send_discount_digest("user@example.com", items) is True
    assert len(svc.sent) == 1

