"""Unit tests for the Gemini Google Search grounding fallback adapter."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
import pytest

from pricepulse.adapters.gemini_search_fallback import (
    GeminiSearchFallbackClient,
    _extract_locale_prefix,
    _extract_product_id,
    _extract_search_hints,
    format_monthly_usage,
    is_cooldown_elapsed,
    normalize_currency,
    parse_gemini_json,
    parse_monthly_usage,
)


def test_parse_gemini_json_and_currency_normalization() -> None:
    """Verify JSON extraction from fenced output and currency symbol mapping."""
    raw = '```json\n{"price": 800, "currency": "PLN", "title": "Cashmere Jumper"}\n```'
    parsed = parse_gemini_json(raw)
    assert parsed is not None
    assert parsed["price"] == 800
    assert normalize_currency("PLN") == "zł"
    assert normalize_currency("UAH") == "₴"
    assert normalize_currency("USD") == "$"


def test_monthly_usage_parsing_and_rollover() -> None:
    """Verify monthly usage counter parses matching month and resets on rollover."""
    assert parse_monthly_usage("2026-11:120", "2026-11") == 120
    assert parse_monthly_usage("2026-10:4400", "2026-11") == 0
    assert parse_monthly_usage("invalid", "2026-11") == 0
    assert format_monthly_usage("2026-11", 42) == "2026-11:42"


def test_cooldown_elapsed_logic() -> None:
    """Verify 48h cooldown blocks recent checks and allows stale/empty checks."""
    now = datetime(2026, 11, 17, 12, 0, tzinfo=UTC)
    recent = (now - timedelta(hours=12)).strftime("%Y-%m-%dT%H:%M:%SZ")
    stale = (now - timedelta(hours=49)).strftime("%Y-%m-%dT%H:%M:%SZ")

    assert is_cooldown_elapsed("", 48, now=now) is True
    assert is_cooldown_elapsed(recent, 48, now=now) is False
    assert is_cooldown_elapsed(stale, 48, now=now) is True


@pytest.mark.asyncio
async def test_gemini_client_extracts_price_with_mock_transport() -> None:
    """Verify GeminiSearchFallbackClient parses grounded JSON and query count."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["x-goog-api-key"] == "test-key"
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": (
                                        '{"price": "220,00", "currency": "PLN", '
                                        '"title": "Relaxed Knit Jumper", '
                                        '"image_url": "https://media.stories.com/item.jpg"}'
                                    )
                                }
                            ]
                        },
                        "groundingMetadata": {
                            "webSearchQueries": ["stories.com 1089897002 price"],
                        },
                    }
                ]
            },
        )

    client = GeminiSearchFallbackClient(
        api_key="test-key",
        transport=httpx.MockTransport(handler),
    )
    res = await client.extract_price(
        "https://www.stories.com/pl-pl/product/relaxed-knit-jumper-black-1089897002/"
    )
    assert res is not None
    assert res.price == 220.0
    assert res.currency == "zł"
    assert res.title == "Relaxed Knit Jumper"
    assert res.image_url == "https://media.stories.com/item.jpg"
    assert res.queries_used == 1


def test_extract_search_hints_from_product_url() -> None:
    """Verify domain, product slug keywords, and trailing SKU ID are extracted."""
    url = (
        "https://www.cos.com/pl-pl/women/accessories/bags/handbags/product/"
        "trullo-flap-bag-leather-black-1349970001"
    )
    host, keywords = _extract_search_hints(url)
    assert host == "cos.com"
    assert keywords == "trullo flap bag leather black 1349970001"
    assert _extract_product_id(url) == "1349970001"
    assert (
        _extract_product_id(
            "https://www.stories.com/pl-pl/product/boucl-wool-car-coat-dark-grey-1338952001/"
        )
        == "1338952001"
    )


@pytest.mark.asyncio
async def test_gemini_prompt_anchors_exact_url_and_sku() -> None:
    """Verify Gemini request prompt includes exact URL, SKU ID, and temperature=0.0."""
    captured_payload: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        captured_payload.update(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": (
                                        '{"price": 800, "currency": "PLN", '
                                        '"title": "Cashmere Crew-Neck Jumper", '
                                        '"image_url": ""}'
                                    )
                                }
                            ]
                        },
                        "groundingMetadata": {
                            "webSearchQueries": ["cos.com 1288193001"],
                        },
                    }
                ]
            },
        )

    target_url = (
        "https://www.cos.com/pl-pl/women/womenswear/knitwear/jumpers/cashmere/product/"
        "cashmere-crew-neck-jumper-dark-grey-mlange-1288193001"
    )
    client = GeminiSearchFallbackClient(
        api_key="test-key",
        transport=httpx.MockTransport(handler),
    )
    res = await client.extract_price(target_url)
    assert res is not None
    assert res.price == 800.0
    assert res.currency == "zł"

    gen_cfg = captured_payload["generationConfig"]
    assert isinstance(gen_cfg, dict)
    assert gen_cfg["temperature"] == 0.0

    contents = captured_payload["contents"]
    assert isinstance(contents, list)
    prompt_text = contents[0]["parts"][0]["text"]
    assert f"Exact product URL: {target_url}" in prompt_text
    assert 'site:cos.com/pl-pl "1288193001"' in prompt_text
    assert "Do NOT use prices from different products" in prompt_text
    assert "Exact product/article ID: 1288193001" in prompt_text
    assert "Poland / PLN (zł)" in prompt_text
    assert _extract_locale_prefix(target_url) == "/pl-pl"
    assert _extract_locale_prefix("https://example.com/product/abc") == ""


@pytest.mark.asyncio
async def test_gemini_two_stage_grounding_and_ungrounded_rejection() -> None:
    """Verify two-stage prose->JSON extraction and rejection of ungrounded prose."""
    import json

    call_payloads: list[dict[str, object]] = []

    def two_stage_handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        call_payloads.append(body)
        if len(call_payloads) == 1:
            assert "tools" in body
            return httpx.Response(
                200,
                json={
                    "candidates": [
                        {
                            "content": {
                                "parts": [
                                    {
                                        "text": (
                                            "On cos.com/pl-pl, article 1288193001 "
                                            "(Cashmere Crew-Neck Jumper) costs 1150 zł."
                                        )
                                    }
                                ]
                            },
                            "groundingMetadata": {
                                "webSearchQueries": [
                                    'site:cos.com/pl-pl "1288193001"',
                                    "cos 1288193001 pln",
                                ],
                            },
                        }
                    ]
                },
            )
        assert "tools" not in body
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": (
                                        '{"price": 1150, "currency": "PLN", '
                                        '"title": "Cashmere Crew-Neck Jumper", '
                                        '"image_url": "https://media.cos.com/jumper.jpg"}'
                                    )
                                }
                            ]
                        }
                    }
                ]
            },
        )

    url = (
        "https://www.cos.com/pl-pl/women/womenswear/knitwear/jumpers/cashmere/product/"
        "cashmere-crew-neck-jumper-dark-grey-mlange-1288193001"
    )
    client = GeminiSearchFallbackClient(
        api_key="test-key",
        transport=httpx.MockTransport(two_stage_handler),
    )
    res = await client.extract_price(url)
    assert res is not None
    assert len(call_payloads) == 2
    assert res.price == 1150.0
    assert res.currency == "zł"
    assert res.image_url == "https://media.cos.com/jumper.jpg"
    assert res.queries_used == 2

    def ungrounded_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {
                            "parts": [{"text": "I think it costs 800 PLN."}]
                        },
                        "groundingMetadata": {},
                    }
                ]
            },
        )

    ungrounded_client = GeminiSearchFallbackClient(
        api_key="test-key",
        transport=httpx.MockTransport(ungrounded_handler),
    )
    assert await ungrounded_client.extract_price(url) is None
