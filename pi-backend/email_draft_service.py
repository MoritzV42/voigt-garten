"""
Email Draft Service — Erstellt, verwaltet und sendet Email-Entwürfe.
Der CLI-Agent erstellt Drafts, Admin genehmigt sie.
"""

import os
import json
import sqlite3
from datetime import datetime

DATA_DIR = os.environ.get('DATA_DIR', '/app/data')
DB_PATH = os.path.join(DATA_DIR, 'garten.db')
AGENT_CC_EMAIL = os.environ.get('AGENT_CC_EMAIL', 'moritzvoigt42@gmail.com')


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def create_draft(recipient_email: str, recipient_name: str, subject: str,
                 body_html: str, body_plain: str = '', provider_id: int = None,
                 cc_emails: list = None, notes: str = '') -> dict:
    """Create an email draft for review."""
    conn = get_db()
    try:
        conn.execute('''
            INSERT INTO email_drafts (provider_id, recipient_email, recipient_name,
                subject, body_html, body_plain, status, cc_emails, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        ''', (
            provider_id, recipient_email, recipient_name, subject,
            body_html, body_plain or '',
            json.dumps(cc_emails or [AGENT_CC_EMAIL]),
            notes,
            datetime.now().isoformat(),
        ))
        conn.commit()
        draft_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
        conn.close()

        # Try to send Telegram notification
        _notify_telegram_draft(draft_id, recipient_name, subject)

        # Log the action
        _log_action('email_draft', f'Draft #{draft_id} erstellt: {subject}', {
            'draft_id': draft_id, 'recipient': recipient_email, 'subject': subject
        })

        return {'success': True, 'id': draft_id}
    except Exception as e:
        conn.close()
        return {'success': False, 'error': str(e)}


def get_drafts(status: str = None) -> list:
    """Get email drafts, optionally filtered by status."""
    conn = get_db()
    if status:
        rows = conn.execute(
            'SELECT * FROM email_drafts WHERE status = ? ORDER BY created_at DESC',
            (status,)
        ).fetchall()
    else:
        rows = conn.execute(
            'SELECT * FROM email_drafts ORDER BY created_at DESC'
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_draft(draft_id: int) -> dict:
    """Get a single draft by ID."""
    conn = get_db()
    row = conn.execute('SELECT * FROM email_drafts WHERE id = ?', (draft_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def approve_draft(draft_id: int, approved_by: str = 'admin') -> dict:
    """Approve and send an email draft."""
    conn = get_db()
    draft = conn.execute('SELECT * FROM email_drafts WHERE id = ?', (draft_id,)).fetchone()

    if not draft:
        conn.close()
        return {'success': False, 'error': 'Draft nicht gefunden'}

    if draft['status'] != 'pending':
        conn.close()
        return {'success': False, 'error': f'Draft ist bereits {draft["status"]}'}

    # Send email via Resend
    try:
        from email_service import FROM_EMAIL
        import resend

        cc_list = json.loads(draft['cc_emails']) if draft['cc_emails'] else []

        params = {
            'from': FROM_EMAIL,
            'to': [draft['recipient_email']],
            'subject': draft['subject'],
            'html': draft['body_html'],
        }
        if cc_list:
            params['cc'] = cc_list
        if draft['body_plain']:
            params['text'] = draft['body_plain']

        resend.Emails.send(params)

        now = datetime.now().isoformat()
        conn.execute('''
            UPDATE email_drafts SET status = 'sent', approved_by = ?, approved_at = ?, sent_at = ?
            WHERE id = ?
        ''', (approved_by, now, now, draft_id))
        conn.commit()
        conn.close()

        _log_action('email_sent', f'Email #{draft_id} gesendet an {draft["recipient_email"]}', {
            'draft_id': draft_id, 'approved_by': approved_by
        })

        return {'success': True, 'message': f'Email an {draft["recipient_email"]} gesendet'}
    except Exception as e:
        conn.close()
        return {'success': False, 'error': str(e)}


def reject_draft(draft_id: int, rejected_by: str = 'admin') -> dict:
    """Reject an email draft."""
    conn = get_db()
    conn.execute(
        "UPDATE email_drafts SET status = 'rejected', approved_by = ?, approved_at = ? WHERE id = ?",
        (rejected_by, datetime.now().isoformat(), draft_id)
    )
    conn.commit()
    conn.close()

    _log_action('email_rejected', f'Draft #{draft_id} abgelehnt', {'draft_id': draft_id})
    return {'success': True}


def update_draft(draft_id: int, **kwargs) -> dict:
    """Update draft fields (subject, body_html, body_plain, notes)."""
    allowed = {'subject', 'body_html', 'body_plain', 'notes', 'recipient_email', 'recipient_name'}
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if not updates:
        return {'success': False, 'error': 'Keine gültigen Felder'}

    conn = get_db()
    set_clause = ', '.join(f'{k} = ?' for k in updates.keys())
    values = list(updates.values()) + [draft_id]
    conn.execute(f'UPDATE email_drafts SET {set_clause} WHERE id = ? AND status = "pending"', values)
    conn.commit()
    affected = conn.execute('SELECT changes()').fetchone()[0]
    conn.close()

    if affected == 0:
        return {'success': False, 'error': 'Draft nicht gefunden oder nicht mehr bearbeitbar'}
    return {'success': True}


def _notify_telegram_draft(draft_id: int, recipient_name: str, subject: str):
    """Send admin notification about new draft (via notifications-Hub, F.4)."""
    try:
        from notifications import notify_admin
        notify_admin('email_draft_created', {
            'Draft-ID': f"#{draft_id}",
            'An': recipient_name,
            'Betreff': subject,
            'Aktion': 'Bitte im Dashboard genehmigen oder ablehnen.',
        })
    except Exception:
        pass


def _log_action(action_type: str, description: str, details: dict = None):
    """Log action to agent_actions_log."""
    try:
        conn = get_db()
        conn.execute('''
            INSERT INTO agent_actions_log (action_type, source, description, details, created_at)
            VALUES (?, 'cli_agent', ?, ?, ?)
        ''', (action_type, description, json.dumps(details or {}), datetime.now().isoformat()))
        conn.commit()
        conn.close()
    except Exception:
        pass
