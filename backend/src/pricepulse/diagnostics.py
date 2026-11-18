"""Diagnostic observability, runtime context, and 3rd-party resource telemetry."""

from __future__ import annotations

import asyncio
import importlib.metadata
import os
import sys
import traceback
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlparse

import httpx

from pricepulse.adapters.gemini_search_fallback import (
    DEFAULT_COOLDOWN_HOURS,
    DEFAULT_GEMINI_MODEL,
    DEFAULT_MONTHLY_CAP,
    GEMINI_API_BASE,
    parse_monthly_usage,
)
from pricepulse.adapters.playwright_scraper import (
    DEFAULT_CONCURRENCY,
    DEFAULT_TIMEOUT_MS,
    parse_proxy_pool,
)
from pricepulse.domain.models import APP_VERSION, WorkspaceState

CRITICAL_PACKAGES: tuple[str, ...] = (
    "fastapi",
    "pydantic",
    "uvicorn",
    "httpx",
    "playwright",
    "google-api-python-client",
    "google-auth",
    "google-auth-oauthlib",
)

WEBSHARE_API_BASE = "https://proxy.webshare.io/api/v2"
DEFAULT_WEBSHARE_PROXY_LIMIT = 10
DEFAULT_WEBSHARE_BANDWIDTH_MB = 1024.0
_WEBSHARE_CACHE_TTL_SECONDS = 60.0
_webshare_cache: dict[str, Any] = {}
_GCP_BILLING_CACHE_TTL_SECONDS = 300.0
_gcp_billing_cache: dict[str, Any] = {}
BIGQUERY_API_BASE = "https://bigquery.googleapis.com/bigquery/v2"


@dataclass(frozen=True)
class LogRecordEntry:
    """Timestamped structured log entry."""

    timestamp: str
    level: str
    message: str
    traceback_text: str | None = None


@dataclass(frozen=True)
class RuntimeDiagnostics:
    """Complete runtime context required for screenshot self-sufficiency."""

    app_version: str
    python_executable: str
    python_version: str
    platform: str
    workspace_dir: str
    storage_adapter: str
    dependency_versions: dict[str, str]
    recent_logs: list[LogRecordEntry] = field(default_factory=list)


@dataclass(frozen=True)
class ChargeRecord:
    """Single billing charge or payment transaction from a 3rd-party provider."""

    charge_id: str
    provider: str
    description: str
    amount: float
    currency: str
    status: str
    created_at: str


@dataclass(frozen=True)
class ThirdPartyResourceStatus:
    """Sanitized status and quota snapshot for a single 3rd-party resource."""

    resource_id: str
    name: str
    category: str
    provider: str
    mode: str
    status: str
    endpoint: str
    quota_used: float | None = None
    quota_limit: float | None = None
    quota_unit: str = ""
    billing_tier: str = "Free Tier"
    monthly_cost_usd: float = 0.0
    reset_at: str | None = None
    last_activity_at: str | None = None
    details: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


@dataclass(frozen=True)
class ResourcesInventory:
    """Unified multi-provider 3rd-party resources & package inventory."""

    app_version: str
    fetched_at: str
    probed: bool
    storage_adapter: str
    scraper_adapter: str
    auth_mode: str
    resources: list[ThirdPartyResourceStatus]
    backend_packages: dict[str, str]
    charges: list[ChargeRecord] = field(default_factory=list)
    total_charges_usd: float = 0.0


class StructuredLogger:
    """In-memory ring-buffer logger capturing INFO/WARN/ERROR and stack traces."""

    def __init__(self, max_entries: int = 200) -> None:
        self._entries: deque[LogRecordEntry] = deque(maxlen=max_entries)

    def log(self, level: str, message: str, exc: BaseException | None = None) -> None:
        """Record a timestamped log entry with optional full stack trace."""
        ts = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        tb_text: str | None = None
        if exc is not None:
            tb_text = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        self._entries.append(
            LogRecordEntry(
                timestamp=ts,
                level=level.upper(),
                message=message,
                traceback_text=tb_text,
            )
        )

    def info(self, message: str) -> None:
        """Record an INFO log entry."""
        self.log("INFO", message)

    def warn(self, message: str) -> None:
        """Record a WARN log entry."""
        self.log("WARN", message)

    def error(self, message: str, exc: BaseException | None = None) -> None:
        """Record an ERROR log entry with full traceback when available."""
        self.log("ERROR", message, exc=exc)

    def recent(self, limit: int = 50) -> list[LogRecordEntry]:
        """Return up to `limit` most recent log entries."""
        items = list(self._entries)
        return items[-limit:]


def _package_version(name: str) -> str:
    """Return installed version for a package or 'not-installed'."""
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "not-installed"


def collect_runtime_diagnostics(
    storage_adapter: str,
    logger: StructuredLogger | None = None,
) -> RuntimeDiagnostics:
    """Capture active Python runtime, dependency versions, and workspace path."""
    versions = {pkg: _package_version(pkg) for pkg in CRITICAL_PACKAGES}
    return RuntimeDiagnostics(
        app_version=APP_VERSION,
        python_executable=sys.executable,
        python_version=sys.version.splitlines()[0],
        platform=sys.platform,
        workspace_dir=os.getcwd(),
        storage_adapter=storage_adapter,
        dependency_versions=versions,
        recent_logs=logger.recent() if logger is not None else [],
    )


def _sanitize_proxy_hosts(raw_pool: str | None) -> list[str]:
    """Return sanitized 'host:port' strings from SCRAPER_PROXY_URL without credentials."""
    hosts: list[str] = []
    for cfg in parse_proxy_pool(raw_pool):
        parsed = urlparse(cfg.get("server", ""))
        if parsed.hostname:
            host_port = f"{parsed.hostname}:{parsed.port}" if parsed.port else parsed.hostname
            hosts.append(host_port)
    return hosts


def _mask_identifier(raw: str) -> str:
    """Return a masked identifier showing only prefix and suffix."""
    cleaned = raw.strip()
    if not cleaned:
        return ""
    if len(cleaned) <= 10:
        return f"{cleaned[:2]}...{cleaned[-2:]}"
    return f"{cleaned[:6]}...{cleaned[-4:]}"


async def fetch_webshare_telemetry(
    api_key: str,
    client: httpx.AsyncClient | None = None,
    *,
    force_refresh: bool = False,
) -> dict[str, Any]:
    """Fetch subscription limits, aggregate bandwidth/stats, and transactions."""
    now_ts = datetime.now(UTC).timestamp()
    cached = _webshare_cache.get("data")
    cached_at = float(_webshare_cache.get("ts") or 0.0)
    if (
        not force_refresh
        and isinstance(cached, dict)
        and (now_ts - cached_at) < _WEBSHARE_CACHE_TTL_SECONDS
    ):
        return cached

    headers = {"Authorization": f"Token {api_key}"}
    owns_client = client is None
    http_client = client or httpx.AsyncClient(timeout=20.0)
    try:
        sub_res, tx_res = await asyncio.gather(
            http_client.get(f"{WEBSHARE_API_BASE}/subscription/", headers=headers),
            http_client.get(
                f"{WEBSHARE_API_BASE}/payment/transaction/",
                headers=headers,
                params={"page": 1, "page_size": 20},
            ),
            return_exceptions=True,
        )

        sub_data: dict[str, Any] = {}
        if isinstance(sub_res, httpx.Response):
            sub_res.raise_for_status()
            parsed_sub = sub_res.json()
            if isinstance(parsed_sub, dict):
                sub_data = parsed_sub
        elif isinstance(sub_res, BaseException):
            raise sub_res

        tx_results: list[dict[str, Any]] = []
        if isinstance(tx_res, httpx.Response) and tx_res.status_code == 200:
            tx_payload = tx_res.json()
            if isinstance(tx_payload, dict) and isinstance(
                tx_payload.get("results"), list
            ):
                tx_results = [
                    row for row in tx_payload["results"] if isinstance(row, dict)
                ]

        now = datetime.now(UTC)
        start_date = str(
            sub_data.get("start_date") or (now - timedelta(days=30)).isoformat()
        )
        end_date = str(sub_data.get("end_date") or now.isoformat())

        stats_resp = await http_client.get(
            f"{WEBSHARE_API_BASE}/stats/aggregate/",
            headers=headers,
            params={"timestamp__gte": start_date, "timestamp__lte": end_date},
        )
        stats_resp.raise_for_status()
        stats_data = stats_resp.json()
        if not isinstance(stats_data, dict):
            stats_data = {}

        result = {
            "subscription": sub_data,
            "stats": stats_data,
            "transactions": tx_results,
        }
        _webshare_cache["data"] = result
        _webshare_cache["ts"] = datetime.now(UTC).timestamp()
        return result
    finally:
        if owns_client:
            await http_client.aclose()


def _get_gcp_adc_token() -> tuple[str, str]:
    """Obtain an ADC access token and default project ID for BigQuery."""
    import google.auth
    from google.auth.transport.requests import Request

    creds, default_project = google.auth.default(
        scopes=["https://www.googleapis.com/auth/bigquery.readonly"]
    )
    creds.refresh(Request())  # type: ignore[no-untyped-call]
    token = str(creds.token or "")
    return token, str(default_project or "")


async def fetch_gcp_billing_charges(
    client: httpx.AsyncClient | None = None,
    *,
    force_refresh: bool = False,
) -> dict[str, Any] | None:
    """Query current-month GCP charges from BigQuery Billing Export if configured."""
    now_ts = datetime.now(UTC).timestamp()
    cached = _gcp_billing_cache.get("data")
    cached_at = float(_gcp_billing_cache.get("ts") or 0.0)
    if (
        not force_refresh
        and isinstance(cached, dict)
        and (now_ts - cached_at) < _GCP_BILLING_CACHE_TTL_SECONDS
    ):
        return cached

    project_id = os.getenv("GCP_BILLING_PROJECT_ID", "").strip()
    dataset_id = os.getenv("GCP_BILLING_DATASET", "pricepulse_billing").strip()
    explicit_table = os.getenv("GCP_BILLING_BQ_TABLE", "").strip()

    try:
        token, adc_project = await asyncio.to_thread(_get_gcp_adc_token)
    except Exception:
        return None
    if not token:
        return None
    if not project_id:
        project_id = adc_project
    if not project_id:
        return None

    headers = {"Authorization": f"Bearer {token}"}
    owns_client = client is None
    http_client = client or httpx.AsyncClient(timeout=15.0)
    try:
        table_ref = explicit_table
        if not table_ref:
            tables_resp = await http_client.get(
                f"{BIGQUERY_API_BASE}/projects/{project_id}/datasets/{dataset_id}/tables",
                headers=headers,
            )
            if tables_resp.status_code == 404:
                return {"status": "pending_export", "services": []}
            tables_resp.raise_for_status()
            tables_json = tables_resp.json()
            for tbl in tables_json.get("tables", []) if isinstance(tables_json, dict) else []:
                ref = tbl.get("tableReference", {}) if isinstance(tbl, dict) else {}
                tid = str(ref.get("tableId") or "")
                if tid.startswith("gcp_billing_export_v1_"):
                    table_ref = f"{project_id}.{dataset_id}.{tid}"
                    break
        if not table_ref:
            return {"status": "pending_export", "services": []}

        yyyymm = datetime.now(UTC).strftime("%Y%m")
        sql = (
            "SELECT "
            "  service.description AS service_name, "
            "  ROUND(SUM(cost), 4) AS gross_cost, "
            "  ROUND(SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 4) "
            "    AS credits_amount, "
            "  ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 4) "
            "    AS net_cost, "
            "  ANY_VALUE(currency) AS currency "
            f"FROM `{table_ref}` "
            f"WHERE invoice.month = '{yyyymm}' "
            "GROUP BY service_name "
            "ORDER BY net_cost DESC, gross_cost DESC"
        )
        query_resp = await http_client.post(
            f"{BIGQUERY_API_BASE}/projects/{project_id}/queries",
            headers=headers,
            json={"query": sql, "useLegacySql": False, "timeoutMs": 10000},
        )
        query_resp.raise_for_status()
        q_json = query_resp.json()
        services: list[dict[str, Any]] = []
        for row in q_json.get("rows", []) if isinstance(q_json, dict) else []:
            vals = row.get("f", []) if isinstance(row, dict) else []
            if len(vals) < 5:
                continue
            services.append(
                {
                    "service_name": str(vals[0].get("v") or "GCP Service"),
                    "gross_cost": float(vals[1].get("v") or 0.0),
                    "credits_amount": float(vals[2].get("v") or 0.0),
                    "net_cost": float(vals[3].get("v") or 0.0),
                    "currency": str(vals[4].get("v") or "USD"),
                }
            )
        result = {"status": "active", "invoice_month": yyyymm, "services": services}
        _gcp_billing_cache["data"] = result
        _gcp_billing_cache["ts"] = datetime.now(UTC).timestamp()
        return result
    finally:
        if owns_client:
            await http_client.aclose()


def _build_sheets_resource(
    storage_mode: str,
    state: WorkspaceState,
    probe_error: str | None = None,
    probe_title: str | None = None,
) -> ThirdPartyResourceStatus:
    """Build sanitized status for Google Sheets API v4."""
    sheet_id = os.getenv("SPREADSHEET_ID", "").strip()
    if not sheet_id:
        for cfg in state.config:
            if cfg.key == "spreadsheet_id" and cfg.value.strip():
                sheet_id = cfg.value.strip()
                break
    is_live = storage_mode == "google_sheets"
    status = "operational" if is_live else "disabled"
    if probe_error:
        status = "warning"
    details: dict[str, Any] = {
        "adapter": storage_mode,
        "spreadsheet_configured": bool(sheet_id),
        "spreadsheet_id_masked": _mask_identifier(sheet_id) if sheet_id else "",
        "tabs": {
            "Items": len(state.items),
            "Bought_Items": len(state.bought_items),
            "Tags": len(state.tags),
            "Item_Tags": len(state.item_tags),
            "Price_History": len(state.price_history),
            "Telemetry_Logs": len(state.telemetry_logs),
            "Config": len(state.config),
        },
    }
    if probe_title:
        details["spreadsheet_title"] = probe_title
    return ThirdPartyResourceStatus(
        resource_id="google_sheets",
        name="Google Sheets API v4",
        category="cloud_api",
        provider="Google Cloud",
        mode="live" if is_live else "mock",
        status=status,
        endpoint="https://sheets.googleapis.com/v4",
        quota_used=None,
        quota_limit=300.0,
        quota_unit="req/min",
        details=details,
        error=probe_error,
    )


def _build_gmail_resource(
    storage_mode: str,
    state: WorkspaceState,
    probe_error: str | None = None,
    probe_email: str | None = None,
) -> ThirdPartyResourceStatus:
    """Build sanitized status for Gmail API v1."""
    recipient = ""
    last_captcha_report = ""
    for cfg in state.config:
        if cfg.key == "gmail_alert_recipient":
            recipient = cfg.value.strip()
        elif cfg.key == "last_captcha_report_date":
            last_captcha_report = cfg.value.strip()
    if not recipient:
        recipient = os.getenv("ALLOWED_OWNER_EMAIL", "").split(",")[0].strip()

    is_live = storage_mode == "google_sheets"
    status = "operational" if is_live else "disabled"
    if probe_error:
        status = "warning"
    details: dict[str, Any] = {
        "alert_recipient": recipient or "unset",
        "last_captcha_report_date": last_captcha_report or "never",
    }
    if probe_email:
        details["verified_sender"] = probe_email
    return ThirdPartyResourceStatus(
        resource_id="gmail_api",
        name="Gmail API v1",
        category="cloud_api",
        provider="Google Cloud",
        mode="live" if is_live else "mock",
        status=status,
        endpoint="https://gmail.googleapis.com/gmail/v1",
        quota_used=None,
        quota_limit=250.0,
        quota_unit="units/sec",
        last_activity_at=last_captcha_report or None,
        details=details,
        error=probe_error,
    )


def _build_gis_oauth_resource(auth_mode: str) -> ThirdPartyResourceStatus:
    """Build sanitized status for Google Identity Services & OAuth 2.0."""
    client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    allowed_owner = os.getenv("ALLOWED_OWNER_EMAIL", "").strip()
    cron_secret_set = bool(os.getenv("CRON_SECRET", "").strip())
    is_live = auth_mode == "google_oauth"
    status = "operational" if (is_live and client_id) else (
        "warning" if is_live else "disabled"
    )
    return ThirdPartyResourceStatus(
        resource_id="google_oauth",
        name="Google Identity Services (OAuth 2.0)",
        category="auth",
        provider="Google Cloud",
        mode="live" if is_live else "mock",
        status=status,
        endpoint="https://oauth2.googleapis.com/tokeninfo",
        details={
            "auth_mode": auth_mode,
            "client_id_configured": bool(client_id),
            "client_id_masked": _mask_identifier(client_id) if client_id else "",
            "owner_allowlist_enabled": bool(allowed_owner),
            "cron_secret_configured": cron_secret_set,
        },
    )


def _build_gemini_resource(
    state: WorkspaceState,
    probe_error: str | None = None,
    probe_verified: bool = False,
) -> ThirdPartyResourceStatus:
    """Build sanitized status and monthly quota for Gemini Search Grounding."""
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    model = os.getenv("GEMINI_GROUNDING_MODEL", DEFAULT_GEMINI_MODEL).strip()
    try:
        monthly_cap = int(
            os.getenv("GEMINI_GROUNDING_MONTHLY_CAP", str(DEFAULT_MONTHLY_CAP))
        )
    except ValueError:
        monthly_cap = DEFAULT_MONTHLY_CAP
    try:
        cooldown_hours = int(
            os.getenv("GEMINI_GROUNDING_COOLDOWN_HOURS", str(DEFAULT_COOLDOWN_HOURS))
        )
    except ValueError:
        cooldown_hours = DEFAULT_COOLDOWN_HOURS

    current_month = datetime.now(UTC).strftime("%Y-%m")
    raw_usage = ""
    for cfg in state.config:
        if cfg.key == "gemini_grounding_usage":
            raw_usage = cfg.value
            break
    used = parse_monthly_usage(raw_usage, current_month)
    is_configured = bool(api_key)
    status = "disabled"
    if is_configured:
        status = "warning" if (probe_error or used >= monthly_cap) else "operational"

    return ThirdPartyResourceStatus(
        resource_id="gemini_grounding",
        name="Gemini API + Search Grounding",
        category="cloud_api",
        provider="Google AI",
        mode="live" if is_configured else "disabled",
        status=status,
        endpoint=f"{GEMINI_API_BASE}/models/{model}:generateContent",
        quota_used=float(used),
        quota_limit=float(monthly_cap),
        quota_unit="queries/mo",
        reset_at=f"{current_month} (monthly)",
        details={
            "model": model,
            "cooldown_hours": cooldown_hours,
            "api_key_configured": is_configured,
            "probe_verified": probe_verified,
        },
        error=probe_error,
    )


def _build_webshare_resource(
    webshare_data: dict[str, Any] | None,
    webshare_error: str | None,
) -> ThirdPartyResourceStatus:
    """Build sanitized status and bandwidth quota for Webshare Proxy Pool."""
    raw_pool = os.getenv("SCRAPER_PROXY_URL", "")
    proxy_hosts = _sanitize_proxy_hosts(raw_pool)
    api_key_set = bool(os.getenv("WEBSHARE_API_KEY", "").strip())

    bandwidth_limit_mb = DEFAULT_WEBSHARE_BANDWIDTH_MB
    bandwidth_used_mb: float | None = None
    proxy_limit = DEFAULT_WEBSHARE_PROXY_LIMIT
    reset_at: str | None = None
    last_request_at: str | None = None
    details: dict[str, Any] = {
        "proxy_pool_count": len(proxy_hosts),
        "proxy_hosts": proxy_hosts[:10],
        "api_key_configured": api_key_set,
        "proxy_limit": proxy_limit,
    }

    if webshare_data is not None:
        sub = webshare_data.get("subscription", {})
        stats = webshare_data.get("stats", {})
        raw_bw_limit_gb = sub.get("bandwidth_limit")
        if isinstance(raw_bw_limit_gb, (int, float)) and raw_bw_limit_gb > 0:
            bandwidth_limit_mb = round(float(raw_bw_limit_gb) * 1024.0, 2)
        raw_proxy_limit = sub.get("proxy_limit")
        if isinstance(raw_proxy_limit, int) and raw_proxy_limit > 0:
            proxy_limit = raw_proxy_limit
            details["proxy_limit"] = proxy_limit
        if sub.get("end_date"):
            reset_at = str(sub["end_date"])
        if sub.get("plan_type") or sub.get("status"):
            details["plan"] = str(sub.get("plan_type") or sub.get("status"))
        if sub.get("term"):
            details["term"] = str(sub["term"])
        if isinstance(sub.get("free_credits"), (int, float)):
            details["free_credits"] = float(sub["free_credits"])

        raw_bw_bytes = stats.get("bandwidth_total")
        if isinstance(raw_bw_bytes, (int, float)):
            bandwidth_used_mb = round(float(raw_bw_bytes) / (1024.0 * 1024.0), 2)
        if stats.get("last_request_sent_at"):
            last_request_at = str(stats["last_request_sent_at"])
        details["requests_total"] = int(stats.get("requests_total") or 0)
        details["requests_successful"] = int(stats.get("requests_successful") or 0)
        details["requests_failed"] = int(stats.get("requests_failed") or 0)
        details["proxies_used"] = int(stats.get("number_of_proxies_used") or 0)
        if isinstance(stats.get("error_reasons"), list) and stats["error_reasons"]:
            details["top_errors"] = stats["error_reasons"][:3]

    if api_key_set:
        mode = "live"
    elif proxy_hosts:
        mode = "configured"
    else:
        mode = "disabled"

    status = "disabled"
    if mode != "disabled":
        if webshare_error or (
            bandwidth_used_mb is not None and bandwidth_used_mb >= bandwidth_limit_mb
        ):
            status = "warning"
        else:
            status = "operational"

    return ThirdPartyResourceStatus(
        resource_id="webshare_proxies",
        name="Webshare Proxy Pool",
        category="scraper",
        provider="Webshare.io",
        mode=mode,
        status=status,
        endpoint=f"{WEBSHARE_API_BASE}/stats/aggregate/",
        quota_used=bandwidth_used_mb,
        quota_limit=bandwidth_limit_mb,
        quota_unit="MB",
        billing_tier=f"Free {proxy_limit} Proxies / 1 GB",
        monthly_cost_usd=0.0,
        reset_at=reset_at,
        last_activity_at=last_request_at,
        details=details,
        error=webshare_error,
    )


def _build_cloud_run_resource(
    storage_mode: str,
    gcp_billing: dict[str, Any] | None,
) -> ThirdPartyResourceStatus:
    """Build status and monthly cost for Google Cloud Run hosting."""
    is_cloud = storage_mode == "google_sheets" or bool(os.getenv("K_SERVICE"))
    net_cost = 0.0
    gross_cost = 0.0
    if gcp_billing and isinstance(gcp_billing.get("services"), list):
        for svc in gcp_billing["services"]:
            name = str(svc.get("service_name") or "").lower()
            if "cloud run" in name:
                net_cost += float(svc.get("net_cost") or 0.0)
                gross_cost += float(svc.get("gross_cost") or 0.0)
    return ThirdPartyResourceStatus(
        resource_id="cloud_run",
        name="Google Cloud Run (europe-central2)",
        category="infra",
        provider="Google Cloud",
        mode="live" if is_cloud else "mock",
        status="operational" if is_cloud else "disabled",
        endpoint="https://run.googleapis.com/v2",
        billing_tier="Pay-as-you-go (Free Tier)",
        monthly_cost_usd=round(max(0.0, net_cost), 2),
        details={
            "service": os.getenv("K_SERVICE", "local"),
            "region": "europe-central2",
            "gross_cost_usd": round(gross_cost, 2),
            "billing_export": (gcp_billing or {}).get("status", "not_configured"),
        },
    )


def _build_playwright_resource(
    scraper_mode: str,
    probe_error: str | None = None,
    executable_path: str | None = None,
) -> ThirdPartyResourceStatus:
    """Build sanitized status for Playwright Headless Chromium."""
    is_live = scraper_mode == "playwright"
    status = "operational" if is_live else "disabled"
    if probe_error:
        status = "warning"
    details: dict[str, Any] = {
        "adapter": scraper_mode,
        "playwright_version": _package_version("playwright"),
        "concurrency_limit": DEFAULT_CONCURRENCY,
        "timeout_ms": DEFAULT_TIMEOUT_MS,
    }
    if executable_path:
        details["chromium_binary"] = executable_path
    return ThirdPartyResourceStatus(
        resource_id="playwright_chromium",
        name="Playwright Headless Chromium",
        category="scraper",
        provider="Microsoft Playwright",
        mode="live" if is_live else "mock",
        status=status,
        endpoint="local://chromium-headless",
        quota_used=None,
        quota_limit=float(DEFAULT_CONCURRENCY),
        quota_unit="concurrent",
        details=details,
        error=probe_error,
    )


async def _probe_gemini(api_key: str, model: str, client: httpx.AsyncClient) -> bool:
    """Verify Gemini API key and model metadata without consuming grounding quota."""
    resp = await client.get(
        f"{GEMINI_API_BASE}/models/{model}",
        params={"key": api_key},
    )
    resp.raise_for_status()
    return True


async def _probe_sheets(repo: Any) -> str:
    """Read spreadsheet title via Sheets API v4."""
    service = getattr(repo, "_service", None)
    sheet_id = getattr(repo, "_spreadsheet_id", "")
    if service is None or not sheet_id:
        raise ValueError("Google Sheets service not initialized")
    meta = await asyncio.to_thread(
        lambda: service.spreadsheets()
        .get(spreadsheetId=sheet_id, fields="spreadsheetId,properties.title")
        .execute()
    )
    props = meta.get("properties", {}) if isinstance(meta, dict) else {}
    return str(props.get("title") or sheet_id)


async def _probe_gmail(notifier: Any) -> str:
    """Read authenticated Gmail profile email address."""
    service = getattr(notifier, "_service", None)
    if service is None:
        raise ValueError("Gmail service not initialized")
    profile = await asyncio.to_thread(
        lambda: service.users().getProfile(userId="me").execute()
    )
    if isinstance(profile, dict):
        return str(profile.get("emailAddress") or "authenticated")
    return "ok"


async def _probe_playwright() -> str:
    """Verify Playwright Chromium executable exists on disk."""
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        exe = p.chromium.executable_path
        if not exe or not os.path.exists(exe):
            raise FileNotFoundError(f"Chromium binary missing at: {exe}")
        return exe


async def collect_third_party_resources_async(
    storage_mode: str,
    scraper_mode: str,
    auth_mode: str,
    state: WorkspaceState,
    *,
    probe: bool = False,
    repo: Any = None,
    notifier: Any = None,
) -> ResourcesInventory:
    """Concurrently fetch live status & quotas across all 3rd-party providers."""
    webshare_key = os.getenv("WEBSHARE_API_KEY", "").strip()
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    gemini_model = os.getenv("GEMINI_GROUNDING_MODEL", DEFAULT_GEMINI_MODEL).strip()

    async with httpx.AsyncClient(timeout=20.0) as client:
        tasks: dict[str, Any] = {}
        if webshare_key:
            tasks["webshare"] = fetch_webshare_telemetry(
                webshare_key,
                client=client,
                force_refresh=probe,
            )
        if storage_mode == "google_sheets" or os.getenv("GCP_BILLING_PROJECT_ID", "").strip():
            tasks["gcp_billing"] = fetch_gcp_billing_charges(
                client=client,
                force_refresh=probe,
            )
        if probe and gemini_key:
            tasks["gemini"] = _probe_gemini(gemini_key, gemini_model, client)
        if probe and storage_mode == "google_sheets":
            tasks["sheets"] = _probe_sheets(repo)
            tasks["gmail"] = _probe_gmail(notifier)
        if probe and scraper_mode == "playwright":
            tasks["playwright"] = _probe_playwright()

        results: dict[str, Any] = {}
        if tasks:
            keys = list(tasks.keys())
            gathered = await asyncio.gather(
                *(tasks[k] for k in keys),
                return_exceptions=True,
            )
            results = dict(zip(keys, gathered, strict=True))

    ws_raw = results.get("webshare")
    ws_data = ws_raw if isinstance(ws_raw, dict) else None
    ws_err = str(ws_raw) if isinstance(ws_raw, BaseException) else None

    gem_raw = results.get("gemini")
    gem_err = str(gem_raw) if isinstance(gem_raw, BaseException) else None
    gem_verified = gem_raw is True

    sheets_raw = results.get("sheets")
    sheets_err = str(sheets_raw) if isinstance(sheets_raw, BaseException) else None
    sheets_title = sheets_raw if isinstance(sheets_raw, str) else None

    gmail_raw = results.get("gmail")
    gmail_err = str(gmail_raw) if isinstance(gmail_raw, BaseException) else None
    gmail_email = gmail_raw if isinstance(gmail_raw, str) else None

    pw_raw = results.get("playwright")
    pw_err = str(pw_raw) if isinstance(pw_raw, BaseException) else None
    pw_exe = pw_raw if isinstance(pw_raw, str) else None

    gcp_raw = results.get("gcp_billing")
    gcp_billing = gcp_raw if isinstance(gcp_raw, dict) else None

    gemini_resource = _build_gemini_resource(state, gem_err, gem_verified)
    if gcp_billing and isinstance(gcp_billing.get("services"), list):
        gemini_net = 0.0
        for svc in gcp_billing["services"]:
            sname = str(svc.get("service_name") or "").lower()
            if "gemini" in sname or "generative language" in sname:
                gemini_net += float(svc.get("net_cost") or 0.0)
        if gemini_net > 0:
            gemini_resource = ThirdPartyResourceStatus(
                resource_id=gemini_resource.resource_id,
                name=gemini_resource.name,
                category=gemini_resource.category,
                provider=gemini_resource.provider,
                mode=gemini_resource.mode,
                status=gemini_resource.status,
                endpoint=gemini_resource.endpoint,
                quota_used=gemini_resource.quota_used,
                quota_limit=gemini_resource.quota_limit,
                quota_unit=gemini_resource.quota_unit,
                billing_tier="Paid Account (5k free grounding/mo)",
                monthly_cost_usd=round(gemini_net, 2),
                reset_at=gemini_resource.reset_at,
                last_activity_at=gemini_resource.last_activity_at,
                details=gemini_resource.details,
                error=gemini_resource.error,
            )

    resources = [
        _build_sheets_resource(storage_mode, state, sheets_err, sheets_title),
        _build_gmail_resource(storage_mode, state, gmail_err, gmail_email),
        _build_gis_oauth_resource(auth_mode),
        gemini_resource,
        _build_webshare_resource(ws_data, ws_err),
        _build_playwright_resource(scraper_mode, pw_err, pw_exe),
        _build_cloud_run_resource(storage_mode, gcp_billing),
    ]

    charges: list[ChargeRecord] = []
    if gcp_billing and isinstance(gcp_billing.get("services"), list):
        inv_month = str(gcp_billing.get("invoice_month") or "")
        for idx, svc in enumerate(gcp_billing["services"]):
            gross = float(svc.get("gross_cost") or 0.0)
            credits_val = float(svc.get("credits_amount") or 0.0)
            net = float(svc.get("net_cost") or 0.0)
            if gross == 0.0 and net == 0.0:
                continue
            charges.append(
                ChargeRecord(
                    charge_id=f"gcp-{inv_month}-{idx}",
                    provider="Google Cloud",
                    description=(
                        f"{svc.get('service_name')} "
                        f"(Gross ${gross:.2f}, Credits ${credits_val:.2f})"
                    ),
                    amount=round(net, 2),
                    currency=str(svc.get("currency") or "USD"),
                    status="billed" if net > 0 else "covered_by_credits",
                    created_at=inv_month,
                )
            )
    if ws_data is not None and isinstance(ws_data.get("transactions"), list):
        for idx, tx in enumerate(ws_data["transactions"]):
            if not isinstance(tx, dict):
                continue
            raw_amount = tx.get("amount", 0.0)
            try:
                amount_val = float(raw_amount)
            except (TypeError, ValueError):
                amount_val = 0.0
            charges.append(
                ChargeRecord(
                    charge_id=str(tx.get("id") or f"ws-tx-{idx}"),
                    provider="Webshare.io",
                    description=str(
                        tx.get("reason") or tx.get("type") or "Proxy Subscription"
                    ),
                    amount=round(amount_val, 2),
                    currency=str(tx.get("currency") or "USD"),
                    status=str(tx.get("status") or "completed"),
                    created_at=str(tx.get("created_at") or ""),
                )
            )
    total_charges_usd = round(
        sum(c.amount for c in charges if c.currency.upper() == "USD"),
        2,
    )

    return ResourcesInventory(
        app_version=APP_VERSION,
        fetched_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        probed=probe,
        storage_adapter=storage_mode,
        scraper_adapter=scraper_mode,
        auth_mode=auth_mode,
        resources=resources,
        backend_packages={pkg: _package_version(pkg) for pkg in CRITICAL_PACKAGES},
        charges=charges,
        total_charges_usd=total_charges_usd,
    )
