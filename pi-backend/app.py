"""
Voigt-Garten Backend
Flask API + Static File Serving for Hetzner Cloud deployment.
"""

from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
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
from collections import deque
from email_service import send_booking_confirmation, send_booking_notification_to_admin, send_activity_notification, send_magic_link_email, send_welcome_email
from telegram_service import send_moderation_request, answer_callback_query
from storage import LocalStorage

# JWT Secret Key (use env var in production)
JWT_SECRET = os.environ.get('JWT_SECRET', 'voigt-garten-secret-key-change-in-production-2026')
JWT_EXPIRY_HOURS = 24

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

# Paths (Docker environment)
DATA_DIR = os.environ.get('DATA_DIR', '/app/data')
STATIC_DIR = os.environ.get('STATIC_DIR', '/app/static')
GALLERY_DIR = os.environ.get('GALLERY_DIR', '/app/public/images/gallery')
DB_PATH = os.path.join(DATA_DIR, 'gallery.db')

# Ensure directories exist
os.makedirs(GALLERY_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

# Storage backend
storage = LocalStorage(GALLERY_DIR)

# Allowed file types
ALLOWED_IMAGE_EXTENSIONS = {'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'}
ALLOWED_VIDEO_EXTENSIONS = {'mp4', 'mov', 'webm', 'avi'}
ALLOWED_EXTENSIONS = ALLOWED_IMAGE_EXTENSIONS | ALLOWED_VIDEO_EXTENSIONS


def get_db():
    """Get database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


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
        admin_password_hash = generate_password_hash('Garten42PasswortFürMoritz')
        conn.execute('''
            INSERT INTO users (email, username, password_hash, name, role)
            VALUES (?, ?, ?, ?, ?)
        ''', ('moritzvoigt42@gmail.com', 'MoritzVoigt42', admin_password_hash, 'Moritz Voigt', 'admin'))
        conn.commit()
        print("Main admin user created: moritzvoigt42@gmail.com")

    # Create Konny Voigt admin if not exists
    cursor = conn.execute("SELECT id FROM users WHERE email = 'konny.voigt@web.de'")
    if not cursor.fetchone():
        konny_password_hash = generate_password_hash('darnok47')
        conn.execute('''
            INSERT INTO users (email, username, password_hash, name, role)
            VALUES (?, ?, ?, ?, ?)
        ''', ('konny.voigt@web.de', 'KonnyVoigt', konny_password_hash, 'Konny Voigt', 'admin'))
        conn.commit()
        print("Admin user created: konny.voigt@web.de")

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
            '1. Starlink Standard Kit bestellen (~300€ Hardware + 50€/Monat)\n'
            '2. Schüssel auf Dach/Mast montieren (Südausrichtung, freie Sicht)\n'
            '3. Stromversorgung sicherstellen (Solar-Erweiterung oder Steckdose im Haus)\n'
            '4. WLAN-Repeater aufstellen für Gartenabdeckung (z.B. TP-Link Outdoor)\n'
            '5. Starlink-Schüssel ausrichten (App-gesteuert, automatische Justierung)\n'
            '6. Überwachungskamera bestellen & anbringen (z.B. Reolink Solar-Cam)\n'
            '7. Kamera mit WLAN verbinden & App-Setup (Reolink/Tapo App)\n'
            '8. Fernsteuerung einrichten: Starlink-App + Kamera-App + ggf. Home Assistant\n\n'
            'Geschätzte Gesamtkosten:\n'
            '- Starlink Kit: ~300€\n'
            '- WLAN-Repeater Outdoor: ~50€\n'
            '- Solar-Kamera: ~100€\n'
            '- Montagematerial (Mast, Kabel, Kabelbinder): ~50€\n'
            '- Gesamt: ~500€ einmalig + 50€/Monat',
            'elektrik',
            'offen',
            'hoch',
            '~500€ einmalig + 50€/Monat',
            'schwer',
            '1-2 Wochenenden',
            'moritzvoigt42@gmail.com'
        ))
        conn.commit()
        print("Seeded Starlink project")

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

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_static(path):
    """Serve Astro static files."""
    # Default to index.html
    if not path:
        path = 'index.html'

    # Check if file exists
    static_path = os.path.join(STATIC_DIR, path)

    if os.path.isfile(static_path):
        return send_from_directory(STATIC_DIR, path)

    # Try with .html extension (Astro pages)
    if not path.endswith('.html') and os.path.isfile(static_path + '.html'):
        return send_from_directory(STATIC_DIR, path + '.html')

    # Check for index.html in directory
    index_path = os.path.join(static_path, 'index.html')
    if os.path.isdir(static_path) and os.path.isfile(index_path):
        return send_from_directory(os.path.join(STATIC_DIR, path), 'index.html')

    # Fallback to index.html for SPA routing
    return send_from_directory(STATIC_DIR, 'index.html')


@app.route('/images/gallery/<path:filename>')
def serve_gallery_image(filename):
    """Serve gallery images."""
    return send_from_directory(GALLERY_DIR, filename)


# ============ API Routes ============

@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({
        'status': 'ok',
        'service': 'voigt-garten-pi',
        'timestamp': datetime.now().isoformat()
    })


@app.route('/api/gallery', methods=['GET'])
def get_gallery():
    """Get all gallery images with proper URLs."""
    category = request.args.get('category')
    include_pending = request.args.get('include_pending', 'false') == 'true'
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

        # Main display URL - avoid double category prefix
        # Some filenames include category (e.g. "sonstiges/test.webp"), some don't (e.g. "abc123.jpg")
        if filename.startswith(f"{cat}/"):
            item['url'] = f"/images/gallery/{filename}"
        else:
            item['url'] = f"/images/gallery/{cat}/{filename}"

        # Thumbnail URL - same logic
        if item.get('thumbnail_path'):
            thumb = item['thumbnail_path']
            if thumb.startswith(f"{cat}/") or thumb.startswith('/'):
                item['thumbnailUrl'] = f"/images/gallery/{thumb}" if not thumb.startswith('/') else thumb
            else:
                item['thumbnailUrl'] = f"/images/gallery/{cat}/{thumb}"
        else:
            item['thumbnailUrl'] = item['url']  # Fallback to main image

        # Original URL (for download/fallback)
        if item.get('original_path'):
            orig_path = item['original_path']
            if orig_path.startswith('/images/gallery/'):
                item['originalUrl'] = orig_path
            elif orig_path.startswith(f"{cat}/"):
                item['originalUrl'] = f"/images/gallery/{orig_path}"
            else:
                item['originalUrl'] = f"/images/gallery/{cat}/{orig_path}"
        formatted_items.append(item)

    return jsonify({
        'items': formatted_items,
        'total': len(formatted_items)
    })


@app.route('/api/gallery/upload', methods=['POST'])
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

    # Get metadata
    category = request.form.get('category', 'sonstiges')
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
def delete_image(item_id):
    """Delete a gallery image and all associated files."""
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
def bookings():
    """Handle bookings."""
    conn = get_db()

    if request.method == 'POST':
        data = request.json
        conn.execute('''
            INSERT INTO bookings (guest_name, guest_email, guest_phone, check_in, check_out,
                                 guests, has_pets, total_price, discount_code, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            data['name'], data['email'], data.get('phone'),
            data['checkIn'], data['checkOut'], data.get('guests', 2),
            data.get('pets', False), data['totalPrice'],
            data.get('discountCode'), data.get('notes')
        ))
        booking_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
        conn.commit()
        conn.close()

        # Send emails
        send_booking_confirmation(data)
        send_booking_notification_to_admin(data)

        return jsonify({'success': True, 'bookingId': booking_id})

    # GET: Return booked dates for calendar
    bookings_list = conn.execute('''
        SELECT check_in, check_out FROM bookings
        WHERE status IN ('pending', 'confirmed')
    ''').fetchall()
    conn.close()

    return jsonify({
        'bookings': [{'checkIn': b['check_in'], 'checkOut': b['check_out']} for b in bookings_list]
    })


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

    if not user or not check_password_hash(user['password_hash'], password):
        return jsonify({'error': 'Ungültige Anmeldedaten'}), 401

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
            'role': user['role']
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

    return jsonify({
        'authenticated': True,
        'user': {
            'id': user['user_id'],
            'email': user['email'],
            'role': user['role']
        }
    })


@app.route('/api/auth/register', methods=['POST'])
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
        proj = dict(p)
        # Parse JSON fields stored as text
        for field in ('assigned_to_list', 'dependencies'):
            if proj.get(field) and isinstance(proj[field], str):
                try:
                    proj[field] = json.loads(proj[field])
                except (json.JSONDecodeError, TypeError):
                    proj[field] = []
            elif not proj.get(field):
                proj[field] = []
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

    if not data.get('title') or not data.get('category'):
        return jsonify({'error': 'Titel und Kategorie erforderlich'}), 400

    conn = get_db()
    conn.execute('''
        INSERT INTO projects (title, description, category, status, priority,
                             estimated_cost, effort, timeframe, created_by, map_area)
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
        user['email'],
        data.get('map_area')
    ))
    project_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
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
    conn.close()

    if not project:
        return jsonify({'error': 'Projekt nicht gefunden'}), 404

    proj = dict(project)
    for field in ('assigned_to_list', 'dependencies'):
        if proj.get(field) and isinstance(proj[field], str):
            try:
                proj[field] = json.loads(proj[field])
            except (json.JSONDecodeError, TypeError):
                proj[field] = []
        elif not proj.get(field):
            proj[field] = []

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
                      'parent_task_id', 'map_area']
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
    """Update booking status."""
    data = request.json

    conn = get_db()
    booking = conn.execute('SELECT * FROM bookings WHERE id = ?', (booking_id,)).fetchone()

    if not booking:
        conn.close()
        return jsonify({'error': 'Buchung nicht gefunden'}), 404

    status = data.get('status')
    if status and status in ['pending', 'confirmed', 'cancelled']:
        conn.execute('UPDATE bookings SET status = ? WHERE id = ?', (status, booking_id))
        conn.commit()

    conn.close()

    return jsonify({'success': True, 'message': 'Buchung aktualisiert'})


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


@app.route('/api/issues', methods=['POST'])
@require_auth
def create_issue(user):
    """Report a new issue/defect."""
    photo_path = None
    title = None
    description = None
    category = None

    # Handle multipart form data for photo upload
    if request.content_type and 'multipart/form-data' in request.content_type:
        title = request.form.get('title')
        description = request.form.get('description')
        category = request.form.get('category')

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

    if not title:
        return jsonify({'error': 'Titel erforderlich'}), 400

    conn = get_db()
    conn.execute('''
        INSERT INTO issue_reports (title, description, category, photo_filename, reported_by)
        VALUES (?, ?, ?, ?, ?)
    ''', (title, description, category, photo_path, user['email']))
    issue_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
    conn.commit()
    conn.close()

    # Send notification to admin
    send_activity_notification('issue_report', {
        'Titel': title,
        'Kategorie': category or 'Nicht angegeben',
        'Beschreibung': description or '-',
        'Gemeldet von': user.get('name') or user['email'],
        'Foto': 'Ja' if photo_path else 'Nein'
    })

    return jsonify({
        'success': True,
        'issueId': issue_id,
        'message': 'Mängelmeldung eingereicht. Ein Admin wird sich das ansehen.'
    })


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

    # Get recurring tasks
    if task_type in ['recurring', 'all']:
        query = 'SELECT * FROM recurring_tasks WHERE is_active = 1'
        params = []

        if category:
            query += ' AND category = ?'
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
            query += ' AND category = ?'
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
            if p.get('assigned_to_list'):
                try:
                    p['assigned_to_list'] = json.loads(p['assigned_to_list'])
                except (json.JSONDecodeError, TypeError):
                    p['assigned_to_list'] = []
            else:
                p['assigned_to_list'] = []

            if p.get('dependencies'):
                try:
                    p['dependencies'] = json.loads(p['dependencies'])
                except (json.JSONDecodeError, TypeError):
                    p['dependencies'] = []
            else:
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

    # Get unique values for filters
    categories = list(set(t.get('category') for t in tasks if t.get('category')))
    efforts = list(set(t.get('effort') for t in tasks if t.get('effort')))
    assignees_list = list(set(t.get('assigned_to') for t in tasks if t.get('assigned_to')))

    return jsonify({
        'tasks': tasks,
        'total': len(tasks),
        'filters': {
            'categories': sorted(categories),
            'efforts': ['leicht', 'mittel', 'schwer'],
            'assignees': sorted(assignees_list)
        }
    })


@app.route('/api/map/areas', methods=['GET'])
def get_map_areas():
    """Get aggregated data per map area for the garden map."""
    conn = get_db()
    today = datetime.now().date()
    areas = {}

    # Count open projects per area
    for row in conn.execute(
        "SELECT map_area, COUNT(*) as cnt FROM projects WHERE map_area IS NOT NULL AND status NOT IN ('erledigt', 'abgeschlossen') GROUP BY map_area"
    ).fetchall():
        area = row['map_area']
        if area not in areas:
            areas[area] = {'task_count': 0, 'status': 'ok', 'inventory_count': 0}
        areas[area]['task_count'] += row['cnt']

    # Count and check recurring tasks per area
    for row in conn.execute(
        "SELECT map_area, next_due FROM recurring_tasks WHERE map_area IS NOT NULL AND is_active = 1"
    ).fetchall():
        area = row['map_area']
        if area not in areas:
            areas[area] = {'task_count': 0, 'status': 'ok', 'inventory_count': 0}
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
            areas[area] = {'task_count': 0, 'status': 'ok', 'inventory_count': 0}
        areas[area]['inventory_count'] = row['cnt']

    conn.close()
    return jsonify({'areas': areas})


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

    dep_ids = []
    if project['dependencies']:
        try:
            dep_ids = json.loads(project['dependencies'])
        except (json.JSONDecodeError, TypeError):
            pass

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


# Initialize database on startup
init_db()

if __name__ == '__main__':
    print("Voigt-Garten Backend starting...")
    print(f"Static dir: {STATIC_DIR}")
    print(f"Gallery dir: {GALLERY_DIR}")
    print(f"Database: {DB_PATH}")
    app.run(host='0.0.0.0', port=5055, debug=False)
