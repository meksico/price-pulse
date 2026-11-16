"""Unit tests for 3-tier waterfall extraction and pooled scraper resilience."""

from __future__ import annotations

import pytest

from pricepulse.adapters.playwright_scraper import (
    PlaywrightScraperAdapter,
    check_items_pooled,
    detect_captcha_challenge,
    extract_preview_from_html,
    parse_proxy_config,
    parse_proxy_pool,
    preview_urls_pooled,
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


def test_parse_proxy_config() -> None:
    """Verify optional SCRAPER_PROXY_URL parsing and round-robin rotation."""
    assert parse_proxy_config(None) is None
    assert parse_proxy_config("   ") is None
    cfg = parse_proxy_config("http://user%401:p%40ss@proxy.example.com:8080")
    assert cfg == {
        "server": "http://proxy.example.com:8080",
        "username": "user@1",
        "password": "p@ss",
    }
    pool = parse_proxy_pool(
        "1.2.3.4:6000:u1:p1, http://u2:p2@5.6.7.8:7000\n9.10.11.12:8000:u3:p3"
    )
    assert len(pool) == 3
    assert pool[0] == {"server": "http://1.2.3.4:6000", "username": "u1", "password": "p1"}

    adapter = PlaywrightScraperAdapter(
        proxy_url="1.1.1.1:1000:u:p,2.2.2.2:2000:u:p,3.3.3.3:3000:u:p,4.4.4.4:4000:u:p"
    )
    first = [p["server"] for p in adapter._next_proxies(2)]
    second = [p["server"] for p in adapter._next_proxies(2)]
    assert first == ["http://1.1.1.1:1000", "http://2.2.2.2:2000"]
    assert second == ["http://3.3.3.3:3000", "http://4.4.4.4:4000"]


@pytest.mark.asyncio
async def test_preview_urls_pooled_handles_mixed_success_and_failure() -> None:
    """Verify pooled batch previewing isolates failures and retries once."""
    attempts: dict[str, int] = {}

    async def fake_fetch(url: str) -> str:
        attempts[url] = attempts.get(url, 0) + 1
        if "blocked" in url:
            raise ValueError(f"HTTP 403 for URL: {url}")
        if "flaky" in url and attempts[url] == 1:
            raise TimeoutError("Transient timeout")
        return (
            '<html><meta property="og:title" content="Batch Item" />'
            '<meta property="og:price:amount" content="199.00" /></html>'
        )

    outcomes = await preview_urls_pooled(
        [
            "https://example.com/flaky",
            "https://example.com/blocked",
        ],
        fake_fetch,
        concurrency=4,
        retries=1,
    )
    assert len(outcomes) == 2
    assert outcomes[0].success is True
    assert outcomes[0].preview is not None
    assert outcomes[0].preview.price == 199.0
    assert outcomes[1].success is False
    assert "HTTP 403" in (outcomes[1].error or "")


def test_detect_captcha_challenge() -> None:
    """Verify zhCAPTCHA / Cloudflare / reCAPTCHA detection on 403/429 responses."""
    zh_html = "<html><head><title>DDOS protection page</title></head><body>zhCAPTCHA</body></html>"
    assert detect_captcha_challenge(403, zh_html) is True
    assert detect_captcha_challenge(200, zh_html) is False
    assert detect_captcha_challenge(403, "<html><body>Forbidden</body></html>") is False

