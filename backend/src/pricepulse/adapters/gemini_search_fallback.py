"""Gemini API Google Search grounding fallback for CAPTCHA-blocked URLs."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlparse

import httpx

DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"
DEFAULT_MONTHLY_CAP = 4500
DEFAULT_COOLDOWN_HOURS = 48
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"

_CURRENCY_MAP: dict[str, str] = {
    "PLN": "zł",
    "ZŁ": "zł",
    "ZL": "zł",
    "UAH": "₴",
    "ГРН": "₴",
    "₴": "₴",
    "USD": "$",
    "$": "$",
    "EUR": "€",
    "€": "€",
    "GBP": "£",
    "£": "£",
}


@dataclass(frozen=True)
class GeminiSearchResult:
    """Structured product price extracted via Google Search grounding."""

    price: float
    currency: str
    title: str
    queries_used: int
    image_url: str = ""


def normalize_currency(raw: str | None, fallback: str = "$") -> str:
    """Map ISO codes and local currency labels to PricePulse display symbols."""
    if not raw:
        return fallback
    cleaned = raw.strip()
    if not cleaned:
        return fallback
    upper = cleaned.upper()
    if upper in _CURRENCY_MAP:
        return _CURRENCY_MAP[upper]
    for token, symbol in _CURRENCY_MAP.items():
        if token in upper:
            return symbol
    return cleaned


def _coerce_price(raw: Any) -> float | None:
    """Convert numeric or localized price strings into a positive float."""
    if isinstance(raw, (int, float)):
        val = float(raw)
        return val if val > 0 else None
    if not isinstance(raw, str):
        return None
    cleaned = re.sub(r"[^\d.,]", "", raw.replace("\xa0", "").replace(" ", ""))
    if not cleaned:
        return None
    if "," in cleaned and "." in cleaned:
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif "," in cleaned:
        parts = cleaned.split(",")
        if len(parts[-1]) == 2:
            cleaned = "".join(parts[:-1]) + "." + parts[-1]
        else:
            cleaned = cleaned.replace(",", "")
    try:
        val = float(cleaned)
    except ValueError:
        return None
    return val if val > 0 else None


def parse_gemini_json(text: str) -> dict[str, Any] | None:
    """Extract a JSON object from Gemini response text, tolerating code fences."""
    stripped = text.strip()
    if not stripped:
        return None
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", stripped, re.DOTALL)
    candidate = fence_match.group(1) if fence_match else stripped
    if not candidate.startswith("{"):
        brace_match = re.search(r"\{.*\}", candidate, re.DOTALL)
        if not brace_match:
            return None
        candidate = brace_match.group(0)
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def parse_monthly_usage(raw: str, current_month: str) -> int:
    """Parse stored 'YYYY-MM:count' usage string; reset to 0 on new month."""
    if not raw or ":" not in raw:
        return 0
    month_part, _, count_part = raw.strip().partition(":")
    if month_part != current_month:
        return 0
    try:
        return max(0, int(count_part))
    except ValueError:
        return 0


def format_monthly_usage(current_month: str, count: int) -> str:
    """Format monthly grounding query counter for Config persistence."""
    return f"{current_month}:{max(0, count)}"


def is_cooldown_elapsed(
    last_checked: str,
    cooldown_hours: int,
    now: datetime | None = None,
) -> bool:
    """Return True when last_checked is absent or older than cooldown_hours."""
    if cooldown_hours <= 0 or not last_checked.strip():
        return True
    try:
        normalized = last_checked.strip().replace("Z", "+00:00")
        checked_dt = datetime.fromisoformat(normalized)
        if checked_dt.tzinfo is None:
            checked_dt = checked_dt.replace(tzinfo=UTC)
    except ValueError:
        return True
    ref = now or datetime.now(UTC)
    return (ref - checked_dt) >= timedelta(hours=cooldown_hours)


def _extract_search_hints(url: str) -> tuple[str, str]:
    """Extract clean domain and human-readable product keywords from a URL."""
    parsed = urlparse(url)
    host = parsed.netloc.lower().removeprefix("www.")
    segments = [seg for seg in parsed.path.split("/") if seg]
    slug = segments[-1] if segments else ""
    slug = re.sub(r"\.(html?|php|aspx?)$", "", slug, flags=re.IGNORECASE)
    keywords = re.sub(r"[-_]+", " ", slug).strip()
    return host, keywords


def _infer_region_hint(url: str) -> str:
    """Infer country/currency context from URL path or TLD."""
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    path = parsed.path.lower()
    if "/pl-pl" in path or host.endswith(".pl"):
        return "Poland / PLN (zł)"
    if host.endswith(".ua") or "/uk-ua" in path or "/ru/" in path:
        return "Ukraine / UAH (₴)"
    if "/de-de" in path or host.endswith(".de"):
        return "Germany / EUR (€)"
    if "/en-gb" in path or host.endswith(".co.uk"):
        return "United Kingdom / GBP (£)"
    return "match the exact store locale in the URL"


class GeminiSearchFallbackClient:
    """Calls Gemini with Google Search grounding when Playwright hits CAPTCHA."""

    def __init__(
        self,
        api_key: str = "",
        model: str = DEFAULT_GEMINI_MODEL,
        monthly_cap: int = DEFAULT_MONTHLY_CAP,
        cooldown_hours: int = DEFAULT_COOLDOWN_HOURS,
        timeout_s: float = 20.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._api_key = api_key.strip()
        self._model = model.strip() or DEFAULT_GEMINI_MODEL
        self._monthly_cap = max(0, monthly_cap)
        self._cooldown_hours = max(0, cooldown_hours)
        self._timeout_s = timeout_s
        self._transport = transport

    @classmethod
    def from_env(cls) -> GeminiSearchFallbackClient:
        """Instantiate fallback client from environment variables."""
        api_key = os.getenv("GEMINI_API_KEY", "").strip()
        model = os.getenv("GEMINI_GROUNDING_MODEL", DEFAULT_GEMINI_MODEL).strip()
        try:
            cap = int(os.getenv("GEMINI_GROUNDING_MONTHLY_CAP", str(DEFAULT_MONTHLY_CAP)))
        except ValueError:
            cap = DEFAULT_MONTHLY_CAP
        try:
            cooldown = int(
                os.getenv("GEMINI_GROUNDING_COOLDOWN_HOURS", str(DEFAULT_COOLDOWN_HOURS))
            )
        except ValueError:
            cooldown = DEFAULT_COOLDOWN_HOURS
        return cls(
            api_key=api_key,
            model=model,
            monthly_cap=cap,
            cooldown_hours=cooldown,
        )

    @property
    def is_enabled(self) -> bool:
        """Return True when a Gemini API key and positive monthly cap are configured."""
        return bool(self._api_key) and self._monthly_cap > 0

    @property
    def monthly_cap(self) -> int:
        """Return configured monthly Google Search query cap."""
        return self._monthly_cap

    @property
    def cooldown_hours(self) -> int:
        """Return minimum hours between grounded fallback checks per item."""
        return self._cooldown_hours

    async def extract_price(
        self,
        url: str,
        title: str = "",
        currency_hint: str = "",
    ) -> GeminiSearchResult | None:
        """Look up cached Google Search price for a CAPTCHA-blocked product URL."""
        if not self.is_enabled:
            return None

        region_hint = _infer_region_hint(url)
        host, keywords = _extract_search_hints(url)
        target_desc = f"{keywords} on {host}" if keywords else url
        prompt_lines = [
            "Search Google for the current price, currency, product title, and direct product "
            f"image URL (from {host} or its CDN) for {target_desc}.",
            f"Expected store locale: {region_hint}",
        ]
        if title.strip():
            prompt_lines.append(f"Known product title: {title.strip()}")
        if currency_hint.strip():
            prompt_lines.append(f"Known currency: {currency_hint.strip()}")

        endpoint = f"{GEMINI_API_BASE}/models/{self._model}:generateContent"
        payload: dict[str, Any] = {
            "contents": [{"parts": [{"text": "\n".join(prompt_lines)}]}],
            "tools": [{"google_search": {}}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": {
                    "type": "OBJECT",
                    "properties": {
                        "price": {"type": "NUMBER", "nullable": True},
                        "currency": {"type": "STRING", "nullable": True},
                        "title": {"type": "STRING", "nullable": True},
                        "image_url": {"type": "STRING", "nullable": True},
                    },
                    "required": ["price", "currency", "title", "image_url"],
                },
            },
        }

        client_kwargs: dict[str, Any] = {"timeout": self._timeout_s}
        if self._transport is not None:
            client_kwargs["transport"] = self._transport

        async with httpx.AsyncClient(**client_kwargs) as client:
            resp = await client.post(
                endpoint,
                headers={"x-goog-api-key": self._api_key},
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

        candidates = data.get("candidates") or []
        if not candidates:
            return None
        candidate = candidates[0]
        grounding = candidate.get("groundingMetadata") or {}
        search_queries = grounding.get("webSearchQueries") or []
        queries_used = max(1, len(search_queries))

        parts = (candidate.get("content") or {}).get("parts") or []
        raw_text = "".join(
            p.get("text", "") for p in parts if isinstance(p, dict)
        )
        parsed = parse_gemini_json(raw_text)
        if not parsed:
            return None

        price = _coerce_price(parsed.get("price"))
        if price is None:
            return None

        currency = normalize_currency(
            str(parsed.get("currency")) if parsed.get("currency") is not None else None,
            fallback=currency_hint or "$",
        )
        resolved_title = str(parsed.get("title") or title or url).strip()
        raw_img = parsed.get("image_url")
        image_url = (
            raw_img.strip()
            if isinstance(raw_img, str) and raw_img.strip().startswith(("http://", "https://"))
            else ""
        )
        return GeminiSearchResult(
            price=price,
            currency=currency,
            title=resolved_title,
            queries_used=queries_used,
            image_url=image_url,
        )
