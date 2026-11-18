"""Gmail API consolidated digest notifier adapter (REQ-ALERT-01, REQ-SCRAPE-03)."""

from __future__ import annotations

import base64
import html
from email.message import EmailMessage
from typing import Any
from urllib.parse import urlparse

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from pricepulse.domain.models import TrackedItem

_FONT_STACK = (
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, "
    "Helvetica, Arial, sans-serif"
)
_LINK_STYLE = "color: #2563EB; text-decoration: underline; font-weight: 500;"


def build_gmail_service(
    client_id: str,
    client_secret: str,
    refresh_token: str,
) -> Any:
    """Build an authenticated Gmail API v1 service using OAuth Refresh Token."""
    creds = Credentials(  # type: ignore[no-untyped-call]
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_id,
        client_secret=client_secret,
    )
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def _extract_domain(url: str) -> str:
    """Return a clean lowercase hostname without leading 'www.'."""
    host = (urlparse(url).hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    return host or "store"


def _format_price(currency: str, amount: float) -> str:
    """Format a monetary amount with its currency symbol and thousand separators."""
    return f"{currency}{amount:,.2f}"


def _render_email_shell(
    title: str,
    preheader: str,
    heading: str,
    subtitle: str,
    rows_html: str,
    footer_html: str,
) -> str:
    """Render a table-based, inline-styled HTML email compatible with major clients."""
    esc_title = html.escape(title)
    esc_preheader = html.escape(preheader)
    esc_heading = html.escape(heading)
    esc_subtitle = html.escape(subtitle)
    return (
        "<!DOCTYPE html>\n"
        '<html lang="en">\n'
        "<head>\n"
        '  <meta charset="utf-8" />\n'
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n'
        f"  <title>{esc_title}</title>\n"
        "</head>\n"
        f'<body style="margin: 0; padding: 0; background-color: #F3F4F6; '
        f'font-family: {_FONT_STACK}; color: #09090B; -webkit-text-size-adjust: 100%;">\n'
        '  <div style="display: none; max-height: 0; overflow: hidden; '
        'font-size: 1px; line-height: 1px; color: #F3F4F6;">'
        f"{esc_preheader}</div>\n"
        '  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'border="0" style="background-color: #F3F4F6;">\n'
        "    <tr>\n"
        '      <td align="center" style="padding: 24px 12px;">\n'
        "        <!--[if mso]>\n"
        '        <table role="presentation" width="600" cellpadding="0" '
        'cellspacing="0" border="0"><tr><td>\n'
        "        <![endif]-->\n"
        '        <table role="presentation" width="100%" cellpadding="0" '
        'cellspacing="0" border="0" style="max-width: 600px; '
        'background-color: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 8px;">\n'
        "          <tr>\n"
        '            <td style="padding: 24px 24px 16px 24px; '
        'border-bottom: 1px solid #E5E7EB;">\n'
        '              <div style="font-size: 13px; font-weight: 700; '
        'letter-spacing: 0.02em; color: #09090B; margin-bottom: 8px;">PricePulse</div>\n'
        '              <h1 style="margin: 0 0 6px 0; font-size: 20px; '
        'line-height: 28px; font-weight: 700; color: #09090B;">'
        f"{esc_heading}</h1>\n"
        '              <p style="margin: 0; font-size: 14px; line-height: 20px; '
        f'color: #52525B;">{esc_subtitle}</p>\n'
        "            </td>\n"
        "          </tr>\n"
        f"{rows_html}"
        "          <tr>\n"
        '            <td style="padding: 16px 24px; background-color: #FAFAFA; '
        'border-top: 1px solid #E5E7EB; border-radius: 0 0 8px 8px;">\n'
        '              <p style="margin: 0; font-size: 12px; line-height: 18px; '
        f'color: #71717A;">{footer_html}</p>\n'
        "            </td>\n"
        "          </tr>\n"
        "        </table>\n"
        "        <!--[if mso]>\n"
        "        </td></tr></table>\n"
        "        <![endif]-->\n"
        "      </td>\n"
        "    </tr>\n"
        "  </table>\n"
        "</body>\n"
        "</html>"
    )


class GmailDigestNotifier:
    """Dispatches consolidated target-price and manual-check emails via Gmail API."""

    def __init__(self, service: Any, sender: str = "me") -> None:
        self._service = service
        self._sender = sender

    def _send_email(
        self,
        recipient: str,
        subject: str,
        plain_text: str,
        html_body: str,
    ) -> None:
        """Send a multipart/alternative email (plain text + HTML) via Gmail API."""
        normalized_to = ", ".join(r.strip() for r in recipient.split(",") if r.strip())
        msg = EmailMessage()
        msg["To"] = normalized_to
        msg["Subject"] = subject
        msg.set_content(plain_text)
        msg.add_alternative(html_body, subtype="html")

        raw_bytes = base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")
        self._service.users().messages().send(
            userId=self._sender,
            body={"raw": raw_bytes},
        ).execute()

    def send_discount_digest(
        self,
        recipient: str,
        discounted_items: list[TrackedItem],
    ) -> bool:
        """Send one consolidated digest email for all newly discounted items."""
        if not recipient.strip() or not discounted_items:
            return False

        count = len(discounted_items)
        noun = "item" if count == 1 else "items"
        heading = f"{count} {noun} reached your target price"
        subtitle = "Here are the latest price drops from your tracked list."
        subject = f"PricePulse: {count} price {'drop' if count == 1 else 'drops'} found"
        preheader = f"{heading} — open any store link below to view the deal."

        plain_lines = [heading, "", subtitle, ""]
        row_chunks: list[str] = []

        for item in discounted_items:
            domain = _extract_domain(item.url)
            now_price = _format_price(item.currency, item.current_price)
            target_price = _format_price(item.currency, item.target_price)
            drop_label = f"-{item.drop_pct:.1f}%"

            plain_lines.extend(
                [
                    f"- {item.name} ({domain})",
                    f"  Now: {now_price} | Target: {target_price} ({drop_label})",
                    f"  View on {domain}: {item.url}",
                    "",
                ]
            )

            esc_name = html.escape(item.name)
            esc_domain = html.escape(domain)
            esc_url = html.escape(item.url, quote=True)
            row_chunks.append(
                "          <tr>\n"
                '            <td style="padding: 18px 24px; border-bottom: 1px solid #F3F4F6;">\n'
                '              <div style="font-size: 15px; line-height: 22px; '
                'font-weight: 600; color: #09090B; margin-bottom: 6px; '
                f'word-break: break-word;">{esc_name}</div>\n'
                '              <div style="font-size: 13px; line-height: 20px; '
                'color: #52525B; margin-bottom: 10px;">\n'
                f'                <span style="color: #71717A;">{esc_domain}</span>\n'
                "                &nbsp;&middot;&nbsp;\n"
                '                Now: <strong style="color: #09090B; font-weight: 600;">'
                f"{html.escape(now_price)}</strong>\n"
                "                &nbsp;&middot;&nbsp;\n"
                '                Target: <strong style="color: #09090B; font-weight: 600;">'
                f"{html.escape(target_price)}</strong>\n"
                "                &nbsp;&middot;&nbsp;\n"
                f'                <strong style="color: #2563EB;">{drop_label}</strong>\n'
                "              </div>\n"
                '              <div style="font-size: 13px; line-height: 22px;">\n'
                f'                <a href="{esc_url}" target="_blank" rel="noopener" '
                f'style="{_LINK_STYLE}">View on {esc_domain} &rarr;</a>\n'
                "              </div>\n"
                "            </td>\n"
                "          </tr>\n"
            )

        html_body = _render_email_shell(
            title=subject,
            preheader=preheader,
            heading=heading,
            subtitle=subtitle,
            rows_html="".join(row_chunks),
            footer_html="Sent automatically by PricePulse when a tracked item hits your target.",
        )
        self._send_email(recipient, subject, "\n".join(plain_lines), html_body)
        return True

    def send_captcha_report(
        self,
        recipient: str,
        blocked_items: list[tuple[TrackedItem, str]],
        app_base_url: str,
    ) -> bool:
        """Send a clean daily manual-check report for store-protected items."""
        if not recipient.strip() or not blocked_items:
            return False

        base = app_base_url.rstrip("/")
        count = len(blocked_items)
        noun = "item needs" if count == 1 else "items need"
        store_noun = "store" if count == 1 else "stores"
        heading = f"{count} {noun} a quick price check"
        subtitle = (
            f"These {store_noun} asked for a quick human check today, "
            "so we couldn't read the price automatically."
        )
        subject = f"PricePulse: {heading}"
        preheader = (
            f"{count} {store_noun} asked for a quick human check today — "
            "open a link below to update prices."
        )

        plain_lines = [heading, "", subtitle, ""]
        row_chunks: list[str] = []

        for item, _reason in blocked_items:
            domain = _extract_domain(item.url)
            last_price = _format_price(item.currency, item.current_price)
            target_price = _format_price(item.currency, item.target_price)
            item_modal_url = f"{base}/items/{item.item_id}"

            plain_lines.extend(
                [
                    f"- {item.name} ({domain})",
                    f"  Last: {last_price} | Target: {target_price}",
                    f"  Check price on {domain}: {item.url}",
                    f"  Update in PricePulse: {item_modal_url}",
                    "",
                ]
            )

            esc_name = html.escape(item.name)
            esc_domain = html.escape(domain)
            esc_url = html.escape(item.url, quote=True)
            esc_modal_url = html.escape(item_modal_url, quote=True)
            row_chunks.append(
                "          <tr>\n"
                '            <td style="padding: 18px 24px; border-bottom: 1px solid #F3F4F6;">\n'
                '              <div style="font-size: 15px; line-height: 22px; '
                'font-weight: 600; color: #09090B; margin-bottom: 6px; '
                f'word-break: break-word;">{esc_name}</div>\n'
                '              <div style="font-size: 13px; line-height: 20px; '
                'color: #52525B; margin-bottom: 10px;">\n'
                f'                <span style="color: #71717A;">{esc_domain}</span>\n'
                "                &nbsp;&middot;&nbsp;\n"
                '                Last: <strong style="color: #09090B; font-weight: 600;">'
                f"{html.escape(last_price)}</strong>\n"
                "                &nbsp;&middot;&nbsp;\n"
                '                Target: <strong style="color: #09090B; font-weight: 600;">'
                f"{html.escape(target_price)}</strong>\n"
                "              </div>\n"
                '              <div style="font-size: 13px; line-height: 22px;">\n'
                f'                <a href="{esc_url}" target="_blank" rel="noopener" '
                f'style="{_LINK_STYLE}">Check price on {esc_domain} &rarr;</a>\n'
                '                <span style="color: #D4D4D8;">&nbsp;&nbsp;|&nbsp;&nbsp;</span>\n'
                f'                <a href="{esc_modal_url}" target="_blank" rel="noopener" '
                f'style="{_LINK_STYLE}">Update in PricePulse &rarr;</a>\n'
                "              </div>\n"
                "            </td>\n"
                "          </tr>\n"
            )

        esc_dash_url = html.escape(f"{base}/", quote=True)
        footer_html = (
            "Sent once per day by PricePulse &nbsp;&middot;&nbsp;\n"
            f'                <a href="{esc_dash_url}" target="_blank" rel="noopener" '
            'style="color: #2563EB; text-decoration: underline;">'
            "Open Dashboard &rarr;</a>"
        )
        html_body = _render_email_shell(
            title=subject,
            preheader=preheader,
            heading=heading,
            subtitle=subtitle,
            rows_html="".join(row_chunks),
            footer_html=footer_html,
        )
        self._send_email(recipient, subject, "\n".join(plain_lines), html_body)
        return True
