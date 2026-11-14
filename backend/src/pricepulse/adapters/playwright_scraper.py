"""Playwright 3-tier waterfall scraper adapter (REQ-SCRAPE-01, REQ-SCRAPE-02)."""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import Awaitable, Callable
from html.parser import HTMLParser
from typing import Any

from playwright.async_api import Browser, async_playwright

from pricepulse.domain.models import ScrapeOutcome, ScrapePreview, TrackedItem

DEFAULT_CONCURRENCY: int = 4
DEFAULT_TIMEOUT_MS: int = 20_000
MAX_RETRIES: int = 1

_CURRENCY_MAP: dict[str, str] = {
    "USD": "$",
    "EUR": "€",
    "UAH": "₴",
    "GBP": "£",
    "$": "$",
    "€": "€",
    "₴": "₴",
    "£": "£",
}

_PRICE_REGEX = re.compile(r"([$€₴£])\s*([0-9][0-9,\s]*\.?[0-9]{0,2})")


class _MetaAndJsonLdParser(HTMLParser):
    """Lightweight HTML parser extracting JSON-LD scripts and meta tags."""

    def __init__(self) -> None:
        super().__init__()
        self.json_ld_blocks: list[str] = []
        self.meta_tags: dict[str, str] = {}
        self.title_text: str = ""
        self._in_json_ld: bool = False
        self._in_title: bool = False
        self._buf: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {k.lower(): (v or "") for k, v in attrs}
        if tag.lower() == "script" and attr_map.get("type", "").lower() == "application/ld+json":
            self._in_json_ld = True
            self._buf = []
        elif tag.lower() == "title":
            self._in_title = True
            self._buf = []
        elif tag.lower() == "meta":
            key = (attr_map.get("property") or attr_map.get("name") or "").lower()
            content = attr_map.get("content", "").strip()
            if key and content:
                self.meta_tags[key] = content

    def handle_data(self, data: str) -> None:
        if self._in_json_ld or self._in_title:
            self._buf.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "script" and self._in_json_ld:
            self.json_ld_blocks.append("".join(self._buf).strip())
            self._in_json_ld = False
            self._buf = []
        elif tag.lower() == "title" and self._in_title:
            self.title_text = "".join(self._buf).strip()
            self._in_title = False
            self._buf = []


def _normalize_currency(raw: str | None) -> str:
    """Normalize ISO currency code or symbol to display symbol."""
    if not raw:
        return "$"
    cleaned = raw.strip().upper()
    return _CURRENCY_MAP.get(cleaned, _CURRENCY_MAP.get(raw.strip(), "$"))


def _parse_float(raw: Any) -> float | None:
    """Parse numeric price value safely."""
    if isinstance(raw, (int, float)):
        return float(raw) if raw > 0 else None
    if isinstance(raw, str):
        cleaned = raw.replace(",", "").replace(" ", "").strip()
        try:
            val = float(cleaned)
            return val if val > 0 else None
        except ValueError:
            return None
    return None


def _find_product_in_json_ld(node: Any) -> dict[str, Any] | None:
    """Recursively locate a schema.org Product or Offer dict."""
    if isinstance(node, list):
        for item in node:
            found = _find_product_in_json_ld(item)
            if found is not None:
                return found
        return None
    if not isinstance(node, dict):
        return None
    node_type = str(node.get("@type", "")).lower()
    if "product" in node_type or "offer" in node_type:
        return node
    if "@graph" in node:
        return _find_product_in_json_ld(node["@graph"])
    return None


def extract_preview_from_html(url: str, html: str) -> ScrapePreview:
    """Execute 3-tier waterfall extraction (JSON-LD -> OpenGraph -> DOM RegEx)."""
    parser = _MetaAndJsonLdParser()
    parser.feed(html)

    og_title = parser.meta_tags.get("og:title") or parser.title_text or url
    og_image = parser.meta_tags.get("og:image", "")

    # Tier 1: Semantic JSON-LD
    for block in parser.json_ld_blocks:
        try:
            parsed = json.loads(block)
        except json.JSONDecodeError:
            continue
        product = _find_product_in_json_ld(parsed)
        if product is None:
            continue
        offers = product.get("offers", product)
        if isinstance(offers, list) and offers:
            offers = offers[0]
        if isinstance(offers, dict):
            price = _parse_float(offers.get("price") or offers.get("lowPrice"))
            if price is not None:
                currency = _normalize_currency(offers.get("priceCurrency"))
                title = str(product.get("name") or og_title).strip()
                image_raw = product.get("image", og_image)
                image = image_raw[0] if isinstance(image_raw, list) and image_raw else image_raw
                return ScrapePreview(
                    url=url,
                    title=title,
                    price=round(price, 2),
                    currency=currency,
                    image_url=str(image or ""),
                    extraction_tier="TIER_1_JSON_LD",
                )

    # Tier 2: OpenGraph / Meta Tags
    meta_price = _parse_float(
        parser.meta_tags.get("og:price:amount")
        or parser.meta_tags.get("product:price:amount")
    )
    if meta_price is not None:
        meta_curr = _normalize_currency(
            parser.meta_tags.get("og:price:currency")
            or parser.meta_tags.get("product:price:currency")
        )
        return ScrapePreview(
            url=url,
            title=og_title,
            price=round(meta_price, 2),
            currency=meta_curr,
            image_url=og_image,
            extraction_tier="TIER_2_OPENGRAPH",
        )

    # Tier 3: DOM / Currency RegEx Fallback
    match = _PRICE_REGEX.search(html)
    if match is not None:
        symbol = _normalize_currency(match.group(1))
        val = _parse_float(match.group(2))
        if val is not None:
            return ScrapePreview(
                url=url,
                title=og_title,
                price=round(val, 2),
                currency=symbol,
                image_url=og_image,
                extraction_tier="TIER_3_DOM_REGEX",
            )

    raise ValueError(f"Unable to extract price from URL: {url}")


class PlaywrightScraperAdapter:
    """Headless Chromium scraper with bounded Semaphore(4) concurrency and retries."""

    def __init__(
        self,
        concurrency: int = DEFAULT_CONCURRENCY,
        timeout_ms: int = DEFAULT_TIMEOUT_MS,
        retries: int = MAX_RETRIES,
    ) -> None:
        self._concurrency = concurrency
        self._timeout_ms = timeout_ms
        self._retries = retries

    async def _fetch_html(self, browser: Browser, url: str) -> str:
        """Render URL in an isolated browser page and return full HTML."""
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            )
        )
        try:
            page = await context.new_page()
            await page.goto(url, wait_until="domcontentloaded", timeout=self._timeout_ms)
            return await page.content()
        finally:
            await context.close()

    async def preview_url(self, url: str) -> ScrapePreview:
        """Fetch and extract preview metadata for a single URL."""
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            try:
                html = await self._fetch_html(browser, url)
                return extract_preview_from_html(url, html)
            finally:
                await browser.close()

    async def check_items(self, items: list[TrackedItem]) -> list[ScrapeOutcome]:
        """Scrape all items using a shared Chromium browser and Semaphore(4)."""
        if not items:
            return []
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            try:
                return await check_items_pooled(
                    items=items,
                    fetch_fn=lambda url: self._fetch_html(browser, url),
                    concurrency=self._concurrency,
                    retries=self._retries,
                )
            finally:
                await browser.close()


async def check_items_pooled(
    items: list[TrackedItem],
    fetch_fn: Callable[[str], Awaitable[str]],
    concurrency: int = DEFAULT_CONCURRENCY,
    retries: int = MAX_RETRIES,
) -> list[ScrapeOutcome]:
    """Execute bounded concurrent scraping with per-item retry and fault isolation."""
    semaphore = asyncio.Semaphore(concurrency)

    async def _worker(item: TrackedItem) -> ScrapeOutcome:
        last_err = ""
        async with semaphore:
            for attempt in range(retries + 1):
                try:
                    html = await fetch_fn(item.url)
                    preview = extract_preview_from_html(item.url, html)
                    return ScrapeOutcome(
                        item_id=item.item_id,
                        success=True,
                        price=preview.price,
                        currency=preview.currency,
                        extraction_tier=preview.extraction_tier,
                    )
                except Exception as exc:
                    last_err = f"attempt {attempt + 1}: {exc}"
        return ScrapeOutcome(
            item_id=item.item_id,
            success=False,
            error=f"{item.item_id} ({item.url}): {last_err}",
        )

    return await asyncio.gather(*(_worker(item) for item in items))

