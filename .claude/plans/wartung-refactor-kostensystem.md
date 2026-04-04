# Plan: Wartung-Refactor + Kostensystem

## Kontext
Das Wartungssystem braucht Vereinfachung und ein Kostensystem für laufende Ausgaben. Recurring Tasks sollen wie normale Tasks funktionieren (gleiche UI, Drag&Drop), Timeline/Split-Views werden entfernt, start_date fällt weg.

---

## 1. Timeline & Split-View entfernen

### Frontend: `src/components/UnifiedKanban.tsx`
- **ViewMode Type** (Zeile 93): `'timeline' | 'split'` entfernen → nur `'kanban' | 'list'`
- **View-Buttons** (Zeile 1144-1160): Timeline- und Split-Buttons entfernen
- **Render-Logik** (Zeile 1179-1182): Timeline/Split-Branches entfernen
- **Funktionen** (Zeile 899-912): `renderTimelineView()` und `renderSplitView()` löschen
- **Import** (Zeile 4): `import GanttTimeline` entfernen

### Datei löschen: `src/components/GanttTimeline.tsx`
- Wird nirgendwo anders importiert

### Package: `frappe-gantt` Dependency entfernen
- `package.json` prüfen ob `frappe-gantt` drin ist → entfernen

---

## 2. start_date entfernen (nur due_date behalten)

### Frontend: `src/components/TaskDetailModal.tsx`
- **State** (Zeile 137): `startDate` State entfernen
- **Reset** (Zeile 151): `setStartDate` entfernen
- **Handler** (Zeile 387-394): `handleDateChange` vereinfachen, nur `due_date`
- **Input** (Zeile 548-551): Start-Datum Input-Feld entfernen
- **Label** umbenennen: "Fällig bis" statt "Enddatum"

### Frontend: `src/components/UnifiedKanban.tsx`
- **Task Interface** (Zeile 45): `start_date` entfernen
- **Sort-Optionen**: `start_date` Sort-Option entfernen

### Backend: `pi-backend/app.py`
- **Update-Fields** (Zeile 2018): `start_date` aus erlaubten Update-Feldern entfernen
- **Unified Tasks** Endpoint: `start_date` nicht mehr mitsenden (oder ignorieren)
- DB-Migration: Spalte kann bleiben (ALTER TABLE DROP COLUMN ist in SQLite umständlich), wird einfach ignoriert

---

## 3. Recurring Tasks = Normale Tasks mit Zyklus

### Konzept
Recurring Tasks sollen in der gleichen UI wie Projekte erscheinen, mit denselben Features:
- **Drag & Drop** zwischen Kanban-Spalten
- **Gleiche Felder**: priority, assigned_to, due_date (= next_due), etc.
- **Unterschied**: Nach Abschluss ("done") wird automatisch ein neuer Task mit `due_date = heute + cycle_days` erstellt

### Backend-Änderungen: `pi-backend/app.py`

#### Option A: Recurring Tasks in Projects-Tabelle migrieren (EMPFOHLEN)
- Neue Spalten in `projects`:
  ```sql
  ALTER TABLE projects ADD COLUMN is_recurring BOOLEAN DEFAULT 0
  ALTER TABLE projects ADD COLUMN cycle_days INTEGER
  ALTER TABLE projects ADD COLUMN credit_value REAL DEFAULT 0
  ```
- Migration: Alle bestehenden `recurring_tasks` → `projects` kopieren mit `is_recurring=1`
- `complete_project()` erweitern: Wenn `is_recurring=1`:
  1. Aktuellen Task auf `status='done'` setzen
  2. Neuen Task mit gleichem Titel/Beschreibung erstellen, `due_date = heute + cycle_days`, `status='offen'`
  3. Credit automatisch vergeben (wie bisher bei recurring)
- Alte `recurring_tasks` Endpoints als Wrapper behalten für Abwärtskompatibilität, oder komplett auf `/api/projects` umleiten

#### Unified Tasks Endpoint anpassen
- `/api/tasks/unified` braucht nur noch `projects` Tabelle abzufragen
- `task_type` Feld: `'project'` oder `'recurring'` (basiert auf `is_recurring`)

### Frontend-Änderungen

#### `src/components/UnifiedKanban.tsx`
- **Drag & Drop**: Guard `task.task_type !== 'project'` entfernen (Zeile 332, 352, 615, 621)
- Recurring Tasks bekommen gleiche Drag-Fähigkeit
- Task-Cards: Zyklus-Info anzeigen (🔄 alle X Tage) wenn `is_recurring`

#### `src/components/TaskDetailModal.tsx`
- Recurring-spezifische Felder einbauen wenn `is_recurring`:
  - `cycle_days` (Intervall in Tagen)
  - `credit_value` (automatisches Guthaben)
- Completion-Flow: Bei Recurring-Task nach Abschluss automatisch nächsten erstellen

#### `src/components/RecurringTaskEditor.tsx`
- Kann vereinfacht oder entfernt werden, da Recurring Tasks jetzt über die normale Kanban-UI verwaltet werden
- Admin-Tab "Wartung" kann stattdessen einen "Neuer wiederkehrender Task"-Button haben

---

## 4. Kostensystem (laufende Ausgaben)

### Zweck
Moritz braucht einen Überblick über die laufenden Kosten des Gartens (Starlink 49€/Monat, Pacht 100€/Jahr, Versicherung, etc.) und einmalige Ausgaben.

### Datenbank: Neue Tabelle `garden_costs`
```sql
CREATE TABLE IF NOT EXISTS garden_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    amount REAL NOT NULL,           -- Betrag in €
    frequency TEXT DEFAULT 'once',  -- 'once', 'monthly', 'quarterly', 'yearly'
    category TEXT,                  -- 'internet', 'pacht', 'versicherung', 'material', 'werkzeug', etc.
    date TEXT,                      -- Datum der Ausgabe / Start des Abos
    end_date TEXT,                  -- Optional: Ende eines Abos
    is_active BOOLEAN DEFAULT 1,   -- Für laufende Kosten: aktiv/inaktiv
    related_project_id INTEGER,     -- Optional: Verknüpfung mit Projekt
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### API Endpoints
| Methode | Pfad | Auth | Beschreibung |
|---------|------|------|-------------|
| GET | `/api/costs` | auth | Alle Kosten, optional `?category=X` |
| POST | `/api/costs` | admin | Neue Ausgabe eintragen |
| PATCH | `/api/costs/<id>` | admin | Ausgabe bearbeiten |
| DELETE | `/api/costs/<id>` | admin | Ausgabe löschen |
| GET | `/api/costs/summary` | auth | Zusammenfassung: monatliche/jährliche Gesamtkosten |

### Seed-Daten
```python
initial_costs = [
    ('Starlink Internet', 49.0, 'monthly', 'internet', 'Starlink Standard Kit'),
    ('Grundstückspacht', 100.0, 'yearly', 'pacht', 'Pachtvertrag mit Opa'),
]
```

### Frontend: Neuer Tab im Admin-Dashboard oder eigene Seite

#### Option: Tab "Kosten" im AdminDashboard
- **Übersicht-Kacheln**: Monatliche Gesamtkosten, Jährliche Gesamtkosten, Einmalkosten dieses Jahr
- **Kostenübersicht-Tabelle**: Sortierbar nach Datum, Betrag, Kategorie
  - Laufende Kosten mit Badge (🔄 monatlich / jährlich)
  - Einmalkosten mit Datum
- **"Neue Ausgabe"-Formular**: Titel, Betrag, Frequenz, Kategorie, Datum
- **Einfach gehalten** (Opa-tauglich): Große Buttons, klare Beschriftung

---

## 5. Abhängigkeiten für Tasks (Gemini-Daten)

Die Abhängigkeiten aus dem Gemini-Dokument eintragen:
- Task "Oster-Planung" → abhängig von "Pachtvertrag"
- Task "Baumarkt-Besorgungen" → abhängig von "Oster-Planung"
- Task "Software-Features" → abhängig von "Oster-Planung" (Währungs-Werte)
- Task "Rechtliches Backend" → abhängig von "Pachtvertrag"

Diese über die bestehende `dependencies` JSON-Spalte verknüpfen (nach dem Seeden die IDs auslesen).

---

## Reihenfolge der Implementierung

### Phase 1: Aufräumen (schnell)
1. Timeline + Split Views entfernen
2. start_date entfernen
3. GanttTimeline.tsx löschen, frappe-gantt entfernen

### Phase 2: Recurring Tasks vereinheitlichen (mittel)
4. DB-Migration: Neue Spalten in projects
5. Migration: recurring_tasks → projects kopieren
6. Backend: complete_project erweitern für recurring
7. Frontend: Drag&Drop für alle Tasks, Zyklus-Felder in TaskDetailModal

### Phase 3: Kostensystem (mittel)
8. DB: garden_costs Tabelle
9. Backend: CRUD Endpoints + Summary
10. Frontend: Kosten-Tab im Admin-Dashboard
11. Seed-Daten eintragen

### Phase 4: Feinschliff
12. Dependencies zwischen geseedeten Tasks setzen
13. RecurringTaskEditor vereinfachen/entfernen
14. Admin-Tab "Wartung" überarbeiten
15. Build + Deploy + Testen

---

## Dateien die geändert werden

| Datei | Änderung |
|-------|----------|
| `pi-backend/app.py` | DB-Migration, Recurring→Projects Migration, Kosten-Endpoints, complete_project erweitern |
| `src/components/UnifiedKanban.tsx` | Timeline/Split entfernen, ViewMode vereinfachen, DnD für alle Tasks |
| `src/components/TaskDetailModal.tsx` | start_date entfernen, Recurring-Felder, "Fällig bis" Label |
| `src/components/GanttTimeline.tsx` | LÖSCHEN |
| `src/components/RecurringTaskEditor.tsx` | Vereinfachen oder entfernen |
| `src/components/AdminDashboard.tsx` | Neuer "Kosten"-Tab |
| `package.json` | frappe-gantt entfernen |
