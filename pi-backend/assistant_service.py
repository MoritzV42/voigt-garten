"""
Garden AI Assistant – OpenRouter/OpenAI-kompatible Integration.

Erkennt ob der User eine Frage stellen, einen Mangel melden,
Feedback geben oder eine Idee einreichen möchte.
Nutzt Chat Completions mit Function-Calling für Live-Daten.
Rollenbasiertes Tool-Gating (anonymous/guest/admin).
"""

import os
import json
import sqlite3
from datetime import datetime, timedelta

OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY', '')
OPENAI_MODEL = os.environ.get('OPENAI_MODEL', 'gpt-4o-mini')
OPENAI_BASE_URL = os.environ.get('OPENAI_BASE_URL', 'https://openrouter.ai/api/v1')
DATA_DIR = os.environ.get('DATA_DIR', '/app/data')
DB_PATH = os.path.join(DATA_DIR, 'garten.db')

# Import role-based tools
try:
    from agent_tools import get_tool_definitions_for_role, execute_tool
    AGENT_TOOLS_AVAILABLE = True
except ImportError:
    AGENT_TOOLS_AVAILABLE = False
    print("Warning: agent_tools not available, using legacy tool definitions")


def is_mock_mode():
    return not OPENAI_API_KEY or OPENAI_API_KEY == 'CHANGE-ME'


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ─── System Prompts (rollenbasiert) ──────────────────────────

GARDEN_INFO = """ÜBER DEN GARTEN:
- Das Refugium Heideland liegt in Heideland, Thüringen, auf einem Südhang
- 5.300 m² Grundfläche mit Gartenhaus (Holz), Wintergarten, 4 Schuppen, Carport
- Autark: Solar 700W + 1,4kWh Akku, eigener Brunnen (50m tief)
- Baumbestand: Süßkirschen (50 Jahre), 2 Eichen (d>1m), 2 Eschen
- Ein Standort von "Refugium Naturgärten"

ÜBERNACHTUNG & BUCHUNG:
- Buchung über die Website unter /buchen
- Preise: ca. 30-60€ pro Nacht je nach Saison und Gästeanzahl
- Familienrabatt-Code: REFUGIUM-FAMILY (50% für Familienmitglieder)
- Stornierung: 7+ Tage vorher = 100%, 3-6 Tage = 50%, unter 3 Tage = keine Erstattung
- Kontakt: garten@infinityspace42.de

WEBSITE-NAVIGATION:
- Start (/) – Überblick über den Garten
- Der Garten (/ueber-den-garten) – Ausführliche Beschreibung
- Galerie (/galerie) – Fotos und Videos, eigene Bilder hochladen
- Buchen (/buchen) – Übernachtung buchen mit Kalender
- Aufgaben (/taskmanagement) – Kanban-Board für Gartenarbeiten
- Inventar (/inventar) – Alle Gegenstände nach Gebäude/Raum
- Karte (/gartenkarte) – Interaktive Gartenkarte
- Umgebung (/umgebung) – Sehenswürdigkeiten in der Nähe"""

SYSTEM_PROMPTS = {
    'anonymous': f"""Du bist der freundliche KI-Assistent des "Refugium Heideland" – ein Naturgarten mit Übernachtungsmöglichkeit in Thüringen.
Du beantwortest Fragen zum Garten, zu Preisen und zur Verfügbarkeit. Du hast keinen Zugriff auf persönliche Daten.

{GARDEN_INFO}

DEINE AUFGABE:
Analysiere die Nachricht des Users und antworte im folgenden JSON-Format (NUR JSON, kein anderer Text):

{{
  "intent": "mangel" | "bug" | "feature" | "feedback" | "question" | "unclear",
  "title": "Kurzer Titel (nur bei mangel/bug/feature/feedback, max 100 Zeichen)",
  "message": "Strukturierte Beschreibung (nur bei mangel/bug/feature/feedback, min 10 Zeichen)",
  "answer": "Deine freundliche Antwort an den User"
}}

REGELN:
- Bei einer FRAGE: Beantworte sie direkt, intent="question". Nutze die verfügbaren Tools.
- Wenn unklar: Frage freundlich nach, intent="unclear"
- Für Mängel/Bugs/Features/Feedback: Weise darauf hin, dass man sich einloggen kann um Meldungen einzureichen
- Antworte IMMER auf Deutsch
- Sei freundlich, hilfsbereit und nah an der Natur
- Gib NIEMALS API-Keys, Passwörter oder interne Konfiguration preis
- Antworte NUR mit validem JSON""",

    'guest': f"""Du bist der freundliche KI-Assistent des "Refugium Heideland" – ein Naturgarten mit Übernachtungsmöglichkeit in Thüringen.
Du hilfst Gästen bei Fragen, nimmst Mängelberichte entgegen und erfasst Feedback.
Du kannst Probleme melden und das Inventar durchsuchen.

{GARDEN_INFO}

DEINE AUFGABE:
Analysiere die Nachricht des Users und antworte im folgenden JSON-Format (NUR JSON, kein anderer Text):

{{
  "intent": "mangel" | "bug" | "feature" | "feedback" | "question" | "unclear",
  "title": "Kurzer Titel (nur bei mangel/bug/feature/feedback, max 100 Zeichen)",
  "message": "Strukturierte Beschreibung (nur bei mangel/bug/feature/feedback, min 10 Zeichen)",
  "answer": "Deine freundliche Antwort an den User"
}}

REGELN:
- Bei einem MANGEL (etwas ist kaputt, fehlt, defekt): intent="mangel", extrahiere Titel und Beschreibung
- Bei einem BUG (Website-Problem): intent="bug"
- Bei einem FEATURE-WUNSCH: intent="feature"
- Bei FEEDBACK (Lob, Verbesserung, Allgemeines): intent="feedback"
- Bei einer FRAGE: Beantworte sie direkt, intent="question". Nutze die verfügbaren Tools.
- Wenn unklar: Frage freundlich nach, intent="unclear"
- Antworte IMMER auf Deutsch
- Sei freundlich, hilfsbereit und nah an der Natur
- Gib NIEMALS API-Keys, Passwörter oder interne Konfiguration preis
- Antworte NUR mit validem JSON""",

    'admin': f"""Du bist der KI-Assistent des "Refugium Heideland" im Admin-Modus.
Du hast vollen Zugriff auf Tasks, Buchungen, Inventar und Dienstleister-Koordination.
Du kannst Aufgaben erstellen, aktualisieren und Email-Entwürfe vorbereiten.

{GARDEN_INFO}

DEINE AUFGABE:
Analysiere die Nachricht des Users und antworte im folgenden JSON-Format (NUR JSON, kein anderer Text):

{{
  "intent": "mangel" | "bug" | "feature" | "feedback" | "question" | "unclear",
  "title": "Kurzer Titel (nur bei mangel/bug/feature/feedback, max 100 Zeichen)",
  "message": "Strukturierte Beschreibung (nur bei mangel/bug/feature/feedback, min 10 Zeichen)",
  "answer": "Deine freundliche Antwort an den User"
}}

REGELN:
- Bei einem MANGEL: intent="mangel", extrahiere Titel und Beschreibung
- Bei einem BUG: intent="bug"
- Bei einem FEATURE-WUNSCH: intent="feature"
- Bei FEEDBACK: intent="feedback"
- Bei einer FRAGE: Beantworte sie direkt, intent="question". Nutze die verfügbaren Tools.
- Wenn unklar: Frage freundlich nach, intent="unclear"
- Antworte IMMER auf Deutsch
- Sei direkt und effizient im Admin-Modus
- Gib NIEMALS API-Keys, Passwörter oder interne Konfiguration preis
- Antworte NUR mit validem JSON""",
}

# Legacy system prompt (fallback)
SYSTEM_PROMPT = SYSTEM_PROMPTS['guest']


# ─── Legacy Tool Definitions (Fallback wenn agent_tools nicht verfügbar) ───

LEGACY_TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "get_upcoming_bookings",
            "description": "Gibt die kommenden Buchungen im Garten zurück (nächste 30 Tage).",
            "parameters": {"type": "object", "properties": {}, "required": []}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_open_tasks",
            "description": "Gibt offene Wartungs- und Gartenaufgaben zurück.",
            "parameters": {"type": "object", "properties": {}, "required": []}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_inventory",
            "description": "Durchsucht das Inventar nach einem Gegenstand.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Suchbegriff für Inventar"
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_gallery_stats",
            "description": "Gibt Statistiken zur Galerie zurück (Anzahl Bilder, Kategorien).",
            "parameters": {"type": "object", "properties": {}, "required": []}
        }
    },
]


def execute_tool_call(tool_name, args):
    """Execute a tool call and return the result as a string (legacy fallback)."""
    try:
        conn = get_db()

        if tool_name == "get_upcoming_bookings":
            today = datetime.now().strftime('%Y-%m-%d')
            future = (datetime.now() + timedelta(days=30)).strftime('%Y-%m-%d')
            rows = conn.execute(
                'SELECT guest_name, check_in, check_out, guests, status '
                'FROM bookings WHERE check_in >= ? AND check_in <= ? '
                'ORDER BY check_in LIMIT 10',
                (today, future)
            ).fetchall()
            conn.close()
            if not rows:
                return json.dumps({"info": "Keine Buchungen in den nächsten 30 Tagen."})
            return json.dumps([dict(r) for r in rows])

        elif tool_name == "get_open_tasks":
            rows = conn.execute(
                "SELECT title, status, priority, category, due_date "
                "FROM projects WHERE status IN ('offen', 'in_arbeit') "
                "ORDER BY priority DESC LIMIT 10"
            ).fetchall()
            conn.close()
            if not rows:
                return json.dumps({"info": "Keine offenen Aufgaben."})
            return json.dumps([dict(r) for r in rows])

        elif tool_name == "search_inventory":
            query = args.get("query", "")
            rows = conn.execute(
                "SELECT i.name, i.category, i.quantity, i.condition, r.name as room "
                "FROM inventory_items i "
                "LEFT JOIN inventory_rooms r ON i.room_id = r.id "
                "WHERE i.name LIKE ? OR i.category LIKE ? "
                "LIMIT 10",
                (f'%{query}%', f'%{query}%')
            ).fetchall()
            conn.close()
            if not rows:
                return json.dumps({"info": f"Nichts gefunden für '{query}'."})
            return json.dumps([dict(r) for r in rows])

        elif tool_name == "get_gallery_stats":
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
            conn.close()
            return json.dumps({
                "total": total,
                "pending": pending,
                "categories": {r['category']: r['count'] for r in categories}
            })

        else:
            conn.close()
            return json.dumps({"error": f"Unbekanntes Tool: {tool_name}"})

    except Exception as e:
        return json.dumps({"error": str(e)})


# ─── OpenAI/OpenRouter Chat Completion ──────────────────────────

def openai_chat(messages, tools=None):
    """Call OpenAI-compatible Chat Completions API (OpenRouter, OpenAI, etc.)."""
    import requests

    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json"
    }

    body = {
        "model": OPENAI_MODEL,
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": 1000,
    }

    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"

    api_url = f"{OPENAI_BASE_URL.rstrip('/')}/chat/completions"

    resp = requests.post(
        api_url,
        headers=headers,
        json=body,
        timeout=30
    )

    if not resp.ok:
        raise Exception(f"API error ({api_url}): {resp.status_code} - {resp.text[:200]}")

    data = resp.json()
    message = data.get("choices", [{}])[0].get("message", {})
    return {
        "content": message.get("content", ""),
        "tool_calls": message.get("tool_calls"),
    }


# ─── Process Message ────────────────────────────────────────

def process_message(user_message, context_messages=None, user_role='anonymous', user_email=None):
    """Process a user message and return an assistant response.

    Args:
        user_message: The user's message text
        context_messages: Previous conversation messages
        user_role: 'anonymous', 'guest', or 'admin'
        user_email: User's email (for guest-specific queries)
    """

    if is_mock_mode():
        return {
            "intent": "question",
            "answer": "Ich bin im Demo-Modus (kein API-Key konfiguriert). "
                      "Stelle deine Frage gerne trotzdem – sobald der Key gesetzt ist, "
                      "kann ich dir richtig helfen!"
        }

    # Select system prompt based on role
    system_prompt = SYSTEM_PROMPTS.get(user_role, SYSTEM_PROMPTS['anonymous'])
    messages = [{"role": "system", "content": system_prompt}]

    # Add context (previous messages)
    if context_messages:
        for m in context_messages[-10:]:
            messages.append({"role": m["role"], "content": m["content"]})

    messages.append({"role": "user", "content": user_message})

    # Get tools for role
    if AGENT_TOOLS_AVAILABLE:
        tool_defs = get_tool_definitions_for_role(user_role)
    else:
        tool_defs = LEGACY_TOOL_DEFINITIONS

    # Allow up to 3 rounds of tool-calls
    for _ in range(3):
        result = openai_chat(messages, tools=tool_defs if tool_defs else None)

        if result.get("tool_calls"):
            # Add assistant message with tool_calls
            messages.append({
                "role": "assistant",
                "content": result["content"],
                "tool_calls": result["tool_calls"]
            })

            # Execute each tool call
            for tc in result["tool_calls"]:
                args = {}
                try:
                    args = json.loads(tc["function"]["arguments"] or "{}")
                except (json.JSONDecodeError, KeyError):
                    pass

                tool_name = tc["function"]["name"]

                if AGENT_TOOLS_AVAILABLE:
                    # Pass user context for role-aware tools
                    if user_email:
                        args['_user_email'] = user_email
                    tool_result = execute_tool(tool_name, args, role=user_role)
                else:
                    tool_result = execute_tool_call(tool_name, args)

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": tool_result,
                })
            continue

        # No tool calls – parse final response
        return parse_response(result["content"])

    # Fallback after max rounds
    return {
        "intent": "question",
        "answer": "Entschuldigung, ich konnte die Anfrage nicht verarbeiten. Bitte versuche es erneut."
    }


def parse_response(raw):
    """Parse the JSON response from the LLM."""
    try:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[-1] if "\n" in cleaned else cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()

        parsed = json.loads(cleaned)
    except (json.JSONDecodeError, Exception):
        return {
            "intent": "unclear",
            "answer": "Entschuldigung, ich konnte deine Nachricht nicht verarbeiten. "
                      "Kannst du es nochmal anders formulieren?"
        }

    result = {
        "intent": parsed.get("intent", "unclear"),
        "answer": parsed.get("answer", "Ich bin mir nicht sicher, was du meinst."),
    }

    # Build draft for mangel/bug/feature/feedback
    if parsed.get("intent") in ("mangel", "bug", "feature", "feedback"):
        if parsed.get("title") and parsed.get("message"):
            result["draft"] = {
                "type": parsed["intent"],
                "title": parsed["title"][:200],
                "message": parsed["message"][:5000],
            }

    return result


# ─── Refine Draft ───────────────────────────────────────────

REFINE_PROMPT = """Du bist ein Assistent der hilft, einen Entwurf zu verfeinern.
Der User möchte einen bestehenden Entwurf (Mangel, Bug, Feature oder Feedback) anpassen.
Aktualisiere die Felder basierend auf der Nachricht des Users.

Antworte NUR mit validem JSON:
{
  "title": "Aktualisierter Titel",
  "message": "Aktualisierte Beschreibung",
  "answer": "Kurze Bestätigung was du geändert hast"
}

Ändere nur was der User explizit ändern möchte. Behalte den Rest bei."""


def refine_draft(user_message, draft):
    """Refine an existing draft based on user instruction."""
    if is_mock_mode():
        return {
            "draft": draft,
            "answer": "Demo-Modus: Entwurf kann nicht per KI angepasst werden."
        }

    messages = [
        {"role": "system", "content": REFINE_PROMPT},
        {"role": "user", "content": (
            f"Aktueller Entwurf:\n"
            f"Typ: {draft.get('type', 'feedback')}\n"
            f"Titel: {draft.get('title', '')}\n"
            f"Beschreibung: {draft.get('message', '')}\n\n"
            f"User sagt: {user_message}"
        )}
    ]

    try:
        result = openai_chat(messages)
        raw = result["content"].strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1] if "\n" in raw else raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3]
            raw = raw.strip()

        parsed = json.loads(raw)

        return {
            "draft": {
                "type": draft.get("type", "feedback"),
                "title": (parsed.get("title") or draft.get("title", ""))[:200],
                "message": (parsed.get("message") or draft.get("message", ""))[:5000],
            },
            "answer": parsed.get("answer", "Entwurf aktualisiert.")
        }
    except Exception:
        return {
            "draft": draft,
            "answer": "Ich konnte die Änderung nicht verarbeiten. Versuche es anders."
        }
