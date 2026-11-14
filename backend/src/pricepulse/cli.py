"""CLI entrypoint for local PricePulse diagnostics and batch checks."""

from __future__ import annotations

import argparse
import asyncio
import json
from dataclasses import asdict

from pricepulse.adapters.local_json import (
    DeterministicScraperAdapter,
    LocalJsonRepository,
)
from pricepulse.diagnostics import StructuredLogger, collect_runtime_diagnostics
from pricepulse.domain.models import APP_VERSION


def build_parser() -> argparse.ArgumentParser:
    """Create the CLI argument parser."""
    parser = argparse.ArgumentParser(prog="pricepulse", description="PricePulse CLI")
    parser.add_argument(
        "--version",
        action="version",
        version=f"pricepulse {APP_VERSION}",
    )
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("health", help="Print runtime diagnostics JSON")
    sub.add_parser("run-check", help="Run a local deterministic batch check")
    return parser


def main(argv: list[str] | None = None) -> int:
    """Execute CLI command and return exit code."""
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "health":
        logger = StructuredLogger()
        diag = collect_runtime_diagnostics("local_json", logger)
        print(json.dumps(asdict(diag), indent=2))
        return 0
    if args.command == "run-check":
        repo = LocalJsonRepository()
        scraper = DeterministicScraperAdapter()
        state = repo.load_state()
        outcomes = asyncio.run(scraper.check_items(state.items))
        print(f"Checked {len(outcomes)} items successfully.")
        return 0
    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

