"""
Garten Bot - Autonomer Telegram Agent für Voigt-Garten.
Keyword-basierter Command-Handler (kein LLM nötig).
"""

import sqlite3
import os
from datetime import datetime, timedelta
from telegram_service import send_message, answer_callback_query


class GartenAgent:
    def __init__(self, db_path):
        self.db_path = db_path
        self.allowed_chat_ids = set()
        chat_id = os.environ.get('TELEGRAM_CHAT_ID', '')
        if chat_id:
            self.allowed_chat_ids = {int(cid.strip()) for cid in chat_id.split(',') if cid.strip()}

    def get_db(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def is_authorized(self, chat_id):
        return int(chat_id) in self.allowed_chat_ids if self.allowed_chat_ids else False

    def process_message(self, chat_id, text, user_info):
        """Route incoming message to handler based on keywords."""
        if not self.is_authorized(chat_id):
            send_message(chat_id, "⛔ Nicht autorisiert. Bitte wende dich an den Admin.")
            return

        text_lower = text.strip().lower()

        # Command routing
        if text_lower in ('/start', '/hilfe', 'hilfe', 'help', '?'):
            self.cmd_help(chat_id)
        elif text_lower in ('aufgaben', 'tasks', '/aufgaben'):
            self.cmd_tasks(chat_id)
        elif text_lower.startswith('aufgabe erstellen:') or text_lower.startswith('/neue_aufgabe '):
            title = text.split(':', 1)[1].strip() if ':' in text else text.split(' ', 1)[1].strip()
            self.cmd_create_task(chat_id, title)
        elif text_lower.startswith('aufgabe #') and 'erledigt' in text_lower:
            # "aufgabe #3 erledigt"
            try:
                task_id = int(text_lower.split('#')[1].split()[0])
                self.cmd_complete_task(chat_id, task_id, user_info)
            except (ValueError, IndexError):
                send_message(chat_id, "❌ Ungültiges Format. Nutze: aufgabe #ID erledigt")
        elif text_lower in ('überfällig', 'overdue', '/überfällig'):
            self.cmd_overdue(chat_id)
        elif text_lower in ('inventar', '/inventar'):
            self.cmd_inventory_overview(chat_id)
        elif text_lower.startswith('inventar '):
            room = text[9:].strip()
            self.cmd_inventory_room(chat_id, room)
        elif text_lower.startswith('suche ') or text_lower.startswith('/suche '):
            query = text.split(' ', 1)[1].strip()
            self.cmd_search_item(chat_id, query)
        elif text_lower.startswith('hinzufügen '):
            self.cmd_add_item(chat_id, text[11:].strip())
        elif text_lower in ('buchungen', '/buchungen'):
            self.cmd_bookings(chat_id)
        elif text_lower in ('galerie', '/galerie'):
            self.cmd_gallery_stats(chat_id)
        elif text_lower in ('status', '/status'):
            self.cmd_status(chat_id)
        else:
            self.cmd_unknown(chat_id, text)

    def cmd_help(self, chat_id):
        msg = (
            "<b>🌳 Garten Bot - Kommandos</b>\n\n"
            "<b>📋 Aufgaben:</b>\n"
            "• <code>aufgaben</code> — Offene Aufgaben\n"
            "• <code>aufgabe erstellen: Titel</code> — Neue Aufgabe\n"
            "• <code>aufgabe #ID erledigt</code> — Erledigt markieren\n"
            "• <code>überfällig</code> — Überfällige Aufgaben\n\n"
            "<b>📦 Inventar:</b>\n"
            "• <code>inventar</code> — Gebäude-Übersicht\n"
            "• <code>inventar Haus</code> — Items in Gebäude\n"
            "• <code>suche Hammer</code> — Item suchen\n"
            "• <code>hinzufügen Hammer in Werkstatt</code> — Item hinzufügen\n\n"
            "<b>📊 Info:</b>\n"
            "• <code>buchungen</code> — Kommende Buchungen\n"
            "• <code>galerie</code> — Galerie-Statistik\n"
            "• <code>status</code> — System-Status\n"
            "• <code>hilfe</code> — Diese Übersicht"
        )
        send_message(chat_id, msg)

    def cmd_tasks(self, chat_id):
        conn = self.get_db()
        # Recurring tasks that are due or overdue
        tasks = conn.execute('''
            SELECT id, title, category, next_due, credit_value
            FROM recurring_tasks WHERE is_active = 1
            ORDER BY next_due ASC LIMIT 15
        ''').fetchall()

        # Open projects
        projects = conn.execute('''
            SELECT id, title, category, priority
            FROM projects WHERE status IN ('offen', 'in_arbeit')
            ORDER BY CASE priority WHEN 'kritisch' THEN 1 WHEN 'hoch' THEN 2 ELSE 3 END
            LIMIT 10
        ''').fetchall()
        conn.close()

        msg = "<b>📋 Offene Aufgaben</b>\n\n"

        if tasks:
            msg += "<b>🔄 Wiederkehrend:</b>\n"
            today = datetime.now().date()
            for t in tasks:
                due = datetime.strptime(t['next_due'], '%Y-%m-%d').date() if t['next_due'] else None
                status_icon = "🔴" if due and due < today else "🟡" if due and (due - today).days <= 7 else "🟢"
                credit = f" ({t['credit_value']}€)" if t['credit_value'] else ""
                msg += f"{status_icon} #{t['id']} {t['title']}{credit}\n"

        if projects:
            msg += "\n<b>📌 Projekte:</b>\n"
            for p in projects:
                prio_icon = "🔴" if p['priority'] == 'kritisch' else "🟠" if p['priority'] == 'hoch' else "🔵"
                msg += f"{prio_icon} #{p['id']} {p['title']}\n"

        if not tasks and not projects:
            msg += "✅ Keine offenen Aufgaben!"

        send_message(chat_id, msg)

    def cmd_create_task(self, chat_id, title):
        if not title:
            send_message(chat_id, "❌ Bitte gib einen Titel an: <code>aufgabe erstellen: Rasenmähen</code>")
            return

        conn = self.get_db()
        conn.execute('''
            INSERT INTO projects (title, category, status, priority, created_by)
            VALUES (?, 'sonstiges', 'offen', 'mittel', 'telegram')
        ''', (title,))
        project_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
        conn.commit()
        conn.close()

        send_message(chat_id, f"✅ Aufgabe erstellt: <b>#{project_id} {title}</b>")

    def cmd_complete_task(self, chat_id, task_id, user_info):
        conn = self.get_db()
        # Try recurring first
        task = conn.execute('SELECT * FROM recurring_tasks WHERE id = ?', (task_id,)).fetchone()
        if task:
            next_due = (datetime.now() + timedelta(days=task['cycle_days'])).strftime('%Y-%m-%d')
            user_name = user_info.get('first_name', 'Telegram')
            conn.execute('''
                UPDATE recurring_tasks SET last_completed_at = ?, last_completed_by = ?, next_due = ?
                WHERE id = ?
            ''', (datetime.now().isoformat(), user_name, next_due, task_id))

            if task['credit_value'] and task['credit_value'] > 0:
                conn.execute('''
                    INSERT INTO credits (guest_email, amount, reason, type)
                    VALUES (?, ?, ?, 'earned')
                ''', (f"telegram:{user_info.get('id', 'unknown')}", task['credit_value'], f"Wartung: {task['title']}"))

            conn.commit()
            conn.close()
            credit_msg = f" (+{task['credit_value']}€ Guthaben)" if task['credit_value'] else ""
            send_message(chat_id, f"✅ <b>{task['title']}</b> erledigt!{credit_msg}\nNächste Fälligkeit: {next_due}")
            return

        # Try project
        project = conn.execute('SELECT * FROM projects WHERE id = ?', (task_id,)).fetchone()
        if project:
            user_name = user_info.get('first_name', 'Telegram')
            conn.execute('''
                UPDATE projects SET status = 'done', completed_at = ?, completed_by = ?
                WHERE id = ?
            ''', (datetime.now().isoformat(), f"telegram:{user_name}", task_id))
            conn.commit()
            conn.close()
            send_message(chat_id, f"✅ Projekt <b>#{task_id} {project['title']}</b> als erledigt markiert!")
            return

        conn.close()
        send_message(chat_id, f"❌ Aufgabe #{task_id} nicht gefunden.")

    def cmd_overdue(self, chat_id):
        conn = self.get_db()
        today = datetime.now().strftime('%Y-%m-%d')
        tasks = conn.execute('''
            SELECT id, title, next_due, credit_value
            FROM recurring_tasks
            WHERE is_active = 1 AND next_due < ?
            ORDER BY next_due ASC
        ''', (today,)).fetchall()
        conn.close()

        if not tasks:
            send_message(chat_id, "✅ Keine überfälligen Aufgaben!")
            return

        msg = "<b>⚠️ Überfällige Aufgaben</b>\n\n"
        today_date = datetime.now().date()
        for t in tasks:
            due = datetime.strptime(t['next_due'], '%Y-%m-%d').date()
            days = (today_date - due).days
            credit = f" ({t['credit_value']}€)" if t['credit_value'] else ""
            msg += f"🔴 #{t['id']} <b>{t['title']}</b>{credit}\n   {days} Tage überfällig\n"

        send_message(chat_id, msg)

    def cmd_inventory_overview(self, chat_id):
        conn = self.get_db()
        try:
            buildings = conn.execute('SELECT * FROM inventory_buildings ORDER BY sort_order').fetchall()
            if not buildings:
                send_message(chat_id, "📦 Inventar ist noch leer. Füge Gebäude über die Webseite hinzu.")
                conn.close()
                return

            msg = "<b>📦 Inventar - Gebäude</b>\n\n"
            for b in buildings:
                item_count = conn.execute('''
                    SELECT COUNT(*) as cnt FROM inventory_items i
                    JOIN inventory_rooms r ON i.room_id = r.id
                    WHERE r.building_id = ? AND i.vorhanden = 1
                ''', (b['id'],)).fetchone()['cnt']
                msg += f"{b['icon']} <b>{b['name']}</b> — {item_count} Items\n"

            msg += "\nDetails: <code>inventar [Gebäude]</code>"
            send_message(chat_id, msg)
        except Exception:
            send_message(chat_id, "📦 Inventar-System wird gerade eingerichtet...")
        finally:
            conn.close()

    def cmd_inventory_room(self, chat_id, building_name):
        conn = self.get_db()
        try:
            building = conn.execute(
                'SELECT * FROM inventory_buildings WHERE LOWER(name) = LOWER(?)', (building_name,)
            ).fetchone()
            if not building:
                send_message(chat_id, f"❌ Gebäude '{building_name}' nicht gefunden.")
                conn.close()
                return

            rooms = conn.execute('''
                SELECT r.*, COUNT(i.id) as item_count
                FROM inventory_rooms r
                LEFT JOIN inventory_items i ON i.room_id = r.id AND i.vorhanden = 1
                WHERE r.building_id = ?
                GROUP BY r.id
                ORDER BY r.sort_order
            ''', (building['id'],)).fetchall()

            msg = f"<b>{building['icon']} {building['name']}</b>\n\n"
            for r in rooms:
                msg += f"{r['icon']} <b>{r['name']}</b> — {r['item_count']} Items\n"

                items = conn.execute('''
                    SELECT name, quantity, ablageort, category
                    FROM inventory_items WHERE room_id = ? AND vorhanden = 1
                    ORDER BY ablageort, name LIMIT 20
                ''', (r['id'],)).fetchall()

                for item in items:
                    loc = f" [{item['ablageort']}]" if item['ablageort'] else ""
                    qty = f" x{item['quantity']}" if item['quantity'] > 1 else ""
                    msg += f"  • {item['name']}{qty}{loc}\n"
                msg += "\n"

            send_message(chat_id, msg)
        except Exception:
            send_message(chat_id, "📦 Inventar-System wird gerade eingerichtet...")
        finally:
            conn.close()

    def cmd_search_item(self, chat_id, query):
        conn = self.get_db()
        try:
            items = conn.execute('''
                SELECT i.*, r.name as room_name, b.name as building_name
                FROM inventory_items i
                JOIN inventory_rooms r ON i.room_id = r.id
                JOIN inventory_buildings b ON r.building_id = b.id
                WHERE i.name LIKE ? OR i.notes LIKE ? OR i.ablageort LIKE ?
                LIMIT 15
            ''', (f'%{query}%', f'%{query}%', f'%{query}%')).fetchall()

            if not items:
                send_message(chat_id, f"🔍 Keine Ergebnisse für '{query}'")
                conn.close()
                return

            msg = f"<b>🔍 Suche: {query}</b>\n\n"
            for item in items:
                status = "✅" if item['vorhanden'] else "❌"
                loc = f" [{item['ablageort']}]" if item['ablageort'] else ""
                qty = f" x{item['quantity']}" if item['quantity'] > 1 else ""
                msg += f"{status} <b>{item['name']}</b>{qty}{loc}\n   📍 {item['building_name']} → {item['room_name']}\n"

            send_message(chat_id, msg)
        except Exception:
            send_message(chat_id, "📦 Inventar-System wird gerade eingerichtet...")
        finally:
            conn.close()

    def cmd_add_item(self, chat_id, text):
        # Parse: "Hammer in Werkstatt"
        if ' in ' not in text:
            send_message(chat_id, "❌ Format: <code>hinzufügen Item in Raum</code>")
            return

        parts = text.split(' in ', 1)
        item_name = parts[0].strip()
        room_name = parts[1].strip()

        conn = self.get_db()
        try:
            room = conn.execute(
                'SELECT * FROM inventory_rooms WHERE LOWER(name) = LOWER(?)', (room_name,)
            ).fetchone()
            if not room:
                send_message(chat_id, f"❌ Raum '{room_name}' nicht gefunden.")
                conn.close()
                return

            import hashlib
            item_id = hashlib.md5(f"{datetime.now().isoformat()}{item_name}".encode()).hexdigest()[:12]
            conn.execute('''
                INSERT INTO inventory_items (id, name, room_id, created_by)
                VALUES (?, ?, ?, 'telegram')
            ''', (item_id, item_name, room['id']))
            conn.commit()

            send_message(chat_id, f"✅ <b>{item_name}</b> in {room['name']} hinzugefügt!")
        except Exception as e:
            send_message(chat_id, f"❌ Fehler: {e}")
        finally:
            conn.close()

    def cmd_bookings(self, chat_id):
        conn = self.get_db()
        today = datetime.now().strftime('%Y-%m-%d')
        bookings = conn.execute('''
            SELECT * FROM bookings
            WHERE check_out >= ? AND status IN ('pending', 'confirmed')
            ORDER BY check_in ASC LIMIT 10
        ''', (today,)).fetchall()
        conn.close()

        if not bookings:
            send_message(chat_id, "📅 Keine aktuellen oder kommenden Buchungen.")
            return

        msg = "<b>📅 Buchungen</b>\n\n"
        for b in bookings:
            status_icon = "✅" if b['status'] == 'confirmed' else "⏳"
            msg += (
                f"{status_icon} <b>{b['guest_name']}</b>\n"
                f"   {b['check_in']} → {b['check_out']}\n"
                f"   {b['guests']} Personen, {b['total_price']:.0f}€\n\n"
            )

        send_message(chat_id, msg)

    def cmd_gallery_stats(self, chat_id):
        conn = self.get_db()
        total = conn.execute('SELECT COUNT(*) as cnt FROM gallery_images').fetchone()['cnt']
        by_category = conn.execute('''
            SELECT category, COUNT(*) as cnt FROM gallery_images
            WHERE status = 'approved' GROUP BY category ORDER BY cnt DESC
        ''').fetchall()
        pending = conn.execute("SELECT COUNT(*) as cnt FROM gallery_images WHERE status = 'pending'").fetchone()['cnt']
        conn.close()

        msg = f"<b>🖼 Galerie-Statistik</b>\n\nGesamt: {total} Medien\n"
        if pending:
            msg += f"⏳ Wartend: {pending}\n"
        msg += "\n"
        for cat in by_category:
            msg += f"• {cat['category']}: {cat['cnt']}\n"

        send_message(chat_id, msg)

    def cmd_status(self, chat_id):
        conn = self.get_db()
        users = conn.execute('SELECT COUNT(*) as cnt FROM users').fetchone()['cnt']
        projects_open = conn.execute("SELECT COUNT(*) as cnt FROM projects WHERE status IN ('offen', 'in_arbeit')").fetchone()['cnt']
        gallery = conn.execute('SELECT COUNT(*) as cnt FROM gallery_images').fetchone()['cnt']
        today = datetime.now().strftime('%Y-%m-%d')
        overdue = conn.execute('SELECT COUNT(*) as cnt FROM recurring_tasks WHERE is_active = 1 AND next_due < ?', (today,)).fetchone()['cnt']
        conn.close()

        msg = (
            "<b>📊 System-Status</b>\n\n"
            f"👥 Benutzer: {users}\n"
            f"📋 Offene Projekte: {projects_open}\n"
            f"🖼 Galerie: {gallery} Medien\n"
            f"⚠️ Überfällig: {overdue} Aufgaben\n"
        )
        send_message(chat_id, msg)

    def cmd_unknown(self, chat_id, text):
        send_message(chat_id, f"🤔 Kommando nicht erkannt: <code>{text[:50]}</code>\n\nTippe <code>hilfe</code> für alle Kommandos.")

    def handle_callback(self, callback_query):
        """Handle inline button callbacks (confirmations etc.)."""
        callback_data = callback_query.get('data', '')
        callback_id = callback_query.get('id', '')
        chat_id = callback_query.get('message', {}).get('chat', {}).get('id')

        if not callback_data or not chat_id:
            return

        # Handle gallery moderation callbacks (existing)
        if callback_data.startswith(('approve:', 'reject:')):
            # Delegate to existing handler in app.py
            return callback_data

        # Handle agent confirmation callbacks
        if callback_data.startswith('confirm_delete:'):
            item_id = callback_data.split(':')[1]
            conn = self.get_db()
            try:
                conn.execute('DELETE FROM inventory_items WHERE id = ?', (item_id,))
                conn.commit()
                answer_callback_query(callback_id, "Gelöscht!")
                send_message(chat_id, f"🗑 Item {item_id} gelöscht.")
            except Exception:
                answer_callback_query(callback_id, "Fehler!")
            finally:
                conn.close()
        elif callback_data.startswith('cancel_delete:'):
            answer_callback_query(callback_id, "Abgebrochen")
            send_message(chat_id, "❌ Löschung abgebrochen.")
