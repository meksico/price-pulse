"""FastAPI presentation layer for PricePulse."""

from __future__ import annotations

import asyncio
import hmac
import json
import os
import re
import time
import traceback
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import asdict
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from pricepulse.adapters.gemini_search_fallback import (
    GeminiSearchFallbackClient,
    format_monthly_usage,
    is_cooldown_elapsed,
    parse_monthly_usage,
)
from pricepulse.adapters.gmail_notifier import (
    GmailDigestNotifier,
    build_gmail_service,
)
from pricepulse.adapters.google_sheets import (
    GoogleSheetsRepository,
    build_sheets_service,
)
from pricepulse.adapters.local_json import (
    DeterministicScraperAdapter,
    InMemoryNotificationAdapter,
    LocalJsonRepository,
)
from pricepulse.adapters.playwright_scraper import (
    CaptchaBlockedError,
    PlaywrightScraperAdapter,
)
from pricepulse.diagnostics import (
    StructuredLogger,
    collect_runtime_diagnostics,
    collect_third_party_resources_async,
    parse_allowed_emails,
)
from pricepulse.domain.models import (
    APP_VERSION,
    ConfigEntry,
    NewItemSpec,
    RunStatus,
    ScrapeOutcome,
    ScrapePreview,
    TelemetryRun,
    TrackedItem,
    should_alert,
    utc_now_iso,
)
from pricepulse.ports.repositories import (
    NotificationPort,
    ScraperPort,
    StateRepositoryPort,
)


class AddItemRequest(BaseModel):
    """Payload for creating a tracked item."""

    name: str
    url: str
    image_url: str = ""
    currency: str = "$"
    initial_price: float = Field(gt=0)
    target_price: float = Field(gt=0)
    tag_names: list[str] = Field(default_factory=list)


class UpdateItemRequest(BaseModel):
    """Payload for updating an active tracked item."""

    name: str | None = None
    target_price: float | None = Field(default=None, gt=0)
    tag_names: list[str] | None = None
    current_price: float | None = Field(default=None, gt=0)


class BulkTagsRequest(BaseModel):
    """Payload for bulk adding, replacing, or removing tags on active items."""

    item_ids: list[str] = Field(min_length=1)
    action: Literal["add", "replace", "remove"]
    tag_names: list[str] = Field(default_factory=list)


class BulkItemIdsRequest(BaseModel):
    """Payload for bulk operations targeting multiple item IDs."""

    item_ids: list[str] = Field(min_length=1)


class MarkBoughtRequest(BaseModel):
    """Payload for archiving an item as bought."""

    purchased_price: float = Field(ge=0)


class CreateTagRequest(BaseModel):
    """Payload for creating a flat tag."""

    name: str
    color: str = "slate"


class UpdateTagRequest(BaseModel):
    """Payload for renaming or recoloring a tag."""

    name: str | None = None
    color: str | None = None


class SaveConfigRequest(BaseModel):
    """Payload for saving workspace config entries."""

    entries: list[dict[str, str]]


class PreviewUrlRequest(BaseModel):
    """Payload for previewing a product URL."""

    url: str


class PreviewBatchRequest(BaseModel):
    """Payload for batch previewing up to 20 product URLs."""

    urls: list[str] = Field(min_length=1, max_length=20)


class BatchAddItemsRequest(BaseModel):
    """Payload for batch creating up to 20 tracked items."""

    items: list[AddItemRequest] = Field(min_length=1, max_length=20)


def _serialize_item(item: TrackedItem) -> dict[str, Any]:
    """Serialize TrackedItem including computed status and drop_pct."""
    data = asdict(item)
    data["status"] = item.status.value
    data["drop_pct"] = item.drop_pct
    return data


def _serialize_state(repo: StateRepositoryPort) -> dict[str, Any]:
    """Serialize WorkspaceState for JSON HTTP responses."""
    state = repo.load_state()
    bought = []
    for entry in state.bought_items:
        row = asdict(entry)
        row["saved_cost"] = entry.saved_cost
        bought.append(row)
    env_sheet_id = os.getenv("SPREADSHEET_ID", "").strip()
    config_rows: list[dict[str, str]] = []
    has_sheet_id = False
    for cfg in state.config:
        cfg_row = asdict(cfg)
        if cfg.key == "spreadsheet_id":
            has_sheet_id = True
            if not cfg_row["value"] and env_sheet_id:
                cfg_row["value"] = env_sheet_id
        config_rows.append(cfg_row)
    if not has_sheet_id and env_sheet_id:
        config_rows.append(
            {
                "key": "spreadsheet_id",
                "value": env_sheet_id,
                "description": "Google Sheets Workbook ID",
            }
        )
    return {
        "items": [_serialize_item(item) for item in state.items],
        "bought_items": bought,
        "tags": [asdict(tag) for tag in state.tags],
        "item_tags": [asdict(link) for link in state.item_tags],
        "price_history": [
            {**asdict(snap), "event_type": snap.event_type.value}
            for snap in state.price_history
        ],
        "telemetry_logs": [
            {**asdict(run), "status": run.status.value}
            for run in state.telemetry_logs
        ],
        "config": config_rows,
    }


def _resolve_alert_recipient(
    user_email: str,
    config_entries: list[ConfigEntry],
) -> str:
    """Resolve comma-separated report recipients, preferring ALLOWED_OWNER_EMAIL."""
    allowed_emails = parse_allowed_emails()
    if allowed_emails:
        return ", ".join(allowed_emails)
    if "@" in user_email:
        return user_email.strip()
    return next(
        (
            c.value.strip()
            for c in config_entries
            if c.key == "gmail_alert_recipient" and c.value.strip()
        ),
        "",
    )


def _verify_auth(authorization: str | None = Header(default=None)) -> str:
    """Verify Google Bearer token in production; allow local dev bypass."""
    auth_mode = os.getenv("AUTH_MODE", "local_dev")
    if auth_mode == "local_dev":
        return "local-dev-user"
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    resp = httpx.get(
        "https://oauth2.googleapis.com/tokeninfo",
        params={"access_token": token},
        timeout=5.0,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid Google OAuth token")
    info = resp.json()
    expected_client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    token_aud = str(info.get("aud", "")).strip()
    token_azp = str(info.get("azp", "")).strip()
    if expected_client_id and expected_client_id not in (token_aud, token_azp):
        raise HTTPException(status_code=403, detail="OAuth token client mismatch")

    email = str(info.get("email", "")).lower()
    allowed_emails = parse_allowed_emails()
    if allowed_emails and email not in allowed_emails:
        raise HTTPException(status_code=403, detail="Unauthorized Google account")
    return email or "authenticated-user"


def _resolve_runtime_adapters(
    repo: StateRepositoryPort | None,
    scraper: ScraperPort | None,
    notifier: NotificationPort | None,
) -> tuple[str, StateRepositoryPort, ScraperPort, NotificationPort]:
    """Select concrete adapters based on environment configuration."""
    storage_mode = os.getenv("STORAGE_ADAPTER", "local_json")
    scraper_mode = os.getenv("SCRAPER_ADAPTER", "deterministic")

    if repo is not None:
        resolved_repo = repo
    elif storage_mode == "google_sheets":
        sheets_svc = build_sheets_service(
            client_id=os.environ["GOOGLE_CLIENT_ID"],
            client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
            refresh_token=os.environ["GOOGLE_OAUTH_REFRESH_TOKEN"],
        )
        resolved_repo = GoogleSheetsRepository(
            spreadsheet_id=os.environ["SPREADSHEET_ID"],
            service=sheets_svc,
        )
    else:
        data_file = os.getenv("LOCAL_STATE_PATH")
        resolved_repo = LocalJsonRepository(Path(data_file) if data_file else None)

    if scraper is not None:
        resolved_scraper = scraper
    elif scraper_mode == "playwright":
        resolved_scraper = PlaywrightScraperAdapter()
    else:
        resolved_scraper = DeterministicScraperAdapter()

    if notifier is not None:
        resolved_notifier = notifier
    elif storage_mode == "google_sheets":
        gmail_svc = build_gmail_service(
            client_id=os.environ["GOOGLE_CLIENT_ID"],
            client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
            refresh_token=os.environ["GOOGLE_OAUTH_REFRESH_TOKEN"],
        )
        resolved_notifier = GmailDigestNotifier(service=gmail_svc)
    else:
        resolved_notifier = InMemoryNotificationAdapter()

    return storage_mode, resolved_repo, resolved_scraper, resolved_notifier


def _resolve_frontend_dist(explicit_dir: Path | None) -> Path | None:
    """Resolve the built frontend dist directory if available."""
    if explicit_dir is not None:
        return explicit_dir if (explicit_dir / "index.html").is_file() else None
    env_dir = os.getenv("FRONTEND_DIST_DIR", "").strip()
    if env_dir:
        candidate = Path(env_dir)
        return candidate if (candidate / "index.html").is_file() else None
    default_dir = Path(__file__).resolve().parents[4] / "frontend" / "dist"
    return default_dir if (default_dir / "index.html").is_file() else None


def _mount_spa_routes(app: FastAPI, dist_dir: Path) -> None:
    """Mount static SPA assets and catch-all index.html fallback."""
    resolved_root = dist_dir.resolve()
    assets_dir = resolved_root / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="spa-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa_fallback(full_path: str) -> FileResponse:
        """Serve static SPA files or fall back to index.html for client routes."""
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        if full_path:
            candidate = (resolved_root / full_path).resolve()
            if candidate.is_relative_to(resolved_root) and candidate.is_file():
                return FileResponse(candidate)
        return FileResponse(resolved_root / "index.html", media_type="text/html")


def create_app(
    repo: StateRepositoryPort | None = None,
    scraper: ScraperPort | None = None,
    notifier: NotificationPort | None = None,
    frontend_dist_dir: Path | None = None,
    gemini_fallback: GeminiSearchFallbackClient | None = None,
) -> FastAPI:
    """Create and configure the PricePulse FastAPI application."""
    storage_mode, resolved_repo, resolved_scraper, resolved_notifier = (
        _resolve_runtime_adapters(repo, scraper, notifier)
    )
    resolved_gemini = (
        gemini_fallback
        if gemini_fallback is not None
        else GeminiSearchFallbackClient.from_env()
    )
    logger = StructuredLogger()
    logger.info(f"PricePulse API v{APP_VERSION} initialized (adapter={storage_mode})")

    app = FastAPI(title="PricePulse API", version=APP_VERSION)
    cors_origins = os.getenv(
        "CORS_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173,https://meksico.github.io",
    ).split(",")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[origin.strip() for origin in cors_origins if origin.strip()],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def get_health() -> dict[str, Any]:
        """Expose runtime diagnostics and recent structured logs."""
        diag = collect_runtime_diagnostics(storage_mode, logger)
        return asdict(diag)

    @app.get("/api/resources")
    async def get_resources(_user: str = Depends(_verify_auth)) -> dict[str, Any]:
        """Return unified 3rd-party resources & dependency inventory."""
        state = resolved_repo.load_state()
        auth_mode = os.getenv("AUTH_MODE", "local_dev")
        scraper_mode = os.getenv("SCRAPER_ADAPTER", "deterministic")
        inventory = await collect_third_party_resources_async(
            storage_mode=storage_mode,
            scraper_mode=scraper_mode,
            auth_mode=auth_mode,
            state=state,
            probe=False,
            repo=resolved_repo,
            notifier=resolved_notifier,
        )
        return asdict(inventory)

    @app.post("/api/resources/probe")
    async def probe_resources(_user: str = Depends(_verify_auth)) -> dict[str, Any]:
        """Run non-mutating live connectivity checks across all 3rd-party providers."""
        state = resolved_repo.load_state()
        auth_mode = os.getenv("AUTH_MODE", "local_dev")
        scraper_mode = os.getenv("SCRAPER_ADAPTER", "deterministic")
        inventory = await collect_third_party_resources_async(
            storage_mode=storage_mode,
            scraper_mode=scraper_mode,
            auth_mode=auth_mode,
            state=state,
            probe=True,
            repo=resolved_repo,
            notifier=resolved_notifier,
        )
        return asdict(inventory)

    @app.get("/api/state")
    def get_state(_user: str = Depends(_verify_auth)) -> dict[str, Any]:
        """Return complete 7-tab workspace state."""
        return _serialize_state(resolved_repo)

    @app.post("/api/items")
    def create_item(
        payload: AddItemRequest,
        _user: str = Depends(_verify_auth),
    ) -> dict[str, Any]:
        """Create a new tracked item."""
        item = resolved_repo.add_item(
            name=payload.name,
            url=payload.url,
            image_url=payload.image_url,
            currency=payload.currency,
            initial_price=payload.initial_price,
            target_price=payload.target_price,
            tag_names=payload.tag_names,
        )
        logger.info(f"Added tracked item {item.item_id}: {item.name}")
        return _serialize_item(item)

    @app.post("/api/items/batch")
    def create_items_batch(
        payload: BatchAddItemsRequest,
        _user: str = Depends(_verify_auth),
    ) -> dict[str, Any]:
        """Create up to 20 tracked items in a single batched write."""
        specs = [
            NewItemSpec(
                name=row.name,
                url=row.url,
                image_url=row.image_url,
                currency=row.currency,
                initial_price=row.initial_price,
                target_price=row.target_price,
                tag_names=row.tag_names,
            )
            for row in payload.items
        ]
        created = resolved_repo.add_items_batch(specs)
        logger.info(f"Added {len(created)} tracked items in batch")
        return {"items": [_serialize_item(item) for item in created]}

    @app.patch("/api/items/{item_id}")
    def patch_item(
        item_id: str,
        payload: UpdateItemRequest,
        _user: str = Depends(_verify_auth),
    ) -> dict[str, Any]:
        """Update an active tracked item."""
        try:
            item = resolved_repo.update_item(
                item_id=item_id,
                name=payload.name,
                target_price=payload.target_price,
                tag_names=payload.tag_names,
                current_price=payload.current_price,
            )
            return _serialize_item(item)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/api/items/{item_id}/buy")
    def buy_item(
        item_id: str,
        payload: MarkBoughtRequest,
        _user: str = Depends(_verify_auth),
    ) -> dict[str, Any]:
        """Move an active item to Bought_Items."""
        try:
            bought = resolved_repo.mark_bought(item_id, payload.purchased_price)
            logger.info(f"Archived item {item_id} to Bought_Items")
            return {**asdict(bought), "saved_cost": bought.saved_cost}
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/api/items/{item_id}/resume")
    def resume_item(
        item_id: str,
        _user: str = Depends(_verify_auth),
    ) -> dict[str, Any]:
        """Restore a bought item back to active tracking."""
        try:
            restored = resolved_repo.resume_tracking(item_id)
            logger.info(f"Resumed tracking for item {item_id}")
            return _serialize_item(restored)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.delete("/api/items/{item_id}")
    def remove_item(
        item_id: str,
        _user: str = Depends(_verify_auth),
    ) -> dict[str, str]:
        """Delete a tracked or bought item."""
        try:
            resolved_repo.delete_item(item_id)
            logger.info(f"Deleted item {item_id}")
            return {"status": "deleted", "item_id": item_id}
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/api/items/bulk-tags")
    def bulk_update_item_tags(
        payload: BulkTagsRequest,
        _user: str = Depends(_verify_auth),
    ) -> dict[str, Any]:
        """Add, replace, or remove tags across multiple active tracked items."""
        try:
            updated = resolved_repo.bulk_update_tags(
                item_ids=payload.item_ids,
                action=payload.action,
                tag_names=payload.tag_names,
            )
            logger.info(
                f"Bulk tag {payload.action} applied to {len(updated)} items"
            )
            return {"items": [_serialize_item(item) for item in updated]}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/items/bulk-delete")
    def bulk_delete_items(
        payload: BulkItemIdsRequest,
        _user: str = Depends(_verify_auth),
    ) -> dict[str, Any]:
        """Delete multiple active or bought items in one batched operation."""
        deleted = resolved_repo.bulk_delete_items(payload.item_ids)
        logger.info(f"Bulk deleted {len(deleted)} items")
        return {"status": "deleted", "deleted_ids": deleted}

    @app.post("/api/tags")
    def create_tag(
        payload: CreateTagRequest,
        _user: str = Depends(_verify_auth),
    ) -> dict[str, Any]:
        """Create a new 1-level flat tag."""
        try:
            tag = resolved_repo.create_tag(payload.name, payload.color)
            return asdict(tag)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.patch("/api/tags/{tag_id}")
    def patch_tag(
        tag_id: str,
        payload: UpdateTagRequest,
        _user: str = Depends(_verify_auth),
    ) -> dict[str, Any]:
        """Rename or recolor an existing tag."""
        try:
            tag = resolved_repo.update_tag(tag_id, payload.name, payload.color)
            return asdict(tag)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.delete("/api/tags/{tag_id}")
    def remove_tag(
        tag_id: str,
        _user: str = Depends(_verify_auth),
    ) -> dict[str, str]:
        """Delete a tag and cascade unlink."""
        try:
            resolved_repo.delete_tag(tag_id)
            return {"status": "deleted", "tag_id": tag_id}
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.put("/api/config")
    def put_config(
        payload: SaveConfigRequest,
        _user: str = Depends(_verify_auth),
    ) -> dict[str, Any]:
        """Persist Config entries."""
        entries = [
            ConfigEntry(
                key=row["key"],
                value=row["value"],
                description=row.get("description", ""),
            )
            for row in payload.entries
        ]
        saved = resolved_repo.save_config(entries)
        return {"config": [asdict(cfg) for cfg in saved]}

    @app.post("/api/sheets/bootstrap")
    def bootstrap_sheets(_user: str = Depends(_verify_auth)) -> dict[str, Any]:
        """Ensure all 7 workbook tabs exist."""
        tabs = resolved_repo.ensure_schema()
        return {"initialized_tabs": tabs}

    def _read_gemini_usage(config: list[ConfigEntry], current_month: str) -> int:
        raw_usage = next(
            (c.value.strip() for c in config if c.key == "gemini_grounding_usage"),
            "",
        )
        return parse_monthly_usage(raw_usage, current_month)

    def _is_captcha_or_forbidden(err: str) -> bool:
        return "CAPTCHA_BLOCKED" in err or "HTTP 403" in err

    def _is_gemini_fallback_eligible(err: str) -> bool:
        return _is_captcha_or_forbidden(err) or "ERR_HTTP2_PROTOCOL_ERROR" in err

    async def _try_gemini_preview_fallback(url: str) -> ScrapePreview | None:
        if not resolved_gemini.is_enabled:
            return None
        current_month = utc_now_iso()[:7]
        state = resolved_repo.load_state()
        used = _read_gemini_usage(state.config, current_month)
        if used >= resolved_gemini.monthly_cap:
            return None
        try:
            gemini_res = await resolved_gemini.extract_price(url)
        except Exception as gemini_exc:
            logger.warn(f"Gemini fallback failed for preview {url}: {gemini_exc}")
            return None
        if gemini_res is None:
            return None
        resolved_repo.save_config(
            [
                ConfigEntry(
                    key="gemini_grounding_usage",
                    value=format_monthly_usage(
                        current_month,
                        used + gemini_res.queries_used,
                    ),
                )
            ]
        )
        return ScrapePreview(
            url=url,
            title=gemini_res.title,
            price=gemini_res.price,
            currency=gemini_res.currency,
            image_url=gemini_res.image_url,
            extraction_tier="gemini_search",
        )

    @app.post("/api/scrape/preview")
    async def preview_url(
        payload: PreviewUrlRequest,
        _user: str = Depends(_verify_auth),
    ) -> dict[str, Any]:
        """Scrape preview metadata for a single product URL."""
        try:
            preview = await resolved_scraper.preview_url(payload.url)
            return asdict(preview)
        except Exception as exc:
            if isinstance(exc, CaptchaBlockedError) or _is_captcha_or_forbidden(
                str(exc)
            ):
                fallback_preview = await _try_gemini_preview_fallback(payload.url)
                if fallback_preview is not None:
                    return asdict(fallback_preview)
                logger.warn(
                    f"Preview blocked by CAPTCHA/WAF for {payload.url}: {exc}"
                )
                raise HTTPException(status_code=422, detail=str(exc)) from exc
            logger.error(f"Preview scrape failed for {payload.url}", exc=exc)
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    @app.post("/api/scrape/preview-batch")
    async def preview_urls_batch(
        payload: PreviewBatchRequest,
        _user: str = Depends(_verify_auth),
    ) -> dict[str, Any]:
        """Scrape preview metadata for up to 20 URLs concurrently."""
        clean_urls = [u.strip() for u in payload.urls if u.strip()]
        if not clean_urls:
            raise HTTPException(status_code=400, detail="Provide at least one URL")
        if len(clean_urls) > 20:
            raise HTTPException(status_code=400, detail="Maximum 20 URLs per batch")
        outcomes = await resolved_scraper.preview_urls(clean_urls)
        results: list[dict[str, Any]] = []
        for outcome in outcomes:
            preview_obj = outcome.preview
            success = outcome.success
            error = outcome.error
            if not success and _is_captcha_or_forbidden(error or ""):
                fallback_preview = await _try_gemini_preview_fallback(outcome.url)
                if fallback_preview is not None:
                    preview_obj = fallback_preview
                    success = True
                    error = None
            results.append(
                {
                    "url": outcome.url,
                    "success": success,
                    "preview": (
                        asdict(preview_obj) if preview_obj is not None else None
                    ),
                    "error": error,
                }
            )
        return {"results": results}

    def _extract_domain(url: str) -> str:
        host = urlsplit(url).netloc.lower()
        return host[4:] if host.startswith("www.") else host

    def _extract_short_error_code(error: str | None) -> str | None:
        if not error:
            return None
        match = re.search(r"\b(?:HTTP\s+)?([45]\d{2})\b", error)
        if match:
            return match.group(1)
        lowered = error.lower()
        if "captcha" in lowered:
            return "CAPTCHA"
        if "timeout" in lowered or "timed out" in lowered:
            return "Timeout"
        return "Error"

    async def _execute_batch_check(
        user_email: str = "",
        respect_cooldown: bool = True,
        target_item_id: str | None = None,
        target_item_ids: list[str] | None = None,
        on_event: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ) -> dict[str, Any]:
        """Run pooled price check (all items or subset), update state, and send digest."""
        run_id = f"run-{uuid.uuid4().hex[:8]}"
        started_at = utc_now_iso()
        start_ms = time.perf_counter()
        state = resolved_repo.load_state()
        target_items = state.items
        if target_item_id is not None:
            target_items = [
                item for item in state.items if item.item_id == target_item_id
            ]
            if not target_items:
                raise HTTPException(
                    status_code=404,
                    detail=f"Unknown item_id: {target_item_id}",
                )
        elif target_item_ids is not None:
            target_set = set(target_item_ids)
            target_items = [
                item for item in state.items if item.item_id in target_set
            ]
            if not target_items:
                raise HTTPException(
                    status_code=404,
                    detail="No matching active items found for bulk re-check",
                )
        prev_by_id = {
            item.item_id: (item.status, item.lowest_price) for item in target_items
        }
        items_by_target_id = {item.item_id: item for item in target_items}
        total_items = len(target_items)

        async def _emit(payload: dict[str, Any]) -> None:
            if on_event is not None:
                await on_event(payload)

        await _emit(
            {
                "type": "started",
                "run_id": run_id,
                "total": total_items,
                "items": [
                    {
                        "item_id": item.item_id,
                        "name": item.name,
                        "domain": _extract_domain(item.url),
                        "url": item.url,
                    }
                    for item in target_items
                ],
            }
        )

        scrape_completed = 0

        async def _on_scrape_progress(outcome: ScrapeOutcome) -> None:
            nonlocal scrape_completed
            scrape_completed += 1
            matched = items_by_target_id.get(outcome.item_id)
            await _emit(
                {
                    "type": "item_done",
                    "phase": "scrape",
                    "item_id": outcome.item_id,
                    "name": matched.name if matched is not None else outcome.item_id,
                    "domain": _extract_domain(matched.url) if matched is not None else "",
                    "success": outcome.success,
                    "price": outcome.price,
                    "currency": outcome.currency,
                    "extraction_tier": outcome.extraction_tier,
                    "error": outcome.error,
                    "error_code": _extract_short_error_code(outcome.error),
                    "completed": scrape_completed,
                    "total": total_items,
                }
            )

        if on_event is not None:
            outcomes = await resolved_scraper.check_items(
                target_items,
                on_progress=_on_scrape_progress,
            )
        else:
            outcomes = await resolved_scraper.check_items(target_items)
        if resolved_gemini.is_enabled:
            current_month = utc_now_iso()[:7]
            initial_used = _read_gemini_usage(state.config, current_month)
            used = initial_used
            state_items_by_id = {item.item_id: item for item in target_items}
            remaining_budget = max(0, resolved_gemini.monthly_cap - used)
            eligible: list[tuple[int, TrackedItem]] = []
            for idx, outcome in enumerate(outcomes):
                if outcome.success or not _is_gemini_fallback_eligible(
                    outcome.error or ""
                ):
                    continue
                matched = state_items_by_id.get(outcome.item_id)
                if matched is None:
                    continue
                if respect_cooldown and not is_cooldown_elapsed(
                    matched.last_checked, resolved_gemini.cooldown_hours
                ):
                    continue
                eligible.append((idx, matched))

            if eligible and remaining_budget == 0:
                cap = resolved_gemini.monthly_cap
                logger.warn(
                    f"Gemini grounding monthly cap reached ({used}/{cap}); "
                    "skipping remaining fallback checks."
                )
            elif eligible:
                to_check = eligible[:remaining_budget]
                await _emit(
                    {
                        "type": "phase",
                        "phase": "gemini_fallback",
                        "total": len(to_check),
                    }
                )
                if len(eligible) > remaining_budget:
                    cap = resolved_gemini.monthly_cap
                    logger.warn(
                        f"Gemini grounding monthly cap reached ({used}/{cap}); "
                        f"checking {len(to_check)} of {len(eligible)} blocked items."
                    )
                gemini_sem = asyncio.Semaphore(4)
                gemini_completed = 0

                async def _run_gemini_item(
                    idx: int, item: TrackedItem
                ) -> tuple[int, TrackedItem, Any]:
                    nonlocal gemini_completed
                    async with gemini_sem:
                        res: Any = None
                        try:
                            res = await resolved_gemini.extract_price(
                                item.url,
                                title=item.name,
                                currency_hint=item.currency,
                            )
                        except Exception as gemini_exc:
                            logger.warn(
                                f"Gemini fallback failed for {item.url}: {gemini_exc}"
                            )
                        gemini_completed += 1
                        if res is not None:
                            await _emit(
                                {
                                    "type": "item_done",
                                    "phase": "gemini_fallback",
                                    "item_id": item.item_id,
                                    "name": item.name,
                                    "domain": _extract_domain(item.url),
                                    "success": True,
                                    "price": res.price,
                                    "currency": res.currency,
                                    "extraction_tier": "gemini_search",
                                    "error": None,
                                    "error_code": None,
                                    "completed": gemini_completed,
                                    "total": len(to_check),
                                }
                            )
                        return idx, item, res

                gemini_results = await asyncio.gather(
                    *(_run_gemini_item(idx, item) for idx, item in to_check)
                )
                for idx, matched, gemini_res in gemini_results:
                    if gemini_res is not None:
                        used += gemini_res.queries_used
                        outcomes[idx] = ScrapeOutcome(
                            item_id=matched.item_id,
                            success=True,
                            price=gemini_res.price,
                            currency=gemini_res.currency,
                            extraction_tier="gemini_search",
                            error=None,
                        )
            if used > initial_used:
                resolved_repo.save_config(
                    [
                        ConfigEntry(
                            key="gemini_grounding_usage",
                            value=format_monthly_usage(current_month, used),
                        )
                    ]
                )
        succeeded = sum(1 for o in outcomes if o.success)
        failed = len(outcomes) - succeeded
        errors = [o.error for o in outcomes if o.error]
        status = (
            RunStatus.SUCCESS
            if failed == 0
            else (RunStatus.PARTIAL if succeeded > 0 else RunStatus.ERROR)
        )
        duration_ms = int((time.perf_counter() - start_ms) * 1000)
        await _emit({"type": "phase", "phase": "saving"})
        telemetry = TelemetryRun(
            run_id=run_id,
            started_at=started_at,
            status=status,
            items_checked=len(outcomes),
            breakdown=f"{succeeded}/{len(outcomes)} URLs Checked & Saved",
            duration_ms=duration_ms,
            errors=errors,
        )
        resolved_repo.apply_price_checks(outcomes, telemetry)
        await _emit({"type": "phase", "phase": "notifying"})
        updated_state = resolved_repo.load_state()
        alert_items: list[TrackedItem] = []
        for item in updated_state.items:
            prev = prev_by_id.get(item.item_id)
            if prev is not None and should_alert(
                prev[0], prev[1], item.current_price, item.target_price
            ):
                alert_items.append(item)
        recipient = _resolve_alert_recipient(user_email, updated_state.config)
        digest_sent = resolved_notifier.send_discount_digest(recipient, alert_items)

        items_by_id = {item.item_id: item for item in updated_state.items}
        legacy_manual_tag = next(
            (t for t in updated_state.tags if t.name.strip().lower() == "manual check"),
            None,
        )
        if legacy_manual_tag is not None:
            resolved_repo.delete_tag(legacy_manual_tag.tag_id)

        captcha_blocked_items: list[tuple[TrackedItem, str]] = []
        for outcome in outcomes:
            err = outcome.error or ""
            if not outcome.success and _is_captcha_or_forbidden(err):
                matched_item = items_by_id.get(outcome.item_id)
                if matched_item is not None:
                    captcha_blocked_items.append((matched_item, err))

        today_utc = utc_now_iso()[:10]
        last_captcha_date = next(
            (
                c.value.strip()
                for c in updated_state.config
                if c.key == "last_captcha_report_date"
            ),
            "",
        )
        captcha_report_sent = False
        if captcha_blocked_items and recipient and last_captcha_date != today_utc:
            app_base_url = os.getenv(
                "FRONTEND_BASE_URL", "https://meksico.github.io/price-pulse"
            ).strip()
            captcha_report_sent = resolved_notifier.send_captcha_report(
                recipient,
                captcha_blocked_items,
                app_base_url,
            )
            if captcha_report_sent:
                resolved_repo.save_config(
                    [ConfigEntry(key="last_captcha_report_date", value=today_utc)]
                )

        logger.info(
            f"Batch run {telemetry.run_id}: {telemetry.breakdown} "
            f"({duration_ms}ms, alerts={len(alert_items)}, digest_sent={digest_sent}, "
            f"captcha_report_sent={captcha_report_sent})"
        )
        if errors:
            logger.warn(f"Batch run {telemetry.run_id} errors: {errors}")
            print(f"[WARN] Batch run {telemetry.run_id} errors: {errors}", flush=True)
        result_payload = {
            "telemetry": {**asdict(telemetry), "status": telemetry.status.value},
            "alerts_triggered": len(alert_items),
            "digest_sent": digest_sent,
            "captcha_report_sent": captcha_report_sent,
        }
        await _emit({"type": "complete", **result_payload})
        return result_payload

    @app.post("/api/items/{item_id}/recheck")
    async def recheck_item(
        item_id: str,
        _user: str = Depends(_verify_auth),
    ) -> dict[str, Any]:
        """Trigger an immediate single-item price check from the Item Card."""
        result = await _execute_batch_check(
            user_email=_user,
            respect_cooldown=False,
            target_item_id=item_id,
        )
        telemetry = result["telemetry"]
        if telemetry["status"] == RunStatus.ERROR.value:
            errors = telemetry.get("errors") or []
            err_msg = str(errors[0]) if errors else f"Failed to re-check {item_id}"
            status_code = 422 if _is_captcha_or_forbidden(err_msg) else 502
            raise HTTPException(status_code=status_code, detail=err_msg)
        updated_state = resolved_repo.load_state()
        updated = next(
            (item for item in updated_state.items if item.item_id == item_id),
            None,
        )
        if updated is None:
            raise HTTPException(status_code=404, detail=f"Unknown item_id: {item_id}")
        return {
            "item": _serialize_item(updated),
            "telemetry": telemetry,
            "alerts_triggered": result["alerts_triggered"],
        }

    @app.post("/api/items/bulk-recheck")
    async def bulk_recheck_items(
        payload: BulkItemIdsRequest,
        _user: str = Depends(_verify_auth),
    ) -> dict[str, Any]:
        """Trigger immediate pooled price check for selected active items."""
        return await _execute_batch_check(
            user_email=_user,
            respect_cooldown=False,
            target_item_ids=payload.item_ids,
        )

    @app.post("/api/scrape/run-check")
    async def run_check(_user: str = Depends(_verify_auth)) -> dict[str, Any]:
        """Trigger immediate batch price check from SPA."""
        return await _execute_batch_check(user_email=_user, respect_cooldown=False)

    @app.post("/api/scrape/run-check/stream")
    async def run_check_stream(
        _user: str = Depends(_verify_auth),
    ) -> StreamingResponse:
        """Stream real-time batch price check progress events via SSE."""
        queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

        async def _push_event(event: dict[str, Any]) -> None:
            await queue.put(event)

        async def _worker() -> None:
            try:
                await _execute_batch_check(
                    user_email=_user,
                    respect_cooldown=False,
                    on_event=_push_event,
                )
            except Exception as exc:
                tb = traceback.format_exc()
                logger.error(f"Streaming batch check failed: {exc}\n{tb}")
                await queue.put(
                    {
                        "type": "error",
                        "detail": str(exc),
                        "traceback": tb,
                    }
                )
            finally:
                await queue.put(None)

        async def _event_stream() -> AsyncIterator[str]:
            task = asyncio.create_task(_worker())
            try:
                while True:
                    item = await queue.get()
                    if item is None:
                        break
                    yield f"data: {json.dumps(item)}\n\n"
            finally:
                if not task.done():
                    task.cancel()

        return StreamingResponse(
            _event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @app.post("/api/cron/run-check")
    async def cron_run_check(
        x_cron_secret: str | None = Header(default=None),
    ) -> dict[str, Any]:
        """Trigger scheduled batch price check from Cloud Scheduler."""
        expected = os.getenv("CRON_SECRET", "").strip()
        if expected and not hmac.compare_digest(x_cron_secret or "", expected):
            raise HTTPException(status_code=403, detail="Invalid cron secret")
        return await _execute_batch_check(respect_cooldown=True)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(
        _request: Request,
        exc: Exception,
    ) -> JSONResponse:
        """Capture full traceback for unhandled errors (RULE-DIAG)."""
        tb = traceback.format_exc()
        logger.error(f"Unhandled server error: {exc}\n{tb}")
        return JSONResponse(
            status_code=500,
            content={"detail": str(exc), "traceback": tb},
        )

    dist_dir = _resolve_frontend_dist(frontend_dist_dir)
    if dist_dir is not None:
        _mount_spa_routes(app, dist_dir)

    return app


app = create_app()

