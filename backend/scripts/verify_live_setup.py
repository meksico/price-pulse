"""CLI verification tool for live Google Sheets schema and Playwright scraping."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import traceback
from dataclasses import asdict
from pathlib import Path

from pricepulse.adapters.google_sheets import (
    GoogleSheetsRepository,
    build_sheets_service,
)
from pricepulse.adapters.playwright_scraper import PlaywrightScraperAdapter
from pricepulse.diagnostics import StructuredLogger, collect_runtime_diagnostics
from pricepulse.domain.models import APP_VERSION

REQUIRED_GOOGLE_ENV = (
    "SPREADSHEET_ID",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_OAUTH_REFRESH_TOKEN",
)


def build_parser() -> argparse.ArgumentParser:
    """Create CLI argument parser for live setup verification."""
    parser = argparse.ArgumentParser(
        prog="verify_live_setup",
        description="Verify live Google Sheets OAuth/schema and Playwright scraping.",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"verify_live_setup {APP_VERSION}",
    )
    parser.add_argument(
        "--check-sheets",
        action="store_true",
        help="Verify Google OAuth env vars and bootstrap 7-tab Sheets schema.",
    )
    parser.add_argument(
        "--preview-url",
        type=str,
        default="",
        help="Run a live Playwright 3-tier waterfall preview against a product URL.",
    )
    return parser


def _check_google_sheets(logger: StructuredLogger) -> dict[str, object]:
    """Validate Google OAuth env vars and bootstrap the 7-tab spreadsheet."""
    missing = [key for key in REQUIRED_GOOGLE_ENV if not os.getenv(key, "").strip()]
    if missing:
        raise RuntimeError(
            f"Missing required Google environment variables: {', '.join(missing)}"
        )
    service = build_sheets_service(
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
        refresh_token=os.environ["GOOGLE_OAUTH_REFRESH_TOKEN"],
    )
    repo = GoogleSheetsRepository(
        spreadsheet_id=os.environ["SPREADSHEET_ID"],
        service=service,
    )
    created_tabs = repo.ensure_schema()
    logger.info(
        f"Google Sheets verified (created_tabs={created_tabs or 'none'})"
    )
    return {"created_tabs": created_tabs, "spreadsheet_id": os.environ["SPREADSHEET_ID"]}


async def _preview_live_url(url: str, logger: StructuredLogger) -> dict[str, object]:
    """Run PlaywrightScraperAdapter.preview_url for a single live URL."""
    adapter = PlaywrightScraperAdapter()
    preview = await adapter.preview_url(url)
    logger.info(f"Previewed {url} -> {preview.currency}{preview.price}")
    return asdict(preview)


def _load_dotenv_if_present() -> None:
    """Populate unset environment variables from backend/.env if it exists."""
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def main(argv: list[str] | None = None) -> int:
    """Execute live setup checks and return process exit code."""
    _load_dotenv_if_present()
    parser = build_parser()
    args = parser.parse_args(argv)
    logger = StructuredLogger()
    diag = collect_runtime_diagnostics(
        os.getenv("STORAGE_ADAPTER", "local_json"),
        logger,
    )
    report: dict[str, object] = {"diagnostics": asdict(diag)}

    try:
        if args.check_sheets:
            report["google_sheets"] = _check_google_sheets(logger)
        if args.preview_url:
            report["preview"] = asyncio.run(
                _preview_live_url(args.preview_url, logger)
            )
    except Exception:
        report["error"] = traceback.format_exc()
        print(json.dumps(report, indent=2))
        return 1

    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

