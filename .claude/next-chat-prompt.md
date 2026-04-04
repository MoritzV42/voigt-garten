# Voigt-Garten: Nächster Chat — Offene Aufgaben

## Stand: 2026-04-04

### Was in diesem Sprint implementiert wurde:
- **Phase 1** (voriger Sprint): Security, DB-Schema, Booking/Invoice APIs, Legal Pages, GardenMap, SEO
- **Phase 2** (dieser Sprint):
  1. 16 Gemini Legal-Tasks als DB-Seeds eingetragen (category='rechtliches')
  2. i18n-System: DeepL-Backend + useTranslation Hook + LanguageToggle (DE/EN)
  3. BookingForm: Live-Preisberechnung, Tagesnutzung-Toggle, AGB-Checkboxen, Stornierungsbedingungen
  4. Admin Invoice Tab: Filter, PDF-Aktionen, Bezahlt-Markierung
  5. Email-Templates: site_config IBAN, Feedback-Request, Google-Review-Followup, Zahlungserinnerung
  6. SVG bereinigt: 4MB → 5KB (gartenplan-shapes.svg)
  7. Reviews Widget auf Startseite ("Was unsere Gäste sagen")
  8. Tests erweitert: Neue API-Tests (Pricing, Reviews, Translation), Page-Tests (Legal), CI/CD Workflow
  9. CLAUDE.md aktualisiert, package.json aufgeräumt (wrangler/cloudflare entfernt)

---

## OFFENE AUFGABEN (nach Priorität):

### 1. HOCH: Placeholder-Werte ausfüllen
- Impressum: Name, Adresse, Steuernummer (sobald Gewerbe angemeldet)
- Datenschutz: Verantwortlicher, Adresse
- site_config: IBAN, BIC, account_holder → echte Bankdaten eintragen
- DEEPL_API_KEY in .env auf dem Server setzen (DeepL Free Account erstellen)

### 2. HOCH: Feedback-Page erstellen
- `/feedback?booking=<id>` Page fehlt noch (Email-Link zeigt dorthin)
- Sterne-Rating + Kommentar-Formular
- Automatischer Google-Review-Followup bei 4-5 Sternen

### 3. MITTEL: Automated Email-Trigger
- Cron/Scheduler für:
  - Feedback-Email 1 Tag nach Check-out
  - Zahlungserinnerung 7 Tage nach Buchung ohne Zahlung
- Könnte als separater Cron-Job oder im Gunicorn-Worker laufen

### 4. MITTEL: gartenplan-shapes.svg in GardenMap integrieren
- Aktuell nutzt GardenMap.tsx gartenplan-bg.jpg als Background
- Die bereinigte SVG als Overlay oder Ersatz einbauen
- Hover-Effekte auf die benannten Shapes

### 5. NIEDRIG: GitHub Actions Secrets konfigurieren
- SSH_HOST, SSH_USERNAME, SSH_KEY in GitHub Repo Settings eintragen
- Dann funktioniert Auto-Deploy bei Push zu main

### 6. NIEDRIG: @astrojs/cloudflare aus node_modules entfernen
- package.json ist bereinigt, aber `npm install` muss nochmal laufen
- Auf Server: `npm ci` beim nächsten Build bereinigt das automatisch

---

## Bekannte Issues:
- `astro check` schlägt fehl wegen Playwright-Test-Dateien (Build-Command ist `astro build` ohne check)
- Impressum/Datenschutz/AGB haben PLACEHOLDER-Werte
- site_config hat PLACEHOLDER-Werte für IBAN, BIC, account_holder
- Google Business Account existiert noch nicht → google_review_url ist Placeholder
- DEEPL_API_KEY fehlt auf dem Server (i18n funktioniert ohne Key, gibt aber Originaltexte zurück)

## Nicht in diesem Sprint (→ Zukunft):
- Stripe/PayPal Integration
- Kamera-System / Livestream
- Inventar-Checkout-Checkliste
- A/B-Test Firmenname
- Stammkunden-Automatik
