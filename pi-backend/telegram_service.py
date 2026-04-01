"""
Telegram Moderation Service for Voigt-Garten Gallery.
Sends upload notifications with approve/reject buttons to admin chat.
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
