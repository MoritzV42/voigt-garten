# Worker H — F.4 Notifications Migration (Telegram → Slack)

**Vorgänger:** Worker G (Tasks-Reprioritization) + Konzept-Doc `~/stacks/voigt-garten/docs/SLACK_NOTIFICATION_MIGRATION.md` (367 Zeilen, freigegeben 2026-04-18)
**Nachfolger:** Worker I (F.3 Chat-Layer)
**Server:** IS42, SSH-Alias `ssh is42`
**Slack-App:** GartenBot (App-ID `A0ATNG554JJ`, Bot-User `U0AUJTS5F5W`), Bot-Token bereits in `~/stacks/voigt-garten/.env` als `GARTEN_BOT_TOKEN`
**Sprache:** Deutsch mit echten Umlauten.

---

## Kontext

Voigt-Garten hat aktuell Telegram-Notifications an Moritz (Moderations-Buttons für Galerie, Booking-Alerts, Feedback, Email-Logs, Job-Application-Pings). F.2 hat bereits die Slack-Infrastruktur (`@GartenBot`, `slack_service.py`). Moritz will Telegram-Notifs → Slack migrieren (intern Slack, extern Email bleibt).

Dein Job: **Alle 10 Notification-Call-Sites auf Slack umziehen.** Feature-Flag `NOTIFICATION_BACKEND` für 14-Tage-Parallelbetrieb, dann Cutover. Plus Interactive-Components (Approve/Reject-Buttons) für Moderation.

---

## Pflicht-Lesestoff

1. `~/stacks/voigt-garten/docs/SLACK_NOTIFICATION_MIGRATION.md` via SSH — **Bauplan komplett lesen**
2. `C:\GitHub\voigt-garten\.claude\CLAUDE.md`
3. `C:\GitHub\voigt-garten\pi-backend\telegram_service.py` — alle zu migrierenden Funktionen
4. `C:\GitHub\voigt-garten\pi-backend\slack_service.py` — bestehender Slack-Client (von F.2)
5. `C:\GitHub\voigt-garten\pi-backend\app.py` — alle `notify_*`-Call-Sites + `/api/telegram/webhook` (Moderation-Callback)

---

## Moritz' bestätigte Entscheidungen

- **Channel-Strategie:** Option A — alles in `#refugium-heideland-management` (`C0AUAD6QY2U`), Moderation + System-Errors zusätzlich als DM an Moritz
- **Migration-Geschwindigkeit:** Feature-Flag `NOTIFICATION_BACKEND=both` für 14 Tage, dann `=slack`
- **F.3-Koordination:** Separate Endpoints (Events vs. Interactivity), geteilter `verify_slack_signature()`-Helper in `slack_service.py`
- **Email-Fallback:** Slack ersetzt Telegram. Admin-Emails an `moritzvoigt42@gmail.com` bleiben nur wenn sie bisher zusätzlich geschickt wurden (bereits in Call-Sites sichtbar — nicht erweitern)
- **telegram_agent.py (Read-Commands):** bleibt parallel, wird erst mit F.3 (Worker I) ersetzt — NICHT in diesem Worker anfassen

---

## Aufgaben

### Phase 1: Slack-App erweitern (Interactivity aktivieren)

Slack-App `A0ATNG554JJ` braucht:
- **Interactivity & Shortcuts** aktivieren
- Request-URL: `https://garten.infinityspace42.de/api/garten/slack/interactivity`
- Keine zusätzlichen Scopes nötig (wir nutzen schon `chat:write`, `chat:write.public`, `im:write`)

App-Config-Token ist NICHT mehr gültig (12h-Lifetime). Moritz muss manuell im Slack-UI aktivieren — ihn anleiten Schritt-für-Schritt. Signing-Secret ist bekannt: `21ddfe0107609c89b70c87bcceacf762` → in `.env` als `GARTEN_SLACK_SIGNING_SECRET` ergänzen + `docker-compose.yml` durchreichen.

### Phase 2: `slack_service.py` erweitern

Neue Helper:
- `verify_slack_signature(body: bytes, headers: dict) -> bool` — HMAC-SHA256-Verifikation mit `GARTEN_SLACK_SIGNING_SECRET` + `X-Slack-Request-Timestamp` (max 5min alt, Replay-Schutz)
- `build_moderation_blocks(image_url, image_id, uploader, category) -> list` — Block-Kit-Karte mit Bild, Text, Approve/Reject-Buttons (`action_id=moderation_approve:<id>` / `reject:<id>`)
- `post_with_photo(channel, text, image_url, blocks)` — nutzt `chat.postMessage` mit `image_url` im Block-Kit (Slack lädt Bild von URL, kein File-Upload nötig)

### Phase 3: `slack_notifications.py` anlegen (neu)

Pendant zu `telegram_service.py`, gleiche Signaturen für Drop-in-Ersatz:
```python
def notify_admin(text: str, url: str | None = None) -> bool:
    """DM an Moritz (GARTEN_MORITZ_SLACK_USER_ID)."""

def notify_booking(booking: dict) -> bool:
    """Channel-Post + DM. Formatierte Buchungs-Info."""

def notify_feedback(feedback: dict) -> bool:
    """Channel-Post."""

def notify_email_sent(to: str, subject: str, status: str) -> bool:
    """Channel-Post, kompakt."""

def notify_job_application(application: dict) -> bool:
    """Channel-Post + DM."""

def send_moderation_request(image_id, thumbnail_path, uploader, name, category) -> bool:
    """Channel-Post mit Block-Kit + Approve/Reject-Buttons + Zusatz-DM."""
```

Alle Funktionen sollen `False` zurückgeben wenn `GARTEN_BOT_TOKEN` nicht gesetzt (analog zu telegram_service.py).

### Phase 4: Feature-Flag-Wrapper

Neue Datei `pi-backend/notifications.py` — dispatcher:
```python
import os
import telegram_service
import slack_notifications

BACKEND = os.environ.get("NOTIFICATION_BACKEND", "telegram").lower()
# Werte: "telegram", "slack", "both"

def notify_admin(text: str, url: str | None = None) -> bool:
    ok_t = telegram_service.notify_admin(text, url) if BACKEND in ("telegram", "both") else True
    ok_s = slack_notifications.notify_admin(text, url) if BACKEND in ("slack", "both") else True
    return ok_t and ok_s

# analog für alle 6 Notification-Funktionen
```

### Phase 5: Call-Sites umstellen

In `app.py` und `email_draft_service.py`:
```python
# alt:
from telegram_service import notify_booking, notify_feedback, ...

# neu:
from notifications import notify_booking, notify_feedback, ...
```

Per Grep/Edit in allen Call-Sites ersetzen. **Keine Logik ändern, nur Import umschreiben.**

### Phase 6: Interactive-Moderation-Endpoint

Neue Route in `agent_routes.py` ODER separater Blueprint:
```python
@app.route('/api/garten/slack/interactivity', methods=['POST'])
def slack_interactivity():
    body = request.get_data()
    if not slack_service.verify_slack_signature(body, request.headers):
        return "Unauthorized", 401

    payload = json.loads(request.form.get("payload", "{}"))
    if payload.get("type") != "block_actions":
        return "OK", 200

    action = payload["actions"][0]
    action_id = action["action_id"]  # z.B. "moderation_approve:42"
    user_id = payload["user"]["id"]

    if action_id.startswith("moderation_approve:"):
        image_id = action_id.split(":", 1)[1]
        # setze gallery_images.status = 'approved' (gleiche Logik wie in /api/telegram/webhook)
        ...
    elif action_id.startswith("moderation_reject:"):
        ...

    # Update-Card via response_url (Slack-Konvention)
    requests.post(payload["response_url"], json={
        "replace_original": True,
        "text": "Moderation erledigt ✅",
    })
    return "OK", 200
```

Slack-Interactivity muss binnen **3 Sekunden** ACK'en — DB-Write ist schnell genug, sonst async.

### Phase 7: docker-compose.yml erweitern

```yaml
environment:
  - GARTEN_SLACK_SIGNING_SECRET=${GARTEN_SLACK_SIGNING_SECRET}
  - NOTIFICATION_BACKEND=${NOTIFICATION_BACKEND:-both}
```

`.env` auf IS42 ergänzen:
```
GARTEN_SLACK_SIGNING_SECRET=21ddfe0107609c89b70c87bcceacf762
NOTIFICATION_BACKEND=both
```

### Phase 8: Smoke-Tests

1. **Signing-Verify:** falscher Signing-Secret → 401. Richtig → 200.
2. **Booking-Notification:** Test-Booking via `POST /api/bookings` → Slack-Channel-Post sichtbar + Telegram-Post (weil `both`). Beide Texte gleich?
3. **Moderations-Flow:** Test-Upload als Nicht-Admin → Moderation-Card im Slack-Channel + DM an Moritz. Klick "Approve" → Card wird zu "✅ Moderation erledigt" + DB-Eintrag `gallery_images.status='approved'`.
4. **Feature-Flag umschalten:** `NOTIFICATION_BACKEND=slack` → Container-Restart → Booking triggert NUR Slack (kein Telegram).
5. **Fallback `telegram`:** zurück auf `telegram` → Slack aus, Telegram an. Rollback funktioniert.

### Phase 9: Deploy

```bash
cd C:/GitHub/voigt-garten
git add pi-backend/ docker-compose.yml ..
git commit -m "feat(f4-notifications): Telegram->Slack migration + feature flag"
git push origin main

ssh is42 "bash ~/voigt-garten/rebuild-voigt-garten.sh"
```

### Phase 10: CLAUDE.md + Konzept-Doc aktualisieren

- CLAUDE.md: neue Sektion "F.4 Admin-Notifications (Slack)" mit Feature-Flag-Werten, Endpoints, neuen Envs
- `SLACK_NOTIFICATION_MIGRATION.md` am Ende um "Umsetzungs-Status 2026-04-..." ergänzen

### Phase 11: Countdown-Reminder für Telegram-Sunset

Crontab-Eintrag (oder Task im Agent-Worker) für **Tag 14 nach Deploy**:
```
# Tag 14 nach Deploy: Slack-Switch Reminder
0 9 <deploy_date + 14> * * docker exec voigt-garten-app python3 -c "from slack_notifications import notify_admin; notify_admin('F.4 Telegram-Sunset: bitte NOTIFICATION_BACKEND=slack setzen.')"
```

Alternativ: in die CLAUDE.md-Sektion notieren und Moritz muss manuell umstellen. Empfehlung: Reminder als Doku in `SLACK_NOTIFICATION_MIGRATION.md` §7 Status-Update, da "automatische Sunset-Nachricht" fragil ist.

---

## Stolperfallen

- **Slack-Signing-Timestamp:** Max 5min alt. Server-Zeit muss stimmen (IS42 hat Europe/Berlin, Slack sendet UTC-Timestamp — Diff berücksichtigen).
- **Bild-URL für Moderation:** Slack braucht öffentliche URL. Die Galerie-Bilder sind unter `https://garten.infinityspace42.de/images/gallery/...` erreichbar? Check — sonst signed URL nötig.
- **Interaktivität-ACK:** 3s Timeout. DB-Write OK, aber `response_url`-Update bitte erst nachdem Response gesendet (sonst bei DB-Fehler ist die Card noch "Approve/Reject" und Moderation ist schon gelaufen).
- **`both`-Modus Duplikate:** Beide Backends senden gleichen Content. Moritz sieht alles doppelt. Feature — kein Bug. Nach 14 Tagen abstellen.
- **Env-Var `NOTIFICATION_BACKEND` default:** `both` ist sicher, `telegram` wäre rückwärtskompatibel. Empfehlung: Default `both` für 14 Tage, dann Doku-Update mit "auf `slack` setzen".
- **`telegram_agent.py` (polling):** NICHT anfassen. Läuft parallel weiter bis F.3 (Worker I) live ist. `telegram_service.py` kann deprecatet werden, aber erst wenn Moritz explizit `NOTIFICATION_BACKEND=slack` gesetzt hat UND die Commands aus F.3 verfügbar sind.

---

## Akzeptanzkriterien

1. **`slack_notifications.py`** existiert mit allen 6 Funktionen, alle rufen `slack_service` korrekt auf
2. **`notifications.py`** (Wrapper) routet korrekt nach `NOTIFICATION_BACKEND`
3. **Interactivity-Endpoint** funktioniert (Signing-Verify + Approve/Reject erfolgreich getestet)
4. **Moderation-Card** im Slack-Channel zeigt Bild + Buttons, Klick aktualisiert Card
5. **Booking-Notification** kommt gleichzeitig in Telegram + Slack bei `both`
6. **Feature-Flag-Switch** funktioniert ohne Redeploy (Container-Restart reicht)
7. **docker-compose.yml** durchreicht die beiden neuen Envs
8. **CLAUDE.md** aktualisiert
9. **Git:** sauberer Commit auf main, gepusht
10. **Container healthy** nach Deploy

---

## Bericht-Format (max. 300 Wörter, an Moritz zurück)

1. Slack-App Interactivity: aktiviert ja/nein, Signing-Secret im .env
2. `slack_notifications.py`: alle 6 Funktionen implementiert + getestet
3. `notifications.py` Dispatcher: implementiert + Feature-Flag-Werte dokumentiert
4. Call-Sites umgestellt: X von 10+ Call-Sites via Grep/Edit
5. Interactivity-Endpoint: funktionsfähig, Signing-Verify getestet, Moderation-Button getestet
6. Smoke-Tests: 5/5 bestanden
7. Deploy: Container healthy, URL: https://garten.infinityspace42.de/api/health
8. Feature-Flag aktuell: `NOTIFICATION_BACKEND=both`
9. Sunset-Reminder: Slack/Doku-Hinweis eingerichtet
10. CLAUDE.md: aktualisiert
11. Offene Fragen / Blocker

---

## Slack-Bestätigung nach Erfolg

Poste in `#refugium-heideland-management` via GartenBot:
```
:envelope_with_arrow: Worker H abgeschlossen — Telegram-Notifications jetzt parallel via Slack. 14 Tage both-Modus, dann Sunset Telegram.
```
