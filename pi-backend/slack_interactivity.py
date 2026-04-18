"""
Slack-Interactivity-Endpoint für Voigt-Garten (F.4).

Handhabt Button-Clicks aus Block-Kit-Karten (z.B. Galerie-Moderation
Approve/Reject). Signing-Verify via shared `verify_slack_signature()` aus
slack_service.py. Muss binnen 3 s ACK'en — DB-Write ist schnell genug.

Slack-App-Config: Interactivity & Shortcuts → Request-URL
  https://garten.infinityspace42.de/api/garten/slack/interactivity
"""

import json
import os
import sqlite3

import requests
from flask import Blueprint, request

import slack_service

slack_interactivity_bp = Blueprint('slack_interactivity', __name__)

DATA_DIR = os.environ.get('DATA_DIR', '/app/data')
DB_PATH = os.path.join(DATA_DIR, 'garten.db')


def _get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _parse_action(action: dict) -> tuple[str, str]:
    """Return (verb, image_id). action_id format: 'moderation_approve:<id>'."""
    action_id = action.get('action_id', '')
    value = action.get('value', '')
    if ':' in action_id:
        verb, payload_id = action_id.split(':', 1)
        return verb, payload_id or value
    return action_id, value


def _update_card(response_url: str, text: str, original_blocks: list | None = None):
    """Ersetze die Moderations-Karte durch Bestätigungstext."""
    if not response_url:
        return
    body = {
        "replace_original": True,
        "text": text,
    }
    # Behalte Kontext-Blöcke (Bild, Felder) — entferne nur actions-Block
    if original_blocks:
        filtered = [b for b in original_blocks if b.get('type') != 'actions']
        filtered.append({
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": text}],
        })
        body["blocks"] = filtered
    try:
        requests.post(response_url, json=body, timeout=3)
    except Exception as e:
        print(f"[slack_interactivity] response_url update failed: {e}")


def _set_gallery_status(image_id: str, status: str) -> bool:
    """Setze gallery_images.status. Gleiche Logik wie in /api/telegram/webhook."""
    try:
        conn = _get_db()
        row = conn.execute('SELECT id FROM gallery_images WHERE id = ?',
                           (image_id,)).fetchone()
        if not row:
            conn.close()
            return False
        conn.execute('UPDATE gallery_images SET status = ? WHERE id = ?',
                     (status, image_id))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"[slack_interactivity] DB error: {e}")
        return False


@slack_interactivity_bp.route('/api/garten/slack/interactivity', methods=['POST'])
def slack_interactivity():
    raw_body = request.get_data()
    if not slack_service.verify_slack_signature(raw_body, request.headers):
        return ('', 401)

    payload_raw = request.form.get('payload')
    if not payload_raw:
        return ('', 200)

    try:
        payload = json.loads(payload_raw)
    except json.JSONDecodeError:
        return ('', 200)

    if payload.get('type') != 'block_actions':
        return ('', 200)

    actions = payload.get('actions') or []
    if not actions:
        return ('', 200)

    verb, image_id = _parse_action(actions[0])
    user_id = (payload.get('user') or {}).get('id', 'unknown')
    response_url = payload.get('response_url', '')
    original_blocks = (payload.get('message') or {}).get('blocks')

    if verb == 'moderation_approve':
        ok = _set_gallery_status(image_id, 'approved')
        text = (f":white_check_mark: Bild freigegeben von <@{user_id}> (ID `{image_id}`)"
                if ok else
                f":warning: Freigabe fehlgeschlagen — Bild `{image_id}` nicht gefunden")
        _update_card(response_url, text, original_blocks)
        return ('', 200)

    if verb == 'moderation_reject':
        ok = _set_gallery_status(image_id, 'rejected')
        text = (f":no_entry_sign: Bild abgelehnt von <@{user_id}> (ID `{image_id}`)"
                if ok else
                f":warning: Ablehnung fehlgeschlagen — Bild `{image_id}` nicht gefunden")
        _update_card(response_url, text, original_blocks)
        return ('', 200)

    # ============ F.3: Garten-Agent Approval-Gate ============
    if verb in ('agent_action_approve', 'agent_action_reject'):
        try:
            pending_id = int(image_id)
        except (TypeError, ValueError):
            _update_card(response_url, ":warning: Ungültige Approval-ID.", original_blocks)
            return ('', 200)

        import chat_approval

        if verb == 'agent_action_approve':
            result = chat_approval.execute_pending_action(pending_id, user_id)
            if not result.get("ok"):
                _update_card(
                    response_url,
                    f":warning: Ausführung fehlgeschlagen — "
                    f"`{result.get('error') or result.get('result', {}).get('error', '?')}`",
                    original_blocks,
                )
                return ('', 200)
            tool = result.get("tool", "?")
            tool_result = result.get("result", {})
            summary = ", ".join(f"{k}={json.dumps(v, ensure_ascii=False)[:60]}"
                                for k, v in tool_result.items() if k != "ok")
            _update_card(
                response_url,
                f":white_check_mark: `{tool}` ausgeführt von <@{user_id}> — {summary or 'OK'}",
                original_blocks,
            )
            return ('', 200)
        else:
            result = chat_approval.reject_pending_action(pending_id, user_id)
            if not result.get("ok"):
                _update_card(
                    response_url,
                    f":warning: Verwerfen fehlgeschlagen — `{result.get('error', '?')}`",
                    original_blocks,
                )
                return ('', 200)
            _update_card(
                response_url,
                f":no_entry_sign: `{result.get('tool', '?')}` verworfen von <@{user_id}>.",
                original_blocks,
            )
            return ('', 200)

    # Unbekannte Action — schweigend ACK'en
    return ('', 200)
