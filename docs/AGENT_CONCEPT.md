# Garten-Agent — Konzept (Phase F.1)

**Erstellt:** 2026-04-17
**Worker:** F.1 (`garten-greta`, Konzept)
**Folge-Worker:** F.2 (Implementation, nach Moritz-Freigabe)
**Pfad-Mirror:** `~/stacks/voigt-garten/docs/AGENT_CONCEPT.md` (Garten-Server) ⇄ `IS42/Dokumentation/.claude/coo/sync/SYNC_VOIGT_GARTEN_AGENT.md` (Doku-App-Repo, COO-Visibility)

---

## 1. Vision

Der Garten-Agent ist ein autonomer Eskalations-Roboter, der dafür sorgt, dass operative Garten-Tasks nicht im Backlog versanden. Heute häufen sich überfällige Aufgaben in der Voigt-Garten-DB (Elektrikertermin nicht koordiniert, Brunnenpumpe gewartet, Hecke nicht geschnitten), weil niemand systematisch nachfasst — Moritz baut Software, Konny ist altersbedingt raus, externe Dienstleister müssen aktiv kontaktiert werden. Der Agent läuft alle 6 h auf dem IS42-Server, scannt überfällige Tasks, und eskaliert in **3 Stufen** — vom Reminder im COO-Tagesplan bis zum Slack-DM an Moritz. Ab Stufe 3 übernimmt Moritz manuell (Telefonat selbst führen). Klare Abgrenzung zu InfiniLoop: InfiniLoop fixt **IT-Tasks** (Code-PRs, Auto-Merge, Auto-Deploy für Kategorie `it`), der Garten-Agent eskaliert **operative Tasks** (Mensch-zu-Mensch-Kommunikation in allen anderen 13 Kategorien). Beide laufen autark, teilen aber den Slack-Channel `#refugium-heideland-management` (`C0AUAD6QY2U`).

**Phase 1 Scope (bewusst begrenzt):** Nur Reminder + Email + Slack-DM. Automatische Voice-Calls an Dienstleister (ursprünglich Stufe 4) sind als **Phase-2-Idee** in Garten-Task #101 parkiert („Telefon-Agent für Eskalationen (Retell.ai) evaluieren") — erst wenn manueller Telefon-Aufwand nervt, wird die Evaluierung angestoßen.

---

## 2. Eskalations-Stufen

Tageszahlen sind „Tage überfällig nach `due_date`". Notfall-Kategorien (`wasser`, `elektrik`) eskalieren schneller, weil Strom-/Wasserausfall echte Bewohner trifft (Buchungen).

| Stufe | Standard-Trigger | Notfall-Trigger (`wasser`, `elektrik`) | Aktion | Empfänger |
|---|---|---|---|---|
| **1 — Reminder** | Tag 1 überfällig | sofort am Fälligkeitstag | Eintrag im COO-Tagesplan + Slack-Channel-Post in `#refugium-heideland-management` via `@garten-bot` | Moritz (passiv lesen) |
| **2 — Email** | Tag 3 überfällig | Tag 1 überfällig | Email an Verantwortlichen (`projects.assigned_to` oder Default aus `service_providers.default_for_categories`). Bei externen Dienstleistern: höfliche Erinnerungs-Mail mit Task-Beschreibung + Konnys Telefonnummer für Rückfragen. Sendet via `email_service.py` (Resend). | `assigned_to` oder Default-Dienstleister |
| **3 — Slack-DM (+ Telegram-Fallback)** | Tag 7 überfällig | Tag 2 überfällig | Slack-DM an Moritz' User-ID (`U0ASYE5UPQR`) via `@garten-bot` mit Task-Link, vorgeschlagenem Dienstleister aus `service_providers` (Name + Telefon), expliziter Aufforderung „Bitte selbst anrufen". Parallel Telegram-Nachricht (Fallback, bis Slack-Coverage verifiziert ist — siehe GigaPlan §). | Moritz |

**Stufe 4 (Telefonanruf) ist bewusst NICHT in Phase 1.** Siehe §7 und Garten-Task #101 („Telefon-Agent für Eskalationen evaluieren"). Wenn Moritz nach manuellem Telefonieren sagt „das nervt, lass uns das automatisieren", wird F.3 mit Voice-Integration geplant — als Add-On auf dem bestehenden Stufen-Gerüst.

**Eskalations-Channel-Detail (ENTSCHIEDEN 2026-04-17 durch Moritz):** Garten-Agent bekommt **eigenen `@garten-bot`** — läuft im Voigt-Garten-Container mit eigenem Slack-Bot-Token und eigener Slack-App (separate Install im Workspace `InfinitySpace`). InfiniLoop-Bot bleibt strikt für IT-Tasks. Beide Bots posten in `#refugium-heideland-management`, unterscheidbar durch App-Identity (Slack rendert den Bot-Namen am Post). Kein REST-Bridge-Hack nötig.

**Slack-App-Provisioning** für `@garten-bot` (in F.2 als Sub-Task):
- App-Name: `GartenBot` (display_name im Workspace)
- Scopes: `chat:write`, `chat:write.public`, `im:write`, `users:read.email` (für `@Moritz`-Mention-Lookup), `conversations:write` (falls externer Reporter per Magic-Link wie InfiniLoop Phase 12)
- Install in Workspace, einladen in `C0AUAD6QY2U`
- ENV-Vars in `~/stacks/voigt-garten/.env`: `GARTEN_BOT_TOKEN` (`xoxb-…`), `GARTEN_MORITZ_SLACK_USER_ID` (= `U0ASYE5UPQR`)

---

## 3. Kontaktverzeichnis-Schema

**Schema-Insight (überraschend, siehe §10 Bericht):** In der Garten-DB existiert bereits eine Tabelle `service_providers` mit fast allen benötigten Feldern. Statt einer neuen `garten_contacts`-Tabelle wird `service_providers` minimal erweitert — vermeidet Schema-Duplikation und Daten-Migration.

### Vorhandenes Schema (`service_providers`)

```sql
CREATE TABLE service_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,              -- z.B. 'elektrik', 'rasen', 'wasser'
    name TEXT NOT NULL,                  -- "Elektrik Ranghofer GmbH"
    email TEXT,
    phone TEXT,
    rating INTEGER DEFAULT 0,
    notes TEXT,
    verified BOOLEAN DEFAULT 0,
    hourly_rate REAL,
    availability TEXT,
    specializations TEXT,
    last_contacted_at DATETIME,
    preferred_contact TEXT DEFAULT 'email',
    contact_notes TEXT
);
```

### Erweiterung für Garten-Agent

```sql
-- Mehrere Kategorien pro Anbieter (JSON-Array statt Single-TEXT)
ALTER TABLE service_providers ADD COLUMN default_for_categories TEXT DEFAULT '[]';
-- Opt-Out: wenn 1, ruft Agent nie an, mailt nie
ALTER TABLE service_providers ADD COLUMN agent_disabled BOOLEAN DEFAULT 0;
-- Beispiel-Anrede für Voice-Skript (z.B. "Frau Ranghofer", "Hallo Lukas")
ALTER TABLE service_providers ADD COLUMN voice_salutation TEXT;
-- Letzte Aktion vom Agent
ALTER TABLE service_providers ADD COLUMN last_agent_action_at DATETIME;
```

**Begründung pro Spalte:**
- `default_for_categories` — JSON-Array, weil ein Elektriker auch Heizungs-Tasks übernehmen kann. `category` (Single) bleibt für Primär-Kategorie.
- `agent_disabled` — DSGVO/Höflichkeits-Opt-Out. Konny's persönlicher Hausarzt z.B. soll nie automatisch angerufen werden.
- `voice_salutation` — Retell-Skript braucht eine natürliche Anrede ohne dass Kontaktnamen aus DB rohgeparst werden.
- `last_agent_action_at` — verhindert Über-Eskalation (max. 1 Anruf pro 7 Tage pro Kontakt, auch über mehrere Tasks hinweg).

### Beispiel-Inserts (Test-Daten)

```sql
INSERT INTO service_providers (category, name, phone, email, default_for_categories, voice_salutation, preferred_contact)
VALUES
    ('elektrik', 'Elektrik Ranghofer GmbH', '+491701234567', 'info@elektrik-ranghofer.de',
     '["elektrik", "infrastruktur"]', 'Herr Ranghofer', 'phone'),
    ('rasen', 'Gartenbau Müller', '+491702345678', 'mueller@gartenbau-mueller.de',
     '["rasen", "beete", "baeume", "garten"]', 'Frau Müller', 'email'),
    ('wasser', 'Brunnenbau Schmidt', '+491703456789', 'kontakt@brunnenbau-schmidt.de',
     '["wasser"]', 'Hallo Lukas', 'phone');
```

---

## 4. Anruf-Flow — **NICHT in Phase 1**

Stufe 4 (automatischer Anruf an externe Dienstleister via Retell.ai) ist als Phase-2-Idee in Garten-Task #101 parkiert. Siehe §7 für die Gedanken-Skizze und offene Fragen, die beantwortet werden müssen, bevor F.3 startet.

**Phase 1 endet bei Stufe 3** (Slack-DM an Moritz). Moritz telefoniert selbst, markiert den Task manuell als erledigt oder setzt ihn auf „in_progress" in der Garten-App.

---

## 5. DB-Erweiterung (vollständige SQL-Migration)

```sql
-- 5.1 service_providers erweitern (statt redundante garten_contacts!)
ALTER TABLE service_providers ADD COLUMN default_for_categories TEXT DEFAULT '[]';
ALTER TABLE service_providers ADD COLUMN agent_disabled BOOLEAN DEFAULT 0;
ALTER TABLE service_providers ADD COLUMN last_agent_action_at DATETIME;

-- 5.2 agent_escalation_state (NEU)
CREATE TABLE IF NOT EXISTS agent_escalation_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL UNIQUE,     -- max. 1 Eskalation pro Task
    current_stage INTEGER,               -- 1=reminder, 2=email, 3=slack/telegram
    last_action_at TIMESTAMP,
    next_action_at TIMESTAMP,
    cancelled BOOLEAN DEFAULT 0,
    cancel_reason TEXT,                  -- 'task_completed', 'auto_resolved', 'owner_override'
    created_at TIMESTAMP DEFAULT (datetime('now', 'localtime')),
    updated_at TIMESTAMP DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (task_id) REFERENCES projects(id)
);
CREATE INDEX idx_escalation_next_action ON agent_escalation_state(next_action_at);
CREATE INDEX idx_escalation_cancelled ON agent_escalation_state(cancelled);

-- 5.3 projects-Erweiterung
ALTER TABLE projects ADD COLUMN escalation_state TEXT;       -- denormalisierter Cache aus agent_escalation_state für schnelle Tagesplan-Reads
ALTER TABLE projects ADD COLUMN last_escalation_at TIMESTAMP;
```

**Hinweis 1:** `agent_actions_log` existiert bereits in Garten-DB (von Garten-Assistent geerbt) — wird **wiederverwendet** für Audit-Logging der Eskalations-Aktionen (`action_type IN ('reminder', 'email_sent', 'slack_dm', 'telegram_alert')`). Keine neue Tabelle nötig.

**Hinweis 2:** `agent_call_log`-Tabelle und Spalte `service_providers.voice_salutation` sind **NICHT in Phase 1** — erst wenn Task #101 (Voice-Agent-Evaluierung) startet, werden diese ergänzt.

---

## 6. API zu COO (REST-Endpoints)

Auth-Pattern: bestehende `COO_API_SECRET`-Header-Logik (siehe `pi-backend/app.py` Z. 65 + `Dokumentation/app/routes/coo.py`).

| Endpoint | Methode | Auth | Zweck |
|---|---|---|---|
| `/api/garten/agent/status` | GET | `X-COO-Secret` | Liest aktive Eskalationen + nächste Aktionen für COO-Tagesplan-Block |
| `/api/garten/agent/trigger-escalation/<task_id>` | POST | `X-COO-Secret` | Manuell Eskalation starten (Override) |
| `/api/garten/agent/cancel-escalation/<escalation_id>` | POST | `X-COO-Secret` | Eskalation abbrechen (z.B. wenn Moritz manuell gehandelt) |

**`/api/garten/agent/call-recap` ist in Phase 1 nicht implementiert** — kommt mit Task #101.

### Beispiel-Response `/api/garten/agent/status`

```json
{
  "active_escalations": [
    {
      "task_id": 142,
      "task_title": "Brunnenpumpe warten",
      "category": "wasser",
      "current_stage": 3,
      "next_action_at": "2026-04-19T10:00:00",
      "next_action_kind": "voice_call",
      "default_contact": {"id": 7, "name": "Brunnenbau Schmidt"}
    }
  ],
  "upcoming_calls_24h": 1,
  "calls_last_7d": 3,
  "stats": {"stage_1": 4, "stage_2": 2, "stage_3": 1, "stage_4": 0}
}
```

COO-Integration: in `Dokumentation/app/coo/prompts.py:get_voigt_garten_items()` neuer Block am Ende:
```python
# Garten-Agent Eskalationen (separater HTTP-Call zu Garten-Backend)
agent_status = _fetch_garten_agent_status()  # GET mit COO_API_SECRET
if agent_status['active_escalations']:
    output += "### 🌱 Aktive Garten-Agent Eskalationen\n"
    for esc in agent_status['active_escalations']:
        output += f"- Task #{esc['task_id']} «{esc['task_title']}» — Stufe {esc['current_stage']}, nächste Aktion: {esc['next_action_kind']} um {esc['next_action_at']}\n"
```

---

## 7. Voice-Integration — Phase-2-Skizze (Task #101)

**Status 2026-04-17:** Automatische Voice-Calls sind aus Phase 1 bewusst ausgeklammert. Task #101 in der Garten-DB ist der Platzhalter; hier die Gedanken-Skizze für spätere Evaluierung, damit nichts verlorengeht.

### Kern-Idee: eine geteilte InfinitySpace-Agentennummer

Alle Voice-Bots von Moritz (SBS Emma, Garten-Eskalation, ggf. Demori) teilen sich **eine einzige Telefon-Nummer** und **einen einzigen Retell-Agent**. Dynamic Variables im Retell-Prompt erlauben, dass derselbe Agent pro Call eine andere Aufgabe erklärt — nur die Variablen (`{agent_name}`, `{task_context}`, `{callback_instruction}`) ändern sich. Einmal Setup, danach für alle Use-Cases nutzbar.

### Offene Setup-Fragen

1. **Nummer-Typ:** Retell konnte in DE keine Mobilnummer direkt verkaufen. Alternativen:
   - DE-Festnetznummer über Twilio importieren (ca. 5–15 USD/Monat, braucht Adressverifikation bei der Bundesnetzagentur, Setup ~1–3 h).
   - US-Nummer (Retell-Standard, kostengünstig, aber Dienstleister sehen „+1…" und könnten misstrauisch werden).
   - DE-Mobilnummer über Dritt-Anbieter (sipgate, vbox etc.) → zusätzlicher SIP-Trunk-Hop.
2. **Account-Sharing:** Ein Retell-Account mit zwei Agents (Emma SBS + Lara Garten) oder zwei Accounts? Ein Account spart Subscription-Fixkosten, trennt Usage aber nur logisch. Antwort hängt von Volumen/Budget ab.
3. **Wer hostet den Voice-Endpoint:** Doku-App (aktueller SBS-Emma-Home) oder Voigt-Garten direkt? Doku-App-Option spart Code-Duplikation, Garten-Option macht Garten autark. Empfehlung aktuell: **Doku-App proxied**, Recap landet als Webhook wieder in Garten-App und ist damit nur im Tagesplan-früh-Feed sichtbar — nicht im SBS-CRM.

### Laufende Kosten (Schätzung, wenn gebaut)

- Minutenpreis Retell: ~0,07 USD/Min.
- Garten-Volumen erwartet: 5–10 Calls/Jahr à 2–3 min ⇒ ~2–3 USD/Jahr für Minuten.
- Nummer (DE-Festnetz via Twilio): ~60–180 USD/Jahr.
- Gesamt: ~70–200 USD/Jahr, falls ausschließlich Garten profitiert. Bei Shared-Nutzung mit SBS/Demori amortisiert sich der Nummern-Fixkosten schneller.

### Was in Phase 1 vorbereitet wird

- `service_providers.phone` ist das einzige Feld, das später für Voice relevant ist — bereits vorhanden.
- `agent_actions_log` kann später um `action_type='voice_call_*'` erweitert werden, ohne Schema-Änderung.
- Die Stufen-Logik (Trigger-Berechnung) in `agent_escalation.py` wird so modular gebaut, dass eine Stufe 4 per Konfig-Flag aktiviert werden kann, ohne das Worker-Grundgerüst umzustricken.

**Beteiligte Task-Referenz:** Voigt-Garten-Projekt #101 („Telefon-Agent für Eskalationen (Retell.ai) evaluieren").

---

## 7.5 Abgrenzung zu InfiniLoop

| Aspekt | InfiniLoop | Garten-Agent |
|---|---|---|
| **Scope** | Nur Kategorie `it` (Code-Bugs, Frontend-Issues) | Alle 13 anderen Kategorien (`rasen`, `beete`, `baeume`, `garten`, `wasser`, `brennholz`, `haus`, `elektrik`, `putzen`, `rechtliches`, `marketing`, `infrastruktur`, `sonstiges`) |
| **Action** | Code-PRs erstellen, auto-mergen, auto-deployen | Menschen kontaktieren (Email, Slack, Telegram, Telefon) |
| **Repo** | InfiniLoop-Container auf is42 (separate App) | Voigt-Garten-Container auf is42 (gleicher Stack wie Web-App) |
| **DB** | `infiniloop.db` (Channel-Configs, Project-Configs, Agent-Jobs) | `garten.db` (Tasks, service_providers, agent_call_log) |
| **Slack-Channel** | `#refugium-heideland-management` (`C0AUAD6QY2U`) | Gleicher Channel |
| **Bot-User** | Bestehender InfiniLoop-Bot (`@infiniloop-bot`) | Eigener `@garten-bot` (ENTSCHIEDEN 2026-04-17 durch Moritz — keine gemeinsame Bot-Identity, klare visuelle Trennung durch App-Name) |
| **Web-Rückfrage-UI** | InfiniLoop Phase 12 Magic-Link-Pattern für Reporter ohne Slack | **WIEDERVERWENDBAR**: Garten-Agent kann denselben Pattern nutzen → externer Elektriker bekommt Link zum Bestätigen eines Terminvorschlags. Implementierung: `POST /api/infiniloop/notify_reporter` in Voigt-Garten-Backend (siehe Phase 12 §1.4) |

**Kein Scope-Overlap:** Beide Agenten lesen die gleiche `projects`-Tabelle, filtern aber nach Kategorie. InfiniLoop nimmt nur `it`-Tasks (siehe `channel_configs[id=3]`), Garten-Agent ignoriert `it` explizit per Filter.

---

## 8. Out-of-Scope für Phase 1

Wird **nicht** in F.2 gebaut:

- **Automatische Voice-Calls** an Dienstleister (Stufe 4) — Task #101, siehe §7.
- **Zahlungs-Triggern** (keine Auto-Überweisung an Dienstleister).
- **Dispatcher-Logik** (welcher von 3 Elektrikern wird gewählt) — Phase 1 nimmt einfach den ersten `service_providers`-Eintrag mit passender `default_for_categories`. Multi-Provider-Selection per Rating/Verfügbarkeit ist Phase 2.
- **Inbound-Slack-DM-Verarbeitung** beim Garten-Agent (Moritz' Befehle laufen weiterhin über COO, der den Garten-Agent via REST anstößt). `@garten-bot` ist **Output-only** in Phase 1.
- **Interaktive Slack-Buttons** (z.B. „Task als erledigt markieren") — Phase 2, sobald Event-Subscription für `@garten-bot` eingerichtet ist.

---

## 9. Sicherheit / DSGVO

### Email-Versand an Dienstleister (Stufe 2)
- **Opt-Out**: `service_providers.agent_disabled = 1` → Agent mailt nie.
- **Template-basiert**, keine LLM-generierten Inhalte in Phase 1 → kein Prompt-Injection-Risiko.
- Absender: `garten@infinityspace42.de` (bestehender Resend-Sender), Reply-To: Moritz.

### Rate-Limiting
- Max. 3 automatische Mails pro Dienstleister pro 7 Tage (anti-spam).
- Max. 10 Eskalations-Aktionen pro 6-h-Worker-Run (Schutz gegen Runaway-Loop nach DB-Migration).

### Audit
- Jede Eskalations-Aktion wird in `agent_actions_log` geloggt mit `action_type IN ('reminder', 'email_sent', 'slack_dm', 'telegram_alert')`.

### Voice-spezifische DSGVO-Regeln
- Werden mit Task #101 ergänzt. Merke für später: Pflicht-Hinweis im ersten Satz, `record_audio: false`, Transcript-TTL 90 Tage.

---

## 10. Akzeptanzkriterien für F.2 (Implementation)

Konkret testbar — F.2 ist abgeschlossen wenn alle 5 grün:

1. **Stufe-3-Trigger:** Test-Task mit `due_date = '2026-04-10'` (7 Tage in Vergangenheit) und Kategorie `'rasen'` triggert binnen 6 h einen Eintrag in `agent_escalation_state` mit `current_stage=3` und eine Slack-DM an Moritz via `@garten-bot` (+ Telegram-Fallback).
2. **Notfall-Beschleunigung:** Test-Task mit Kategorie `'wasser'`, `due_date` nur 2 Tage überfällig → Stufe 3 bereits getriggert (statt 7-Tage-Standard).
3. **Email-Stufe 2:** Test-Task mit Kategorie `'elektrik'`, Dienstleister-Zuordnung via `default_for_categories`, `due_date` 1 Tag überfällig → Mail an Dienstleister-Email gesendet, geloggt in `agent_actions_log`.
4. **COO-Tagesplan-Integration:** `GET /api/garten/agent/status` mit gültigem `X-COO-Secret` liefert JSON mit `active_escalations`-Array, das von `get_voigt_garten_items()` in den Tagesplan eingebaut wird (sichtbar im COO-Output). Moritz sieht jede Aktion im Morgen-Tagesplan.
5. **InfiniLoop-Abgrenzung:** Test-Task mit Kategorie `'it'` wird vom Garten-Agent **nicht** angefasst (kein `agent_escalation_state`-Eintrag). InfiniLoop's Auto-PR-Flow läuft unverändert.

**Performance-Budget:** `agent_worker.py`-Run < 30 Sekunden (über alle offenen Tasks), keine Lock-Konflikte mit Web-App-Schreibzugriffen (WAL-Mode bereits aktiv).

---

## Anhang A: Datei-Inventar für F.2 (geplant)

| Datei | Status | Zweck |
|---|---|---|
| `pi-backend/agent_worker.py` | NEU | Cron-Worker, scannt überfällige Tasks, eskaliert |
| `pi-backend/agent_escalation.py` | NEU | Stufen-Logik, Trigger-Berechnung |
| `pi-backend/slack_service.py` | NEU | `@garten-bot` Slack-WebClient (eigenes Token) |
| `pi-backend/agent_routes.py` | NEU | Flask-Blueprint für `/api/garten/agent/*` |
| `pi-backend/app.py` | EDIT | Blueprint registrieren, Cron-Aufruf |
| `pi-backend/email_service.py` | EDIT (minimal) | Neue Template-Funktion `send_provider_reminder()` |
| `Dokumentation/app/coo/prompts.py` | EDIT (Cross-Repo, minimal) | `get_voigt_garten_items()` um Eskalations-Block erweitern |

---

**Konzept-Status:** Phase 1 ist damit vollständig entschieden. Keine offenen Blocker für F.2.
**Nach Freigabe:** Worker F.2 startet mit DB-Migration → Slack-App-Provisioning für `@garten-bot` → Cron-Worker → API-Endpoints.

---

## Änderungsprotokoll

- **2026-04-17 (Moritz):** Bot-Strategie entschieden → eigener `@garten-bot` im Voigt-Garten-Container. InfiniLoop bleibt strikt für IT-Tasks. §2 und §7.5 aktualisiert.
- **2026-04-17 (Moritz):** Voice-Calls (ehem. Stufe 4) aus Phase 1 herausgenommen — zu früh, manuelles Telefonieren reicht. Idee als Garten-Task #101 parkiert. §2, §4, §5, §6, §7, §8, §9, §10 und Anhang A entschlankt. Konzept ist damit frei von offenen Voice-Entscheidungen.
