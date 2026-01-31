# Voigt-Garten - Familien-Garten Management

**URL:** https://garten.infinityspace42.de

Ein privates Buchungs- und Wartungssystem für den Familiengarten in Etzdorf im Rosental.

---

## Features

### Buchungssystem
- Kalenderübersicht mit freien/belegten Zeiten
- Online-Buchungsformular
- Gutscheincode `VOIGT-GARTEN` für 50% Rabatt (Familienmitglieder)
- Buchungsbestätigung per Email (Resend API)

### Galerie
- Fotos und Videos vom Garten
- Automatische WebP-Konvertierung
- Thumbnail-Generierung
- Video-Optimierung via ffmpeg
- Kategorisierung (Gartenhaus, Terrasse, Luftaufnahmen, etc.)

### Dynamisches Aufgaben-System (NEU)
- **Kanban-Board** für Infrastruktur-Projekte
- 4 Spalten: Offen → Next → In Arbeit → Erledigt
- Drag & Drop (nur eingeloggt)
- Foto-Upload bei Erledigung
- **Admin-Bestätigung** vor Gutschrift
- Kategorien: Wasser, Elektrik, Haus, Garten

### Wartungs-Tracking
- Wiederkehrende Aufgaben mit Zyklen
- Status-Anzeige (Überfällig, Bald fällig, OK)
- Guthaben-System: Erledigte Arbeiten werden gutgeschrieben

### Admin-Bereich (`/admin`)
- Dashboard mit Statistiken
- Buchungsverwaltung (Bestätigen/Stornieren)
- Projekt-Bestätigungen (mit Credit-Vergabe)
- User-Verwaltung (Rollen: user/admin)

### Authentication
- JWT-basierte Authentifizierung
- Passwort-Login
- Rollen: Gast (nur lesen), User (bearbeiten), Admin (bestätigen)
- **Main-Admin:** moritzvoigt42@gmail.com

### Neue Seiten
- **`/ueber-den-garten`** - Animierte Präsentation (5.300m², Autarkie, Bebauung)
- **`/umgebung`** - Interaktive Leaflet-Karte mit POIs
- **`/admin`** - Admin-Dashboard

---

## Tech Stack

### Frontend
- **Framework:** Astro 4.x (Static Output)
- **Interaktivität:** React 18.x (Islands)
- **Styling:** Tailwind CSS 3.4
- **Icons:** Emoji-basiert
- **Maps:** Leaflet.js (OpenStreetMap)

### Backend
- **Server:** Flask (Python 3.11)
- **WSGI:** Gunicorn (2 Workers)
- **Auth:** PyJWT + Werkzeug Password Hashing
- **Datenbank:** SQLite3
- **Email:** Resend API
- **Image Processing:** Pillow (WebP), ffmpeg (Video)

### Deployment
- **Container:** Docker (Multi-Stage Build)
- **Hosting:** Raspberry Pi 5 (via Cloudflare Tunnel)
- **URL:** garten.infinityspace42.de → localhost:5055

---

## Datenbank-Schema

### users
```sql
id, email, username, password_hash, name, role, last_login, created_at
```

### projects (Kanban)
```sql
id, title, description, category, status, priority, estimated_cost,
effort, timeframe, assigned_to, completed_at, completed_by,
completion_photo, completion_notes, confirmed_at, confirmed_by,
credit_awarded, created_at, updated_at, created_by
```

### bookings
```sql
id, guest_name, guest_email, guest_phone, check_in, check_out,
guests, has_pets, total_price, discount_code, notes, status, created_at
```

### credits
```sql
id, guest_email, amount, reason, type, created_at
```

### gallery_images
```sql
id, filename, original_name, name, description, category, type,
size, uploaded_at, uploaded_by, thumbnail_path, webp_path, original_path
```

---

## API Endpoints

### Auth
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/auth/login` | POST | - | Login mit Email/Password |
| `/api/auth/logout` | POST | User | Logout |
| `/api/auth/verify` | GET | - | Token validieren |
| `/api/auth/register` | POST | Admin | Neuen User anlegen |

### Projects
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/projects` | GET | - | Liste aller Projekte |
| `/api/projects` | POST | User | Neues Projekt erstellen |
| `/api/projects/{id}` | PATCH | User | Projekt bearbeiten |
| `/api/projects/{id}/complete` | POST | User | Als erledigt markieren |
| `/api/projects/{id}/confirm` | POST | Admin | Bestätigen + Credit vergeben |
| `/api/projects/{id}` | DELETE | Admin | Projekt löschen |

### Admin
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/admin/stats` | GET | Admin | Dashboard-Statistiken |
| `/api/admin/pending-confirmations` | GET | Admin | Unbestätigte Erledigungen |
| `/api/admin/users` | GET | Admin | User-Liste |
| `/api/admin/bookings` | GET | Admin | Alle Buchungen |

---

## Lokale Entwicklung

```bash
# Dependencies installieren
npm install

# Dev Server starten (Frontend)
npm run dev

# Backend starten
cd pi-backend
pip install -r requirements.txt
python app.py
```

---

## Docker Deployment

```bash
# Build & Start
cd /home/moritz/stacks/voigt-garten
docker compose up -d --build

# Logs prüfen
docker logs voigt-garten-app -f

# Container neustarten
docker restart voigt-garten-app
```

---

## Umgebungsvariablen

```env
# Resend (Email)
RESEND_API_KEY=re_xxx

# JWT Secret (optional, hat Default)
JWT_SECRET=your-secret-key
```

---

## Garten-Daten

- **Fläche:** 5.300 m²
- **Lage:** Etzdorf im Rosental (Südhang)
- **Plus Code:** XXJ2+4JX Heideland
- **Autarkie:**
  - Solar: ~700W
  - Batterie: 1,4 kWh (Lithium-Ionen, 12V)
  - Wechselrichter: 2 kW
  - Brunnen: 50m tief
- **Gegründet:** ca. 1975

---

## Kontakt

Moritz Voigt - moritzvoigt42@gmail.com
