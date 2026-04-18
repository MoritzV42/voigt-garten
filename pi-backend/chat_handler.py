"""
Slack-Event-Handler für den Garten-Agent Chat-Layer (F.3).

Endpoint: POST /api/garten/agent/slack-events  (registered in agent_routes.py)

- Verifiziert Slack-Signing-Secret (5 Min Replay-Schutz).
- Antwortet auf url_verification-Challenge (text/plain).
- Dedupe via In-Memory-OrderedDict (event_id, TTL 10 min) — verhindert Slack-Retry-Doppelantworten.
- ACKt sofort 200 + dispatcht in Daemon-Thread (Claude-CLI braucht 5–30 s).
- Whitelist auf GARTEN_MORITZ_SLACK_USER_ID (Phase 3a/3b: nur Moritz).
- Rate-Limit: max GARTEN_CHAT_RATE_LIMIT_PER_HOUR pro User.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from collections import OrderedDict, defaultdict, deque

import chat_approval
import chat_context
import claude_cli_backend
import chat_tools
import slack_service

DATA_DIR = os.environ.get('DATA_DIR', '/app/data')
DB_PATH = os.path.join(DATA_DIR, 'garten.db')

CHAT_ENABLED = os.environ.get('GARTEN_CHAT_ENABLED', 'true').lower() not in ('0', 'false', 'no')
BOT_USER_ID = os.environ.get('GARTEN_SLACK_BOT_USER_ID', 'U0AUJTS5F5W')
MORITZ_USER_ID = os.environ.get('GARTEN_MORITZ_SLACK_USER_ID', 'U0ASYE5UPQR')
RATE_LIMIT_PER_HOUR = int(os.environ.get('GARTEN_CHAT_RATE_LIMIT_PER_HOUR', '30'))
GARTEN_CHANNEL_ID = os.environ.get('GARTEN_SLACK_CHANNEL_ID', 'C0AUAD6QY2U')

WHITELIST_MODE = os.environ.get('GARTEN_CHAT_WHITELIST', 'moritz_only').lower()


_DEDUP_TTL = 600
_seen_events: "OrderedDict[str, float]" = OrderedDict()
_dedup_lock = threading.Lock()

_rate_lock = threading.Lock()
_rate_calls: "dict[str, deque]" = defaultdict(deque)


def _is_duplicate(event_id: str) -> bool:
    if not event_id:
        return False
    with _dedup_lock:
        now = time.time()
        while _seen_events:
            oldest_key = next(iter(_seen_events))
            if _seen_events[oldest_key] < now - _DEDUP_TTL:
                _seen_events.popitem(last=False)
            else:
                break
        if event_id in _seen_events:
            return True
        _seen_events[event_id] = now
        if len(_seen_events) > 1000:
            _seen_events.popitem(last=False)
    return False


def _rate_limit_ok(user_id: str) -> tuple[bool, int]:
    """Returns (ok, retry_after_minutes_estimate)."""
    if not user_id:
        return True, 0
    now = time.time()
    cutoff = now - 3600
    with _rate_lock:
        dq = _rate_calls[user_id]
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= RATE_LIMIT_PER_HOUR:
            wait_secs = max(1, int(3600 - (now - dq[0])))
            return False, max(1, wait_secs // 60)
        dq.append(now)
    return True, 0


def _user_allowed(user_id: str) -> bool:
    if WHITELIST_MODE == 'open':
        return True
    return user_id == MORITZ_USER_ID


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def _log_chat_action(action_type: str, description: str, details: dict,
                     success: bool = True) -> None:
    try:
        conn = _db()
        conn.execute(
            "INSERT INTO agent_actions_log (action_type, source, description, details, success, created_at) "
            "VALUES (?, 'garten_agent', ?, ?, ?, datetime('now', 'localtime'))",
            (action_type, description, json.dumps(details, ensure_ascii=False), 1 if success else 0),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[chat_handler] log failed: {e}")


def _reply(channel: str, thread_ts: str | None, text: str,
           blocks: list | None = None) -> None:
    if thread_ts:
        slack_service.post_thread_reply(channel, thread_ts, text, blocks=blocks)
    else:
        slack_service.post_channel(text, blocks=blocks, channel=channel)


def _handle_text_response(channel: str, thread_ts: str | None, text: str) -> None:
    final = text.strip() or "_(leere Antwort)_"
    if len(final) > 3500:
        final = final[:3500] + "\n\n_(Antwort gekürzt)_"
    _reply(channel, thread_ts, final)


def _handle_tool_calls(parsed: dict, user_id: str, channel: str,
                       thread_ts: str | None) -> dict:
    """Dispatch read-tools direkt, write-tools via Approval-Card. Returns counts."""
    counts = {"read_executed": 0, "approval_requested": 0, "errors": 0}
    conn = _db()
    try:
        for call in parsed.get("calls", []):
            tool = call.get("tool")
            params = call.get("params") or {}
            summary = call.get("summary") or ""
            if not chat_tools.is_known_tool(tool):
                counts["errors"] += 1
                continue

            if chat_tools.is_write_tool(tool):
                req = chat_approval.request_approval(
                    tool, params, summary, user_id, channel, thread_ts)
                if req.get("ok"):
                    counts["approval_requested"] += 1
                else:
                    counts["errors"] += 1
                    _reply(channel, thread_ts,
                           f":warning: Approval-Card konnte nicht erstellt werden "
                           f"({req.get('error', '?')}).")
            else:
                result = chat_tools.execute_read_tool(conn, tool, params)
                counts["read_executed"] += 1
                pretty = json.dumps(result, ensure_ascii=False, indent=2)
                if len(pretty) > 1800:
                    pretty = pretty[:1800] + "\n…"
                _reply(channel, thread_ts,
                       f"*{tool}* result:\n```{pretty}```")
    finally:
        conn.close()

    if parsed.get("trailing_text"):
        _reply(channel, thread_ts, parsed["trailing_text"][:1500])

    return counts


def _process_mention(event: dict) -> None:
    """Daemon-thread worker. Anything inside here is async to the Slack ACK."""
    channel = event.get("channel", "")
    user_id = event.get("user", "")
    thread_ts = event.get("thread_ts") or None
    if thread_ts and thread_ts == event.get("ts"):
        thread_ts = thread_ts
    text = event.get("text", "") or ""

    if not _user_allowed(user_id):
        _reply(channel, thread_ts or event.get("ts"),
               f"Hi <@{user_id}> — der GartenBot-Chat ist aktuell nur für Moritz freigeschaltet.")
        _log_chat_action("chat_blocked", f"Non-whitelisted user {user_id}",
                         {"user_id": user_id, "channel": channel}, success=True)
        return

    ok, retry_min = _rate_limit_ok(user_id)
    if not ok:
        _reply(channel, thread_ts or event.get("ts"),
               f":hourglass_flowing_sand: Zu viele Anfragen — bitte in ~{retry_min} Min nochmal.")
        return

    bot_id = BOT_USER_ID or ""
    cleaned_text = text.replace(f"<@{bot_id}>", "").strip() if bot_id else text.strip()
    if not cleaned_text:
        _reply(channel, thread_ts or event.get("ts"),
               "Hi! Was kann ich für dich tun? Beispiele: «welche Tasks sind diese Woche fällig?», "
               "«verschieb Task #45 auf 2026-05-15», «liste Wasser-Dienstleister».")
        return

    try:
        slack_service.add_reaction(channel, event.get("ts", ""), "eyes")
    except Exception:
        pass

    # F.5: Mention im Email-Approval-Thread → refine_email statt normaler Chat
    if thread_ts:
        try:
            import web_help_service
            help_req = web_help_service.get_request_by_thread(channel, thread_ts)
        except Exception as e:
            print(f"[chat_handler] web_help lookup failed: {e}")
            help_req = None
        if help_req:
            result = web_help_service.refine_email(
                help_req["id"], cleaned_text, user_id)
            if result.get("ok"):
                _reply(channel, thread_ts,
                       f":pencil2: Entwurf ueberarbeitet — neue Karte folgt. "
                       f"(Subject: {result.get('subject', '?')})")
            else:
                _reply(channel, thread_ts,
                       f":warning: Refine fehlgeschlagen: `{result.get('error', '?')}`")
            _log_chat_action(
                "web_help_refine",
                f"Refine for help_request #{help_req['id']}",
                {"user_id": user_id, "request_id": help_req["id"],
                 "ok": result.get("ok"),
                 "error": result.get("error")},
                success=bool(result.get("ok")),
            )
            return

    scope_label, ctx_block = chat_context.fetch_context(channel, thread_ts, bot_id)

    conn = _db()
    try:
        parsed = claude_cli_backend.answer(
            conn, cleaned_text, scope_label, ctx_block,
            user_id=user_id, channel_label=channel,
        )
    finally:
        conn.close()

    diag = parsed.get("_diag", {})
    if parsed["type"] == "text":
        _handle_text_response(channel, thread_ts, parsed.get("text", ""))
        counts = {"text_response": 1}
    else:
        counts = _handle_tool_calls(parsed, user_id, channel, thread_ts)

    _log_chat_action(
        "chat_response",
        f"Mention from {user_id} in {channel}",
        {
            "user_id": user_id, "channel": channel,
            "thread_ts": thread_ts, "input_len": len(cleaned_text),
            "scope": scope_label,
            **counts, **diag,
        },
        success=bool(diag.get("cli_ok", True)),
    )


def handle_slack_event(payload: dict) -> tuple[str, int, dict]:
    """
    Returns (body, status, headers). Called by the Flask route.
    Body is JSON string for normal events, plain text for url_verification.
    """
    if not CHAT_ENABLED:
        return ("", 200, {})

    if payload.get("type") == "url_verification":
        return (payload.get("challenge", ""), 200, {"Content-Type": "text/plain"})

    if payload.get("type") != "event_callback":
        return ("", 200, {})

    event = payload.get("event") or {}
    event_type = event.get("type")

    is_mention = event_type == "app_mention"
    is_dm = (event_type == "message"
             and event.get("channel_type") == "im"
             and not event.get("subtype")
             and not event.get("bot_id")
             and not event.get("thread_ts"))
    if not (is_mention or is_dm):
        return ("", 200, {})

    if event.get("bot_id") or event.get("user") == BOT_USER_ID:
        return ("", 200, {})

    event_id = payload.get("event_id", "")
    if _is_duplicate(event_id):
        return ("", 200, {})

    threading.Thread(target=_process_mention, args=(event,),
                     name=f"garten-chat-{event_id}", daemon=True).start()

    return ("", 200, {})
