# Voigt-Garten Worker-Prompts

Sequentielle Worker für den Garten-Agent-Ausbau nach F.2 (Phase 1 fertig 2026-04-17).

## Workflow (ohne Manager-Chat)

Paste den jeweiligen Worker-Prompt in eine **neue Claude-Code-Session** im `voigt-garten`-Repo. Jeder Worker:

1. Liest sein eigenes Konzept-Doc auf IS42 (`~/stacks/voigt-garten/docs/`)
2. Setzt die Aufgaben um (DB/Code/Deploy/Tests)
3. Berichtet zurück mit festem Format (max. 300-400 Wörter)

Wenn Worker-Bericht grün → nächsten Worker-Prompt in neue Session.

**Kein Manager-Chat nötig**, weil:
- Null File-Overlap zwischen Workern
- Akzeptanzkriterien sind explizit testbar
- Bei Fehler rollbackt der Worker selbst seinen Commit

## Reihenfolge

| # | Worker | Prompt-Datei | Konzept-Doc (IS42) | Deploy-Scope |
|---|---|---|---|---|
| 1 | **G — Tasks-Reprioritization** | `WORKER_G_TASKS_REPRIORITIZATION.md` | `docs/TASK_REPRIORIZATION_PLAN.md` | DB-Writes + Schema + Agent-Worker-Erweiterung |
| 2 | **H — F.4 Notifications** | `WORKER_H_NOTIFICATIONS_MIGRATION.md` | `docs/SLACK_NOTIFICATION_MIGRATION.md` | 2 neue Dateien + Feature-Flag + Interactivity-Endpoint |
| 3 | **I — F.3 Chat-Layer** | `WORKER_I_CHAT_LAYER.md` | `docs/GARTEN_AGENT_CHAT_CONCEPT.md` | 5 neue Dateien + Dockerfile + Claude-CLI |

## Moritz' bestätigte Entscheidungen (Stand 2026-04-18)

- Reihenfolge: **G → H → I** (Daten-Hygiene zuerst, dann Notifs, dann Chat)
- Claude-CLI-Setup: **Variante A** (Dockerfile + Volume-Mount MAX-Creds)
- F.3-Scope: **3a + 3b direkt** (Chat + Tool-Calls mit Approval-Gates, COO-Pattern)
- F.4-Timing: **Feature-Flag `both` für 14 Tage**, dann Slack-only

## Nicht-Scope dieser Worker

- **F.4 Wetter-API-Multiplikator** — skizziert in Tasks-Plan §8, aber komplette Umsetzung später (nach Worker I)
- **F.5 Web-Chat-UI in Voigt-Garten-App** — Chat-Widget analog GardenAssistant.tsx, baut auf Worker I auf, separater Workstream
- **Voice-Agent (Retell.ai, ex-Stufe-4)** — Garten-Task #101, Phase 2, nicht jetzt

## Wenn ein Worker hakt

1. Lies den Worker-Bericht genau — was ist gescheitert?
2. Rollback: `ssh is42 "cd ~/voigt-garten/data && ls -la garten.db.bak.*"` — Backup-File aus dem jeweiligen Worker (jeder legt sein eigenes an)
3. Starte neuen Chat mit Worker-Prompt + Zusatz: "Der vorige Versuch scheiterte an X. Bitte überspringe Y und probiere Z alternativ."
4. Oder: hol mich dazu (diese Claude-Session oder eine neue `voigt-garten`-Session) für Debugging

## Nach Worker I

CLAUDE.md sollte aktuell sein (alle 3 Worker updaten ihre Sektion). Als letzter Schritt optional:
- **Garten-Agent-Gesamt-Doku konsolidieren:** alle 4 Konzept-Docs (F.1 + Tasks-Plan + F.3 + F.4) als `docs/AGENT_README.md` verlinken
- **Memory-Update** (`~/.claude/projects/C--GitHub-voigt-garten/memory/`): Project-Memory für "Garten-Agent-Architektur komplett" anlegen
