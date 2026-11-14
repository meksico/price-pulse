"""Google Sheets API v4 adapter implementing StateRepositoryPort (REQ-DATA-01..05)."""

from __future__ import annotations

import uuid
from typing import Any

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from pricepulse.domain.models import (
    TAG_COLORS,
    BoughtItem,
    ConfigEntry,
    ItemTag,
    PriceEventType,
    PriceSnapshot,
    RunStatus,
    ScrapeOutcome,
    Tag,
    TelemetryRun,
    TrackedItem,
    WorkspaceState,
    compute_delta_pct,
    utc_now_iso,
)

SHEET_HEADERS: dict[str, list[str]] = {
    "Items": [
        "item_id",
        "name",
        "url",
        "image_url",
        "currency",
        "initial_price",
        "current_price",
        "target_price",
        "lowest_price",
        "status",
        "drop_pct",
        "last_checked",
    ],
    "Bought_Items": [
        "item_id",
        "name",
        "url",
        "image_url",
        "currency",
        "initial_price",
        "purchased_price",
        "saved_cost",
        "purchased_date",
    ],
    "Tags": ["tag_id", "name", "color", "created_at"],
    "Item_Tags": ["item_id", "tag_id", "assigned_at"],
    "Price_History": [
        "history_id",
        "item_id",
        "recorded_at",
        "price",
        "delta_pct",
        "event_type",
    ],
    "Telemetry_Logs": [
        "run_id",
        "started_at",
        "status",
        "items_checked",
        "breakdown",
        "duration_ms",
    ],
    "Config": ["key", "value", "description"],
}


def build_sheets_service(
    client_id: str,
    client_secret: str,
    refresh_token: str,
) -> Any:
    """Build an authenticated Google Sheets v4 service using OAuth Refresh Token."""
    creds = Credentials(  # type: ignore[no-untyped-call]
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_id,
        client_secret=client_secret,
    )
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


class GoogleSheetsRepository:
    """7-Tab Google Sheets datastore adapter."""

    def __init__(self, spreadsheet_id: str, service: Any) -> None:
        self._spreadsheet_id = spreadsheet_id
        self._service = service

    def ensure_schema(self) -> list[str]:
        """Inspect workbook and auto-bootstrap any missing tabs and header rows."""
        meta = (
            self._service.spreadsheets()
            .get(spreadsheetId=self._spreadsheet_id)
            .execute()
        )
        existing_titles = {
            sheet["properties"]["title"] for sheet in meta.get("sheets", [])
        }
        missing = [tab for tab in SHEET_HEADERS if tab not in existing_titles]
        if missing:
            requests = [
                {"addSheet": {"properties": {"title": tab}}} for tab in missing
            ]
            self._service.spreadsheets().batchUpdate(
                spreadsheetId=self._spreadsheet_id,
                body={"requests": requests},
            ).execute()
            value_updates = [
                {"range": f"{tab}!A1", "values": [SHEET_HEADERS[tab]]}
                for tab in missing
            ]
            self._service.spreadsheets().values().batchUpdate(
                spreadsheetId=self._spreadsheet_id,
                body={"valueInputOption": "USER_ENTERED", "data": value_updates},
            ).execute()
        return missing

    def load_state(self) -> WorkspaceState:
        """Fetch all 7 tabs in a single batchGet call."""
        ranges = [
            "Items!A2:L",
            "Bought_Items!A2:I",
            "Tags!A2:D",
            "Item_Tags!A2:C",
            "Price_History!A2:F",
            "Telemetry_Logs!A2:F",
            "Config!A2:C",
        ]
        resp = (
            self._service.spreadsheets()
            .values()
            .batchGet(spreadsheetId=self._spreadsheet_id, ranges=ranges)
            .execute()
        )
        vr = resp.get("valueRanges", [])
        rows_by_tab = [entry.get("values", []) for entry in vr]
        while len(rows_by_tab) < 7:
            rows_by_tab.append([])

        tags = [
            Tag(tag_id=r[0], name=r[1], color=r[2], created_at=r[3])
            for r in rows_by_tab[2]
            if len(r) >= 4
        ]
        item_tags = [
            ItemTag(item_id=r[0], tag_id=r[1], assigned_at=r[2])
            for r in rows_by_tab[3]
            if len(r) >= 3
        ]
        tags_by_item: dict[str, list[str]] = {}
        for link in item_tags:
            tags_by_item.setdefault(link.item_id, []).append(link.tag_id)

        items = [
            TrackedItem(
                item_id=r[0],
                name=r[1],
                url=r[2],
                image_url=r[3],
                currency=r[4],
                initial_price=float(r[5]),
                current_price=float(r[6]),
                target_price=float(r[7]),
                lowest_price=float(r[8]),
                last_checked=r[11] if len(r) > 11 else "",
                tag_ids=tags_by_item.get(r[0], []),
            )
            for r in rows_by_tab[0]
            if len(r) >= 9
        ]
        bought_items = [
            BoughtItem(
                item_id=r[0],
                name=r[1],
                url=r[2],
                image_url=r[3],
                currency=r[4],
                initial_price=float(r[5]),
                purchased_price=float(r[6]),
                purchased_date=r[8] if len(r) > 8 else "",
                tag_ids=tags_by_item.get(r[0], []),
            )
            for r in rows_by_tab[1]
            if len(r) >= 7
        ]
        history = [
            PriceSnapshot(
                history_id=r[0],
                item_id=r[1],
                recorded_at=r[2],
                price=float(r[3]),
                delta_pct=float(r[4]),
                event_type=PriceEventType(r[5]),
            )
            for r in rows_by_tab[4]
            if len(r) >= 6
        ]
        telemetry = [
            TelemetryRun(
                run_id=r[0],
                started_at=r[1],
                status=RunStatus(r[2]),
                items_checked=int(r[3]),
                breakdown=r[4],
                duration_ms=int(r[5]),
            )
            for r in rows_by_tab[5]
            if len(r) >= 6
        ]
        config = [
            ConfigEntry(key=r[0], value=r[1], description=r[2] if len(r) > 2 else "")
            for r in rows_by_tab[6]
            if len(r) >= 2
        ]
        return WorkspaceState(
            items=items,
            bought_items=bought_items,
            tags=tags,
            item_tags=item_tags,
            price_history=history,
            telemetry_logs=list(reversed(telemetry)),
            config=config,
        )

    def _sheet_id_map(self) -> dict[str, int]:
        """Map tab title to numeric Google Sheet gridId."""
        meta = (
            self._service.spreadsheets()
            .get(spreadsheetId=self._spreadsheet_id)
            .execute()
        )
        return {
            s["properties"]["title"]: int(s["properties"]["sheetId"])
            for s in meta.get("sheets", [])
        }

    def _delete_rows(self, tab: str, zero_based_indices: list[int]) -> None:
        """Delete rows in descending order to avoid index shifting."""
        if not zero_based_indices:
            return
        sheet_id = self._sheet_id_map()[tab]
        requests = [
            {
                "deleteDimension": {
                    "range": {
                        "sheetId": sheet_id,
                        "dimension": "ROWS",
                        "startIndex": idx,
                        "endIndex": idx + 1,
                    }
                }
            }
            for idx in sorted(zero_based_indices, reverse=True)
        ]
        self._service.spreadsheets().batchUpdate(
            spreadsheetId=self._spreadsheet_id,
            body={"requests": requests},
        ).execute()

    def _append_rows(self, tab: str, rows: list[list[Any]]) -> None:
        """Append rows to a sheet tab with USER_ENTERED formula evaluation."""
        if not rows:
            return
        self._service.spreadsheets().values().append(
            spreadsheetId=self._spreadsheet_id,
            range=f"{tab}!A1",
            valueInputOption="USER_ENTERED",
            insertDataOption="INSERT_ROWS",
            body={"values": rows},
        ).execute()

    def _ensure_tags(self, tag_names: list[str], existing: list[Tag]) -> list[str]:
        """Ensure tags exist in Tags tab and return resolved tag_ids."""
        now = utc_now_iso()
        new_rows: list[list[Any]] = []
        resolved: list[str] = []
        known = list(existing)
        for raw in tag_names:
            clean = raw.strip()
            if not clean:
                continue
            found = next((t for t in known if t.name.lower() == clean.lower()), None)
            if found is None:
                color = TAG_COLORS[len(known) % len(TAG_COLORS)]
                found = Tag(
                    tag_id=f"tag-{uuid.uuid4().hex[:8]}",
                    name=clean,
                    color=color,
                    created_at=now,
                )
                known.append(found)
                new_rows.append([found.tag_id, found.name, found.color, found.created_at])
            if found.tag_id not in resolved:
                resolved.append(found.tag_id)
        self._append_rows("Tags", new_rows)
        return resolved

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
        """Append a tracked item, INITIAL snapshot, and Item_Tags links."""
        state = self.load_state()
        row_num = len(state.items) + 2
        item_id = f"item-{uuid.uuid4().hex[:8]}"
        now = utc_now_iso()
        tag_ids = self._ensure_tags(tag_names, state.tags)
        self._append_rows(
            "Items",
            [
                [
                    item_id,
                    name.strip(),
                    url.strip(),
                    image_url.strip(),
                    currency.strip() or "$",
                    initial_price,
                    initial_price,
                    target_price,
                    initial_price,
                    f'=IF(G{row_num}<=H{row_num},"DISCOUNT","ACTIVE")',
                    f"=IF(F{row_num}>0,ROUND(((F{row_num}-G{row_num})/F{row_num})*100,1),0)",
                    now,
                ]
            ],
        )
        self._append_rows(
            "Item_Tags",
            [[item_id, tid, now] for tid in tag_ids],
        )
        self._append_rows(
            "Price_History",
            [[f"hist-{uuid.uuid4().hex[:8]}", item_id, now, initial_price, 0.0, "INITIAL"]],
        )
        return TrackedItem(
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

    def update_item(
        self,
        item_id: str,
        name: str | None = None,
        target_price: float | None = None,
        tag_names: list[str] | None = None,
    ) -> TrackedItem:
        """Update item fields in Items and sync Item_Tags."""
        state = self.load_state()
        idx = next((i for i, it in enumerate(state.items) if it.item_id == item_id), None)
        if idx is None:
            raise KeyError(f"Active item not found: {item_id}")
        item = state.items[idx]
        if name is not None:
            item.name = name.strip()
        if target_price is not None:
            item.target_price = target_price
        row_num = idx + 2
        self._service.spreadsheets().values().batchUpdate(
            spreadsheetId=self._spreadsheet_id,
            body={
                "valueInputOption": "USER_ENTERED",
                "data": [
                    {"range": f"Items!B{row_num}", "values": [[item.name]]},
                    {"range": f"Items!H{row_num}", "values": [[item.target_price]]},
                ],
            },
        ).execute()
        if tag_names is not None:
            del_indices = [
                i + 1 for i, link in enumerate(state.item_tags) if link.item_id == item_id
            ]
            self._delete_rows("Item_Tags", del_indices)
            item.tag_ids = self._ensure_tags(tag_names, state.tags)
            now = utc_now_iso()
            self._append_rows("Item_Tags", [[item_id, tid, now] for tid in item.tag_ids])
        return item

    def mark_bought(self, item_id: str, purchased_price: float) -> BoughtItem:
        """Move item from Items to Bought_Items while preserving item_id."""
        state = self.load_state()
        idx = next((i for i, it in enumerate(state.items) if it.item_id == item_id), None)
        if idx is None:
            raise KeyError(f"Active item not found: {item_id}")
        item = state.items[idx]
        now = utc_now_iso()
        bought_row_num = len(state.bought_items) + 2
        self._append_rows(
            "Bought_Items",
            [
                [
                    item.item_id,
                    item.name,
                    item.url,
                    item.image_url,
                    item.currency,
                    item.initial_price,
                    purchased_price,
                    f"=MAX(0,F{bought_row_num}-G{bought_row_num})",
                    now[:10],
                ]
            ],
        )
        self._delete_rows("Items", [idx + 1])
        purchased_ids = self._ensure_tags(["Purchased"], state.tags)
        missing_purchased = [tid for tid in purchased_ids if tid not in item.tag_ids]
        self._append_rows("Item_Tags", [[item_id, tid, now] for tid in missing_purchased])
        self._append_rows(
            "Price_History",
            [
                [
                    f"hist-{uuid.uuid4().hex[:8]}",
                    item_id,
                    now,
                    purchased_price,
                    compute_delta_pct(item.initial_price, purchased_price),
                    "BOUGHT",
                ]
            ],
        )
        return BoughtItem(
            item_id=item.item_id,
            name=item.name,
            url=item.url,
            image_url=item.image_url,
            currency=item.currency,
            initial_price=item.initial_price,
            purchased_price=purchased_price,
            purchased_date=now[:10],
            tag_ids=list(dict.fromkeys([*item.tag_ids, *purchased_ids])),
        )

    def resume_tracking(self, item_id: str) -> TrackedItem:
        """Move item from Bought_Items back to Items."""
        state = self.load_state()
        idx = next(
            (i for i, it in enumerate(state.bought_items) if it.item_id == item_id),
            None,
        )
        if idx is None:
            raise KeyError(f"Bought item not found: {item_id}")
        bought = state.bought_items[idx]
        now = utc_now_iso()
        row_num = len(state.items) + 2
        lowest = min(bought.initial_price, bought.purchased_price)
        self._append_rows(
            "Items",
            [
                [
                    bought.item_id,
                    bought.name,
                    bought.url,
                    bought.image_url,
                    bought.currency,
                    bought.initial_price,
                    bought.purchased_price,
                    bought.purchased_price,
                    lowest,
                    f'=IF(G{row_num}<=H{row_num},"DISCOUNT","ACTIVE")',
                    f"=IF(F{row_num}>0,ROUND(((F{row_num}-G{row_num})/F{row_num})*100,1),0)",
                    now,
                ]
            ],
        )
        self._delete_rows("Bought_Items", [idx + 1])
        self._append_rows(
            "Price_History",
            [
                [
                    f"hist-{uuid.uuid4().hex[:8]}",
                    bought.item_id,
                    now,
                    bought.purchased_price,
                    compute_delta_pct(bought.initial_price, bought.purchased_price),
                    "RESUMED",
                ]
            ],
        )
        return TrackedItem(
            item_id=bought.item_id,
            name=bought.name,
            url=bought.url,
            image_url=bought.image_url,
            currency=bought.currency,
            initial_price=bought.initial_price,
            current_price=bought.purchased_price,
            target_price=bought.purchased_price,
            lowest_price=lowest,
            last_checked=now,
            tag_ids=bought.tag_ids,
        )

    def delete_item(self, item_id: str) -> None:
        """Delete item from Items or Bought_Items and remove Item_Tags links."""
        state = self.load_state()
        active_idx = next(
            (i + 1 for i, it in enumerate(state.items) if it.item_id == item_id),
            None,
        )
        bought_idx = next(
            (i + 1 for i, it in enumerate(state.bought_items) if it.item_id == item_id),
            None,
        )
        if active_idx is None and bought_idx is None:
            raise KeyError(f"Item not found: {item_id}")
        if active_idx is not None:
            self._delete_rows("Items", [active_idx])
        if bought_idx is not None:
            self._delete_rows("Bought_Items", [bought_idx])
        tag_indices = [
            i + 1 for i, link in enumerate(state.item_tags) if link.item_id == item_id
        ]
        self._delete_rows("Item_Tags", tag_indices)

    def apply_price_checks(
        self,
        outcomes: list[ScrapeOutcome],
        telemetry: TelemetryRun,
    ) -> list[PriceSnapshot]:
        """Batch-update Items prices and append Price_History + Telemetry_Logs."""
        state = self.load_state()
        now = utc_now_iso()
        by_id = {it.item_id: (idx, it) for idx, it in enumerate(state.items)}
        updates: list[dict[str, Any]] = []
        history_rows: list[list[Any]] = []
        snapshots: list[PriceSnapshot] = []
        for outcome in outcomes:
            if not outcome.success or outcome.price is None:
                continue
            match = by_id.get(outcome.item_id)
            if match is None:
                continue
            idx, item = match
            row_num = idx + 2
            new_lowest = min(item.lowest_price, outcome.price)
            updates.append(
                {
                    "range": f"Items!G{row_num}:I{row_num}",
                    "values": [[outcome.price, item.target_price, new_lowest]],
                }
            )
            updates.append({"range": f"Items!L{row_num}", "values": [[now]]})
            snap = PriceSnapshot(
                history_id=f"hist-{uuid.uuid4().hex[:8]}",
                item_id=item.item_id,
                recorded_at=now,
                price=outcome.price,
                delta_pct=compute_delta_pct(item.initial_price, outcome.price),
                event_type=PriceEventType.CHECK,
            )
            snapshots.append(snap)
            history_rows.append(
                [
                    snap.history_id,
                    snap.item_id,
                    snap.recorded_at,
                    snap.price,
                    snap.delta_pct,
                    snap.event_type.value,
                ]
            )
        if updates:
            self._service.spreadsheets().values().batchUpdate(
                spreadsheetId=self._spreadsheet_id,
                body={"valueInputOption": "USER_ENTERED", "data": updates},
            ).execute()
        self._append_rows("Price_History", history_rows)
        self._append_rows(
            "Telemetry_Logs",
            [
                [
                    telemetry.run_id,
                    telemetry.started_at,
                    telemetry.status.value,
                    telemetry.items_checked,
                    telemetry.breakdown,
                    telemetry.duration_ms,
                ]
            ],
        )
        return snapshots

    def create_tag(self, name: str, color: str) -> Tag:
        """Append a new tag to Tags."""
        state = self.load_state()
        clean = name.strip()
        if not clean:
            raise ValueError("Tag name cannot be empty")
        if any(t.name.lower() == clean.lower() for t in state.tags):
            raise ValueError(f"Tag already exists: {clean}")
        chosen = color if color in TAG_COLORS else "slate"
        tag = Tag(
            tag_id=f"tag-{uuid.uuid4().hex[:8]}",
            name=clean,
            color=chosen,
            created_at=utc_now_iso(),
        )
        self._append_rows("Tags", [[tag.tag_id, tag.name, tag.color, tag.created_at]])
        return tag

    def update_tag(
        self,
        tag_id: str,
        name: str | None = None,
        color: str | None = None,
    ) -> Tag:
        """Update tag name/color in Tags tab."""
        state = self.load_state()
        idx = next((i for i, t in enumerate(state.tags) if t.tag_id == tag_id), None)
        if idx is None:
            raise KeyError(f"Tag not found: {tag_id}")
        current = state.tags[idx]
        new_name = name.strip() if name is not None else current.name
        new_color = color if color in TAG_COLORS else current.color
        row_num = idx + 2
        self._service.spreadsheets().values().batchUpdate(
            spreadsheetId=self._spreadsheet_id,
            body={
                "valueInputOption": "USER_ENTERED",
                "data": [
                    {
                        "range": f"Tags!B{row_num}:C{row_num}",
                        "values": [[new_name, new_color]],
                    }
                ],
            },
        ).execute()
        return Tag(
            tag_id=current.tag_id,
            name=new_name,
            color=new_color,
            created_at=current.created_at,
        )

    def delete_tag(self, tag_id: str) -> None:
        """Delete tag row from Tags and all matching rows in Item_Tags."""
        state = self.load_state()
        tag_idx = next((i + 1 for i, t in enumerate(state.tags) if t.tag_id == tag_id), None)
        if tag_idx is None:
            raise KeyError(f"Tag not found: {tag_id}")
        self._delete_rows("Tags", [tag_idx])
        link_indices = [
            i + 1 for i, link in enumerate(state.item_tags) if link.tag_id == tag_id
        ]
        self._delete_rows("Item_Tags", link_indices)

    def save_config(self, entries: list[ConfigEntry]) -> list[ConfigEntry]:
        """Rewrite Config rows with updated values."""
        state = self.load_state()
        by_key = {c.key: c for c in state.config}
        for entry in entries:
            by_key[entry.key] = entry
        merged = list(by_key.values())
        self._service.spreadsheets().values().clear(
            spreadsheetId=self._spreadsheet_id,
            range="Config!A2:C",
        ).execute()
        self._append_rows("Config", [[c.key, c.value, c.description] for c in merged])
        return merged
