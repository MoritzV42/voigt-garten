"""
Injection Guard — Schützt den CLI-Agent vor manipulierten DB-Inhalten.
Statische Pattern-Erkennung, kein LLM, kein Token-Verbrauch.

Usage:
    from injection_guard import sanitize_for_agent
    result = sanitize_for_agent(text, source='task')
    if result['blocked']:
        # skip this content
    elif result['flags']:
        # proceed with warning

Also callable as CLI:
    python injection_guard.py "text to check"
"""

import re
import json
import sys
from datetime import datetime

INJECTION_PATTERNS = [
    # System-Prompt Override
    (r'(?i)(ignore|forget|disregard).{0,20}(previous|above|system|instructions)', 0.8, 'prompt_override'),
    (r'(?i)(you are now|act as|pretend to be|new role)', 0.7, 'role_hijack'),
    (r'(?i)(system|developer|admin)\s*:\s*', 0.5, 'system_prefix'),

    # Delimiter Injection
    (r'(?i)(```system|<\|system\|>|<system>|\[INST\])', 0.9, 'delimiter_injection'),
    (r'(?i)(<<SYS>>|<\|im_start\|>|<\|endoftext\|>)', 0.9, 'delimiter_injection'),

    # Dangerous Commands
    (r'(?i)(delete|drop|truncate).{0,20}(table|database|all)', 0.8, 'dangerous_command'),
    (r'(?i)(send email|contact|call).{0,20}(everyone|all)', 0.6, 'mass_action'),
    (r'(?i)(rm\s+-rf|sudo|chmod|chown)', 0.7, 'shell_command'),

    # Data Exfiltration
    (r'(?i)(api.key|password|secret|token|credential)', 0.4, 'data_probe'),
    (r'(?i)(show|reveal|print|output).{0,20}(config|env|secret|key)', 0.6, 'data_exfil'),

    # Prompt Leaking
    (r'(?i)(repeat|show|print).{0,20}(system prompt|instructions|rules)', 0.7, 'prompt_leak'),
    (r'(?i)what are your (instructions|rules|guidelines)', 0.5, 'prompt_leak'),
]


def sanitize_for_agent(text: str, source: str = 'task') -> dict:
    """Sanitize user-generated DB content before the CLI agent sees it.

    Args:
        text: Raw content from DB (task title, description, email body, notes)
        source: 'task', 'email', 'booking', 'issue'

    Returns:
        {sanitized: str, risk_score: float, flags: list, blocked: bool}
    """
    if not text:
        return {'sanitized': '', 'risk_score': 0.0, 'flags': [], 'blocked': False}

    flags = []
    max_score = 0.0

    for pattern, score, flag_type in INJECTION_PATTERNS:
        matches = re.findall(pattern, text)
        if matches:
            max_score = max(max_score, score)
            flags.append({
                'type': flag_type,
                'score': score,
                'matches': [str(m) if isinstance(m, str) else str(m[0]) for m in matches[:3]],
            })

    # Adjust score based on source (emails from external are higher risk)
    if source == 'email':
        max_score = min(1.0, max_score * 1.2)

    blocked = max_score > 0.7

    if blocked:
        sanitized = f"[BLOCKED: Verdächtiger Inhalt in {source} — manuell prüfen]"
    elif max_score > 0.3:
        sanitized = text  # Pass through but with warning
    else:
        sanitized = text

    return {
        'sanitized': sanitized,
        'risk_score': round(max_score, 2),
        'flags': flags,
        'blocked': blocked,
    }


def sanitize_batch(items: list, source: str = 'task') -> list:
    """Sanitize a batch of items, each being a dict with text fields."""
    results = []
    for item in items:
        item_result = dict(item)
        item_flags = []
        item_blocked = False
        item_max_score = 0.0

        for key, value in item.items():
            if isinstance(value, str) and len(value) > 0:
                result = sanitize_for_agent(value, source)
                if result['blocked']:
                    item_blocked = True
                    item_result[key] = result['sanitized']
                elif result['flags']:
                    item_result[key] = result['sanitized']
                item_flags.extend(result['flags'])
                item_max_score = max(item_max_score, result['risk_score'])

        results.append({
            'data': item_result,
            'risk_score': item_max_score,
            'flags': item_flags,
            'blocked': item_blocked,
        })

    return results


def log_flagged_content(source: str, content_id: str, risk_score: float, flags: list, db_path: str = None):
    """Log flagged content to agent_actions_log table."""
    if not db_path:
        import os
        db_path = os.path.join(os.environ.get('DATA_DIR', '/app/data'), 'garten.db')

    try:
        import sqlite3
        conn = sqlite3.connect(db_path)
        conn.execute('''
            INSERT INTO agent_actions_log (action_type, source, description, details, risk_score, success)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (
            'injection_flagged',
            source,
            f'Verdächtiger Inhalt in {source} #{content_id} (Score: {risk_score})',
            json.dumps({'flags': flags, 'content_id': content_id}),
            risk_score,
            True,
        ))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[injection_guard] Log error: {e}")


if __name__ == '__main__':
    if len(sys.argv) > 1:
        text = ' '.join(sys.argv[1:])
        result = sanitize_for_agent(text)
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print("Usage: python injection_guard.py 'text to check'")
        sys.exit(1)
