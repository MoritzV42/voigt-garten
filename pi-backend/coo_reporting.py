"""
COO Reporting — Generiert tägliche Reports für den COO.
Wird vom CLI-Agent und dem /api/agent/daily-report Endpoint genutzt.
"""

import os
import json
import sqlite3
from datetime import datetime, timedelta

DATA_DIR = os.environ.get('DATA_DIR', '/app/data')
DB_PATH = os.path.join(DATA_DIR, 'garten.db')


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def generate_daily_report() -> dict:
    """Generate the daily COO report."""
    conn = get_db()
    today = datetime.now().strftime('%Y-%m-%d')
    week_ahead = (datetime.now() + timedelta(days=7)).strftime('%Y-%m-%d')

    report = {
        'date': today,
        'generated_at': datetime.now().isoformat(),
        'summary': '',
        'tasks': _get_task_summary(conn, today, week_ahead),
        'bookings': _get_booking_summary(conn, today, week_ahead),
        'communications': _get_communication_summary(conn, today),
        'issues': _get_issue_summary(conn, today),
        'action_items_for_coo': [],
    }

    # Build summary
    summary_parts = []
    overdue_count = len(report['tasks']['overdue'])
    if overdue_count:
        summary_parts.append(f'{overdue_count} überfällige Aufgaben')
    upcoming_bookings = len(report['bookings']['upcoming_7d'])
    if upcoming_bookings:
        summary_parts.append(f'{upcoming_bookings} Buchungen in den nächsten 7 Tagen')
    pending_drafts = report['communications']['emails_awaiting_approval']
    if pending_drafts:
        summary_parts.append(f'{pending_drafts} Email-Entwürfe warten auf Freigabe')
    open_issues = len(report['issues']['open'])
    if open_issues:
        summary_parts.append(f'{open_issues} offene Meldungen')

    report['summary'] = ', '.join(summary_parts) if summary_parts else 'Alles im grünen Bereich.'

    # Generate action items
    for task in report['tasks']['overdue']:
        days = task.get('days_overdue', 0)
        priority = 'high' if days > 14 else 'medium'
        report['action_items_for_coo'].append({
            'priority': priority,
            'action': f'Überfällige Aufgabe: {task["title"]} ({days} Tage)',
            'task_id': task.get('id'),
        })

    if pending_drafts:
        report['action_items_for_coo'].append({
            'priority': 'medium',
            'action': f'{pending_drafts} Email-Entwürfe genehmigen',
        })

    for issue in report['issues']['open']:
        report['action_items_for_coo'].append({
            'priority': 'low',
            'action': f'Offene Meldung: {issue["title"]}',
            'issue_id': issue.get('id'),
        })

    conn.close()

    # Save report
    _save_report(report)

    return report


def _get_task_summary(conn, today, week_ahead):
    """Get task summary for the report."""
    # Overdue tasks
    overdue = conn.execute('''
        SELECT id, title, status, priority, category, due_date,
            CAST(julianday(?) - julianday(due_date) AS INTEGER) as days_overdue
        FROM projects
        WHERE due_date < ? AND status IN ('offen', 'in_arbeit')
        ORDER BY due_date ASC
    ''', (today, today)).fetchall()

    # Completed today
    completed = conn.execute('''
        SELECT id, title, category FROM projects
        WHERE status = 'done' AND DATE(updated_at) = ?
    ''', (today,)).fetchall()

    # Due this week
    due_week = conn.execute('''
        SELECT id, title, status, priority, category, due_date
        FROM projects
        WHERE due_date BETWEEN ? AND ? AND status IN ('offen', 'in_arbeit')
        ORDER BY due_date ASC
    ''', (today, week_ahead)).fetchall()

    return {
        'overdue': [dict(r) for r in overdue],
        'completed_today': [dict(r) for r in completed],
        'due_this_week': [dict(r) for r in due_week],
    }


def _get_booking_summary(conn, today, week_ahead):
    """Get booking summary."""
    # Active bookings (currently staying)
    active = conn.execute('''
        SELECT id, guest_name, check_in, check_out, guests, status
        FROM bookings WHERE check_in <= ? AND check_out >= ? AND status != 'cancelled'
    ''', (today, today)).fetchall()

    # Upcoming 7 days
    upcoming = conn.execute('''
        SELECT id, guest_name, check_in, check_out, guests, total_price, status
        FROM bookings WHERE check_in BETWEEN ? AND ? AND status != 'cancelled'
        ORDER BY check_in ASC
    ''', (today, week_ahead)).fetchall()

    # Pending payment
    pending_payment = conn.execute('''
        SELECT id, guest_name, check_in, total_price, created_at
        FROM bookings WHERE status = 'pending'
        ORDER BY created_at ASC
    ''').fetchall()

    return {
        'active': [dict(r) for r in active],
        'upcoming_7d': [dict(r) for r in upcoming],
        'pending_payment': [dict(r) for r in pending_payment],
    }


def _get_communication_summary(conn, today):
    """Get communication summary."""
    try:
        drafted = conn.execute(
            "SELECT COUNT(*) as c FROM email_drafts WHERE DATE(created_at) = ?", (today,)
        ).fetchone()['c']
        awaiting = conn.execute(
            "SELECT COUNT(*) as c FROM email_drafts WHERE status = 'pending'"
        ).fetchone()['c']
    except Exception:
        drafted = 0
        awaiting = 0

    return {
        'emails_drafted_today': drafted,
        'emails_awaiting_approval': awaiting,
    }


def _get_issue_summary(conn, today):
    """Get issue summary."""
    try:
        open_issues = conn.execute('''
            SELECT id, title, report_type, category, created_at
            FROM issue_reports WHERE status IN ('pending', 'open')
            ORDER BY created_at DESC LIMIT 20
        ''').fetchall()

        resolved = conn.execute('''
            SELECT id, title FROM issue_reports
            WHERE status = 'resolved' AND DATE(updated_at) = ?
        ''', (today,)).fetchall()
    except Exception:
        open_issues = []
        resolved = []

    return {
        'open': [dict(r) for r in open_issues],
        'resolved_today': [dict(r) for r in resolved],
    }


def _save_report(report: dict):
    """Save report to agent_actions_log."""
    try:
        conn = get_db()
        conn.execute('''
            INSERT INTO agent_actions_log (action_type, source, description, details, created_at)
            VALUES ('coo_report', 'cli_agent', ?, ?, ?)
        ''', (
            f'Tagesbericht {report["date"]}: {report["summary"]}',
            json.dumps(report, default=str),
            datetime.now().isoformat(),
        ))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[coo_reporting] Save error: {e}")


def get_latest_report() -> dict:
    """Get the most recent daily report."""
    try:
        conn = get_db()
        row = conn.execute('''
            SELECT details FROM agent_actions_log
            WHERE action_type = 'coo_report'
            ORDER BY created_at DESC LIMIT 1
        ''').fetchone()
        conn.close()
        if row:
            return json.loads(row['details'])
    except Exception:
        pass
    return None
