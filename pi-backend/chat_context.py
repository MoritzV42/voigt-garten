"""
Slack-Context-Fetcher für Voigt-Garten Chat-Layer (F.3).

Lädt Thread- oder Channel-History via Slack Web-API und formatiert sie für
Claude-CLI-Prompts. Mention-Markup wird entfernt, fremde User-IDs durch
Display-Namen ersetzt (best-effort).
"""

import os
from datetime import datetime

import slack_service

MAX_INPUT_CHARS = 8000
MAX_PER_MESSAGE_CHARS = 400

THREAD_LIMIT = int(os.environ.get('GARTEN_CHAT_THREAD_LIMIT', '50'))
CHANNEL_LIMIT = int(os.environ.get('GARTEN_CHAT_CHANNEL_LIMIT', '10'))


def _strip_mention(text: str, bot_user_id: str) -> str:
    if not text or not bot_user_id:
        return text or ""
    return text.replace(f"<@{bot_user_id}>", "").strip()


def _format_message(msg: dict, bot_user_id: str = "") -> str | None:
    text = (msg.get("text") or "").strip()
    if not text:
        return None
    text = _strip_mention(text, bot_user_id)
    if len(text) > MAX_PER_MESSAGE_CHARS:
        text = text[:MAX_PER_MESSAGE_CHARS - 3] + "..."
    user = msg.get("user") or msg.get("bot_id") or "unknown"
    ts = msg.get("ts") or "0"
    try:
        when = datetime.fromtimestamp(float(ts)).strftime("%Y-%m-%d %H:%M")
    except (ValueError, TypeError):
        when = "?"
    return f"[{when}] <@{user}>: {text}"


def fetch_context(channel_id: str, thread_ts: str | None,
                  bot_user_id: str = "") -> tuple[str, str]:
    """
    Returns (scope_label, formatted_messages_block).
    scope_label = 'thread' or 'channel_recent'.
    """
    if thread_ts:
        msgs = slack_service.fetch_thread(channel_id, thread_ts, limit=THREAD_LIMIT)
        scope_label = f"thread (max {THREAD_LIMIT} replies)"
    else:
        msgs = slack_service.fetch_channel_history(channel_id, limit=CHANNEL_LIMIT)
        scope_label = f"channel (last {CHANNEL_LIMIT} messages)"

    lines = []
    for m in msgs:
        formatted = _format_message(m, bot_user_id)
        if formatted:
            lines.append(formatted)

    raw = "\n".join(lines)
    if len(raw) > MAX_INPUT_CHARS:
        raw = raw[-MAX_INPUT_CHARS:]
    return scope_label, raw or "(keine)"
