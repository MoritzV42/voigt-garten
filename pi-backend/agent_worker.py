#!/usr/bin/env python3
"""
Garten-Agent Cron Worker.

Scans overdue operational tasks (category != 'it') and escalates in 3 stages.
Designed for 6-hourly invocation (cron / systemd-timer).

Runtime budget: < 30 seconds. Max 10 escalation actions per run.
"""

import os
import sys
import time
import json
import sqlite3
from datetime import datetime

DATA_DIR = os.environ.get('DATA_DIR', '/app/data')
DB_PATH = os.path.join(DATA_DIR, 'garten.db')

MAX_ACTIONS_PER_RUN = 10
RUNTIME_BUDGET_SECONDS = 30

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent_escalation import escalate_task, IT_CATEGORY  # noqa: E402


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def fetch_overdue_tasks(conn: sqlite3.Connection) -> list[dict]:
    """Fetch all non-IT tasks with status='offen' and due_date in the past."""
    rows = conn.execute(
        "SELECT id, title, description, category, status, assigned_to, due_date, "
        "escalation_state, last_escalation_at "
        "FROM projects "
        "WHERE COALESCE(category, '') != ? "
        "AND COALESCE(status, 'offen') = 'offen' "
        "AND due_date IS NOT NULL "
        "AND due_date < DATE('now', 'localtime') "
        "ORDER BY due_date ASC",
        (IT_CATEGORY,),
    ).fetchall()
    return [dict(r) for r in rows]


def cleanup_completed_escalations(conn: sqlite3.Connection) -> int:
    """Cancel escalations whose underlying task was completed/closed."""
    cur = conn.execute(
        "UPDATE agent_escalation_state SET cancelled = 1, cancel_reason = 'task_completed', "
        "updated_at = datetime('now', 'localtime') "
        "WHERE cancelled = 0 AND task_id IN ("
        "  SELECT id FROM projects WHERE COALESCE(status, 'offen') != 'offen'"
        ")"
    )
    conn.commit()
    return cur.rowcount or 0


def run(max_actions: int = MAX_ACTIONS_PER_RUN) -> dict:
    start = time.time()
    conn = get_db()
    try:
        cleaned = cleanup_completed_escalations(conn)
        tasks = fetch_overdue_tasks(conn)
        print(f"[agent_worker] {len(tasks)} overdue tasks, {cleaned} escalations cleaned")

        summary = {"scanned": len(tasks), "cleaned": cleaned,
                   "escalated": 0, "skipped": 0, "errors": 0, "per_task": []}

        for task in tasks:
            if summary["escalated"] >= max_actions:
                print(f"[agent_worker] reached max_actions={max_actions}, stopping")
                break
            if time.time() - start > RUNTIME_BUDGET_SECONDS:
                print("[agent_worker] runtime budget exceeded, stopping")
                break
            try:
                result = escalate_task(conn, task)
                if result.get("skipped"):
                    summary["skipped"] += 1
                else:
                    summary["escalated"] += 1
                summary["per_task"].append({"task_id": task["id"], **result})
            except Exception as e:
                summary["errors"] += 1
                summary["per_task"].append({"task_id": task["id"], "error": str(e)})
                print(f"[agent_worker] error on task #{task['id']}: {e}")
                try:
                    conn.rollback()
                except Exception:
                    pass

        elapsed = time.time() - start
        summary["elapsed_seconds"] = round(elapsed, 2)
        print(f"[agent_worker] done: {json.dumps({k: v for k, v in summary.items() if k != 'per_task'})}")
        return summary
    finally:
        conn.close()


if __name__ == "__main__":
    out = run()
    print(json.dumps(out, indent=2, default=str))
