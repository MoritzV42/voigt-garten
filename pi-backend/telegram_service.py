"""
Telegram Service for Voigt-Garten.
Moderation requests, messaging, and centralized admin notification hub.
"""

import os
import requests

TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_CHAT_ID = os.environ.get('TELEGRAM_CHAT_ID', '')
TELEGRAM_API = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"


def send_moderation_request(image_id: str, thumbnail_path: str, uploader: str, name: str, category: str) -> bool:
    """Send photo with approve/reject inline buttons to Telegram chat."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("Telegram not configured, skipping moderation request")
        return False

    caption = (
        f"Neuer Upload von {uploader}\n"
        f"Name: {name or 'Ohne Titel'}\n"
        f"Kategorie: {category}\n"
        f"ID: {image_id}"
    )

    inline_keyboard = {
        "inline_keyboard": [[
            {"text": "Freigeben", "callback_data": f"approve:{image_id}"},
            {"text": "Ablehnen", "callback_data": f"reject:{image_id}"}
        ]]
    }

    try:
        if thumbnail_path and os.path.exists(thumbnail_path):
            with open(thumbnail_path, 'rb') as photo:
                response = requests.post(
                    f"{TELEGRAM_API}/sendPhoto",
                    data={
                        "chat_id": TELEGRAM_CHAT_ID,
                        "caption": caption,
                        "reply_markup": str(inline_keyboard).replace("'", '"')
                    },
                    files={"photo": photo},
                    timeout=10
                )
        else:
            import json
            response = requests.post(
                f"{TELEGRAM_API}/sendMessage",
                json={
                    "chat_id": TELEGRAM_CHAT_ID,
                    "text": caption,
                    "reply_markup": inline_keyboard
                },
                timeout=10
            )

        if response.ok:
            print(f"Telegram moderation request sent for {image_id}")
            return True
        else:
            print(f"Telegram API error: {response.text}")
            return False
    except Exception as e:
        print(f"Telegram send error: {e}")
        return False


def answer_callback_query(callback_query_id: str, text: str) -> bool:
    """Answer a Telegram callback query (button press)."""
    if not TELEGRAM_BOT_TOKEN:
        return False

    try:
        response = requests.post(
            f"{TELEGRAM_API}/answerCallbackQuery",
            json={
                "callback_query_id": callback_query_id,
                "text": text
            },
            timeout=10
        )
        return response.ok
    except Exception as e:
        print(f"Telegram callback error: {e}")
        return False


def send_message(chat_id: str, text: str, reply_markup=None) -> bool:
    """Send a text message to a Telegram chat."""
    if not TELEGRAM_BOT_TOKEN:
        return False
    try:
        payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
        if reply_markup:
            payload["reply_markup"] = reply_markup
        response = requests.post(f"{TELEGRAM_API}/sendMessage", json=payload, timeout=10)
        return response.ok
    except Exception as e:
        print(f"Telegram send error: {e}")
        return False


def register_webhook(webhook_url: str) -> bool:
    """Register webhook URL with Telegram Bot API."""
    if not TELEGRAM_BOT_TOKEN:
        print("TELEGRAM_BOT_TOKEN not set, skipping webhook registration")
        return False

    try:
        response = requests.post(
            f"{TELEGRAM_API}/setWebhook",
            json={"url": webhook_url},
            timeout=10
        )
        if response.ok:
            print(f"Telegram webhook registered: {webhook_url}")
            return True
        else:
            print(f"Telegram webhook error: {response.text}")
            return False
    except Exception as e:
        print(f"Telegram webhook registration error: {e}")
        return False


# ============ Notification Hub ============

# Event type → emoji mapping
EVENT_EMOJIS = {
    'booking_new': '📅',
    'booking_cancelled': '❌',
    'booking_confirmed': '✅',
    'issue_report': '🚨',
    'task_completed': '✅',
    'gallery_upload': '📷',
    'user_registered': '👤',
    'feedback_received': '⭐',
    'invoice_sent': '📄',
    'invoice_paid': '💰',
    'payment_reminder': '⏰',
    'email_sent': '📧',
    'system_error': '🔴',
    'health_check_fail': '💔',
    'credit_added': '💳',
}


def notify_admin(event_type: str, data: dict, include_link: bool = True) -> bool:
    """
    Central notification function — sends structured messages to Telegram admin chat.

    Args:
        event_type: One of the EVENT_EMOJIS keys
        data: Dict with key-value pairs to display
        include_link: Whether to include link to admin dashboard
    """
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print(f"Telegram not configured, skipping {event_type} notification")
        return False

    emoji = EVENT_EMOJIS.get(event_type, '📋')
    title = event_type.replace('_', ' ').title()

    # Build message
    lines = [f"{emoji} <b>{title}</b>", ""]

    for key, value in data.items():
        if value is not None and value != '':
            lines.append(f"<b>{key}:</b> {value}")

    if include_link:
        lines.append("")
        lines.append('<a href="https://garten.infinityspace42.de/admin">→ Zum Dashboard</a>')

    text = "\n".join(lines)

    return send_message(TELEGRAM_CHAT_ID, text)


def notify_email_sent(recipient: str, subject: str, email_type: str, attachment: str = None) -> bool:
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
        'Kommentar': feedback_data.get('comment', '-')[:200],
    }

    # Add category ratings if present
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


def notify_system_error(error_type: str, details: str) -> bool:
    """Notify admin about system errors."""
    return notify_admin('system_error', {
        'Fehler': error_type,
        'Details': details[:500],
    }, include_link=False)
