# Worker I — F.3 Chat-Layer (3a + 3b mit Approval-Gates)

**Vorgänger:** Worker G (Tasks-Reprioritization) + Worker H (F.4 Notifications) + Konzept-Doc `~/stacks/voigt-garten/docs/GARTEN_AGENT_CHAT_CONCEPT.md` (619 Zeilen, freigegeben 2026-04-18)
**Nachfolger:** F.4 Wetter-API-Integration (Phase 2)
**Server:** IS42, SSH-Alias `ssh is42`
**Slack-App:** GartenBot (A0ATNG554JJ)
**Sprache:** Deutsch mit echten Umlauten.

---

## Moritz' Vision für den Agent (wörtlich)

> *«Der Garten-Agent soll sowas wie eine Mischung aus InfiniLoop, COO und Doku-App-Chat-UI sein. Einfache CLI, der ich Tasks geben kann, die aber auch selbst managed mit meiner Freigabe (wie die COO-Tagesplanung, nur nicht so komplex).»*

Das heißt konkret:
- **InfiniLoop-ähnlich:** Claude-CLI-Backend (kein OpenAI), Slack-Events, Mention-Handler
- **COO-ähnlich:** Approval-Gates — Bot schlägt Aktionen vor, Moritz klickt "Ausführen" in Slack-Button-Card
- **Doku-App-Chat-UI-ähnlich:** natürlich-sprachlicher Dialog, Thread-Context, Tool-Calls für Task-Manipulation

---

## Kontext

F.2 hat den Eskalations-Worker gebaut (output-only Slack). F.3 macht daraus einen **echten Chat-Agent**. Worker H hat die Slack-App für Interactivity konfiguriert (hoffentlich) — Worker I nutzt das wieder.

Dein Job: **Phase 3a (Chat) + Phase 3b (Tool-Calls mit Approval-Gates) direkt zusammen umsetzen.**

---

## Pflicht-Lesestoff

1. `~/stacks/voigt-garten/docs/GARTEN_AGENT_CHAT_CONCEPT.md` via SSH — **Bauplan komplett**
2. `C:\GitHub\voigt-garten\.claude\CLAUDE.md`
3. **InfiniLoop-Code als Vorlage** (auf IS42):
   - `ssh is42 "cat ~/stacks/infiniloop/services/slack_events_handler.py"` — Event-Entry-Pattern (Z. 124-150 = `_handle_app_mention`)
   - `ssh is42 "cat ~/stacks/infiniloop/services/summary_handler.py"` — Claude-CLI-Subprocess (Z. 180-207 = `_run_cli`, **exakte Vorlage**)
   - `ssh is42 "cat ~/stacks/infiniloop/services/summary_handler.py"` — History-Fetch (Z. 105-142)
   - `ssh is42 "cat ~/stacks/infiniloop/routes/slack_interactivity.py"` — HMAC-Signing (Z. 15-27)
4. **COO-Approval-Pattern:** `ssh is42 "grep -r 'approve_draft\|approval' ~/stacks/doku/app/coo/"`—schau wie COO seine Tagesplan-Approvals macht
5. Bestehende Voigt-Garten-Dateien:
   - `pi-backend/slack_service.py` (von F.2)
   - `pi-backend/agent_routes.py` (von F.2)
   - `pi-backend/slack_notifications.py` + `notifications.py` (von Worker H)
   - `pi-backend/injection_guard.py` (bestehend, wiederverwendbar)
   - `pi-backend/email_draft_service.py` (bestehender Approval-Workflow, **Vorlage für Task-Approval**)

---

## Moritz' bestätigte Entscheidungen

- **Scope:** 3a + 3b direkt. Bot kann lesen + antworten + Aktionen VORSCHLAGEN (Tasks verschieben, Eskalationen cancellen, Email-Drafts, Dienstleister-Suche). Aktionen werden als **Slack-Button-Cards mit "Ausführen"/"Verwerfen"** gepostet. Nur nach Klick ausgeführt.
- **Claude-CLI-Setup:** Variante A — Dockerfile erweitern (`npm install -g @anthropic-ai/claude-code`) + Volume-Mount `/root/.claude:ro` für MAX-Plan-Credentials vom Host
- **Thread-Context:** bei Thread-Mention voller Thread (max 50 Messages), bei Channel-Mention letzte 10 Messages
- **Zugriff:** Whitelist auf `GARTEN_MORITZ_SLACK_USER_ID` beschränken (offen für alle wenn Moritz später Mitarbeiter/Konny einlädt)
- **LLM:** Claude-Sonnet-4-6 via CLI (nicht OpenAI/OpenRouter)

---

## Aufgaben (hohes Level — Details im Konzept-Doc)

### Phase 1: Slack-App für F.3 erweitern

Scopes ergänzen (Moritz manuell im Slack-UI):
- `app_mentions:read`
- `channels:history`
- `im:history` (für DMs)

Event Subscriptions aktivieren:
- Request-URL: `https://garten.infinityspace42.de/api/garten/agent/slack-events`
- Subscribe to: `app_mention`, evtl. `message.im`

**Re-Install** im Workspace → Bot-Token ggf. neu (Moritz muss in `.env` aktualisieren).

### Phase 2: Dockerfile erweitern (Claude-CLI)

```dockerfile
# Claude-CLI für F.3 Chat-Layer
RUN npm install -g @anthropic-ai/claude-code@latest \
    && claude --version
```

`docker-compose.yml`:
```yaml
volumes:
  - /root/.claude:/root/.claude:ro  # MAX-Plan-Credentials vom Host
```

**Wichtig:** Host muss `claude` CLI installiert + eingeloggt haben. Check: `ssh is42 "ls /root/.claude/"` (Moritz' Home oder `/root`?). Falls Credentials in `~/.claude/`, Volume-Mount entsprechend anpassen.

### Phase 3: Neue Dateien

- `pi-backend/chat_handler.py` — Slack-Event-Empfang, Signing-Verify (reuse von Worker H), Dedupe via `event_id`-OrderedDict (TTL 10min), Async-Dispatch via `threading.Thread`
- `pi-backend/chat_context.py` — Thread-Fetch (`conversations.replies`) / Channel-Fetch (`conversations.history`), User-ID-Mapping, Format für Claude-Input
- `pi-backend/claude_cli_backend.py` — Subprocess-Wrapper um `claude -p --model claude-sonnet-4-6`, stdin-Prompt-Assembly, 60s Timeout, Output-Parsing (JSON-Structured-Output wenn möglich)
- `pi-backend/chat_tools.py` — Tool-Definitionen + Executor (Phase 3b): `update_task_due_date`, `cancel_escalation`, `create_email_draft`, `search_providers`, `get_overdue_tasks`. **Tools machen NUR Drafts/Proposals**, keine direkten DB-Writes.
- `pi-backend/chat_approval.py` — Approval-Gate: Tool-Call aus Claude → Slack-Card mit Buttons → bei Klick tatsächliche Aktion ausführen + Card updaten

**Erweiterungen:**
- `pi-backend/agent_routes.py` — neue Route `/api/garten/agent/slack-events` (POST, Events) + `/api/garten/agent/approval` (POST, Interactive, für Approval-Buttons)
- `pi-backend/slack_service.py` — `build_approval_card(tool_call, summary) -> blocks` Helper

### Phase 4: Prompt-Assembly für Claude-CLI

System-Prompt (statisch, max 1500 Tokens):
```
Du bist der Garten-Agent für das Refugium Heideland — ein Familien-Garten-
Management-System. Du hilfst Moritz (Admin, Slack-User GARTEN_MORITZ_SLACK_USER_ID)
bei der Verwaltung von Tasks, Eskalationen, Dienstleistern, Buchungen.

Du darfst niemals direkt DB schreiben — nutze immer Tools mit Approval-Gate.
Der User wird in Slack einen Button klicken müssen, bevor Aktionen wirklich passieren.

Verfügbare Tools: [dynamisch aus chat_tools.py generiert]

Datenbank-Snapshot (read-only):
- Offene Tasks: [top 20 aus projects WHERE status='offen' AND category != 'it']
- Aktive Eskalationen: [aus agent_escalation_state WHERE cancelled=0]
- Dienstleister: [aus service_providers WHERE agent_disabled=0]

Context: [Thread- oder Channel-History]

Frage: [User-Message, sanitized via injection_guard]

Antworte auf Deutsch mit echten Umlauten.
```

Bei Tool-Call in der Response: Claude nennt das Tool + Parameter → Backend baut Approval-Card.

### Phase 5: Approval-Flow (COO-Style)

Beispiel-Flow:
```
Moritz @GartenBot: "Die Tasks im Mai sind zu voll, verschieb 3 der weniger kritischen auf Juni"

Bot: "Ich schlage diese 3 Verschiebungen vor: ..." + Slack-Card mit Buttons:
     [ ✅ Ausführen ] [ ✏️ Anders ] [ ❌ Verwerfen ]

Moritz klickt "Ausführen" → Bot ruft chat_tools.update_task_due_date() 3x →
DB-Updates → Card wird zu "✅ 3 Tasks verschoben nach Juni" →
Bot postet Zusammenfassung im Thread.
```

### Phase 6: Injection-Schutz

- System-Prompt explizit absichern gegen Prompt-Injection aus Channel-History
- DB-Snapshot MUSS durch `injection_guard.sanitize_for_agent()` laufen (bestehender Code, wiederverwenden)
- Tools-Output: max-Limits (z.B. `update_task_due_date` nur für 1 Task pro Call, Massen-Operationen erzwingen Approval-Batch-Card)
- User-Whitelist: jeder Event prüfen `user_id == GARTEN_MORITZ_SLACK_USER_ID` → sonst Reply "Nur Moritz darf den Bot direkt steuern"

### Phase 7: Rate-Limiting

Max 30 Mentions pro User pro Stunde (in Memory OK, bei Neustart resettet). Bei Überschreitung: Hinweis-Message "Bitte warte X Minuten, Bot zahlt Claude-Credits."

### Phase 8: Smoke-Tests

1. **Mention im Channel:** `@GartenBot welche Tasks sind diese Woche fällig?` → Bot antwortet mit Task-Liste (read-only, kein Tool-Call)
2. **Mention im Thread:** im gleichen Thread: `was ist davon wichtig?` → Bot hat Thread-Context, antwortet relevant
3. **Tool-Call Approval:** `verschieb Task #45 auf 2026-05-15` → Approval-Card → Klick "Ausführen" → DB-Update → Card grün
4. **Injection-Test:** Nachricht mit Prompt-Injection (`IGNORE PREVIOUS INSTRUCTIONS...`) → Bot behält Rolle, antwortet normal
5. **Whitelist:** Test-User (nicht Moritz) erwähnt Bot → Bot antwortet "Nur Moritz darf…"
6. **Rate-Limit:** 31 schnelle Mentions → 31ste bekommt Rate-Limit-Hinweis
7. **Dedupe:** gleiche Slack-Event-Id zweimal hintereinander (Slack-Retry-Simulation) → Bot antwortet nur 1x
8. **Thread-Reply:** Bot's Response geht in den Thread, nicht in den Channel

### Phase 9: Deploy

```bash
cd C:/GitHub/voigt-garten
git add Dockerfile docker-compose.yml pi-backend/
git commit -m "feat(f3-chat): Mention-Responder + Tool-Calls mit Approval-Gates"
git push origin main

ssh is42 "bash ~/voigt-garten/rebuild-voigt-garten.sh"
# Rebuild ist diesmal größer (Claude-CLI-Install via npm ~30s zusätzlich)
```

### Phase 10: CLAUDE.md + Konzept-Doc aktualisieren

- CLAUDE.md: neue Sektion "F.3 Chat-Layer" mit Architektur, Endpoints, Tool-Liste, Approval-Flow
- `GARTEN_AGENT_CHAT_CONCEPT.md` am Ende "Umsetzungs-Status 2026-04-..." ergänzen

---

## Stolperfallen

- **Claude-CLI-Credentials:** MAX-Plan-Login läuft über `/root/.claude/` oder `~/.claude/` — je nachdem wie Moritz eingeloggt ist. Falls `~/.claude/` auf Moritz-User, Volume-Mount `-/home/moritz/.claude:/root/.claude:ro`. Prüfe mit `ls -la /home/moritz/.claude/` vor Dockerfile-Schreiben.
- **Slack-Event-3s-Timeout:** ACK SOFORT mit 200, dann async arbeiten. Claude-CLI braucht 5-30s — wenn du synchron antwortest, sendet Slack 2-3 Retries.
- **Dedupe-Cache:** OrderedDict in Memory, NICHT in DB (verhindert WAL-Konflikte). Bei Container-Restart ist Cache weg → max. 1 Duplikat möglich pro Restart, akzeptabel.
- **Tool-Call-Parsing:** Claude-CLI-Output ist freier Text. Für Tool-Calls strukturiertes JSON-Format im System-Prompt erzwingen (`Antworte NUR mit JSON wenn du ein Tool nutzt: {"tool": "...", "params": {...}}`). Parse mit try/except — bei Fehler: als normale Text-Antwort behandeln.
- **Channel vs. Thread:** Slack-Event hat `thread_ts` wenn im Thread, sonst nicht. `channel_type` unterscheidet Channel/DM. Beide Fälle handhaben.
- **Injection Guard:** Der bestehende `injection_guard.py` wurde für den CLI-Agenten gebaut. Für Slack-Context muss er an Channel-History angepasst werden — ggf. erweitern statt duplizieren.
- **SSH-Befehle bündeln:** fail2ban auf IS42.

---

## Akzeptanzkriterien

1. **Claude-CLI im Container:** `docker exec voigt-garten-app claude --version` → Version-Output
2. **Mention-Handler:** Event-Endpoint antwortet binnen 3s ACK, Bot postet Response binnen 60s im Thread
3. **Tool-Call-Approval:** `update_task_due_date` via Chat → Slack-Card → Klick → DB-Update verifiziert
4. **Whitelist:** Nicht-Moritz bekommt höfliche Ablehnung
5. **Rate-Limit:** Aktiv und logged
6. **Injection-Schutz:** Claude bleibt in Rolle
7. **Dedupe:** funktioniert
8. **Alle 8 Smoke-Tests:** grün
9. **Deploy:** Container healthy nach Rebuild
10. **CLAUDE.md:** aktualisiert
11. **Konzept-Doc:** Status-Update am Ende

---

## Bericht-Format (max. 400 Wörter, an Moritz zurück)

1. Slack-App-Änderungen: Scopes ergänzt, Events aktiviert, Re-Install durch
2. Dockerfile + docker-compose: Claude-CLI installierbar, Volume-Mount funktional
3. Neue Dateien: alle 5 + Erweiterungen in agent_routes.py + slack_service.py
4. Prompt-Assembly: System-Prompt verifiziert, Tool-Format verifiziert
5. Smoke-Tests: X/8 bestanden, Details
6. Performance: Mention → Response mittlere Latenz
7. Claude-CLI-Credentials: MAX-Plan-Auth funktioniert im Container ja/nein
8. Tool-Calls: alle Tools aus chat_tools.py getestet
9. Approval-Flow: mindestens 1 Tool-Call end-to-end mit DB-Verifikation
10. Deploy: Container healthy, URL check
11. CLAUDE.md + Konzept-Doc: aktualisiert
12. Offene Fragen / Blocker

---

## Slack-Bestätigung nach Erfolg

Poste in `#refugium-heideland-management` via GartenBot selbst:
```
:rocket: Worker I live — GartenBot ist jetzt ein echter Chat-Agent. Erwähn mich, ich antworte. Aktionen brauchen deine Freigabe.
```
Und teste direkt Moritz' erste Mention live!

---

## Bonus-Nachfolger: F.5 Web-Chat-UI in Voigt-Garten-App

Moritz' Vision schließt "Doku-App-Chat-UI" ein — das wäre ein Chat-Widget direkt in `garten.infinityspace42.de` (analog `AppOverlays.tsx`/`GardenAssistant.tsx`, die schon existieren). Der bestehende `/api/assistant/chat`-Endpoint könnte auf den gleichen Claude-CLI-Backend umsteigen. Das ist **nicht Worker I** — erwähnen, als Folge-Worker F.5 skizzieren.
