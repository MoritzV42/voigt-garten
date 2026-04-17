"""
Voigt-Garten Backend
Flask API + Static File Serving for Hetzner Cloud deployment.
"""

from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import os
import sqlite3
from datetime import datetime, timedelta
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
import hashlib
import subprocess
import re
import jwt
import json
import functools
import secrets
import uuid
from collections import deque
from email_service import send_booking_confirmation, send_booking_notification_to_admin, send_activity_notification, send_magic_link_email, send_welcome_email, send_feedback_request, send_google_review_followup, send_payment_reminder, send_application_confirmation, send_application_notification_admin
from telegram_service import send_moderation_request, answer_callback_query, notify_admin, notify_booking, notify_feedback, notify_email_sent, notify_job_application
from storage import LocalStorage
import urllib.parse

try:
    from pricing_service import calculate_booking_price, calculate_cancellation_refund, get_availability, validate_booking
    PRICING_AVAILABLE = True
except ImportError:
    PRICING_AVAILABLE = False
    print("Warning: pricing_service not available")

try:
    from assistant_service import process_message, refine_draft
    ASSISTANT_AVAILABLE = True
except ImportError:
    ASSISTANT_AVAILABLE = False
    print("Warning: assistant_service not available")

try:
    from email_draft_service import create_draft, get_drafts, get_draft, approve_draft, reject_draft, update_draft
    EMAIL_DRAFT_AVAILABLE = True
except ImportError:
    EMAIL_DRAFT_AVAILABLE = False
    print("Warning: email_draft_service not available")

try:
    from coo_reporting import generate_daily_report, get_latest_report
    COO_REPORTING_AVAILABLE = True
except ImportError:
    COO_REPORTING_AVAILABLE = False
    print("Warning: coo_reporting not available")

# COO API Secret
COO_API_SECRET = os.environ.get('COO_API_SECRET', '')
INFINILOOP_API_KEY = os.environ.get('INFINILOOP_API_KEY', '')
INFINILOOP_URL = os.environ.get('INFINILOOP_URL', 'https://infiniloop.infinityspace42.de').rstrip('/')

try:
    from invoice_service import create_invoice_from_booking, generate_invoice_pdf, get_site_config
    INVOICE_AVAILABLE = True
except ImportError:
    INVOICE_AVAILABLE = False
    print("Warning: invoice_service not available")

# JWT Secret Key (use env var in production)
JWT_SECRET = os.environ.get('JWT_SECRET', 'voigt-garten-secret-key-change-in-production-2026')
JWT_EXPIRY_HOURS = 24

if JWT_SECRET == 'voigt-garten-secret-key-change-in-production-2026':
    print("WARNING: Using default JWT secret! Set JWT_SECRET environment variable in production.")

# Google OAuth
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '')
GOOGLE_REDIRECT_URI = os.environ.get('GOOGLE_REDIRECT_URI', 'https://garten.infinityspace42.de/api/auth/google/callback')

# Image processing
try:
    from PIL import Image
    PILLOW_AVAILABLE = True
except ImportError:
    PILLOW_AVAILABLE = False
    print("Warning: Pillow not available, image processing disabled")

app = Flask(__name__)
CORS(app, origins=[
    'https://garten.infinityspace42.de',
    'http://localhost:4321',
    'http://localhost:5055'
])

# Rate limiting
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per hour"],
    storage_uri="memory://",
)

# Allowed gallery categories (path traversal protection)
ALLOWED_CATEGORIES = {'garten', 'haus', 'umgebung', 'sonstiges', 'luftaufnahmen', 'events', 'projekte', 'tiere'}

# Paths (Docker environment)
DATA_DIR = os.environ.get('DATA_DIR', '/app/data')
STATIC_DIR = os.environ.get('STATIC_DIR', '/app/static')
GALLERY_DIR = os.environ.get('GALLERY_DIR', '/app/public/images/gallery')
DB_PATH = os.path.join(DATA_DIR, 'garten.db')

# Ensure directories exist
os.makedirs(GALLERY_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

# Storage backend
storage = LocalStorage(GALLERY_DIR)

# Garten-Agent Blueprint
try:
    from agent_routes import agent_bp
    app.register_blueprint(agent_bp)
    print("[app] garten-agent blueprint registered")
except ImportError as e:
    print(f"[app] Warning: garten-agent not available: {e}")


@app.after_request
def add_security_headers(response):
    """Add security headers to all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    if not request.path.startswith('/api/'):
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "img-src 'self' data: blob:; "
            "font-src 'self'; "
            "connect-src 'self'; "
            "frame-src https://drive.google.com https://www.youtube.com https://cdn.pannellum.org"
        )
    return response

# Allowed file types
ALLOWED_IMAGE_EXTENSIONS = {'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'}
ALLOWED_VIDEO_EXTENSIONS = {'mp4', 'mov', 'webm', 'avi'}
ALLOWED_EXTENSIONS = ALLOWED_IMAGE_EXTENSIONS | ALLOWED_VIDEO_EXTENSIONS


def get_db():
    """Get database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def generic_patch(table, record_id, data, allowed_fields, id_column='id',
                  json_fields=None, timestamp_field='updated_at'):
    """Generic PATCH helper for updating database records."""
    json_fields = json_fields or set()
    conn = get_db()
    record = conn.execute(f'SELECT 1 FROM {table} WHERE {id_column} = ?', (record_id,)).fetchone()
    if not record:
        conn.close()
        return jsonify({'error': 'Nicht gefunden'}), 404
    updates, params = [], []
    for field in allowed_fields:
        if field in data:
            value = data[field]
            if field in json_fields and not isinstance(value, str):
                value = json.dumps(value)
            updates.append(f'{field} = ?')
            params.append(value)
    if not updates:
        conn.close()
        return jsonify({'error': 'Keine Felder'}), 400
    if timestamp_field:
        updates.append(f'{timestamp_field} = ?')
        params.append(datetime.now().isoformat())
    params.append(record_id)
    conn.execute(f'UPDATE {table} SET {", ".join(updates)} WHERE {id_column} = ?', params)
    conn.commit()
    conn.close()
    return jsonify({'success': True})


def parse_json_fields(row_dict, fields=('assigned_to_list', 'dependencies')):
    """Parse JSON string fields in a database row dict."""
    for f in fields:
        if row_dict.get(f) and isinstance(row_dict[f], str):
            try:
                row_dict[f] = json.loads(row_dict[f])
            except (json.JSONDecodeError, TypeError):
                row_dict[f] = []
    return row_dict


def init_db():
    """Initialize the database."""
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS gallery_images (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            original_name TEXT,
            name TEXT,
            description TEXT,
            category TEXT DEFAULT 'sonstiges',
            type TEXT DEFAULT 'image',
            size INTEGER,
            uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
            uploaded_by TEXT,
            thumbnail_path TEXT,
            webp_path TEXT,
            original_path TEXT
        );

        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guest_name TEXT NOT NULL,
            guest_email TEXT NOT NULL,
            guest_phone TEXT,
            check_in DATE NOT NULL,
            check_out DATE NOT NULL,
            guests INTEGER DEFAULT 2,
            has_pets BOOLEAN DEFAULT 0,
            total_price REAL NOT NULL,
            discount_code TEXT,
            notes TEXT,
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS maintenance_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            completed_by TEXT NOT NULL,
            completed_at TEXT DEFAULT CURRENT_TIMESTAMP,
            notes TEXT,
            photo_filename TEXT
        );

        CREATE TABLE IF NOT EXISTS credits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guest_email TEXT NOT NULL,
            amount REAL NOT NULL,
            reason TEXT NOT NULL,
            type TEXT DEFAULT 'earned',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS service_providers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            name TEXT NOT NULL,
            email TEXT,
            phone TEXT,
            rating INTEGER DEFAULT 0,
            notes TEXT,
            verified BOOLEAN DEFAULT 0
        );

        -- User management
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT,
            role TEXT DEFAULT 'user',
            last_login DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Auth tokens for JWT validation
        CREATE TABLE IF NOT EXISTS auth_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL,
            expires_at DATETIME NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        -- Projects (dynamische Aufgaben / Kanban)
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            category TEXT NOT NULL,
            status TEXT DEFAULT 'offen',
            priority TEXT DEFAULT 'mittel',
            estimated_cost TEXT,
            effort TEXT,
            timeframe TEXT,
            assigned_to TEXT,
            completed_at DATETIME,
            completed_by TEXT,
            completion_photo TEXT,
            completion_notes TEXT,
            confirmed_at DATETIME,
            confirmed_by TEXT,
            credit_awarded REAL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_by TEXT
        );

        -- Wiederkehrende Aufgaben (aus wartung.astro migriert)
        CREATE TABLE IF NOT EXISTS recurring_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            category TEXT NOT NULL,
            cycle_days INTEGER NOT NULL,
            credit_value REAL DEFAULT 0,
            effort TEXT,
            next_due DATE,
            last_completed_at DATETIME,
            last_completed_by TEXT,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Mängelmeldungen von Gästen
        CREATE TABLE IF NOT EXISTS issue_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            category TEXT,
            photo_filename TEXT,
            reported_by TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            admin_notes TEXT,
            converted_to_project_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    ''')
    conn.commit()

    # Create main admin if not exists
    cursor = conn.execute("SELECT id FROM users WHERE email = 'moritzvoigt42@gmail.com'")
    if not cursor.fetchone():
        admin_password = os.environ.get('ADMIN_PASSWORD_MORITZ')
        if admin_password:
            admin_password_hash = generate_password_hash(admin_password)
            conn.execute('''
                INSERT INTO users (email, username, password_hash, name, role)
                VALUES (?, ?, ?, ?, ?)
            ''', ('moritzvoigt42@gmail.com', 'MoritzVoigt42', admin_password_hash, 'Moritz Voigt', 'admin'))
            conn.commit()
            print("Main admin user created: moritzvoigt42@gmail.com")
        else:
            print("WARNING: ADMIN_PASSWORD_MORITZ not set, skipping admin user creation")

    # Create Konny Voigt admin if not exists
    cursor = conn.execute("SELECT id FROM users WHERE email = 'konny.voigt@web.de'")
    if not cursor.fetchone():
        konny_password = os.environ.get('ADMIN_PASSWORD_KONNY')
        if konny_password:
            konny_password_hash = generate_password_hash(konny_password)
            conn.execute('''
                INSERT INTO users (email, username, password_hash, name, role)
                VALUES (?, ?, ?, ?, ?)
            ''', ('konny.voigt@web.de', 'KonnyVoigt', konny_password_hash, 'Konny Voigt', 'admin'))
            conn.commit()
            print("Admin user created: konny.voigt@web.de")
        else:
            print("WARNING: ADMIN_PASSWORD_KONNY not set, skipping admin user creation")

    # Seed recurring tasks if empty
    cursor = conn.execute("SELECT COUNT(*) as count FROM recurring_tasks")
    if cursor.fetchone()['count'] == 0:
        seed_recurring_tasks(conn)

    conn.close()
    print("Database initialized")


def migrate_db():
    """Run database migrations."""
    conn = get_db()

    # Add status column to gallery_images
    try:
        conn.execute("ALTER TABLE gallery_images ADD COLUMN status TEXT DEFAULT 'approved'")
        conn.commit()
        print("Migration: Added status column to gallery_images")
    except Exception:
        pass  # Column already exists

    # Background videos table
    conn.execute('''
        CREATE TABLE IF NOT EXISTS background_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            page TEXT UNIQUE NOT NULL,
            video_path TEXT NOT NULL,
            thumbnail_path TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Livestream cameras table
    conn.execute('''
        CREATE TABLE IF NOT EXISTS livestream_cameras (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            stream_url TEXT,
            hls_url TEXT,
            is_active BOOLEAN DEFAULT 0,
            privacy_mode BOOLEAN DEFAULT 1,
            placeholder_image TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Email verification tokens table
    conn.execute('''
        CREATE TABLE IF NOT EXISTS email_verification_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            token TEXT UNIQUE NOT NULL,
            expires_at DATETIME NOT NULL,
            used BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Inventory tables
    conn.execute('''
        CREATE TABLE IF NOT EXISTS inventory_buildings (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            icon TEXT DEFAULT '🏠',
            has_floors BOOLEAN DEFAULT 0,
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    conn.execute('''
        CREATE TABLE IF NOT EXISTS inventory_floors (
            id TEXT PRIMARY KEY,
            building_id TEXT NOT NULL REFERENCES inventory_buildings(id),
            name TEXT NOT NULL,
            icon TEXT DEFAULT '🏢',
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    conn.execute('''
        CREATE TABLE IF NOT EXISTS inventory_rooms (
            id TEXT PRIMARY KEY,
            building_id TEXT NOT NULL REFERENCES inventory_buildings(id),
            floor_id TEXT REFERENCES inventory_floors(id),
            name TEXT NOT NULL,
            icon TEXT DEFAULT '🚪',
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    conn.execute('''
        CREATE TABLE IF NOT EXISTS inventory_items (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            room_id TEXT REFERENCES inventory_rooms(id),
            category TEXT,
            notes TEXT,
            quantity INTEGER DEFAULT 1,
            photo_path TEXT,
            ablageort TEXT,
            position TEXT,
            kauflink TEXT,
            vorhanden BOOLEAN DEFAULT 1,
            created_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    conn.execute('''
        CREATE TABLE IF NOT EXISTS inventory_furniture_meta (
            room_id TEXT,
            ablageort TEXT,
            icon TEXT DEFAULT '🪑',
            PRIMARY KEY (room_id, ablageort)
        )
    ''')

    conn.commit()

    # -- Wartung Phase 0: New columns on projects --
    for col_stmt in [
        "ALTER TABLE projects ADD COLUMN parent_task_id INTEGER REFERENCES projects(id)",
        "ALTER TABLE projects ADD COLUMN start_date DATE",
        "ALTER TABLE projects ADD COLUMN due_date DATE",
        "ALTER TABLE projects ADD COLUMN dependencies TEXT DEFAULT '[]'",
        "ALTER TABLE projects ADD COLUMN assigned_to_list TEXT DEFAULT '[]'",
    ]:
        try:
            conn.execute(col_stmt)
            conn.commit()
            print(f"Migration: {col_stmt}")
        except Exception:
            pass  # Column already exists

    # Task comments table
    conn.execute('''
        CREATE TABLE IF NOT EXISTS task_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            task_type TEXT NOT NULL,
            user_email TEXT NOT NULL,
            user_name TEXT,
            comment TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()

    # -- Garden Map: map_area columns --
    for col_stmt in [
        "ALTER TABLE projects ADD COLUMN map_area TEXT",
        "ALTER TABLE recurring_tasks ADD COLUMN map_area TEXT",
        "ALTER TABLE inventory_buildings ADD COLUMN map_area TEXT",
    ]:
        try:
            conn.execute(col_stmt)
            conn.commit()
            print(f"Migration: {col_stmt}")
        except Exception:
            pass  # Column already exists

    # -- Phase 2: Merge recurring_tasks into projects --
    for col_stmt in [
        "ALTER TABLE projects ADD COLUMN is_recurring BOOLEAN DEFAULT 0",
        "ALTER TABLE projects ADD COLUMN cycle_days INTEGER",
        "ALTER TABLE projects ADD COLUMN credit_value REAL DEFAULT 0",
    ]:
        try:
            conn.execute(col_stmt)
            conn.commit()
            print(f"Migration: {col_stmt}")
        except Exception:
            pass  # Column already exists

    # Migrate recurring_tasks data into projects (one-time)
    try:
        existing = conn.execute("SELECT COUNT(*) as c FROM projects WHERE is_recurring = 1").fetchone()['c']
        if existing == 0:
            recurring = conn.execute("SELECT * FROM recurring_tasks").fetchall()
            for rt in recurring:
                rt = dict(rt)
                conn.execute('''
                    INSERT INTO projects (title, description, category, status, priority, effort,
                        is_recurring, cycle_days, credit_value, due_date, assigned_to, map_area, created_by)
                    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'system-migration')
                ''', (
                    rt['title'], rt.get('description'), rt['category'],
                    'offen' if rt.get('is_active', 1) else 'done',
                    'mittel', rt.get('effort', 'mittel'),
                    rt.get('cycle_days', 30), rt.get('credit_value', 0),
                    rt.get('next_due'), rt.get('assigned_to'), rt.get('map_area')
                ))
            conn.commit()
            if recurring:
                print(f"Migration: Migrated {len(recurring)} recurring tasks to projects")
    except Exception as e:
        print(f"Migration recurring→projects: {e}")

    # Add report_type column to issue_reports
    try:
        conn.execute("ALTER TABLE issue_reports ADD COLUMN report_type TEXT DEFAULT 'mangel'")
        conn.commit()
        print("Migration: Added report_type column to issue_reports")
    except Exception:
        pass  # Column already exists

    # Add Google OAuth columns to users
    for col_stmt in [
        "ALTER TABLE users ADD COLUMN google_id TEXT",
        "ALTER TABLE users ADD COLUMN profile_image_url TEXT",
    ]:
        try:
            conn.execute(col_stmt)
            conn.commit()
            print(f"Migration: {col_stmt}")
        except Exception:
            pass  # Column already exists

    # Seed inventory if empty
    seed_inventory(conn)

    # Seed Starlink project if not exists
    existing = conn.execute("SELECT id FROM projects WHERE title = 'Starlink bestellen, anbringen & einrichten'").fetchone()
    if not existing:
        conn.execute('''
            INSERT INTO projects (title, description, category, status, priority, estimated_cost, effort, timeframe, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            'Starlink bestellen, anbringen & einrichten',
            'Komplettpaket Starlink-Internet für den Garten:\n'
            '1. Starlink Standard Kit bestellen (200€ Setup + 49€/Monat)\n'
            '2. Schüssel auf Dach/Mast montieren (Südausrichtung, freie Sicht)\n'
            '3. Stromversorgung sicherstellen (Solar-Erweiterung oder Steckdose im Haus)\n'
            '4. WLAN-Repeater aufstellen für Gartenabdeckung (z.B. TP-Link Outdoor)\n'
            '5. Starlink-Schüssel ausrichten (App-gesteuert, automatische Justierung)\n'
            '6. Überwachungskamera bestellen & anbringen (z.B. Reolink Solar-Cam)\n'
            '7. Kamera mit WLAN verbinden & App-Setup (Reolink/Tapo App)\n'
            '8. Fernsteuerung einrichten: Starlink-App + Kamera-App + ggf. Home Assistant\n\n'
            'Geschätzte Gesamtkosten:\n'
            '- Starlink Kit: 200€ Setup\n'
            '- WLAN-Repeater Outdoor: ~50€\n'
            '- Solar-Kamera: ~100€\n'
            '- Montagematerial (Mast, Kabel, Kabelbinder): ~50€\n'
            '- Gesamt: ~400€ einmalig + 49€/Monat',
            'elektrik',
            'offen',
            'hoch',
            '~400€ einmalig + 49€/Monat',
            'schwer',
            '1-2 Wochenenden',
            'moritzvoigt42@gmail.com'
        ))
        conn.commit()
        print("Seeded Starlink project")

    # NOTE: All task seeds (brainstorming, legal, IT) already in production DB.
    # Tasks are now managed via API — no more hardcoded seed data.

    # Map area descriptions table
    conn.execute('''
        CREATE TABLE IF NOT EXISTS map_area_descriptions (
            area_id TEXT PRIMARY KEY,
            description TEXT NOT NULL DEFAULT '',
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_by TEXT
        )
    ''')
    conn.commit()

    # Seed default area descriptions
    default_areas = [
        ('haus', 'Gartenhaus mit Wohnbereich, Küche und Bad'),
        ('wintergarten', 'Verglaster Wintergarten am Haus'),
        ('terrasse', 'Terrasse mit Sitzbereich'),
        ('geraeteschuppen', 'Geräteschuppen mit Gartengeräten'),
        ('offener-schuppen', 'Offener Schuppen'),
        ('holzschuppen', 'Holzschuppen für Brennholzlagerung'),
        ('baumhaus', 'Baumhaus im alten Baumbestand'),
        ('klo', 'Außentoilette'),
        ('werkstatt', 'Werkstatt mit Werkzeug und Maschinen'),
        ('zufahrt', 'Zufahrt zum Grundstück'),
        ('unterer-eingang', 'Unterer Eingang zum Grundstück'),
        ('teich', 'Gartenteich'),
        ('pool', 'Aufstellpool'),
        ('brunnen', 'Brunnen (50m tief)'),
        ('wasserbehaelter-mauer', 'Wasserbehälter an der Mauer'),
        ('baum-wassertank', 'Wassertank am Baum'),
        ('tonne-geraeteschuppen', 'Regentonne am Geräteschuppen'),
        ('tonne-schuppen', 'Regentonne am offenen Schuppen'),
        ('tonne-werkstatt', 'Regentonne an der Werkstatt'),
        ('tonne-holzschuppen', 'Regentonne am Holzschuppen'),
        ('unterirdischer-wasserbehaelter', 'Unterirdischer Wasserbehälter/Zisterne'),
        ('solaranlage', 'Solaranlage 700W + 1,4kWh Akku'),
        ('solaranlage-speicher', 'Neue Solaranlage mit Speicher'),
        ('weinberg', 'Weinberg am Südhang'),
        ('eiche-1', 'Große Eiche (Stammdurchmesser >1m)'),
        ('eiche-2', 'Zweite große Eiche'),
        ('terrassen-beet', 'Terrassenbeet'),
        ('kompost', 'Kompostbereich'),
        ('oberer-kompost', 'Oberer Kompostbereich'),
        ('unterer-kompost', 'Unterer Kompostbereich'),
        ('hecke-mittig', 'Hecke in der Mitte des Grundstücks'),
        ('rechter-teil', 'Rechter Grundstücksteil'),
        ('agrar-zukauf', 'Agrarfläche (Zukauf-Option)'),
    ]
    for area_id, desc in default_areas:
        conn.execute(
            'INSERT OR IGNORE INTO map_area_descriptions (area_id, description) VALUES (?, ?)',
            (area_id, desc)
        )
    conn.commit()

    # Add map_area column to gallery_images
    try:
        conn.execute("ALTER TABLE gallery_images ADD COLUMN map_area TEXT")
        conn.commit()
        print("Migration: Added map_area column to gallery_images")
    except Exception:
        pass  # Column already exists

    # Add map_x, map_y columns to gallery_images for precise photo locations on SVG map
    for col in ['map_x REAL', 'map_y REAL']:
        try:
            conn.execute(f"ALTER TABLE gallery_images ADD COLUMN {col}")
            conn.commit()
            print(f"Migration: Added {col.split()[0]} column to gallery_images")
        except Exception:
            pass  # Column already exists

    # Garden costs table
    conn.execute('''
        CREATE TABLE IF NOT EXISTS garden_costs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            amount REAL NOT NULL,
            frequency TEXT DEFAULT 'einmalig',
            category TEXT,
            date TEXT,
            end_date TEXT,
            is_active BOOLEAN DEFAULT 1,
            related_project_id INTEGER,
            created_by TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()

    # Seed costs if empty
    costs_count = conn.execute("SELECT COUNT(*) as c FROM garden_costs").fetchone()['c']
    if costs_count == 0:
        conn.execute('''
            INSERT INTO garden_costs (title, description, amount, frequency, category, is_active, created_by)
            VALUES (?, ?, ?, ?, ?, 1, 'system')
        ''', ('Starlink Internet', 'Monatliche Starlink-Gebühr', 49.0, 'monatlich', 'Internet'))
        conn.execute('''
            INSERT INTO garden_costs (title, description, amount, frequency, category, is_active, created_by)
            VALUES (?, ?, ?, ?, ?, 1, 'system')
        ''', ('Grundstückspacht', 'Jährliche Pacht an Opa', 100.0, 'jährlich', 'Pacht'))
        conn.commit()
        print("Seeded garden costs")


    # -- Phase 2: New tables --

    # invoices table
    conn.execute('''
        CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booking_id INTEGER REFERENCES bookings(id),
            invoice_number TEXT UNIQUE NOT NULL,
            status TEXT DEFAULT 'draft',
            guest_name TEXT NOT NULL,
            guest_email TEXT NOT NULL,
            guest_address TEXT,
            line_items TEXT,
            subtotal REAL NOT NULL,
            credits_applied REAL DEFAULT 0,
            total REAL NOT NULL,
            tax_note TEXT DEFAULT 'Gem\u00e4\u00df \u00a7 19 UStG wird keine Umsatzsteuer berechnet.',
            pdf_path TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            sent_at TEXT,
            due_date TEXT
        )
    ''')

    # pricing_rules table
    conn.execute('''
        CREATE TABLE IF NOT EXISTS pricing_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            season_start_month INTEGER NOT NULL,
            season_end_month INTEGER NOT NULL,
            nightly_rate REAL NOT NULL,
            weekend_surcharge REAL DEFAULT 5.0,
            per_person_base REAL DEFAULT 0,
            person_discount_factor REAL DEFAULT 0.85,
            min_nights INTEGER DEFAULT 1,
            is_active BOOLEAN DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # cancellations table
    conn.execute('''
        CREATE TABLE IF NOT EXISTS cancellations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booking_id INTEGER NOT NULL REFERENCES bookings(id),
            cancelled_at TEXT DEFAULT CURRENT_TIMESTAMP,
            cancelled_by TEXT,
            policy_applied TEXT,
            refund_percent REAL,
            refund_amount REAL,
            reason TEXT
        )
    ''')

    # feedback table
    conn.execute('''
        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booking_id INTEGER REFERENCES bookings(id),
            guest_email TEXT NOT NULL,
            rating INTEGER CHECK(rating BETWEEN 1 AND 5),
            cleanliness INTEGER CHECK(cleanliness BETWEEN 1 AND 5),
            communication INTEGER CHECK(communication BETWEEN 1 AND 5),
            location INTEGER CHECK(location BETWEEN 1 AND 5),
            accuracy INTEGER CHECK(accuracy BETWEEN 1 AND 5),
            comment TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            google_review_sent BOOLEAN DEFAULT 0
        )
    ''')

    # site_config table
    conn.execute('''
        CREATE TABLE IF NOT EXISTS site_config (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # translations table (i18n cache)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS translations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_text TEXT NOT NULL,
            target_lang TEXT NOT NULL DEFAULT 'en',
            translated_text TEXT NOT NULL,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(source_text, target_lang)
        )
    ''')

    conn.commit()

    # -- Phase 2: ALTER TABLE migrations for bookings --
    for col_stmt in [
        "ALTER TABLE bookings ADD COLUMN terms_accepted BOOLEAN DEFAULT 0",
        "ALTER TABLE bookings ADD COLUMN privacy_accepted BOOLEAN DEFAULT 0",
        "ALTER TABLE bookings ADD COLUMN cancellation_policy TEXT",
        "ALTER TABLE bookings ADD COLUMN invoice_id INTEGER",
        "ALTER TABLE bookings ADD COLUMN season_rate REAL",
        "ALTER TABLE bookings ADD COLUMN weekend_nights INTEGER DEFAULT 0",
        "ALTER TABLE bookings ADD COLUMN person_price REAL",
    ]:
        try:
            conn.execute(col_stmt)
            conn.commit()
        except Exception:
            pass

    # -- Phase 2: ALTER TABLE for map_area_descriptions --
    try:
        conn.execute("ALTER TABLE map_area_descriptions ADD COLUMN category TEXT DEFAULT 'natur'")
        conn.commit()
        print("Migration: Added category column to map_area_descriptions")
    except Exception:
        pass

    # -- Phase 2: Indices --
    conn.execute("CREATE INDEX IF NOT EXISTS idx_bookings_checkin ON bookings(check_in)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_bookings_checkout ON bookings(check_out)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(guest_email)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_inventory_items_room ON inventory_items(room_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_invoices_booking ON invoices(booking_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_feedback_booking ON feedback(booking_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_translations_lookup ON translations(source_text, target_lang)")
    conn.commit()

    # Seed pricing rules if empty
    try:
        count = conn.execute("SELECT COUNT(*) as c FROM pricing_rules").fetchone()['c']
        if count == 0:
            pricing_seeds = [
                ('Hochsaison', 5, 9, 60.0, 5.0, 0, 0.85, 1),
                ('Standardsaison Fr\u00fchling', 4, 4, 45.0, 5.0, 0, 0.85, 1),
                ('Standardsaison Herbst', 10, 10, 45.0, 5.0, 0, 0.85, 1),
                ('Nebensaison', 11, 3, 30.0, 5.0, 0, 0.85, 2),
            ]
            for name, start, end, rate, surcharge, person_base, discount, min_n in pricing_seeds:
                conn.execute('''
                    INSERT INTO pricing_rules (name, season_start_month, season_end_month,
                        nightly_rate, weekend_surcharge, per_person_base, person_discount_factor, min_nights)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''', (name, start, end, rate, surcharge, person_base, discount, min_n))
            conn.commit()
            print("Seeded pricing rules")
    except Exception as e:
        print(f"Pricing rules seed: {e}")

    # Seed site_config defaults
    # WICHTIG: Diese Seeds greifen NUR bei einer frisch angelegten DB (count == 0).
    # In einer bestehenden Produktions-DB werden existierende Werte NICHT überschrieben.
    # Nach dem Rebranding zu "Refugium Naturgärten" müssen die Werte in Prod entweder
    # manuell via SQL oder über das Admin-Settings-UI aktualisiert werden.
    try:
        count = conn.execute("SELECT COUNT(*) as c FROM site_config").fetchone()['c']
        if count == 0:
            defaults = [
                # Dachmarke (Firmenname für Rechnungen, Impressum etc.)
                ('company_name', 'Refugium Naturgärten'),
                # Standort-Name für Website-Titel, Email-Header etc.
                ('site_name', 'Refugium Heideland'),
                ('site_title', 'Refugium Heideland – Refugium Naturgärten'),
                ('footer_text', 'Refugium Naturgärten · betrieben über Infinity Space'),
                # Bankverbindung: Platzhalter, müssen im Admin-UI befüllt werden.
                # HINWEIS: Diese Werte dürfen NICHT falsch sein – lieber Platzhalter
                # als falsche Kontoinhaber.
                ('account_holder', '[PLACEHOLDER]'),
                ('iban', '[PLACEHOLDER]'),
                ('bic', '[PLACEHOLDER]'),
                ('address', 'Heideland, Thüringen'),
                ('tax_number', '[PLACEHOLDER]'),
                ('email', 'garten@infinityspace42.de'),
                ('support_email_display', 'Refugium Heideland <garten@infinityspace42.de>'),
                ('phone', '01652593763'),
                ('first_year_discount', '42'),
                ('week_discount', '10'),
                ('repeat_discount', '15'),
                ('max_overnight_guests', '6'),
                ('max_day_guests', '20'),
                ('family_discount_code', 'REFUGIUM-FAMILY'),
            ]
            for key, value in defaults:
                conn.execute('INSERT INTO site_config (key, value) VALUES (?, ?)', (key, value))
            conn.commit()
            print("Seeded site_config")
    except Exception as e:
        print(f"Site config seed: {e}")


    # -- Categories tables (multi-category support) --
    conn.execute('''
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            label TEXT NOT NULL,
            emoji TEXT,
            color TEXT,
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS project_categories (
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
            PRIMARY KEY (project_id, category_id)
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS recurring_task_categories (
            recurring_task_id INTEGER NOT NULL REFERENCES recurring_tasks(id) ON DELETE CASCADE,
            category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
            PRIMARY KEY (recurring_task_id, category_id)
        )
    ''')
    conn.commit()

    # Seed categories if empty
    cat_count = conn.execute("SELECT COUNT(*) as c FROM categories").fetchone()['c']
    if cat_count == 0:
        category_seeds = [
            ('rasen', 'Rasenpflege', '🌿', 'bg-green-100 text-green-800', 0),
            ('beete', 'Beetarbeiten', '🌻', 'bg-yellow-100 text-yellow-800', 1),
            ('baeume', 'Bäume & Hecken', '🌳', 'bg-emerald-100 text-emerald-800', 2),
            ('brennholz', 'Brennholz', '🪵', 'bg-amber-100 text-amber-800', 3),
            ('elektrik', 'Elektrik', '⚡', 'bg-blue-100 text-blue-800', 4),
            ('putzen', 'Reinigung', '🧹', 'bg-purple-100 text-purple-800', 5),
            ('wasser', 'Wasser', '💧', 'bg-cyan-100 text-cyan-800', 6),
            ('haus', 'Haus', '🏠', 'bg-orange-100 text-orange-800', 7),
            ('garten', 'Garten', '🌱', 'bg-lime-100 text-lime-800', 8),
            ('rechtliches', 'Rechtliches', '⚖️', 'bg-rose-100 text-rose-800', 9),
            ('it', 'IT & Bugs', '💻', 'bg-indigo-100 text-indigo-800', 10),
            ('sonstiges', 'Sonstiges', '🔧', 'bg-gray-100 text-gray-800', 11),
        ]
        for name, label, emoji, color, sort_order in category_seeds:
            conn.execute(
                'INSERT INTO categories (name, label, emoji, color, sort_order) VALUES (?, ?, ?, ?, ?)',
                (name, label, emoji, color, sort_order)
            )
        conn.commit()
        print("Seeded 12 categories")

    # Ensure marketing & infrastructure categories exist (idempotent)
    conn.execute(
        "INSERT OR IGNORE INTO categories (name, label, emoji, color, sort_order) VALUES (?, ?, ?, ?, ?)",
        ('marketing', 'Marketing', '📣', 'bg-pink-100 text-pink-800', 12)
    )
    conn.execute(
        "INSERT OR IGNORE INTO categories (name, label, emoji, color, sort_order) VALUES (?, ?, ?, ?, ?)",
        ('infrastruktur', 'Infrastruktur', '🏗️', 'bg-slate-100 text-slate-800', 13)
    )
    conn.commit()

    # Migrate existing TEXT category → junction tables (one-time)
    try:
        existing_pc = conn.execute("SELECT COUNT(*) as c FROM project_categories").fetchone()['c']
        if existing_pc == 0:
            conn.execute('''
                INSERT OR IGNORE INTO project_categories (project_id, category_id)
                SELECT p.id, c.id FROM projects p JOIN categories c ON p.category = c.name
                WHERE p.category IS NOT NULL
            ''')
            conn.commit()
            migrated = conn.execute("SELECT COUNT(*) as c FROM project_categories").fetchone()['c']
            if migrated > 0:
                print(f"Migration: Migrated {migrated} project→category mappings")
    except Exception as e:
        print(f"Migration project_categories: {e}")

    try:
        existing_rtc = conn.execute("SELECT COUNT(*) as c FROM recurring_task_categories").fetchone()['c']
        if existing_rtc == 0:
            conn.execute('''
                INSERT OR IGNORE INTO recurring_task_categories (recurring_task_id, category_id)
                SELECT rt.id, c.id FROM recurring_tasks rt JOIN categories c ON rt.category = c.name
                WHERE rt.category IS NOT NULL
            ''')
            conn.commit()
            migrated = conn.execute("SELECT COUNT(*) as c FROM recurring_task_categories").fetchone()['c']
            if migrated > 0:
                print(f"Migration: Migrated {migrated} recurring_task→category mappings")
    except Exception as e:
        print(f"Migration recurring_task_categories: {e}")

    # Re-categorize "sonstiges" tasks that belong elsewhere
    try:
        recategorize_map = {
            # project_id -> [new_categories]
            35: ['garten'], 20: ['garten'],       # Werkzeug pflegen
            36: ['garten'], 21: ['garten'],       # Zaun kontrollieren
            37: ['garten', 'haus'], 22: ['garten', 'haus'],  # Winterfest machen
            38: ['garten', 'haus'], 23: ['garten', 'haus'],  # Frühjahrs-Check
            39: ['rechtliches'],                   # Pachtvertrag mit Opa
            40: ['rechtliches', 'garten'],         # Oster-Planung
            41: ['garten'],                        # Baumarkt-Besorgungen
            43: ['it'],                            # Software-Features
            44: ['rechtliches'],                   # Rechtliches Backend
        }
        for project_id, new_cats in recategorize_map.items():
            # Check if project exists and is currently 'sonstiges'
            row = conn.execute('SELECT category FROM projects WHERE id = ?', (project_id,)).fetchone()
            if row and row['category'] == 'sonstiges':
                # Update primary category
                conn.execute('UPDATE projects SET category = ? WHERE id = ?', (new_cats[0], project_id))
                # Update junction table
                conn.execute('DELETE FROM project_categories WHERE project_id = ?', (project_id,))
                for cat_name in new_cats:
                    cat_row = conn.execute('SELECT id FROM categories WHERE name = ?', (cat_name,)).fetchone()
                    if cat_row:
                        conn.execute(
                            'INSERT OR IGNORE INTO project_categories (project_id, category_id) VALUES (?, ?)',
                            (project_id, cat_row['id'])
                        )
                print(f"Re-categorized project #{project_id} → {new_cats}")
        conn.commit()
    except Exception as e:
        print(f"Re-categorize sonstiges: {e}")

    # Indices for category junction tables
    conn.execute("CREATE INDEX IF NOT EXISTS idx_project_categories_pid ON project_categories(project_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_project_categories_cid ON project_categories(category_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_recurring_task_categories_rtid ON recurring_task_categories(recurring_task_id)")
    conn.commit()

    # Job applications table
    conn.execute('''
        CREATE TABLE IF NOT EXISTS job_applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT,
            position TEXT NOT NULL,
            available_from TEXT,
            hours_per_week INTEGER,
            preferred_times TEXT,
            motivation TEXT,
            resume_path TEXT,
            status TEXT DEFAULT 'pending',
            admin_notes TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT
        )
    ''')
    conn.execute("CREATE INDEX IF NOT EXISTS idx_job_applications_status ON job_applications(status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_job_applications_created ON job_applications(created_at)")
    conn.commit()

    # -- Milestones (Roadmap) --
    conn.execute('''
        CREATE TABLE IF NOT EXISTS milestones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            target_date DATE,
            status TEXT DEFAULT 'active',
            image_path TEXT,
            sort_order INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    try:
        conn.execute("ALTER TABLE projects ADD COLUMN milestone_id INTEGER REFERENCES milestones(id)")
        conn.commit()
        print("Migration: Added milestone_id column to projects")
    except Exception:
        pass
    conn.commit()

    # Seed milestones if empty
    try:
        ms_count = conn.execute("SELECT COUNT(*) as c FROM milestones").fetchone()['c']
        if ms_count == 0:
            milestone_seeds = [
                ('Launch 01.05.2026', 'Go-Live als gewerbliche Vermietung', '2026-05-01', 'active', 0),
                ('Sommer-Saison 2026', 'Start der ersten vollen Saison', '2026-06-21', 'active', 1),
                ('Pool unten', 'Naturpool im unteren Gartenbereich', None, 'idea', 2),
                ('Unterirdischer Pool', 'Vision: unterirdischer Pool unter dem Haus', None, 'idea', 3),
                ('3D-AI-Roadmap-Hintergrund', 'Visualisierte Meilensteine mit nanobanana/video-ai, Antigravity-Scroll-Logik als Roadmap-Hintergrund', None, 'idea', 4),
            ]
            for name, desc, target, status, order in milestone_seeds:
                conn.execute(
                    'INSERT INTO milestones (name, description, target_date, status, sort_order) VALUES (?, ?, ?, ?, ?)',
                    (name, desc, target, status, order)
                )
            conn.commit()
            print("Seeded 5 milestones")
    except Exception as e:
        print(f"Milestone seed: {e}")

    # Seed 12 Launch-Offline-Tasks if not exists
    try:
        existing = conn.execute(
            "SELECT id FROM projects WHERE title = ? AND category = ?",
            ('Pachtvertrag unterschreiben', 'launch-offline')
        ).fetchone()
        if not existing:
            launch_ms = conn.execute(
                "SELECT id FROM milestones WHERE name = 'Launch 01.05.2026'"
            ).fetchone()
            launch_ms_id = launch_ms['id'] if launch_ms else None

            offline_tasks = [
                ('Pachtvertrag unterschreiben',
                 'Gespräch mit Opa Konrad, formelles Dokument (auch selbst erstellt) unterschreiben. Ohne Pachtvertrag kein gewerblicher Launch und kein Impressum-Umschalten. #impressum-trigger',
                 'hoch'),
                ('Schornsteinfeger-Check',
                 'Schornsteinfeger bestellen, Kaminofen abnehmen lassen. Pflicht für gewerbliche Vermietung.',
                 'hoch'),
                ('Versicherungsschutz klären',
                 'Gewerbehaftpflicht, Gebäudeversicherung und Gästehaftpflicht recherchieren und abschließen.',
                 'hoch'),
                ('WC-Upgrade Trockentrenntoilette',
                 'Plumpsklo durch ökologische Trockentrenntoilette upgraden – Natur pur ohne Kompromisse, Komfort für Gäste.',
                 'hoch'),
                ('Job-Anzeigen schalten',
                 'Kleinanzeigen, MyHammer, Stellenwerk Jena – Minijob-Inserate für Garten-Hilfen & Studenten online stellen.',
                 'hoch'),
                ('Hardware-Einkauf (Starlink, Kameras, Elektro)',
                 'Starlink Kit, Überwachungskameras, Elektro-Material, AUS-Schalter-Hardware bestellen und liefern lassen.',
                 'hoch'),
                ('Studenten-Onboarding (Minijob-Anmeldung)',
                 'Minijob-Zentrale-Anmeldung vorbereiten, SV-Nummern einsammeln, Verträge vorbereiten.',
                 'hoch'),
                ('Oster-Familien-Meeting',
                 'Familien-Meeting Ostern: Kooperationsmodell, Rollen, Nutzungskonzept final abstimmen.',
                 'mittel'),
                ('Elektro-Endabnahme (E-Check)',
                 'Elektriker für professionelle Endabnahme (E-Check) beauftragen. Voraussetzung für gewerbliche Vermietung.',
                 'mittel'),
                ('Beschilderung Videoüberwachung + AUS-Schalter montieren',
                 'DSGVO-konforme Schilder "Videoüberwachung" anbringen, physischen AUS-Schalter im Gartenhaus montieren.',
                 'mittel'),
                ('Foto-Shooting Lifestyle',
                 'Professionelles Foto-Shooting (Deep Work am Starlink, Weinberg, Romantik, Familien) für Marketing und Website.',
                 'mittel'),
                ('Gäste-Ordner analog erstellen',
                 'Physischer Ordner im Gartenhaus: Hausordnung, Notrufnummern, Anleitungen, WLAN-Daten, Karte.',
                 'niedrig'),
            ]
            for title, desc, prio in offline_tasks:
                conn.execute('''
                    INSERT INTO projects (title, description, category, status, priority,
                        created_by, milestone_id)
                    VALUES (?, ?, 'launch-offline', 'offen', ?, 'system-seed', ?)
                ''', (title, desc, prio, launch_ms_id))
            conn.commit()
            print(f"Seeded 12 launch-offline tasks")
    except Exception as e:
        print(f"Launch-offline seed: {e}")

    # Seed impressum_mode if not set
    try:
        row = conn.execute("SELECT value FROM site_config WHERE key = 'impressum_mode'").fetchone()
        if not row:
            conn.execute(
                "INSERT INTO site_config (key, value) VALUES (?, ?)",
                ('impressum_mode', 'pre_lease')
            )
            conn.commit()
    except Exception as e:
        print(f"Impressum mode seed: {e}")

    # ─── Garten-Agent Phase 1-3: Neue Tabellen ───

    # Agent actions log (Audit-Logging für Chat + CLI-Agent)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS agent_actions_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action_type TEXT NOT NULL,
            source TEXT NOT NULL,
            user_id INTEGER,
            description TEXT,
            details TEXT,
            risk_score REAL DEFAULT 0,
            success BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Email drafts (Agent erstellt Entwürfe, Admin genehmigt)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS email_drafts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider_id INTEGER,
            recipient_email TEXT NOT NULL,
            recipient_name TEXT,
            subject TEXT NOT NULL,
            body_html TEXT NOT NULL,
            body_plain TEXT,
            status TEXT DEFAULT 'pending',
            approved_by TEXT,
            approved_at DATETIME,
            sent_at DATETIME,
            cc_emails TEXT,
            telegram_message_id TEXT,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # COO-Anweisungen
    conn.execute('''
        CREATE TABLE IF NOT EXISTS coo_instructions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            instruction TEXT NOT NULL,
            priority TEXT DEFAULT 'normal',
            status TEXT DEFAULT 'pending',
            result TEXT,
            received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            processed_at DATETIME
        )
    ''')

    # Agent-Langzeitgedächtnis
    conn.execute('''
        CREATE TABLE IF NOT EXISTS agent_memory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT,
            expires_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(category, key)
        )
    ''')

    # Chat-Konversationen (Server-Side History)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS agent_conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT UNIQUE NOT NULL,
            user_id INTEGER,
            ip_hash TEXT,
            role TEXT DEFAULT 'anonymous',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_message_at DATETIME
        )
    ''')

    # Chat-Nachrichten
    conn.execute('''
        CREATE TABLE IF NOT EXISTS agent_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL REFERENCES agent_conversations(id),
            role TEXT NOT NULL,
            content TEXT,
            tool_name TEXT,
            tool_args TEXT,
            tool_result TEXT,
            tokens_used INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Indices für Agent-Tabellen
    conn.execute("CREATE INDEX IF NOT EXISTS idx_agent_actions_type ON agent_actions_log(action_type)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_agent_actions_source ON agent_actions_log(source)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_agent_actions_created ON agent_actions_log(created_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_email_drafts_status ON email_drafts(status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_agent_conversations_session ON agent_conversations(session_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_agent_messages_conv ON agent_messages(conversation_id)")
    conn.commit()

    # Service-Provider Erweiterungen
    for col_stmt in [
        "ALTER TABLE service_providers ADD COLUMN hourly_rate REAL",
        "ALTER TABLE service_providers ADD COLUMN availability TEXT",
        "ALTER TABLE service_providers ADD COLUMN specializations TEXT",
        "ALTER TABLE service_providers ADD COLUMN last_contacted_at DATETIME",
        "ALTER TABLE service_providers ADD COLUMN preferred_contact TEXT DEFAULT 'email'",
        "ALTER TABLE service_providers ADD COLUMN contact_notes TEXT",
    ]:
        try:
            conn.execute(col_stmt)
            conn.commit()
        except Exception:
            pass  # Column already exists

    conn.close()
    print("Database migrations complete")


def seed_recurring_tasks(conn):
    """Seed initial recurring maintenance tasks."""
    tasks = [
        # Rasenpflege
        ('Rasenmähen', 'Gesamter Rasen mähen und Schnittgut entsorgen', 'rasen', 14, 15, 'mittel'),
        ('Rasenkanten schneiden', 'Kanten entlang der Beete und Wege', 'rasen', 30, 10, 'leicht'),
        ('Vertikutieren', 'Rasen vertikutieren (Frühjahr/Herbst)', 'rasen', 180, 30, 'schwer'),
        # Beetarbeiten
        ('Unkraut jäten', 'Alle Beete von Unkraut befreien', 'beete', 14, 20, 'mittel'),
        ('Beete mulchen', 'Rindenmulch aufbringen', 'beete', 365, 40, 'schwer'),
        ('Blumen gießen', 'Bei Trockenheit gießen', 'beete', 3, 5, 'leicht'),
        # Bäume & Hecken
        ('Hecke schneiden', 'Hecken in Form schneiden', 'baeume', 90, 35, 'schwer'),
        ('Obstbaumschnitt', 'Winterschnitt der Obstbäume', 'baeume', 365, 50, 'schwer'),
        ('Laub harken', 'Laub zusammenharken (Herbst)', 'baeume', 7, 15, 'mittel'),
        # Brennholz
        ('Holz hacken', 'Holz für Feuerstelle hacken', 'brennholz', 180, 40, 'schwer'),
        ('Holz stapeln', 'Gehacktes Holz ordentlich stapeln', 'brennholz', 180, 25, 'mittel'),
        ('Holzvorrat prüfen', 'Bestand kontrollieren', 'brennholz', 30, 5, 'leicht'),
        # Elektrik
        ('Außenbeleuchtung prüfen', 'Alle Lampen testen, defekte austauschen', 'elektrik', 90, 10, 'leicht'),
        ('Steckdosen prüfen', 'Außensteckdosen auf Funktion prüfen', 'elektrik', 180, 15, 'leicht'),
        ('E-Check (Elektriker)', 'Professionelle Prüfung - Dienstleister beauftragen', 'elektrik', 730, 0, 'schwer'),
        # Reinigung
        ('Gartenhaus putzen', 'Innenreinigung des Gartenhauses', 'putzen', 30, 25, 'mittel'),
        ('Terrasse reinigen', 'Terrassenplatten abkehren/schrubben', 'putzen', 60, 20, 'mittel'),
        ('Regenrinnen reinigen', 'Laub aus Regenrinnen entfernen', 'putzen', 180, 20, 'mittel'),
        ('Fenster putzen', 'Fenster des Gartenhauses reinigen', 'putzen', 90, 15, 'leicht'),
        # Sonstiges
        ('Werkzeug pflegen', 'Werkzeuge reinigen und ölen', 'sonstiges', 180, 15, 'leicht'),
        ('Zaun kontrollieren', 'Zaunpfähle und Latten prüfen', 'sonstiges', 90, 10, 'leicht'),
        ('Winterfest machen', 'Wasserhahn abstellen, Möbel einräumen (Herbst)', 'sonstiges', 365, 50, 'schwer'),
        ('Frühjahrs-Check', 'Alles nach dem Winter überprüfen (Frühjahr)', 'sonstiges', 365, 50, 'mittel'),
    ]

    for title, description, category, cycle_days, credit_value, effort in tasks:
        # Calculate next_due based on cycle_days from today
        next_due = (datetime.now() + timedelta(days=cycle_days // 4)).strftime('%Y-%m-%d')
        conn.execute('''
            INSERT INTO recurring_tasks (title, description, category, cycle_days, credit_value, effort, next_due)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (title, description, category, cycle_days, credit_value, effort, next_due))

    conn.commit()
    print(f"Seeded {len(tasks)} recurring tasks")


def seed_inventory(conn):
    """Seed inventory buildings, floors and rooms if empty."""
    cursor = conn.execute("SELECT COUNT(*) as count FROM inventory_buildings")
    if cursor.fetchone()['count'] > 0:
        return

    BUILDINGS = [
        ('haus', 'Haus', '🏠', True, 0),
        ('gartenhaus', 'Gartenhäuschen', '🏡', False, 1),
        ('schuppen1', 'Schuppen 1', '🏚️', False, 2),
        ('schuppen2', 'Schuppen 2', '🏚️', False, 3),
        ('werkstatt', 'Werkstatt', '🔧', False, 4),
        ('carport', 'Carport', '🚗', False, 5),
    ]

    FLOORS = [
        ('keller', 'haus', 'Keller', '⬇️', 0),
        ('erdgeschoss', 'haus', 'Erdgeschoss', '🏠', 1),
    ]

    ROOMS = [
        ('schlafzimmer', 'haus', 'erdgeschoss', 'Schlafzimmer', '🛏️', 0),
        ('flur_eg', 'haus', 'erdgeschoss', 'Flur', '🚶', 1),
        ('wohnzimmer', 'haus', 'erdgeschoss', 'Wohnzimmer', '🛋️', 2),
        ('bad', 'haus', 'keller', 'Bad', '🚿', 0),
        ('flur_keller', 'haus', 'keller', 'Flur', '🚶', 1),
        ('weinkeller', 'haus', 'keller', 'Weinkeller', '🍷', 2),
        ('schuppen1_raum', 'schuppen1', None, 'Lagerraum', '📦', 0),
        ('schuppen2_raum', 'schuppen2', None, 'Lagerraum', '📦', 0),
        ('werkstatt_raum', 'werkstatt', None, 'Werkstatt', '🔧', 0),
        ('gartenhaus_raum', 'gartenhaus', None, 'Hauptraum', '🏡', 0),
        ('carport_raum', 'carport', None, 'Stellplatz', '🚗', 0),
    ]

    for id, name, icon, has_floors, sort_order in BUILDINGS:
        conn.execute(
            'INSERT INTO inventory_buildings (id, name, icon, has_floors, sort_order) VALUES (?, ?, ?, ?, ?)',
            (id, name, icon, has_floors, sort_order)
        )

    for id, building_id, name, icon, sort_order in FLOORS:
        conn.execute(
            'INSERT INTO inventory_floors (id, building_id, name, icon, sort_order) VALUES (?, ?, ?, ?, ?)',
            (id, building_id, name, icon, sort_order)
        )

    for id, building_id, floor_id, name, icon, sort_order in ROOMS:
        conn.execute(
            'INSERT INTO inventory_rooms (id, building_id, floor_id, name, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
            (id, building_id, floor_id, name, icon, sort_order)
        )

    conn.commit()
    print("Seeded inventory buildings, floors and rooms")


def allowed_file(filename):
    """Check if file extension is allowed."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


# ============ Auth Helpers ============

def create_token(user_id, email, role):
    """Create JWT token for user."""
    expiry = datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS)
    payload = {
        'user_id': user_id,
        'email': email,
        'role': role,
        'exp': expiry
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm='HS256')

    # Store token hash in database
    conn = get_db()
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    conn.execute('''
        INSERT INTO auth_tokens (user_id, token_hash, expires_at)
        VALUES (?, ?, ?)
    ''', (user_id, token_hash, expiry.isoformat()))
    conn.commit()
    conn.close()

    return token


def verify_token(token):
    """Verify JWT token and return user data."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])

        # Check if token exists in database and is not expired
        conn = get_db()
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        row = conn.execute('''
            SELECT * FROM auth_tokens WHERE token_hash = ? AND expires_at > ?
        ''', (token_hash, datetime.utcnow().isoformat())).fetchone()
        conn.close()

        if not row:
            return None

        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def get_current_user():
    """Get current user from Authorization header."""
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return None

    token = auth_header.split(' ')[1]
    return verify_token(token)


def require_auth(f):
    """Decorator to require authentication."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({'error': 'Authentifizierung erforderlich'}), 401
        return f(*args, user=user, **kwargs)
    return decorated


def require_admin(f):
    """Decorator to require admin role."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        user = get_current_user()
        if not user:
            return jsonify({'error': 'Authentifizierung erforderlich'}), 401
        if user.get('role') != 'admin':
            return jsonify({'error': 'Admin-Berechtigung erforderlich'}), 403
        return f(*args, user=user, **kwargs)
    return decorated


def get_file_type(filename):
    """Determine if file is image or video."""
    ext = filename.rsplit('.', 1)[1].lower()
    return 'video' if ext in ALLOWED_VIDEO_EXTENSIONS else 'image'


def slugify(text):
    """Convert text to URL-safe slug."""
    if not text:
        return None
    # Lowercase and replace umlauts
    text = text.lower()
    text = text.replace('ä', 'ae').replace('ö', 'oe').replace('ü', 'ue').replace('ß', 'ss')
    # Remove special chars, keep alphanumeric and spaces
    text = re.sub(r'[^a-z0-9\s-]', '', text)
    # Replace spaces with hyphens
    text = re.sub(r'[\s]+', '-', text.strip())
    # Remove multiple hyphens
    text = re.sub(r'-+', '-', text)
    return text[:50] if text else None


def get_unique_base_name(category, base_name, extension='webp'):
    """Generate unique filename by appending -2, -3, etc. if file exists."""
    target_path = os.path.join(GALLERY_DIR, category, f"{base_name}.{extension}")
    if not os.path.exists(target_path):
        return base_name

    # File exists, find next available number
    counter = 2
    while True:
        new_name = f"{base_name}-{counter}"
        target_path = os.path.join(GALLERY_DIR, category, f"{new_name}.{extension}")
        if not os.path.exists(target_path):
            print(f"Duplicate detected: {base_name} -> {new_name}")
            return new_name
        counter += 1
        if counter > 100:  # Safety limit
            # Fallback to timestamp suffix
            import time
            return f"{base_name}-{int(time.time())}"


def convert_image_to_webp(input_path, output_path, quality=85):
    """Convert image to WebP format."""
    if not PILLOW_AVAILABLE:
        return False
    try:
        with Image.open(input_path) as img:
            # Convert to RGB if necessary (for PNG with transparency)
            if img.mode in ('RGBA', 'LA', 'P'):
                # Create white background for transparent images
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')

            img.save(output_path, 'WEBP', quality=quality, method=6)
        return True
    except Exception as e:
        print(f"WebP conversion failed: {e}")
        return False


def create_thumbnail(input_path, output_path, size=(200, 200), quality=80):
    """Create square thumbnail for image."""
    if not PILLOW_AVAILABLE:
        return False
    try:
        with Image.open(input_path) as img:
            # Convert to RGB
            if img.mode in ('RGBA', 'LA', 'P'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')

            # Crop to square (center crop)
            width, height = img.size
            min_dim = min(width, height)
            left = (width - min_dim) // 2
            top = (height - min_dim) // 2
            img = img.crop((left, top, left + min_dim, top + min_dim))

            # Resize
            img.thumbnail(size, Image.Resampling.LANCZOS)
            img.save(output_path, 'WEBP', quality=quality)
        return True
    except Exception as e:
        print(f"Thumbnail creation failed: {e}")
        return False


def create_video_thumbnail(input_path, output_path, size=(200, 200)):
    """Create thumbnail from video using ffmpeg."""
    try:
        temp_frame = output_path.replace('.webp', '_frame.jpg')
        # Extract frame at 1 second
        subprocess.run([
            'ffmpeg', '-y', '-i', input_path,
            '-ss', '00:00:01', '-vframes', '1',
            '-vf', f'scale={size[0]}:{size[1]}:force_original_aspect_ratio=increase,crop={size[0]}:{size[1]}',
            temp_frame
        ], capture_output=True, timeout=30)

        if os.path.exists(temp_frame):
            # Convert to WebP
            if PILLOW_AVAILABLE:
                with Image.open(temp_frame) as img:
                    img.save(output_path, 'WEBP', quality=80)
                os.remove(temp_frame)
                return True
            else:
                # Fallback: just use the jpg
                os.rename(temp_frame, output_path.replace('.webp', '.jpg'))
                return True
    except Exception as e:
        print(f"Video thumbnail creation failed: {e}")
    return False


def optimize_video(input_path, output_path):
    """Optimize video for web (smaller file, web-compatible codec)."""
    try:
        # Get original file size
        original_size = os.path.getsize(input_path)

        # Use ffmpeg to create web-optimized version
        result = subprocess.run([
            'ffmpeg', '-y', '-i', input_path,
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '28',
            '-c:a', 'aac', '-b:a', '128k',
            '-movflags', '+faststart',  # Enable streaming
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',  # Ensure even dimensions
            output_path
        ], capture_output=True, timeout=300)

        if result.returncode == 0 and os.path.exists(output_path):
            new_size = os.path.getsize(output_path)
            print(f"Video optimized: {original_size/1024/1024:.1f}MB -> {new_size/1024/1024:.1f}MB")
            return True
    except Exception as e:
        print(f"Video optimization failed: {e}")
    return False


# ============ Static File Serving ============

# Long-cache prefixes: hashed Astro assets + immutable image/video frames.
# These are safe to cache aggressively because they either contain a content
# hash in the filename (Astro) or are versioned by the deploy itself.
_IMMUTABLE_PREFIXES = ('_astro/', 'images/scroll/', 'images/')
_IMMUTABLE_EXTS = ('.webp', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico',
                   '.woff', '.woff2', '.ttf', '.mp4', '.webm', '.js', '.css')


def _apply_cache_headers(response, path: str):
    """Set Cache-Control so Cloudflare caches static assets at the edge."""
    lower = path.lower()
    is_immutable_prefix = any(lower.startswith(p) for p in _IMMUTABLE_PREFIXES)
    is_immutable_ext = lower.endswith(_IMMUTABLE_EXTS)
    if is_immutable_prefix or is_immutable_ext:
        # 1 year, immutable -> Cloudflare CDN caches at edge, no origin hits
        response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    elif lower.endswith('.html') or path == '' or path.endswith('/'):
        # HTML must revalidate so deploys are picked up immediately
        response.headers['Cache-Control'] = 'public, max-age=0, must-revalidate'
    return response


@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
@limiter.exempt
def serve_static(path):
    """Serve Astro static files."""
    # Default to index.html
    if not path:
        path = 'index.html'

    # Check if file exists
    static_path = os.path.join(STATIC_DIR, path)

    if os.path.isfile(static_path):
        return _apply_cache_headers(send_from_directory(STATIC_DIR, path), path)

    # Try with .html extension (Astro pages)
    if not path.endswith('.html') and os.path.isfile(static_path + '.html'):
        return _apply_cache_headers(
            send_from_directory(STATIC_DIR, path + '.html'), path + '.html'
        )

    # Check for index.html in directory
    index_path = os.path.join(static_path, 'index.html')
    if os.path.isdir(static_path) and os.path.isfile(index_path):
        return _apply_cache_headers(
            send_from_directory(os.path.join(STATIC_DIR, path), 'index.html'),
            'index.html',
        )

    # Fallback to index.html for SPA routing
    return _apply_cache_headers(
        send_from_directory(STATIC_DIR, 'index.html'), 'index.html'
    )


@app.route('/images/gallery/<path:filename>')
@limiter.exempt
def serve_gallery_image(filename):
    """Serve gallery images."""
    return _apply_cache_headers(
        send_from_directory(GALLERY_DIR, filename), filename
    )


# ============ API Routes ============

@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint. Meldet zusaetzlich den deployed Git-Commit,
    damit CI verifizieren kann ob die aktuelle Version live ist."""
    return jsonify({
        'status': 'ok',
        'service': 'voigt-garten-pi',
        'timestamp': datetime.now().isoformat(),
        'commit': os.environ.get('GIT_COMMIT', 'unknown')
    })


@app.route('/api/gallery', methods=['GET'])
def get_gallery():
    """Get all gallery images with proper URLs."""
    category = request.args.get('category')
    include_pending = request.args.get('include_pending', 'false') == 'true'
    map_area_filter = request.args.get('map_area')
    # Check if current user is admin for pending access
    user = get_current_user()
    is_admin = user and user.get('role') == 'admin'

    conn = get_db()
    if category and category != 'all':
        if is_admin and include_pending:
            items = conn.execute(
                'SELECT * FROM gallery_images WHERE category = ? ORDER BY uploaded_at DESC',
                (category,)
            ).fetchall()
        else:
            items = conn.execute(
                "SELECT * FROM gallery_images WHERE category = ? AND status = 'approved' ORDER BY uploaded_at DESC",
                (category,)
            ).fetchall()
    else:
        if is_admin and include_pending:
            items = conn.execute(
                'SELECT * FROM gallery_images ORDER BY uploaded_at DESC'
            ).fetchall()
        else:
            items = conn.execute(
                "SELECT * FROM gallery_images WHERE status = 'approved' ORDER BY uploaded_at DESC"
            ).fetchall()
    conn.close()

    # Format items with proper URLs
    formatted_items = []
    for row in items:
        item = dict(row)
        cat = item.get('category', 'sonstiges')
        filename = item['filename']

        # Build gallery URL - handle both layouts:
        # 1. Category-prefixed: "sonstiges/test.webp" -> /images/gallery/sonstiges/test.webp
        # 2. Flat (legacy): "abc123.webp" -> /images/gallery/abc123.webp (no category prefix!)
        if '/' in filename:
            # Already has a path prefix (category or other)
            item['url'] = f"/images/gallery/{filename}"
        else:
            # Flat filename - file lives directly in gallery root
            item['url'] = f"/images/gallery/{filename}"

        # Thumbnail URL - same logic
        if item.get('thumbnail_path'):
            thumb = item['thumbnail_path']
            if thumb.startswith('/'):
                item['thumbnailUrl'] = thumb
            elif '/' in thumb:
                # Has path prefix (e.g. "thumbnails/abc_thumb.webp" or "sonstiges/abc_thumb.webp")
                item['thumbnailUrl'] = f"/images/gallery/{thumb}"
            else:
                item['thumbnailUrl'] = f"/images/gallery/{thumb}"
        else:
            item['thumbnailUrl'] = item['url']  # Fallback to main image

        # Original URL (for download/fallback)
        if item.get('original_path'):
            orig_path = item['original_path']
            if orig_path.startswith('/images/gallery/'):
                item['originalUrl'] = orig_path
            else:
                item['originalUrl'] = f"/images/gallery/{orig_path}"
        formatted_items.append(item)

    # Filter by map_area if specified
    if map_area_filter:
        formatted_items = [i for i in formatted_items if i.get('map_area') == map_area_filter]

    return jsonify({
        'items': formatted_items,
        'total': len(formatted_items)
    })


@app.route('/api/gallery/upload', methods=['POST'])
@limiter.limit("10 per minute")
@require_auth
def upload_file(user):
    """Handle file upload with automatic WebP conversion and thumbnail generation."""
    if 'file' not in request.files:
        return jsonify({'error': 'Keine Datei'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Keine Datei ausgewahlt'}), 400

    if not allowed_file(file.filename):
        return jsonify({'error': 'Dateityp nicht erlaubt'}), 400

    # Check file size (max 50MB)
    file.seek(0, 2)
    file_size = file.tell()
    file.seek(0)
    if file_size > 50 * 1024 * 1024:
        return jsonify({'error': 'Datei zu groß (max. 50MB)'}), 400

    # Get metadata
    category = request.form.get('category', 'sonstiges')
    if category not in ALLOWED_CATEGORIES:
        category = 'sonstiges'
    name = request.form.get('name', '')
    description = request.form.get('description', '')
    # Get uploader from authenticated user
    uploaded_by = user.get('name') or user.get('email', 'anonymous')

    # Generate unique filename (use custom name if provided)
    original_name = secure_filename(file.filename)
    ext = original_name.rsplit('.', 1)[1].lower()
    file_id = hashlib.md5(f"{datetime.now().isoformat()}{original_name}".encode()).hexdigest()[:12]

    # Use slugified name if provided, otherwise use file_id
    base_name_raw = slugify(name) if name else file_id
    file_type = get_file_type(original_name)

    # Ensure category directory exists
    category_dir = os.path.join(GALLERY_DIR, category)
    os.makedirs(category_dir, exist_ok=True)

    # Path for original file
    original_filename = f"{category}/{file_id}_original.{ext}"
    original_path = os.path.join(GALLERY_DIR, original_filename)

    # Save original file
    file.save(original_path)
    file_size = os.path.getsize(original_path)

    # Get unique base name (handles duplicates: name -> name-2 -> name-3)
    target_ext = 'mp4' if file_type == 'video' else 'webp'
    base_name = get_unique_base_name(category, base_name_raw, target_ext)

    # Initialize paths
    webp_path = None
    thumbnail_path = None
    display_filename = original_filename  # Fallback

    if file_type == 'image':
        # Convert to WebP
        webp_filename = f"{category}/{base_name}.webp"
        webp_full_path = os.path.join(GALLERY_DIR, webp_filename)

        if convert_image_to_webp(original_path, webp_full_path):
            webp_path = webp_filename
            display_filename = webp_filename
            print(f"Converted to WebP: {webp_filename}")
        else:
            # Fallback: use original
            display_filename = original_filename
            print(f"WebP conversion failed, using original: {original_filename}")

        # Create thumbnail
        thumb_filename = f"{category}/{base_name}_thumb.webp"
        thumb_full_path = os.path.join(GALLERY_DIR, thumb_filename)

        if create_thumbnail(original_path, thumb_full_path):
            thumbnail_path = thumb_filename
            print(f"Created thumbnail: {thumb_filename}")

    elif file_type == 'video':
        # Optimize video
        optimized_filename = f"{category}/{base_name}.mp4"
        optimized_full_path = os.path.join(GALLERY_DIR, optimized_filename)

        if optimize_video(original_path, optimized_full_path):
            webp_path = optimized_filename  # Using webp_path for optimized video
            display_filename = optimized_filename
            print(f"Optimized video: {optimized_filename}")
        else:
            # Fallback: use original
            display_filename = original_filename
            print(f"Video optimization failed, using original: {original_filename}")

        # Create video thumbnail
        thumb_filename = f"{category}/{base_name}_thumb.webp"
        thumb_full_path = os.path.join(GALLERY_DIR, thumb_filename)

        if create_video_thumbnail(original_path, thumb_full_path):
            thumbnail_path = thumb_filename
            print(f"Created video thumbnail: {thumb_filename}")

    # Determine upload status based on user role
    is_admin = user.get('role') == 'admin'
    upload_status = 'approved' if is_admin else 'pending'

    # Save to database
    conn = get_db()
    conn.execute('''
        INSERT INTO gallery_images (id, filename, original_name, name, description, category, type, size, uploaded_by, thumbnail_path, webp_path, original_path, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (file_id, display_filename, original_name, name or None, description or None, category, file_type, file_size, uploaded_by, thumbnail_path, webp_path, original_filename, upload_status))
    conn.commit()
    conn.close()

    print(f"Uploaded: {display_filename} ({file_size} bytes) [status: {upload_status}]")

    # Send Telegram moderation request if pending
    if upload_status == 'pending':
        thumb_full = os.path.join(GALLERY_DIR, thumbnail_path) if thumbnail_path else None
        send_moderation_request(file_id, thumb_full, uploaded_by, name, category)

    # Send notification to admin
    send_activity_notification('gallery_upload', {
        'Von': uploaded_by,
        'Datei': original_name,
        'Kategorie': category,
        'Größe': f"{file_size / 1024 / 1024:.2f} MB"
    })

    return jsonify({
        'success': True,
        'id': file_id,
        'filename': display_filename,
        'url': f'/images/gallery/{display_filename}',
        'thumbnailUrl': f'/images/gallery/{thumbnail_path}' if thumbnail_path else None,
        'status': upload_status,
        'message': 'Datei erfolgreich hochgeladen!'
    })


@app.route('/api/gallery/<item_id>', methods=['DELETE'])
@require_admin
def delete_image(item_id, user):
    """Delete a gallery image and all associated files (admin only)."""
    conn = get_db()
    row = conn.execute('SELECT * FROM gallery_images WHERE id = ?', (item_id,)).fetchone()

    if not row:
        conn.close()
        return jsonify({'error': 'Bild nicht gefunden'}), 404

    # Convert Row to dict for easier access
    item = dict(row)

    # Delete all associated files
    files_to_delete = [
        item.get('filename'),
        item.get('thumbnail_path'),
        item.get('webp_path'),
        item.get('original_path')
    ]

    for file_path in files_to_delete:
        if file_path:
            full_path = os.path.join(GALLERY_DIR, file_path)
            if os.path.exists(full_path):
                try:
                    os.remove(full_path)
                    print(f"Deleted: {file_path}")
                except Exception as e:
                    print(f"Failed to delete {file_path}: {e}")

    # Delete from database
    conn.execute('DELETE FROM gallery_images WHERE id = ?', (item_id,))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'message': 'Bild geloscht'})


@app.route('/api/telegram/webhook', methods=['POST'])
def telegram_webhook():
    """Handle Telegram bot callbacks and messages."""
    data = request.json or {}

    # Import agent
    try:
        from telegram_agent import GartenAgent
        agent = GartenAgent(DB_PATH)
    except ImportError:
        agent = None

    # Callback queries (gallery moderation + agent confirmations)
    if 'callback_query' in data:
        callback_query = data['callback_query']
        callback_data = callback_query.get('data', '')
        callback_id = callback_query.get('id', '')

        # Let agent handle non-gallery callbacks
        if agent and not callback_data.startswith(('approve:', 'reject:')):
            agent.handle_callback(callback_query)
            return jsonify({'ok': True})

        # Gallery moderation (existing logic)
        if ':' not in callback_data:
            return jsonify({'ok': True})

        action, image_id = callback_data.split(':', 1)
        if action not in ('approve', 'reject'):
            return jsonify({'ok': True})

        conn = get_db()
        row = conn.execute('SELECT * FROM gallery_images WHERE id = ?', (image_id,)).fetchone()

        if not row:
            answer_callback_query(callback_id, "Bild nicht gefunden")
            conn.close()
            return jsonify({'ok': True})

        if action == 'approve':
            conn.execute("UPDATE gallery_images SET status = 'approved' WHERE id = ?", (image_id,))
            conn.commit()
            answer_callback_query(callback_id, "Freigegeben!")
        elif action == 'reject':
            conn.execute("UPDATE gallery_images SET status = 'rejected' WHERE id = ?", (image_id,))
            conn.commit()
            answer_callback_query(callback_id, "Abgelehnt!")

        conn.close()

    # Text messages → Agent
    elif 'message' in data and 'text' in data['message']:
        if agent:
            agent.process_message(
                chat_id=data['message']['chat']['id'],
                text=data['message']['text'],
                user_info=data['message'].get('from', {})
            )

    return jsonify({'ok': True})


@app.route('/api/admin/gallery/panorama', methods=['POST'])
@require_admin
def upload_panorama(user):
    """Upload panorama image without WebP conversion (equirectangular must stay original)."""
    if 'file' not in request.files:
        return jsonify({'error': 'Keine Datei'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Keine Datei ausgewählt'}), 400

    name = request.form.get('name', '')
    description = request.form.get('description', '')
    category = request.form.get('category', 'luftaufnahmen')
    if category not in ALLOWED_CATEGORIES:
        category = 'sonstiges'
    uploaded_by = user.get('name') or user.get('email', 'admin')

    original_name = secure_filename(file.filename)
    ext = original_name.rsplit('.', 1)[1].lower() if '.' in original_name else 'jpg'
    file_id = hashlib.md5(f"{datetime.now().isoformat()}{original_name}".encode()).hexdigest()[:12]

    base_name = slugify(name) if name else file_id

    category_dir = os.path.join(GALLERY_DIR, category)
    os.makedirs(category_dir, exist_ok=True)

    # Save original (no WebP conversion for panoramas)
    filename = f"{category}/{base_name}.{ext}"
    full_path = os.path.join(GALLERY_DIR, filename)
    file.save(full_path)
    file_size = os.path.getsize(full_path)

    # Create thumbnail for grid view
    thumbnail_path = None
    if PILLOW_AVAILABLE:
        thumb_filename = f"{category}/{base_name}_thumb.webp"
        thumb_full_path = os.path.join(GALLERY_DIR, thumb_filename)
        if create_thumbnail(full_path, thumb_full_path):
            thumbnail_path = thumb_filename

    conn = get_db()
    conn.execute('''
        INSERT INTO gallery_images (id, filename, original_name, name, description, category, type, size, uploaded_by, thumbnail_path, status)
        VALUES (?, ?, ?, ?, ?, ?, 'panorama', ?, ?, ?, 'approved')
    ''', (file_id, filename, original_name, name or None, description or None, category, file_size, uploaded_by, thumbnail_path))
    conn.commit()
    conn.close()

    return jsonify({
        'success': True,
        'id': file_id,
        'url': f'/images/gallery/{filename}',
        'type': 'panorama'
    })


@app.route('/api/background-video', methods=['GET'])
def get_background_video():
    """Get background video URL for a page."""
    page = request.args.get('page')
    if not page:
        return jsonify({'error': 'page parameter required'}), 400

    conn = get_db()
    row = conn.execute('SELECT * FROM background_videos WHERE page = ?', (page,)).fetchone()
    conn.close()

    if row:
        return jsonify({
            'video_url': f'/images/gallery/{row["video_path"]}',
            'thumbnail_url': f'/images/gallery/{row["thumbnail_path"]}' if row['thumbnail_path'] else None,
            'page': row['page']
        })

    return jsonify({'video_url': None, 'page': page})


@app.route('/api/admin/background-video', methods=['POST'])
@require_admin
def set_background_video(user):
    """Assign a video to a page background."""
    data = request.json or {}
    page = data.get('page')
    video_path = data.get('video_path')
    thumbnail_path = data.get('thumbnail_path')

    if not page or not video_path:
        return jsonify({'error': 'page and video_path required'}), 400

    conn = get_db()
    conn.execute('''
        INSERT INTO background_videos (page, video_path, thumbnail_path)
        VALUES (?, ?, ?)
        ON CONFLICT(page) DO UPDATE SET video_path = ?, thumbnail_path = ?, created_at = CURRENT_TIMESTAMP
    ''', (page, video_path, thumbnail_path, video_path, thumbnail_path))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'page': page})


@app.route('/api/livestream/cameras', methods=['GET'])
def get_livestream_cameras():
    """Get livestream cameras (preparation endpoint)."""
    conn = get_db()
    cameras = conn.execute('SELECT * FROM livestream_cameras WHERE is_active = 1').fetchall()
    conn.close()

    return jsonify({
        'cameras': [dict(c) for c in cameras],
        'available': len(cameras) > 0
    })


@app.route('/api/bookings', methods=['GET', 'POST'])
@limiter.limit("3 per minute", methods=["POST"])
def bookings():
    """Handle bookings."""
    conn = get_db()

    if request.method == 'POST':
        data = request.json

        # Validate required fields
        check_in = data.get('checkIn') or data.get('check_in')
        check_out = data.get('checkOut') or data.get('check_out')
        email = data.get('email', '')
        guests = data.get('guests', 2)

        if not data.get('name') or not email or not check_in or not check_out:
            conn.close()
            return jsonify({'error': 'Name, Email, Anreise und Abreise sind erforderlich'}), 400

        # Use pricing engine if available, otherwise fall back to client price
        total_price = data.get('totalPrice', 0)
        price_result = None

        if PRICING_AVAILABLE:
            # Validate booking
            error = validate_booking(check_in, check_out, int(guests), email, DB_PATH)
            if error:
                conn.close()
                return jsonify({'error': error}), 400

            # Calculate price server-side
            price_result = calculate_booking_price(
                check_in=check_in,
                check_out=check_out,
                guests=int(guests),
                db_path=DB_PATH,
                is_first_year=True,
            )

            if 'error' in price_result:
                conn.close()
                return jsonify({'error': price_result['error']}), 400

            total_price = price_result['total']

        conn.execute('''
            INSERT INTO bookings (guest_name, guest_email, guest_phone, check_in, check_out,
                                 guests, has_pets, total_price, discount_code, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            data['name'], email, data.get('phone'),
            check_in, check_out, int(guests),
            data.get('pets', False), total_price,
            data.get('discountCode'), data.get('notes'),
        ))
        booking_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
        conn.commit()
        conn.close()

        # Send emails
        send_booking_confirmation(data)
        send_booking_notification_to_admin(data)

        # Telegram notification
        notify_booking({
            'guest_name': data['name'],
            'guest_email': email,
            'check_in': check_in,
            'check_out': check_out,
            'guests': guests,
            'total_price': total_price,
        })

        result = {'success': True, 'bookingId': booking_id}
        if price_result:
            result['price'] = price_result
        return jsonify(result)

    # GET: Return booked dates for calendar
    bookings_list = conn.execute('''
        SELECT check_in, check_out FROM bookings
        WHERE status IN ('pending', 'confirmed')
    ''').fetchall()
    conn.close()

    return jsonify({
        'bookings': [{'checkIn': b['check_in'], 'checkOut': b['check_out']} for b in bookings_list]
    })


# ============ Job Applications ============

ALLOWED_APPLICATION_POSITIONS = {'tech_student', 'elektro_meister', 'gaertner', 'initiativ'}
ALLOWED_HOURS_PER_WEEK = {5, 10, 20, 40}
MAX_RESUME_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB
APPLICATIONS_DIR = os.path.join(DATA_DIR, 'applications')
_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


def _get_application_dict(row) -> dict:
    item = dict(row)
    if item.get('resume_path'):
        item['resume_url'] = f"/api/admin/applications/{item['id']}/resume"
    return item


@app.route('/api/applications', methods=['POST'])
@limiter.limit("3 per minute")
def create_application():
    """Public endpoint to submit a job application (JSON or multipart)."""
    # Accept both JSON and multipart/form-data (wegen optionalem PDF-Upload)
    if request.content_type and request.content_type.startswith('multipart/'):
        data = request.form
        resume_file = request.files.get('resume')
    else:
        data = request.get_json(silent=True) or {}
        resume_file = None

    name = (data.get('name') or '').strip()
    email = (data.get('email') or '').strip().lower()
    position = (data.get('position') or '').strip()
    motivation = (data.get('motivation') or '').strip()
    phone = (data.get('phone') or '').strip() or None
    available_from = (data.get('available_from') or '').strip() or None
    preferred_times = (data.get('preferred_times') or '').strip() or None

    # Required fields
    if not name or not email or not position or not motivation:
        return jsonify({'error': 'Name, Email, Position und Motivation sind erforderlich'}), 400

    if not _EMAIL_RE.match(email):
        return jsonify({'error': 'Ungültige Email-Adresse'}), 400

    if position not in ALLOWED_APPLICATION_POSITIONS:
        return jsonify({'error': 'Ungültige Position'}), 400

    # hours_per_week optional
    hours_raw = data.get('hours_per_week')
    hours_per_week = None
    if hours_raw not in (None, '', 'null'):
        try:
            hours_per_week = int(hours_raw)
        except (TypeError, ValueError):
            return jsonify({'error': 'Ungültige Stundenangabe'}), 400
        if hours_per_week not in ALLOWED_HOURS_PER_WEEK:
            return jsonify({'error': 'Stunden/Woche muss 5, 10, 20 oder 40 sein'}), 400

    # Optional resume upload
    resume_path = None
    if resume_file and resume_file.filename:
        filename_lower = resume_file.filename.lower()
        if not filename_lower.endswith('.pdf'):
            return jsonify({'error': 'Nur PDF-Dateien erlaubt'}), 400

        # Size check
        resume_file.stream.seek(0, os.SEEK_END)
        size = resume_file.stream.tell()
        resume_file.stream.seek(0)
        if size > MAX_RESUME_SIZE_BYTES:
            return jsonify({'error': 'Datei zu groß (max 5 MB)'}), 400
        if size == 0:
            return jsonify({'error': 'Datei ist leer'}), 400

        # Magic-number check
        header = resume_file.stream.read(5)
        resume_file.stream.seek(0)
        if not header.startswith(b'%PDF'):
            return jsonify({'error': 'Datei ist kein gültiges PDF'}), 400

        # Ensure target dir, save with uuid filename (kein User-Input im Pfad)
        os.makedirs(APPLICATIONS_DIR, exist_ok=True)
        safe_filename = uuid.uuid4().hex + '.pdf'
        target_abs = os.path.join(APPLICATIONS_DIR, safe_filename)
        resume_file.save(target_abs)
        resume_path = safe_filename  # store only filename, not full path

    # Insert into DB
    conn = get_db()
    conn.execute('''
        INSERT INTO job_applications
            (name, email, phone, position, available_from, hours_per_week,
             preferred_times, motivation, resume_path, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    ''', (
        name, email, phone, position, available_from, hours_per_week,
        preferred_times, motivation, resume_path, datetime.utcnow().isoformat()
    ))
    app_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
    conn.commit()
    conn.close()

    # Build data dict for notifications
    notify_data = {
        'id': app_id,
        'name': name,
        'email': email,
        'phone': phone,
        'position': position,
        'available_from': available_from,
        'hours_per_week': hours_per_week,
        'preferred_times': preferred_times,
        'motivation': motivation,
        'resume_path': resume_path,
    }

    # Notifications — isolated so failures don't kill the insert
    try:
        send_application_confirmation(notify_data)
    except Exception as e:
        print(f"Application confirmation email error: {e}")
    try:
        send_application_notification_admin(notify_data)
    except Exception as e:
        print(f"Application admin email error: {e}")
    try:
        notify_job_application(notify_data)
    except Exception as e:
        print(f"Application telegram notify error: {e}")

    return jsonify({'success': True, 'id': app_id})


@app.route('/api/admin/applications', methods=['GET'])
@require_admin
def admin_list_applications():
    """List all job applications (admin only)."""
    conn = get_db()
    rows = conn.execute(
        'SELECT * FROM job_applications ORDER BY created_at DESC'
    ).fetchall()
    conn.close()
    return jsonify({
        'applications': [_get_application_dict(r) for r in rows]
    })


@app.route('/api/admin/applications/<int:app_id>', methods=['PATCH'])
@require_admin
def admin_update_application(app_id: int):
    """Update application status and/or admin notes."""
    data = request.json or {}
    allowed_statuses = {'pending', 'contacted', 'rejected', 'hired'}

    updates = []
    params = []

    if 'status' in data:
        if data['status'] not in allowed_statuses:
            return jsonify({'error': 'Ungültiger Status'}), 400
        updates.append('status = ?')
        params.append(data['status'])

    if 'admin_notes' in data:
        updates.append('admin_notes = ?')
        params.append(data['admin_notes'])

    if not updates:
        return jsonify({'error': 'Keine Felder zum Aktualisieren'}), 400

    updates.append('updated_at = CURRENT_TIMESTAMP')
    params.append(app_id)

    conn = get_db()
    cursor = conn.execute(
        f"UPDATE job_applications SET {', '.join(updates)} WHERE id = ?",
        params
    )
    conn.commit()
    affected = cursor.rowcount
    conn.close()

    if affected == 0:
        return jsonify({'error': 'Bewerbung nicht gefunden'}), 404

    return jsonify({'success': True})


@app.route('/api/admin/applications/<int:app_id>/resume', methods=['GET'])
@require_admin
def admin_download_resume(app_id: int):
    """Download resume PDF for an application (admin only, path-traversal safe)."""
    conn = get_db()
    row = conn.execute(
        'SELECT resume_path FROM job_applications WHERE id = ?', (app_id,)
    ).fetchone()
    conn.close()

    if not row or not row['resume_path']:
        return jsonify({'error': 'Kein Lebenslauf vorhanden'}), 404

    filename = row['resume_path']
    target_path = os.path.join(APPLICATIONS_DIR, filename)
    # Path-traversal protection: resolved path must be under APPLICATIONS_DIR
    real_target = os.path.realpath(target_path)
    real_base = os.path.realpath(APPLICATIONS_DIR)
    if not (real_target == real_base or real_target.startswith(real_base + os.sep)):
        return jsonify({'error': 'Ungültiger Dateipfad'}), 400

    if not os.path.exists(real_target):
        return jsonify({'error': 'Datei nicht gefunden'}), 404

    return send_file(
        real_target,
        mimetype='application/pdf',
        as_attachment=True,
        download_name=f'Bewerbung_{app_id}.pdf'
    )


# ============ Pricing & Availability Routes ============

@app.route('/api/pricing/calculate', methods=['POST'])
def calculate_price():
    """Calculate booking price with full breakdown."""
    if not PRICING_AVAILABLE:
        return jsonify({'error': 'Preisberechnung nicht verfügbar'}), 503

    data = request.json or {}

    check_in = data.get('checkIn') or data.get('check_in')
    check_out = data.get('checkOut') or data.get('check_out')
    guests = data.get('guests', 2)
    is_day_only = data.get('isDayOnly', False)

    if not check_in or not check_out:
        return jsonify({'error': 'Anreise und Abreise erforderlich'}), 400

    result = calculate_booking_price(
        check_in=check_in,
        check_out=check_out,
        guests=int(guests),
        db_path=DB_PATH,
        is_day_only=is_day_only,
        is_first_year=True,
    )

    if 'error' in result:
        return jsonify({'error': result['error']}), 400

    return jsonify(result)


@app.route('/api/availability', methods=['GET'])
def get_availability_api():
    """Get booked dates for a month."""
    if not PRICING_AVAILABLE:
        return jsonify({'error': 'Verfügbarkeitsprüfung nicht verfügbar'}), 503

    month = request.args.get('month')  # YYYY-MM
    if not month:
        return jsonify({'error': 'month Parameter erforderlich (YYYY-MM)'}), 400

    booked_dates = get_availability(month, DB_PATH)
    return jsonify({'booked_dates': booked_dates, 'month': month})


# ============ Cancellation Route ============

@app.route('/api/bookings/<int:booking_id>/cancel', methods=['POST'])
@require_auth
def cancel_booking(booking_id, user):
    """Cancel a booking with refund calculation."""
    if not PRICING_AVAILABLE:
        return jsonify({'error': 'Stornierung nicht verfügbar'}), 503

    data = request.json or {}

    conn = get_db()
    booking = conn.execute('SELECT * FROM bookings WHERE id = ?', (booking_id,)).fetchone()

    if not booking:
        conn.close()
        return jsonify({'error': 'Buchung nicht gefunden'}), 404

    if booking['status'] == 'cancelled':
        conn.close()
        return jsonify({'error': 'Buchung ist bereits storniert'}), 400

    # Check authorization (user can cancel own booking, admin can cancel any)
    if user.get('role') != 'admin' and user.get('email') != booking['guest_email']:
        conn.close()
        return jsonify({'error': 'Keine Berechtigung'}), 403

    # Calculate refund
    refund = calculate_cancellation_refund(
        booking_total=booking['total_price'],
        check_in=booking['check_in'],
        is_first_year=True,
    )

    # Update booking status
    conn.execute("UPDATE bookings SET status = 'cancelled' WHERE id = ?", (booking_id,))

    # Record cancellation
    conn.execute('''
        INSERT INTO cancellations (booking_id, cancelled_by, policy_applied,
            refund_percent, refund_amount, reason)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (
        booking_id, user['email'], refund['policy'],
        refund['refund_percent'], refund['refund_amount'],
        data.get('reason', ''),
    ))

    conn.commit()
    conn.close()

    # Notify admin
    notify_admin('booking_cancelled', {
        'Gast': booking['guest_name'],
        'Zeitraum': f"{booking['check_in']} - {booking['check_out']}",
        'Erstattung': f"{refund['refund_amount']:.2f}€ ({refund['refund_percent']}%)",
        'Grund': data.get('reason', 'Nicht angegeben'),
    })

    return jsonify({
        'success': True,
        'refund': refund,
        'message': 'Buchung storniert',
    })


# ============ Invoice Routes ============

@app.route('/api/admin/invoices', methods=['GET'])
@require_admin
def get_invoices(user):
    """Admin: Get all invoices."""
    if not INVOICE_AVAILABLE:
        return jsonify({'error': 'Rechnungssystem nicht verfügbar'}), 503

    status = request.args.get('status')
    conn = get_db()

    if status:
        invoices = conn.execute(
            'SELECT * FROM invoices WHERE status = ? ORDER BY created_at DESC', (status,)
        ).fetchall()
    else:
        invoices = conn.execute(
            'SELECT * FROM invoices ORDER BY created_at DESC'
        ).fetchall()
    conn.close()

    return jsonify({'invoices': [dict(i) for i in invoices], 'total': len(invoices)})


@app.route('/api/admin/invoices/<int:invoice_id>', methods=['PATCH'])
@require_admin
def update_invoice(invoice_id, user):
    """Admin: Update invoice (edit draft)."""
    return generic_patch('invoices', invoice_id, request.json,
        ['guest_name', 'guest_email', 'guest_address', 'line_items',
         'subtotal', 'credits_applied', 'total', 'tax_note', 'status', 'due_date'],
        timestamp_field=None)


@app.route('/api/admin/invoices/<int:invoice_id>/generate-pdf', methods=['POST'])
@require_admin
def generate_invoice_pdf_route(invoice_id, user):
    """Admin: Generate PDF for an invoice."""
    if not INVOICE_AVAILABLE:
        return jsonify({'error': 'PDF-Generierung nicht verfügbar'}), 503

    invoice_dir = os.path.join(DATA_DIR, 'invoices')
    pdf_path = generate_invoice_pdf(DB_PATH, invoice_id, invoice_dir)

    if not pdf_path:
        return jsonify({'error': 'PDF-Generierung fehlgeschlagen'}), 500

    return jsonify({'success': True, 'pdf_path': pdf_path})


@app.route('/api/admin/invoices/<int:invoice_id>/pdf', methods=['GET'])
@require_admin
def download_invoice_pdf(invoice_id, user):
    """Admin: Download invoice PDF."""
    conn = get_db()
    invoice = conn.execute('SELECT pdf_path FROM invoices WHERE id = ?', (invoice_id,)).fetchone()
    conn.close()

    if not invoice or not invoice['pdf_path']:
        return jsonify({'error': 'PDF nicht gefunden'}), 404

    pdf_full_path = os.path.join(DATA_DIR, invoice['pdf_path'])
    if not os.path.exists(pdf_full_path):
        return jsonify({'error': 'PDF-Datei nicht gefunden'}), 404

    return send_file(pdf_full_path, mimetype='application/pdf')


@app.route('/api/admin/invoices/<int:invoice_id>/send', methods=['POST'])
@require_admin
def send_invoice(invoice_id, user):
    """Admin: Send invoice via email."""
    if not INVOICE_AVAILABLE:
        return jsonify({'error': 'Rechnungsversand nicht verfügbar'}), 503

    conn = get_db()
    invoice = conn.execute('SELECT * FROM invoices WHERE id = ?', (invoice_id,)).fetchone()

    if not invoice:
        conn.close()
        return jsonify({'error': 'Rechnung nicht gefunden'}), 404

    # Generate PDF if not exists
    if not invoice['pdf_path']:
        invoice_dir = os.path.join(DATA_DIR, 'invoices')
        pdf_path = generate_invoice_pdf(DB_PATH, invoice_id, invoice_dir)
        if not pdf_path:
            conn.close()
            return jsonify({'error': 'PDF-Generierung fehlgeschlagen'}), 500

    # Update status to sent
    conn.execute('''
        UPDATE invoices SET status = 'sent', sent_at = ? WHERE id = ?
    ''', (datetime.now().isoformat(), invoice_id))
    conn.commit()
    conn.close()

    # Notify admin via Telegram
    notify_admin('invoice_sent', {
        'Rechnung': invoice['invoice_number'],
        'Gast': invoice['guest_name'],
        'Betrag': f"{invoice['total']:.2f}€",
    })

    return jsonify({'success': True, 'message': 'Rechnung gesendet'})


@app.route('/api/admin/invoices/<int:invoice_id>/mark-paid', methods=['POST'])
@require_admin
def mark_invoice_paid(invoice_id, user):
    """Admin: Mark invoice as paid."""
    conn = get_db()
    conn.execute(
        "UPDATE invoices SET status = 'paid' WHERE id = ?", (invoice_id,)
    )
    conn.commit()

    invoice = conn.execute('SELECT * FROM invoices WHERE id = ?', (invoice_id,)).fetchone()
    conn.close()

    if invoice:
        notify_admin('invoice_paid', {
            'Rechnung': invoice['invoice_number'],
            'Gast': invoice['guest_name'],
            'Betrag': f"{invoice['total']:.2f}€",
        })

    return jsonify({'success': True, 'message': 'Rechnung als bezahlt markiert'})


@app.route('/api/bookings/<int:booking_id>/create-invoice', methods=['POST'])
@require_admin
def create_invoice_route(booking_id, user):
    """Admin: Create invoice for a booking."""
    if not INVOICE_AVAILABLE:
        return jsonify({'error': 'Rechnungserstellung nicht verfügbar'}), 503

    invoice_id = create_invoice_from_booking(DB_PATH, booking_id)

    if not invoice_id:
        return jsonify({'error': 'Rechnungserstellung fehlgeschlagen'}), 500

    return jsonify({'success': True, 'invoiceId': invoice_id})


# ============ Feedback Routes ============

@app.route('/api/feedback', methods=['POST'])
def submit_feedback():
    """Submit guest feedback."""
    data = request.json or {}

    email = data.get('email', '').strip()
    rating = data.get('rating')

    if not email or not rating:
        return jsonify({'error': 'Email und Bewertung erforderlich'}), 400

    if not (1 <= int(rating) <= 5):
        return jsonify({'error': 'Bewertung muss zwischen 1 und 5 liegen'}), 400

    conn = get_db()
    conn.execute('''
        INSERT INTO feedback (booking_id, guest_email, rating, cleanliness, communication,
            location, accuracy, comment)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        data.get('bookingId'), email, int(rating),
        data.get('cleanliness'), data.get('communication'),
        data.get('location'), data.get('accuracy'),
        data.get('comment'),
    ))
    conn.commit()
    conn.close()

    # Notify admin
    notify_feedback(data)

    return jsonify({'success': True, 'message': 'Danke für dein Feedback!'})


@app.route('/api/admin/feedback', methods=['GET'])
@require_admin
def get_all_feedback(user):
    """Admin: Get all feedback."""
    conn = get_db()
    feedback = conn.execute('SELECT * FROM feedback ORDER BY created_at DESC').fetchall()
    conn.close()
    return jsonify({'feedback': [dict(f) for f in feedback], 'total': len(feedback)})


@app.route('/api/reviews', methods=['GET'])
def get_public_reviews():
    """Get public reviews (4-5 stars with comments)."""
    conn = get_db()
    reviews = conn.execute('''
        SELECT f.rating, f.comment, f.created_at, b.guest_name
        FROM feedback f
        LEFT JOIN bookings b ON f.booking_id = b.id
        WHERE f.rating >= 4 AND f.comment IS NOT NULL AND f.comment != ''
        ORDER BY f.created_at DESC
        LIMIT 10
    ''').fetchall()
    conn.close()

    return jsonify({
        'reviews': [{
            'rating': r['rating'],
            'comment': r['comment'],
            'name': _anonymize_name(r['guest_name']) if r['guest_name'] else 'Gast',
            'date': r['created_at'][:10] if r['created_at'] else None,
        } for r in reviews]
    })


def _anonymize_name(name: str) -> str:
    """Convert 'Max Mustermann' to 'Max M.'"""
    if not name:
        return 'Gast'
    parts = name.strip().split()
    if len(parts) >= 2:
        return f"{parts[0]} {parts[-1][0]}."
    return parts[0]


# ============ Site Config Routes ============

@app.route('/api/admin/site-config', methods=['GET'])
@require_admin
def get_site_config_api(user):
    """Admin: Get all site configuration."""
    if not INVOICE_AVAILABLE:
        return jsonify({'error': 'Site-Config nicht verfügbar'}), 503

    config = get_site_config(DB_PATH)
    return jsonify({'config': config})


@app.route('/api/admin/site-config', methods=['PATCH'])
@require_admin
def update_site_config(user):
    """Admin: Update site configuration."""
    data = request.json or {}
    conn = get_db()
    for key, value in data.items():
        conn.execute('''
            INSERT INTO site_config (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
        ''', (key, value, datetime.now().isoformat(), value, datetime.now().isoformat()))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/credits', methods=['GET'])
def get_credits():
    """Get credits for a user."""
    email = request.args.get('email')
    if not email:
        return jsonify({'error': 'Email erforderlich'}), 400

    conn = get_db()
    credits = conn.execute('''
        SELECT * FROM credits WHERE guest_email = ? ORDER BY created_at DESC LIMIT 20
    ''', (email,)).fetchall()

    total = conn.execute('''
        SELECT COALESCE(SUM(amount), 0) as total FROM credits WHERE guest_email = ?
    ''', (email,)).fetchone()['total']

    conn.close()

    return jsonify({
        'credits': [dict(c) for c in credits],
        'total': total
    })


@app.route('/api/admin/credits', methods=['GET'])
@require_admin
def get_all_credits(user):
    """Admin: Get all credits."""
    conn = get_db()
    credits = conn.execute('SELECT * FROM credits ORDER BY created_at DESC').fetchall()
    conn.close()
    return jsonify({'credits': [dict(c) for c in credits]})


@app.route('/api/admin/credits', methods=['POST'])
@require_admin
def create_credit(user):
    """Admin: Create a credit entry."""
    data = request.json
    conn = get_db()
    conn.execute('''
        INSERT INTO credits (guest_email, amount, reason, type, created_at)
        VALUES (?, ?, ?, ?, ?)
    ''', (data['guest_email'], data['amount'], data['reason'],
          data.get('type', 'earned'), datetime.now().isoformat()))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/admin/credits/<int:credit_id>', methods=['PATCH'])
@require_admin
def update_credit(credit_id, user):
    """Admin: Update a credit entry."""
    return generic_patch('credits', credit_id, request.json,
        ['guest_email', 'amount', 'reason', 'type'],
        timestamp_field=None)


@app.route('/api/admin/credits/<int:credit_id>', methods=['DELETE'])
@require_admin
def delete_credit(credit_id, user):
    """Admin: Delete a credit entry."""
    conn = get_db()
    conn.execute('DELETE FROM credits WHERE id = ?', (credit_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/maintenance/complete', methods=['POST'])
def complete_maintenance():
    """Mark a maintenance task as complete."""
    data = request.json

    conn = get_db()
    conn.execute('''
        INSERT INTO maintenance_log (task_id, completed_by, notes, photo_filename)
        VALUES (?, ?, ?, ?)
    ''', (data['taskId'], data['completedBy'], data.get('notes'), data.get('photoFilename')))

    # Add credit if applicable
    if data.get('creditValue', 0) > 0:
        conn.execute('''
            INSERT INTO credits (guest_email, amount, reason, type)
            VALUES (?, ?, ?, 'earned')
        ''', (data['completedBy'], data['creditValue'], data.get('taskTitle', 'Wartungsarbeit')))

    conn.commit()
    conn.close()

    return jsonify({'success': True})


# ============ Auth Routes ============

@app.route('/api/auth/login', methods=['POST'])
@limiter.limit("5 per minute")
def login():
    """User login with email/username and password."""
    data = request.json
    login_id = data.get('email') or data.get('username')
    password = data.get('password')

    if not login_id or not password:
        return jsonify({'error': 'Email/Username und Passwort erforderlich'}), 400

    conn = get_db()
    # Try both email and username
    user = conn.execute('''
        SELECT * FROM users WHERE email = ? OR username = ?
    ''', (login_id, login_id)).fetchone()
    conn.close()

    if not user:
        return jsonify({'error': 'Ungueltige Anmeldedaten'}), 401

    # Block password login for Google-only users (empty password_hash)
    if not user['password_hash']:
        return jsonify({'error': 'Dieser Account nutzt Google-Anmeldung. Bitte mit Google anmelden.'}), 401

    if not check_password_hash(user['password_hash'], password):
        return jsonify({'error': 'Ungueltige Anmeldedaten'}), 401

    # Update last login
    conn = get_db()
    conn.execute('UPDATE users SET last_login = ? WHERE id = ?',
                 (datetime.now().isoformat(), user['id']))
    conn.commit()
    conn.close()

    token = create_token(user['id'], user['email'], user['role'])

    return jsonify({
        'success': True,
        'token': token,
        'user': {
            'id': user['id'],
            'email': user['email'],
            'username': user['username'],
            'name': user['name'],
            'role': user['role'],
            'profile_image_url': user['profile_image_url'] if user['profile_image_url'] else None
        }
    })


@app.route('/api/auth/logout', methods=['POST'])
@require_auth
def logout(user):
    """Invalidate current token."""
    auth_header = request.headers.get('Authorization')
    token = auth_header.split(' ')[1]
    token_hash = hashlib.sha256(token.encode()).hexdigest()

    conn = get_db()
    conn.execute('DELETE FROM auth_tokens WHERE token_hash = ?', (token_hash,))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'message': 'Erfolgreich abgemeldet'})


@app.route('/api/auth/verify', methods=['GET'])
def verify_auth():
    """Verify current token and return user data."""
    user = get_current_user()
    if not user:
        return jsonify({'authenticated': False}), 401

    # Fetch additional user details from DB
    conn = get_db()
    db_user = conn.execute('SELECT name, username, profile_image_url FROM users WHERE id = ?',
                           (user['user_id'],)).fetchone()
    conn.close()

    user_data = {
        'id': user['user_id'],
        'email': user['email'],
        'role': user['role']
    }
    if db_user:
        if db_user['name']:
            user_data['name'] = db_user['name']
        if db_user['username']:
            user_data['username'] = db_user['username']
        if db_user['profile_image_url']:
            user_data['profile_image_url'] = db_user['profile_image_url']

    return jsonify({
        'authenticated': True,
        'user': user_data
    })


@app.route('/api/auth/register', methods=['POST'])
@limiter.limit("5 per minute")
def register_user():
    """Self-registration for guests (creates user role)."""
    data = request.json

    email = data.get('email')
    username = data.get('username')
    password = data.get('password')
    name = data.get('name')

    if not email or not username or not password:
        return jsonify({'error': 'Email, Username und Passwort erforderlich'}), 400

    # Validate email format
    if '@' not in email or '.' not in email:
        return jsonify({'error': 'Ungültiges Email-Format'}), 400

    # Validate password length
    if len(password) < 6:
        return jsonify({'error': 'Passwort muss mindestens 6 Zeichen haben'}), 400

    # Validate username length
    if len(username) < 3:
        return jsonify({'error': 'Username muss mindestens 3 Zeichen haben'}), 400

    conn = get_db()
    try:
        password_hash = generate_password_hash(password)
        conn.execute('''
            INSERT INTO users (email, username, password_hash, name, role)
            VALUES (?, ?, ?, ?, 'user')
        ''', (email, username, password_hash, name))
        user_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
        conn.commit()

        # Auto-login: create token
        token = create_token(user_id, email, 'user')
        conn.close()

        # Send notification to admin
        send_activity_notification('user_registered', {
            'Name': name or username,
            'Email': email,
            'Username': username
        })

        return jsonify({
            'success': True,
            'token': token,
            'user': {
                'id': user_id,
                'email': email,
                'username': username,
                'name': name,
                'role': 'user'
            }
        })
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Email oder Username bereits vergeben'}), 409


# ============ Magic Link Auth ============

@app.route('/api/auth/request-magic-link', methods=['POST'])
@limiter.limit("5 per minute")
def request_magic_link():
    """Send magic link email for registration/login."""
    data = request.json
    email = data.get('email', '').strip().lower()
    name = data.get('name', '').strip()

    if not email or '@' not in email or '.' not in email:
        return jsonify({'error': 'Gueltige Email-Adresse erforderlich'}), 400

    # Generate secure token
    token = secrets.token_urlsafe(48)
    expires_at = (datetime.utcnow() + timedelta(minutes=30)).isoformat()

    conn = get_db()
    # Invalidate any existing unused tokens for this email
    conn.execute('''
        UPDATE email_verification_tokens SET used = 1
        WHERE email = ? AND used = 0
    ''', (email,))

    # Store new token
    conn.execute('''
        INSERT INTO email_verification_tokens (email, token, expires_at)
        VALUES (?, ?, ?)
    ''', (email, token, expires_at))
    conn.commit()
    conn.close()

    # Send magic link email
    send_magic_link_email(email, token, name=name or None)

    return jsonify({
        'success': True,
        'message': 'Email gesendet. Pruefe dein Postfach!'
    })


@app.route('/api/auth/verify-email', methods=['GET'])
def verify_email_token():
    """Verify magic link token."""
    token = request.args.get('token', '').strip()

    if not token:
        return jsonify({'error': 'Token erforderlich'}), 400

    conn = get_db()
    row = conn.execute('''
        SELECT * FROM email_verification_tokens
        WHERE token = ? AND used = 0 AND expires_at > ?
    ''', (token, datetime.utcnow().isoformat())).fetchone()

    if not row:
        conn.close()
        return jsonify({'error': 'Token ungueltig oder abgelaufen'}), 400

    email = row['email']

    # Mark token as used
    conn.execute('UPDATE email_verification_tokens SET used = 1 WHERE id = ?', (row['id'],))
    conn.commit()

    # Check if user already exists
    user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
    conn.close()

    if user:
        # Existing user: auto-login
        conn = get_db()
        conn.execute('UPDATE users SET last_login = ? WHERE id = ?',
                     (datetime.now().isoformat(), user['id']))
        conn.commit()
        conn.close()

        auth_token = create_token(user['id'], user['email'], user['role'])

        return jsonify({
            'success': True,
            'authenticated': True,
            'token': auth_token,
            'user': {
                'id': user['id'],
                'email': user['email'],
                'username': user['username'],
                'name': user['name'],
                'role': user['role']
            }
        })
    else:
        # New user: needs to complete registration
        return jsonify({
            'success': True,
            'needs_password': True,
            'email': email,
            'token': token
        })


@app.route('/api/auth/complete-registration', methods=['POST'])
@limiter.limit("5 per minute")
def complete_registration():
    """Complete registration after magic link verification."""
    data = request.json
    token = data.get('token', '').strip()
    password = data.get('password', '').strip()
    username = data.get('username', '').strip()
    name = data.get('name', '').strip()

    if not token or not password or not username:
        return jsonify({'error': 'Token, Passwort und Username erforderlich'}), 400

    if len(password) < 6:
        return jsonify({'error': 'Passwort muss mindestens 6 Zeichen haben'}), 400

    if len(username) < 3:
        return jsonify({'error': 'Username muss mindestens 3 Zeichen haben'}), 400

    conn = get_db()
    # Token must be used=1 (verified) and not older than 60 minutes
    cutoff = (datetime.utcnow() - timedelta(minutes=60)).isoformat()
    row = conn.execute('''
        SELECT * FROM email_verification_tokens
        WHERE token = ? AND used = 1 AND created_at > ?
    ''', (token, cutoff)).fetchone()

    if not row:
        conn.close()
        return jsonify({'error': 'Token ungueltig oder abgelaufen'}), 400

    email = row['email']

    # Check if user already exists
    existing = conn.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
    if existing:
        conn.close()
        return jsonify({'error': 'Benutzer existiert bereits. Bitte anmelden.'}), 409

    try:
        password_hash = generate_password_hash(password)
        conn.execute('''
            INSERT INTO users (email, username, password_hash, name, role)
            VALUES (?, ?, ?, ?, 'user')
        ''', (email, username, password_hash, name or None))
        user_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
        conn.commit()
        conn.close()

        # Create auth token
        auth_token = create_token(user_id, email, 'user')

        # Send welcome email
        send_welcome_email(email, name or username)

        # Notify admin
        send_activity_notification('user_registered', {
            'Name': name or username,
            'Email': email,
            'Username': username,
            'Methode': 'Magic Link'
        })

        return jsonify({
            'success': True,
            'token': auth_token,
            'user': {
                'id': user_id,
                'email': email,
                'username': username,
                'name': name,
                'role': 'user'
            }
        })
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Email oder Username bereits vergeben'}), 409


@app.route('/api/auth/google/url', methods=['GET'])
def google_auth_url():
    """Return Google OAuth authorization URL."""
    if not GOOGLE_CLIENT_ID:
        return jsonify({'error': 'Google OAuth nicht konfiguriert'}), 503

    params = urllib.parse.urlencode({
        'client_id': GOOGLE_CLIENT_ID,
        'redirect_uri': GOOGLE_REDIRECT_URI,
        'response_type': 'code',
        'scope': 'openid email profile',
        'access_type': 'offline',
        'prompt': 'select_account',
    })
    url = f'https://accounts.google.com/o/oauth2/v2/auth?{params}'
    return jsonify({'url': url})


@app.route('/api/auth/google/callback', methods=['GET'])
def google_callback():
    """Handle Google OAuth callback, create/find user, issue JWT."""
    code = request.args.get('code')
    error = request.args.get('error')

    if error or not code:
        return f'<script>window.location.href="/auth/google-success?error={error or "no_code"}"</script>'

    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        return '<script>window.location.href="/auth/google-success?error=not_configured"</script>'

    try:
        import requests as http_requests

        # Exchange code for tokens
        token_resp = http_requests.post('https://oauth2.googleapis.com/token', data={
            'code': code,
            'client_id': GOOGLE_CLIENT_ID,
            'client_secret': GOOGLE_CLIENT_SECRET,
            'redirect_uri': GOOGLE_REDIRECT_URI,
            'grant_type': 'authorization_code',
        }, timeout=10)

        if not token_resp.ok:
            return '<script>window.location.href="/auth/google-success?error=token_exchange"</script>'

        tokens = token_resp.json()
        access_token = tokens.get('access_token')

        # Get user info
        userinfo_resp = http_requests.get('https://www.googleapis.com/oauth2/v2/userinfo',
                                          headers={'Authorization': f'Bearer {access_token}'}, timeout=10)
        if not userinfo_resp.ok:
            return '<script>window.location.href="/auth/google-success?error=userinfo"</script>'

        ginfo = userinfo_resp.json()
        google_id = ginfo.get('id')
        email = ginfo.get('email')
        name = ginfo.get('name')
        picture = ginfo.get('picture')

        if not email:
            return '<script>window.location.href="/auth/google-success?error=no_email"</script>'

        conn = get_db()

        # Try to find user by google_id or email
        user = conn.execute('SELECT * FROM users WHERE google_id = ? OR email = ?',
                            (google_id, email)).fetchone()

        if user:
            # Update google info
            conn.execute('''
                UPDATE users SET google_id = ?, profile_image_url = ?, name = COALESCE(name, ?), last_login = ?
                WHERE id = ?
            ''', (google_id, picture, name, datetime.now().isoformat(), user['id']))
            conn.commit()
            user_id = user['id']
            role = user['role']
            username = user['username']
        else:
            # Create new user (no password needed for Google-only users)
            # Generate unique username from email
            base_username = email.split('@')[0][:20]
            username = base_username
            suffix = 1
            while conn.execute('SELECT id FROM users WHERE username = ?', (username,)).fetchone():
                username = f"{base_username}{suffix}"
                suffix += 1

            conn.execute('''
                INSERT INTO users (email, username, password_hash, name, role, google_id, profile_image_url, last_login)
                VALUES (?, ?, '', ?, 'user', ?, ?, ?)
            ''', (email, username, name, google_id, picture, datetime.now().isoformat()))
            user_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
            conn.commit()
            role = 'user'

            # Notify admin
            send_activity_notification('user_registered', {
                'Name': name or username,
                'Email': email,
                'Methode': 'Google OAuth'
            })

        conn.close()

        # Create JWT
        auth_token = create_token(user_id, email, role)

        # Build user JSON for frontend
        user_json = json.dumps({
            'id': user_id,
            'email': email,
            'username': username,
            'name': name,
            'role': role,
            'profile_image_url': picture,
        })
        user_json_escaped = user_json.replace("'", "\\'")

        # Redirect to frontend success page with token
        return f'''<script>
            localStorage.setItem('voigt-garten-token', '{auth_token}');
            localStorage.setItem('voigt-garten-user', '{user_json_escaped}');
            window.dispatchEvent(new CustomEvent('auth-change', {{ detail: {{ user: {user_json} }} }}));
            window.location.href = '/';
        </script>'''

    except Exception as e:
        print(f"Google OAuth error: {e}")
        return f'<script>window.location.href="/auth/google-success?error=server"</script>'


@app.route('/api/admin/users', methods=['POST'])
@require_admin
def admin_create_user(user):
    """Admin: Create new user with custom role."""
    data = request.json

    email = data.get('email')
    username = data.get('username')
    password = data.get('password')
    name = data.get('name')
    role = data.get('role', 'user')

    if not email or not username or not password:
        return jsonify({'error': 'Email, Username und Passwort erforderlich'}), 400

    if role not in ['user', 'admin']:
        return jsonify({'error': 'Ungültige Rolle'}), 400

    conn = get_db()
    try:
        password_hash = generate_password_hash(password)
        conn.execute('''
            INSERT INTO users (email, username, password_hash, name, role)
            VALUES (?, ?, ?, ?, ?)
        ''', (email, username, password_hash, name, role))
        user_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
        conn.commit()
        conn.close()

        return jsonify({
            'success': True,
            'user': {
                'id': user_id,
                'email': email,
                'username': username,
                'name': name,
                'role': role
            }
        })
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Email oder Username bereits vergeben'}), 409


# ============ Projects (Kanban) Routes ============

@app.route('/api/projects', methods=['GET'])
def get_projects():
    """Get all projects with optional filters."""
    status = request.args.get('status')
    category = request.args.get('category')

    conn = get_db()
    query = 'SELECT * FROM projects WHERE 1=1'
    params = []

    if status:
        query += ' AND status = ?'
        params.append(status)
    if category:
        query += ' AND category = ?'
        params.append(category)

    query += ' ORDER BY CASE priority WHEN "kritisch" THEN 1 WHEN "hoch" THEN 2 WHEN "mittel" THEN 3 ELSE 4 END, created_at DESC'

    projects = conn.execute(query, params).fetchall()
    conn.close()

    result = []
    for p in projects:
        proj = parse_json_fields(dict(p))
        if not proj.get('assigned_to_list'):
            proj['assigned_to_list'] = []
        if not proj.get('dependencies'):
            proj['dependencies'] = []
        result.append(proj)

    return jsonify({
        'projects': result,
        'total': len(result)
    })


@app.route('/api/projects', methods=['POST'])
@require_auth
def create_project(user):
    """Create new project."""
    data = request.json

    # Support both 'category' (string) and 'categories' (array)
    primary_category = data.get('category')
    if not primary_category and data.get('categories'):
        primary_category = data['categories'][0]
    if not data.get('title') or not primary_category:
        return jsonify({'error': 'Titel und Kategorie erforderlich'}), 400

    conn = get_db()
    conn.execute('''
        INSERT INTO projects (title, description, category, status, priority,
                             estimated_cost, effort, timeframe, created_by, map_area, milestone_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        data['title'],
        data.get('description'),
        primary_category,
        data.get('status', 'offen'),
        data.get('priority', 'mittel'),
        data.get('estimatedCost') or data.get('estimated_cost'),
        data.get('effort'),
        data.get('timeframe'),
        user['email'],
        data.get('map_area'),
        data.get('milestone_id') or data.get('milestoneId')
    ))
    project_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]

    # Insert category mappings into junction table
    categories_list = data.get('categories', [data['category']] if data.get('category') else [])
    for cat_name in categories_list:
        cat_row = conn.execute('SELECT id FROM categories WHERE name = ?', (cat_name,)).fetchone()
        if cat_row:
            conn.execute(
                'INSERT OR IGNORE INTO project_categories (project_id, category_id) VALUES (?, ?)',
                (project_id, cat_row['id'])
            )

    conn.commit()
    conn.close()

    return jsonify({
        'success': True,
        'projectId': project_id,
        'message': 'Projekt erstellt'
    })


@app.route('/api/projects/<int:project_id>', methods=['GET'])
def get_project(project_id):
    """Get single project by ID."""
    conn = get_db()
    project = conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()

    if not project:
        conn.close()
        return jsonify({'error': 'Projekt nicht gefunden'}), 404

    proj = parse_json_fields(dict(project))
    if not proj.get('assigned_to_list'):
        proj['assigned_to_list'] = []
    if not proj.get('dependencies'):
        proj['dependencies'] = []

    # Fetch categories from junction table
    cat_rows = conn.execute('''
        SELECT c.name FROM project_categories pc
        JOIN categories c ON pc.category_id = c.id
        WHERE pc.project_id = ?
    ''', (project_id,)).fetchall()
    proj['categories'] = [r['name'] for r in cat_rows] if cat_rows else ([proj['category']] if proj.get('category') else [])
    conn.close()

    return jsonify({'project': proj})


@app.route('/api/projects/<int:project_id>', methods=['PATCH'])
@require_auth
def update_project(project_id, user):
    """Update project details."""
    data = request.json

    conn = get_db()
    project = conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()

    if not project:
        conn.close()
        return jsonify({'error': 'Projekt nicht gefunden'}), 404

    # Circular dependency detection (BFS)
    new_deps = data.get('dependencies') or data.get('dependencies')
    if new_deps is not None:
        dep_ids = json.loads(new_deps) if isinstance(new_deps, str) else new_deps
        if dep_ids:
            visited = set()
            queue = deque(dep_ids)
            while queue:
                dep_id = queue.popleft()
                if dep_id == project_id:
                    conn.close()
                    return jsonify({'error': 'Zirkuläre Abhängigkeit erkannt'}), 400
                if dep_id in visited:
                    continue
                visited.add(dep_id)
                row = conn.execute('SELECT dependencies FROM projects WHERE id = ?', (dep_id,)).fetchone()
                if row and row['dependencies']:
                    try:
                        child_deps = json.loads(row['dependencies'])
                        queue.extend(child_deps)
                    except (json.JSONDecodeError, TypeError):
                        pass

    # Build update query dynamically
    updates = []
    params = []
    allowed_fields = ['title', 'description', 'category', 'status', 'priority',
                      'estimated_cost', 'effort', 'timeframe', 'assigned_to',
                      'dependencies', 'start_date', 'due_date', 'assigned_to_list',
                      'parent_task_id', 'map_area', 'milestone_id']
    json_fields = {'dependencies', 'assigned_to_list'}

    for field in allowed_fields:
        # Also check camelCase variants
        camel_field = ''.join(word.capitalize() if i > 0 else word for i, word in enumerate(field.split('_')))
        value = data.get(field) or data.get(camel_field)
        if value is not None:
            # Serialize list/dict values as JSON strings for storage
            if field in json_fields and not isinstance(value, str):
                value = json.dumps(value)
            updates.append(f'{field} = ?')
            params.append(value)

    if updates:
        updates.append('updated_at = ?')
        params.append(datetime.now().isoformat())
        params.append(project_id)

        conn.execute(f'''
            UPDATE projects SET {', '.join(updates)} WHERE id = ?
        ''', params)
        conn.commit()

    # Update junction table if categories array provided
    categories_list = data.get('categories')
    if categories_list is not None and isinstance(categories_list, list):
        conn.execute('DELETE FROM project_categories WHERE project_id = ?', (project_id,))
        for cat_name in categories_list:
            cat_row = conn.execute('SELECT id FROM categories WHERE name = ?', (cat_name,)).fetchone()
            if cat_row:
                conn.execute(
                    'INSERT OR IGNORE INTO project_categories (project_id, category_id) VALUES (?, ?)',
                    (project_id, cat_row['id'])
                )
        # Update primary category field for backwards compatibility
        if categories_list:
            conn.execute('UPDATE projects SET category = ? WHERE id = ?', (categories_list[0], project_id))
        conn.commit()

    conn.close()

    return jsonify({'success': True, 'message': 'Projekt aktualisiert'})


@app.route('/api/projects/<int:project_id>/complete', methods=['POST'])
@require_auth
def complete_project(project_id, user):
    """Mark project as completed (with optional photo)."""
    conn = get_db()
    project = conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()

    if not project:
        conn.close()
        return jsonify({'error': 'Projekt nicht gefunden'}), 404

    notes = None
    photo_path = None
    cascade = False

    # Handle multipart form data for photo upload
    if request.content_type and 'multipart/form-data' in request.content_type:
        notes = request.form.get('notes')

        if 'photo' in request.files:
            photo = request.files['photo']
            if photo and allowed_file(photo.filename):
                ext = photo.filename.rsplit('.', 1)[1].lower()
                photo_filename = f"completion_{project_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.{ext}"
                photo_dir = os.path.join(GALLERY_DIR, 'completions')
                os.makedirs(photo_dir, exist_ok=True)
                photo_path = os.path.join('completions', photo_filename)
                photo.save(os.path.join(GALLERY_DIR, photo_path))
    else:
        data = request.json or {}
        notes = data.get('notes')
        photo_path = data.get('photoPath')
        cascade = data.get('cascade', False)

    now_iso = datetime.now().isoformat()
    conn.execute('''
        UPDATE projects SET
            status = 'done',
            completed_at = ?,
            completed_by = ?,
            completion_photo = ?,
            completion_notes = ?,
            updated_at = ?
        WHERE id = ?
    ''', (now_iso, user['email'], photo_path, notes, now_iso, project_id))

    # Cascade: also complete all child tasks
    if cascade:
        conn.execute('''
            UPDATE projects SET
                status = 'done',
                completed_at = ?,
                completed_by = ?,
                completion_notes = 'Automatisch mit Elternaufgabe abgeschlossen',
                updated_at = ?
            WHERE parent_task_id = ? AND status != 'done'
        ''', (now_iso, user['email'], now_iso, project_id))

    # Auto-recreate recurring tasks
    project_dict = dict(project)
    if project_dict.get('is_recurring') and project_dict.get('cycle_days'):
        from datetime import date
        next_due = (date.today() + timedelta(days=project_dict['cycle_days'])).isoformat()
        conn.execute('''
            INSERT INTO projects (title, description, category, status, priority, effort,
                is_recurring, cycle_days, credit_value, due_date, assigned_to, map_area, created_by)
            VALUES (?, ?, ?, 'offen', ?, ?, 1, ?, ?, ?, ?, ?, ?)
        ''', (
            project_dict['title'], project_dict.get('description'), project_dict['category'],
            project_dict.get('priority', 'mittel'), project_dict.get('effort', 'mittel'),
            project_dict['cycle_days'], project_dict.get('credit_value', 0),
            next_due, project_dict.get('assigned_to'), project_dict.get('map_area'),
            project_dict.get('created_by', 'system')
        ))
        # Auto-award credit
        if project_dict.get('credit_value') and project_dict['credit_value'] > 0:
            conn.execute('''
                INSERT INTO credits (guest_email, amount, reason, type, created_at)
                VALUES (?, ?, ?, 'earned', ?)
            ''', (
                user['email'], project_dict['credit_value'],
                f"Wiederkehrend: {project_dict['title']}", now_iso
            ))

    conn.commit()
    conn.close()

    # Send notification to admin
    send_activity_notification('task_completed', {
        'Projekt': project['title'],
        'Erledigt von': user.get('name') or user['email'],
        'Notizen': notes or '-',
        'Foto': 'Ja' if photo_path else 'Nein'
    })

    return jsonify({
        'success': True,
        'message': 'Projekt als erledigt markiert',
        'photoUrl': f'/images/gallery/{photo_path}' if photo_path else None
    })


@app.route('/api/projects/<int:project_id>/confirm', methods=['POST'])
@require_admin
def confirm_project(project_id, user):
    """Admin: Confirm project completion and award credit."""
    data = request.json or {}

    conn = get_db()
    project = conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()

    if not project:
        conn.close()
        return jsonify({'error': 'Projekt nicht gefunden'}), 404

    if project['status'] != 'done':
        conn.close()
        return jsonify({'error': 'Projekt ist noch nicht als erledigt markiert'}), 400

    if project['confirmed_at']:
        conn.close()
        return jsonify({'error': 'Projekt wurde bereits bestätigt'}), 400

    credit_amount = data.get('creditAmount', 0)

    # Update project
    conn.execute('''
        UPDATE projects SET
            confirmed_at = ?,
            confirmed_by = ?,
            credit_awarded = ?,
            updated_at = ?
        WHERE id = ?
    ''', (
        datetime.now().isoformat(),
        user['email'],
        credit_amount,
        datetime.now().isoformat(),
        project_id
    ))

    # Award credit if applicable
    if credit_amount > 0 and project['completed_by']:
        conn.execute('''
            INSERT INTO credits (guest_email, amount, reason, type)
            VALUES (?, ?, ?, 'earned')
        ''', (
            project['completed_by'],
            credit_amount,
            f"Projekt: {project['title']}"
        ))

    # Hook: wenn "Pachtvertrag unterschreiben" bestätigt wird → Impressum-Mode umschalten
    try:
        if project['description'] and '#impressum-trigger' in project['description']:
            conn.execute('''
                INSERT INTO site_config (key, value, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            ''', ('impressum_mode', 'post_lease', datetime.now().isoformat()))
            conn.commit()
            print(f"Impressum mode auto-switched to post_lease via confirmed task #{project_id}")
    except Exception as e:
        print(f"Impressum switch hook: {e}")

    conn.commit()
    conn.close()

    return jsonify({
        'success': True,
        'message': 'Projekt bestätigt',
        'creditAwarded': credit_amount
    })


@app.route('/api/projects/<int:project_id>', methods=['DELETE'])
@require_admin
def delete_project(project_id, user):
    """Admin: Delete a project."""
    conn = get_db()
    project = conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()

    if not project:
        conn.close()
        return jsonify({'error': 'Projekt nicht gefunden'}), 404

    # Delete completion photo if exists
    if project['completion_photo']:
        photo_path = os.path.join(GALLERY_DIR, project['completion_photo'])
        if os.path.exists(photo_path):
            try:
                os.remove(photo_path)
            except Exception as e:
                print(f"Failed to delete completion photo: {e}")

    conn.execute('DELETE FROM projects WHERE id = ?', (project_id,))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'message': 'Projekt gelöscht'})


# ============ Admin Routes ============

@app.route('/api/admin/stats', methods=['GET'])
@require_admin
def admin_stats(user):
    """Get admin dashboard statistics."""
    conn = get_db()

    # Pending bookings
    pending_bookings = conn.execute(
        "SELECT COUNT(*) as count FROM bookings WHERE status = 'pending'"
    ).fetchone()['count']

    # Unconfirmed completions
    unconfirmed = conn.execute(
        "SELECT COUNT(*) as count FROM projects WHERE status = 'done' AND confirmed_at IS NULL"
    ).fetchone()['count']

    # Total credits
    total_credits = conn.execute(
        "SELECT COALESCE(SUM(amount), 0) as total FROM credits WHERE type = 'earned'"
    ).fetchone()['total']

    # Projects by status
    project_stats = conn.execute('''
        SELECT status, COUNT(*) as count FROM projects GROUP BY status
    ''').fetchall()

    conn.close()

    return jsonify({
        'pendingBookings': pending_bookings,
        'unconfirmedCompletions': unconfirmed,
        'totalCreditsAwarded': total_credits,
        'projectsByStatus': {row['status']: row['count'] for row in project_stats}
    })


@app.route('/api/admin/pending-confirmations', methods=['GET'])
@require_admin
def pending_confirmations(user):
    """Get projects awaiting confirmation."""
    conn = get_db()
    projects = conn.execute('''
        SELECT * FROM projects
        WHERE status = 'done' AND confirmed_at IS NULL
        ORDER BY completed_at DESC
    ''').fetchall()
    conn.close()

    return jsonify({
        'projects': [dict(p) for p in projects],
        'total': len(projects)
    })


@app.route('/api/admin/users', methods=['GET'])
@require_admin
def list_users(user):
    """List all users (admin only)."""
    conn = get_db()
    users = conn.execute('''
        SELECT id, email, username, name, role, last_login, created_at
        FROM users ORDER BY created_at DESC
    ''').fetchall()
    conn.close()

    return jsonify({
        'users': [dict(u) for u in users],
        'total': len(users)
    })


@app.route('/api/admin/users/<int:user_id>', methods=['PATCH'])
@require_admin
def update_user(user_id, user):
    """Update user role or details (admin only)."""
    data = request.json

    conn = get_db()
    target_user = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()

    if not target_user:
        conn.close()
        return jsonify({'error': 'User nicht gefunden'}), 404

    # Prevent demoting protected admins
    protected_admins = ['moritzvoigt42@gmail.com', 'konny.voigt@web.de']
    if target_user['email'] in protected_admins and data.get('role') != 'admin':
        conn.close()
        return jsonify({'error': 'Haupt-Admin kann nicht herabgestuft werden'}), 403

    updates = []
    params = []

    if 'role' in data and data['role'] in ['user', 'admin']:
        updates.append('role = ?')
        params.append(data['role'])

    if 'name' in data:
        updates.append('name = ?')
        params.append(data['name'])

    if updates:
        params.append(user_id)
        conn.execute(f'''
            UPDATE users SET {', '.join(updates)} WHERE id = ?
        ''', params)
        conn.commit()

    conn.close()

    return jsonify({'success': True, 'message': 'User aktualisiert'})


@app.route('/api/admin/bookings', methods=['GET'])
@require_admin
def admin_bookings(user):
    """Get all bookings with full details."""
    status = request.args.get('status')

    conn = get_db()
    query = 'SELECT * FROM bookings'
    params = []

    if status:
        query += ' WHERE status = ?'
        params.append(status)

    query += ' ORDER BY created_at DESC'

    bookings_list = conn.execute(query, params).fetchall()
    conn.close()

    return jsonify({
        'bookings': [dict(b) for b in bookings_list],
        'total': len(bookings_list)
    })


@app.route('/api/admin/bookings/<int:booking_id>', methods=['PATCH'])
@require_admin
def update_booking(booking_id, user):
    """Update booking details."""
    data = request.json
    return generic_patch('bookings', booking_id, data,
        ['guest_name', 'guest_email', 'guest_phone', 'check_in', 'check_out',
         'guests', 'has_pets', 'total_price', 'discount_code', 'notes', 'status'],
        timestamp_field=None)


# ============ Recurring Tasks Routes ============

@app.route('/api/recurring-tasks', methods=['GET'])
def get_recurring_tasks():
    """Get all recurring maintenance tasks."""
    category = request.args.get('category')
    active_only = request.args.get('active', 'true').lower() == 'true'

    conn = get_db()
    query = 'SELECT * FROM recurring_tasks WHERE 1=1'
    params = []

    if active_only:
        query += ' AND is_active = 1'
    if category:
        query += ' AND category = ?'
        params.append(category)

    query += ' ORDER BY category, title'

    tasks = conn.execute(query, params).fetchall()
    conn.close()

    # Calculate status for each task
    today = datetime.now().date()
    result = []
    for task in tasks:
        t = dict(task)
        if t['next_due']:
            due_date = datetime.strptime(t['next_due'], '%Y-%m-%d').date()
            days_until = (due_date - today).days
            if days_until < 0:
                t['status'] = 'overdue'
                t['days_overdue'] = abs(days_until)
            elif days_until <= 7:
                t['status'] = 'due-soon'
                t['days_until'] = days_until
            else:
                t['status'] = 'ok'
                t['days_until'] = days_until
        else:
            t['status'] = 'ok'
        result.append(t)

    return jsonify({
        'tasks': result,
        'total': len(result)
    })


@app.route('/api/recurring-tasks', methods=['POST'])
@require_admin
def create_recurring_task(user):
    """Create new recurring task (admin only)."""
    data = request.json

    if not data.get('title') or not data.get('category') or not data.get('cycle_days'):
        return jsonify({'error': 'Titel, Kategorie und Intervall erforderlich'}), 400

    next_due = data.get('next_due') or (datetime.now() + timedelta(days=data['cycle_days'])).strftime('%Y-%m-%d')

    conn = get_db()
    conn.execute('''
        INSERT INTO recurring_tasks (title, description, category, cycle_days, credit_value, effort, next_due)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (
        data['title'],
        data.get('description'),
        data['category'],
        data['cycle_days'],
        data.get('credit_value', 0),
        data.get('effort', 'mittel'),
        next_due
    ))
    task_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
    conn.commit()
    conn.close()

    return jsonify({
        'success': True,
        'taskId': task_id,
        'message': 'Wiederkehrende Aufgabe erstellt'
    })


@app.route('/api/recurring-tasks/<int:task_id>', methods=['PATCH'])
@require_admin
def update_recurring_task(task_id, user):
    """Update recurring task (admin only)."""
    data = request.json

    conn = get_db()
    task = conn.execute('SELECT * FROM recurring_tasks WHERE id = ?', (task_id,)).fetchone()

    if not task:
        conn.close()
        return jsonify({'error': 'Aufgabe nicht gefunden'}), 404

    updates = []
    params = []
    allowed_fields = ['title', 'description', 'category', 'cycle_days', 'credit_value', 'effort', 'next_due', 'is_active', 'map_area']

    for field in allowed_fields:
        if field in data:
            updates.append(f'{field} = ?')
            params.append(data[field])

    if updates:
        params.append(task_id)
        conn.execute(f'''
            UPDATE recurring_tasks SET {', '.join(updates)} WHERE id = ?
        ''', params)
        conn.commit()

    conn.close()

    return jsonify({'success': True, 'message': 'Aufgabe aktualisiert'})


@app.route('/api/recurring-tasks/<int:task_id>', methods=['DELETE'])
@require_admin
def delete_recurring_task(task_id, user):
    """Delete recurring task (admin only)."""
    conn = get_db()
    task = conn.execute('SELECT * FROM recurring_tasks WHERE id = ?', (task_id,)).fetchone()

    if not task:
        conn.close()
        return jsonify({'error': 'Aufgabe nicht gefunden'}), 404

    conn.execute('DELETE FROM recurring_tasks WHERE id = ?', (task_id,))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'message': 'Aufgabe gelöscht'})


@app.route('/api/recurring-tasks/<int:task_id>/complete', methods=['POST'])
@require_auth
def complete_recurring_task(task_id, user):
    """Mark recurring task as completed."""
    conn = get_db()
    task = conn.execute('SELECT * FROM recurring_tasks WHERE id = ?', (task_id,)).fetchone()

    if not task:
        conn.close()
        return jsonify({'error': 'Aufgabe nicht gefunden'}), 404

    notes = None
    photo_path = None

    # Handle multipart form data for photo upload
    if request.content_type and 'multipart/form-data' in request.content_type:
        notes = request.form.get('notes')

        if 'photo' in request.files:
            photo = request.files['photo']
            if photo and allowed_file(photo.filename):
                ext = photo.filename.rsplit('.', 1)[1].lower()
                photo_filename = f"recurring_{task_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.{ext}"
                photo_dir = os.path.join(GALLERY_DIR, 'completions')
                os.makedirs(photo_dir, exist_ok=True)
                photo_path = os.path.join('completions', photo_filename)
                photo.save(os.path.join(GALLERY_DIR, photo_path))
    else:
        data = request.json or {}
        notes = data.get('notes')

    # Calculate next due date
    next_due = (datetime.now() + timedelta(days=task['cycle_days'])).strftime('%Y-%m-%d')

    # Update task
    conn.execute('''
        UPDATE recurring_tasks SET
            last_completed_at = ?,
            last_completed_by = ?,
            next_due = ?
        WHERE id = ?
    ''', (
        datetime.now().isoformat(),
        user['email'],
        next_due,
        task_id
    ))

    # Log completion in maintenance_log
    conn.execute('''
        INSERT INTO maintenance_log (task_id, completed_by, notes, photo_filename)
        VALUES (?, ?, ?, ?)
    ''', (task_id, user['email'], notes, photo_path))

    # Award credit if applicable
    if task['credit_value'] and task['credit_value'] > 0:
        conn.execute('''
            INSERT INTO credits (guest_email, amount, reason, type)
            VALUES (?, ?, ?, 'earned')
        ''', (user['email'], task['credit_value'], f"Wartung: {task['title']}"))

    conn.commit()
    conn.close()

    # Send notification to admin
    send_activity_notification('task_completed', {
        'Aufgabe': task['title'],
        'Kategorie': task['category'],
        'Erledigt von': user.get('name') or user['email'],
        'Credits': f"{task['credit_value']} Punkte" if task['credit_value'] else '-',
        'Nächste Fälligkeit': next_due
    })

    return jsonify({
        'success': True,
        'message': 'Aufgabe als erledigt markiert',
        'nextDue': next_due,
        'creditAwarded': task['credit_value']
    })


# ============ Issue Reports Routes ============

@app.route('/api/issues', methods=['GET'])
def get_issues():
    """Get all issue reports (public: only own, admin: all)."""
    user = get_current_user()
    status = request.args.get('status')

    conn = get_db()
    query = 'SELECT * FROM issue_reports WHERE 1=1'
    params = []

    # Non-admin users can only see their own reports
    if not user or user.get('role') != 'admin':
        if user:
            query += ' AND reported_by = ?'
            params.append(user['email'])
        else:
            conn.close()
            return jsonify({'issues': [], 'total': 0})

    if status:
        query += ' AND status = ?'
        params.append(status)

    query += ' ORDER BY created_at DESC'

    issues = conn.execute(query, params).fetchall()
    conn.close()

    return jsonify({
        'issues': [dict(i) for i in issues],
        'total': len(issues)
    })


def notify_infiniloop_feedback_submitted(app_task_id, reporter_email, reporter_name, title, description, category=None, priority=None):
    """Call InfiniLoop synchron nach Feedback-Submit. Gibt Flow-Hint zurueck oder None bei Fehler."""
    if not INFINILOOP_API_KEY or not INFINILOOP_URL:
        return None
    try:
        import requests as _req
        payload = {
            'project_key': 'voigt-garten',
            'app_task_id': str(app_task_id),
            'reporter_email': reporter_email or '',
            'reporter_name': reporter_name or '',
            'title': title or '',
            'description': description or '',
        }
        if category:
            payload['category'] = category
        if priority:
            payload['priority'] = priority
        resp = _req.post(
            f'{INFINILOOP_URL}/api/external/feedback_submitted',
            headers={'X-API-Key': INFINILOOP_API_KEY, 'Content-Type': 'application/json'},
            json=payload,
            timeout=10,
        )
        if resp.status_code != 200:
            app.logger.warning('InfiniLoop feedback_submitted: HTTP %s', resp.status_code)
            return None
        return resp.json()
    except Exception as e:
        app.logger.warning('InfiniLoop feedback_submitted fehlgeschlagen: %s', e)
        return None


@app.route('/api/issues', methods=['POST'])
@require_auth
def create_issue(user):
    """Report a new issue, bug, feature request, or feedback."""
    photo_path = None
    title = None
    description = None
    category = None
    report_type = 'mangel'

    # Handle multipart form data for photo upload
    if request.content_type and 'multipart/form-data' in request.content_type:
        title = request.form.get('title')
        description = request.form.get('description')
        category = request.form.get('category')
        report_type = request.form.get('report_type', 'mangel')

        if 'photo' in request.files:
            photo = request.files['photo']
            if photo and allowed_file(photo.filename):
                ext = photo.filename.rsplit('.', 1)[1].lower()
                photo_filename = f"issue_{datetime.now().strftime('%Y%m%d_%H%M%S')}.{ext}"
                photo_dir = os.path.join(GALLERY_DIR, 'issues')
                os.makedirs(photo_dir, exist_ok=True)
                photo_path = os.path.join('issues', photo_filename)
                photo.save(os.path.join(GALLERY_DIR, photo_path))
    else:
        data = request.json or {}
        title = data.get('title')
        description = data.get('description')
        category = data.get('category')
        report_type = data.get('report_type', 'mangel')

    if not title:
        return jsonify({'error': 'Titel erforderlich'}), 400

    # Validate report_type
    if report_type not in ('mangel', 'bug', 'feature', 'feedback'):
        report_type = 'mangel'

    conn = get_db()
    conn.execute('''
        INSERT INTO issue_reports (title, description, category, photo_filename, reported_by, report_type)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (title, description, category, photo_path, user['email'], report_type))
    issue_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
    conn.commit()
    conn.close()

    type_labels = {'mangel': 'Mangel', 'bug': 'Bug', 'feature': 'Feature-Wunsch', 'feedback': 'Feedback'}
    # Send notification to admin
    send_activity_notification('issue_report', {
        'Typ': type_labels.get(report_type, report_type),
        'Titel': title,
        'Kategorie': category or 'Nicht angegeben',
        'Beschreibung': description or '-',
        'Gemeldet von': user.get('name') or user['email'],
        'Foto': 'Ja' if photo_path else 'Nein'
    })

    infiniloop_hint = notify_infiniloop_feedback_submitted(
        app_task_id=issue_id,
        reporter_email=user.get('email') or '',
        reporter_name=user.get('name') or '',
        title=title,
        description=description or '',
        category=category,
    )

    response = {
        'success': True,
        'issueId': issue_id,
        'message': 'Meldung eingereicht. Ein Admin wird sich das ansehen.'
    }
    if infiniloop_hint:
        response['infiniloop'] = infiniloop_hint
    return jsonify(response)


@app.route('/api/admin/issues', methods=['GET'])
@require_admin
def admin_get_issues(user):
    """Admin: Get all issue reports."""
    status = request.args.get('status')

    conn = get_db()
    query = 'SELECT * FROM issue_reports'
    params = []

    if status:
        query += ' WHERE status = ?'
        params.append(status)

    query += ' ORDER BY created_at DESC'

    issues = conn.execute(query, params).fetchall()
    conn.close()

    return jsonify({
        'issues': [dict(i) for i in issues],
        'total': len(issues)
    })


@app.route('/api/admin/issues/<int:issue_id>/approve', methods=['POST'])
@require_admin
def approve_issue(issue_id, user):
    """Admin: Approve issue and convert to project."""
    data = request.json or {}

    conn = get_db()
    issue = conn.execute('SELECT * FROM issue_reports WHERE id = ?', (issue_id,)).fetchone()

    if not issue:
        conn.close()
        return jsonify({'error': 'Meldung nicht gefunden'}), 404

    if issue['status'] != 'pending':
        conn.close()
        return jsonify({'error': 'Meldung wurde bereits bearbeitet'}), 400

    # Create project from issue
    conn.execute('''
        INSERT INTO projects (title, description, category, status, priority, created_by)
        VALUES (?, ?, ?, 'offen', ?, ?)
    ''', (
        data.get('title') or issue['title'],
        data.get('description') or issue['description'],
        data.get('category') or issue['category'] or 'sonstiges',
        data.get('priority', 'mittel'),
        issue['reported_by']
    ))
    project_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]

    # Update issue status
    conn.execute('''
        UPDATE issue_reports SET
            status = 'approved',
            admin_notes = ?,
            converted_to_project_id = ?
        WHERE id = ?
    ''', (data.get('notes'), project_id, issue_id))

    conn.commit()
    conn.close()

    return jsonify({
        'success': True,
        'projectId': project_id,
        'message': 'Meldung genehmigt und Projekt erstellt'
    })


@app.route('/api/admin/issues/<int:issue_id>/reject', methods=['POST'])
@require_admin
def reject_issue(issue_id, user):
    """Admin: Reject issue report."""
    data = request.json or {}

    conn = get_db()
    issue = conn.execute('SELECT * FROM issue_reports WHERE id = ?', (issue_id,)).fetchone()

    if not issue:
        conn.close()
        return jsonify({'error': 'Meldung nicht gefunden'}), 404

    if issue['status'] != 'pending':
        conn.close()
        return jsonify({'error': 'Meldung wurde bereits bearbeitet'}), 400

    conn.execute('''
        UPDATE issue_reports SET
            status = 'rejected',
            admin_notes = ?
        WHERE id = ?
    ''', (data.get('notes', 'Abgelehnt'), issue_id))

    conn.commit()
    conn.close()

    return jsonify({
        'success': True,
        'message': 'Meldung abgelehnt'
    })


# ============ Categories API ============

@app.route('/api/categories', methods=['GET'])
def get_categories():
    """Get all categories."""
    conn = get_db()
    cats = conn.execute('SELECT * FROM categories ORDER BY sort_order').fetchall()
    conn.close()
    return jsonify({'categories': [dict(c) for c in cats]})


# ============ Unified Tasks API ============

@app.route('/api/tasks/unified', methods=['GET'])
def get_unified_tasks():
    """Get combined view of recurring tasks and projects."""
    task_type = request.args.get('type', 'all')  # 'recurring', 'project', 'all'
    category = request.args.get('category')
    status = request.args.get('status')
    effort = request.args.get('effort')
    assignee = request.args.get('assignee')
    search = request.args.get('search')
    priority = request.args.get('priority')
    assigned_to = request.args.get('assigned_to')
    map_area = request.args.get('map_area')
    sort_by = request.args.get('sort', 'created_at')
    order = request.args.get('order', 'desc')

    conn = get_db()
    tasks = []
    today = datetime.now().date()

    # Pre-fetch comment counts
    comment_counts = {}
    for row in conn.execute('SELECT task_type, task_id, COUNT(*) as cnt FROM task_comments GROUP BY task_type, task_id').fetchall():
        comment_counts[(row['task_type'], row['task_id'])] = row['cnt']

    # Pre-fetch children counts
    children_counts = {}
    for row in conn.execute('SELECT parent_task_id, COUNT(*) as cnt FROM projects WHERE parent_task_id IS NOT NULL GROUP BY parent_task_id').fetchall():
        children_counts[row['parent_task_id']] = row['cnt']

    # Pre-fetch category mappings from junction tables
    project_cats = {}
    for row in conn.execute('''
        SELECT pc.project_id, c.name FROM project_categories pc
        JOIN categories c ON pc.category_id = c.id
    ''').fetchall():
        project_cats.setdefault(row['project_id'], []).append(row['name'])

    recurring_cats = {}
    for row in conn.execute('''
        SELECT rtc.recurring_task_id, c.name FROM recurring_task_categories rtc
        JOIN categories c ON rtc.category_id = c.id
    ''').fetchall():
        recurring_cats.setdefault(row['recurring_task_id'], []).append(row['name'])

    # Get recurring tasks
    if task_type in ['recurring', 'all']:
        query = 'SELECT * FROM recurring_tasks WHERE is_active = 1'
        params = []

        if category:
            query += ''' AND id IN (
                SELECT rtc.recurring_task_id FROM recurring_task_categories rtc
                JOIN categories c ON rtc.category_id = c.id WHERE c.name = ?
            )'''
            params.append(category)
        if effort:
            query += ' AND effort = ?'
            params.append(effort)
        if map_area:
            query += ' AND map_area = ?'
            params.append(map_area)
        if search:
            if search.startswith('#') and search[1:].isdigit():
                pass  # recurring tasks don't have meaningful IDs to search
            else:
                query += ' AND (title LIKE ? OR description LIKE ?)'
                params.extend([f'%{search}%', f'%{search}%'])

        recurring = conn.execute(query, params).fetchall()

        for task in recurring:
            t = dict(task)
            t['task_type'] = 'recurring'
            t['categories'] = recurring_cats.get(t['id'], [t['category']] if t.get('category') else [])

            # Calculate status
            if t['next_due']:
                due_date = datetime.strptime(t['next_due'], '%Y-%m-%d').date()
                days_until = (due_date - today).days
                if days_until < 0:
                    t['due_status'] = 'overdue'
                elif days_until <= 7:
                    t['due_status'] = 'due-soon'
                else:
                    t['due_status'] = 'ok'
            else:
                t['due_status'] = 'ok'

            # Filter by status if specified
            if status and t['due_status'] != status:
                continue

            # Computed fields
            t['comment_count'] = comment_counts.get(('recurring', t['id']), 0)
            t['children_count'] = 0
            t['has_blockers'] = False

            tasks.append(t)

    # Get projects
    if task_type in ['project', 'all']:
        query = 'SELECT * FROM projects WHERE 1=1'
        params = []

        if category:
            query += ''' AND id IN (
                SELECT pc.project_id FROM project_categories pc
                JOIN categories c ON pc.category_id = c.id WHERE c.name = ?
            )'''
            params.append(category)
        if effort:
            query += ' AND effort = ?'
            params.append(effort)
        if map_area:
            query += ' AND map_area = ?'
            params.append(map_area)
        if assignee:
            query += ' AND assigned_to = ?'
            params.append(assignee)
        if priority:
            query += ' AND priority = ?'
            params.append(priority)
        if assigned_to:
            query += ' AND assigned_to_list LIKE ?'
            params.append(f'%{assigned_to}%')
        if search:
            if search.startswith('#') and search[1:].isdigit():
                query += ' AND id = ?'
                params.append(int(search[1:]))
            else:
                query += ' AND (title LIKE ? OR description LIKE ?)'
                params.extend([f'%{search}%', f'%{search}%'])

        projects = conn.execute(query, params).fetchall()

        for project in projects:
            p = dict(project)
            p['task_type'] = 'project'
            p['categories'] = project_cats.get(p['id'], [p['category']] if p.get('category') else [])

            # Compute due_status from due_date
            if p.get('due_date'):
                try:
                    due_dt = datetime.strptime(p['due_date'], '%Y-%m-%d').date()
                    days_until = (due_dt - today).days
                    if days_until < 0:
                        p['due_status'] = 'overdue'
                    elif days_until <= 7:
                        p['due_status'] = 'due-soon'
                    else:
                        p['due_status'] = 'ok'
                except (ValueError, TypeError):
                    p['due_status'] = 'ok'
            else:
                p['due_status'] = 'ok'

            # Parse JSON fields stored as text
            parse_json_fields(p)
            if not p.get('assigned_to_list'):
                p['assigned_to_list'] = []
            if not p.get('dependencies'):
                p['dependencies'] = []

            # Computed fields
            p['comment_count'] = comment_counts.get(('project', p['id']), 0)
            p['children_count'] = children_counts.get(p['id'], 0)

            # has_blockers: check if any dependency is not done
            has_blockers = False
            dep_ids = p.get('dependencies', [])
            if dep_ids and isinstance(dep_ids, list) and len(dep_ids) > 0:
                try:
                    placeholders = ','.join('?' for _ in dep_ids)
                    blocker = conn.execute(
                        f"SELECT COUNT(*) as cnt FROM projects WHERE id IN ({placeholders}) AND status != 'done'",
                        dep_ids
                    ).fetchone()
                    has_blockers = blocker['cnt'] > 0
                except (TypeError, Exception):
                    pass
            p['has_blockers'] = has_blockers

            tasks.append(p)

    # Get categories from DB for filter options
    all_categories = conn.execute('SELECT name FROM categories ORDER BY sort_order').fetchall()
    cat_names = [r['name'] for r in all_categories]
    conn.close()

    # Sorting
    valid_sorts = {'start_date', 'created_at', 'priority', 'due_date', 'title'}
    if sort_by in valid_sorts:
        priority_order = {'hoch': 0, 'mittel': 1, 'niedrig': 2}
        reverse = (order == 'desc')

        def sort_key(t):
            val = t.get(sort_by)
            if sort_by == 'priority':
                return priority_order.get(val, 99)
            if val is None:
                return '' if not reverse else '\xff'
            return val

        tasks.sort(key=sort_key, reverse=reverse)

    efforts = list(set(t.get('effort') for t in tasks if t.get('effort')))
    assignees_list = list(set(t.get('assigned_to') for t in tasks if t.get('assigned_to')))

    return jsonify({
        'tasks': tasks,
        'total': len(tasks),
        'filters': {
            'categories': cat_names,
            'efforts': ['leicht', 'mittel', 'schwer'],
            'assignees': sorted(assignees_list)
        }
    })


@app.route('/api/map/photo-points', methods=['GET'])
def get_map_photo_points():
    """Get gallery images with precise map coordinates for display on the garden map."""
    conn = get_db()
    rows = conn.execute(
        "SELECT id, name, category, type, map_x, map_y, map_area, thumbnail_path, filename "
        "FROM gallery_images WHERE map_x IS NOT NULL AND map_y IS NOT NULL AND status = 'approved'"
    ).fetchall()
    conn.close()

    points = []
    for row in rows:
        r = dict(row)
        cat = r.get('category', 'sonstiges')
        filename = r['filename']
        # Build thumbnail URL (same logic as get_gallery)
        if r.get('thumbnail_path'):
            thumb = r['thumbnail_path']
            if thumb.startswith('/'):
                thumb_url = thumb
            else:
                thumb_url = f"/images/gallery/{thumb}"
        else:
            thumb_url = f"/images/gallery/{filename}"

        points.append({
            'id': r['id'],
            'name': r.get('name') or 'Ohne Titel',
            'category': cat,
            'type': r.get('type', 'image'),
            'map_x': r['map_x'],
            'map_y': r['map_y'],
            'map_area': r.get('map_area'),
            'thumbnailUrl': thumb_url,
        })

    return jsonify({'points': points, 'total': len(points)})


@app.route('/api/map/areas', methods=['GET'])
def get_map_areas():
    """Get aggregated data per map area for the garden map."""
    conn = get_db()
    today = datetime.now().date()
    areas = {}

    # Load descriptions
    for row in conn.execute('SELECT area_id, description FROM map_area_descriptions').fetchall():
        areas[row['area_id']] = {
            'task_count': 0, 'status': 'ok', 'inventory_count': 0,
            'description': row['description'] or '', 'photo_count': 0
        }

    # Count open projects per area
    for row in conn.execute(
        "SELECT map_area, COUNT(*) as cnt FROM projects WHERE map_area IS NOT NULL AND status NOT IN ('erledigt', 'abgeschlossen') GROUP BY map_area"
    ).fetchall():
        area = row['map_area']
        if area not in areas:
            areas[area] = {'task_count': 0, 'status': 'ok', 'inventory_count': 0, 'description': '', 'photo_count': 0}
        areas[area]['task_count'] += row['cnt']

    # Count and check recurring tasks per area
    for row in conn.execute(
        "SELECT map_area, next_due FROM recurring_tasks WHERE map_area IS NOT NULL AND is_active = 1"
    ).fetchall():
        area = row['map_area']
        if area not in areas:
            areas[area] = {'task_count': 0, 'status': 'ok', 'inventory_count': 0, 'description': '', 'photo_count': 0}
        areas[area]['task_count'] += 1

        if row['next_due']:
            due_date = datetime.strptime(row['next_due'], '%Y-%m-%d').date()
            days_until = (due_date - today).days
            if days_until < 0:
                areas[area]['status'] = 'overdue'
            elif days_until <= 7 and areas[area]['status'] != 'overdue':
                areas[area]['status'] = 'due-soon'

    # Count inventory items per area (via buildings)
    for row in conn.execute("""
        SELECT b.map_area, COUNT(i.id) as cnt
        FROM inventory_buildings b
        JOIN inventory_rooms r ON r.building_id = b.id
        JOIN inventory_items i ON i.room_id = r.id
        WHERE b.map_area IS NOT NULL
        GROUP BY b.map_area
    """).fetchall():
        area = row['map_area']
        if area not in areas:
            areas[area] = {'task_count': 0, 'status': 'ok', 'inventory_count': 0, 'description': '', 'photo_count': 0}
        areas[area]['inventory_count'] = row['cnt']

    # Count gallery photos per area
    for row in conn.execute(
        "SELECT map_area, COUNT(*) as cnt FROM gallery_images WHERE map_area IS NOT NULL AND status = 'approved' GROUP BY map_area"
    ).fetchall():
        area = row['map_area']
        if area not in areas:
            areas[area] = {'task_count': 0, 'status': 'ok', 'inventory_count': 0, 'description': '', 'photo_count': 0}
        areas[area]['photo_count'] = row['cnt']

    conn.close()
    return jsonify({'areas': areas})


@app.route('/api/map/area-descriptions', methods=['GET'])
def get_area_descriptions():
    """Get all map area descriptions."""
    conn = get_db()
    rows = conn.execute('SELECT area_id, description, updated_at, updated_by FROM map_area_descriptions').fetchall()
    conn.close()
    return jsonify({row['area_id']: {'description': row['description'], 'updated_at': row['updated_at'], 'updated_by': row['updated_by']} for row in rows})


@app.route('/api/admin/map/area-descriptions', methods=['PUT'])
@require_admin
def update_area_description(user):
    """Admin: Update a map area description."""
    data = request.get_json()
    area_id = data.get('area_id')
    description = data.get('description', '')

    if not area_id:
        return jsonify({'error': 'area_id erforderlich'}), 400

    conn = get_db()
    conn.execute(
        '''INSERT INTO map_area_descriptions (area_id, description, updated_at, updated_by)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(area_id) DO UPDATE SET description = ?, updated_at = ?, updated_by = ?''',
        (area_id, description, datetime.now().isoformat(), user.get('email'),
         description, datetime.now().isoformat(), user.get('email'))
    )
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/admin/gallery/<item_id>/map-area', methods=['PATCH'])
@require_admin
def update_gallery_map_area(item_id, user):
    """Admin: Assign a gallery item to a map area and/or precise location."""
    data = request.get_json()
    map_area = data.get('map_area')  # None or '' to remove
    map_x = data.get('map_x')
    map_y = data.get('map_y')

    # Validate: both or neither
    if (map_x is not None) != (map_y is not None):
        return jsonify({'error': 'map_x und map_y müssen zusammen gesetzt werden'}), 400

    conn = get_db()
    item = conn.execute('SELECT id FROM gallery_images WHERE id = ?', (item_id,)).fetchone()
    if not item:
        conn.close()
        return jsonify({'error': 'Bild nicht gefunden'}), 404

    conn.execute(
        'UPDATE gallery_images SET map_area = ?, map_x = ?, map_y = ? WHERE id = ?',
        (map_area if map_area else None, map_x, map_y, item_id)
    )
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/admin/gallery/<item_id>', methods=['PATCH'])
@require_admin
def update_gallery_item(item_id, user):
    """Admin: Update gallery item metadata."""
    data = request.json
    return generic_patch('gallery_images', item_id, data,
        ['name', 'description', 'category', 'status'],
        timestamp_field=None)


@app.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
@require_admin
def delete_user(user_id, user):
    """Admin: Delete a user."""
    conn = get_db()
    target_user = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()

    if not target_user:
        conn.close()
        return jsonify({'error': 'User nicht gefunden'}), 404

    # Prevent deleting the main admin
    if target_user['email'] == 'moritzvoigt42@gmail.com':
        conn.close()
        return jsonify({'error': 'Haupt-Admin kann nicht gelöscht werden'}), 403

    # Prevent self-deletion
    if target_user['id'] == user['user_id']:
        conn.close()
        return jsonify({'error': 'Eigener Account kann nicht gelöscht werden'}), 403

    # Delete user's tokens
    conn.execute('DELETE FROM auth_tokens WHERE user_id = ?', (user_id,))
    # Delete user
    conn.execute('DELETE FROM users WHERE id = ?', (user_id,))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'message': 'User gelöscht'})


# ============ Inventory Endpoints ============

@app.route('/api/inventory/buildings', methods=['GET'])
def get_inventory_buildings():
    """Get all buildings with nested floors and rooms, including item counts."""
    conn = get_db()

    buildings = conn.execute('SELECT * FROM inventory_buildings ORDER BY sort_order').fetchall()
    floors = conn.execute('SELECT * FROM inventory_floors ORDER BY sort_order').fetchall()
    rooms = conn.execute('SELECT * FROM inventory_rooms ORDER BY sort_order').fetchall()

    # Get item counts per room
    item_counts = {}
    for row in conn.execute('SELECT room_id, COUNT(*) as cnt FROM inventory_items GROUP BY room_id').fetchall():
        item_counts[row['room_id']] = row['cnt']

    conn.close()

    # Build nested structure
    floors_by_building = {}
    for f in floors:
        bid = f['building_id']
        if bid not in floors_by_building:
            floors_by_building[bid] = []
        floors_by_building[bid].append(dict(f))

    rooms_by_floor = {}
    rooms_by_building_no_floor = {}
    for r in rooms:
        rd = dict(r)
        rd['item_count'] = item_counts.get(r['id'], 0)
        if r['floor_id']:
            if r['floor_id'] not in rooms_by_floor:
                rooms_by_floor[r['floor_id']] = []
            rooms_by_floor[r['floor_id']].append(rd)
        else:
            bid = r['building_id']
            if bid not in rooms_by_building_no_floor:
                rooms_by_building_no_floor[bid] = []
            rooms_by_building_no_floor[bid].append(rd)

    result = []
    for b in buildings:
        bd = dict(b)
        bd['has_floors'] = bool(b['has_floors'])
        if bd['has_floors']:
            bd['floors'] = []
            for f in floors_by_building.get(b['id'], []):
                f['rooms'] = rooms_by_floor.get(f['id'], [])
                bd['floors'].append(f)
            bd['rooms'] = []
        else:
            bd['floors'] = []
            bd['rooms'] = rooms_by_building_no_floor.get(b['id'], [])
        result.append(bd)

    return jsonify({'buildings': result})


@app.route('/api/inventory/buildings', methods=['POST'])
@require_admin
def create_inventory_building(user):
    """Admin: Create a new building."""
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'error': 'Name ist erforderlich'}), 400

    bid = slugify(data['name']) or hashlib.md5(data['name'].encode()).hexdigest()[:12]
    conn = get_db()
    try:
        conn.execute(
            'INSERT INTO inventory_buildings (id, name, icon, has_floors, sort_order) VALUES (?, ?, ?, ?, ?)',
            (bid, data['name'], data.get('icon', '🏠'), data.get('has_floors', False),
             data.get('sort_order', 0))
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Gebäude existiert bereits'}), 409
    conn.close()
    return jsonify({'success': True, 'id': bid}), 201


@app.route('/api/inventory/buildings/<building_id>', methods=['PATCH'])
@require_admin
def update_inventory_building(building_id, user):
    """Admin: Update a building."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Keine Daten'}), 400

    conn = get_db()
    building = conn.execute('SELECT * FROM inventory_buildings WHERE id = ?', (building_id,)).fetchone()
    if not building:
        conn.close()
        return jsonify({'error': 'Gebäude nicht gefunden'}), 404

    updates = []
    params = []
    for field in ['name', 'icon', 'has_floors', 'sort_order', 'map_area']:
        if field in data:
            updates.append(f'{field} = ?')
            params.append(data[field])

    if updates:
        params.append(building_id)
        conn.execute(f'UPDATE inventory_buildings SET {", ".join(updates)} WHERE id = ?', params)
        conn.commit()

    conn.close()
    return jsonify({'success': True})


@app.route('/api/inventory/rooms', methods=['GET'])
def get_inventory_rooms():
    """Get all rooms, optionally filtered by building."""
    building_id = request.args.get('building')
    conn = get_db()

    if building_id:
        rooms = conn.execute('''
            SELECT r.*, b.name as building_name, f.name as floor_name
            FROM inventory_rooms r
            JOIN inventory_buildings b ON r.building_id = b.id
            LEFT JOIN inventory_floors f ON r.floor_id = f.id
            WHERE r.building_id = ?
            ORDER BY r.sort_order
        ''', (building_id,)).fetchall()
    else:
        rooms = conn.execute('''
            SELECT r.*, b.name as building_name, f.name as floor_name
            FROM inventory_rooms r
            JOIN inventory_buildings b ON r.building_id = b.id
            LEFT JOIN inventory_floors f ON r.floor_id = f.id
            ORDER BY b.sort_order, f.sort_order, r.sort_order
        ''').fetchall()

    conn.close()
    return jsonify({'rooms': [dict(r) for r in rooms]})


@app.route('/api/inventory/rooms', methods=['POST'])
@require_admin
def create_inventory_room(user):
    """Admin: Create a new room."""
    data = request.get_json()
    if not data or not data.get('name') or not data.get('building_id'):
        return jsonify({'error': 'Name und building_id sind erforderlich'}), 400

    rid = slugify(data['name']) or hashlib.md5(data['name'].encode()).hexdigest()[:12]
    # Make ID unique by prepending building
    rid = f"{data['building_id']}_{rid}"

    conn = get_db()
    try:
        conn.execute(
            'INSERT INTO inventory_rooms (id, building_id, floor_id, name, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
            (rid, data['building_id'], data.get('floor_id'), data['name'],
             data.get('icon', '🚪'), data.get('sort_order', 0))
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Raum existiert bereits'}), 409
    conn.close()
    return jsonify({'success': True, 'id': rid}), 201


@app.route('/api/inventory/floors/<floor_id>', methods=['PATCH'])
@require_auth
def update_floor(floor_id, user):
    """Update a floor."""
    return generic_patch('inventory_floors', floor_id, request.json,
        ['name', 'icon', 'sort_order'], timestamp_field=None)


@app.route('/api/inventory/rooms/<room_id>', methods=['DELETE'])
@require_admin
def delete_room(room_id, user):
    """Admin: Delete a room (only if empty)."""
    conn = get_db()
    items = conn.execute('SELECT COUNT(*) as c FROM inventory_items WHERE room_id = ?', (room_id,)).fetchone()['c']
    if items > 0:
        conn.close()
        return jsonify({'error': f'Raum enthält noch {items} Gegenstände'}), 400
    conn.execute('DELETE FROM inventory_rooms WHERE id = ?', (room_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/inventory/buildings/<building_id>', methods=['DELETE'])
@require_admin
def delete_building(building_id, user):
    """Admin: Delete a building (only if no rooms)."""
    conn = get_db()
    rooms = conn.execute('SELECT COUNT(*) as c FROM inventory_rooms WHERE building_id = ?', (building_id,)).fetchone()['c']
    if rooms > 0:
        conn.close()
        return jsonify({'error': f'Gebäude enthält noch {rooms} Räume'}), 400
    conn.execute('DELETE FROM inventory_floors WHERE building_id = ?', (building_id,))
    conn.execute('DELETE FROM inventory_buildings WHERE id = ?', (building_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/inventory/items', methods=['GET'])
def get_inventory_items():
    """Get inventory items with optional filters."""
    room_id = request.args.get('room')
    search = request.args.get('search')
    vorhanden = request.args.get('vorhanden')

    conn = get_db()
    query = '''
        SELECT i.*, r.name as room_name, r.building_id, b.name as building_name
        FROM inventory_items i
        LEFT JOIN inventory_rooms r ON i.room_id = r.id
        LEFT JOIN inventory_buildings b ON r.building_id = b.id
        WHERE 1=1
    '''
    params = []

    if room_id:
        query += ' AND i.room_id = ?'
        params.append(room_id)

    if search:
        query += ' AND (i.name LIKE ? OR i.notes LIKE ? OR i.ablageort LIKE ? OR i.category LIKE ?)'
        s = f'%{search}%'
        params.extend([s, s, s, s])

    if vorhanden is not None:
        query += ' AND i.vorhanden = ?'
        params.append(1 if vorhanden.lower() in ('true', '1') else 0)

    query += ' ORDER BY i.room_id, i.ablageort, i.position, i.name'
    items = conn.execute(query, params).fetchall()
    conn.close()

    return jsonify({'items': [dict(item) for item in items], 'total': len(items)})


@app.route('/api/inventory/items', methods=['POST'])
@require_auth
def create_inventory_item(user):
    """Create a new inventory item."""
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'error': 'Name ist erforderlich'}), 400

    item_id = hashlib.md5(f"{data['name']}-{datetime.now().isoformat()}-{secrets.token_hex(4)}".encode()).hexdigest()[:16]
    now = datetime.now().isoformat()

    conn = get_db()
    conn.execute('''
        INSERT INTO inventory_items (id, name, room_id, category, notes, quantity, ablageort, position, kauflink, vorhanden, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        item_id, data['name'], data.get('room_id'), data.get('category'),
        data.get('notes'), data.get('quantity', 1), data.get('ablageort'),
        data.get('position'), data.get('kauflink'),
        data.get('vorhanden', True), user.get('email'), now, now
    ))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'id': item_id}), 201


@app.route('/api/inventory/items/<item_id>', methods=['PATCH'])
@require_auth
def update_inventory_item(item_id, user):
    """Update an inventory item."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Keine Daten'}), 400

    conn = get_db()
    item = conn.execute('SELECT * FROM inventory_items WHERE id = ?', (item_id,)).fetchone()
    if not item:
        conn.close()
        return jsonify({'error': 'Item nicht gefunden'}), 404

    allowed_fields = ['name', 'room_id', 'category', 'notes', 'quantity', 'ablageort', 'position', 'kauflink', 'vorhanden']
    updates = []
    params = []
    for field in allowed_fields:
        if field in data:
            updates.append(f'{field} = ?')
            params.append(data[field])

    if updates:
        updates.append('updated_at = ?')
        params.append(datetime.now().isoformat())
        params.append(item_id)
        conn.execute(f'UPDATE inventory_items SET {", ".join(updates)} WHERE id = ?', params)
        conn.commit()

    conn.close()
    return jsonify({'success': True})


@app.route('/api/inventory/items/<item_id>', methods=['DELETE'])
@require_admin
def delete_inventory_item(item_id, user):
    """Admin: Delete an inventory item."""
    conn = get_db()
    item = conn.execute('SELECT * FROM inventory_items WHERE id = ?', (item_id,)).fetchone()
    if not item:
        conn.close()
        return jsonify({'error': 'Item nicht gefunden'}), 404

    # Delete photo if exists
    if item['photo_path']:
        photo_full = os.path.join(GALLERY_DIR, item['photo_path'])
        if os.path.exists(photo_full):
            os.remove(photo_full)

    conn.execute('DELETE FROM inventory_items WHERE id = ?', (item_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/inventory/items/<item_id>/photo', methods=['POST'])
@require_auth
def upload_inventory_photo(item_id, user):
    """Upload a photo for an inventory item."""
    conn = get_db()
    item = conn.execute('SELECT * FROM inventory_items WHERE id = ?', (item_id,)).fetchone()
    if not item:
        conn.close()
        return jsonify({'error': 'Item nicht gefunden'}), 404

    if 'file' not in request.files:
        conn.close()
        return jsonify({'error': 'Keine Datei'}), 400

    file = request.files['file']
    if not file.filename or not allowed_file(file.filename):
        conn.close()
        return jsonify({'error': 'Ungültiger Dateityp'}), 400

    # Save to inventory subfolder
    inv_dir = os.path.join(GALLERY_DIR, 'inventory')
    os.makedirs(inv_dir, exist_ok=True)

    ext = file.filename.rsplit('.', 1)[1].lower()
    filename = f"{item_id}.{ext}"
    filepath = os.path.join(inv_dir, filename)
    file.save(filepath)

    photo_path = f"inventory/{filename}"
    conn.execute('UPDATE inventory_items SET photo_path = ?, updated_at = ? WHERE id = ?',
                 (photo_path, datetime.now().isoformat(), item_id))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'photo_path': photo_path})


@app.route('/api/inventory/furniture-meta', methods=['GET'])
def get_furniture_meta():
    """Get furniture/ablageort icons."""
    conn = get_db()
    meta = conn.execute('SELECT * FROM inventory_furniture_meta').fetchall()
    conn.close()
    return jsonify({'meta': [dict(m) for m in meta]})


@app.route('/api/inventory/furniture-meta', methods=['PATCH'])
@require_auth
def update_furniture_meta(user):
    """Set icon for a furniture/ablageort."""
    data = request.get_json()
    if not data or not data.get('room_id') or not data.get('ablageort'):
        return jsonify({'error': 'room_id und ablageort sind erforderlich'}), 400

    conn = get_db()
    conn.execute('''
        INSERT INTO inventory_furniture_meta (room_id, ablageort, icon) VALUES (?, ?, ?)
        ON CONFLICT(room_id, ablageort) DO UPDATE SET icon = excluded.icon
    ''', (data['room_id'], data['ablageort'], data.get('icon', '🪑')))
    conn.commit()
    conn.close()

    return jsonify({'success': True})


# ============ Service Providers CRUD ============

@app.route('/api/service-providers', methods=['GET'])
def get_service_providers():
    """Get all service providers, optionally filtered by category."""
    category = request.args.get('category')
    conn = get_db()

    if category:
        providers = conn.execute('SELECT * FROM service_providers WHERE category = ?', (category,)).fetchall()
    else:
        providers = conn.execute('SELECT * FROM service_providers').fetchall()

    conn.close()
    return jsonify({'providers': [dict(p) for p in providers]})


@app.route('/api/service-providers', methods=['POST'])
@require_admin
def create_service_provider(user):
    """Admin: Create a service provider."""
    data = request.json
    if not data or not data.get('name') or not data.get('category'):
        return jsonify({'error': 'Name und Kategorie sind erforderlich'}), 400

    conn = get_db()
    conn.execute('''
        INSERT INTO service_providers (category, name, email, phone, rating, notes, verified)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (
        data['category'],
        data['name'],
        data.get('email'),
        data.get('phone'),
        data.get('rating', 0),
        data.get('notes'),
        data.get('verified', False)
    ))
    provider_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'id': provider_id, 'message': 'Dienstleister erstellt'})


@app.route('/api/service-providers/<int:id>', methods=['PATCH'])
@require_admin
def update_service_provider(id, user):
    """Admin: Update a service provider."""
    data = request.json
    conn = get_db()
    provider = conn.execute('SELECT * FROM service_providers WHERE id = ?', (id,)).fetchone()

    if not provider:
        conn.close()
        return jsonify({'error': 'Dienstleister nicht gefunden'}), 404

    updates = []
    params = []
    for field in ['category', 'name', 'email', 'phone', 'rating', 'notes', 'verified']:
        if field in data:
            updates.append(f'{field} = ?')
            params.append(data[field])

    if updates:
        params.append(id)
        conn.execute(f'UPDATE service_providers SET {", ".join(updates)} WHERE id = ?', params)
        conn.commit()

    conn.close()
    return jsonify({'success': True, 'message': 'Dienstleister aktualisiert'})


@app.route('/api/service-providers/<int:id>', methods=['DELETE'])
@require_admin
def delete_service_provider(id, user):
    """Admin: Delete a service provider."""
    conn = get_db()
    provider = conn.execute('SELECT * FROM service_providers WHERE id = ?', (id,)).fetchone()

    if not provider:
        conn.close()
        return jsonify({'error': 'Dienstleister nicht gefunden'}), 404

    conn.execute('DELETE FROM service_providers WHERE id = ?', (id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'message': 'Dienstleister gelöscht'})


# ============ Assignees ============

@app.route('/api/assignees', methods=['GET'])
def get_assignees():
    """Get combined list of users and service providers as assignees."""
    conn = get_db()
    users = conn.execute('SELECT id, name, email, role FROM users').fetchall()
    providers = conn.execute('SELECT id, name, email, category FROM service_providers').fetchall()
    conn.close()

    assignees = []
    for u in users:
        assignees.append({
            'id': u['id'],
            'name': u['name'] or u['email'],
            'email': u['email'],
            'type': 'user'
        })
    for p in providers:
        assignees.append({
            'id': p['id'],
            'name': p['name'],
            'email': p['email'],
            'type': 'provider',
            'category': p['category']
        })

    return jsonify({'assignees': assignees})


# ============ Subtasks ============

@app.route('/api/projects/<int:id>/subtasks', methods=['GET'])
def get_subtasks(id):
    """Get subtasks (children) of a project."""
    recursive = request.args.get('recursive', 'false').lower() == 'true'
    conn = get_db()

    if recursive:
        # Gather all descendants via BFS
        all_subtasks = []
        queue = deque([id])
        while queue:
            parent_id = queue.popleft()
            children = conn.execute(
                'SELECT * FROM projects WHERE parent_task_id = ?', (parent_id,)
            ).fetchall()
            for child in children:
                c = dict(child)
                all_subtasks.append(c)
                queue.append(c['id'])
        conn.close()
        return jsonify({'subtasks': all_subtasks, 'total': len(all_subtasks)})
    else:
        subtasks = conn.execute(
            'SELECT * FROM projects WHERE parent_task_id = ?', (id,)
        ).fetchall()
        conn.close()
        return jsonify({'subtasks': [dict(s) for s in subtasks], 'total': len(subtasks)})


@app.route('/api/projects/<int:id>/subtasks', methods=['POST'])
@require_auth
def create_subtask(id, user):
    """Create a child project (subtask) under the given parent."""
    data = request.json
    if not data or not data.get('title') or not data.get('category'):
        return jsonify({'error': 'Titel und Kategorie sind erforderlich'}), 400

    conn = get_db()
    # Verify parent exists
    parent = conn.execute('SELECT id FROM projects WHERE id = ?', (id,)).fetchone()
    if not parent:
        conn.close()
        return jsonify({'error': 'Elternprojekt nicht gefunden'}), 404

    conn.execute('''
        INSERT INTO projects (title, description, category, status, priority,
                              estimated_cost, effort, timeframe, parent_task_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        data['title'],
        data.get('description'),
        data['category'],
        data.get('status', 'offen'),
        data.get('priority', 'mittel'),
        data.get('estimatedCost') or data.get('estimated_cost'),
        data.get('effort'),
        data.get('timeframe'),
        id,
        user['email']
    ))
    subtask_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
    conn.commit()
    conn.close()

    return jsonify({
        'success': True,
        'id': subtask_id,
        'message': 'Unteraufgabe erstellt'
    })


# ============ Dependencies / Blockers ============

@app.route('/api/projects/<int:id>/blockers', methods=['GET'])
def get_blockers(id):
    """Get non-completed dependencies (blockers) for a project."""
    conn = get_db()
    project = conn.execute('SELECT dependencies FROM projects WHERE id = ?', (id,)).fetchone()

    if not project:
        conn.close()
        return jsonify({'error': 'Projekt nicht gefunden'}), 404

    proj_dict = parse_json_fields(dict(project))
    dep_ids = proj_dict.get('dependencies') or []

    blockers = []
    for dep_id in dep_ids:
        dep = conn.execute('SELECT * FROM projects WHERE id = ? AND status != ?', (dep_id, 'done')).fetchone()
        if dep:
            blockers.append(dict(dep))

    conn.close()
    return jsonify({'blockers': blockers, 'total': len(blockers)})


# ============ Task Comments ============

@app.route('/api/tasks/<task_type>/<int:task_id>/comments', methods=['GET'])
def get_task_comments(task_type, task_id):
    """Get comments for a task."""
    if task_type not in ('project', 'recurring'):
        return jsonify({'error': 'Ungültiger task_type (project oder recurring)'}), 400

    conn = get_db()
    comments = conn.execute(
        'SELECT * FROM task_comments WHERE task_id = ? AND task_type = ? ORDER BY created_at ASC',
        (task_id, task_type)
    ).fetchall()
    conn.close()

    return jsonify({'comments': [dict(c) for c in comments], 'total': len(comments)})


@app.route('/api/tasks/<task_type>/<int:task_id>/comments', methods=['POST'])
@require_auth
def create_task_comment(task_type, task_id, user):
    """Create a comment on a task."""
    if task_type not in ('project', 'recurring'):
        return jsonify({'error': 'Ungültiger task_type (project oder recurring)'}), 400

    data = request.json
    if not data or not data.get('comment'):
        return jsonify({'error': 'Kommentar ist erforderlich'}), 400

    conn = get_db()
    conn.execute('''
        INSERT INTO task_comments (task_id, task_type, user_email, user_name, comment)
        VALUES (?, ?, ?, ?, ?)
    ''', (task_id, task_type, user['email'], user.get('name'), data['comment']))
    comment_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'id': comment_id, 'message': 'Kommentar erstellt'})


@app.route('/api/comments/<int:comment_id>', methods=['DELETE'])
@require_auth
def delete_comment(comment_id, user):
    """Delete a comment (admin or author only)."""
    conn = get_db()
    comment = conn.execute('SELECT * FROM task_comments WHERE id = ?', (comment_id,)).fetchone()

    if not comment:
        conn.close()
        return jsonify({'error': 'Kommentar nicht gefunden'}), 404

    if comment['user_email'] != user['email'] and user.get('role') != 'admin':
        conn.close()
        return jsonify({'error': 'Keine Berechtigung'}), 403

    conn.execute('DELETE FROM task_comments WHERE id = ?', (comment_id,))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'message': 'Kommentar gelöscht'})


# ============ Garden Costs Routes ============

@app.route('/api/costs', methods=['GET'])
@require_auth
def get_costs(user):
    """Get all garden costs."""
    conn = get_db()
    costs = conn.execute('SELECT * FROM garden_costs ORDER BY is_active DESC, created_at DESC').fetchall()
    conn.close()
    return jsonify({'costs': [dict(c) for c in costs]})


@app.route('/api/costs', methods=['POST'])
@require_admin
def create_cost(user):
    """Admin: Create a garden cost entry."""
    data = request.json
    conn = get_db()
    conn.execute('''
        INSERT INTO garden_costs (title, description, amount, frequency, category, date, end_date, is_active, related_project_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (data['title'], data.get('description'), data['amount'],
          data.get('frequency', 'einmalig'), data.get('category'),
          data.get('date'), data.get('end_date'),
          data.get('is_active', 1), data.get('related_project_id'),
          user['email']))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/costs/<int:cost_id>', methods=['PATCH'])
@require_admin
def update_cost(cost_id, user):
    """Admin: Update a garden cost entry."""
    return generic_patch('garden_costs', cost_id, request.json,
        ['title', 'description', 'amount', 'frequency', 'category',
         'date', 'end_date', 'is_active', 'related_project_id'],
        timestamp_field=None)


@app.route('/api/costs/<int:cost_id>', methods=['DELETE'])
@require_admin
def delete_cost(cost_id, user):
    """Admin: Delete a garden cost entry."""
    conn = get_db()
    conn.execute('DELETE FROM garden_costs WHERE id = ?', (cost_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/costs/summary', methods=['GET'])
@require_auth
def costs_summary(user):
    """Get cost summary with monthly/yearly totals."""
    conn = get_db()
    costs = conn.execute('SELECT * FROM garden_costs WHERE is_active = 1').fetchall()
    conn.close()
    monthly = sum(c['amount'] for c in costs if c['frequency'] == 'monatlich')
    yearly = sum(c['amount'] for c in costs if c['frequency'] == 'jährlich')
    once = sum(c['amount'] for c in costs if c['frequency'] == 'einmalig')
    total_yearly = monthly * 12 + yearly + once
    return jsonify({
        'monthly': monthly,
        'yearly': yearly,
        'once': once,
        'total_yearly': total_yearly
    })


# ==================== Translation / i18n ====================

@app.route('/api/translate', methods=['POST'])
@limiter.limit("30/minute")
def translate_texts():
    """Translate texts using DeepL Free API with DB caching."""
    data = request.json
    if not data or not data.get('texts'):
        return jsonify({'error': 'texts array required'}), 400

    texts = data['texts']
    target_lang = data.get('target_lang', 'en')

    if not isinstance(texts, list) or len(texts) > 100:
        return jsonify({'error': 'texts must be an array with max 100 items'}), 400

    if target_lang not in ('en', 'de'):
        return jsonify({'error': 'target_lang must be "en" or "de"'}), 400

    # If target is German, return original texts (source language)
    if target_lang == 'de':
        return jsonify({'translations': {t: t for t in texts}})

    conn = get_db()
    result = {}
    missing = []

    # Check DB cache first
    for text in texts:
        cached = conn.execute(
            'SELECT translated_text FROM translations WHERE source_text = ? AND target_lang = ?',
            (text.strip(), target_lang)
        ).fetchone()
        if cached:
            result[text] = cached['translated_text']
        else:
            missing.append(text)

    # Call DeepL for cache misses
    if missing:
        deepl_key = os.environ.get('DEEPL_API_KEY')
        if deepl_key:
            try:
                import urllib.request
                import urllib.parse

                # DeepL Free API
                api_url = 'https://api-free.deepl.com/v2/translate'
                post_data = urllib.parse.urlencode({
                    'auth_key': deepl_key,
                    'target_lang': target_lang.upper(),
                    'source_lang': 'DE',
                }, doseq=False)

                # Add each text as separate 'text' parameter
                for t in missing:
                    post_data += '&' + urllib.parse.urlencode({'text': t.strip()})

                req = urllib.request.Request(api_url, data=post_data.encode('utf-8'))
                req.add_header('Content-Type', 'application/x-www-form-urlencoded')

                with urllib.request.urlopen(req, timeout=10) as resp:
                    deepl_result = json.loads(resp.read().decode('utf-8'))

                for i, translation in enumerate(deepl_result.get('translations', [])):
                    translated = translation['text']
                    original = missing[i]
                    result[original] = translated

                    # Cache in DB
                    conn.execute(
                        'INSERT OR REPLACE INTO translations (source_text, target_lang, translated_text, updated_at) VALUES (?, ?, ?, ?)',
                        (original.strip(), target_lang, translated, datetime.now().isoformat())
                    )
                conn.commit()

            except Exception as e:
                print(f"DeepL API error: {e}")
                # Fallback: return originals for missing
                for t in missing:
                    if t not in result:
                        result[t] = t
        else:
            # No API key: return originals
            for t in missing:
                result[t] = t

    conn.close()
    return jsonify({'translations': result})


@app.route('/api/milestones', methods=['GET'])
def get_milestones():
    """Get all milestones with aggregated task progress."""
    include_idea = request.args.get('include') == 'idea'
    conn = get_db()
    if include_idea:
        query = "SELECT * FROM milestones ORDER BY sort_order, id"
    else:
        query = "SELECT * FROM milestones WHERE status != 'idea' ORDER BY sort_order, id"
    rows = conn.execute(query).fetchall()
    result = []
    for row in rows:
        m = dict(row)
        counts = conn.execute('''
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done
            FROM projects WHERE milestone_id = ?
        ''', (m['id'],)).fetchone()
        m['total_count'] = counts['total'] or 0
        m['done_count'] = counts['done'] or 0
        result.append(m)
    conn.close()
    return jsonify({'milestones': result})


@app.route('/api/admin/milestones', methods=['POST'])
@require_admin
def create_milestone(user):
    """Admin: Create new milestone."""
    data = request.json or {}
    if not data.get('name'):
        return jsonify({'error': 'Name erforderlich'}), 400
    conn = get_db()
    conn.execute('''
        INSERT INTO milestones (name, description, target_date, status, image_path, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (
        data['name'],
        data.get('description'),
        data.get('target_date'),
        data.get('status', 'active'),
        data.get('image_path'),
        data.get('sort_order', 0)
    ))
    new_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'id': new_id})


@app.route('/api/admin/milestones/<int:milestone_id>', methods=['PATCH'])
@require_admin
def update_milestone(milestone_id, user):
    """Admin: Update milestone."""
    data = request.json or {}
    conn = get_db()
    allowed = ['name', 'description', 'target_date', 'status', 'image_path', 'sort_order']
    updates = []
    params = []
    for f in allowed:
        if f in data:
            updates.append(f'{f} = ?')
            params.append(data[f])
    if not updates:
        conn.close()
        return jsonify({'error': 'Keine Änderungen'}), 400
    params.append(milestone_id)
    conn.execute(f"UPDATE milestones SET {', '.join(updates)} WHERE id = ?", params)
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/admin/milestones/<int:milestone_id>', methods=['DELETE'])
@require_admin
def delete_milestone(milestone_id, user):
    """Admin: Delete milestone (unlinks projects)."""
    conn = get_db()
    conn.execute('UPDATE projects SET milestone_id = NULL WHERE milestone_id = ?', (milestone_id,))
    conn.execute('DELETE FROM milestones WHERE id = ?', (milestone_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/site-config/impressum', methods=['GET'])
def get_impressum_config():
    """Public: Get current impressum mode + text blocks."""
    conn = get_db()
    row = conn.execute("SELECT value FROM site_config WHERE key = 'impressum_mode'").fetchone()
    conn.close()
    mode = row['value'] if row else 'pre_lease'
    if mode == 'post_lease':
        content = {
            'mode': 'post_lease',
            'operator_name': 'Infinity Space – Moritz Voigt',
            'operator_note': 'Pächter des Grundstücks von Konny Voigt',
            'email': 'garten@infinityspace42.de',
            'notice': 'Betrieben durch Infinity Space auf Grundlage eines Pachtvertrags mit dem Grundstückseigentümer Konny Voigt.',
        }
    else:
        content = {
            'mode': 'pre_lease',
            'operator_name': 'Konny Voigt (Standort-Eigentümer)',
            'operator_note': 'Künftiger Betreiber/Pächter: Infinity Space – Moritz Voigt',
            'email': 'garten@infinityspace42.de',
            'notice': 'Hinweis: Der Pachtvertrag zwischen Konny Voigt (Eigentümer) und Infinity Space (künftiger Betreiber) ist in Vorbereitung. Der gewerbliche Launch als Refugium Naturgärten ist für den 01.05.2026 geplant.',
        }
    return jsonify(content)


@app.route('/api/translations/preload', methods=['GET'])
def get_preloaded_translations():
    """Get all cached translations for a target language."""
    target_lang = request.args.get('lang', 'en')
    conn = get_db()
    rows = conn.execute(
        'SELECT source_text, translated_text FROM translations WHERE target_lang = ?',
        (target_lang,)
    ).fetchall()
    conn.close()
    return jsonify({
        'translations': {r['source_text']: r['translated_text'] for r in rows},
        'lang': target_lang
    })


# ─── AI Assistant ─────────────────────────────────────────────

def _get_assistant_rate_limit():
    """Dynamic rate limit based on user role."""
    user = get_current_user()
    if user and user.get('role') == 'admin':
        return "100 per hour"
    elif user:
        return "30 per hour"
    return "10 per hour"


@app.route('/api/assistant/chat', methods=['POST'])
@limiter.limit(_get_assistant_rate_limit)
def assistant_chat():
    """AI assistant chat endpoint with role-based tools."""
    if not ASSISTANT_AVAILABLE:
        return jsonify({'error': 'Assistant nicht verfügbar'}), 503

    data = request.get_json()
    if not data or not data.get('message'):
        return jsonify({'error': 'Nachricht fehlt'}), 400

    message = data['message'].strip()[:2000]
    mode = data.get('mode')
    draft = data.get('draft')

    # Determine user role from JWT
    user = get_current_user()
    if user and user.get('role') == 'admin':
        user_role = 'admin'
    elif user:
        user_role = 'guest'
    else:
        user_role = 'anonymous'

    user_email = user.get('email') if user else None

    try:
        if mode == 'refine' and draft:
            result = refine_draft(message, draft)
            return jsonify({
                'intent': draft.get('type', 'feedback'),
                'answer': result['answer'],
                'draft': result['draft'],
            })
        else:
            # Get context from request (client sends previous messages)
            context = data.get('context', [])
            result = process_message(
                message,
                context_messages=context if context else None,
                user_role=user_role,
                user_email=user_email
            )

            # Log to agent_actions_log
            try:
                conn = get_db()
                conn.execute('''
                    INSERT INTO agent_actions_log (action_type, source, user_id, description, details, created_at)
                    VALUES ('chat', 'chat_widget', ?, ?, ?, ?)
                ''', (
                    user.get('id') if user else None,
                    f'Chat ({user_role}): {message[:100]}',
                    json.dumps({'role': user_role, 'intent': result.get('intent')}),
                    datetime.now().isoformat()
                ))
                conn.commit()
                conn.close()
            except Exception:
                pass

            return jsonify(result)

    except Exception as e:
        print(f"[assistant] Error: {e}")
        return jsonify({
            'intent': 'question',
            'answer': 'Entschuldigung, es gab einen technischen Fehler. Bitte versuche es erneut.'
        })


# ─── Agent API (COO + CLI-Agent) ─────────────────────────────

def require_agent_secret(f):
    """Decorator to require COO API secret."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        secret = request.headers.get('X-Agent-Secret', '')
        if not COO_API_SECRET or secret != COO_API_SECRET:
            return jsonify({'error': 'Ungültiger Agent-Secret'}), 401
        return f(*args, **kwargs)
    return decorated


@app.route('/api/agent/status', methods=['GET'])
def agent_status():
    """Agent health check."""
    return jsonify({
        'status': 'ok',
        'assistant_available': ASSISTANT_AVAILABLE,
        'email_draft_available': EMAIL_DRAFT_AVAILABLE,
        'coo_reporting_available': COO_REPORTING_AVAILABLE,
    })


@app.route('/api/agent/daily-report', methods=['GET'])
@require_agent_secret
def agent_daily_report():
    """COO fetches the daily report."""
    if not COO_REPORTING_AVAILABLE:
        return jsonify({'error': 'COO Reporting nicht verfügbar'}), 503

    generate_new = request.args.get('generate', 'false').lower() == 'true'
    if generate_new:
        report = generate_daily_report()
    else:
        report = get_latest_report()
        if not report:
            report = generate_daily_report()

    return jsonify(report)


@app.route('/api/agent/trigger', methods=['POST'])
@require_agent_secret
def agent_trigger():
    """COO sends an instruction to the agent."""
    data = request.get_json()
    if not data or not data.get('instruction'):
        return jsonify({'error': 'Instruction fehlt'}), 400

    conn = get_db()
    conn.execute('''
        INSERT INTO coo_instructions (instruction, priority, status, received_at)
        VALUES (?, ?, 'pending', ?)
    ''', (
        data['instruction'],
        data.get('priority', 'normal'),
        datetime.now().isoformat()
    ))
    conn.commit()
    instruction_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
    conn.close()

    return jsonify({'success': True, 'id': instruction_id})


@app.route('/api/agent/actions', methods=['GET'])
@require_admin
def agent_actions_log_endpoint(user=None):
    """Get recent agent actions (Admin only)."""
    limit = min(int(request.args.get('limit', 50)), 200)
    action_type = request.args.get('type')

    conn = get_db()
    if action_type:
        rows = conn.execute(
            'SELECT * FROM agent_actions_log WHERE action_type = ? ORDER BY created_at DESC LIMIT ?',
            (action_type, limit)
        ).fetchall()
    else:
        rows = conn.execute(
            'SELECT * FROM agent_actions_log ORDER BY created_at DESC LIMIT ?',
            (limit,)
        ).fetchall()
    conn.close()

    return jsonify({'actions': [dict(r) for r in rows]})


# ─── InfiniLoop API (IT-Task Automation) ─────────────────────

# Status mapping: Garten (deutsch) ↔ InfiniLoop (englisch)
INFINILOOP_STATUS_TO_GARTEN = {
    'in_progress': 'in_arbeit',
    'resolved': 'erledigt',
    'closed': 'cancelled',
    'open': 'offen',
}
GARTEN_STATUS_TO_INFINILOOP = {
    'offen': 'open',
    'in_arbeit': 'in_progress',
    'erledigt': 'resolved',
    'done': 'resolved',
    'cancelled': 'closed',
}


def require_infiniloop_key(f):
    """Decorator to require InfiniLoop API key."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        key = request.headers.get('X-API-Key', '')
        if not INFINILOOP_API_KEY or key != INFINILOOP_API_KEY:
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated


@app.route('/api/infiniloop/tasks', methods=['GET'])
@require_infiniloop_key
def infiniloop_list_tasks():
    """List open IT tasks for InfiniLoop agent."""
    conn = get_db()
    rows = conn.execute('''
        SELECT id, title, description, category, priority, status, created_at, due_date
        FROM projects
        WHERE category = 'it' AND status = 'offen'
        ORDER BY
            CASE priority WHEN 'kritisch' THEN 0 WHEN 'hoch' THEN 1 WHEN 'mittel' THEN 2 ELSE 3 END,
            created_at ASC
    ''').fetchall()
    conn.close()

    tasks = []
    for row in rows:
        r = dict(row)
        tasks.append({
            'id': str(r['id']),
            'title': r['title'],
            'description': r.get('description', ''),
            'category': 'it',
            'priority': r.get('priority', 'normal'),
            'status': GARTEN_STATUS_TO_INFINILOOP.get(r['status'], 'open'),
            'created_at': r.get('created_at', ''),
            'due_date': r.get('due_date', ''),
        })

    return jsonify({'data': tasks})


@app.route('/api/infiniloop/tasks/<int:task_id>', methods=['GET'])
@require_infiniloop_key
def infiniloop_get_task(task_id):
    """Get single IT task for InfiniLoop agent."""
    conn = get_db()
    row = conn.execute('''
        SELECT id, title, description, category, priority, status, created_at, due_date
        FROM projects WHERE id = ? AND category = 'it'
    ''', (task_id,)).fetchone()
    conn.close()

    if not row:
        return jsonify({'error': 'Task nicht gefunden'}), 404

    r = dict(row)
    return jsonify({
        'id': str(r['id']),
        'title': r['title'],
        'description': r.get('description', ''),
        'category': 'it',
        'priority': r.get('priority', 'normal'),
        'status': GARTEN_STATUS_TO_INFINILOOP.get(r['status'], 'open'),
        'created_at': r.get('created_at', ''),
        'due_date': r.get('due_date', ''),
    })


@app.route('/api/infiniloop/tasks/<int:task_id>/status', methods=['PATCH'])
@require_infiniloop_key
def infiniloop_update_task_status(task_id):
    """Update IT task status from InfiniLoop agent."""
    data = request.get_json()
    if not data or 'status' not in data:
        return jsonify({'error': 'Status fehlt'}), 400

    new_status_en = data['status']
    new_status_de = INFINILOOP_STATUS_TO_GARTEN.get(new_status_en)
    if not new_status_de:
        return jsonify({'error': f'Ungültiger Status: {new_status_en}'}), 400

    conn = get_db()
    # Verify task exists and is an IT task
    row = conn.execute('SELECT id, status FROM projects WHERE id = ? AND category = ?', (task_id, 'it')).fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'IT-Task nicht gefunden'}), 404

    conn.execute(
        'UPDATE projects SET status = ?, updated_at = ? WHERE id = ?',
        (new_status_de, datetime.now().isoformat(), task_id)
    )
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'status': new_status_en})


@app.route('/api/infiniloop/notify_reporter', methods=['POST'])
@require_infiniloop_key
def infiniloop_notify_reporter():
    """Phase 13: Magic-Link-Mail an Reporter, der nicht im Slack-Channel ist.

    InfiniLoop ruft diesen Endpoint, sobald eine Task fuer einen nicht im
    Channel anwesenden Reporter angelegt wird. Wir verschicken die Mail mit
    dem Rueckfrage-Link ueber unser eigenes Resend-Setup (eigenes Branding).
    """
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip()
    token_url = (data.get('token_url') or '').strip()
    task_title = (data.get('task_title') or '').strip()
    task_description = (data.get('task_description') or '').strip()

    if not email or '@' not in email:
        return jsonify({'error': 'email fehlt/ungueltig'}), 400
    if not token_url or not token_url.startswith(('http://', 'https://')):
        return jsonify({'error': 'token_url fehlt/ungueltig'}), 400

    try:
        from email_service import send_infiniloop_magic_link
        sent = send_infiniloop_magic_link(email, token_url, task_title, task_description)
    except Exception as e:
        app.logger.exception('infiniloop_notify_reporter failed: %s', e)
        return jsonify({'ok': False, 'error': 'send_failed'}), 500

    return jsonify({'ok': True, 'sent': sent})


# ─── Bug Report API (Auto-Error-Reporter → IT-Task) ──────────

BUGREPORTS_DIR = os.path.join(DATA_DIR, 'bugreports')


@app.route('/api/bugreport', methods=['POST'])
@limiter.limit("5 per 5 minutes")
def create_bugreport():
    """Auto-Error-Reporter Endpoint.

    Legt einen Task in projects (category='it') an, den der InfiniLoop-Agent
    automatisch abarbeitet. Kein Auth — Gäste/Nicht-eingeloggte User sollen
    melden können. Schutz: Rate-Limit (5/5min via flask-limiter) + Honeypot
    + Payload-Limits + Content-Type-Whitelist für Screenshot.
    """
    # Payload-Limit: 5 MB bei Multipart, 100 KB bei JSON
    if request.content_length:
        is_multipart = (request.content_type or '').startswith('multipart/')
        max_bytes = 5 * 1024 * 1024 if is_multipart else 100 * 1024
        if request.content_length > max_bytes:
            return jsonify({'error': 'Payload zu gross'}), 413

    # Accept both FormData (mit Screenshot) und JSON
    data = request.form if request.form else (request.get_json(silent=True) or {})

    # Honeypot — Bots füllen versteckte Felder aus
    if data.get('website'):
        return jsonify({'error': 'Invalid'}), 400

    title_suffix = (data.get('title') or 'Unbekannter Fehler').strip()[:120]
    description = (data.get('description') or '').strip()[:8000]
    page_url = (data.get('page_url') or '').strip()[:500]
    user_agent = (data.get('user_agent') or request.headers.get('User-Agent', ''))[:500]

    if len(description) < 10:
        return jsonify({'error': 'Beschreibung zu kurz'}), 400

    ip = request.headers.get('X-Forwarded-For', request.remote_addr or '0.0.0.0').split(',')[0].strip()

    # Optional: Screenshot-Upload
    screenshot_relpath = None
    screenshot = request.files.get('screenshot') if request.files else None
    if screenshot and screenshot.filename:
        if not (screenshot.mimetype or '').startswith('image/'):
            return jsonify({'error': 'Screenshot muss Bild sein'}), 400
        os.makedirs(BUGREPORTS_DIR, exist_ok=True)
        ext = (screenshot.mimetype or 'image/png').split('/')[-1].replace('jpeg', 'jpg')
        if ext not in ('png', 'jpg', 'gif', 'webp'):
            ext = 'png'
        fname = f"{uuid.uuid4()}.{ext}"
        screenshot.save(os.path.join(BUGREPORTS_DIR, fname))
        screenshot_relpath = f"/uploads/bugreports/{fname}"

    full_description = (
        f"**Gemeldet via Auto-Error-Reporter**\n\n"
        f"**URL:** {page_url}\n"
        f"**User-Agent:** {user_agent}\n"
        f"**IP:** {ip}\n\n"
        f"---\n\n"
        f"{description}"
    )
    if screenshot_relpath:
        full_description += f"\n\n**Screenshot:** {screenshot_relpath}"

    conn = get_db()
    conn.execute('''
        INSERT INTO projects (title, description, category, status, priority, created_by)
        VALUES (?, ?, 'it', 'offen', 'mittel', 'auto-error-reporter')
    ''', (f"Bug Meldung: {title_suffix}", full_description))
    project_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]

    # Junction-Table für category (konsistent mit create_project)
    cat_row = conn.execute("SELECT id FROM categories WHERE name = 'it'").fetchone()
    if cat_row:
        conn.execute(
            'INSERT OR IGNORE INTO project_categories (project_id, category_id) VALUES (?, ?)',
            (project_id, cat_row['id'])
        )
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'projectId': project_id}), 201


@app.route('/uploads/bugreports/<path:filename>', methods=['GET'])
@require_admin
def serve_bugreport_screenshot(filename, user=None):
    """Serve bug report screenshots (admin only, path-traversal safe)."""
    target_path = os.path.join(BUGREPORTS_DIR, filename)
    real_target = os.path.realpath(target_path)
    real_base = os.path.realpath(BUGREPORTS_DIR)
    if not (real_target == real_base or real_target.startswith(real_base + os.sep)):
        return jsonify({'error': 'Ungültiger Dateipfad'}), 400
    if not os.path.isfile(real_target):
        return jsonify({'error': 'Datei nicht gefunden'}), 404
    return send_file(real_target)


# ─── Email Drafts API ────────────────────────────────────────

@app.route('/api/admin/email-drafts', methods=['GET'])
@require_admin
def get_email_drafts(user=None):
    """Get email drafts (Admin only)."""
    if not EMAIL_DRAFT_AVAILABLE:
        return jsonify({'error': 'Email Draft Service nicht verfügbar'}), 503

    status = request.args.get('status')
    drafts = get_drafts(status)
    return jsonify({'drafts': drafts})


@app.route('/api/admin/email-drafts/<int:draft_id>', methods=['GET'])
@require_admin
def get_email_draft(draft_id, user=None):
    """Get a single email draft."""
    if not EMAIL_DRAFT_AVAILABLE:
        return jsonify({'error': 'Email Draft Service nicht verfügbar'}), 503

    draft_data = get_draft(draft_id)
    if not draft_data:
        return jsonify({'error': 'Draft nicht gefunden'}), 404
    return jsonify(draft_data)


@app.route('/api/admin/email-drafts/<int:draft_id>/approve', methods=['POST'])
@require_admin
def approve_email_draft(draft_id, user=None):
    """Approve and send an email draft."""
    if not EMAIL_DRAFT_AVAILABLE:
        return jsonify({'error': 'Email Draft Service nicht verfügbar'}), 503

    result = approve_draft(draft_id, approved_by=user.get('email', 'admin'))
    if result['success']:
        return jsonify(result)
    return jsonify(result), 400


@app.route('/api/admin/email-drafts/<int:draft_id>/reject', methods=['POST'])
@require_admin
def reject_email_draft(draft_id, user=None):
    """Reject an email draft."""
    if not EMAIL_DRAFT_AVAILABLE:
        return jsonify({'error': 'Email Draft Service nicht verfügbar'}), 503

    result = reject_draft(draft_id, rejected_by=user.get('email', 'admin'))
    return jsonify(result)


@app.route('/api/admin/email-drafts/<int:draft_id>', methods=['PATCH'])
@require_admin
def update_email_draft(draft_id, user=None):
    """Update a pending email draft."""
    if not EMAIL_DRAFT_AVAILABLE:
        return jsonify({'error': 'Email Draft Service nicht verfügbar'}), 503

    data = request.get_json()
    if not data:
        return jsonify({'error': 'Keine Daten'}), 400

    result = update_draft(draft_id, **data)
    if result['success']:
        return jsonify(result)
    return jsonify(result), 400


# Initialize database on startup
init_db()

if __name__ == '__main__':
    print("Voigt-Garten Backend starting...")
    print(f"Static dir: {STATIC_DIR}")
    print(f"Gallery dir: {GALLERY_DIR}")
    print(f"Database: {DB_PATH}")
    app.run(host='0.0.0.0', port=5055, debug=False)
