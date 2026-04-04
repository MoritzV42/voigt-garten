# Voigt-Garten - Projekt Dokumentation

**Familien-Garten Management System - Hetzner Cloud Hosted**

---

## Architektur

```
Internet
    |
Cloudflare Tunnel (garten.infinityspace42.de)
    |
Docker Container (voigt-garten-app:5055)
    |-- Flask/Gunicorn (API + Static Files)
    |-- SQLite DB (/app/data/garten.db)
    |-- Bilder (/app/public/images/gallery/)
    |
Volume Mounts -> Server Filesystem
```

### Warum Self-Hosting statt Cloudflare Pages?

1. **Bilder/Videos auf Server** - 80GB SSD, keine Cloudflare-Limits
2. **SQLite direkt auf Server** - Keine D1-Datenbank nötig
3. **Einfacher Workflow** - Alles an einem Ort
4. **Bekanntes Pattern** - Wie doku-app, reinhelden-crm etc.

---

## Dateien & Struktur

```
/home/moritz/voigt-garten/
|-- Dockerfile              # Multi-Stage Build
|-- astro.config.mjs        # Static output (nicht SSR)
|-- package.json            # Astro + React + Tailwind
|-- src/                    # Astro Frontend
|   |-- pages/
|       |-- index.astro     # Startseite
|       |-- buchen.astro    # Buchungssystem
|       |-- galerie.astro   # Fotogalerie
|       |-- wartung.astro   # Wartungsaufgaben + Guthaben
|       |-- dienstleister.astro  # Dienstleister-Management
|       |-- inventar.astro  # Inventar-Verwaltung
|       |-- auth/
|           |-- verify.astro # Magic Link Verify Page
|   |-- components/
|       |-- InventarPage.tsx    # Inventar Frontend (Gebäude/Räume/Gegenstände)
|       |-- VerifyPage.tsx      # Magic Link Verify Frontend
|       |-- EditableTable.tsx   # Wiederverwendbare inline-editierbare Tabelle
|       |-- AdminDashboard.tsx  # Admin-Dashboard (nutzt EditableTable für alle Tabs)
|-- public/                 # Static Assets
|   |-- images/gallery/     # Hochgeladene Bilder (Volume)
|-- docs/                   # Dokumentation zum Garten
|   |-- infrastruktur-arbeiten.md  # Wasser, Elektrik, Heizung
|   |-- gartenbeschreibung.md      # Lage, Bebauung, Baumbestand
|   |-- kooperationsmodell.md      # Nutzungskonzept für Mitnutzer
|-- pi-backend/
|   |-- app.py              # Flask API + Static Serving
|   |-- email_service.py    # Resend Email
|   |-- telegram_service.py # Telegram Bot Moderation
|   |-- telegram_agent.py   # Autonomer Telegram Bot Agent (@Garten_Bot)
|   |-- storage.py          # Storage-Interface (Local + erweiterbar)
|   |-- garten.db           # SQLite (Volume)
|   |-- requirements.txt
|   |-- start.sh            # Init + Migration + Gunicorn Start
|-- .claude/
|   |-- claude.md           # Diese Dokumentation

/home/moritz/stacks/voigt-garten/
|-- docker-compose.yml      # Container-Konfiguration
|-- .env                    # RESEND_API_KEY

/home/moritz/stacks/cloudflared/
|-- config.yml              # Tunnel inkl. garten.infinityspace42.de
```

---

## API Endpoints

### Health Check
```
GET /api/health
Response: { "status": "ok", "service": "voigt-garten", "timestamp": "..." }
```

### Galerie
```
GET /api/gallery
GET /api/gallery?category=garten
GET /api/gallery?include_pending=true  (Admin: zeigt auch pending/rejected)
Response: { "items": [...], "total": 10 }

POST /api/gallery/upload
Body: multipart/form-data (file, category, name, description)
Response: { "success": true, "id": "...", "url": "...", "status": "approved|pending" }
Note: Non-Admin Uploads → status='pending', Telegram-Moderation wird ausgelöst

POST /api/admin/gallery/panorama  (Admin only)
Body: multipart/form-data (file, name, description, category)
Note: Kein WebP-Konvertierung (Equirectangular muss original bleiben), type='panorama'

DELETE /api/gallery/{item_id}
Response: { "success": true }
```

### Telegram Webhook
```
POST /api/telegram/webhook
Body: Telegram Bot API callback (approve/reject Inline-Buttons)
Action: Setzt gallery_images.status auf 'approved' oder 'rejected'
```

### Hintergrundvideos
```
GET /api/background-video?page=startseite
Response: { "video_url": "/images/gallery/...", "page": "startseite" }

POST /api/admin/background-video  (Admin only)
Body: { "page": "startseite", "video_path": "...", "thumbnail_path": "..." }
```

### Livestream (Vorbereitung)
```
GET /api/livestream/cameras
Response: { "cameras": [], "available": false }
```

### Buchungen
```
GET /api/bookings
Response: { "bookings": [{ "checkIn": "...", "checkOut": "..." }] }

POST /api/bookings
Body: { "name", "email", "checkIn", "checkOut", "totalPrice", ... }
Response: { "success": true, "bookingId": 123 }
```

### Credits (Wartungsgutschriften)
```
GET /api/credits?email=user@example.com
Response: { "credits": [...], "total": 50.00 }
```

### Wartung
```
POST /api/maintenance/complete
Body: { "taskId", "completedBy", "notes", "creditValue" }
Response: { "success": true }
```

### Magic Link Auth
```
POST /api/auth/request-magic-link
Body: { "email": "user@example.com" }
Response: { "success": true, "message": "Magic Link gesendet" }
Note: Sendet Email mit Verify-Link via Resend

GET /api/auth/verify-email?token=...
Response: Redirect zu /auth/verify mit Token-Validierung
Note: Prüft Token-Gültigkeit, setzt Session/Cookie

POST /api/auth/complete-registration
Body: { "token": "...", "name": "Max Mustermann" }
Response: { "success": true, "user": { "email": "...", "name": "...", "role": "guest" } }
Note: Erstregistrierung nach erster Magic-Link-Verifizierung
```

### Inventar
```
GET /api/inventory/buildings
Response: { "buildings": [{ "id": 1, "name": "Gartenhaus", "floors": [...] }] }

POST /api/inventory/buildings
Body: { "name": "Gartenhaus", "description": "..." }
Response: { "success": true, "id": 1 }

GET /api/inventory/rooms?building_id=1
Response: { "rooms": [{ "id": 1, "name": "Wohnzimmer", "floor": "EG" }] }

POST /api/inventory/rooms
Body: { "building_id": 1, "floor_id": 1, "name": "Wohnzimmer" }
Response: { "success": true, "id": 1 }

GET /api/inventory/items?room_id=1
GET /api/inventory/items?building_id=1
GET /api/inventory/items?search=Schaufel
Response: { "items": [{ "id": 1, "name": "Schaufel", "category": "Werkzeug", ... }] }

POST /api/inventory/items
Body: { "room_id": 1, "name": "Schaufel", "category": "Werkzeug", "quantity": 2 }
Response: { "success": true, "id": 1 }

PATCH /api/inventory/items/{item_id}
Body: { "name": "...", "quantity": 3, "condition": "gut" }
Response: { "success": true }

DELETE /api/inventory/items/{item_id}
Response: { "success": true }

PATCH /api/inventory/floors/{floor_id}
Body: { "name", "icon", "sort_order" }

DELETE /api/inventory/rooms/{room_id}
Response: { "success": true } (fails if room has items)

DELETE /api/inventory/buildings/{building_id}
Response: { "success": true } (fails if building has rooms)
```

### Admin Galerie
```
PATCH /api/admin/gallery/{item_id}  (Admin only)
Body: { "name", "description", "category", "status" }
```

### Admin Credits
```
GET /api/admin/credits  (Admin only)
Response: { "credits": [...] }

POST /api/admin/credits  (Admin only)
Body: { "guest_email", "amount", "reason", "type" }

PATCH /api/admin/credits/{credit_id}  (Admin only)
Body: { "guest_email", "amount", "reason", "type" }

DELETE /api/admin/credits/{credit_id}  (Admin only)
```

### Kosten (Kostensystem)
```
GET /api/costs
Response: { "costs": [...] }

POST /api/costs  (Admin only)
Body: { "title", "amount", "frequency", "category", "date", "is_active" }

PATCH /api/costs/{cost_id}  (Admin only)
Body: { "title", "amount", "frequency", "category", ... }

DELETE /api/costs/{cost_id}  (Admin only)

GET /api/costs/summary
Response: { "monthly": 49.0, "yearly": 100.0, "once": 0, "total_yearly": 688.0 }
```

---

## Deployment

### Erstmaliges Setup

```bash
# 1. Stacks-Verzeichnis
cd /home/moritz/stacks/voigt-garten

# 2. Container bauen & starten
docker compose up -d --build

# 3. Cloudflared neu starten (fur Tunnel-Update)
cd /home/moritz/stacks/cloudflared
docker compose restart

# 4. Testen
curl http://localhost:5055/api/health
curl https://garten.infinityspace42.de/api/health
```

### Deploy (commit, push, rebuild)

1. Lokal committen und pushen (`git push`)
2. Rebuild-Skript ausführen:

```bash
ssh is42 "bash ~/voigt-garten/rebuild-voigt-garten.sh"
```

Das Rebuild-Skript (`~/voigt-garten/rebuild-voigt-garten.sh`) macht automatisch:
1. Git stash + pull
2. WAL-Checkpoint + DB-Backup
3. `docker compose up -d --build --force-recreate`
4. Health-Check

### Logs

```bash
docker logs voigt-garten-app -f
```

---

## Umgebungsvariablen

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `RESEND_API_KEY` | Resend API fur Emails | (required) |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token für Galerie-Moderation | (optional) |
| `TELEGRAM_CHAT_ID` | Telegram Chat-ID für Moderations-Nachrichten | (optional) |
| `DATA_DIR` | Pfad zur Datenbank | `/app/data` |
| `STATIC_DIR` | Astro Build Output | `/app/static` |
| `GALLERY_DIR` | Galerie-Bilder | `/app/public/images/gallery` |

---

## Datenbank-Schema

### gallery_images
```sql
CREATE TABLE gallery_images (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    original_name TEXT,
    name TEXT,
    description TEXT,
    category TEXT DEFAULT 'sonstiges',
    type TEXT DEFAULT 'image',       -- 'image', 'video', 'panorama'
    size INTEGER,
    uploaded_at TEXT,
    uploaded_by TEXT,
    thumbnail_path TEXT,
    webp_path TEXT,
    original_path TEXT,
    status TEXT DEFAULT 'approved'   -- 'pending', 'approved', 'rejected' (Migration)
);
```

### background_videos
```sql
CREATE TABLE background_videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page TEXT UNIQUE NOT NULL,       -- 'startseite', 'ueber-den-garten', 'umgebung'
    video_path TEXT NOT NULL,
    thumbnail_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### livestream_cameras (Vorbereitung)
```sql
CREATE TABLE livestream_cameras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    stream_url TEXT,
    hls_url TEXT,
    is_active BOOLEAN DEFAULT 0,
    privacy_mode BOOLEAN DEFAULT 1,  -- Kameras aus bei aktiver Buchung
    placeholder_image TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### bookings
```sql
CREATE TABLE bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_name TEXT NOT NULL,
    guest_email TEXT NOT NULL,
    guest_phone TEXT,
    check_in DATE NOT NULL,
    check_out DATE NOT NULL,
    guests INTEGER DEFAULT 2,
    has_pets BOOLEAN DEFAULT 0,
    total_price REAL NOT NULL,
    discount_code TEXT,
    notes TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT
);
```

### credits
```sql
CREATE TABLE credits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_email TEXT NOT NULL,
    amount REAL NOT NULL,
    reason TEXT NOT NULL,
    type TEXT DEFAULT 'earned',
    created_at TEXT
);
```

### email_verification_tokens
```sql
CREATE TABLE email_verification_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    used BOOLEAN DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### inventory_buildings
```sql
CREATE TABLE inventory_buildings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### inventory_floors
```sql
CREATE TABLE inventory_floors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id INTEGER NOT NULL REFERENCES inventory_buildings(id),
    name TEXT NOT NULL,              -- 'EG', 'OG', 'DG', 'Keller'
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### inventory_rooms
```sql
CREATE TABLE inventory_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    building_id INTEGER NOT NULL REFERENCES inventory_buildings(id),
    floor_id INTEGER REFERENCES inventory_floors(id),
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### inventory_items
```sql
CREATE TABLE inventory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES inventory_rooms(id),
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,                   -- 'Werkzeug', 'Möbel', 'Elektro', 'Garten', etc.
    quantity INTEGER DEFAULT 1,
    condition TEXT DEFAULT 'gut',    -- 'neu', 'gut', 'gebraucht', 'defekt'
    image_path TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### inventory_furniture_meta
```sql
CREATE TABLE inventory_furniture_meta (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES inventory_items(id),
    material TEXT,
    dimensions TEXT,                 -- z.B. '120x80x75cm'
    weight_kg REAL,
    brand TEXT,
    purchase_date TEXT,
    purchase_price REAL,
    warranty_until TEXT
);
```

### garden_costs
```sql
CREATE TABLE garden_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    amount REAL NOT NULL,
    frequency TEXT DEFAULT 'einmalig',  -- 'einmalig', 'monatlich', 'jährlich'
    category TEXT,
    date TEXT,
    end_date TEXT,
    is_active BOOLEAN DEFAULT 1,
    related_project_id INTEGER,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### projects (erweiterte Felder)
```sql
-- Recurring Tasks sind jetzt in projects integriert:
ALTER TABLE projects ADD COLUMN is_recurring BOOLEAN DEFAULT 0;
ALTER TABLE projects ADD COLUMN cycle_days INTEGER;
ALTER TABLE projects ADD COLUMN credit_value REAL DEFAULT 0;
-- Wenn is_recurring=1 und ein Task abgeschlossen wird, erstellt complete_project
-- automatisch einen neuen Task mit due_date = heute + cycle_days
```

---

## Bekannte Pitfalls

### SQLite JSON-Felder (WICHTIG)
Die Tabelle `projects` speichert `assigned_to_list` und `dependencies` als TEXT (JSON-Strings).
Beim Lesen aus der DB MUSS `json.loads()` aufgerufen werden, sonst gibt die API Strings statt Arrays zurück.
Das crashed das React-Frontend: `TypeError: g.map is not a function`.
**Alle API-Endpoints die Projekte zurückgeben müssen JSON-Felder parsen!**

### E2E-Tests (Playwright)
- Tests liegen in `tests/` (api, pages, wartung)
- Laufen gegen Produktion: `npx playwright test`
- React-Hydration kann 5-30s dauern - nie `networkidle` verwenden
- `waitForSelector` auf React-Elemente mit Retry-Helper

---

## Fehlerbehebung

### Container startet nicht
```bash
# Logs prüfen
docker logs voigt-garten-app

# Build-Fehler?
cd /home/moritz/voigt-garten
docker build -t voigt-garten-test .
```

### Website nicht erreichbar
```bash
# Tunnel prüfen
docker logs infinityspace42-cloudflared-1

# Port prüfen
curl http://localhost:5055/api/health

# DNS prüfen
nslookup garten.infinityspace42.de
```

### Bilder werden nicht angezeigt
```bash
# Galerie-Verzeichnis prüfen
ls -la /home/moritz/voigt-garten/public/images/gallery/

# Volume-Mount prüfen
docker exec voigt-garten-app ls -la /app/public/images/gallery/
```

---

## Cleanup (nach Umbau)

Folgende Dateien/Ordner werden nicht mehr benotigt:

- `wrangler.toml` - Cloudflare Pages Config
- `functions/` - Cloudflare Functions
- `.wrangler/` - Wrangler Cache
- `@astrojs/cloudflare` Dependency in package.json

---

## Garten-Dokumentation (docs/)

### Eigentümer
- **Name:** Konny Voigt
- **Telefon:** 01652593763
- **Doku-App Kunden-ID:** 80

### Dokumente

| Datei | Inhalt |
|-------|--------|
| `docs/infrastruktur-arbeiten.md` | Wasser, Elektrik, Heizung - technische Details und offene Arbeiten |
| `docs/gartenbeschreibung.md` | Lage (Etzdorf/Rosental), Bebauung, Baumbestand, 5.300m² Grundfläche |
| `docs/kooperationsmodell.md` | Mietfreie Nutzung gegen Erhaltungsleistungen, 2 Jahre Probezeit |

### Garten-Eckdaten
- **Lage:** Etzdorf im Rosental, Südhang
- **Fläche:** 5.300 m²
- **Autarkie:** Solar 700W + 1,4kWh Akku, Brunnen 50m tief
- **Bebauung:** Gartenhaus (Holz), Wintergarten, 4 Schuppen, Carport
- **Baumbestand:** Süßkirschen (50J), 2 Eichen (d>1m), 2 Eschen

### Verknüpfung mit Doku-App
- **Task #479:** Project Garten (Hauptprojekt)
- **Subtask #464:** Galerie-Fotos/Videos sammeln
- **Subtask #480:** Garten-Dokumentation vervollständigen

---

---

## Storage-Architektur

```python
# pi-backend/storage.py
StorageBackend (Interface)
  └── LocalStorage (aktiv)  # os.path.join, file.save, os.remove
  └── GoogleDriveStorage     # Zukunft: Google Drive API
  └── HetznerStorageBox      # Zukunft: Hetzner Storage Box (SFTP/WebDAV)
```

Interface-Pattern für spätere Nachrüstung vorbereitet. Upload-Endpoint nutzt `storage.save()`.

## Medientypen

| Typ | Beschreibung | WebP-Konvertierung | Viewer |
|-----|-------------|-------------------|--------|
| `image` | Standard-Fotos | Ja (automatisch) | img Tag / Lightbox |
| `video` | Videos (MP4) | Nein | video Tag mit Controls |
| `panorama` | 360°-Equirectangular | Nein (muss original bleiben) | Pannellum.js Viewer |

## Telegram Bot (@Garten_Bot)

### Galerie-Moderation
- Non-Admin Upload -> `status='pending'` -> Telegram-Nachricht mit Inline-Buttons (Freigeben/Ablehnen)
- Admin Upload -> `status='approved'` (sofort sichtbar)
- Webhook: `POST /api/telegram/webhook` verarbeitet Button-Callbacks

### Autonomer Agent (`telegram_agent.py`)
Keyword-basierter Bot (kein LLM), verarbeitet Nachrichten im konfigurierten Chat.

**Kommandos:**
- `/aufgaben` / `/tasks` -- Offene Wartungsaufgaben anzeigen
- `/inventar` / `/inventory` -- Inventar durchsuchen (z.B. `/inventar Schaufel`)
- `/buchungen` / `/bookings` -- Aktuelle und kommende Buchungen
- `/galerie` / `/gallery` -- Galerie-Statistiken (Anzahl Bilder, pending)
- `/status` -- System-Status (DB-Groesse, Speicherplatz, Container-Uptime)
- `/hilfe` / `/help` -- Alle verfuegbaren Kommandos anzeigen

**Architektur:**
- Polling-basiert (Long Polling via `getUpdates`)
- Laeuft als separater Thread im Gunicorn-Worker
- Greift direkt auf SQLite-DB zu (read-only fuer Abfragen)
- Konfiguration: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` in `.env`

---

## Neue Features (Phase 2 - April 2026)

### i18n-System
- `/api/translate` — POST mit `{texts: [...], target_lang: 'en'}`, DeepL Free API + DB-Cache
- `/api/translations/preload` — GET alle gecachten Übersetzungen
- `useTranslation()` Hook in `src/hooks/useTranslation.ts`
- `LanguageToggle` Komponente in Navbar (DE/EN)
- Env: `DEEPL_API_KEY` (optional, ohne Key werden Originaltexte zurückgegeben)

### Pricing & Booking
- `/api/pricing/calculate` — POST mit check_in, check_out, guests, isDayOnly
- `/api/availability?month=YYYY-MM` — gebuchte Tage
- `/api/bookings/<id>/cancel` — Stornierung mit Erstattungsberechnung
- BookingForm: Live-Preisberechnung, AGB/Datenschutz/Hausordnung-Checkboxen, Verfügbarkeitsanzeige, Tagesnutzung-Toggle

### Rechnungen (Admin)
- `/api/admin/invoices` — GET alle Rechnungen
- `/api/admin/invoices/<id>` — PATCH (bearbeiten)
- `/api/admin/invoices/<id>/generate-pdf` — POST PDF erzeugen
- `/api/admin/invoices/<id>/pdf` — GET PDF download
- `/api/admin/invoices/<id>/send` — POST per Email senden
- `/api/admin/invoices/<id>/mark-paid` — POST als bezahlt markieren
- `/api/bookings/<id>/create-invoice` — POST Rechnung aus Buchung erstellen
- Admin-Dashboard hat neuen "Rechnungen" Tab mit Filter und Aktions-Buttons

### Reviews
- `/api/reviews` — GET öffentliche Bewertungen (4-5 Sterne mit Kommentar)
- `ReviewsWidget` auf Startseite ("Was unsere Gäste sagen")

### Email-Templates
- Buchungsbestätigung: Zahlungsinfo aus site_config, Stornierungsbedingungen, Anfahrtshinweis
- `send_feedback_request()` — 1 Tag nach Check-out
- `send_google_review_followup()` — bei 4-5 Sternen
- `send_payment_reminder()` — nach 7 Tagen ohne Zahlung

### Legal Tasks (Seed)
- 16 rechtliche/bürokratische Tasks als `category='rechtliches'` in projects
- Cluster: Gewerbeanmeldung, Sanitär/Wasser, Sicherheit, Baurecht, Versicherungen, Plattform

### SVG-Karte
- `public/images/gartenplan-shapes.svg` — bereinigte SVG (5KB statt 4MB), nur Shapes mit normalisierten IDs
- 27 benannte Areas passend zu den map_area_descriptions in der DB

---

**Version:** 2.1
**Erstellt:** 2026-01-26
**Aktualisiert:** 2026-04-04
**Hosting:** Hetzner CX32 Cloud Server (4 vCPU, 8GB RAM, 80GB SSD, Debian 13, Falkenstein) via Cloudflare Tunnel
**SSH:** `ssh is42` (moritz@49.12.244.18)
