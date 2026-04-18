"""
Web-Chat Hilfe-Eskalation (F.5 Customer-Support-Flow).

Wenn ein eingeloggter Web-Nutzer im Chat-Widget über das Tool
`request_human_help` Hilfe anfordert, läuft folgender Flow:

1. INSERT in web_help_requests (Status pending) — synchron im Tool-Executor.
2. Slack-Notification an Moritz (kurze Vorab-Info) — synchron.
3. Background-Thread: Claude-CLI analysiert Chat-Verlauf, schreibt
   Email-Draft (subject + body), inserted in email_drafts, postet
   Slack-Approval-Card mit Buttons (Senden / Edit-Hinweis / Verwerfen).
4. Klick "Senden" → Resend-Versand → Card-Update.
5. Mention im Approval-Thread (`@GartenBot`) → refine_help_email() lässt
   Claude-CLI den Draft mit Moritz' Hinweisen überarbeiten.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
from datetime import datetime

import claude_cli_backend
import slack_service

DATA_DIR = os.environ.get('DATA_DIR', '/app/data')
DB_PATH = os.path.join(DATA_DIR, 'garten.db')
GARTEN_CHANNEL_ID = os.environ.get('GARTEN_SLACK_CHANNEL_ID', 'C0AUAD6QY2U')
MORITZ_USER_ID = os.environ.get('GARTEN_MORITZ_SLACK_USER_ID', 'U0ASYE5UPQR')

EMAIL_FROM_DEFAULT = os.environ.get('REFUGIUM_EMAIL_FROM',
                                    'noreply@refugium-heideland.de')


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


# ============ Phase 1: Hilfe-Anfrage erstellen ============

def create_help_request(user_email: str, user_name: str | None,
                        user_phone: str | None, topic: str, urgency: str,
                        chat_context: list[dict]) -> int:
    """Insert + Slack-Vorab-Note. Triggert Claude-CLI im Background."""
    conn = _db()
    try:
        cur = conn.execute(
            "INSERT INTO web_help_requests (user_email, user_name, user_phone, "
            "topic, urgency, chat_context_json, status) "
            "VALUES (?, ?, ?, ?, ?, ?, 'pending')",
            (user_email, user_name, user_phone, topic[:500],
             urgency, json.dumps(chat_context, ensure_ascii=False)),
        )
        request_id = int(cur.lastrowid)
        conn.commit()
    finally:
        conn.close()

    _post_initial_notification(request_id, user_email, user_name, user_phone,
                               topic, urgency)

    threading.Thread(target=_background_analyze, args=(request_id,),
                     name=f"web-help-analyze-{request_id}", daemon=True).start()

    return request_id


def _post_initial_notification(request_id: int, user_email: str,
                               user_name: str | None, user_phone: str | None,
                               topic: str, urgency: str) -> None:
    emoji = ":sos:" if urgency == "high" else ":question:"
    contact_lines = [f":bust_in_silhouette: {user_name or '—'} <{user_email}>"]
    if user_phone:
        contact_lines.append(f":telephone_receiver: {user_phone}")
    text = (f"{emoji} *Neue Hilfe-Anfrage #{request_id}* (Urgency: {urgency})\n\n"
            "\n".join(contact_lines) + "\n\n"
            f":speech_balloon: {topic[:300]}\n\n"
            "_Claude-CLI analysiert den Chat-Verlauf — Email-Entwurf folgt gleich._")
    slack_service.post_channel(text, channel=GARTEN_CHANNEL_ID)


# ============ Phase 2: Claude-CLI-Analyse ============

def _format_chat_for_prompt(chat_context: list[dict]) -> str:
    if not chat_context:
        return "(leer — Nutzer hat sofort Hilfe angefordert)"
    lines = []
    for msg in chat_context[-30:]:
        role = msg.get("role") or "?"
        content = (msg.get("content") or "").strip()
        if not content:
            continue
        if len(content) > 600:
            content = content[:600] + "..."
        lines.append(f"[{role}] {content}")
    return "\n".join(lines) or "(leer)"


def _build_email_prompt(req: dict, chat_context: list[dict]) -> str:
    chat_block = _format_chat_for_prompt(chat_context)
    name = req["user_name"] or "Gast"
    return f"""Du bist Moritz' persoenlicher Customer-Support-Assistent fuer das
Refugium Heideland. Du analysierst eine Hilfe-Anfrage aus dem Web-Chat-Widget
und schreibst einen freundlichen, deutschsprachigen Email-Entwurf an den Kunden.

REGELN:
- Antwort als Email-Entwurf, der Moritz nur noch absegnen muss.
- Sprache: Deutsch, echte Umlaute (ä/ö/ü/ß), per "Sie" anreden (ausser der
  Kunde duzt im Chat erkennbar).
- Stil: warm, kompetent, kurz. Keine Floskeln. Max 200 Woerter im Body.
- Wenn die Anfrage unklar bleibt, frage konkret nach.
- Wenn die Anfrage etwas Operatives ist (Buchung, Termin, Mangel), bestaetige
  Empfang, nenne den naechsten Schritt, setze Erwartung wann Moritz reagiert.
- Schliesse mit "Viele Gruesse,\\nMoritz Voigt\\nRefugium Heideland".

ANTWORT-FORMAT (JSON in einem ```json```-Codeblock):
```json
{{"subject": "...", "body": "...", "needs_followup": false, "internal_note": "kurzer Hinweis fuer Moritz, was er ggf. pruefen sollte"}}
```

## Kunden-Daten
- Name: {name}
- Email: {req['user_email']}
- Telefon: {req['user_phone'] or '—'}
- Urgency: {req['urgency']}
- Anfrage-ID: #{req['id']}

## Topic (vom Tool gesetzt)
{req['topic'] or '(kein Topic gesetzt)'}

## Chat-Verlauf
{chat_block}
"""


JSON_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)


def _parse_email_response(raw: str) -> dict | None:
    if not raw:
        return None
    matches = JSON_RE.findall(raw)
    for block in matches:
        try:
            data = json.loads(block)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict) and data.get("subject") and data.get("body"):
            return {
                "subject": str(data["subject"])[:300],
                "body": str(data["body"])[:8000],
                "needs_followup": bool(data.get("needs_followup", False)),
                "internal_note": str(data.get("internal_note", ""))[:500],
            }
    try:
        data = json.loads(raw.strip())
        if isinstance(data, dict) and data.get("subject") and data.get("body"):
            return {
                "subject": str(data["subject"])[:300],
                "body": str(data["body"])[:8000],
                "needs_followup": bool(data.get("needs_followup", False)),
                "internal_note": "",
            }
    except json.JSONDecodeError:
        pass
    return None


def _background_analyze(request_id: int) -> None:
    try:
        conn = _db()
        try:
            req = conn.execute(
                "SELECT * FROM web_help_requests WHERE id = ?", (request_id,)
            ).fetchone()
        finally:
            conn.close()
        if not req:
            return
        req = dict(req)
        try:
            chat_context = json.loads(req["chat_context_json"] or "[]")
        except json.JSONDecodeError:
            chat_context = []

        prompt = _build_email_prompt(req, chat_context)
        ok, raw, err = claude_cli_backend.call_cli(prompt)
        if not ok or not raw:
            _post_analysis_failure(request_id, err or "no output")
            return

        parsed = _parse_email_response(raw)
        if not parsed:
            _post_analysis_failure(request_id,
                                   f"konnte JSON nicht parsen — raw[:200]={raw[:200]}")
            return

        draft_id = _insert_email_draft(req, parsed)
        post_email_approval_card(request_id, draft_id, req, parsed)
    except Exception as e:
        print(f"[web_help_service] background_analyze failed: {e}")
        _post_analysis_failure(request_id, f"exception: {e}")


def _insert_email_draft(req: dict, parsed: dict) -> int:
    body_plain = parsed["body"]
    body_html = "<p>" + body_plain.replace("\n\n", "</p><p>").replace("\n", "<br>") + "</p>"
    notes = (f"web_help_request_id={req['id']} "
             f"internal_note={parsed.get('internal_note', '')}")
    conn = _db()
    try:
        cur = conn.execute(
            "INSERT INTO email_drafts (recipient_email, recipient_name, subject, "
            "body_html, body_plain, status, notes) "
            "VALUES (?, ?, ?, ?, ?, 'pending', ?)",
            (req["user_email"], req["user_name"], parsed["subject"],
             body_html, body_plain, notes),
        )
        draft_id = int(cur.lastrowid)
        conn.execute(
            "UPDATE web_help_requests SET status = 'analyzed', "
            "email_draft_id = ?, analyzed_at = datetime('now', 'localtime') "
            "WHERE id = ?", (draft_id, req["id"]),
        )
        conn.commit()
        return draft_id
    finally:
        conn.close()


# ============ Phase 3: Slack-Approval-Card ============

def _build_email_approval_blocks(request_id: int, draft_id: int, req: dict,
                                 parsed: dict) -> list:
    body_preview = parsed["body"][:1500]
    if len(parsed["body"]) > 1500:
        body_preview += "\n\n_(Body gekuerzt — voller Text in Approval-Action)_"
    note = parsed.get("internal_note") or "—"

    fields = [
        {"type": "mrkdwn", "text": f"*An:*\n{req['user_email']}"},
        {"type": "mrkdwn", "text": f"*Anfrage-ID:*\n#{request_id}"},
    ]
    if req["user_name"]:
        fields.append({"type": "mrkdwn", "text": f"*Name:*\n{req['user_name']}"})
    if req["user_phone"]:
        fields.append({"type": "mrkdwn", "text": f"*Telefon:*\n{req['user_phone']}"})

    return [
        {"type": "header",
         "text": {"type": "plain_text",
                  "text": ":envelope_with_arrow: Email-Entwurf bereit",
                  "emoji": True}},
        {"type": "section", "fields": fields},
        {"type": "section",
         "text": {"type": "mrkdwn", "text": f"*Subject:*\n{parsed['subject']}"}},
        {"type": "section",
         "text": {"type": "mrkdwn", "text": f"*Body:*\n```{body_preview}```"}},
        {"type": "section",
         "text": {"type": "mrkdwn", "text": f"*Interner Hinweis:*\n{note}"}},
        {"type": "actions",
         "block_id": "web_help_approval",
         "elements": [
            {"type": "button",
             "text": {"type": "plain_text",
                      "text": ":envelope: Senden", "emoji": True},
             "style": "primary",
             "action_id": f"web_help_send:{request_id}",
             "value": str(request_id)},
            {"type": "button",
             "text": {"type": "plain_text",
                      "text": ":pencil2: Im Thread bearbeiten", "emoji": True},
             "action_id": f"web_help_edit_hint:{request_id}",
             "value": str(request_id)},
            {"type": "button",
             "text": {"type": "plain_text",
                      "text": ":no_entry_sign: Verwerfen", "emoji": True},
             "style": "danger",
             "action_id": f"web_help_reject:{request_id}",
             "value": str(request_id)},
         ]},
        {"type": "context",
         "elements": [{"type": "mrkdwn",
                       "text": f"GartenBot Customer-Support · Email-Draft #{draft_id}"
                               " · `@GartenBot` im Thread fuer Aenderungen"}]},
    ]


def post_email_approval_card(request_id: int, draft_id: int, req: dict,
                             parsed: dict) -> None:
    blocks = _build_email_approval_blocks(request_id, draft_id, req, parsed)
    fallback = (f":envelope_with_arrow: Email-Entwurf #{draft_id} an "
                f"{req['user_email']} bereit")
    resp = slack_service.post_channel(fallback, blocks=blocks,
                                      channel=GARTEN_CHANNEL_ID)
    if not resp.get("ok"):
        print(f"[web_help_service] approval card failed: {resp.get('error')}")
        return
    ts = resp.get("ts")
    if ts:
        conn = _db()
        try:
            conn.execute(
                "UPDATE web_help_requests SET slack_card_channel = ?, "
                "slack_card_ts = ? WHERE id = ?",
                (GARTEN_CHANNEL_ID, ts, request_id),
            )
            conn.commit()
        finally:
            conn.close()


def _post_analysis_failure(request_id: int, reason: str) -> None:
    text = (f":warning: *Analyse fehlgeschlagen* fuer Hilfe-Anfrage #{request_id} — "
            f"`{reason[:200]}`. Bitte manuell pruefen.")
    slack_service.post_channel(text, channel=GARTEN_CHANNEL_ID)


# ============ Phase 4: Send / Reject / Edit ============

def get_request(request_id: int) -> dict | None:
    conn = _db()
    try:
        row = conn.execute(
            "SELECT * FROM web_help_requests WHERE id = ?", (request_id,),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_request_by_thread(channel_id: str, thread_ts: str) -> dict | None:
    """Lookup für chat_handler — ist diese Mention im Approval-Thread?"""
    conn = _db()
    try:
        row = conn.execute(
            "SELECT * FROM web_help_requests "
            "WHERE slack_card_channel = ? AND slack_card_ts = ? "
            "AND status IN ('analyzed', 'pending') "
            "ORDER BY id DESC LIMIT 1",
            (channel_id, thread_ts),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def send_email(request_id: int, by_slack_user: str) -> dict:
    """Genehmigt + sendet via Resend."""
    req = get_request(request_id)
    if not req:
        return {"ok": False, "error": f"request #{request_id} nicht gefunden"}
    if req["status"] in ("sent", "rejected"):
        return {"ok": False, "error": f"already {req['status']}"}
    draft_id = req["email_draft_id"]
    if not draft_id:
        return {"ok": False, "error": "kein email_draft verknuepft"}

    conn = _db()
    try:
        draft = conn.execute(
            "SELECT * FROM email_drafts WHERE id = ?", (draft_id,)
        ).fetchone()
    finally:
        conn.close()
    if not draft:
        return {"ok": False, "error": f"email_draft #{draft_id} nicht gefunden"}

    try:
        from email_service import send_email_via_resend
    except ImportError:
        send_email_via_resend = None

    sent_ok = False
    send_error = None
    if send_email_via_resend:
        try:
            sent_ok = bool(send_email_via_resend(
                to=draft["recipient_email"],
                subject=draft["subject"],
                html=draft["body_html"],
                text=draft["body_plain"],
            ))
        except Exception as e:
            send_error = str(e)
    else:
        send_error = "send_email_via_resend nicht verfuegbar"

    conn = _db()
    try:
        if sent_ok:
            conn.execute(
                "UPDATE email_drafts SET status = 'sent', "
                "approved_by = ?, approved_at = datetime('now', 'localtime'), "
                "sent_at = datetime('now', 'localtime') WHERE id = ?",
                (by_slack_user, draft_id),
            )
            conn.execute(
                "UPDATE web_help_requests SET status = 'sent', "
                "decided_by = ?, decided_at = datetime('now', 'localtime') WHERE id = ?",
                (by_slack_user, request_id),
            )
        conn.execute(
            "INSERT INTO agent_actions_log (action_type, source, description, details, success, created_at) "
            "VALUES ('web_help_email_sent', 'garten_agent', ?, ?, ?, datetime('now', 'localtime'))",
            (f"Email zu Hilfe-Anfrage #{request_id} an {draft['recipient_email']}",
             json.dumps({"request_id": request_id, "draft_id": draft_id,
                         "by_slack_user": by_slack_user,
                         "send_error": send_error},
                        ensure_ascii=False),
             1 if sent_ok else 0),
        )
        conn.commit()
    finally:
        conn.close()

    return {"ok": sent_ok, "error": send_error,
            "recipient": draft["recipient_email"],
            "subject": draft["subject"],
            "card_channel": req["slack_card_channel"],
            "card_ts": req["slack_card_ts"]}


def reject_request(request_id: int, by_slack_user: str) -> dict:
    req = get_request(request_id)
    if not req:
        return {"ok": False, "error": f"request #{request_id} nicht gefunden"}
    if req["status"] in ("sent", "rejected"):
        return {"ok": False, "error": f"already {req['status']}"}
    conn = _db()
    try:
        conn.execute(
            "UPDATE web_help_requests SET status = 'rejected', "
            "decided_by = ?, decided_at = datetime('now', 'localtime') WHERE id = ?",
            (by_slack_user, request_id),
        )
        if req["email_draft_id"]:
            conn.execute(
                "UPDATE email_drafts SET status = 'rejected' WHERE id = ?",
                (req["email_draft_id"],),
            )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True, "card_channel": req["slack_card_channel"],
            "card_ts": req["slack_card_ts"]}


# ============ Phase 5: Refine via @GartenBot Mention im Thread ============

def refine_email(request_id: int, moritz_hint: str, by_slack_user: str) -> dict:
    """Mention im Approval-Thread → Claude-CLI ueberarbeitet den Draft."""
    req = get_request(request_id)
    if not req:
        return {"ok": False, "error": f"request #{request_id} nicht gefunden"}
    if req["status"] not in ("analyzed", "pending"):
        return {"ok": False, "error": f"status {req['status']} — refine nicht moeglich"}
    draft_id = req["email_draft_id"]

    conn = _db()
    try:
        draft = conn.execute(
            "SELECT * FROM email_drafts WHERE id = ?", (draft_id,)
        ).fetchone()
    finally:
        conn.close()
    if not draft:
        return {"ok": False, "error": f"email_draft #{draft_id} nicht gefunden"}

    try:
        chat_context = json.loads(req["chat_context_json"] or "[]")
    except json.JSONDecodeError:
        chat_context = []

    prompt = f"""Du ueberarbeitest einen Email-Entwurf auf Moritz' Hinweis.

REGELN:
- Antwort wieder als JSON ```json {{"subject":..., "body":..., "internal_note":...}}```
- Behalte den Stil bei (Deutsch, "Sie", warm-kompetent, max 200 Woerter Body).
- Aenderungen vornehmen, aber nichts erfinden was nicht aus Chat oder Hinweis kommt.

## Aktueller Entwurf
Subject: {draft['subject']}
Body:
{draft['body_plain']}

## Moritz' Hinweis
{moritz_hint}

## Original-Chat-Verlauf
{_format_chat_for_prompt(chat_context)}
"""

    ok, raw, err = claude_cli_backend.call_cli(prompt)
    if not ok or not raw:
        return {"ok": False, "error": f"CLI failed: {err}"}
    parsed = _parse_email_response(raw)
    if not parsed:
        return {"ok": False, "error": "konnte refined JSON nicht parsen"}

    body_html = ("<p>" + parsed["body"].replace("\n\n", "</p><p>")
                 .replace("\n", "<br>") + "</p>")
    conn = _db()
    try:
        conn.execute(
            "UPDATE email_drafts SET subject = ?, body_html = ?, body_plain = ?, "
            "notes = COALESCE(notes, '') || ' | refined: ' || ? "
            "WHERE id = ?",
            (parsed["subject"], body_html, parsed["body"],
             moritz_hint[:200], draft_id),
        )
        conn.commit()
    finally:
        conn.close()

    fresh_req = get_request(request_id)
    post_email_approval_card(request_id, draft_id, fresh_req, parsed)

    return {"ok": True, "subject": parsed["subject"]}
