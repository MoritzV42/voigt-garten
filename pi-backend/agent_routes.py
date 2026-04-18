"""
Flask Blueprint for Garten-Agent API endpoints.

All endpoints require X-COO-Secret header (matches COO_API_SECRET env var).
"""

import os
import json
import sqlite3
from datetime import datetime
from functools import wraps

from flask import Blueprint, request, jsonify

import agent_escalation
import agent_worker

agent_bp = Blueprint('garten_agent', __name__, url_prefix='/api/garten/agent')

COO_API_SECRET = os.environ.get('COO_API_SECRET', '')
DATA_DIR = os.environ.get('DATA_DIR', '/app/data')
DB_PATH = os.path.join(DATA_DIR, 'garten.db')


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def require_coo_secret(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        if not COO_API_SECRET:
            return jsonify({"error": "COO_API_SECRET not configured on server"}), 500
        secret = request.headers.get('X-COO-Secret', '')
        if secret != COO_API_SECRET:
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return wrapped


@agent_bp.route('/status', methods=['GET'])
@require_coo_secret
def get_status():
    """Active escalations + stats for COO daily plan."""
    conn = _db()
    try:
        active = conn.execute(
            "SELECT e.id AS esc_id, e.task_id, e.current_stage, e.next_action_at, "
            "e.last_action_at, p.title AS task_title, p.category, p.due_date "
            "FROM agent_escalation_state e "
            "JOIN projects p ON p.id = e.task_id "
            "WHERE COALESCE(e.cancelled, 0) = 0 "
            "AND COALESCE(p.status, 'offen') = 'offen' "
            "ORDER BY e.current_stage DESC, e.last_action_at DESC"
        ).fetchall()

        active_list = []
        for row in active:
            category = row["category"] or ""
            provider = agent_escalation.get_default_provider(conn, category)
            active_list.append({
                "escalation_id": row["esc_id"],
                "task_id": row["task_id"],
                "task_title": row["task_title"],
                "category": row["category"],
                "due_date": row["due_date"],
                "current_stage": row["current_stage"],
                "next_action_at": row["next_action_at"],
                "last_action_at": row["last_action_at"],
                "default_contact": ({"id": provider["id"], "name": provider["name"],
                                     "phone": provider.get("phone"),
                                     "email": provider.get("email")}
                                    if provider else None),
            })

        stats_rows = conn.execute(
            "SELECT current_stage, COUNT(*) AS c FROM agent_escalation_state "
            "WHERE COALESCE(cancelled, 0) = 0 GROUP BY current_stage"
        ).fetchall()
        stats = {f"stage_{r['current_stage']}": r["c"] for r in stats_rows}
        for s in (1, 2, 3):
            stats.setdefault(f"stage_{s}", 0)

        last7d = conn.execute(
            "SELECT COUNT(*) AS c FROM agent_actions_log "
            "WHERE source = 'garten_agent' AND action_type = 'email_sent' "
            "AND success = 1 AND created_at >= datetime('now', '-7 days')"
        ).fetchone()

        return jsonify({
            "active_escalations": active_list,
            "stats": stats,
            "emails_last_7d": last7d["c"] if last7d else 0,
        })
    finally:
        conn.close()


@agent_bp.route('/trigger-escalation/<int:task_id>', methods=['POST'])
@require_coo_secret
def trigger_escalation(task_id: int):
    """Manually force escalation for a specific task."""
    conn = _db()
    try:
        row = conn.execute(
            "SELECT id, title, description, category, status, assigned_to, due_date "
            "FROM projects WHERE id = ?", (task_id,)
        ).fetchone()
        if not row:
            return jsonify({"error": f"Task #{task_id} not found"}), 404
        task = dict(row)
        result = agent_escalation.escalate_task(conn, task)
        return jsonify({"task_id": task_id, "result": result})
    finally:
        conn.close()


@agent_bp.route('/cancel-escalation/<int:escalation_id>', methods=['POST'])
@require_coo_secret
def cancel_escalation(escalation_id: int):
    """Cancel an active escalation (e.g. when Moritz already handled it)."""
    payload = request.get_json(silent=True) or {}
    reason = payload.get('reason', 'owner_override')
    conn = _db()
    try:
        row = conn.execute(
            "SELECT id, task_id, cancelled FROM agent_escalation_state WHERE id = ?",
            (escalation_id,),
        ).fetchone()
        if not row:
            return jsonify({"error": f"Escalation #{escalation_id} not found"}), 404
        if row["cancelled"]:
            return jsonify({"escalation_id": escalation_id, "already_cancelled": True})
        conn.execute(
            "UPDATE agent_escalation_state SET cancelled = 1, cancel_reason = ?, "
            "updated_at = datetime('now', 'localtime') WHERE id = ?",
            (reason, escalation_id),
        )
        conn.execute(
            "INSERT INTO agent_actions_log (action_type, source, description, details, success, created_at) "
            "VALUES ('escalation_cancelled', 'garten_agent', ?, ?, 1, datetime('now', 'localtime'))",
            (f"Escalation #{escalation_id} cancelled",
             json.dumps({"escalation_id": escalation_id, "task_id": row["task_id"],
                         "reason": reason}, ensure_ascii=False)),
        )
        conn.commit()
        return jsonify({"escalation_id": escalation_id, "cancelled": True, "reason": reason})
    finally:
        conn.close()


@agent_bp.route('/run-now', methods=['POST'])
@require_coo_secret
def run_now():
    """Manually trigger one worker run (useful for smoke-tests)."""
    summary = agent_worker.run()
    return jsonify(summary)


# ============ F.3 Chat-Layer: Slack-Events-Endpoint ============

@agent_bp.route('/slack-events', methods=['POST'])
def slack_events():
    """
    Slack-Events-API-Endpoint für @GartenBot-Mentions.
    Auth via Slack-Signing-Secret (NICHT X-COO-Secret).
    ACKt sofort 200, dispatcht in Daemon-Thread.
    """
    import slack_service
    import chat_handler

    raw_body = request.get_data()
    if not slack_service.verify_slack_signature(raw_body, request.headers):
        return ('', 401)

    try:
        payload = json.loads(raw_body.decode('utf-8'))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return ('', 200)

    body, status, headers = chat_handler.handle_slack_event(payload)
    return (body, status, headers)
