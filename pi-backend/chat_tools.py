"""
Tool-Registry für den Garten-Agent Chat-Layer (F.3 Phase 3b).

Read-Tools werden direkt ausgeführt; Write-Tools landen via chat_approval.py
in der `agent_pending_actions`-Tabelle und brauchen einen Slack-Button-Klick.

Das LLM (Claude-CLI) erhält die hier definierten Schemata als Teil des
System-Prompts und muss bei einem Tool-Wunsch JSON ausgeben:

    {"tool": "<name>", "params": {...}, "summary": "Kurztext für Approval-Card"}
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from typing import Any


# ============ Tool-Schemata (für System-Prompt) ============

READ_TOOLS = ["get_overdue_tasks", "get_task_details", "search_providers"]
WRITE_TOOLS = ["update_task_due_date", "cancel_escalation", "create_email_draft"]


def tool_catalogue_for_prompt() -> str:
    return """### Verfügbare Tools

READ-Tools (direkte Ausführung, keine Freigabe nötig):

1. `get_overdue_tasks(category?: str)` — Liste überfälliger Tasks (max 20).
   Optional Filter nach Kategorie ('wasser', 'elektrik', 'rasen', ...).

2. `get_task_details(task_id: int)` — Volle Task-Details inkl. aktiver Eskalation.

3. `search_providers(category?: str, query?: str)` — Dienstleister suchen.

WRITE-Tools (brauchen Slack-Button-Approval von Moritz):

4. `update_task_due_date(task_id: int, new_due_date: str (YYYY-MM-DD), reason: str)`
   — Verschiebt Fälligkeitsdatum. Pro Vorschlag NUR ein Task. Bei mehreren Tasks
   pro Vorschlag mehrere Tool-Calls hintereinander vorschlagen.

5. `cancel_escalation(escalation_id: int, reason: str)` — Stoppt aktive Eskalation
   (z.B. weil Task bereits offline erledigt wurde).

6. `create_email_draft(to: str, subject: str, body_plain: str, related_task_id?: int)`
   — Erstellt Email-Entwurf im Admin-Dashboard. Kein direkter Versand.

### Tool-Aufruf-Format

Wenn du ein Tool nutzen willst, antworte AUSSCHLIESSLICH mit JSON in einem
Code-Block (keine zusätzliche Text-Antwort drumherum):

```json
{"tool": "<name>", "params": {...}, "summary": "Was passiert wenn approved"}
```

Wenn du nur Text-Antwort gibst (kein Tool nutzt), antworte normal in Markdown.
Wenn der Nutzer mehrere Aktionen will, gib MEHRERE separate ```json```-Blöcke
hintereinander aus — pro Block ein Tool-Call.
"""


# ============ Read-Tool-Implementierungen ============

def _row_to_dict(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row else None


def get_overdue_tasks(conn: sqlite3.Connection, category: str | None = None) -> dict:
    sql = ("SELECT id, title, category, due_date, status, priority, assigned_to "
           "FROM projects "
           "WHERE COALESCE(status, 'offen') IN ('offen', 'in_arbeit', 'in_progress', 'next') "
           "AND due_date IS NOT NULL AND due_date < date('now') "
           "AND COALESCE(category, '') != 'it' ")
    params: list[Any] = []
    if category:
        sql += "AND category = ? "
        params.append(category)
    sql += "ORDER BY due_date ASC LIMIT 20"
    rows = conn.execute(sql, params).fetchall()
    return {"tasks": [dict(r) for r in rows], "count": len(rows)}


def get_task_details(conn: sqlite3.Connection, task_id: int) -> dict:
    task = conn.execute(
        "SELECT * FROM projects WHERE id = ?", (task_id,)
    ).fetchone()
    if not task:
        return {"error": f"Task #{task_id} nicht gefunden"}

    esc = conn.execute(
        "SELECT id, current_stage, last_action_at, next_action_at, cancelled "
        "FROM agent_escalation_state WHERE task_id = ? ORDER BY id DESC LIMIT 1",
        (task_id,),
    ).fetchone()

    recent_actions = conn.execute(
        "SELECT action_type, description, created_at, success "
        "FROM agent_actions_log WHERE description LIKE ? "
        "ORDER BY created_at DESC LIMIT 5",
        (f"%task #{task_id}%",),
    ).fetchall()

    return {
        "task": dict(task),
        "active_escalation": dict(esc) if esc else None,
        "recent_actions": [dict(r) for r in recent_actions],
    }


def search_providers(conn: sqlite3.Connection, category: str | None = None,
                     query: str | None = None) -> dict:
    sql = "SELECT id, category, name, email, phone, rating, notes FROM service_providers WHERE 1=1 "
    params: list[Any] = []
    if category:
        sql += "AND category = ? "
        params.append(category)
    if query:
        sql += "AND (name LIKE ? OR notes LIKE ?) "
        like = f"%{query}%"
        params += [like, like]
    sql += "ORDER BY COALESCE(rating, 0) DESC, name LIMIT 20"
    rows = conn.execute(sql, params).fetchall()
    return {"providers": [dict(r) for r in rows], "count": len(rows)}


READ_TOOL_FNS = {
    "get_overdue_tasks": get_overdue_tasks,
    "get_task_details": get_task_details,
    "search_providers": search_providers,
}


# ============ Write-Tool-Executoren (nach Approval) ============

def _log_tool_action(conn: sqlite3.Connection, tool_name: str, params: dict,
                     description: str, success: bool, by_slack_user: str = "",
                     extra: dict | None = None) -> None:
    details = {"tool": tool_name, "params": params, "by_slack_user": by_slack_user}
    if extra:
        details.update(extra)
    conn.execute(
        "INSERT INTO agent_actions_log (action_type, source, description, details, success, created_at) "
        "VALUES ('chat_tool_call', 'garten_agent', ?, ?, ?, datetime('now', 'localtime'))",
        (description, json.dumps(details, ensure_ascii=False), 1 if success else 0),
    )


def execute_update_task_due_date(conn: sqlite3.Connection, params: dict,
                                 by_slack_user: str = "") -> dict:
    task_id = int(params.get("task_id"))
    new_due = str(params.get("new_due_date", "")).strip()
    reason = str(params.get("reason", "")).strip()

    try:
        datetime.strptime(new_due, "%Y-%m-%d")
    except ValueError:
        return {"ok": False, "error": "new_due_date muss YYYY-MM-DD sein"}

    row = conn.execute("SELECT id, title, due_date FROM projects WHERE id = ?",
                       (task_id,)).fetchone()
    if not row:
        return {"ok": False, "error": f"Task #{task_id} nicht gefunden"}
    old_due = row["due_date"]
    conn.execute(
        "UPDATE projects SET due_date = ?, updated_at = datetime('now', 'localtime') "
        "WHERE id = ?", (new_due, task_id),
    )
    _log_tool_action(conn, "update_task_due_date", params,
                     f"Task #{task_id} verschoben von {old_due} → {new_due} (Grund: {reason})",
                     True, by_slack_user, extra={"old_due": old_due, "new_due": new_due})
    conn.commit()
    return {"ok": True, "task_id": task_id, "old_due_date": old_due,
            "new_due_date": new_due, "title": row["title"]}


def execute_cancel_escalation(conn: sqlite3.Connection, params: dict,
                              by_slack_user: str = "") -> dict:
    esc_id = int(params.get("escalation_id"))
    reason = str(params.get("reason", "owner_override")).strip()

    row = conn.execute(
        "SELECT id, task_id, cancelled FROM agent_escalation_state WHERE id = ?",
        (esc_id,),
    ).fetchone()
    if not row:
        return {"ok": False, "error": f"Escalation #{esc_id} nicht gefunden"}
    if row["cancelled"]:
        return {"ok": False, "error": "Eskalation war schon gecancelt"}

    conn.execute(
        "UPDATE agent_escalation_state SET cancelled = 1, cancel_reason = ?, "
        "updated_at = datetime('now', 'localtime') WHERE id = ?", (reason, esc_id),
    )
    _log_tool_action(conn, "cancel_escalation", params,
                     f"Escalation #{esc_id} (task #{row['task_id']}) cancelled — {reason}",
                     True, by_slack_user)
    conn.commit()
    return {"ok": True, "escalation_id": esc_id, "task_id": row["task_id"]}


def execute_create_email_draft(conn: sqlite3.Connection, params: dict,
                               by_slack_user: str = "") -> dict:
    to = str(params.get("to", "")).strip()
    subject = str(params.get("subject", "")).strip()
    body = str(params.get("body_plain", "")).strip()
    related_task = params.get("related_task_id")

    if not to or "@" not in to or not subject or not body:
        return {"ok": False, "error": "to/subject/body_plain sind Pflicht"}

    body_html = "<p>" + body.replace("\n\n", "</p><p>").replace("\n", "<br>") + "</p>"
    notes = f"created_via=garten_chat by_slack_user={by_slack_user}"
    if related_task:
        notes += f" related_task={related_task}"

    cur = conn.execute(
        "INSERT INTO email_drafts (recipient_email, subject, body_html, body_plain, "
        "status, notes, created_at) "
        "VALUES (?, ?, ?, ?, 'pending', ?, datetime('now', 'localtime'))",
        (to, subject, body_html, body, notes),
    )
    draft_id = cur.lastrowid
    _log_tool_action(conn, "create_email_draft", {"to": to, "subject": subject,
                                                  "body_len": len(body),
                                                  "related_task_id": related_task},
                     f"Email draft #{draft_id} an {to}: {subject}",
                     True, by_slack_user, extra={"draft_id": draft_id})
    conn.commit()
    return {"ok": True, "draft_id": draft_id, "to": to, "subject": subject}


WRITE_TOOL_FNS = {
    "update_task_due_date": execute_update_task_due_date,
    "cancel_escalation": execute_cancel_escalation,
    "create_email_draft": execute_create_email_draft,
}


# ============ Validierung + Dispatcher ============

def is_known_tool(name: str) -> bool:
    return name in READ_TOOL_FNS or name in WRITE_TOOL_FNS


def is_write_tool(name: str) -> bool:
    return name in WRITE_TOOL_FNS


def execute_read_tool(conn: sqlite3.Connection, name: str, params: dict) -> dict:
    fn = READ_TOOL_FNS.get(name)
    if not fn:
        return {"error": f"Unknown read-tool: {name}"}
    try:
        return fn(conn, **(params or {}))
    except TypeError as e:
        return {"error": f"Bad params: {e}"}
    except Exception as e:
        return {"error": f"Tool failed: {e}"}


def execute_write_tool(conn: sqlite3.Connection, name: str, params: dict,
                       by_slack_user: str = "") -> dict:
    fn = WRITE_TOOL_FNS.get(name)
    if not fn:
        return {"ok": False, "error": f"Unknown write-tool: {name}"}
    try:
        return fn(conn, params, by_slack_user=by_slack_user)
    except Exception as e:
        return {"ok": False, "error": f"Tool execution failed: {e}"}
