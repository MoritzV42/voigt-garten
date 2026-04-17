"""
Slack Service for Voigt-Garten Agent (@GartenBot).

Separate Slack App from InfiniLoop — uses GARTEN_BOT_TOKEN.
Phase 1: output-only (channel posts + direct messages).
"""

import os
import json
import requests

SLACK_API = "https://slack.com/api"
GARTEN_BOT_TOKEN = os.environ.get('GARTEN_BOT_TOKEN', '')
GARTEN_SLACK_CHANNEL_ID = os.environ.get('GARTEN_SLACK_CHANNEL_ID', 'C0AUAD6QY2U')
GARTEN_MORITZ_SLACK_USER_ID = os.environ.get('GARTEN_MORITZ_SLACK_USER_ID', 'U0ASYE5UPQR')


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {GARTEN_BOT_TOKEN}",
        "Content-Type": "application/json; charset=utf-8",
    }


def is_configured() -> bool:
    return bool(GARTEN_BOT_TOKEN)


def post_channel(text: str, blocks: list | None = None, channel: str | None = None) -> dict:
    """Post message to Garten-Channel. Returns {ok, ts, error}."""
    if not is_configured():
        return {"ok": False, "error": "GARTEN_BOT_TOKEN not configured"}
    payload: dict = {
        "channel": channel or GARTEN_SLACK_CHANNEL_ID,
        "text": text,
    }
    if blocks:
        payload["blocks"] = blocks
    try:
        resp = requests.post(f"{SLACK_API}/chat.postMessage", headers=_headers(),
                             data=json.dumps(payload), timeout=10)
        data = resp.json()
        if not data.get("ok"):
            print(f"[slack_service] post_channel error: {data.get('error')}")
        return data
    except Exception as e:
        print(f"[slack_service] post_channel exception: {e}")
        return {"ok": False, "error": str(e)}


def send_dm(user_id: str, text: str, blocks: list | None = None) -> dict:
    """Send direct message to a Slack user. Opens conversation first."""
    if not is_configured():
        return {"ok": False, "error": "GARTEN_BOT_TOKEN not configured"}
    try:
        open_resp = requests.post(f"{SLACK_API}/conversations.open", headers=_headers(),
                                  data=json.dumps({"users": user_id}), timeout=10)
        open_data = open_resp.json()
        if not open_data.get("ok"):
            print(f"[slack_service] conversations.open error: {open_data.get('error')}")
            return open_data
        channel = open_data["channel"]["id"]
        payload: dict = {"channel": channel, "text": text}
        if blocks:
            payload["blocks"] = blocks
        resp = requests.post(f"{SLACK_API}/chat.postMessage", headers=_headers(),
                             data=json.dumps(payload), timeout=10)
        data = resp.json()
        if not data.get("ok"):
            print(f"[slack_service] send_dm post error: {data.get('error')}")
        return data
    except Exception as e:
        print(f"[slack_service] send_dm exception: {e}")
        return {"ok": False, "error": str(e)}


def build_escalation_blocks(task: dict, stage: int, days_overdue: int,
                            provider: dict | None = None) -> list:
    """Block-Kit payload for escalation posts/DMs."""
    emoji = {1: ":bell:", 2: ":envelope:", 3: ":rotating_light:"}.get(stage, ":warning:")
    category = task.get('category', 'sonstiges')
    title = task.get('title') or f"Task #{task['id']}"
    header_text = f"{emoji} Stufe {stage} — Task #{task['id']}: {title}"

    fields = [
        {"type": "mrkdwn", "text": f"*Kategorie:*\n{category}"},
        {"type": "mrkdwn", "text": f"*Tage überfällig:*\n{days_overdue}"},
    ]
    if task.get('due_date'):
        fields.append({"type": "mrkdwn", "text": f"*Fällig war:*\n{task['due_date']}"})
    if task.get('assigned_to'):
        fields.append({"type": "mrkdwn", "text": f"*Zuständig:*\n{task['assigned_to']}"})

    blocks: list = [
        {"type": "header", "text": {"type": "plain_text", "text": header_text, "emoji": True}},
        {"type": "section", "fields": fields},
    ]
    if task.get('description'):
        desc = task['description']
        if len(desc) > 500:
            desc = desc[:500] + "…"
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": f"*Beschreibung:*\n{desc}"}})

    if provider:
        provider_lines = [f"*Vorgeschlagener Dienstleister:* {provider['name']}"]
        if provider.get('phone'):
            provider_lines.append(f"📞 {provider['phone']}")
        if provider.get('email'):
            provider_lines.append(f"✉️ {provider['email']}")
        blocks.append({"type": "section",
                       "text": {"type": "mrkdwn", "text": "\n".join(provider_lines)}})

    if stage >= 3:
        blocks.append({"type": "section",
                       "text": {"type": "mrkdwn",
                                "text": "*Bitte selbst anrufen — Agent übergibt an dich.*"}})

    blocks.append({"type": "context",
                   "elements": [{"type": "mrkdwn",
                                 "text": f"Voigt-Garten Eskalations-Agent · Task-ID #{task['id']}"}]})
    return blocks
