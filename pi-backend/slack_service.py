"""
Slack Service for Voigt-Garten Agent (@GartenBot).

Separate Slack App from InfiniLoop — uses GARTEN_BOT_TOKEN.
Phase 1: output-only (channel posts + direct messages).
"""

import os
import json
import hmac
import hashlib
import time
import requests

SLACK_API = "https://slack.com/api"
GARTEN_BOT_TOKEN = os.environ.get('GARTEN_BOT_TOKEN', '')
GARTEN_SLACK_CHANNEL_ID = os.environ.get('GARTEN_SLACK_CHANNEL_ID', 'C0AUAD6QY2U')
GARTEN_MORITZ_SLACK_USER_ID = os.environ.get('GARTEN_MORITZ_SLACK_USER_ID', 'U0ASYE5UPQR')
GARTEN_SLACK_SIGNING_SECRET = os.environ.get('GARTEN_SLACK_SIGNING_SECRET', '')


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


# ============ Signing Verification (shared mit F.3/F.4) ============

def verify_slack_signature(body: bytes, headers) -> bool:
    """
    Verify Slack request signature per HMAC-SHA256.
    Body = raw request body (bytes). Headers = Flask request.headers (dict-like).
    Rejects requests older than 5 minutes (replay protection).
    """
    if not GARTEN_SLACK_SIGNING_SECRET:
        print("[slack_service] GARTEN_SLACK_SIGNING_SECRET not set — rejecting")
        return False

    timestamp = headers.get('X-Slack-Request-Timestamp', '')
    signature = headers.get('X-Slack-Signature', '')
    if not timestamp or not signature:
        return False

    try:
        now = int(time.time())
        ts_int = int(timestamp)
        diff = now - ts_int
        if abs(diff) > 60 * 5:
            print(f"[slack_service] signature timestamp too old: ts={timestamp} now={now} diff={diff}s")
            return False
    except ValueError:
        print(f"[slack_service] signature timestamp not int: {timestamp!r}")
        return False

    if isinstance(body, str):
        body = body.encode('utf-8')
    basestring = f"v0:{timestamp}:".encode('utf-8') + body
    digest = hmac.new(
        GARTEN_SLACK_SIGNING_SECRET.encode('utf-8'),
        basestring,
        hashlib.sha256,
    ).hexdigest()
    expected = f"v0={digest}"
    return hmac.compare_digest(expected, signature)


# ============ Moderation-Karte (F.4) ============

def build_moderation_blocks(image_id: str, image_url: str | None, uploader: str,
                            title: str | None, category: str) -> list:
    """Block-Kit-Payload für Galerie-Moderations-Karte mit Approve/Reject-Buttons."""
    display_title = title or "Ohne Titel"
    fields = [
        {"type": "mrkdwn", "text": f"*Titel:*\n{display_title}"},
        {"type": "mrkdwn", "text": f"*Kategorie:*\n{category}"},
        {"type": "mrkdwn", "text": f"*Uploader:*\n{uploader or 'unbekannt'}"},
        {"type": "mrkdwn", "text": f"*Bild-ID:*\n{image_id}"},
    ]

    blocks: list = [
        {"type": "header",
         "text": {"type": "plain_text", "text": ":camera: Neuer Galerie-Upload", "emoji": True}},
        {"type": "section", "fields": fields},
    ]

    if image_url:
        blocks.append({
            "type": "image",
            "image_url": image_url,
            "alt_text": "Upload-Vorschau",
        })

    blocks.append({
        "type": "actions",
        "block_id": "gallery_moderation",
        "elements": [
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "Freigeben", "emoji": True},
                "style": "primary",
                "action_id": f"moderation_approve:{image_id}",
                "value": image_id,
            },
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "Ablehnen", "emoji": True},
                "style": "danger",
                "action_id": f"moderation_reject:{image_id}",
                "value": image_id,
            },
        ],
    })

    blocks.append({
        "type": "context",
        "elements": [{
            "type": "mrkdwn",
            "text": "Upload wartet auf Moderation · <https://garten.infinityspace42.de/admin#gallery|Im Dashboard öffnen>",
        }],
    })
    return blocks


def post_with_photo(text: str, image_url: str | None, blocks: list | None = None,
                    channel: str | None = None) -> dict:
    """
    Post-Wrapper für Moderations-Karten. `image_url` optional, primär für Fallback/Doku.
    Für Block-Kit wird das Bild bereits in `blocks` via build_moderation_blocks eingebettet.
    """
    return post_channel(text, blocks=blocks, channel=channel)


# ============ Thread / Channel Helpers (F.3 Chat-Layer) ============

def post_thread_reply(channel: str, thread_ts: str, text: str,
                      blocks: list | None = None) -> dict:
    """Reply in a Slack thread. thread_ts must be the parent message ts."""
    if not is_configured():
        return {"ok": False, "error": "GARTEN_BOT_TOKEN not configured"}
    payload: dict = {"channel": channel, "text": text, "thread_ts": thread_ts}
    if blocks:
        payload["blocks"] = blocks
    try:
        resp = requests.post(f"{SLACK_API}/chat.postMessage", headers=_headers(),
                             data=json.dumps(payload), timeout=10)
        data = resp.json()
        if not data.get("ok"):
            print(f"[slack_service] post_thread_reply error: {data.get('error')}")
        return data
    except Exception as e:
        print(f"[slack_service] post_thread_reply exception: {e}")
        return {"ok": False, "error": str(e)}


def add_reaction(channel: str, timestamp: str, name: str) -> dict:
    """Add an emoji reaction. name without colons (e.g. 'eyes')."""
    if not is_configured():
        return {"ok": False}
    try:
        resp = requests.post(f"{SLACK_API}/reactions.add", headers=_headers(),
                             data=json.dumps({"channel": channel, "timestamp": timestamp,
                                              "name": name}),
                             timeout=10)
        return resp.json()
    except Exception as e:
        print(f"[slack_service] add_reaction exception: {e}")
        return {"ok": False, "error": str(e)}


def fetch_thread(channel: str, thread_ts: str, limit: int = 50) -> list[dict]:
    """conversations.replies — returns list of Slack messages (oldest first)."""
    if not is_configured():
        return []
    try:
        resp = requests.get(f"{SLACK_API}/conversations.replies",
                            headers={"Authorization": f"Bearer {GARTEN_BOT_TOKEN}"},
                            params={"channel": channel, "ts": thread_ts,
                                    "limit": min(int(limit), 200)},
                            timeout=10)
        data = resp.json()
        if not data.get("ok"):
            print(f"[slack_service] fetch_thread error: {data.get('error')}")
            return []
        return data.get("messages", []) or []
    except Exception as e:
        print(f"[slack_service] fetch_thread exception: {e}")
        return []


def fetch_channel_history(channel: str, limit: int = 10) -> list[dict]:
    """conversations.history — returns recent channel messages, reordered oldest first."""
    if not is_configured():
        return []
    try:
        resp = requests.get(f"{SLACK_API}/conversations.history",
                            headers={"Authorization": f"Bearer {GARTEN_BOT_TOKEN}"},
                            params={"channel": channel, "limit": min(int(limit), 100)},
                            timeout=10)
        data = resp.json()
        if not data.get("ok"):
            print(f"[slack_service] fetch_channel_history error: {data.get('error')}")
            return []
        msgs = data.get("messages", []) or []
        msgs = [m for m in msgs if not m.get("subtype")]
        return list(reversed(msgs))
    except Exception as e:
        print(f"[slack_service] fetch_channel_history exception: {e}")
        return []


# ============ Approval-Card (F.3 Tool-Calls) ============

def build_approval_card(pending_id: int, tool_name: str, summary: str,
                        params: dict) -> list:
    """Block-Kit-Karte für Approval-Gate. Buttons posten action_id mit pending_id."""
    fields = [
        {"type": "mrkdwn", "text": f"*Tool:*\n`{tool_name}`"},
        {"type": "mrkdwn", "text": f"*Approval-ID:*\n#{pending_id}"},
    ]

    pretty_lines = []
    for k, v in (params or {}).items():
        val = json.dumps(v, ensure_ascii=False)
        if len(val) > 120:
            val = val[:117] + "..."
        pretty_lines.append(f"• *{k}:* `{val}`")
    pretty = "\n".join(pretty_lines) or "_(keine Parameter)_"

    blocks: list = [
        {"type": "header",
         "text": {"type": "plain_text", "text": ":robot_face: Aktions-Vorschlag",
                  "emoji": True}},
        {"type": "section", "fields": fields},
        {"type": "section",
         "text": {"type": "mrkdwn", "text": f"*Zusammenfassung:*\n{summary or '_(keine)_'}"}},
        {"type": "section",
         "text": {"type": "mrkdwn", "text": f"*Parameter:*\n{pretty}"}},
        {"type": "actions",
         "block_id": "agent_approval",
         "elements": [
            {"type": "button",
             "text": {"type": "plain_text", "text": ":white_check_mark: Ausführen",
                      "emoji": True},
             "style": "primary",
             "action_id": f"agent_action_approve:{pending_id}",
             "value": str(pending_id)},
            {"type": "button",
             "text": {"type": "plain_text", "text": ":no_entry_sign: Verwerfen",
                      "emoji": True},
             "style": "danger",
             "action_id": f"agent_action_reject:{pending_id}",
             "value": str(pending_id)},
         ]},
        {"type": "context",
         "elements": [{"type": "mrkdwn",
                       "text": f"GartenBot Approval-Gate · ID #{pending_id}"}]},
    ]
    return blocks
