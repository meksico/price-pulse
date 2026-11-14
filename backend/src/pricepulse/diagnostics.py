"""Diagnostic observability, runtime context, and structured logging (REQ-DIAG-01)."""

from __future__ import annotations

import importlib.metadata
import os
import sys
import traceback
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime

from pricepulse.domain.models import APP_VERSION

CRITICAL_PACKAGES: tuple[str, ...] = (
    "fastapi",
    "pydantic",
    "uvicorn",
    "httpx",
    "playwright",
    "google-api-python-client",
)


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

