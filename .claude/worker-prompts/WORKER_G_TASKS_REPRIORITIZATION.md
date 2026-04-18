# Worker G — Tasks-Reprioritization Umsetzung

**Vorgänger:** Konzept-Doc `~/stacks/voigt-garten/docs/TASK_REPRIORIZATION_PLAN.md` (354 Zeilen, freigegeben 2026-04-18)
**Nachfolger:** Worker H (F.4 Notifications)
**Server:** IS42 (49.12.244.18), SSH-Alias `ssh is42`, User `moritz`
**Heute:** 2026-04-18 — Ziel-Buckets Mai/Juni/Juli 2026
**Sprache:** Antworte auf Deutsch mit echten Umlauten (ä/ö/ü/ß, nicht ae/oe/ue/ss).

---

## Kontext (für frischen Chat)

Der Garten-Agent (F.2 fertig 2026-04-17) hat Moritz mit Stufe-3-DMs geflutet, weil ~75 Tasks überfällige Due-Dates haben — aber keine davon ist faktisch ein Notfall. Tasks-Theresa hat den Reprioritization-Plan erarbeitet: Duplikate-Liste, 3-Bucket-Verteilung Mai/Juni/Juli, Recurring-Saisonalität via neuer `seasonal_months` JSON-Spalte, Wetter-Multiplikator als F.4-Skizze.

Dein Job: **Plan umsetzen**. DB-Writes, Schema-Migration, Daten-Cleanup. Keine Code-Änderungen im Flask-Backend nötig (außer Schema-Migration im Init-Script falls vorhanden).

---

## Pflicht-Lesestoff

1. `~/stacks/voigt-garten/docs/TASK_REPRIORIZATION_PLAN.md` via SSH — **das ist dein Bauplan, komplett lesen**
2. `C:\GitHub\voigt-garten\.claude\CLAUDE.md` (Projektregeln, Umlaute-Regel am Ende)
3. `C:\GitHub\InfinitySpace42\.claude\rules\UMLAUTE.md` + `TIMEZONE.md`
4. DB-Schema-Anlage-Script: `C:\GitHub\voigt-garten\pi-backend\app.py:init_db()` — dort werden Tabellen erstellt. Neue Spalte `recurring_tasks.seasonal_months` muss hier ergänzt werden, damit bei Container-Rebuild die Spalte persistiert.

---

## Moritz' bestätigte Entscheidungen

- **Reihenfolge:** Tasks-Fix zuerst (dieser Worker), dann F.4 (Worker H), dann F.3 (Worker I)
- **Seasonal-Feature:** Als Feature bauen (`seasonal_months` JSON-Spalte + Filter-Logik im Worker/Scheduler), nicht nur manuelle `is_active=0`-Toggles
- **Wetter-API:** Stub jetzt, komplette Umsetzung Phase 2 (F.4-Workstream später)
- **Obsolete Tasks:** Zu klären — siehe §10 im Konzept-Doc. Vorschlag: archivieren (neue Status-Option `archived`) statt löschen.

---

## Aufgaben (in Reihenfolge)

### Phase 1: DB-Backup + Schema-Migration

```bash
ssh is42 'cd ~/voigt-garten/data && cp garten.db garten.db.bak.$(date +%Y%m%d_%H%M%S)_worker_g'
```

**Schema-Änderungen (SQL):**
```sql
-- Neue Spalte für saisonale Recurring-Tasks
ALTER TABLE recurring_tasks ADD COLUMN seasonal_months TEXT DEFAULT '[]';
-- JSON-Array der Monate in denen der Task aktiv ist (1-12). Leer = alle Monate.

-- Projects: archive-Status (falls Moritz obsolete nicht löschen will)
-- Geht ohne Schema-Change, einfach status='archived' setzen.
```

Auch `pi-backend/app.py:init_db()` editieren — die `ALTER TABLE` dort ergänzen mit `try/except` damit Container-Rebuilds nicht crashen wenn Spalte schon da.

### Phase 2: Duplikate mergen

Laut Plan-Doc §2: 11 Duplikate. Pro Paar: den "behalten"-Task per UPDATE enrichen (z.B. bessere Description vom gelöschten übernehmen), dann "löschen"-Task auf `status='duplicate'` setzen (statt DELETE — DB-Historie behalten).

Vorschlag Moritz bestätigen VOR Ausführung (AskUserQuestion pro Duplikat-Paar ist overkill — zeig ihm die komplette Merge-Liste als Markdown-Tabelle einmal und frag nur "alles ok, einige anders, stop").

### Phase 3: Obsolete Tasks

Oster-2026-Tasks (#40, #41, #90). Laut Moritz nachzufragen — archivieren oder löschen. Vorschlag: `status='archived'` + Kommentar `description += ' (archiviert 2026-04-18, Oster-Fenster vorbei)'`.

### Phase 4: Priorisierungs-Umsetzung (Mai/Juni/Juli)

Pro Task aus den drei Bucket-Tabellen im Plan-Doc §4/§5/§6:
```sql
UPDATE projects
   SET due_date = ?,
       priority = ?,
       updated_at = datetime('now', 'localtime')
 WHERE id = ?;
```

Batch-Script schreiben (`~/stacks/voigt-garten/scripts/reprioritize_tasks.py` oder SQL-Datei `/tmp/reprioritize.sql`). Als einzelne Transaktion ausführen, damit bei Fehler nichts Halbes in der DB bleibt.

### Phase 5: Recurring-Tasks saisonalisieren

Laut Plan-Doc §7 — 19 von 23 Tasks. Pro Task:
```sql
UPDATE recurring_tasks
   SET seasonal_months = ?,  -- z.B. '[5,6,7,8,9,10]' für Rasenmähen
       cycle_days = ?,       -- ggf. anpassen
       next_due = ?          -- auf ersten aktiven Monat setzen falls nötig
 WHERE id = ?;
```

### Phase 6: Agent-Escalation-State Cleanup

Nach Due-Date-Update sind die bisherigen Eskalationen obsolet. Alle aktiven cancellen (Moritz hat die heute schon mal gecancelled, aber ein frischer Durchlauf ist sauber):
```sql
UPDATE agent_escalation_state
   SET cancelled = 1,
       cancel_reason = 'reprioritized_2026_04_18',
       updated_at = datetime('now','localtime')
 WHERE COALESCE(cancelled,0) = 0;
```

### Phase 7: Agent-Worker Logik erweitern (seasonal_months respektieren)

Der Eskalations-Worker (`pi-backend/agent_worker.py`) und die Recurring-Logik (`complete_project` in `app.py` oder ähnlich) müssen `seasonal_months` berücksichtigen:

**Regel:** Wenn `seasonal_months` nicht leer ist UND `strftime('%m', 'now', 'localtime')` nicht drin ist → Task wird übersprungen (kein Eskalieren, kein Wiederkehr-Scheduling).

Implementierung in `agent_worker.fetch_overdue_tasks()`:
```python
current_month = int(datetime.now().strftime("%m"))
# In der Python-Filter-Pipe: skip wenn seasonal_months gesetzt und current_month not in seasonal_months
```

Gleiche Logik in der Recurring-Next-Due-Berechnung (wo immer die liegt — vermutlich `complete_project` in `app.py`).

### Phase 8: Smoke-Test

```bash
# 1. Zählung vorher/nachher
ssh is42 "sqlite3 ~/voigt-garten/data/garten.db 'SELECT status, COUNT(*) FROM projects GROUP BY status'"

# 2. Keine überfälligen Tasks mehr (außer explizit behaltene)
ssh is42 "sqlite3 ~/voigt-garten/data/garten.db \"SELECT COUNT(*) FROM projects WHERE due_date < DATE('now','localtime') AND COALESCE(status,'offen')='offen' AND COALESCE(category,'') != 'it'\""
# Erwartet: 0

# 3. Agent-Worker manuell triggern
ssh is42 "curl -s -X POST -H 'X-COO-Secret: <SECRET>' http://localhost:5055/api/garten/agent/run-now"
# Erwartet: escalated=0, skipped > 0 (weil Due-Dates in Zukunft)

# 4. Saisonale Recurring: Rasenmähen (seasonal_months='[5,6,7,8,9]') in April triggert nicht
ssh is42 "sqlite3 ~/voigt-garten/data/garten.db 'SELECT title, seasonal_months FROM recurring_tasks WHERE category=\"rasen\"'"
```

### Phase 9: Deploy

```bash
cd C:/GitHub/voigt-garten
git add pi-backend/app.py pi-backend/agent_worker.py scripts/ # je nach was geändert
git commit -m "feat(reprioritization): Bucket-Plan Mai/Juni/Juli + seasonal_months"
git push origin main

ssh is42 "bash ~/voigt-garten/rebuild-voigt-garten.sh"
# Rebuild ist async, abwarten bis container healthy
ssh is42 "until docker ps --format '{{.Names}}|{{.Status}}' | grep voigt-garten-app | grep -q healthy; do sleep 5; done"
```

### Phase 10: Doku + CLAUDE.md

- CLAUDE.md: neue Sektion "Task-Priorisierung + Saisonalität" oder Abschnitt in bestehender DB-Schema-Doku um `seasonal_months` ergänzen
- Plan-Doc `TASK_REPRIORIZATION_PLAN.md` am Ende um "Umsetzungs-Status 2026-04-..." ergänzen mit Ergebnis-Counts

---

## Stolperfallen

- **SQLite WAL-Mode:** muss aktiv bleiben. WAL-Checkpoint nach großen Updates: `PRAGMA wal_checkpoint(TRUNCATE)`.
- **`datetime('now', 'localtime')`:** IMMER für SQLite-Defaults (Europe/Berlin, nicht UTC).
- **Schema-Migration in `init_db()`:** Neue ALTER TABLE-Statements IMMER in try/except — sonst crashed Container-Rebuild bei bestehender DB (Spalte schon da → SQLite wirft Fehler).
- **SSH-Befehle bündeln:** fail2ban aktiv auf IS42. Nicht >4 SSH-Calls/Minute.
- **Backup zuerst:** IMMER `garten.db.bak.worker_g` anlegen bevor UPDATE/DELETE.
- **JSON-Arrays:** SQLite speichert `seasonal_months` als TEXT. Python-Code muss `json.loads()` nutzen — sonst crasht React-Frontend wenn es die Daten über API bekommt (siehe CLAUDE.md-Pitfall-Abschnitt).
- **Kategorie-Filter `launch-offline`:** Moritz hat die vermutlich als manuelle Checkliste angelegt, teilweise Duplikate zu `rechtliches`. Siehe Duplikat-Liste im Plan-Doc.
- **Agent-Worker-Integration:** `fetch_overdue_tasks` JOINed NICHT mit `recurring_tasks` (es sind separate Tabellen). Die `seasonal_months`-Logik gilt nur für Recurring-Scheduling, nicht für die einmaligen Eskalationen (die haben kein `seasonal_months`).

---

## Akzeptanzkriterien

1. **DB-Counts:** `projects`-Zählung (status='offen', category != 'it', due_date < today) = 0 nach Umsetzung
2. **Duplikate erledigt:** die 11 im Plan-Doc genannten Duplikate haben `status='duplicate'` oder sind gelöscht
3. **Obsolete:** die 3 Oster-Tasks haben `status='archived'`
4. **Saisonalität:** `recurring_tasks.seasonal_months` für 19 Tasks gesetzt
5. **Agent-Worker:** manueller Run nach Umsetzung eskaliert 0 Tasks (alle Due-Dates in Zukunft)
6. **Container healthy:** Nach Deploy `docker ps` zeigt `voigt-garten-app` healthy
7. **CLAUDE.md** um Seasonal-Months-Sektion ergänzt
8. **Git:** 1-2 Commits auf main, gepusht

---

## Bericht-Format (max. 300 Wörter, an Moritz zurück)

1. DB-Backup erstellt: ja/nein, Pfad
2. Schema-Migration: ausgeführt ja/nein, Spalten verifiziert
3. Duplikate gemergt: X von 11 erledigt, Abweichungen begründet
4. Obsolete archiviert: X von 3
5. Priorisierung umgesetzt: Mai X, Juni Y, Juli Z Tasks
6. Recurring saisonalisiert: X von 19 Tasks
7. Eskalations-State: alle aktiven cancelled
8. Agent-Worker-Logik erweitert: ja/nein, getestet
9. Smoke-Tests: alle 6 Akzeptanzkriterien grün? Details pro Test
10. Deploy: Container healthy? URL check: https://garten.infinityspace42.de/api/health
11. CLAUDE.md: aktualisiert
12. Git-Commits: Hashes
13. Offene Fragen / Blocker, falls welche

---

## Slack-Bestätigung nach Erfolg

Poste in `#refugium-heideland-management` (`C0AUAD6QY2U`) via GartenBot:
```
:broom: Worker G abgeschlossen — Tasks reprioritiert, X Duplikate bereinigt, saisonale Recurring aktiv. Spam-Ursache behoben.
```
