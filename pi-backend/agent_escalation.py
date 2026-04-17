"""
Garten-Agent Escalation Logic.

3-stage escalation (Phase 1): reminder → email → slack-dm (+ telegram fallback).
Emergency categories (wasser, elektrik) escalate faster.

Stage 4 (voice call) is Phase 2 — Task #101.
"""

import os
import json
import sqlite3
from datetime import datetime, date, timedelta
from typing import Any

import slack_service

EMERGENCY_CATEGORIES = {"wasser", "elektrik"}
IT_CATEGORY = "it"

STANDARD_THRESHOLDS = {1: 1, 2: 3, 3: 7}
EMERGENCY_THRESHOLDS = {1: 0, 2: 1, 3: 2}

PROVIDER_EMAIL_COOLDOWN_DAYS = 7
PROVIDER_EMAIL_MAX_PER_PERIOD = 3


def _now() -> datetime:
    return datetime.now()


def _today() -> date:
    return date.today()


def calculate_days_overdue(due_date_str: str | None) -> int:
    if not due_date_str:
        return 0
    try:
        due = datetime.strptime(due_date_str[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return 0
    delta = (_today() - due).days
    return max(0, delta)


def calculate_stage(category: str | None, days_overdue: int) -> int:
    """Return the escalation stage (1/2/3) for a task, or 0 if no action yet."""
    if days_overdue <= 0:
        if category in EMERGENCY_CATEGORIES and days_overdue == 0:
            return 1
        return 0

    thresholds = EMERGENCY_THRESHOLDS if category in EMERGENCY_CATEGORIES else STANDARD_THRESHOLDS

    stage = 0
    for s in (1, 2, 3):
        if days_overdue >= thresholds[s]:
            stage = s
    return stage


def should_escalate(prev_stage: int | None, target_stage: int) -> bool:
    """Only escalate if target stage is strictly higher than last executed stage."""
    if target_stage <= 0:
        return False
    if prev_stage is None:
        return True
    return target_stage > prev_stage


def get_default_provider(conn: sqlite3.Connection, category: str) -> dict | None:
    """Return first non-disabled provider whose default_for_categories contains the task category."""
    rows = conn.execute(
        "SELECT id, category, name, email, phone, default_for_categories, "
        "agent_disabled, last_agent_action_at "
        "FROM service_providers WHERE COALESCE(agent_disabled, 0) = 0"
    ).fetchall()
    for row in rows:
        cats_raw = row["default_for_categories"] or "[]"
        try:
            cats = json.loads(cats_raw) if isinstance(cats_raw, str) else []
        except (json.JSONDecodeError, TypeError):
            cats = []
        if category in cats or row["category"] == category:
            return dict(row)
    return None


def provider_rate_limit_ok(conn: sqlite3.Connection, provider_id: int) -> bool:
    """Max 3 auto-emails per provider per 7 days."""
    row = conn.execute(
        "SELECT COUNT(*) AS c FROM agent_actions_log "
        "WHERE source = 'garten_agent' AND action_type = 'email_sent' "
        "AND details LIKE ? "
        "AND created_at >= datetime('now', ?)",
        (f'%"provider_id": {provider_id}%', f'-{PROVIDER_EMAIL_COOLDOWN_DAYS} days'),
    ).fetchone()
    return (row["c"] if row else 0) < PROVIDER_EMAIL_MAX_PER_PERIOD


def log_action(conn: sqlite3.Connection, action_type: str, description: str,
               details: dict, success: bool = True) -> None:
    conn.execute(
        "INSERT INTO agent_actions_log (action_type, source, description, details, success, created_at) "
        "VALUES (?, 'garten_agent', ?, ?, ?, datetime('now', 'localtime'))",
        (action_type, description, json.dumps(details, ensure_ascii=False), 1 if success else 0),
    )


def upsert_escalation_state(conn: sqlite3.Connection, task_id: int, stage: int,
                            next_action_at: datetime | None = None) -> int:
    """Insert or update agent_escalation_state. Returns row id."""
    existing = conn.execute(
        "SELECT id FROM agent_escalation_state WHERE task_id = ?", (task_id,)
    ).fetchone()
    now_str = _now().strftime("%Y-%m-%d %H:%M:%S")
    next_str = next_action_at.strftime("%Y-%m-%d %H:%M:%S") if next_action_at else None
    if existing:
        conn.execute(
            "UPDATE agent_escalation_state SET current_stage = ?, last_action_at = ?, "
            "next_action_at = ?, updated_at = ?, cancelled = 0 WHERE id = ?",
            (stage, now_str, next_str, now_str, existing["id"]),
        )
        esc_id = existing["id"]
    else:
        cur = conn.execute(
            "INSERT INTO agent_escalation_state (task_id, current_stage, last_action_at, "
            "next_action_at, cancelled, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, 0, ?, ?)",
            (task_id, stage, now_str, next_str, now_str, now_str),
        )
        esc_id = cur.lastrowid
    conn.execute(
        "UPDATE projects SET escalation_state = ?, last_escalation_at = ? WHERE id = ?",
        (f"stage_{stage}", now_str, task_id),
    )
    return esc_id


def _next_action_at_for(category: str | None, stage: int) -> datetime | None:
    """Compute rough next_action_at preview for COO/display. Returns None if at stage 3."""
    if stage >= 3:
        return None
    thresholds = EMERGENCY_THRESHOLDS if category in EMERGENCY_CATEGORIES else STANDARD_THRESHOLDS
    next_stage = stage + 1
    days_until = max(1, thresholds[next_stage] - thresholds[stage])
    return _now() + timedelta(days=days_until)


def execute_stage_1(conn: sqlite3.Connection, task: dict, days_overdue: int) -> dict:
    """Stage 1: Slack channel post (passive reminder) + COO daily plan entry."""
    blocks = slack_service.build_escalation_blocks(task, 1, days_overdue)
    resp = slack_service.post_channel(
        f":bell: Stufe 1 — Task #{task['id']} «{task.get('title', '')}» ist überfällig "
        f"({days_overdue} Tag{'' if days_overdue == 1 else 'e'}, Kategorie {task.get('category', '?')}).",
        blocks=blocks,
    )
    ok = bool(resp.get("ok"))
    log_action(conn, "reminder",
               f"Stage 1 reminder for task #{task['id']}",
               {"task_id": task["id"], "category": task.get("category"),
                "days_overdue": days_overdue, "slack_ts": resp.get("ts"),
                "slack_error": resp.get("error")},
               success=ok)
    return {"ok": ok, "slack_ts": resp.get("ts"), "error": resp.get("error")}


def execute_stage_2(conn: sqlite3.Connection, task: dict, days_overdue: int) -> dict:
    """Stage 2: Email to default provider + slack channel note."""
    from email_service import send_provider_reminder
    category = task.get("category") or ""
    provider = get_default_provider(conn, category)
    if not provider:
        log_action(conn, "email_sent",
                   f"Stage 2: no provider match for task #{task['id']} ({category})",
                   {"task_id": task["id"], "category": category,
                    "reason": "no_provider_for_category"},
                   success=False)
        fallback_blocks = slack_service.build_escalation_blocks(task, 2, days_overdue)
        slack_service.post_channel(
            f":envelope: Stufe 2 — Task #{task['id']} fällig seit {days_overdue} Tagen, "
            f"*kein passender Dienstleister* für Kategorie `{category}` hinterlegt.",
            blocks=fallback_blocks,
        )
        return {"ok": False, "reason": "no_provider_for_category"}

    if not provider.get("email"):
        log_action(conn, "email_sent",
                   f"Stage 2: provider #{provider['id']} has no email",
                   {"task_id": task["id"], "provider_id": provider["id"],
                    "reason": "no_email"},
                   success=False)
        return {"ok": False, "reason": "provider_no_email"}

    if not provider_rate_limit_ok(conn, provider["id"]):
        log_action(conn, "email_sent",
                   f"Stage 2: provider #{provider['id']} rate-limited",
                   {"task_id": task["id"], "provider_id": provider["id"],
                    "reason": "rate_limited"},
                   success=False)
        return {"ok": False, "reason": "rate_limited"}

    email_ok = send_provider_reminder(provider, task, days_overdue)
    now_str = _now().strftime("%Y-%m-%d %H:%M:%S")
    conn.execute(
        "UPDATE service_providers SET last_agent_action_at = ? WHERE id = ?",
        (now_str, provider["id"]),
    )
    log_action(conn, "email_sent",
               f"Stage 2 email to {provider['name']} for task #{task['id']}",
               {"task_id": task["id"], "provider_id": provider["id"],
                "provider_name": provider["name"], "provider_email": provider["email"],
                "days_overdue": days_overdue},
               success=email_ok)

    blocks = slack_service.build_escalation_blocks(task, 2, days_overdue, provider=provider)
    slack_service.post_channel(
        f":envelope: Stufe 2 — Task #{task['id']}: Email an {provider['name']} "
        f"({provider['email']}) versendet.",
        blocks=blocks,
    )
    return {"ok": email_ok, "provider_id": provider["id"]}


def execute_stage_3(conn: sqlite3.Connection, task: dict, days_overdue: int) -> dict:
    """Stage 3: Slack DM to Moritz + Telegram fallback + channel post."""
    category = task.get("category") or ""
    provider = get_default_provider(conn, category)
    blocks = slack_service.build_escalation_blocks(task, 3, days_overdue, provider=provider)
    moritz_user = slack_service.GARTEN_MORITZ_SLACK_USER_ID
    dm_resp = slack_service.send_dm(
        moritz_user,
        f":rotating_light: Stufe 3 — Task #{task['id']} «{task.get('title', '')}» "
        f"{days_overdue} Tage überfällig. Bitte selbst handeln.",
        blocks=blocks,
    )
    dm_ok = bool(dm_resp.get("ok"))

    slack_service.post_channel(
        f":rotating_light: Stufe 3 — Task #{task['id']} an @MoritzV_42 übergeben "
        f"({days_overdue} Tage überfällig, Kategorie {category}).",
        blocks=blocks,
    )

    tg_ok = _telegram_fallback(task, days_overdue, provider)

    log_action(conn, "slack_dm",
               f"Stage 3 DM to Moritz for task #{task['id']}",
               {"task_id": task["id"], "category": category,
                "days_overdue": days_overdue,
                "provider_id": provider["id"] if provider else None,
                "dm_ts": dm_resp.get("ts"), "dm_error": dm_resp.get("error"),
                "telegram_ok": tg_ok},
               success=dm_ok)
    return {"ok": dm_ok, "telegram_ok": tg_ok}


def _telegram_fallback(task: dict, days_overdue: int, provider: dict | None) -> bool:
    """Optional Telegram alert — silently skipped if not configured."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")
    if not token or not chat_id:
        return False
    import requests
    text_lines = [
        f"🚨 Stufe 3 Eskalation: Task #{task['id']}",
        f"Titel: {task.get('title', '—')}",
        f"Kategorie: {task.get('category', '—')}",
        f"Tage überfällig: {days_overdue}",
    ]
    if provider:
        text_lines.append(f"Vorgeschlagen: {provider['name']} ({provider.get('phone', '')})")
    text_lines.append("Bitte selbst anrufen.")
    try:
        resp = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": "\n".join(text_lines)},
            timeout=10,
        )
        return resp.ok and resp.json().get("ok", False)
    except Exception as e:
        print(f"[agent_escalation] telegram fallback error: {e}")
        return False


EXECUTORS = {
    1: execute_stage_1,
    2: execute_stage_2,
    3: execute_stage_3,
}


def escalate_task(conn: sqlite3.Connection, task: dict) -> dict:
    """Decide target stage and execute it if it's a step up. Returns summary."""
    category = task.get("category") or ""
    if category == IT_CATEGORY:
        return {"skipped": True, "reason": "it_category"}

    days_overdue = calculate_days_overdue(task.get("due_date"))
    target_stage = calculate_stage(category, days_overdue)
    if target_stage == 0:
        return {"skipped": True, "reason": "no_stage_yet", "days_overdue": days_overdue}

    existing = conn.execute(
        "SELECT current_stage, cancelled FROM agent_escalation_state WHERE task_id = ?",
        (task["id"],),
    ).fetchone()
    if existing and existing["cancelled"]:
        return {"skipped": True, "reason": "escalation_cancelled"}
    prev_stage = existing["current_stage"] if existing else None

    if not should_escalate(prev_stage, target_stage):
        return {"skipped": True, "reason": "already_at_or_past_stage",
                "prev_stage": prev_stage, "target_stage": target_stage}

    executor = EXECUTORS[target_stage]
    result = executor(conn, task, days_overdue)

    next_at = _next_action_at_for(category, target_stage)
    upsert_escalation_state(conn, task["id"], target_stage, next_at)
    conn.commit()

    return {"skipped": False, "stage": target_stage, "days_overdue": days_overdue,
            "result": result}
