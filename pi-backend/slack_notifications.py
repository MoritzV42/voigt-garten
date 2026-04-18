"""
Slack Notifications for Voigt-Garten Admin (F.4).

Drop-in-kompatibler Ersatz zu telegram_service.py — identische Signaturen,
damit die Call-Sites in app.py/email_draft_service.py via notifications.py
ohne Logikänderung umgezogen werden können.

Channel-Strategie (siehe SLACK_NOTIFICATION_MIGRATION.md §3):
- Alles in #refugium-heideland-management
- Moderation + System-Errors zusätzlich als DM an Moritz
"""

import os
import html as _html

import slack_service

ADMIN_DASHBOARD_URL = "https://garten.infinityspace42.de/admin"
GALLERY_BASE_URL = "https://garten.infinityspace42.de/images/gallery"

# Event-Typen → Slack-Emoji (Block-Kit nutzt :name:-Format)
EVENT_EMOJIS = {
    'booking_new': ':date:',
    'booking_cancelled': ':x:',
    'booking_confirmed': ':white_check_mark:',
    'issue_report': ':rotating_light:',
    'task_completed': ':white_check_mark:',
    'gallery_upload': ':camera_with_flash:',
    'user_registered': ':bust_in_silhouette:',
    'feedback_received': ':star:',
    'invoice_sent': ':page_facing_up:',
    'invoice_paid': ':moneybag:',
    'payment_reminder': ':alarm_clock:',
    'email_sent': ':email:',
    'email_draft_created': ':memo:',
    'system_error': ':red_circle:',
    'health_check_fail': ':broken_heart:',
    'credit_added': ':credit_card:',
    'job_application': ':briefcase:',
}

# Job-Position-Labels (identisch zu telegram_service.py)
_JOB_POSITION_LABELS = {
    'tech_student': 'Tech-Aushilfe / Student',
    'elektro_meister': 'Elektro-Meister',
    'gaertner': 'Gärtner / Gartenhelfer',
    'initiativ': 'Initiativbewerbung',
}

# Event-Typen, die zusätzlich als DM an Moritz gehen
_DM_EVENTS = {'system_error', 'gallery_upload_moderation'}


def _is_configured() -> bool:
    return slack_service.is_configured()


def _build_event_blocks(event_type: str, data: dict, include_link: bool = True,
                        link_fragment: str = "") -> list:
    """Baue einen generischen Event-Block aus data-Dict."""
    emoji = EVENT_EMOJIS.get(event_type, ':clipboard:')
    title = event_type.replace('_', ' ').title()

    header_text = f"{emoji} {title}"
    blocks: list = [
        {"type": "header",
         "text": {"type": "plain_text", "text": header_text, "emoji": True}},
    ]

    # Felder (max 10 pro section lt. Slack — Splitten falls nötig)
    fields = []
    for key, value in data.items():
        if value is None or value == '':
            continue
        fields.append({"type": "mrkdwn", "text": f"*{key}:*\n{value}"})

    for i in range(0, len(fields), 10):
        blocks.append({"type": "section", "fields": fields[i:i + 10]})

    if include_link:
        link_url = ADMIN_DASHBOARD_URL + link_fragment
        blocks.append({
            "type": "context",
            "elements": [{
                "type": "mrkdwn",
                "text": f"<{link_url}|Zum Dashboard öffnen>",
            }],
        })

    return blocks


def notify_admin(event_type: str, data: dict, include_link: bool = True) -> bool:
    """
    Zentrale Notification-Funktion — identische Signatur zu telegram_service.notify_admin.
    Channel-Post + optional DM bei zeitkritischen Events.
    """
    if not _is_configured():
        print(f"[slack_notifications] GARTEN_BOT_TOKEN not set, skipping {event_type}")
        return False

    emoji = EVENT_EMOJIS.get(event_type, ':clipboard:')
    title = event_type.replace('_', ' ').title()
    fallback_text = f"{emoji} {title}"

    blocks = _build_event_blocks(event_type, data, include_link=include_link)
    result = slack_service.post_channel(fallback_text, blocks=blocks)

    if event_type in _DM_EVENTS:
        slack_service.send_dm(
            slack_service.GARTEN_MORITZ_SLACK_USER_ID,
            fallback_text,
            blocks=blocks,
        )

    return bool(result.get('ok'))


def notify_email_sent(recipient: str, subject: str, email_type: str,
                      attachment: str = None) -> bool:
    """Notify admin when an email is sent."""
    data = {
        'Empfänger': recipient,
        'Betreff': subject,
        'Typ': email_type,
    }
    if attachment:
        data['Anhang'] = attachment
    return notify_admin('email_sent', data)


def notify_booking(booking_data: dict, event: str = 'booking_new') -> bool:
    """Notify admin about booking events."""
    data = {
        'Gast': booking_data.get('guest_name') or booking_data.get('name', 'Unbekannt'),
        'Email': booking_data.get('guest_email') or booking_data.get('email', ''),
        'Anreise': booking_data.get('check_in') or booking_data.get('checkIn', ''),
        'Abreise': booking_data.get('check_out') or booking_data.get('checkOut', ''),
        'Personen': str(booking_data.get('guests', 2)),
        'Preis': f"{booking_data.get('total_price') or booking_data.get('totalPrice', 0):.2f} €",
    }
    return notify_admin(event, data)


def notify_feedback(feedback_data: dict) -> bool:
    """Notify admin about new feedback."""
    stars = '⭐' * feedback_data.get('rating', 0)
    data = {
        'Bewertung': stars,
        'Gast': feedback_data.get('guest_email', ''),
        'Kommentar': (feedback_data.get('comment', '-') or '-')[:200],
    }

    for key in ['cleanliness', 'communication', 'location', 'accuracy']:
        val = feedback_data.get(key)
        if val:
            labels = {
                'cleanliness': 'Sauberkeit',
                'communication': 'Kommunikation',
                'location': 'Lage',
                'accuracy': 'Genauigkeit',
            }
            data[labels[key]] = '⭐' * val

    return notify_admin('feedback_received', data)


def notify_job_application(app_data: dict) -> bool:
    """Notify admin about new job application. Channel-Post + DM (zeitkritisch für Moritz)."""
    if not _is_configured():
        print("[slack_notifications] GARTEN_BOT_TOKEN not set, skipping job_application")
        return False

    position_key = app_data.get('position', 'initiativ')
    position_label = _JOB_POSITION_LABELS.get(position_key, position_key)

    motivation = (app_data.get('motivation') or '').strip()
    if len(motivation) > 300:
        motivation = motivation[:297] + '...'

    hours = app_data.get('hours_per_week')
    hours_display = f"{hours} h/Woche" if hours else '-'

    data = {
        'Name': app_data.get('name', '-'),
        'Email': app_data.get('email', '-'),
    }
    phone = app_data.get('phone')
    if phone:
        data['Telefon'] = phone
    data['Position'] = position_label
    data['Verfügbar ab'] = app_data.get('available_from') or '-'
    data['Stunden'] = hours_display
    data['Bevorzugte Zeiten'] = app_data.get('preferred_times') or '-'
    if motivation:
        data['Motivation'] = motivation
    data['Lebenslauf'] = 'ja' if app_data.get('resume_path') else 'nein'

    fallback_text = ":briefcase: Neue Bewerbung"
    blocks = _build_event_blocks('job_application', data, include_link=True,
                                 link_fragment="#applications")
    result = slack_service.post_channel(fallback_text, blocks=blocks)
    slack_service.send_dm(slack_service.GARTEN_MORITZ_SLACK_USER_ID,
                          fallback_text, blocks=blocks)
    return bool(result.get('ok'))


def notify_system_error(error_type: str, details: str) -> bool:
    """Notify admin about system errors. Channel + DM."""
    return notify_admin('system_error', {
        'Fehler': error_type,
        'Details': (details or '')[:500],
    }, include_link=False)


def send_moderation_request(image_id: str, thumbnail_path: str, uploader: str,
                            name: str, category: str) -> bool:
    """
    Slack-Moderationsanfrage mit Approve/Reject-Buttons (Block-Kit).
    Kompatibel zur telegram_service.send_moderation_request-Signatur.
    """
    if not _is_configured():
        print("[slack_notifications] GARTEN_BOT_TOKEN not set, skipping moderation request")
        return False

    # Öffentliche URL statt lokaler Path
    image_url = None
    if thumbnail_path:
        # thumbnail_path ist relativ zu GALLERY_DIR, z.B. "garten/kirsch_thumb.webp"
        # Falls absolut, den GALLERY_DIR-Präfix entfernen
        gallery_dir = os.environ.get('GALLERY_DIR', '/app/public/images/gallery')
        rel = thumbnail_path
        if rel.startswith(gallery_dir):
            rel = os.path.relpath(rel, gallery_dir)
        image_url = f"{GALLERY_BASE_URL}/{rel.lstrip('/').replace(os.sep, '/')}"

    blocks = slack_service.build_moderation_blocks(
        image_id=image_id,
        image_url=image_url,
        uploader=uploader,
        title=name,
        category=category,
    )
    fallback_text = f":camera: Neuer Galerie-Upload wartet auf Freigabe (ID {image_id})"

    channel_result = slack_service.post_channel(fallback_text, blocks=blocks)
    slack_service.send_dm(slack_service.GARTEN_MORITZ_SLACK_USER_ID,
                          fallback_text, blocks=blocks)
    return bool(channel_result.get('ok'))
