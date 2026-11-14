"""Unit tests for 3-tier waterfall extraction and pooled scraper resilience."""

from __future__ import annotations

import pytest

from pricepulse.adapters.playwright_scraper import (
    check_items_pooled,
    extract_preview_from_html,
)
from pricepulse.domain.models import TrackedItem


def test_tier1_json_ld_extraction() -> None:
    """Verify Tier 1 extracts schema.org Product/Offer price and currency."""
    html = """
    <html><head>
      <script type="application/ld+json">
        {"@type": "Product", "name": "Sony XM5", "image": "https://img.test/1.jpg",
         "offers": {"@type": "Offer", "price": "299.99", "priceCurrency": "USD"}}
      </script>
    </head><body></body></html>
    """
    preview = extract_preview_from_html("https://example.com/xm5", html)
    assert preview.extraction_tier == "TIER_1_JSON_LD"
    assert preview.title == "Sony XM5"
    assert preview.price == 299.99
    assert preview.currency == "$"


def test_tier2_opengraph_extraction() -> None:
    """Verify Tier 2 extracts OpenGraph meta price when JSON-LD is absent."""
    html = """
    <html><head>
      <meta property="og:title" content="Keychron Q1" />
      <meta property="og:price:amount" content="189.50" />
      <meta property="og:price:currency" content="EUR" />
      <meta property="og:image" content="https://img.test/q1.jpg" />
    </head><body></body></html>
    """
    preview = extract_preview_from_html("https://example.com/q1", html)
    assert preview.extraction_tier == "TIER_2_OPENGRAPH"
    assert preview.price == 189.50
    assert preview.currency == "€"


def test_tier3_dom_regex_fallback() -> None:
    """Verify Tier 3 extracts currency RegEx when JSON-LD and OG are absent."""
    html = "<html><head><title>Desk Lamp</title></head><body><span>₴1,499.00</span></body></html>"
    preview = extract_preview_from_html("https://example.com/lamp", html)
    assert preview.extraction_tier == "TIER_3_DOM_REGEX"
    assert preview.title == "Desk Lamp"
    assert preview.price == 1499.0
    assert preview.currency == "₴"


@pytest.mark.asyncio
async def test_pooled_scraper_retries_and_isolates_failures() -> None:
    """Verify Semaphore(4) pooling retries once and isolates failed URLs."""
    items = [
        TrackedItem(
            item_id="i-1",
            name="Ok After Retry",
            url="https://example.com/retry",
            image_url="",
            currency="$",
            initial_price=100.0,
            current_price=100.0,
            target_price=80.0,
            lowest_price=100.0,
            last_checked="2026-11-13T12:00:00Z",
        ),
        TrackedItem(
            item_id="i-2",
            name="Always Fails",
            url="https://example.com/fail",
            image_url="",
            currency="$",
            initial_price=50.0,
            current_price=50.0,
            target_price=40.0,
            lowest_price=50.0,
            last_checked="2026-11-13T12:00:00Z",
        ),
    ]
    attempts: dict[str, int] = {}

    async def fake_fetch(url: str) -> str:
        attempts[url] = attempts.get(url, 0) + 1
        if "fail" in url:
            raise TimeoutError("Timed out")
        if attempts[url] == 1:
            raise ConnectionError("Transient reset")
        return '<html><meta property="og:price:amount" content="79.00"></html>'

    outcomes = await check_items_pooled(items, fake_fetch, concurrency=4, retries=1)
    assert outcomes[0].success is True
    assert outcomes[0].price == 79.0
    assert outcomes[1].success is False
    assert "Timed out" in (outcomes[1].error or "")


def test_tier2_itemprop_and_html_unescape() -> None:
    """Verify Tier 2 extracts microdata itemprop price and unescapes HTML entities."""
    html = """
    <html><head>
      <meta property="og:title" content="Джемпер &laquo;Човен&raquo;" />
      <meta itemprop="price" content="36990" />
      <meta itemprop="priceCurrency" content="UAH" />
      <meta property="og:image" content="https://img.test/bosch.jpg" />
    </head><body></body></html>
    """
    preview = extract_preview_from_html("https://example.com/bosch", html)
    assert preview.extraction_tier == "TIER_2_OPENGRAPH"
    assert preview.title == "Джемпер «Човен»"
    assert preview.price == 36990.0
    assert preview.currency == "₴"


def test_tier3_suffix_currency_fallback() -> None:
    """Verify Tier 3 extracts suffix UAH/грн price formats."""
    html = "<html><head><title>Dryer</title></head><body><span>36 990 грн</span></body></html>"
    preview = extract_preview_from_html("https://example.com/dryer", html)
    assert preview.extraction_tier == "TIER_3_DOM_REGEX"
    assert preview.price == 36990.0
    assert preview.currency == "₴"


def test_tier1_image_object_extraction() -> None:
    """Verify Tier 1 extracts URL from schema.org ImageObject dict or list."""
    html = """
    <html><head>
      <script type="application/ld+json">
        {"@type": "Product", "name": "BEXID Olive",
         "image": {"@type": "ImageObject", "url": "https://img.test/knife.jpg", "width": "1600"},
         "offers": {"@type": "Offer", "price": "930", "priceCurrency": "UAH"}}
      </script>
    </head><body></body></html>
    """
    preview = extract_preview_from_html("https://example.com/bexid", html)
    assert preview.image_url == "https://img.test/knife.jpg"
    assert preview.price == 930.0
    assert preview.currency == "₴"


def test_tier3_ignores_script_and_style_dollar_tokens() -> None:
    """Verify Tier 3 strips <script>/<style> so JS tokens like $4 never match."""
    html = """
    <html><head>
      <title>Blocked or JS page</title>
      <script>window.__cf = "$4"; var x = $1;</script>
      <style>.a { content: "$2"; }</style>
    </head><body><p>36 990 грн</p></body></html>
    """
    preview = extract_preview_from_html("https://example.com/js", html)
    assert preview.price == 36990.0
    assert preview.currency == "₴"

    only_script = "<html><body><script>var $4 = 1;</script><p>Access denied</p></body></html>"
    with pytest.raises(ValueError, match="Unable to extract price"):
        extract_preview_from_html("https://example.com/denied", only_script)

