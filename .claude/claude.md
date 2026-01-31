# Voigt-Garten - Projekt Dokumentation

**Familien-Garten Management System - Pi-Hosted**

---

## Architektur

```
Internet
    |
Cloudflare Tunnel (garten.infinityspace42.de)
    |
Docker Container (voigt-garten-app:5055)
    |-- Flask/Gunicorn (API + Static Files)
    |-- SQLite DB (/app/data/gallery.db)
    |-- Bilder (/app/public/images/gallery/)
    |
Volume Mounts -> Pi Filesystem
```

### Warum Pi-Hosting statt Cloudflare Pages?

1. **Bilder/Videos auf Pi** - 836GB verfugbar, keine Cloudflare-Limits
2. **SQLite direkt auf Pi** - Keine D1-Datenbank nötig
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
|-- public/                 # Static Assets
|   |-- images/gallery/     # Hochgeladene Bilder (Volume)
|-- docs/                   # Dokumentation zum Garten
|   |-- infrastruktur-arbeiten.md  # Wasser, Elektrik, Heizung
|   |-- gartenbeschreibung.md      # Lage, Bebauung, Baumbestand
|   |-- kooperationsmodell.md      # Nutzungskonzept für Mitnutzer
|-- pi-backend/
|   |-- app.py              # Flask API + Static Serving
|   |-- email_service.py    # Resend Email
|   |-- gallery.db          # SQLite (Volume)
|   |-- requirements.txt
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
Response: { "status": "ok", "service": "voigt-garten-pi", "timestamp": "..." }
```

### Galerie
```
GET /api/gallery
GET /api/gallery?category=garten
Response: { "items": [...], "total": 10 }

POST /api/gallery/upload
Body: multipart/form-data (file, category, name, description)
Response: { "success": true, "id": "...", "url": "/images/gallery/..." }

DELETE /api/gallery/{item_id}
Response: { "success": true }
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

### Update/Rebuild

```bash
cd /home/moritz/stacks/voigt-garten
docker compose down
docker compose up -d --build
```

### Logs

```bash
docker logs voigt-garten-app -f
```

---

## Umgebungsvariablen

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `RESEND_API_KEY` | Resend API fur Emails | (required) |
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
    type TEXT DEFAULT 'image',
    size INTEGER,
    uploaded_at TEXT,
    uploaded_by TEXT
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

**Version:** 1.1
**Erstellt:** 2026-01-26
**Aktualisiert:** 2026-01-31
**Hosting:** Raspberry Pi 5 (via Cloudflare Tunnel)
