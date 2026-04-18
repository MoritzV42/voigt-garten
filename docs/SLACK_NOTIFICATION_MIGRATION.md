# Voigt-Garten F.4 — Admin-Notifications: Telegram → Slack

**Erstellt:** 2026-04-18
**Worker:** F.4 (`slack-steffan`, Konzept)
**Folge-Worker:** F.5 (Implementation, nach Moritz-Freigabe)
**Verwandte Konzepte:** F.1/F.2 (Garten-Agent Eskalation, `AGENT_CONCEPT.md`), F.3 (`GARTEN_AGENT_CHAT_CONCEPT.md`, Mention-basierter Chat-Layer)

---

## 1. Vision & Abgrenzung

Voigt-Garten verschickt heute alle Admin-Notifications (Moderationsanfragen Galerie, Buchungs-Events, Feedback, Rechnungen, Bewerbungen, System-Errors) an einen **privaten Telegram-Chat**, den nur Moritz liest. Das hat in Phase 1 gut funktioniert, aber seit F.1/F.2 ist Moritz eh den halben Tag in Slack (`#refugium-heideland-management`, `C0AUAD6QY2U`) wegen der Garten-Agent-Eskalations-Posts. Zwei Admin-Kanäle parallel zu pflegen ist Quatsch — besonders weil der Telegram-Bot zunehmend „second-class citizen" wird (keine Rich-Blocks, keine Threads, keine Suche, keine Mention-Routing-Integration mit dem Garten-Agent-Chat aus F.3).

**Ziel F.4:** Alle **internen** Admin-Notifications ziehen von Telegram nach Slack um. **Externe** Kommunikation (Gäste-Buchungsbestätigungen, Dienstleister-Erinnerungen, Bewerber-Antwortmails, Feedback-Requests nach Check-out) bleibt bei **Email via Resend** — Slack ist kein Ersatz für Email an externe Empfänger. F.4 ist ein reines Infrastruktur-Refactoring des Notification-Layers; keine User-facing Feature-Änderung.

**Klare Abgrenzung zu anderen F-Workern:**
- **F.2 (Garten-Agent Eskalation):** postet bereits in Slack via `slack_service.py`. F.4 baut **auf `slack_service.py` auf**, ersetzt es nicht. Nur die Notification-Hub-Funktionen (`notify_admin`, `notify_booking`, …) ziehen um.
- **F.3 (Garten-Agent Chat-Layer):** konsumiert `app_mention`-Events von Slack (wenn Moritz `@GartenBot Was steht heute an?` schreibt). F.4 konsumiert `interactivity`-Payloads (wenn Moritz einen Button in einer Moderations-Karte drückt). Beide nutzen denselben Slack-App (`@GartenBot`), aber **unterschiedliche Request-URLs** (siehe §8).
- **Telegram-Agent (`telegram_agent.py`):** der READ-Command-Bot (`/aufgaben`, `/inventar`, …) bleibt **bis F.3 live ist** parallel online. F.4 deprecatet nur `telegram_service.py`, nicht `telegram_agent.py` (siehe §9).

---

## 2. Telegram-Inventar (Ist-Zustand)

Analyse von `pi-backend/telegram_service.py` + allen Call-Sites in `pi-backend/app.py` und `pi-backend/email_draft_service.py`:

| # | Funktion | Wo getriggert (Datei:Zeile) | Inhalt | Interaktiv? | Ersatz-Slack-Funktion |
|---|---|---|---|---|---|
| 1 | `send_moderation_request` | `app.py:1959` (Gallery-Upload von Nicht-Admin, `status='pending'`) | Foto-Thumbnail + Titel + Kategorie + Uploader + Approve/Reject-Buttons | **JA** (Inline-Keyboard `approve:ID` / `reject:ID`) | `send_moderation_request_slack()` — Block-Kit mit Image + Buttons; Actions `approve_gallery`/`reject_gallery` mit `value=image_id` |
| 2 | `notify_booking` | `app.py:2261` (POST `/api/bookings`, neue Buchung) | Gast-Name, Email, Check-In, Check-Out, Personen, Preis | NEIN | `notify_booking_slack()` — Block-Kit mit Feldern + Link „Zum Dashboard" |
| 3 | `notify_admin('booking_cancelled')` | `app.py:2605` (POST `/api/bookings/<id>/cancel`) | Gast, Zeitraum, Erstattungs-Betrag, Grund | NEIN | `notify_admin_slack('booking_cancelled', ...)` |
| 4 | `notify_admin('invoice_sent')` | `app.py:2718` (POST `/api/admin/invoices/<id>/send`) | Rechnungs-Nr., Gast, Betrag | NEIN | `notify_admin_slack('invoice_sent', ...)` |
| 5 | `notify_admin('invoice_paid')` | `app.py:2741` (POST `/api/admin/invoices/<id>/mark-paid`) | Rechnungs-Nr., Gast, Betrag | NEIN | `notify_admin_slack('invoice_paid', ...)` |
| 6 | `notify_feedback` | `app.py:2796` (POST `/api/feedback`, Gast-Bewertung) | Sterne, Kommentar, Teil-Bewertungen | NEIN | `notify_feedback_slack()` — Block-Kit mit Sterne-Rendering |
| 7 | `notify_job_application` | `app.py:2412` (POST `/api/applications`, Bewerbung) | Name, Email, Telefon, Position, Motivation, Lebenslauf-Flag | NEIN | `notify_job_application_slack()` — Block-Kit mit Link zu `/admin#applications` |
| 8 | `notify_email_sent` | (definiert, aktuell nicht aktiv aufgerufen in `app.py`) | Empfänger, Betreff, Typ, Anhang | NEIN | `notify_email_sent_slack()` (optional, siehe §6) |
| 9 | `notify_admin` (allgemein via `_notify_telegram_draft`) | `email_draft_service.py:170` (neuer Email-Entwurf vom Garten-Agent) | Draft-ID, Empfänger, Betreff | NEIN | `notify_email_draft_slack()` — Block-Kit mit Link zu `/admin#email-drafts` |
| 10 | `notify_system_error` | (definiert, aktuell keine aktive Call-Site gefunden) | Fehler-Typ, Details | NEIN | `notify_system_error_slack()` — Post ohne Link, `:red_circle:` Emoji |

**Insgesamt 10 Funktionen, davon 1 interaktiv (Moderation).** Die `notify_admin`-Funktion ist der zentrale Hub — 4 direkte Call-Sites in `app.py`, plus alle spezialisierten Funktionen delegieren intern an `notify_admin`. Das heißt: es reicht, wenn `notify_admin_slack` sauber umgesetzt ist, dann kommen alle Event-Types kostenlos mit.

---

## 3. Channel-Strategie (mit Empfehlung)

Drei Optionen wurden evaluiert:

| Option | Vorteile | Nachteile |
|---|---|---|
| **A: Alles in `#refugium-heideland-management`** | Ein Ort, einfach zu suchen, konsistent mit Garten-Agent-Eskalationen aus F.2, zukunftssicher falls Konny oder weitere Familienmitglieder beitreten | Moderations-Buttons, Buchungs-Pings und Agent-Eskalationen mischen sich — Channel wird schneller „laut" |
| **B: Zweiter Channel `#refugium-admin`** | Klare Trennung Notifications vs. Agent-Eskalationen; Team-Channel bleibt übersichtlich | Zwei Channels pflegen; Moritz muss zwischen ihnen wechseln; kein Mehrwert, solange nur Moritz liest |
| **C: Alles als DM an Moritz** (`U0ASYE5UPQR`) | Kein Channel-Noise; sehr privat | Kein Audit-Trail; zweite Person kann später nicht mitlesen; DMs sind nicht threadfähig wie Channel-Posts; widerspricht dem Gedanken, dass Garten-Agent-Aktionen transparent sein sollen |

**Empfehlung: Option A — alles in `#refugium-heideland-management`**, mit zwei Verfeinerungen:

1. **Pro Event-Type konsistente Emojis** (Header-Emoji entspricht dem Telegram-Pendant aus `EVENT_EMOJIS`), damit Moritz beim Scrollen Farben/Symbole scannt statt Text zu lesen.
2. **System-Errors und Moderations-Requests zusätzlich als DM** an Moritz (`U0ASYE5UPQR`). Diese beiden Kategorien sind zeitkritisch (Moderation: Upload wartet; Error: Downtime möglich) und sollen auch dann den Notifier triggern, wenn Slack-Mobile den Channel stummgeschaltet hat. DMs bypassen Channel-Mute. Andere Events (Buchung, Feedback, Rechnung) bleiben channel-only.

**Begründung Einzeiler:** Ein Ort = weniger kognitiver Overhead; Moderation + Errors zusätzlich als DM, weil sie nicht untergehen dürfen; Konsistenz mit F.2 (Eskalations-Posts liegen bereits dort).

---

## 4. Architektur (neue Dateien + Slack-App-Änderungen)

### Neue Backend-Dateien

| Datei | Status | Zweck |
|---|---|---|
| `pi-backend/slack_notifications.py` | NEU | Pendant zu `telegram_service.py`: Notification-Hub + Event-spezifische Funktionen (`notify_booking_slack`, `notify_feedback_slack`, `send_moderation_request_slack`, …). Jede Funktion baut Block-Kit-Payload und ruft `slack_service.post_channel()` und ggf. `slack_service.send_dm()`. |
| `pi-backend/slack_interactivity.py` | NEU | Flask-Blueprint mit POST-Handler für Interactive-Payloads (Approve/Reject-Buttons). Route: `/api/garten/slack/interactivity`. Verifiziert Slack-Signing-Secret (shared Helper aus F.2/F.3), parsed `payload`-Form-Field, dispatched zu Handler pro `action_id`. Wichtig: ACK innerhalb 3 s (`return '', 200` synchron), Follow-up über `response_url` oder `chat.update`. |
| `pi-backend/slack_service.py` | EDIT | Um Block-Kit-Helper für Moderations-Karten erweitern (`build_moderation_blocks(image_id, image_url, uploader, title, category)` mit Approve/Reject-Buttons). Außerdem: Helper `verify_slack_signature(signing_secret, timestamp, body, signature)` (shared zwischen F.3 Events und F.4 Interactivity — **einer der beiden baut ihn, der andere importiert**, siehe §8). |
| `pi-backend/app.py` | EDIT | Import von `slack_notifications` statt `telegram_service`; Blueprint-Registrierung für `slack_interactivity`; Deprecation-Kommentar über dem alten Telegram-Import. Alle 10 Call-Sites aus §2 auf die neuen Slack-Funktionen umstellen (Feature-Flag-Wrapper, siehe §7). |
| `pi-backend/email_draft_service.py` | EDIT | Zeile 169: Import `slack_notifications.notify_email_draft_slack` statt `telegram_service.notify_admin`. |
| `pi-backend/start.sh` | EDIT | Zeile 29: Telegram-Webhook-Registrierung entfernen (wenn `NOTIFICATION_BACKEND=slack`). Slack-Webhook muss manuell in der Slack-App-UI gesetzt werden (keine API-Registrierung nötig). |

### Slack-App-Änderungen (`@GartenBot`)

Der Bot existiert bereits aus F.2 mit Scopes `chat:write`, `chat:write.public`, `im:write`. F.4 braucht zusätzlich:

- **Interactivity & Shortcuts** in der Slack-App-UI aktivieren (Tab „Interactivity & Shortcuts" → Toggle **On**).
- **Request-URL setzen:** `https://garten.infinityspace42.de/api/garten/slack/interactivity`
- **Zusätzliche Scopes:** Keine. Interactivity funktioniert mit bestehendem `chat:write`-Scope, weil der Handler nur auf Button-Payloads reagiert und ggf. `chat.update` callt (=`chat:write`).
- **Signing-Secret** (existiert bereits für F.2/F.3 als `GARTEN_SLACK_SIGNING_SECRET` in `.env`) wird für HMAC-Verifikation geteilt.

**App-Reinstall nötig?** Nein, weil kein neuer Scope. Nur Config-Toggle + URL-Eintrag in der Slack-App-Settings-UI.

### Migration-Strategie

Siehe §7 — empfohlen ist **Feature-Flag** `NOTIFICATION_BACKEND=telegram|slack|both`, Default `both` für 14 Tage Parallelbetrieb, dann Switch auf `slack`.

---

## 5. Interactivity-Setup (Approve/Reject-Buttons)

### Slack-Block-Kit-Beispiel für Moderations-Karte

```json
{
  "channel": "C0AUAD6QY2U",
  "text": "Neuer Galerie-Upload wartet auf Freigabe",
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": ":camera: Neuer Galerie-Upload", "emoji": true }
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*Titel:*\nKirschblüte 2026" },
        { "type": "mrkdwn", "text": "*Kategorie:*\ngarten" },
        { "type": "mrkdwn", "text": "*Uploader:*\nanna@example.com" },
        { "type": "mrkdwn", "text": "*Bild-ID:*\na1b2c3d4e5f6" }
      ]
    },
    {
      "type": "image",
      "image_url": "https://garten.infinityspace42.de/images/gallery/garten/kirschbluete_thumb.webp",
      "alt_text": "Upload-Vorschau"
    },
    {
      "type": "actions",
      "block_id": "gallery_moderation",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Freigeben", "emoji": true },
          "style": "primary",
          "action_id": "approve_gallery",
          "value": "a1b2c3d4e5f6"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Ablehnen", "emoji": true },
          "style": "danger",
          "action_id": "reject_gallery",
          "value": "a1b2c3d4e5f6"
        }
      ]
    },
    {
      "type": "context",
      "elements": [{ "type": "mrkdwn", "text": "Upload wartet auf Moderation · <https://garten.infinityspace42.de/admin#gallery|Im Dashboard öffnen>" }]
    }
  ]
}
```

### Request-Flow bei Button-Click

1. User klickt „Freigeben" in Slack.
2. Slack sendet POST an `https://garten.infinityspace42.de/api/garten/slack/interactivity` mit `Content-Type: application/x-www-form-urlencoded`, ein Feld namens `payload` enthält URL-enkodiertes JSON.
3. Handler muss **binnen 3 Sekunden** HTTP 200 zurückgeben, sonst rendert Slack einen Timeout-Error beim User.
4. Im Payload stehen: `type=block_actions`, `user.id`, `channel.id`, `message.ts`, `actions[0].action_id` (`approve_gallery` oder `reject_gallery`), `actions[0].value` (Image-ID), `response_url` (für späteres asynchrones Update).

### Handler-Pattern in `slack_interactivity.py`

```python
@bp.route('/api/garten/slack/interactivity', methods=['POST'])
def slack_interactivity():
    # 1. Signatur-Verifikation (HMAC SHA256 mit GARTEN_SLACK_SIGNING_SECRET)
    if not verify_slack_signature(request.headers, request.get_data()):
        return '', 401

    # 2. Payload parsen
    payload = json.loads(request.form['payload'])
    if payload.get('type') != 'block_actions':
        return '', 200  # ignorieren

    action = payload['actions'][0]
    action_id = action.get('action_id')
    value = action.get('value')

    # 3. Dispatch — synchron, schnell (< 3 s)
    if action_id == 'approve_gallery':
        _approve_gallery_image(value)
        _update_slack_message(payload, f"Freigegeben von <@{payload['user']['id']}>")
    elif action_id == 'reject_gallery':
        _reject_gallery_image(value)
        _update_slack_message(payload, f"Abgelehnt von <@{payload['user']['id']}>")

    return '', 200
```

`_update_slack_message` ruft `chat.update` (oder POST auf `response_url`), ersetzt den Block mit den Buttons durch eine Bestätigungs-Context-Zeile, damit klar ist: Aktion ausgeführt, keine Doppelklick mehr möglich.

### Signing-Secret-Verifikation

HMAC-Pattern exakt wie bei Events (F.3). Beide Endpoints (Events + Interactivity) teilen sich denselben `GARTEN_SLACK_SIGNING_SECRET`. Der Verify-Helper liegt in `slack_service.py` als `verify_slack_signature(headers, raw_body)` und wird von beiden Blueprints importiert. **Koordinations-Hinweis an F.3 (`chat-christoph`):** der Helper ist gemeinsam, wer zuerst merged übernimmt die Impl., der zweite importiert.

---

## 6. Email-Fallback-Regel

**Grundregel:** „Slack ersetzt Telegram. Email nur für Empfänger außerhalb des Teams."

Das bedeutet konkret:

| Notification-Typ | Heute (Telegram/Email-Mix) | Nach F.4 |
|---|---|---|
| Buchungsbestätigung an Gast | Email (Resend) | Email — **unverändert**, externer Empfänger |
| Buchungs-Notification an Moritz | Telegram + Admin-Email (`send_booking_notification_to_admin`) | **Slack only** — Admin-Email wird deprecatet (Moritz liest Slack eh) |
| Rechnungs-PDF an Gast | Email | Email — unverändert |
| Rechnung-versendet Admin-Ping | Telegram | Slack only |
| Bewerbungs-Confirmation an Bewerber | Email (`send_application_confirmation`) | Email — unverändert |
| Bewerbungs-Notification an Moritz | Telegram + Admin-Email | Slack only |
| Feedback-Request an Gast (T+1 nach Check-out) | Email | Email — unverändert |
| Dienstleister-Erinnerung (F.2 Stufe 2) | Email | Email — unverändert |
| Moderation-Request | Telegram | Slack (Channel + DM, §3) |
| Email-Draft-Approval-Ping | Telegram | Slack only |
| System-Error | Telegram | Slack (DM, §3) |

**Ausnahme/Notfall-Klausel:** Falls Slack ausfällt (`slack.com` down, Token revoked, Rate-Limit), fallback auf Email an `moritzvoigt42@gmail.com` mit Betreff `[GARTEN-FAIL] <event_type>`. Implementierung: Try/Except um alle `slack_service.post_channel`-Calls; bei `ok=False` → `email_service.send_admin_fallback(event_type, payload)`.

**Deprecated Admin-Emails:** `send_booking_notification_to_admin` und `send_application_notification_admin` bleiben im Code, werden aber nicht mehr aufgerufen (nur Fallback-Pfad via o.g. Ausnahme-Klausel). Entfernung frühestens 30 Tage nach F.5-Deploy, wenn keine Slack-Ausfälle registriert wurden.

---

## 7. Migration-Strategie (Big-Bang / Parallel / Feature-Flag)

Drei Varianten evaluiert:

| Variante | Vorteile | Nachteile |
|---|---|---|
| **Big-Bang** (Telegram aus, Slack an am Deploy-Tag) | Schnell, kein Parallel-Code | Hohes Risiko: wenn Slack-Setup bricht, gehen alle Notifications verloren; Moderations-Backlog staut sich |
| **Reines Parallel** (beide immer doppelt) | Null Notification-Verlust | Spam: Moritz bekommt jede Notification 2× auf Telegram + Slack; Moderations-Buttons auf beiden Channels führen zu Race-Conditions |
| **Feature-Flag `NOTIFICATION_BACKEND=telegram\|slack\|both`** | Schrittweise Umstellung, einfaches Rollback, in Tests nur Slack, in Produktion zunächst `both` | Minimal mehr Code (einmal Wrapper um alle Notification-Calls) |

**Empfehlung: Feature-Flag**, mit folgendem Rollout:

1. **Tag 0 (F.5-Deploy):** `NOTIFICATION_BACKEND=both`. Moritz sieht alle Notifications in Slack UND Telegram. Moderations-Buttons aber **nur in Slack aktiv** (Telegram sendet ohne Buttons, nur als Info-Post) — so gibt es keine Race-Condition beim Approven.
2. **Tag 1–14 (Beobachtung):** Moritz prüft stichprobenartig, ob Slack-Notifications alle ankommen, alle Blocks korrekt rendern, Approve/Reject-Buttons funktionieren. Offene Issues fixen.
3. **Tag 14 (Cutover):** `NOTIFICATION_BACKEND=slack` setzen (`.env` auf IS42, Container-Restart). Telegram-Notifications stoppen.
4. **Tag 30 (Cleanup):** Wenn in 14 Tagen Slack-only-Betrieb keine Beschwerden → `telegram_service.py` wird aus dem `app.py`-Import entfernt; Datei bleibt im Repo als Archiv mit Deprecation-Notice (siehe §9).

**Begründung Einzeiler:** Feature-Flag hat null Downside (ein Env-Var + drei If-Statements im Wrapper) und maximales Rollback-Potenzial; 14 Tage Parallelbetrieb reichen, um alle Event-Types mindestens 1× natürlich im Betrieb zu erleben.

### Wrapper-Pattern

Statt `notify_booking(data)` direkt zu rufen, gibt es in `slack_notifications.py` (oder einem neuen `notifications_hub.py`):

```python
def notify_booking(data):
    backend = os.environ.get('NOTIFICATION_BACKEND', 'slack')
    if backend in ('telegram', 'both'):
        from telegram_service import notify_booking as _tg
        _tg(data)
    if backend in ('slack', 'both'):
        notify_booking_slack(data)
```

Alle Call-Sites in `app.py` rufen weiterhin `notify_booking(...)` aus dem neuen Hub — kein Diff in `app.py`-Logik nötig, nur der Import ändert sich.

---

## 8. Abgrenzung zu F.3 (gemeinsamer Endpoint? separate?)

F.3 (`chat-christoph`) plant einen Slack-Event-Subscription-Handler für `app_mention`-Events (wenn jemand `@GartenBot …` schreibt, antwortet der Agent). F.4 plant einen Interactive-Components-Handler für Button-Clicks.

**Slack unterscheidet strikt zwei Payload-Typen:**
- **Events API** (Server sendet bei Mentions, Message-Posts, Reactions etc.) — JSON-POST mit `Content-Type: application/json`, Body enthält `event.type=app_mention` o.ä. Config-Feld in der Slack-App: „Event Subscriptions → Request URL".
- **Interactive Components** (Server sendet bei Button-Clicks, Select-Menüs, Modals) — Form-POST mit `Content-Type: application/x-www-form-urlencoded`, `payload`-Feld enthält JSON. Config-Feld in der Slack-App: „Interactivity & Shortcuts → Request URL".

**Entscheidung: separate Endpoints, geteilter Signing-Helper.**

| Aspekt | F.3 (Chat) | F.4 (Notifications) |
|---|---|---|
| **Endpoint** | `POST /api/garten/agent/slack-events` | `POST /api/garten/slack/interactivity` |
| **Content-Type** | `application/json` | `application/x-www-form-urlencoded` |
| **Event-Type** | `event_callback` mit `event.type=app_mention` | `block_actions` |
| **Slack-App-Config** | Event Subscriptions → Request URL | Interactivity & Shortcuts → Request URL |
| **Signing-Secret** | `GARTEN_SLACK_SIGNING_SECRET` | **gleicher Wert** |
| **Verify-Helper** | `slack_service.verify_slack_signature()` | **gleiche Funktion** |
| **URL-Verification (`challenge`)** | JA (initial Setup) | NEIN (nicht nötig bei Interactivity) |

**Begründung separate Endpoints:** Slack erlaubt für Events und Interactivity jeweils **genau eine** Request-URL. Wenn beide auf dieselbe URL zeigen, müsste der Handler manuell am Content-Type und/oder `type`-Feld disambiguieren — das wäre fragiler als zwei klar getrennte Routes. Außerdem: F.3 kann live gehen, bevor F.4 gemerged ist (und umgekehrt), ohne dass der jeweils andere Endpoint existieren muss.

**Koordinations-Regel `chat-christoph` ↔ `slack-steffan`:**
- Wer zuerst PR merged, baut `verify_slack_signature()` in `slack_service.py`.
- Der Zweite importiert aus `slack_service.py` und fügt keine Duplikat-Implementierung hinzu.
- Bei Merge-Konflikt: shared Helper lebt in `slack_service.py`, beide Blueprints importieren.

---

## 9. Deprecation-Plan für `telegram_service.py` (`telegram_agent.py` bleibt bis F.3)

### `telegram_service.py` — deprecated mit F.4

**Timeline:**
- **F.5 Tag 0:** Feature-Flag `both`, `telegram_service.py` wird noch aufgerufen.
- **F.5 Tag 14:** Flag-Switch auf `slack`, `telegram_service.py` wird nicht mehr aufgerufen aber bleibt im Repo.
- **F.5 Tag 30:** Import-Zeile aus `app.py` entfernen; `telegram_service.py` bekommt Header-Kommentar:
  ```python
  """
  DEPRECATED 2026-05-18 — replaced by slack_notifications.py (F.4).
  Kept for reference only. Will be deleted once telegram_agent.py is also
  migrated to Slack (F.3 chat-layer goes live).
  """
  ```
- **Nach F.3-Go-Live:** Datei löschen, Env-Vars `TELEGRAM_BOT_TOKEN` und `TELEGRAM_CHAT_ID` aus Docker-Compose entfernen, Webhook auf Telegram-Seite deregistrieren (`deleteWebhook`-API-Call einmalig).

### `telegram_agent.py` — bleibt parallel laufen

Dieser Bot liest Commands (`/aufgaben`, `/inventar`, `/buchungen`, `/galerie`, `/status`, `/hilfe`, Create/Complete-Tasks) via Long-Polling. **Das ist ein Read-Interface**, kein Notification-Layer. F.3 ersetzt das durch `@GartenBot <Frage>`-Mention-Handling in Slack.

**Timeline telegram_agent.py:**
- **F.4-Deploy (heute+14d):** unverändert läuft parallel weiter.
- **F.3-Deploy:** parallel zu F.3-Chat-Layer. Moritz kann Commands entweder in Telegram oder in Slack abfeuern.
- **F.3-Deploy + 30 Tage:** wenn Moritz bestätigt „ich nutze Telegram-Commands nicht mehr" → `telegram_agent.py` wird aus `start.sh` entfernt, Long-Polling-Thread stoppt, Datei bleibt als Archiv.
- **F.3-Deploy + 60 Tage:** Datei löschen.

**Wichtig für F.4-Implementer:** `/api/telegram/webhook` (aktuell Zeile 2020 in `app.py`) darf während F.4 **nicht entfernt** werden, solange `telegram_agent.py` läuft — der Webhook handled sowohl alte Moderation-Callbacks als auch Agent-Commands. Erst bei Full-Telegram-Shutdown entfernen.

---

## 10. Akzeptanzkriterien für F.5 (Implementation)

Konkret testbar — F.5 ist abgeschlossen wenn alle 7 grün:

1. **Moderation-Post:** Upload eines Test-Bilds als Nicht-Admin → Slack-Post in `#refugium-heideland-management` mit Bild-Thumbnail, Titel, Kategorie, Approve/Reject-Buttons + parallele DM an Moritz mit gleichem Block-Kit.
2. **Moderation-Approve:** Klick auf „Freigeben" in Slack → `gallery_images.status` in DB auf `approved`, Slack-Nachricht wird aktualisiert (Buttons verschwinden, Context-Zeile „Freigegeben von @moritz um HH:MM"), Bild erscheint live auf `/galerie`.
3. **Moderation-Reject:** analog zu (2), Status auf `rejected`.
4. **Signing-Verification:** POST mit manipulierter Signatur auf `/api/garten/slack/interactivity` → HTTP 401. POST mit abgelaufenem Timestamp (> 5 min) → HTTP 401.
5. **Notification-Hub:** alle 9 aktiven Event-Typen aus §2 triggern bei `NOTIFICATION_BACKEND=slack` einen Slack-Post mit korrektem Emoji-Header und sinnvollen Feldern (manueller Test per Admin-Actions).
6. **Feature-Flag-Respect:** Mit `NOTIFICATION_BACKEND=both` gehen alle Test-Notifications doppelt raus (Telegram + Slack). Mit `telegram` nur Telegram, mit `slack` nur Slack.
7. **F.3-Koexistenz:** nach F.3-Merge läuft `/api/garten/agent/slack-events` (Mentions) und `/api/garten/slack/interactivity` (Buttons) gleichzeitig, ohne Conflicts, mit dem gemeinsamen Verify-Helper aus `slack_service.py`.

**Performance-Budget:** Interactivity-Handler antwortet in < 500 ms (p95) — weit unter dem 3-s-Slack-Timeout. DB-Updates sind single-row UPDATEs, kein Performance-Risiko.

---

## 11. Offene Fragen für Moritz

1. **Fallback-Email bei Slack-Ausfall:** soll `[GARTEN-FAIL]`-Mails an `moritzvoigt42@gmail.com` gehen (wie in §6 vorgeschlagen), oder reicht Logging in `agent_actions_log` ohne zweite Benachrichtigungs-Schiene? Meine Empfehlung: ja, Fallback-Mail, weil ein Slack-Outage sonst unbemerkt bleibt bis der nächste Upload/Buchung kommt und jemand beschwert sich.
2. **Admin-Email-Deprecation:** `send_booking_notification_to_admin` und `send_application_notification_admin` — sofort ab F.5 Tag 0 deaktivieren (du liest Slack eh), oder parallel 30 Tage laufen lassen? Ich empfehle: **sofort deaktivieren**, weil das Slack-Notification-Ziel genau das ersetzt.
3. **Telegram-Agent Sunset-Datum:** du hast gesagt F.3 ist der Ersatz für `telegram_agent.py`. Wann ist F.3 live-Target? Davon hängt ab, wie lange `telegram_agent.py` + Telegram-Webhook parallel laufen. Wenn F.3 noch > 60 Tage entfernt ist, würde ich im F.4-Deploy auch einen Slack-Command-Mini-Agent (nur `/status` und `/aufgaben`) als Zwischenlösung vorschlagen, damit du schneller voll umziehen kannst.

---

## Anhang A: Env-Var-Änderungen für F.5

| Variable | Status | Beschreibung |
|---|---|---|
| `NOTIFICATION_BACKEND` | **NEU** | `telegram` \| `slack` \| `both`. Default `both` für 14 Tage, dann `slack`. |
| `GARTEN_BOT_TOKEN` | existiert (F.2) | `xoxb-…` für `@GartenBot` |
| `GARTEN_SLACK_CHANNEL_ID` | existiert (F.2) | `C0AUAD6QY2U` |
| `GARTEN_MORITZ_SLACK_USER_ID` | existiert (F.2) | `U0ASYE5UPQR` |
| `GARTEN_SLACK_SIGNING_SECRET` | **NEU** (gemeinsam mit F.3) | Signing-Secret aus Slack-App-Config, für HMAC-Verifikation beider Endpoints (Events + Interactivity) |
| `TELEGRAM_BOT_TOKEN` | bleibt bis F.3 live | wird mit F.3-Sunset entfernt |
| `TELEGRAM_CHAT_ID` | bleibt bis F.3 live | wird mit F.3-Sunset entfernt |

---

## Anhang B: Datei-Inventar für F.5 (geplant)

| Datei | Status | Zweck |
|---|---|---|
| `pi-backend/slack_notifications.py` | NEU | Notification-Hub + Event-Funktionen (pendant zu `telegram_service.py`) |
| `pi-backend/slack_interactivity.py` | NEU | Flask-Blueprint für Interactive-Components-Handler |
| `pi-backend/slack_service.py` | EDIT | Block-Kit-Helper für Moderation + `verify_slack_signature()`-Helper |
| `pi-backend/app.py` | EDIT | Import-Umstellung, Blueprint-Registrierung, 10 Call-Sites auf Hub-Wrapper |
| `pi-backend/email_draft_service.py` | EDIT | Import-Umstellung |
| `pi-backend/start.sh` | EDIT | Telegram-Webhook-Registrierung konditional (`$NOTIFICATION_BACKEND`) |

---

**Konzept-Status:** F.4 ist damit vollständig entschieden, außer den 3 offenen Fragen an Moritz in §11.
**Nach Freigabe:** Worker F.5 startet mit `slack_notifications.py` → `slack_interactivity.py` → Slack-App-UI-Config → Call-Site-Umstellung → Feature-Flag-Deploy.

---

## Umsetzungs-Status 2026-04-18 (Worker H)

**F.5-Implementation abgeschlossen.** Commit: (siehe git log voigt-garten main)

### Geliefert
- `slack_service.py` erweitert: `verify_slack_signature()`, `build_moderation_blocks()`, `post_with_photo()`
- `slack_notifications.py` (NEU): alle 6 Event-Funktionen + `send_moderation_request`, drop-in zu telegram_service
- `notifications.py` (NEU): Dispatcher für NOTIFICATION_BACKEND=`telegram|slack|both`
- `slack_interactivity.py` (NEU): Flask-Blueprint `/api/garten/slack/interactivity`
- `app.py`: Import umgestellt, Blueprint registriert
- `email_draft_service.py`: Import auf notifications-Hub umgestellt
- `docker-compose.yml`: `GARTEN_SLACK_SIGNING_SECRET`, `NOTIFICATION_BACKEND` durchgereicht
- `.env`: beide Vars gesetzt (Default: `NOTIFICATION_BACKEND=both`)

### Slack-App-Config-Schritte für Moritz (einmalig)
1. api.slack.com → Apps → GartenBot (A0ATNG554JJ)
2. Features → **Interactivity & Shortcuts** → Toggle **On**
3. Request-URL: `https://garten.infinityspace42.de/api/garten/slack/interactivity`
4. Save Changes (keine App-Reinstall nötig — kein neuer Scope)

### Race-Condition-Schutz im `both`-Modus
Moderations-Karte sendet **nur via Slack** mit Buttons. Telegram bekommt im Parallelbetrieb nur einen Info-Post ohne Buttons, damit kein Doppel-Approve möglich ist. Buchung/Feedback/Rechnung gehen dagegen auf beiden Channels identisch raus (read-only Notifications).

### Sunset-Reminder
Kein automatischer Cron-Reminder — zu fragil. Moritz setzt `NOTIFICATION_BACKEND=slack` manuell ab 2026-05-02 (Tag 14 nach Deploy). 30 Tage danach: `telegram_service.py`-Import aus `app.py` entfernen.
