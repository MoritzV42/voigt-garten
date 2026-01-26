# Voigt-Garten - Familien-Garten Management

**URL:** https://garten.infinityspace42.de

Ein privates Buchungs- und Wartungssystem für den Familiengarten.

---

## Features

### Buchungssystem
- Kalenderübersicht mit freien/belegten Zeiten
- Online-Buchung mit Zahlungsintegration (Stripe)
- Gutscheincode `VOIGT-GARTEN` für 50% Rabatt (Familienmitglieder)
- Buchungsbestätigung per Email

### Galerie
- Fotos und Videos vom Garten
- Saisonale Eindrücke
- Upload-Bereich für Gäste

### Wartungs-Tab
- Alle Arbeiten kategorisiert (Rasenmähen, Beetarbeiten, Bäume, Brennholz, Elektrik, Putzen, etc.)
- Wartungszyklen mit automatischen Erinnerungen
- Status-Tracking (Fällig, Überfällig, Erledigt)
- Guthaben-System: Erledigte Arbeiten werden Mietern gutgeschrieben

### Dienstleister-Management
- Verifizierte Dienstleister-Datenbank (Gärtner, Elektriker, etc.)
- Automatische Email-Anfragen bei überfälligen Arbeiten
- Human-in-the-Loop: Emails werden vor Versand zur Genehmigung vorgelegt
- Preisvergleich und Bewertungen

### Claude-Integration
- Automatische Erkennung überfälliger Arbeiten
- Email-Entwürfe an Dienstleister
- Intelligente Priorisierung

---

## Tech Stack

- **Framework:** Astro 4.x mit React-Inseln
- **Styling:** Tailwind CSS
- **Datenbank:** Cloudflare D1 (SQLite)
- **Auth:** Cloudflare Access (Familie)
- **Payments:** Stripe
- **Email:** Resend
- **Hosting:** Cloudflare Pages
- **Functions:** Cloudflare Workers

---

## Lokale Entwicklung

```bash
# Dependencies installieren
npm install

# Dev Server starten
npm run dev

# Build für Production
npm run build

# Preview Build
npm run preview
```

---

## Deployment

Automatisches Deployment via GitHub → Cloudflare Pages.

```bash
# Manuelles Deployment
npx wrangler pages deploy dist
```

---

## Umgebungsvariablen

```env
# Stripe
STRIPE_PUBLIC_KEY=pk_live_xxx
STRIPE_SECRET_KEY=sk_live_xxx

# Resend (Email)
RESEND_API_KEY=re_xxx

# Cloudflare D1
DATABASE_ID=xxx

# Claude (optional für Auto-Emails)
ANTHROPIC_API_KEY=sk-ant-xxx
```

---

## Datenbank-Schema

### bookings
- id, guest_name, guest_email, check_in, check_out, amount, discount_code, status, created_at

### maintenance_tasks
- id, category, title, description, cycle_days, last_done, next_due, status, assigned_to

### service_providers
- id, category, name, email, phone, rating, notes, verified

### credits
- id, guest_email, amount, reason, created_at

---

## Offene Fragen (Placeholder)

1. **Preise:** Was kostet eine Nacht/Woche im Garten?
2. **Fotos:** Wo liegen die aktuellen Garten-Fotos?
3. **Familie:** Welche Email-Adressen sollen Zugang haben?
4. **Dienstleister:** Gibt es bereits bekannte Gärtner/Elektriker?
5. **Zahlungsmethoden:** Nur Karte oder auch Überweisung?

---

## Kontakt

Moritz Voigt - moritz.infinityspace42@gmail.com
