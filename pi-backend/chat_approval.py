"""
Approval-Gate für Garten-Agent Tool-Calls (F.3 Phase 3b).

Schreibt Pending-Action in DB, postet Slack-Card mit Buttons. Bei Klick
führt slack_interactivity.py den Tool-Call via execute_pending_action() aus.
"""

from __future__ import annotations

import json
import os
import sqlite3

import chat_tools
import slack_service

DATA_DIR = os.environ.get('DATA_DIR', '/app/data')
DB_PATH = os.path.join(DATA_DIR, 'garten.db')


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def create_pending(conn: sqlite3.Connection, tool_name: str, params: dict,
                   summary: str, slack_user: str, channel_id: str,
                   thread_ts: str | None) -> int:
    cur = conn.execute(
        "INSERT INTO agent_pending_actions (tool_name, params_json, summary, "
        "requested_by_slack_user, channel_id, thread_ts, status) "
        "VALUES (?, ?, ?, ?, ?, ?, 'pending')",
        (tool_name, json.dumps(params, ensure_ascii=False), summary,
         slack_user, channel_id, thread_ts),
    )
    conn.commit()
    return int(cur.lastrowid)


def post_approval_card(pending_id: int, tool_name: str, params: dict,
                       summary: str, channel_id: str,
                       thread_ts: str | None) -> str | None:
    """Posts the approval card. Returns the Slack message ts (for later updates)."""
    blocks = slack_service.build_approval_card(pending_id, tool_name, summary, params)
    fallback = f":robot_face: Aktions-Vorschlag #{pending_id}: {tool_name}"
    if thread_ts:
        resp = slack_service.post_thread_reply(channel_id, thread_ts, fallback,
                                               blocks=blocks)
    else:
        resp = slack_service.post_channel(fallback, blocks=blocks, channel=channel_id)
    if not resp.get("ok"):
        print(f"[chat_approval] post failed for #{pending_id}: {resp.get('error')}")
        return None
    ts = resp.get("ts")
    if ts:
        try:
            conn = _db()
            conn.execute(
                "UPDATE agent_pending_actions SET card_message_ts = ? WHERE id = ?",
                (ts, pending_id),
            )
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[chat_approval] could not store card_ts: {e}")
    return ts


def request_approval(tool_name: str, params: dict, summary: str,
                     slack_user: str, channel_id: str,
                     thread_ts: str | None) -> dict:
    """One-shot helper used by chat_handler after parsing a tool-call from Claude."""
    if not chat_tools.is_known_tool(tool_name):
        return {"ok": False, "error": f"unknown tool: {tool_name}"}
    if not chat_tools.is_write_tool(tool_name):
        return {"ok": False, "error": f"tool {tool_name} is read-only — call directly"}
    conn = _db()
    try:
        pending_id = create_pending(conn, tool_name, params, summary,
                                    slack_user, channel_id, thread_ts)
    finally:
        conn.close()
    ts = post_approval_card(pending_id, tool_name, params, summary,
                            channel_id, thread_ts)
    return {"ok": True, "pending_id": pending_id, "card_ts": ts}


def execute_pending_action(pending_id: int, slack_user: str) -> dict:
    """Called by slack_interactivity when user clicks ‚Ausführen'."""
    conn = _db()
    try:
        row = conn.execute(
            "SELECT * FROM agent_pending_actions WHERE id = ?", (pending_id,),
        ).fetchone()
        if not row:
            return {"ok": False, "error": f"pending #{pending_id} not found"}
        if row["status"] != "pending":
            return {"ok": False, "error": f"already {row['status']}"}

        tool_name = row["tool_name"]
        try:
            params = json.loads(row["params_json"]) if row["params_json"] else {}
        except json.JSONDecodeError:
            params = {}

        result = chat_tools.execute_write_tool(conn, tool_name, params,
                                               by_slack_user=slack_user)
        success = bool(result.get("ok"))
        new_status = "executed" if success else "pending"
        conn.execute(
            "UPDATE agent_pending_actions SET status = ?, decided_by = ?, "
            "decided_at = datetime('now', 'localtime'), result_json = ? WHERE id = ?",
            (new_status, slack_user, json.dumps(result, ensure_ascii=False), pending_id),
        )
        conn.commit()
        return {"ok": success, "tool": tool_name, "result": result,
                "card_ts": row["card_message_ts"], "channel_id": row["channel_id"],
                "thread_ts": row["thread_ts"]}
    finally:
        conn.close()


def reject_pending_action(pending_id: int, slack_user: str) -> dict:
    conn = _db()
    try:
        row = conn.execute(
            "SELECT * FROM agent_pending_actions WHERE id = ?", (pending_id,),
        ).fetchone()
        if not row:
            return {"ok": False, "error": f"pending #{pending_id} not found"}
        if row["status"] != "pending":
            return {"ok": False, "error": f"already {row['status']}"}
        conn.execute(
            "UPDATE agent_pending_actions SET status = 'rejected', decided_by = ?, "
            "decided_at = datetime('now', 'localtime') WHERE id = ?",
            (slack_user, pending_id),
        )
        conn.commit()
        return {"ok": True, "tool": row["tool_name"],
                "card_ts": row["card_message_ts"], "channel_id": row["channel_id"]}
    finally:
        conn.close()


def get_pending(pending_id: int) -> dict | None:
    conn = _db()
    try:
        row = conn.execute(
            "SELECT * FROM agent_pending_actions WHERE id = ?", (pending_id,),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()
