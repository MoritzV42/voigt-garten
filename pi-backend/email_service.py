"""
Email Service for Refugium Naturgärten (Standort Refugium Etzdorf)
Uses Resend API for transactional emails.
"""

import os
import sqlite3
import resend
from datetime import datetime

# Resend API Key from environment
resend.api_key = os.environ.get('RESEND_API_KEY', '')

# Sender & Admin
FROM_EMAIL = "Refugium Etzdorf <garten@infinityspace42.de>"
ADMIN_EMAIL = "moritz.infinityspace42@gmail.com"

DATA_DIR = os.environ.get('DATA_DIR', os.path.join(os.path.dirname(__file__)))
DB_PATH = os.path.join(DATA_DIR, 'garten.db')


def _get_site_config() -> dict:
    """Get site configuration from DB."""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        rows = conn.execute('SELECT key, value FROM site_config').fetchall()
        conn.close()
        return {row['key']: row['value'] for row in rows}
    except Exception:
        return {}


def _email_header(title: str) -> str:
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f0fdf4;font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:20px;">
<div style="background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);border-radius:16px 16px 0 0;padding:40px 30px;text-align:center;">
<div style="font-size:48px;margin-bottom:10px;">🌳</div>
<h1 style="color:white;margin:0;font-family:'Playfair Display',Georgia,serif;font-size:28px;font-weight:600;">{title}</h1>
<p style="color:#bbf7d0;margin:8px 0 0 0;font-size:14px;">Refugium Naturgärten · Standort Etzdorf</p>
</div>
<div style="background:white;padding:40px 30px;border-radius:0 0 16px 16px;box-shadow:0 4px 6px rgba(0,0,0,0.05);">"""


def _email_footer() -> str:
    return """</div>
<div style="text-align:center;padding:24px 0;color:#9ca3af;font-size:12px;">
<p style="margin:0;">Refugium Naturgärten &middot; Standort Refugium Etzdorf im Rosental</p>
<p style="margin:4px 0 0 0;"><a href="https://garten.infinityspace42.de" style="color:#16a34a;text-decoration:none;">garten.infinityspace42.de</a></p>
<p style="margin:8px 0 0 0;color:#cbd5e1;font-size:11px;">betrieben über Infinity Space</p>
</div></div></body></html>"""


def send_booking_confirmation(booking_data: dict) -> bool:
    """Send booking confirmation to guest with payment info and cancellation policy."""
    if not resend.api_key:
        print("RESEND_API_KEY not configured")
        return False

    config = _get_site_config()
    account_holder = config.get('account_holder', 'Refugium Naturgärten')
    iban = config.get('iban', 'Wird nachgereicht')
    bic = config.get('bic', '')

    bic_line = f"<p><strong>BIC:</strong> {bic}</p>" if bic and bic != 'PLACEHOLDER' else ""
    iban_display = iban if iban != 'PLACEHOLDER' else 'Wird nachgereicht'
    holder_display = account_holder if account_holder != 'PLACEHOLDER' else 'Refugium Naturgärten'

    try:
        params = {
            "from": FROM_EMAIL,
            "to": [booking_data['email']],
            "subject": "[Refugium Etzdorf] Buchungsanfrage eingegangen",
            "html": f"""{_email_header('Refugium Etzdorf')}
                <h2 style="color:#1a1a1a;margin:0 0 16px 0;font-size:22px;">
                    Hallo {booking_data['name']}!
                </h2>
                <p style="color:#4a5568;line-height:1.6;">
                    Vielen Dank für deine Buchungsanfrage! Hier sind deine Details:
                </p>

                <div style="background:#f0fdf4;padding:20px;border-radius:10px;margin:20px 0;border:1px solid #dcfce7;">
                    <h3 style="margin-top:0;color:#166534;">Buchungsdetails</h3>
                    <p><strong>Anreise:</strong> {booking_data['checkIn']}</p>
                    <p><strong>Abreise:</strong> {booking_data['checkOut']}</p>
                    <p><strong>Personen:</strong> {booking_data.get('guests', 2)}</p>
                    <p><strong>Gesamtpreis:</strong> {booking_data['totalPrice']:.2f} EUR</p>
                    {f"<p><strong>Rabattcode:</strong> {booking_data['discountCode']}</p>" if booking_data.get('discountCode') else ""}
                </div>

                <h3 style="color:#1a1a1a;">Zahlungsinformationen</h3>
                <p style="color:#4a5568;">Bitte überweise den Betrag auf folgendes Konto:</p>
                <div style="background:#faf5f0;padding:20px;border-radius:10px;margin:20px 0;border:1px solid #fde68a;">
                    <p><strong>Empfänger:</strong> {holder_display}</p>
                    <p><strong>IBAN:</strong> {iban_display}</p>
                    {bic_line}
                    <p><strong>Verwendungszweck:</strong> Garten {booking_data['checkIn']}</p>
                </div>
                <p style="color:#4a5568;font-size:13px;">
                    Gem. § 19 UStG wird keine Umsatzsteuer berechnet.
                </p>

                <h3 style="color:#1a1a1a;">Stornierungsbedingungen</h3>
                <div style="background:#fffbeb;padding:16px 20px;border-radius:10px;margin:20px 0;border:1px solid #fde68a;">
                    <ul style="margin:0;padding-left:20px;color:#92400e;font-size:13px;">
                        <li>Bis 14 Tage vor Anreise: 100% Erstattung</li>
                        <li>7-14 Tage vor Anreise: 50% Erstattung</li>
                        <li>Weniger als 7 Tage: Keine Erstattung</li>
                    </ul>
                </div>

                <h3 style="color:#1a1a1a;">Anfahrt</h3>
                <p style="color:#4a5568;font-size:14px;">
                    Der Garten liegt in <strong>Etzdorf im Rosental</strong>, Sachsen (Südhang).<br>
                    Genauere Anfahrtsbeschreibung und Zugangsinformationen erhältst du mit der Buchungsbestätigung nach Zahlungseingang.
                </p>

                <p style="color:#4a5568;margin-top:24px;">
                    Nach Zahlungseingang erhältst du eine Bestätigung mit allen Infos zur Anreise.
                    Bei Fragen erreichst du uns unter dieser Email-Adresse.
                </p>

                <p style="color:#666;margin-top:30px;">
                    Liebe Grüße,<br/>dein Team vom Refugium Etzdorf
                </p>
            {_email_footer()}""",
            "reply_to": ADMIN_EMAIL
        }

        resend.Emails.send(params)
        print(f"Booking confirmation sent to {booking_data['email']}")
        return True
    except Exception as e:
        print(f"Email error: {e}")
        return False


def send_booking_notification_to_admin(booking_data: dict) -> bool:
    """Notify admin about new booking."""
    if not resend.api_key:
        print("RESEND_API_KEY not configured")
        return False

    try:
        params = {
            "from": FROM_EMAIL,
            "to": [ADMIN_EMAIL],
            "subject": f"Neue Buchungsanfrage: {booking_data['name']}",
            "html": f"""
                <div style="font-family: sans-serif;">
                    <h2>Neue Buchungsanfrage!</h2>

                    <table style="border-collapse: collapse;">
                        <tr><td style="padding: 5px;"><strong>Name:</strong></td><td>{booking_data['name']}</td></tr>
                        <tr><td style="padding: 5px;"><strong>Email:</strong></td><td>{booking_data['email']}</td></tr>
                        <tr><td style="padding: 5px;"><strong>Telefon:</strong></td><td>{booking_data.get('phone', '-')}</td></tr>
                        <tr><td style="padding: 5px;"><strong>Anreise:</strong></td><td>{booking_data['checkIn']}</td></tr>
                        <tr><td style="padding: 5px;"><strong>Abreise:</strong></td><td>{booking_data['checkOut']}</td></tr>
                        <tr><td style="padding: 5px;"><strong>Personen:</strong></td><td>{booking_data.get('guests', 2)}</td></tr>
                        <tr><td style="padding: 5px;"><strong>Haustier:</strong></td><td>{'Ja' if booking_data.get('pets') else 'Nein'}</td></tr>
                        <tr><td style="padding: 5px;"><strong>Preis:</strong></td><td>{booking_data['totalPrice']:.2f} EUR</td></tr>
                        <tr><td style="padding: 5px;"><strong>Rabattcode:</strong></td><td>{booking_data.get('discountCode', '-')}</td></tr>
                        <tr><td style="padding: 5px;"><strong>Notizen:</strong></td><td>{booking_data.get('notes', '-')}</td></tr>
                    </table>

                    <p style="margin-top: 20px;">
                        <a href="https://garten.infinityspace42.de/admin" style="background: #16a34a; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
                            Zum Dashboard
                        </a>
                    </p>
                </div>
            """
        }

        resend.Emails.send(params)
        print("Admin notification sent")
        return True
    except Exception as e:
        print(f"Email error: {e}")
        return False


def send_activity_notification(activity_type: str, details: dict) -> bool:
    """Send notification to admin about user activity on the site."""
    if not resend.api_key:
        print("RESEND_API_KEY not configured")
        return False

    try:
        titles = {
            'gallery_upload': 'Neues Galerie-Bild',
            'issue_report': 'Neue Mängelmeldung',
            'task_completed': 'Aufgabe erledigt',
            'user_registered': 'Neue Registrierung',
        }
        title = titles.get(activity_type, activity_type)

        details_html = ""
        for key, value in details.items():
            if value:
                details_html += f"<tr><td style='padding: 5px;'><strong>{key}:</strong></td><td>{value}</td></tr>"

        params = {
            "from": FROM_EMAIL,
            "to": [ADMIN_EMAIL],
            "subject": f"[Refugium Etzdorf] {title}",
            "html": f"""
                <div style="font-family: sans-serif;">
                    <h2>{title}</h2>
                    <p>Neue Aktivität auf <a href="https://garten.infinityspace42.de">garten.infinityspace42.de</a>:</p>

                    <table style="border-collapse: collapse; margin: 20px 0;">
                        {details_html}
                    </table>

                    <p style="margin-top: 20px;">
                        <a href="https://garten.infinityspace42.de/admin" style="background: #16a34a; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
                            Zum Dashboard
                        </a>
                    </p>
                </div>
            """
        }

        resend.Emails.send(params)
        print(f"Activity notification sent: {activity_type}")
        return True
    except Exception as e:
        print(f"Email error: {e}")
        return False


def send_maintenance_reminder(task_title: str, days_overdue: int) -> bool:
    """Send maintenance reminder to admin."""
    if not resend.api_key:
        print("RESEND_API_KEY not configured")
        return False

    try:
        urgency = "DRINGEND" if days_overdue > 14 else "Erinnerung"

        params = {
            "from": FROM_EMAIL,
            "to": [ADMIN_EMAIL],
            "subject": f"{urgency}: {task_title} - {days_overdue} Tage überfällig",
            "html": f"""
                <div style="font-family: sans-serif;">
                    <h2>{urgency}</h2>
                    <p>Die folgende Wartungsaufgabe ist <strong>{days_overdue} Tage überfällig</strong>:</p>

                    <div style="background: #fef2f2; padding: 20px; border-radius: 10px; border-left: 4px solid #ef4444;">
                        <h3 style="margin-top: 0;">{task_title}</h3>
                    </div>

                    <p style="margin-top: 20px;">
                        <a href="https://garten.infinityspace42.de/wartung" style="background: #16a34a; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
                            Zur Wartungsübersicht
                        </a>
                    </p>
                </div>
            """
        }

        resend.Emails.send(params)
        return True
    except Exception as e:
        print(f"Email error: {e}")
        return False


def send_magic_link_email(email: str, token: str, name: str = None) -> bool:
    """Send magic link email for registration/login."""
    if not resend.api_key:
        print("RESEND_API_KEY not configured")
        return False

    greeting = f"Hallo {name}" if name else "Hallo"
    verify_url = f"https://garten.infinityspace42.de/auth/verify?token={token}"

    try:
        params = {
            "from": FROM_EMAIL,
            "to": [email],
            "subject": "[Refugium Etzdorf] Dein Zugang",
            "html": f"""{_email_header('Refugium Etzdorf')}
                <h2 style="color:#1a1a1a;margin:0 0 16px 0;font-size:22px;">
                    {greeting}!
                </h2>
                <p style="color:#4a5568;line-height:1.6;margin:0 0 24px 0;">
                    Klicke auf den Button unten, um deinen Zugang zum Refugium Etzdorf zu aktivieren.
                    Damit kannst du Aufenthalte buchen, die Galerie nutzen und vieles mehr.
                </p>

                <div style="text-align:center;margin:32px 0;">
                    <a href="{verify_url}"
                       style="display:inline-block;background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);color:white;padding:16px 40px;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px;box-shadow:0 4px 12px rgba(22,163,74,0.3);">
                        Jetzt Zugang aktivieren
                    </a>
                </div>

                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin:24px 0;">
                    <p style="color:#166534;margin:0;font-size:13px;">
                        Dieser Link ist <strong>30 Minuten</strong> gültig.
                        Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:
                    </p>
                    <p style="color:#16a34a;margin:8px 0 0 0;font-size:12px;word-break:break-all;">
                        {verify_url}
                    </p>
                </div>

                <p style="color:#9ca3af;font-size:13px;margin:24px 0 0 0;">
                    Falls du diese Email nicht angefordert hast, kannst du sie einfach ignorieren.
                </p>
            {_email_footer()}""",
            "reply_to": ADMIN_EMAIL
        }

        resend.Emails.send(params)
        print(f"Magic link email sent to {email}")
        return True
    except Exception as e:
        print(f"Email error: {e}")
        return False


def send_welcome_email(email: str, name: str) -> bool:
    """Send welcome email after successful registration."""
    if not resend.api_key:
        print("RESEND_API_KEY not configured")
        return False

    try:
        params = {
            "from": FROM_EMAIL,
            "to": [email],
            "subject": "[Refugium Etzdorf] Willkommen!",
            "html": f"""{_email_header('Willkommen im Refugium Etzdorf!')}
                <h2 style="color:#1a1a1a;margin:0 0 16px 0;font-size:22px;">
                    Hallo {name}!
                </h2>
                <p style="color:#4a5568;line-height:1.6;margin:0 0 24px 0;">
                    Dein Account wurde erfolgreich erstellt. Willkommen im
                    Refugium Etzdorf im Rosental – einem Standort von Refugium Naturgärten.
                </p>

                <div style="margin:24px 0;">
                    <div style="background:#f0fdf4;border-radius:10px;padding:16px;margin-bottom:12px;border:1px solid #dcfce7;">
                        <p style="margin:0 0 4px 0;font-weight:600;color:#166534;">5.300 m² Natur pur</p>
                        <p style="margin:0;color:#4a5568;font-size:13px;">Südhang-Lage mit altem Baumbestand, Obstbäumen und viel Platz zum Erholen.</p>
                    </div>
                    <div style="background:#f0fdf4;border-radius:10px;padding:16px;margin-bottom:12px;border:1px solid #dcfce7;">
                        <p style="margin:0 0 4px 0;font-weight:600;color:#166534;">Solar-Autarkie</p>
                        <p style="margin:0;color:#4a5568;font-size:13px;">700W Solar + 1,4kWh Akku, eigener Brunnen - nachhaltig und unabhängig.</p>
                    </div>
                    <div style="background:#f0fdf4;border-radius:10px;padding:16px;margin-bottom:12px;border:1px solid #dcfce7;">
                        <p style="margin:0 0 4px 0;font-weight:600;color:#166534;">51 Jahre Tradition</p>
                        <p style="margin:0;color:#4a5568;font-size:13px;">Seit Generationen in Familienbesitz - ein Ort mit Geschichte und Herz.</p>
                    </div>
                </div>

                <div style="background:#faf5f0;border-radius:10px;padding:20px;margin:24px 0;text-align:center;border:1px solid #fde68a;">
                    <p style="margin:0;font-size:14px;color:#92400e;">
                        Aufenthalte ab <strong style="font-size:20px;color:#78350f;">45 EUR/Nacht</strong>
                    </p>
                    <p style="margin:4px 0 0 0;font-size:12px;color:#b45309;">
                        Familien-Rabattcode: REFUGIUM-FAMILY (50%)
                    </p>
                </div>

                <div style="text-align:center;margin:32px 0;">
                    <a href="https://garten.infinityspace42.de/buchen"
                       style="display:inline-block;background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);color:white;padding:16px 40px;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px;box-shadow:0 4px 12px rgba(22,163,74,0.3);">
                        Jetzt Aufenthalt buchen
                    </a>
                </div>
            {_email_footer()}""",
            "reply_to": ADMIN_EMAIL
        }

        resend.Emails.send(params)
        print(f"Welcome email sent to {email}")
        return True
    except Exception as e:
        print(f"Email error: {e}")
        return False


def send_feedback_request(email: str, name: str, booking_id: int) -> bool:
    """Send feedback request email 1 day after check-out."""
    if not resend.api_key:
        print("RESEND_API_KEY not configured")
        return False

    feedback_url = f"https://garten.infinityspace42.de/feedback?booking={booking_id}"

    try:
        params = {
            "from": FROM_EMAIL,
            "to": [email],
            "subject": "[Refugium Etzdorf] Wie war dein Aufenthalt?",
            "html": f"""{_email_header('Refugium Etzdorf')}
                <h2 style="color:#1a1a1a;margin:0 0 16px 0;font-size:22px;">
                    Hallo {name}!
                </h2>
                <p style="color:#4a5568;line-height:1.6;margin:0 0 24px 0;">
                    Wir hoffen, du hattest eine wunderbare Zeit in unserem Garten!
                    Dein Feedback hilft uns, den Aufenthalt für zukünftige Gäste noch besser zu machen.
                </p>

                <div style="text-align:center;margin:32px 0;">
                    <a href="{feedback_url}"
                       style="display:inline-block;background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);color:white;padding:16px 40px;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px;box-shadow:0 4px 12px rgba(22,163,74,0.3);">
                        Feedback geben
                    </a>
                </div>

                <p style="color:#9ca3af;font-size:13px;margin:24px 0 0 0;">
                    Das Feedback dauert nur 2 Minuten und ist uns sehr wichtig.
                </p>
            {_email_footer()}""",
            "reply_to": ADMIN_EMAIL
        }

        resend.Emails.send(params)
        print(f"Feedback request sent to {email}")
        return True
    except Exception as e:
        print(f"Email error: {e}")
        return False


def send_google_review_followup(email: str, name: str) -> bool:
    """Send Google review request to guests who gave 4-5 star feedback."""
    if not resend.api_key:
        print("RESEND_API_KEY not configured")
        return False

    # Google Business review link (to be configured in site_config)
    config = _get_site_config()
    google_review_url = config.get('google_review_url', 'https://g.page/r/PLACEHOLDER/review')

    try:
        params = {
            "from": FROM_EMAIL,
            "to": [email],
            "subject": "[Refugium Etzdorf] Danke für dein Feedback!",
            "html": f"""{_email_header('Refugium Etzdorf')}
                <h2 style="color:#1a1a1a;margin:0 0 16px 0;font-size:22px;">
                    Danke, {name}!
                </h2>
                <p style="color:#4a5568;line-height:1.6;margin:0 0 24px 0;">
                    Es freut uns sehr, dass dir dein Aufenthalt gefallen hat!
                    Würdest du uns mit einer kurzen Google-Bewertung unterstützen?
                    Das hilft anderen Gästen, uns zu finden.
                </p>

                <div style="text-align:center;margin:32px 0;">
                    <a href="{google_review_url}"
                       style="display:inline-block;background:#4285F4;color:white;padding:16px 40px;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px;">
                        Google-Bewertung schreiben
                    </a>
                </div>

                <p style="color:#9ca3af;font-size:13px;margin:24px 0 0 0;">
                    Das dauert nur 1 Minute und bedeutet uns sehr viel.
                </p>
            {_email_footer()}""",
            "reply_to": ADMIN_EMAIL
        }

        resend.Emails.send(params)
        print(f"Google review followup sent to {email}")
        return True
    except Exception as e:
        print(f"Email error: {e}")
        return False


# Position-Mapping fuer Bewerbungen (wird auch in app.py als Whitelist genutzt)
JOB_POSITION_LABELS = {
    'tech_student': 'Tech-Aushilfe / Student',
    'elektro_meister': 'Elektro-Meister (Elektroinstallation)',
    'gaertner': 'Gärtner / Gartenhelfer',
    'initiativ': 'Initiativbewerbung',
}

RECLAIM_BOOKING_URL = "https://app.reclaim.ai/m/moritz-voigt/flexible-quick-meeting"


def send_application_confirmation(app_data: dict) -> bool:
    """Send application confirmation to applicant with Reclaim booking link."""
    if not resend.api_key:
        print("RESEND_API_KEY not configured")
        return False

    full_name = app_data.get('name', '').strip()
    first_name = full_name.split()[0] if full_name else 'Du'
    position_key = app_data.get('position', 'initiativ')
    position_label = JOB_POSITION_LABELS.get(position_key, position_key)

    try:
        params = {
            "from": FROM_EMAIL,
            "to": [app_data['email']],
            "subject": "[Refugium Etzdorf] Deine Bewerbung ist bei uns angekommen",
            "html": f"""{_email_header('Refugium Etzdorf')}
                <h2 style="color:#1a1a1a;margin:0 0 16px 0;font-size:22px;">
                    Hallo {first_name}!
                </h2>
                <p style="color:#4a5568;line-height:1.6;margin:0 0 16px 0;">
                    Vielen Dank für deine Bewerbung auf die Position
                    <strong>{position_label}</strong> in unserem Refugium in Etzdorf im Rosental.
                </p>
                <p style="color:#4a5568;line-height:1.6;margin:0 0 24px 0;">
                    Wir haben deine Unterlagen erhalten und schauen sie uns in Ruhe an.
                    Spätestens innerhalb weniger Tage melden wir uns persönlich bei dir zurück.
                </p>

                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:20px;margin:24px 0;">
                    <h3 style="color:#166534;margin:0 0 8px 0;font-size:16px;">
                        Magst du direkt einen Kennenlern-Termin vorschlagen?
                    </h3>
                    <p style="color:#4a5568;margin:0 0 16px 0;font-size:14px;line-height:1.5;">
                        Das spart uns beiden Hin- und Her-Mails. Buche einfach einen kurzen Slot,
                        der dir passt – wir telefonieren oder treffen uns direkt im Garten.
                    </p>
                    <div style="text-align:center;">
                        <a href="{RECLAIM_BOOKING_URL}"
                           style="display:inline-block;background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);color:white;padding:14px 32px;text-decoration:none;border-radius:10px;font-weight:600;font-size:15px;box-shadow:0 4px 12px rgba(22,163,74,0.3);">
                            Termin vorschlagen
                        </a>
                    </div>
                    <p style="color:#16a34a;margin:12px 0 0 0;font-size:12px;text-align:center;word-break:break-all;">
                        {RECLAIM_BOOKING_URL}
                    </p>
                </div>

                <p style="color:#4a5568;line-height:1.6;margin:24px 0 0 0;">
                    Falls du Fragen hast, antworte einfach auf diese Mail.
                </p>

                <p style="color:#666;margin-top:30px;">
                    Liebe Grüße,<br/>Moritz Voigt<br/>
                    <span style="color:#9ca3af;font-size:13px;">Refugium Naturgärten</span>
                </p>
            {_email_footer_refugium()}""",
            "reply_to": ADMIN_EMAIL
        }

        resend.Emails.send(params)
        print(f"Application confirmation sent to {app_data['email']}")
        return True
    except Exception as e:
        print(f"Email error: {e}")
        return False


def send_application_notification_admin(app_data: dict) -> bool:
    """Notify admin about new job application."""
    if not resend.api_key:
        print("RESEND_API_KEY not configured")
        return False

    position_key = app_data.get('position', 'initiativ')
    position_label = JOB_POSITION_LABELS.get(position_key, position_key)
    name = app_data.get('name', '-')
    email = app_data.get('email', '-')
    phone = app_data.get('phone') or '-'
    available_from = app_data.get('available_from') or '-'
    hours_per_week = app_data.get('hours_per_week')
    hours_display = f"{hours_per_week} h/Woche" if hours_per_week else '-'
    preferred_times = app_data.get('preferred_times') or '-'
    motivation = (app_data.get('motivation') or '-').replace('\n', '<br>')
    resume_hint = ""
    if app_data.get('resume_path'):
        resume_hint = """
            <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin:16px 0;">
                <p style="margin:0;color:#854d0e;font-size:14px;">
                    <strong>Lebenslauf hochgeladen</strong> - siehe Admin-Dashboard zum Download.
                </p>
            </div>
        """

    try:
        params = {
            "from": FROM_EMAIL,
            "to": [ADMIN_EMAIL],
            "subject": f"[Refugium Bewerbung] {position_label} - {name}",
            "html": f"""
                <div style="font-family: sans-serif; max-width:640px;">
                    <h2>Neue Bewerbung</h2>
                    <p><strong>Position:</strong> {position_label}</p>

                    <table style="border-collapse: collapse; margin-top:12px;">
                        <tr><td style="padding:5px;"><strong>Name:</strong></td><td>{name}</td></tr>
                        <tr><td style="padding:5px;"><strong>Email:</strong></td><td>{email}</td></tr>
                        <tr><td style="padding:5px;"><strong>Telefon:</strong></td><td>{phone}</td></tr>
                        <tr><td style="padding:5px;"><strong>Verfügbar ab:</strong></td><td>{available_from}</td></tr>
                        <tr><td style="padding:5px;"><strong>Stunden/Woche:</strong></td><td>{hours_display}</td></tr>
                        <tr><td style="padding:5px;vertical-align:top;"><strong>Bevorzugte Zeiten:</strong></td><td>{preferred_times}</td></tr>
                    </table>

                    <h3 style="margin-top:20px;">Motivation</h3>
                    <div style="background:#f9fafb;border-left:4px solid #16a34a;padding:12px 16px;border-radius:4px;">
                        <p style="margin:0;color:#374151;line-height:1.5;">{motivation}</p>
                    </div>

                    {resume_hint}

                    <p style="margin-top: 24px;">
                        <a href="https://garten.infinityspace42.de/admin#applications" style="background: #16a34a; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
                            Zum Admin-Dashboard (Bewerbungen)
                        </a>
                    </p>
                </div>
            """,
            "reply_to": email if email != '-' else ADMIN_EMAIL
        }

        resend.Emails.send(params)
        print(f"Admin application notification sent for {name}")
        return True
    except Exception as e:
        print(f"Email error: {e}")
        return False


def _email_footer_refugium() -> str:
    return """</div>
<div style="text-align:center;padding:24px 0;color:#9ca3af;font-size:12px;">
<p style="margin:0;">Refugium Naturgärten &middot; betrieben über Infinity Space</p>
<p style="margin:4px 0 0 0;">Etzdorf im Rosental, Sachsen</p>
<p style="margin:4px 0 0 0;"><a href="https://garten.infinityspace42.de" style="color:#16a34a;text-decoration:none;">garten.infinityspace42.de</a></p>
</div></div></body></html>"""


def send_payment_reminder(booking_data: dict, days_since: int = 7) -> bool:
    """Send payment reminder to guest."""
    if not resend.api_key:
        print("RESEND_API_KEY not configured")
        return False

    config = _get_site_config()
    account_holder = config.get('account_holder', 'Refugium Naturgärten')
    iban = config.get('iban', 'Wird nachgereicht')
    holder_display = account_holder if account_holder != 'PLACEHOLDER' else 'Refugium Naturgärten'
    iban_display = iban if iban != 'PLACEHOLDER' else 'Wird nachgereicht'

    try:
        params = {
            "from": FROM_EMAIL,
            "to": [booking_data['email']],
            "subject": "[Refugium Etzdorf] Zahlungserinnerung",
            "html": f"""{_email_header('Refugium Etzdorf')}
                <h2 style="color:#1a1a1a;margin:0 0 16px 0;font-size:22px;">
                    Hallo {booking_data['name']}!
                </h2>
                <p style="color:#4a5568;line-height:1.6;margin:0 0 24px 0;">
                    Wir haben für deine Buchung vom {booking_data['checkIn']} noch keinen Zahlungseingang verzeichnen können.
                    Bitte überweise den Betrag zeitnah, damit wir deine Buchung bestätigen können.
                </p>

                <div style="background:#faf5f0;padding:20px;border-radius:10px;margin:20px 0;border:1px solid #fde68a;">
                    <p><strong>Betrag:</strong> {booking_data['totalPrice']:.2f} EUR</p>
                    <p><strong>Empfänger:</strong> {holder_display}</p>
                    <p><strong>IBAN:</strong> {iban_display}</p>
                    <p><strong>Verwendungszweck:</strong> Garten {booking_data['checkIn']}</p>
                </div>

                <p style="color:#4a5568;">
                    Falls du bereits überwiesen hast, kannst du diese Email ignorieren.
                    Bei Fragen erreichst du uns unter dieser Email-Adresse.
                </p>

                <p style="color:#666;margin-top:30px;">
                    Liebe Grüße,<br/>dein Team vom Refugium Etzdorf
                </p>
            {_email_footer()}""",
            "reply_to": ADMIN_EMAIL
        }

        resend.Emails.send(params)
        print(f"Payment reminder sent to {booking_data['email']}")
        return True
    except Exception as e:
        print(f"Email error: {e}")
        return False
