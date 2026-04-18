# Garten-Agent F.3 Chat-Layer — Konzept (2026-04-18)

**Erstellt:** 2026-04-18
**Worker:** `chat-christoph` (F.3-Konzept)
**Folge-Worker:** F.3-Implementation (nach Moritz-Freigabe)
**Vorgänger:** F.1 Konzept (`AGENT_CONCEPT.md`) + F.2 Implementation (Eskalations-Loop heute live)
**Pfad-Mirror:** `~/stacks/voigt-garten/docs/GARTEN_AGENT_CHAT_CONCEPT.md` (IS42) ⇄ später `IS42/Dokumentation/.claude/coo/sync/SYNC_VOIGT_GARTEN_AGENT.md` (COO-Visibility)

---

## 1. Vision

Der Garten-Agent (Phase F.1/F.2) ist heute **output-only** — er postet Stufe-1/2/3-Eskalationen in `#refugium-heideland-management`, mailt Dienstleister, DMt Moritz. Er liest nichts, antwortet nichts.

F.3 macht den Bot **dialogfähig**: Wenn Moritz (oder jemand mit Channel-Zugriff) `@GartenBot` erwähnt — entweder im Channel oder als Thread-Reply — soll der Bot antworten können. Sinnvolle Use-Cases:

- *„@GartenBot was ist mit Task #142?"* → Bot liest Task-Status, aktive Eskalation, letzte Aktionen, schreibt Zusammenfassung
- *„@GartenBot cancel Eskalation für #142, ich hab den Elektriker gerade angerufen"* → (Phase 3b) Bot markiert Eskalation als cancelled
- *Im Thread eines Stufe-3-Alerts:* „@GartenBot schon erledigt, bitte stoppen" → Bot versteht Thread-Kontext, cancelt Eskalation
- *„@GartenBot welche Dienstleister haben wir für Wasser?"* → Bot listet aus `service_providers`

Die **Chat-Engine ist Claude CLI** (subprocess-Aufruf), nicht OpenAI/OpenRouter. Grund: Konsistenz zu InfiniLoop, kostenlos im MAX-Plan, keine neue API-Key-Umgebung. Kein passives Mithören (kein `message.channels`-Event-Subscribe) — der Bot liest nur, wenn er explizit erwähnt wird.

---

## 2. Abgrenzung zu F.1/F.2

### Was ist schon gebaut (F.2, heute 2026-04-18 live)

| Komponente | Datei | Zweck |
|---|---|---|
| Eskalations-Worker | `pi-backend/agent_worker.py` | Scan-Loop alle 6h über überfällige Tasks |
| Eskalations-Logik | `pi-backend/agent_escalation.py` | 3-Stufen-Entscheidung + Execute |
| Slack-Output | `pi-backend/slack_service.py` | `post_channel`, `send_dm`, `build_escalation_blocks` |
| COO-API | `pi-backend/agent_routes.py` | `/api/garten/agent/status`, `/trigger-escalation/<id>`, `/cancel-escalation/<id>`, `/run-now` |
| Provider-Mail | `pi-backend/email_service.py` (`send_provider_reminder`) | Stufe-2-Email |
| Slack-App | `GartenBot` (A0ATNG554JJ, Bot-User U0AUJTS5F5W) | Scopes: `chat:write`, `chat:write.public`, `im:write`, `users:read`, `users:read.email` |

### Was F.3 dazubaut

| Komponente | Neue Datei | Zweck |
|---|---|---|
| Slack-Event-Empfang | `pi-backend/chat_handler.py` | HTTP-Route für `app_mention`, Signing-Verify, Dedupe, Async-Dispatch |
| Claude-CLI-Wrapper | `pi-backend/claude_cli_backend.py` | Subprocess-Aufruf `claude -p`, Prompt-Assembly, Output-Parsing, Timeout |
| Context-Fetcher | `pi-backend/chat_context.py` | `conversations.replies` / `conversations.history` API-Calls |
| Tool-Definitionen (Phase 3b) | `pi-backend/chat_tools.py` | Read-Tools für Tasks/Provider, später Write-Tools (Eskalation cancel etc.) |
| Route-Erweiterung | `pi-backend/agent_routes.py` | Neuer Endpoint `POST /api/garten/agent/slack-events` |
| Slack-App-Update | — (manuell via Slack App Config) | Event-Subscription aktivieren, Scopes ergänzen, Re-Install |

F.3 ändert **keine** bestehende F.2-Logik. Der Eskalations-Loop läuft unverändert weiter.

---

## 3. InfiniLoop als Referenz-Implementierung

Die F.3-Architektur ist ein **vereinfachter, spezialisierter Klon** der InfiniLoop-Chat-Logik. Konkrete Referenzen (alle IS42-Pfade, relativ zu `~/stacks/infiniloop/`):

### 3.1 Mention-Entry-Point
**Datei:** `services/slack_events_handler.py` Zeilen 124–150 (`_handle_app_mention`)

Kernidee: InfiniLoop empfängt Events via **Socket Mode** (nicht HTTP). Wenn `event.type == "app_mention"`:
1. Mention-Text wird bereinigt (Bot-Mention-Markup `<@U...>` entfernt)
2. Context-Dict wird gebaut: `channel_id`, `user_id`, `message_ts`, `thread_ts`, `text`
3. Delegation an `services.realtime_dispatcher.on_mention(...)`

**Wichtig:** InfiniLoop ACKt Slack **sofort** (`send_socket_mode_response`) BEVOR der Handler läuft, damit Slack keine Retries schickt (Socket-Mode-Pendant zum 3s-HTTP-ACK-Timeout).

### 3.2 Thread-/Channel-History-Fetch
**Datei:** `services/summary_handler.py` Zeilen 105–142 (`_fetch_channel_messages`, `_fetch_thread_messages`)

Muster:
```python
# Thread:
slack._conversations_replies(channel=channel_id, ts=thread_ts, limit=min(limit, MAX_MESSAGES))
# Channel (ohne Thread):
slack._conversations_history(channel=channel_id, limit=min(limit, MAX_MESSAGES))
```
Zwei verschiedene Slack-Web-API-Calls. Konstanten: `MAX_MESSAGES = 80`, `MAX_INPUT_CHARS = 8000`.

### 3.3 Claude-CLI-Aufruf
**Datei:** `services/summary_handler.py` Zeilen 180–207 (`_run_cli`) — die **schlankste** Variante in InfiniLoop, perfekt als Vorlage für F.3

```python
result = subprocess.run(
    [cli_path, "-p", "--model", "claude-sonnet-4-6"],
    input=prompt,
    capture_output=True,
    text=True,
    timeout=CLI_TIMEOUT_SECONDS,   # 120s
    cwd="/tmp",
)
if result.returncode != 0:
    return None
return (result.stdout or "").strip() or None
```

Flags:
- `-p` — Print-Mode (non-interactive)
- `--model claude-sonnet-4-6` — fixes Modell
- `cwd=/tmp` — keine Repo-Bindung (Chat braucht kein Repo)
- `input=prompt` via stdin

Es gibt eine zweite, mächtigere Variante in `services/agent_executor.py` Zeile 577 (`_run_claude_cli`) — die nutzt `--allowedTools Edit,Write,Read,Glob,Grep` und ist für Code-Fixes gedacht. Für F.3-Chat ist die `summary_handler`-Variante die richtige Vorlage.

### 3.4 Prompt-Assembly
**Datei:** `services/summary_handler.py` Zeilen 144–178 (`_build_prompt`)

Struktur:
```
Du bist der Project-Lead-Bot. ...

## Scope
{scope_label}

## Nutzerwunsch
{user_question}

## Nachrichten
{formatted_slack_messages}

## Ausgabe-Format
...
```

Messages werden formatiert als `[2026-04-18 14:30] <@U123>: text...` (auf 400 Chars pro Msg gekürzt, dann Block auf `MAX_INPUT_CHARS = 8000` gekürzt — **tail**, nicht head).

### 3.5 Signing-Secret-Verifizierung (nur HTTP-Route)
**Datei:** `routes/slack_interactivity.py` Zeilen 15–27 (`verify_slack_signature`)

Standard-Slack-HMAC-SHA256:
```python
base = f"v0:{timestamp}:".encode() + body_bytes
expected = "v0=" + hmac.new(secret.encode(), base, hashlib.sha256).hexdigest()
return hmac.compare_digest(expected, signature)
```
Plus Timestamp-Check (max 5 Min Abweichung, gegen Replay).

### 3.6 Dedupe-Strategie
InfiniLoop nutzt Socket-Mode → ACK sofort → keine Retries → **keine explizite Event-ID-Dedupe nötig**. Der einzige Retry-Guard ist Zeile 83–90 in `slack_events_handler.py`:
```python
retry_attempt = getattr(req, "retry_attempt", 0) or 0
if retry_attempt:
    return  # Original-Event wurde bereits in Bearbeitung uebergeben
```

F.3 nutzt HTTP (kein Socket Mode), deshalb **muss** dort explizite Dedupe gebaut werden — siehe §7.2.

### 3.7 Async-Antwort-Flow
InfiniLoop antwortet **asynchron**: `on_mention` triggert `route()`, das den Chat-Handler in einem Thread startet. Die eigentliche Antwort geht später via `slack.client.chat_postMessage(channel=..., thread_ts=...)` raus. Das ist kompatibel mit Claude-CLI-Latenzen (5–30 s).

---

## 4. Architektur

### 4.1 Komponenten-Diagramm

```
Slack (Mention in #refugium-heideland-management)
    │
    ▼
Slack Events API (HTTPS)
    │  POST /api/garten/agent/slack-events
    │  Headers: X-Slack-Signature, X-Slack-Request-Timestamp
    ▼
┌─────────────────────────────────────────────┐
│ chat_handler.py (neu)                        │
│  1. url_verification Challenge (Setup)       │
│  2. HMAC-Signing-Verify                      │
│  3. Dedupe via event_id                      │
│  4. ACK 200 (< 3 s !)                        │
│  5. Thread-Dispatch an chat worker           │
└───────────────┬─────────────────────────────┘
                │ (async, daemon thread)
                ▼
┌─────────────────────────────────────────────┐
│ chat_context.py (neu)                        │
│  - Thread? → conversations.replies           │
│  - Channel? → conversations.history(last 5)  │
│  - Gibt List[dict] mit Slack-Messages zurück │
└───────────────┬─────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────┐
│ claude_cli_backend.py (neu)                  │
│  1. Sanitize Input via injection_guard       │
│  2. DB-Kontext laden (offene Tasks,          │
│     aktive Eskalationen, Provider)           │
│  3. Prompt zusammenbauen                     │
│  4. subprocess.run([claude, -p, ...])        │
│  5. Output parsen, auf 2000 Chars kürzen     │
└───────────────┬─────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────┐
│ slack_service.post_channel (bestehend)       │
│  → chat.postMessage(channel, thread_ts)       │
└─────────────────────────────────────────────┘
```

### 4.2 Datenfluss — ein Beispiel

**Moritz postet in Thread eines Stufe-3-Alerts:** *„@GartenBot schon erledigt, Konny hat angerufen"*

1. Slack sendet `POST /api/garten/agent/slack-events` mit `event.type == "app_mention"`, `event.thread_ts = "1745234567.12"`
2. `chat_handler.py` verifiziert HMAC, prüft `event_id` in Dedupe-Cache, ACKt 200
3. Worker-Thread läuft:
   - `chat_context.fetch_thread(channel, thread_ts)` → lädt 10 Thread-Messages inkl. des ursprünglichen Stufe-3-Alerts
   - `claude_cli_backend.answer(user_text, thread_ctx, channel_ctx=None)`:
     - Sanitize Input (Injection-Guard)
     - DB-Kontext: Task-Details von Task #142, aktuelle `agent_escalation_state`
     - Prompt: System + DB-Snapshot + Thread-Messages + User-Frage
     - `subprocess.run([claude, -p, --model, ...])` mit 60 s Timeout
   - Output z.B.: *„Verstanden. Ich habe keine Berechtigung, Eskalationen zu schliessen (Phase 3b). Bitte klicke im COO-Dashboard auf ‚Abschliessen' oder POSTe an `/api/garten/agent/cancel-escalation/<id>` mit X-COO-Secret."*
4. `slack_service.post_channel(text=..., channel=channel, thread_ts=thread_ts)` → Antwort erscheint als Thread-Reply

### 4.3 Thread-Kontext-Tiefe (Entscheidung)

Moritz' Frage: *„letzten 5 oder reicht wie InfiniLoop?"*

**Entscheidung basierend auf InfiniLoop-Analyse:**
- **Mention im Thread** (`thread_ts` ist gesetzt und != `message_ts`): **ganzer Thread, Limit 50 Replies** (wie InfiniLoop `_fetch_thread_messages`). Threads sind meist kurz (5–15 Replies), und wenn der Bot im Thread antwortet, braucht er vollen Kontext — auch den ursprünglichen Alert am Thread-Start.
- **Mention im Channel** (kein `thread_ts`): **letzte 10 Channel-Messages** (statt 5, wie ursprünglich vorgeschlagen). Grund: InfiniLoop nutzt per Default 20 — 10 ist ein guter Kompromiss zwischen Kontext und Prompt-Size. Alle Stufe-1/2/3-Eskalations-Posts liegen im selben Channel, Kontext ist oft hilfreich.

Beide Limits sind via Env-Var überschreibbar: `GARTEN_CHAT_THREAD_LIMIT=50`, `GARTEN_CHAT_CHANNEL_LIMIT=10`.

---

## 5. Slack-App-Setup für F.3

### 5.1 Änderungen an GartenBot (A0ATNG554JJ)

**Scopes ergänzen (OAuth & Permissions):**
- `app_mentions:read` — **Pflicht**, sonst kommen keine `app_mention`-Events
- `channels:history` — für `conversations.history` (Channel-Kontext bei Mention ausserhalb Thread)
- `im:history` — optional, falls wir DMs an den Bot erlauben wollen (Phase 3c)
- `reactions:write` — optional, Bot kann :eyes: setzen als „lese gerade"-Signal
- *Behalten:* `chat:write`, `chat:write.public`, `im:write`, `users:read`, `users:read.email`

**Event-Subscriptions:**
- Request URL: `https://garten.infinityspace42.de/api/garten/agent/slack-events`
- **Slack verschickt `url_verification`-Challenge** bei Aktivierung — der Endpoint muss `challenge` als `text/plain` zurückgeben (siehe §7.1)
- Subscribe to bot events: **`app_mention`** (Pflicht). Kein `message.channels` — das wäre passives Mithören.

**Re-Install im Workspace:**
Bei Scope-Änderungen zwingt Slack ein Re-Install. Moritz muss:
1. `Install to Workspace` klicken → neuer Auth-Flow
2. Bot-Token (`xoxb-...`) ggf. neu → in `~/stacks/voigt-garten/.env` als `GARTEN_BOT_TOKEN` updaten
3. Container restart: `docker compose restart voigt-garten-app`

### 5.2 Env-Vars (in `~/stacks/voigt-garten/.env`)

| Variable | Wert | Zweck |
|---|---|---|
| `GARTEN_BOT_TOKEN` | (schon gesetzt) | OAuth-Bot-Token |
| `GARTEN_SLACK_SIGNING_SECRET` | `21ddfe0107609c89b70c87bcceacf762` | HMAC-Verify für `/slack-events` |
| `GARTEN_SLACK_BOT_USER_ID` | `U0AUJTS5F5W` | Zum Entfernen des `<@U0AUJTS5F5W>`-Markup aus Mention-Text |
| `GARTEN_CHAT_ENABLED` | `true` | Kill-Switch |
| `GARTEN_CHAT_MODEL` | `claude-sonnet-4-6` | Claude-Modell |
| `GARTEN_CHAT_THREAD_LIMIT` | `50` | Max Thread-Replies |
| `GARTEN_CHAT_CHANNEL_LIMIT` | `10` | Max Channel-History bei Non-Thread-Mention |
| `GARTEN_CHAT_CLI_TIMEOUT` | `60` | Claude-CLI-Timeout (sek) |
| `GARTEN_CHAT_RATE_LIMIT_PER_HOUR` | `30` | Max Mentions pro User/Channel |
| `CLAUDE_CLI_PATH` | `/usr/local/bin/claude` | Pfad zur CLI im Container (siehe §6) |

---

## 6. Claude-CLI-Backend

### 6.1 Container-Verfügbarkeit — **wichtigste offene Frage**

Verifiziert am 2026-04-18:
```bash
ssh is42 "docker exec voigt-garten-app which claude"
# → nichts (exit 1)
```

Die Claude CLI ist im `voigt-garten-app`-Image **nicht installiert**. Zwei Lösungs-Varianten:

#### Variante A: CLI im Container installieren (empfohlen)

`Dockerfile` erweitern — analog zu InfiniLoop:

```dockerfile
# Node.js + Claude CLI
RUN apt-get update && apt-get install -y --no-install-recommends nodejs npm && \
    npm install -g @anthropic-ai/claude-code && \
    apt-get clean && rm -rf /var/lib/apt/lists/*
```

**Kostenabschätzung:**
- Image-Größe: +~250 MB (Node + npm + Claude CLI)
- Build-Zeit: +~60 s
- Rebuild-Frequenz: niedrig (nur bei Dockerfile-Change)

**Auth:** Claude CLI authentifiziert sich im Container. Entweder:
- `ANTHROPIC_API_KEY` im Container-Env (einfach, aber kostet per API)
- **ODER** Claude MAX Plan via Login-Flow einmal im Container (`claude login` → OAuth → Token im `~/.claude/` Home persistiert) → Volume-Mount `/root/.claude` nötig, damit Token Rebuild überlebt

Moritz' MAX-Plan-Token ist bereits auf IS42 unter `/root/.claude/` (InfiniLoop nutzt das). Das Volume kann im `voigt-garten-app`-Container **read-only** gemountet werden:
```yaml
volumes:
  - /root/.claude:/root/.claude:ro
```

→ **Empfehlung:** Variante A + Volume-Mount des MAX-Plan-Credentials-Verzeichnisses.

#### Variante B: HTTP-Proxy zum Host-claude

Auf dem Host läuft ein mini-Flask-Service auf Port 5099, der `POST /invoke` mit `{prompt, model}` annimmt und via `subprocess` das Host-`claude` aufruft. Container ruft via `http://host.docker.internal:5099/invoke` an.

**Nachteile:** zusätzlicher Service zum Betreiben, zusätzliche Fail-Mode, Auth/Firewall-Regeln.

→ **Nur Fallback**, falls Variante A an Volume-Mount scheitert.

### 6.2 Prompt-Assembly

Prompt-Skelett (in `claude_cli_backend.build_prompt(...)`):

```
Du bist @GartenBot — der operative Assistent für den Refugium-Heideland-Garten.
Antworte auf Deutsch mit echten Umlauten (ä/ö/ü/ß). Kurz, sachlich, max. 8 Zeilen.
Keine erfundenen Fakten — wenn du etwas nicht weisst, sag es explizit.

## Rolle
- Du bist Read-Only: Du darfst Tasks/Eskalationen NICHT verändern (Phase 3a).
- Wenn der Nutzer eine Aktion verlangt ("cancel", "schliesse ab", "maile Elektriker"),
  antworte: "Das kann ich in Phase 3a noch nicht. Bitte manuell im COO-Dashboard."

## Garten-Kontext (Snapshot {timestamp})

### Offene Tasks (überfällig)
{rows_from_projects_where_status=offen_and_due_date<today}

### Aktive Eskalationen
{rows_from_agent_escalation_state_where_cancelled=0}

### Dienstleister (nach Kategorie)
{rows_from_service_providers_grouped}

## Slack-Kontext
### Scope
{thread | channel_last_N}

### Nachrichten
{formatted_messages_tail}

## Nutzer-Frage
{sanitized_user_text}

## Ausgabe
Antwort in Slack-Markdown. Kein Codeblock. Mentions als <@U...> wenn passend.
Wenn unklar: frag nach.
```

Kürzungen:
- DB-Kontext hart auf ~4000 Tokens (z.B. Top-20 Tasks, Top-10 Eskalationen, alle Provider)
- Slack-Kontext auf 8000 Chars (wie InfiniLoop)
- Gesamt-Prompt-Cap: ~16k Tokens

### 6.3 CLI-Invocation (finale Form)

```python
# pi-backend/claude_cli_backend.py
import subprocess, os

def run_claude(prompt: str, timeout: int = 60) -> str | None:
    cli = os.environ.get("CLAUDE_CLI_PATH", "/usr/local/bin/claude")
    model = os.environ.get("GARTEN_CHAT_MODEL", "claude-sonnet-4-6")
    try:
        result = subprocess.run(
            [cli, "-p", "--model", model],
            input=prompt,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd="/tmp",
        )
        if result.returncode != 0:
            return None
        return (result.stdout or "").strip() or None
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None
```

Phase 3a: **keine** `--allowedTools`-Flag (nur Text-Response, kein Tool-Calling). Phase 3b (§8) fügt später `--allowedTools Read,Grep` hinzu und übergibt Tool-Scripts via `.claude/`-Config.

---

## 7. Sicherheit

### 7.1 Signing-Secret-Verifizierung (HMAC)

Slack-Standard, kopiert aus `routes/slack_interactivity.py` (InfiniLoop):

```python
def verify_slack_signature(body_bytes, timestamp, signature):
    secret = os.environ.get("GARTEN_SLACK_SIGNING_SECRET", "")
    if not secret or not timestamp or not signature:
        return False
    if abs(time.time() - int(timestamp)) > 300:  # 5 Min Replay-Guard
        return False
    base = f"v0:{timestamp}:".encode() + body_bytes
    expected = "v0=" + hmac.new(secret.encode(), base, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
```

**Ausnahme:** Slack-URL-Verification-Challenge (einmalig bei Event-Subscribe-Aktivierung):
```python
if payload.get("type") == "url_verification":
    return payload["challenge"], 200, {"Content-Type": "text/plain"}
```
Diese Requests kommen ohne Signing-Header — muss vor der HMAC-Prüfung behandelt werden.

### 7.2 Dedupe via `event_id`

Slack sendet Events potentiell 2–3× (bei `retry_num>0`). Dedupe-Strategie:

**In-Memory-Cache** (OrderedDict mit TTL 10 Min, max 1000 Einträge):
```python
from collections import OrderedDict
import time

_SEEN_EVENTS: OrderedDict[str, float] = OrderedDict()
_DEDUP_TTL = 600

def is_duplicate(event_id: str) -> bool:
    now = time.time()
    # Purge alte
    while _SEEN_EVENTS and next(iter(_SEEN_EVENTS.values())) < now - _DEDUP_TTL:
        _SEEN_EVENTS.popitem(last=False)
    if event_id in _SEEN_EVENTS:
        return True
    _SEEN_EVENTS[event_id] = now
    if len(_SEEN_EVENTS) > 1000:
        _SEEN_EVENTS.popitem(last=False)
    return False
```

Zusätzlich: **Retry-Header-Check** (`X-Slack-Retry-Num > 0` → ACK 200, kein Handler-Trigger), wie InfiniLoop es macht.

### 7.3 Rate-Limit

Pro `user_id` + Stunde: max `GARTEN_CHAT_RATE_LIMIT_PER_HOUR=30` Mentions. Speicherung analog Dedupe (In-Memory-OrderedDict). Über-Limit → freundliche Slack-Antwort: *„Moment — zu viele Anfragen in kurzer Zeit. Versuch's in einer Stunde nochmal."*

Bonus: Pro-Channel-Limit 60/h (verhindert, dass ein einziger troll-Nutzer den Channel flutet).

### 7.4 Injection-Schutz

Die bestehende `pi-backend/injection_guard.py` (Funktionen `sanitize_for_agent`, `sanitize_batch`) wird **wiederverwendet** in `claude_cli_backend.py`:

```python
from injection_guard import sanitize_for_agent

sanitized = sanitize_for_agent(user_text, source="slack_mention")
if sanitized["risk_score"] > 0.7:
    return "Die Nachricht enthält Muster, die ich nicht verarbeite. Bitte anders formulieren."
prompt_user_input = sanitized["sanitized_text"]
```

Injection-Guard ist vor allem wichtig, weil Slack-Thread-Messages **fremde User** enthalten können (nicht nur Moritz) — jeder Thread-Reply-Text wird vor dem Einbau in den Prompt sanitized.

### 7.5 DB-Read-Only im Chat

Phase 3a: Der Prompt sagt Claude explizit *„Du bist Read-Only"*. Das Backend öffnet die SQLite-DB mit `mode=ro`:
```python
conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
```
Zusätzlich: kein freier SQL-String aus dem Modell — alle DB-Reads sind **vorab gefertigte** Queries in Python-Code (ähnlich `agent_escalation.get_default_provider`).

### 7.6 Audit-Logging

Jede Mention-Verarbeitung schreibt in `agent_actions_log` (existiert schon):
```python
log_action(conn, "chat_response",
           f"Mention from {user_id} in {channel_id}",
           {"event_id": ..., "thread_ts": ..., "input_len": ..., "output_len": ...,
            "cli_duration_sec": ..., "cli_success": ...},
           success=ok)
```

---

## 8. Phase 3a (Chat) vs. Phase 3b (Chat + Tools)

### 8.1 Phase 3a — reiner Read-Only-Chat (MVP, empfohlen als erster Ship)

**Scope:**
- Bot antwortet auf `@GartenBot`-Mentions
- Prompt enthält statischen DB-Snapshot (offene Tasks, Eskalationen, Provider)
- Claude antwortet als Text
- **Keine** DB-Writes, keine Tool-Calls
- Wenn User nach Aktion fragt → Bot verweist an manuelle UI / COO-Dashboard

**Aufwand:** ~400 Zeilen Python (chat_handler + chat_context + claude_cli_backend), 1 neue Route, Dockerfile-Erweiterung.

### 8.2 Phase 3b — Chat mit Tool-Calls

**Zusätzlich:**
- Claude CLI wird mit `--allowedTools` aufgerufen (Liste whitelisted)
- Tools als Python-Skripte in `pi-backend/chat_tools/`:
  - `get_task_details.py <id>` — JSON-Task-Details
  - `get_escalation.py <task_id>` — aktuelle Eskalation
  - `cancel_escalation.py <id> --reason <r>` — Eskalation abbrechen (Write!)
  - `search_providers.py --category <c>` — Dienstleister-Suche
- **Claude CLI ruft Tools selbstständig** via `subprocess`-Style Tool-Interface

**Risiken:** Tool-Calls können DB modifizieren. Sicherheit zusätzlich via:
- Tool-Allowlist pro Rolle (Moritz = alle, andere User = nur read-Tools)
- Jeder Write-Tool-Call wird in `agent_actions_log` geschrieben mit `action_type='chat_tool_call'`
- Confirmation-Prompt für destruktive Actions (*„Willst du wirklich Eskalation #42 abbrechen? Antworte mit 'ja'"*) — zweiter Mention-Round-Trip

**Empfehlung:** **Phase 3a first**, Phase 3b erst wenn Moritz nach 1–2 Wochen Chat-Nutzung sagt *„das nervt, ich will das direkt aus Slack machen können"*.

---

## 9. Out-of-Scope

F.3 liefert bewusst **nicht**:

- **Passives Mithören** — kein `message.channels`-Event, kein `im.messages`-Event. Bot liest nur auf explizite Mention.
- **Interactive Buttons** — keine Block-Kit-Action-Buttons für „Cancel Eskalation"-Klick. Das wäre Phase 3c (späterer Hybrid aus Chat + Buttons).
- **DM-Chat** — Phase 3a ignoriert DMs (Moritz kann nicht im Direct-Channel mit dem Bot chatten). Optional Phase 3c mit `im:history`-Scope.
- **Voice/Audio** — keine Whisper-Integration (InfiniLoop Phase 10 — Garten braucht es nicht).
- **Multi-User-Context** — Bot unterscheidet nicht zwischen verschiedenen Usern mit eigenen Rollen (einfaches „Moritz-only"-Modell vorerst; `GARTEN_MORITZ_SLACK_USER_ID` ist whitelist).
- **Memory / Langzeit-Kontext** — jede Mention ist stateless. Keine Session-Speicherung. (Thread-Kontext ersetzt Memory für den häufigsten Use-Case.)
- **Voice-Calls an Dienstleister** — bleibt Phase 2 / Task #101 wie im F.1-Konzept.

---

## 10. Akzeptanzkriterien für F.3-Implementation

F.3-Implementation gilt als abgeschlossen, wenn **alle** folgenden Bedingungen erfüllt sind:

### 10.1 Container-Setup
- [ ] `docker exec voigt-garten-app which claude` liefert einen Pfad
- [ ] `docker exec voigt-garten-app claude --version` läuft ohne Fehler
- [ ] Volume-Mount für Claude-Credentials dokumentiert in `~/stacks/voigt-garten/docker-compose.yml`
- [ ] CLAUDE_CLI_PATH in `.env` gesetzt

### 10.2 Slack-App
- [ ] Scopes `app_mentions:read`, `channels:history` aktiv
- [ ] Event-Subscription `app_mention` aktiv
- [ ] URL-Verification-Challenge bestanden (Slack zeigt grünen Haken)
- [ ] Bot ist in `#refugium-heideland-management` Channel Mitglied

### 10.3 Funktional
- [ ] `@GartenBot was ist los?` im Channel → Bot antwortet innerhalb 30 s mit Übersicht offene Tasks
- [ ] `@GartenBot Task 142?` im Channel → Bot antwortet mit Task-Status + aktive Eskalation
- [ ] Mention im Thread eines Stufe-3-Alerts → Bot liest Thread, versteht Kontext, antwortet im Thread
- [ ] Nicht-Moritz-User erwähnt Bot → Bot antwortet (Phase 3a: offen für alle Channel-Mitglieder)
- [ ] Slack-Retry desselben Events → nur 1 Antwort (Dedupe wirkt)
- [ ] 31. Mention innerhalb 1 h → höfliche Rate-Limit-Antwort

### 10.4 Sicherheit
- [ ] Request ohne `X-Slack-Signature` → 401
- [ ] Request mit falschem Signing-Secret → 401
- [ ] Request mit Timestamp > 5 min alt → 401
- [ ] Injection-Payload (`ignore previous instructions...`) → wird sanitized/geblockt
- [ ] Kein Eintrag in `agent_escalation_state` wird durch Chat verändert (Phase 3a)

### 10.5 Monitoring
- [ ] Jede Mention → Eintrag in `agent_actions_log` mit `source='garten_agent'`, `action_type='chat_response'`
- [ ] `/api/garten/agent/status` zeigt optional Block *„Chat: 12 Mentions heute, ∅ Antwortzeit 8 s"*
- [ ] Claude-CLI-Failures (Timeout/Exit≠0) werden geloggt UND Bot antwortet mit Fallback-Text

### 10.6 E2E-Smoke-Test
- [ ] Python-Script `tests/agent/test_chat_smoke.py` simuliert Slack-Event, verifiziert Antwort-Post (gegen Staging oder Mock)

---

## 11. Offene Fragen für Moritz

### 11.1 Claude-CLI-Installation im Container

**Status:** CLI ist aktuell NICHT im `voigt-garten-app`-Container (verifiziert 2026-04-18).

**Optionen:**
- **A (empfohlen):** `Dockerfile` erweitern mit `npm install -g @anthropic-ai/claude-code` + Volume-Mount `/root/.claude:/root/.claude:ro` damit MAX-Plan-OAuth-Token vom Host geteilt wird. Image +250 MB.
- **B:** HTTP-Proxy auf Host (`claude-proxy` Service auf Port 5099), Container ruft via `host.docker.internal`. Kein Image-Growth, aber zusätzlicher Service.
- **C:** Parallel-Betrieb — Claude-CLI läuft als eigener Container-Sidecar neben `voigt-garten-app`, verbunden über `docker network`.

**Frage:** Welche Variante soll F.3 umsetzen?

### 11.2 Rolle / Zugriffs-Whitelist

Phase 3a ist offen für **alle Channel-Mitglieder**. Das ist heute nur Moritz + Konny + Bots. Wenn später Dienstleister oder Mieter in den Channel kommen, kann das Spam produzieren.

**Frage:** Sofort Whitelist auf `GARTEN_MORITZ_SLACK_USER_ID`, oder offen für alle und erst bei Bedarf restriktiv?

### 11.3 Phase-3b-Timing

Phase 3b (Chat mit Write-Tools) ist mächtiger aber doppelter Code-Aufwand + zusätzliche Sicherheits-Checks.

**Frage:** F.3 = nur Phase 3a shippen und 1–2 Wochen warten? Oder direkt auf 3b zielen (Eskalations-Cancel, Task-Update aus Chat)?

### 11.4 Claude-Modell-Wahl

InfiniLoop nutzt `claude-sonnet-4-6` für Summaries. Für Garten-Chat reicht ggf. `claude-haiku-4-6` (schneller, günstiger im API-Modus).

**Frage:** Sonnet oder Haiku als Default? (trivial via Env-Var anpassbar)

### 11.5 Channel-Scope

Soll der Bot nur in `#refugium-heideland-management` antworten, oder auch in anderen Channels (falls der Bot dort je eingeladen wird)?

**Vorschlag:** Whitelist `GARTEN_SLACK_CHANNEL_ID=C0AUAD6QY2U`; Mentions aus anderen Channels werden ignoriert (mit ephemeral-Antwort *„Ich bin nur im Refugium-Channel aktiv."*).

---

## 12. Zusammenfassung

F.3 macht den Garten-Agent **reaktiv**: Mention-basierter Chat via Slack Events API, Claude-CLI-Backend (analog InfiniLoop `summary_handler.py`), Thread-/Channel-Kontext, kein passives Mithören, rollen-getrennt zu den existierenden F.2-Eskalations-Flows.

**Neue Dateien:** 4 (`chat_handler.py`, `chat_context.py`, `claude_cli_backend.py`, optional `chat_tools.py` für 3b).
**Bestehende Dateien:** `agent_routes.py` um einen Endpoint erweitert, `Dockerfile` erweitert, `slack_service.py` minimal ergänzt (optional `post_thread_reply`).
**Slack-App:** Scopes ergänzen, Events aktivieren, Re-Install.
**Kritische Hürde:** Claude CLI nicht im Container — vor F.3-Implementation-Start muss Variante (A/B/C) entschieden und Dockerfile/docker-compose.yml aktualisiert sein.

Nach F.3 ist der Bot vollständig: schreibt autonom (F.2 Eskalationen) und antwortet auf Ansprache (F.3 Chat). Alles in einem Container, ohne OpenAI-Kosten, mit zentralem Audit-Log in `agent_actions_log`.

---

## 13. Umsetzungs-Status 2026-04-18 (Worker I)

**Status: Live ohne Real-Mention-Test.**

### Was tatsaechlich gebaut wurde (Phase 3a + 3b zusammen)
- Dockerfile installiert Node.js 20 + @anthropic-ai/claude-code (Container-Build dauert ca. 60 s laenger). `docker exec voigt-garten-app claude --version` -> 2.1.114.
- docker-compose.yml mountet `/home/moritz/.claude` und `/home/moritz/.claude.json` rw nach `/root/.claude*` — gleiche Strategie wie InfiniLoop, MAX-Plan-Token wird geteilt.
- Neue Backend-Dateien: `chat_handler.py`, `chat_context.py`, `claude_cli_backend.py`, `chat_tools.py`, `chat_approval.py`.
- Neue Tabelle `agent_pending_actions` (Migration in app.py).
- Endpoint `POST /api/garten/agent/slack-events` (HMAC-Signed, ACK < 3 s, Async-Thread fuer Claude-Call).
- Approval-Buttons `agent_action_approve:<id>` / `agent_action_reject:<id>` in slack_interactivity.py.

### Abweichungen vom Konzept (§6.1 Variante A bestaetigt)
- **Variante A** umgesetzt — kein HTTP-Proxy, kein Sidecar.
- **Phase 3b mit drin:** Konzept §8 schlug 3a first, 1-2 Wochen warten vor; Moritz' Vision-Update (InfiniLoop + COO + Doku-App-Chat-UI) forderte Approval-Gates direkt mit, also 3a+3b zusammen geshipped.

### Smoke-Tests durchgefuehrt
- url_verification challenge -> 200 + text/plain -> ok
- HMAC bad signature -> 401
- HMAC missing signature -> 401
- HMAC alter Timestamp -> 401 (5-min Replay-Schutz greift)
- Mock-Mention Non-Whitelist-User -> 200 ACK + Async-Worker postet Whitelist-Reject (sichtbar in Logs als Slack-API-Call)
- Dedupe gleiche event_id 2x -> 1x verarbeitet
- Container Health-Check -> 200 mit commit=30d5246
- Claude-CLI im Container ruft `claude -p` -> Live-Antwort Hallo!

### Nicht getestet (braucht Real-Mention von Moritz)
- Echter app_mention im #refugium-heideland-management Channel
- Thread-Context-Fetch via Slack-API
- Tool-Call End-to-End mit Approval-Card-Klick und Card-Update
- Rate-Limit (31 Mentions in 1 h)
- Injection-Resistenz mit echtem Prompt-Injection-Versuch in einer Channel-Message

### Slack-App-Config — manuell durch Moritz noetig
1. App GartenBot (A0ATNG554JJ) -> OAuth & Permissions:
   - Bot-Scopes ergaenzen: `app_mentions:read`, `channels:history`, `im:history`, `reactions:write`
   - Re-Install im Workspace; Bot-Token in `~/stacks/voigt-garten/.env` ggf. updaten
2. Event Subscriptions:
   - Enable Events: ON
   - Request URL: `https://garten.infinityspace42.de/api/garten/agent/slack-events`
   - Slack zeigt gruenen Haken nach url_verification-Challenge (Endpoint ist getestet)
   - Subscribe to bot events: `app_mention` (bei Wunsch zusaetzlich `message.im` fuer DM-Chat)
   - **Save Changes klicken!** (typischer Stolperstein)
3. Interactivity & Shortcuts (sollte schon von F.4 stehen):
   - Request URL: `https://garten.infinityspace42.de/api/garten/slack/interactivity`
   - F.3 nutzt denselben Endpoint mit neuen action_ids `agent_action_approve:*` / `agent_action_reject:*`

### Naechste Schritte
- Moritz macht Slack-App-Setup (Schritt 1-3 oben).
- Live-Test: `@GartenBot welche tasks sind diese woche faellig?` -> Bot antwortet im selben Channel/Thread.
- Bei erstem erfolgreichen Test eines Tool-Calls: Confirmation-Post in #refugium-heideland-management.

