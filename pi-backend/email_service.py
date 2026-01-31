"""
Email Service for Voigt-Garten
Uses Resend API for transactional emails.
"""

import os
import resend
from datetime import datetime

# Resend API Key from environment
resend.api_key = os.environ.get('RESEND_API_KEY', '')

# Sender & Admin
FROM_EMAIL = "Voigt-Garten <garten-etzdorf@infinityspace42.de>"
ADMIN_EMAIL = "moritz.infinityspace42@gmail.com"


def send_booking_confirmation(booking_data: dict) -> bool:
    """Send booking confirmation to guest."""
    if not resend.api_key:
        print("RESEND_API_KEY not configured")
        return False

    try:
        params = {
            "from": FROM_EMAIL,
            "to": [booking_data['email']],
            "subject": "Buchungsanfrage eingegangen - Voigt-Garten",
            "html": f"""
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                    <h1 style="color: #16a34a;">Voigt-Garten</h1>
                    <h2>Hallo {booking_data['name']}!</h2>

                    <p>Vielen Dank fur deine Buchungsanfrage!</p>

                    <div style="background: #f0fdf4; padding: 20px; border-radius: 10px; margin: 20px 0;">
                        <h3 style="margin-top: 0;">Buchungsdetails:</h3>
                        <p><strong>Anreise:</strong> {booking_data['checkIn']}</p>
                        <p><strong>Abreise:</strong> {booking_data['checkOut']}</p>
                        <p><strong>Personen:</strong> {booking_data.get('guests', 2)}</p>
                        <p><strong>Gesamtpreis:</strong> {booking_data['totalPrice']:.2f} EUR</p>
                        {f"<p><strong>Rabattcode:</strong> {booking_data['discountCode']}</p>" if booking_data.get('discountCode') else ""}
                    </div>

                    <h3>Zahlungsinformationen:</h3>
                    <p>Bitte überweise den Betrag auf folgendes Konto:</p>
                    <div style="background: #faf5f0; padding: 20px; border-radius: 10px; margin: 20px 0;">
                        <p><strong>Empfanger:</strong> [PLACEHOLDER - Kontoinhaber]</p>
                        <p><strong>IBAN:</strong> [PLACEHOLDER - IBAN]</p>
                        <p><strong>Verwendungszweck:</strong> Garten {booking_data['checkIn']}</p>
                    </div>

                    <p>Nach Zahlungseingang erhaltst du eine Bestatigung mit allen Infos zur Anreise.</p>

                    <p>Bei Fragen erreichst du uns unter dieser Email-Adresse.</p>

                    <p style="color: #666; margin-top: 30px;">
                        Liebe Grüße,<br/>
                        Familie Voigt
                    </p>
                </div>
            """,
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
            'gallery_upload': '📷 Neues Galerie-Bild',
            'issue_report': '🚨 Neue Mängelmeldung',
            'task_completed': '✅ Aufgabe erledigt',
            'user_registered': '👤 Neue Registrierung',
        }
        title = titles.get(activity_type, f'📋 {activity_type}')

        # Build details HTML
        details_html = ""
        for key, value in details.items():
            if value:
                details_html += f"<tr><td style='padding: 5px;'><strong>{key}:</strong></td><td>{value}</td></tr>"

        params = {
            "from": FROM_EMAIL,
            "to": [ADMIN_EMAIL],
            "subject": f"{title} - Voigt-Garten",
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
            "subject": f"{urgency}: {task_title} - {days_overdue} Tage uberfallig",
            "html": f"""
                <div style="font-family: sans-serif;">
                    <h2>{urgency}</h2>
                    <p>Die folgende Wartungsaufgabe ist <strong>{days_overdue} Tage uberfallig</strong>:</p>

                    <div style="background: #fef2f2; padding: 20px; border-radius: 10px; border-left: 4px solid #ef4444;">
                        <h3 style="margin-top: 0;">{task_title}</h3>
                    </div>

                    <p style="margin-top: 20px;">
                        <a href="https://garten.infinityspace42.de/wartung" style="background: #16a34a; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
                            Zur Wartungsubersicht
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
