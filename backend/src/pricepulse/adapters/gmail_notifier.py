"""Gmail API consolidated digest notifier adapter (REQ-ALERT-01)."""

from __future__ import annotations

import base64
from email.message import EmailMessage
from typing import Any

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from pricepulse.domain.models import TrackedItem


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


class GmailDigestNotifier:
    """Dispatches consolidated target-price digest emails via Gmail API."""

    def __init__(self, service: Any, sender: str = "me") -> None:
        self._service = service
        self._sender = sender

    def send_discount_digest(
        self,
        recipient: str,
        discounted_items: list[TrackedItem],
    ) -> bool:
        """Send one consolidated digest email for all newly discounted items."""
        if not recipient.strip() or not discounted_items:
            return False

        lines = [
            "PricePulse Target Price Alert Digest",
            "",
            f"{len(discounted_items)} tracked item(s) reached your target price:",
            "",
        ]
        for item in discounted_items:
            lines.append(
                f"- {item.name}: {item.currency}{item.current_price:.2f} "
                f"(Target: {item.currency}{item.target_price:.2f}, "
                f"Drop: -{item.drop_pct:.1f}%) -> {item.url}"
            )

        msg = EmailMessage()
        msg["To"] = recipient.strip()
        msg["Subject"] = f"[PricePulse] {len(discounted_items)} Deal Alert(s) Triggered"
        msg.set_content("\n".join(lines))

        raw_bytes = base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")
        self._service.users().messages().send(
            userId=self._sender,
            body={"raw": raw_bytes},
        ).execute()
        return True
