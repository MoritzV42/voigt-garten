"""
Notification-Hub (F.4).

Feature-Flag-basiertes Routing zwischen telegram_service (Legacy) und
slack_notifications (neu). Call-Sites in app.py/email_draft_service.py
importieren ausschliesslich aus diesem Modul.

Werte für NOTIFICATION_BACKEND:
  - "telegram"  → nur Legacy-Telegram (Rückwärtskompatibilität / Rollback)
  - "slack"     → nur Slack (Ziel nach 14 Tagen Parallelbetrieb)
  - "both"      → beide parallel (Default während Migration)
"""

import os


def _backend() -> str:
    """Re-read each call so Container-Restart mit neuem ENV sofort greift."""
    return os.environ.get('NOTIFICATION_BACKEND', 'both').lower()


def _use_telegram() -> bool:
    return _backend() in ('telegram', 'both')


def _use_slack() -> bool:
    return _backend() in ('slack', 'both')


def _try(call, label: str) -> bool:
    try:
        return bool(call())
    except Exception as e:
        print(f"[notifications] {label} failed: {e}")
        return False


def notify_admin(event_type: str, data: dict, include_link: bool = True) -> bool:
    ok_any = False
    if _use_telegram():
        from telegram_service import notify_admin as _tg
        ok_any = _try(lambda: _tg(event_type, data, include_link), 'telegram.notify_admin') or ok_any
    if _use_slack():
        from slack_notifications import notify_admin as _sl
        ok_any = _try(lambda: _sl(event_type, data, include_link), 'slack.notify_admin') or ok_any
    return ok_any


def notify_booking(booking_data: dict, event: str = 'booking_new') -> bool:
    ok_any = False
    if _use_telegram():
        from telegram_service import notify_booking as _tg
        ok_any = _try(lambda: _tg(booking_data, event), 'telegram.notify_booking') or ok_any
    if _use_slack():
        from slack_notifications import notify_booking as _sl
        ok_any = _try(lambda: _sl(booking_data, event), 'slack.notify_booking') or ok_any
    return ok_any


def notify_feedback(feedback_data: dict) -> bool:
    ok_any = False
    if _use_telegram():
        from telegram_service import notify_feedback as _tg
        ok_any = _try(lambda: _tg(feedback_data), 'telegram.notify_feedback') or ok_any
    if _use_slack():
        from slack_notifications import notify_feedback as _sl
        ok_any = _try(lambda: _sl(feedback_data), 'slack.notify_feedback') or ok_any
    return ok_any


def notify_email_sent(recipient: str, subject: str, email_type: str,
                      attachment: str = None) -> bool:
    ok_any = False
    if _use_telegram():
        from telegram_service import notify_email_sent as _tg
        ok_any = _try(lambda: _tg(recipient, subject, email_type, attachment),
                      'telegram.notify_email_sent') or ok_any
    if _use_slack():
        from slack_notifications import notify_email_sent as _sl
        ok_any = _try(lambda: _sl(recipient, subject, email_type, attachment),
                      'slack.notify_email_sent') or ok_any
    return ok_any


def notify_job_application(app_data: dict) -> bool:
    ok_any = False
    if _use_telegram():
        from telegram_service import notify_job_application as _tg
        ok_any = _try(lambda: _tg(app_data), 'telegram.notify_job_application') or ok_any
    if _use_slack():
        from slack_notifications import notify_job_application as _sl
        ok_any = _try(lambda: _sl(app_data), 'slack.notify_job_application') or ok_any
    return ok_any


def notify_system_error(error_type: str, details: str) -> bool:
    ok_any = False
    if _use_telegram():
        from telegram_service import notify_system_error as _tg
        ok_any = _try(lambda: _tg(error_type, details), 'telegram.notify_system_error') or ok_any
    if _use_slack():
        from slack_notifications import notify_system_error as _sl
        ok_any = _try(lambda: _sl(error_type, details), 'slack.notify_system_error') or ok_any
    return ok_any


def send_moderation_request(image_id: str, thumbnail_path: str, uploader: str,
                            name: str, category: str) -> bool:
    """
    Moderationsanfrage. Während des Parallelbetriebs werden Buttons bewusst
    nur auf EINEM Kanal aktiv geschaltet, um Race-Conditions zu vermeiden:
    - Wenn Slack aktiv → Slack sendet mit Buttons, Telegram nur als reine Info.
    - Sonst → Telegram sendet mit Buttons (Legacy-Verhalten).
    """
    ok_any = False

    if _use_slack():
        from slack_notifications import send_moderation_request as _sl
        ok_any = _try(lambda: _sl(image_id, thumbnail_path, uploader, name, category),
                      'slack.send_moderation_request') or ok_any

    if _use_telegram():
        if _use_slack():
            # Im 'both'-Modus: Telegram nur als Info, keine Buttons (Race-Schutz).
            from telegram_service import send_message, TELEGRAM_CHAT_ID
            info = (
                f"[Info] Neuer Upload {image_id}\n"
                f"Uploader: {uploader}\n"
                f"Titel: {name or 'Ohne Titel'}\n"
                f"Kategorie: {category}\n"
                f"Moderation läuft nun über Slack."
            )
            try:
                if TELEGRAM_CHAT_ID:
                    send_message(TELEGRAM_CHAT_ID, info)
            except Exception as e:
                print(f"[notifications] telegram info-post failed: {e}")
        else:
            from telegram_service import send_moderation_request as _tg
            ok_any = _try(lambda: _tg(image_id, thumbnail_path, uploader, name, category),
                          'telegram.send_moderation_request') or ok_any

    return ok_any
