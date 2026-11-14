"""FastAPI presentation layer for PricePulse."""

from __future__ import annotations

import os
import time
import traceback
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Any

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

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
from pricepulse.adapters.playwright_scraper import PlaywrightScraperAdapter
from pricepulse.diagnostics import StructuredLogger, collect_runtime_diagnostics
from pricepulse.domain.models import (
    APP_VERSION,
    ConfigEntry,
    RunStatus,
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
        "config": [asdict(cfg) for cfg in state.config],
    }


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
    email = str(info.get("email", "")).lower()
    allowed_email = os.getenv("ALLOWED_OWNER_EMAIL", "").strip().lower()
    if allowed_email and email != allowed_email:
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
) -> FastAPI:
    """Create and configure the PricePulse FastAPI application."""
    storage_mode, resolved_repo, resolved_scraper, resolved_notifier = (
        _resolve_runtime_adapters(repo, scraper, notifier)
    )
    logger = StructuredLogger()
    logger.info(f"PricePulse API v{APP_VERSION} initialized (adapter={storage_mode})")

    app = FastAPI(title="PricePulse API", version=APP_VERSION)
    cors_origins = os.getenv(
        "CORS_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173",
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
            logger.error(f"Preview scrape failed for {payload.url}", exc=exc)
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    async def _execute_batch_check() -> dict[str, Any]:
        """Run pooled batch price check, update state, and send digest."""
        started_at = utc_now_iso()
        start_ms = time.perf_counter()
        state = resolved_repo.load_state()
        prev_by_id = {
            item.item_id: (item.status, item.lowest_price) for item in state.items
        }
        outcomes = await resolved_scraper.check_items(state.items)
        succeeded = sum(1 for o in outcomes if o.success)
        failed = len(outcomes) - succeeded
        errors = [o.error for o in outcomes if o.error]
        status = (
            RunStatus.SUCCESS
            if failed == 0
            else (RunStatus.PARTIAL if succeeded > 0 else RunStatus.ERROR)
        )
        duration_ms = int((time.perf_counter() - start_ms) * 1000)
        telemetry = TelemetryRun(
            run_id=f"run-{uuid.uuid4().hex[:8]}",
            started_at=started_at,
            status=status,
            items_checked=len(outcomes),
            breakdown=f"{succeeded}/{len(outcomes)} URLs Checked & Saved",
            duration_ms=duration_ms,
            errors=errors,
        )
        resolved_repo.apply_price_checks(outcomes, telemetry)
        updated_state = resolved_repo.load_state()
        alert_items: list[TrackedItem] = []
        for item in updated_state.items:
            prev = prev_by_id.get(item.item_id)
            if prev is not None and should_alert(
                prev[0], prev[1], item.current_price, item.target_price
            ):
                alert_items.append(item)
        recipient = next(
            (c.value for c in updated_state.config if c.key == "gmail_alert_recipient"),
            "",
        )
        digest_sent = resolved_notifier.send_discount_digest(recipient, alert_items)
        logger.info(
            f"Batch run {telemetry.run_id}: {telemetry.breakdown} "
            f"({duration_ms}ms, alerts={len(alert_items)}, digest_sent={digest_sent})"
        )
        return {
            "telemetry": {**asdict(telemetry), "status": telemetry.status.value},
            "alerts_triggered": len(alert_items),
            "digest_sent": digest_sent,
        }

    @app.post("/api/scrape/run-check")
    async def run_check(_user: str = Depends(_verify_auth)) -> dict[str, Any]:
        """Trigger immediate batch price check from SPA."""
        return await _execute_batch_check()

    @app.post("/api/cron/run-check")
    async def cron_run_check() -> dict[str, Any]:
        """Trigger scheduled batch price check from Cloud Scheduler."""
        return await _execute_batch_check()

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

