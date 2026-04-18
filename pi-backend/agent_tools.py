"""
Agent Tools — Rollenbasierte Tool-Definitionen für den Garten-Assistenten.
Jedes Tool hat ein role_required Attribut für rollenbasiertes Gating.
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


# Tool registry
TOOLS = {}


def register_tool(name, description, parameters, role_required='anonymous'):
    """Decorator to register a tool function."""
    def decorator(func):
        TOOLS[name] = {
            'definition': {
                'type': 'function',
                'function': {
                    'name': name,
                    'description': description,
                    'parameters': parameters,
                }
            },
            'executor': func,
            'role_required': role_required,
        }
        return func
    return decorator


# Define ROLE_LEVELS for comparison
ROLE_LEVELS = {'anonymous': 0, 'guest': 1, 'admin': 2}


def get_tools_for_role(role='anonymous'):
    """Return tool definitions and executors filtered by role."""
    level = ROLE_LEVELS.get(role, 0)
    filtered = {}
    for name, tool in TOOLS.items():
        required_level = ROLE_LEVELS.get(tool['role_required'], 0)
        if level >= required_level:
            filtered[name] = tool
    return filtered


def get_tool_definitions_for_role(role='anonymous'):
    """Return only the OpenAI-compatible tool definitions for a role."""
    tools = get_tools_for_role(role)
    return [t['definition'] for t in tools.values()]


def execute_tool(name, args, role='anonymous'):
    """Execute a tool by name if the role has access."""
    tools = get_tools_for_role(role)
    if name not in tools:
        return json.dumps({'error': f'Tool {name} nicht verfügbar für Rolle {role}'})
    try:
        return tools[name]['executor'](args)
    except Exception as e:
        return json.dumps({'error': str(e)})


# ─── Anonymous Tools ───────────────────────────────────────────


@register_tool(
    name='get_garden_info',
    description='Gibt allgemeine Informationen über den Garten zurück (Lage, Größe, Ausstattung, Anreise).',
    parameters={'type': 'object', 'properties': {}, 'required': []},
    role_required='anonymous',
)
def get_garden_info(args):
    return json.dumps({
        'name': 'Refugium Heideland',
        'location': 'Heideland, Thüringen (Südhang)',
        'size': '5.300 m²',
        'buildings': [
            'Gartenhaus (Holz)',
            'Wintergarten',
            '4 Schuppen',
            'Carport',
        ],
        'features': [
            'Solar 700W + 1,4kWh Akku (autark)',
            'Eigener Brunnen (50m tief)',
            'Süßkirschen (50 Jahre alt)',
            '2 Eichen (Durchmesser >1m)',
            '2 Eschen',
        ],
        'amenities': [
            'Übernachtungsmöglichkeit',
            'Fotogalerie mit 360°-Panoramen',
            'Interaktive Gartenkarte',
            'WLAN verfügbar',
        ],
        'contact': 'garten@infinityspace42.de',
        'website': 'https://garten.infinityspace42.de',
    })


@register_tool(
    name='get_pricing_info',
    description='Gibt aktuelle Preise und Buchungsbedingungen zurück.',
    parameters={'type': 'object', 'properties': {}, 'required': []},
    role_required='anonymous',
)
def get_pricing_info(args):
    defaults = {
        'base_price_per_night': 45.0,
        'extra_guest_price': 10.0,
        'cleaning_fee': 25.0,
        'min_nights': 1,
        'max_guests': 6,
        'day_use_price': 20.0,
        'currency': 'EUR',
    }
    conn = None
    try:
        conn = get_db()
        rows = conn.execute(
            "SELECT key, value FROM site_config WHERE key LIKE 'price%' "
            "OR key LIKE 'base_price%' OR key LIKE 'extra_guest%' "
            "OR key LIKE 'cleaning%' OR key LIKE 'min_night%' "
            "OR key LIKE 'max_guest%' OR key LIKE 'day_use%'"
        ).fetchall()
        for row in rows:
            key = row['key']
            val = row['value']
            try:
                val = float(val)
            except (ValueError, TypeError):
                pass
            defaults[key] = val
    except Exception:
        pass
    finally:
        if conn:
            conn.close()

    defaults['cancellation_policy'] = {
        '7_plus_days': '100% Erstattung',
        '3_to_6_days': '50% Erstattung',
        'under_3_days': 'Keine Erstattung',
    }
    defaults['family_discount_code'] = 'REFUGIUM-FAMILY (50%)'

    return json.dumps(defaults)


@register_tool(
    name='check_availability',
    description='Prüft die Verfügbarkeit für einen bestimmten Monat. Gibt gebuchte Tage zurück.',
    parameters={
        'type': 'object',
        'properties': {
            'month': {
                'type': 'string',
                'description': 'Monat im Format YYYY-MM, z.B. 2026-04',
            }
        },
        'required': ['month'],
    },
    role_required='anonymous',
)
def check_availability(args):
    month = args.get('month', '')
    if not month or len(month) != 7:
        return json.dumps({'error': 'Monat im Format YYYY-MM angeben.'})

    conn = None
    try:
        conn = get_db()
        month_start = f'{month}-01'
        # Calculate last day of month
        year, mon = int(month[:4]), int(month[5:7])
        if mon == 12:
            next_month_start = f'{year + 1}-01-01'
        else:
            next_month_start = f'{year}-{mon + 1:02d}-01'

        rows = conn.execute(
            "SELECT check_in, check_out FROM bookings "
            "WHERE status != 'cancelled' "
            "AND check_out > ? AND check_in < ? "
            "ORDER BY check_in",
            (month_start, next_month_start),
        ).fetchall()

        booked_dates = set()
        for row in rows:
            ci = datetime.strptime(row['check_in'], '%Y-%m-%d')
            co = datetime.strptime(row['check_out'], '%Y-%m-%d')
            current = ci
            while current < co:
                if current.strftime('%Y-%m') == month:
                    booked_dates.add(current.strftime('%Y-%m-%d'))
                current += timedelta(days=1)

        return json.dumps({
            'month': month,
            'booked_dates': sorted(booked_dates),
            'booked_count': len(booked_dates),
        })
    except Exception as e:
        return json.dumps({'error': str(e)})
    finally:
        if conn:
            conn.close()


# ─── Guest Tools ───────────────────────────────────────────────


@register_tool(
    name='get_upcoming_bookings',
    description='Gibt die kommenden Buchungen im Garten zurück (nächste 30 Tage).',
    parameters={
        'type': 'object',
        'properties': {
            'user_email': {
                'type': 'string',
                'description': 'Email des anfragenden Nutzers (für Gast-Filterung)',
            }
        },
        'required': [],
    },
    role_required='guest',
)
def get_upcoming_bookings(args):
    conn = None
    try:
        conn = get_db()
        today = datetime.now().strftime('%Y-%m-%d')
        future = (datetime.now() + timedelta(days=30)).strftime('%Y-%m-%d')

        user_email = args.get('user_email', '') or args.get('_user_email', '')
        role = args.get('_role', 'guest')

        if role == 'admin':
            rows = conn.execute(
                'SELECT guest_name, guest_email, check_in, check_out, guests, status '
                'FROM bookings WHERE check_in >= ? AND check_in <= ? '
                'ORDER BY check_in LIMIT 10',
                (today, future),
            ).fetchall()
            return json.dumps([dict(r) for r in rows] if rows else
                              {'info': 'Keine Buchungen in den nächsten 30 Tagen.'})
        else:
            # Guest: filter by email, strip sensitive fields
            if user_email:
                rows = conn.execute(
                    'SELECT check_in, check_out, guests, status '
                    'FROM bookings WHERE guest_email = ? '
                    'AND check_in >= ? AND check_in <= ? '
                    'ORDER BY check_in LIMIT 10',
                    (user_email, today, future),
                ).fetchall()
            else:
                # No email provided: show count only
                count = conn.execute(
                    'SELECT COUNT(*) as count FROM bookings '
                    'WHERE check_in >= ? AND check_in <= ?',
                    (today, future),
                ).fetchone()['count']
                return json.dumps({
                    'info': f'{count} Buchung(en) in den nächsten 30 Tagen.',
                    'hint': 'Für Details melde dich mit deiner Email an.',
                })

            if not rows:
                return json.dumps({'info': 'Keine eigenen Buchungen in den nächsten 30 Tagen.'})
            return json.dumps([dict(r) for r in rows])
    except Exception as e:
        return json.dumps({'error': str(e)})
    finally:
        if conn:
            conn.close()


@register_tool(
    name='get_open_tasks',
    description='Gibt offene Wartungs- und Gartenaufgaben zurück.',
    parameters={'type': 'object', 'properties': {}, 'required': []},
    role_required='guest',
)
def get_open_tasks(args):
    conn = None
    try:
        conn = get_db()
        rows = conn.execute(
            "SELECT title, status, priority, category, due_date "
            "FROM projects WHERE status IN ('offen', 'in_arbeit') "
            "ORDER BY priority DESC LIMIT 10"
        ).fetchall()
        if not rows:
            return json.dumps({'info': 'Keine offenen Aufgaben.'})
        return json.dumps([dict(r) for r in rows])
    except Exception as e:
        return json.dumps({'error': str(e)})
    finally:
        if conn:
            conn.close()


@register_tool(
    name='search_inventory',
    description='Durchsucht das Inventar nach einem Gegenstand.',
    parameters={
        'type': 'object',
        'properties': {
            'query': {
                'type': 'string',
                'description': 'Suchbegriff für Inventar',
            }
        },
        'required': ['query'],
    },
    role_required='guest',
)
def search_inventory(args):
    query = args.get('query', '')
    conn = None
    try:
        conn = get_db()
        rows = conn.execute(
            "SELECT i.name, i.category, i.quantity, i.condition, r.name as room "
            "FROM inventory_items i "
            "LEFT JOIN inventory_rooms r ON i.room_id = r.id "
            "WHERE i.name LIKE ? OR i.category LIKE ? "
            "LIMIT 10",
            (f'%{query}%', f'%{query}%'),
        ).fetchall()
        if not rows:
            return json.dumps({'info': f"Nichts gefunden für '{query}'."})
        return json.dumps([dict(r) for r in rows])
    except Exception as e:
        return json.dumps({'error': str(e)})
    finally:
        if conn:
            conn.close()


@register_tool(
    name='get_gallery_stats',
    description='Gibt Statistiken zur Galerie zurück (Anzahl Bilder, Kategorien).',
    parameters={'type': 'object', 'properties': {}, 'required': []},
    role_required='guest',
)
def get_gallery_stats(args):
    conn = None
    try:
        conn = get_db()
        total = conn.execute(
            "SELECT COUNT(*) as count FROM gallery_images WHERE status='approved'"
        ).fetchone()['count']
        categories = conn.execute(
            "SELECT category, COUNT(*) as count FROM gallery_images "
            "WHERE status='approved' GROUP BY category"
        ).fetchall()
        pending = conn.execute(
            "SELECT COUNT(*) as count FROM gallery_images WHERE status='pending'"
        ).fetchone()['count']
        return json.dumps({
            'total': total,
            'pending': pending,
            'categories': {r['category']: r['count'] for r in categories},
        })
    except Exception as e:
        return json.dumps({'error': str(e)})
    finally:
        if conn:
            conn.close()


@register_tool(
    name='report_issue',
    description='Meldet ein Problem oder einen Mangel im Garten. Erstellt einen Eintrag in der Datenbank.',
    parameters={
        'type': 'object',
        'properties': {
            'title': {
                'type': 'string',
                'description': 'Kurzer Titel des Problems (max 200 Zeichen)',
            },
            'description': {
                'type': 'string',
                'description': 'Ausführliche Beschreibung des Problems',
            },
            'report_type': {
                'type': 'string',
                'enum': ['mangel', 'bug', 'feature', 'feedback'],
                'description': 'Art der Meldung',
            },
        },
        'required': ['title', 'description', 'report_type'],
    },
    role_required='guest',
)
def report_issue(args):
    title = (args.get('title', '') or '')[:200]
    description = (args.get('description', '') or '')[:5000]
    report_type = args.get('report_type', 'mangel')
    reporter_email = args.get('reporter_email', '') or args.get('_user_email', '')
    category = args.get('category', '')

    if not title or not description:
        return json.dumps({'error': 'Titel und Beschreibung sind erforderlich.'})

    conn = None
    try:
        conn = get_db()
        now = datetime.now().isoformat()
        conn.execute(
            "INSERT INTO issue_reports (title, description, report_type, category, "
            "status, reporter_email, created_at) "
            "VALUES (?, ?, ?, ?, 'pending', ?, ?)",
            (title, description, report_type, category, reporter_email, now),
        )
        conn.commit()
        return json.dumps({
            'success': True,
            'message': f'Meldung "{title}" wurde erfolgreich erstellt.',
        })
    except Exception as e:
        return json.dumps({'error': str(e)})
    finally:
        if conn:
            conn.close()


@register_tool(
    name='request_human_help',
    description=('Eskaliert die Konversation an Moritz, wenn der Nutzer mit einem '
                 'Anliegen ansteht, das du nicht selbst beantworten kannst, oder '
                 'wenn er explizit Hilfe von einer realen Person wünscht. Lege NUR '
                 'an, wenn der Nutzer ein konkretes Anliegen hat. Nicht für '
                 'Feedback/Bugs verwenden — dafür report_issue benutzen.'),
    parameters={
        'type': 'object',
        'properties': {
            'topic': {
                'type': 'string',
                'description': ('Kurze Zusammenfassung des Anliegens für Moritz '
                                '(max 500 Zeichen). Auf Deutsch.'),
            },
            'urgency': {
                'type': 'string',
                'enum': ['low', 'normal', 'high'],
                'description': 'Dringlichkeit aus Sicht des Nutzers.',
            },
            'phone': {
                'type': 'string',
                'description': ('Optional: Telefonnummer des Nutzers, falls er '
                                'sie im Chat genannt hat oder du danach gefragt hast.'),
            },
        },
        'required': ['topic'],
    },
    role_required='guest',
)
def request_human_help(args):
    topic = (args.get('topic', '') or '').strip()[:500]
    urgency = args.get('urgency', 'normal')
    if urgency not in ('low', 'normal', 'high'):
        urgency = 'normal'
    phone = (args.get('phone', '') or '').strip()[:50] or None
    user_email = args.get('_user_email', '')
    user_name = args.get('_user_name', '')
    chat_context = args.get('_chat_context', [])

    if not user_email:
        return json.dumps({
            'error': 'Du musst eingeloggt sein, damit Moritz dich erreichen kann.',
        })
    if not topic:
        return json.dumps({
            'error': 'Bitte beschreibe kurz, womit du Hilfe brauchst.',
        })

    try:
        import web_help_service
        request_id = web_help_service.create_help_request(
            user_email=user_email,
            user_name=user_name or None,
            user_phone=phone,
            topic=topic,
            urgency=urgency,
            chat_context=chat_context if isinstance(chat_context, list) else [],
        )
        return json.dumps({
            'success': True,
            'request_id': request_id,
            'message': ('Ich habe Moritz auf Slack benachrichtigt. Er meldet '
                        f'sich per Email an {user_email} bei dir — '
                        'ein Entwurf wird gerade vorbereitet.'),
        })
    except Exception as e:
        return json.dumps({'error': f'Eskalation fehlgeschlagen: {e}'})


# ─── Admin Tools ───────────────────────────────────────────────


@register_tool(
    name='create_task',
    description='Erstellt eine neue Aufgabe im Projektmanagement.',
    parameters={
        'type': 'object',
        'properties': {
            'title': {
                'type': 'string',
                'description': 'Titel der Aufgabe',
            },
            'description': {
                'type': 'string',
                'description': 'Beschreibung der Aufgabe',
            },
            'category': {
                'type': 'string',
                'description': 'Kategorie (z.B. wartung, garten, technik, rechtliches)',
            },
            'priority': {
                'type': 'integer',
                'description': 'Priorität (1=niedrig, 2=mittel, 3=hoch)',
            },
            'due_date': {
                'type': 'string',
                'description': 'Fälligkeitsdatum im Format YYYY-MM-DD',
            },
            'assigned_to': {
                'type': 'string',
                'description': 'Zugewiesene Person (Name oder Email)',
            },
        },
        'required': ['title'],
    },
    role_required='admin',
)
def create_task(args):
    title = (args.get('title', '') or '')[:200]
    if not title:
        return json.dumps({'error': 'Titel ist erforderlich.'})

    description = args.get('description', '')
    category = args.get('category', 'wartung')
    priority = args.get('priority', 2)
    due_date = args.get('due_date', '')
    assigned_to = args.get('assigned_to', '')

    assigned_to_list = json.dumps([assigned_to]) if assigned_to else '[]'

    conn = None
    try:
        conn = get_db()
        now = datetime.now().isoformat()
        cursor = conn.execute(
            "INSERT INTO projects (title, description, category, priority, "
            "due_date, status, assigned_to_list, created_at) "
            "VALUES (?, ?, ?, ?, ?, 'offen', ?, ?)",
            (title, description, category, priority, due_date, assigned_to_list, now),
        )
        conn.commit()
        return json.dumps({
            'success': True,
            'id': cursor.lastrowid,
            'message': f'Aufgabe "{title}" wurde erstellt.',
        })
    except Exception as e:
        return json.dumps({'error': str(e)})
    finally:
        if conn:
            conn.close()


@register_tool(
    name='update_task',
    description='Aktualisiert eine bestehende Aufgabe (Status, Priorität, Beschreibung etc.).',
    parameters={
        'type': 'object',
        'properties': {
            'task_id': {
                'type': 'integer',
                'description': 'ID der Aufgabe',
            },
            'status': {
                'type': 'string',
                'enum': ['offen', 'in_arbeit', 'erledigt', 'abgebrochen'],
                'description': 'Neuer Status',
            },
            'priority': {
                'type': 'integer',
                'description': 'Neue Priorität (1=niedrig, 2=mittel, 3=hoch)',
            },
            'title': {
                'type': 'string',
                'description': 'Neuer Titel',
            },
            'description': {
                'type': 'string',
                'description': 'Neue Beschreibung',
            },
            'due_date': {
                'type': 'string',
                'description': 'Neues Fälligkeitsdatum (YYYY-MM-DD)',
            },
        },
        'required': ['task_id'],
    },
    role_required='admin',
)
def update_task(args):
    task_id = args.get('task_id')
    if not task_id:
        return json.dumps({'error': 'task_id ist erforderlich.'})

    updates = []
    values = []
    for field in ('status', 'priority', 'title', 'description', 'due_date'):
        if field in args and args[field] is not None:
            updates.append(f'{field} = ?')
            values.append(args[field])

    if not updates:
        return json.dumps({'error': 'Keine Änderungen angegeben.'})

    conn = None
    try:
        conn = get_db()
        # Check task exists
        existing = conn.execute(
            'SELECT id, title FROM projects WHERE id = ?', (task_id,)
        ).fetchone()
        if not existing:
            return json.dumps({'error': f'Aufgabe mit ID {task_id} nicht gefunden.'})

        values.append(task_id)
        conn.execute(
            f"UPDATE projects SET {', '.join(updates)} WHERE id = ?",
            values,
        )
        conn.commit()
        return json.dumps({
            'success': True,
            'message': f'Aufgabe "{existing["title"]}" wurde aktualisiert.',
        })
    except Exception as e:
        return json.dumps({'error': str(e)})
    finally:
        if conn:
            conn.close()


@register_tool(
    name='get_overdue_tasks',
    description='Gibt überfällige Aufgaben zurück (Fälligkeitsdatum in der Vergangenheit, noch offen).',
    parameters={'type': 'object', 'properties': {}, 'required': []},
    role_required='admin',
)
def get_overdue_tasks(args):
    conn = None
    try:
        conn = get_db()
        today = datetime.now().strftime('%Y-%m-%d')
        rows = conn.execute(
            "SELECT id, title, status, priority, category, due_date, "
            "assigned_to_list "
            "FROM projects "
            "WHERE due_date < ? AND status IN ('offen', 'in_arbeit') "
            "ORDER BY due_date ASC LIMIT 20",
            (today,),
        ).fetchall()
        if not rows:
            return json.dumps({'info': 'Keine überfälligen Aufgaben.'})
        result = []
        for r in rows:
            d = dict(r)
            # Parse JSON fields
            try:
                d['assigned_to_list'] = json.loads(d.get('assigned_to_list') or '[]')
            except (json.JSONDecodeError, TypeError):
                d['assigned_to_list'] = []
            result.append(d)
        return json.dumps(result)
    except Exception as e:
        return json.dumps({'error': str(e)})
    finally:
        if conn:
            conn.close()


@register_tool(
    name='get_credits_summary',
    description='Gibt eine Zusammenfassung der Wartungsgutschriften zurück (pro Gast und gesamt).',
    parameters={'type': 'object', 'properties': {}, 'required': []},
    role_required='admin',
)
def get_credits_summary(args):
    conn = None
    try:
        conn = get_db()
        # Per-guest summary
        per_guest = conn.execute(
            "SELECT guest_email, "
            "SUM(CASE WHEN type = 'earned' THEN amount ELSE 0 END) as earned, "
            "SUM(CASE WHEN type = 'redeemed' THEN amount ELSE 0 END) as redeemed, "
            "SUM(CASE WHEN type = 'earned' THEN amount ELSE -amount END) as balance "
            "FROM credits GROUP BY guest_email "
            "ORDER BY balance DESC"
        ).fetchall()

        # Totals
        total_earned = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) as total FROM credits WHERE type = 'earned'"
        ).fetchone()['total']
        total_redeemed = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) as total FROM credits WHERE type = 'redeemed'"
        ).fetchone()['total']

        return json.dumps({
            'total_earned': total_earned,
            'total_redeemed': total_redeemed,
            'total_balance': total_earned - total_redeemed,
            'per_guest': [dict(r) for r in per_guest],
        })
    except Exception as e:
        return json.dumps({'error': str(e)})
    finally:
        if conn:
            conn.close()


@register_tool(
    name='manage_inventory',
    description='Verwaltet Inventar-Gegenstände (anlegen, bearbeiten, löschen).',
    parameters={
        'type': 'object',
        'properties': {
            'action': {
                'type': 'string',
                'enum': ['create', 'update', 'delete'],
                'description': 'Aktion: create, update oder delete',
            },
            'item_id': {
                'type': 'integer',
                'description': 'ID des Gegenstands (für update/delete)',
            },
            'room_id': {
                'type': 'integer',
                'description': 'Raum-ID (für create)',
            },
            'name': {
                'type': 'string',
                'description': 'Name des Gegenstands',
            },
            'category': {
                'type': 'string',
                'description': 'Kategorie (Werkzeug, Möbel, Elektro, Garten, etc.)',
            },
            'quantity': {
                'type': 'integer',
                'description': 'Anzahl',
            },
            'condition': {
                'type': 'string',
                'enum': ['neu', 'gut', 'gebraucht', 'defekt'],
                'description': 'Zustand des Gegenstands',
            },
            'notes': {
                'type': 'string',
                'description': 'Zusätzliche Notizen',
            },
        },
        'required': ['action'],
    },
    role_required='admin',
)
def manage_inventory(args):
    action = args.get('action', '')
    conn = None
    try:
        conn = get_db()
        now = datetime.now().isoformat()

        if action == 'create':
            room_id = args.get('room_id')
            name = args.get('name', '')
            if not room_id or not name:
                return json.dumps({'error': 'room_id und name sind erforderlich.'})

            cursor = conn.execute(
                "INSERT INTO inventory_items "
                "(room_id, name, description, category, quantity, condition, notes, "
                "created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    room_id,
                    name,
                    args.get('description', ''),
                    args.get('category', ''),
                    args.get('quantity', 1),
                    args.get('condition', 'gut'),
                    args.get('notes', ''),
                    now,
                    now,
                ),
            )
            conn.commit()
            return json.dumps({
                'success': True,
                'id': cursor.lastrowid,
                'message': f'Gegenstand "{name}" wurde angelegt.',
            })

        elif action == 'update':
            item_id = args.get('item_id')
            if not item_id:
                return json.dumps({'error': 'item_id ist erforderlich für update.'})

            existing = conn.execute(
                'SELECT id, name FROM inventory_items WHERE id = ?', (item_id,)
            ).fetchone()
            if not existing:
                return json.dumps({'error': f'Gegenstand mit ID {item_id} nicht gefunden.'})

            updates = []
            values = []
            for field in ('name', 'category', 'quantity', 'condition', 'notes', 'description'):
                if field in args and args[field] is not None:
                    updates.append(f'{field} = ?')
                    values.append(args[field])
            if 'room_id' in args:
                updates.append('room_id = ?')
                values.append(args['room_id'])

            if not updates:
                return json.dumps({'error': 'Keine Änderungen angegeben.'})

            updates.append('updated_at = ?')
            values.append(now)
            values.append(item_id)

            conn.execute(
                f"UPDATE inventory_items SET {', '.join(updates)} WHERE id = ?",
                values,
            )
            conn.commit()
            return json.dumps({
                'success': True,
                'message': f'Gegenstand "{existing["name"]}" wurde aktualisiert.',
            })

        elif action == 'delete':
            item_id = args.get('item_id')
            if not item_id:
                return json.dumps({'error': 'item_id ist erforderlich für delete.'})

            existing = conn.execute(
                'SELECT id, name FROM inventory_items WHERE id = ?', (item_id,)
            ).fetchone()
            if not existing:
                return json.dumps({'error': f'Gegenstand mit ID {item_id} nicht gefunden.'})

            conn.execute('DELETE FROM inventory_items WHERE id = ?', (item_id,))
            conn.commit()
            return json.dumps({
                'success': True,
                'message': f'Gegenstand "{existing["name"]}" wurde gelöscht.',
            })

        else:
            return json.dumps({'error': f'Unbekannte Aktion: {action}'})

    except Exception as e:
        return json.dumps({'error': str(e)})
    finally:
        if conn:
            conn.close()
