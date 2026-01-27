"""
Voigt-Garten - Kompletter Server
Serviert sowohl die statische Website als auch die API.
Läuft komplett auf dem Pi via Cloudflare Tunnel.
"""

from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
import os
import sqlite3
import subprocess
from datetime import datetime
from werkzeug.utils import secure_filename
import hashlib
from email_service import send_booking_confirmation, send_booking_notification_to_admin

app = Flask(__name__, static_folder='../dist', static_url_path='')
CORS(app)

# Paths
BASE_DIR = '/home/moritz/voigt-garten'
DIST_DIR = os.path.join(BASE_DIR, 'dist')
GALLERY_DIR = os.path.join(BASE_DIR, 'public/images/gallery')
DB_PATH = os.path.join(BASE_DIR, 'pi-backend/gallery.db')

# Ensure directories exist
os.makedirs(GALLERY_DIR, exist_ok=True)

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
            uploaded_by TEXT
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
    ''')
    conn.commit()
    conn.close()
    print("✅ Database initialized")


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def get_file_type(filename):
    ext = filename.rsplit('.', 1)[1].lower()
    return 'video' if ext in ALLOWED_VIDEO_EXTENSIONS else 'image'


# ============ Static File Serving ============

@app.route('/')
def serve_index():
    """Serve the main index page."""
    return send_from_directory(DIST_DIR, 'index.html')


@app.route('/<path:path>')
def serve_static(path):
    """Serve static files or pages."""
    # Check if it's a file with extension
    if '.' in path:
        # Try to serve from dist
        file_path = os.path.join(DIST_DIR, path)
        if os.path.exists(file_path):
            return send_from_directory(DIST_DIR, path)
        # Try to serve from public/images
        if path.startswith('images/'):
            public_path = os.path.join(BASE_DIR, 'public', path)
            if os.path.exists(public_path):
                return send_file(public_path)
    else:
        # It's a page route - serve the corresponding HTML
        html_path = os.path.join(DIST_DIR, path, 'index.html')
        if os.path.exists(html_path):
            return send_from_directory(os.path.join(DIST_DIR, path), 'index.html')
        # Try direct HTML file
        html_file = os.path.join(DIST_DIR, f'{path}.html')
        if os.path.exists(html_file):
            return send_from_directory(DIST_DIR, f'{path}.html')

    return "Not Found", 404


# ============ API Routes ============

@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'service': 'voigt-garten', 'mode': 'pi-hosted'})


@app.route('/api/gallery', methods=['GET'])
def get_gallery():
    category = request.args.get('category')
    conn = get_db()

    if category and category != 'all':
        items = conn.execute(
            'SELECT * FROM gallery_images WHERE category = ? ORDER BY uploaded_at DESC',
            (category,)
        ).fetchall()
    else:
        items = conn.execute(
            'SELECT * FROM gallery_images ORDER BY uploaded_at DESC'
        ).fetchall()
    conn.close()

    # Add full URL to items
    result = []
    for row in items:
        item = dict(row)
        item['url'] = f'/images/gallery/{item["filename"]}'
        item['thumbnailUrl'] = item['url']  # TODO: Generate thumbnails
        result.append(item)

    return jsonify({'items': result, 'total': len(result)})


@app.route('/api/gallery/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'Keine Datei'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Keine Datei ausgewählt'}), 400

    if not allowed_file(file.filename):
        return jsonify({'error': 'Dateityp nicht erlaubt'}), 400

    category = request.form.get('category', 'sonstiges')
    name = request.form.get('name', '')
    description = request.form.get('description', '')
    uploaded_by = request.form.get('uploaded_by', 'anonymous')

    original_name = secure_filename(file.filename)
    ext = original_name.rsplit('.', 1)[1].lower()
    file_id = hashlib.md5(f"{datetime.now().isoformat()}{original_name}".encode()).hexdigest()[:12]
    filename = f"{category}/{file_id}.{ext}"

    category_dir = os.path.join(GALLERY_DIR, category)
    os.makedirs(category_dir, exist_ok=True)

    filepath = os.path.join(GALLERY_DIR, filename)
    file.save(filepath)
    file_size = os.path.getsize(filepath)
    file_type = get_file_type(original_name)

    conn = get_db()
    conn.execute('''
        INSERT INTO gallery_images (id, filename, original_name, name, description, category, type, size, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (file_id, filename, original_name, name or None, description or None, category, file_type, file_size, uploaded_by))
    conn.commit()
    conn.close()

    print(f"✅ Uploaded: {filename} ({file_size} bytes)")

    return jsonify({
        'success': True,
        'id': file_id,
        'url': f'/images/gallery/{filename}',
        'message': 'Datei erfolgreich hochgeladen!'
    })


@app.route('/api/gallery/<item_id>', methods=['DELETE'])
def delete_image(item_id):
    conn = get_db()
    item = conn.execute('SELECT * FROM gallery_images WHERE id = ?', (item_id,)).fetchone()

    if not item:
        conn.close()
        return jsonify({'error': 'Bild nicht gefunden'}), 404

    filepath = os.path.join(GALLERY_DIR, item['filename'])
    if os.path.exists(filepath):
        os.remove(filepath)

    conn.execute('DELETE FROM gallery_images WHERE id = ?', (item_id,))
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'message': 'Bild gelöscht'})


@app.route('/api/bookings', methods=['GET', 'POST'])
def bookings():
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
        try:
            send_booking_confirmation(data)
            send_booking_notification_to_admin(data)
        except Exception as e:
            print(f"Email error: {e}")

        return jsonify({'success': True, 'bookingId': booking_id})

    # GET
    bookings_list = conn.execute('''
        SELECT check_in, check_out FROM bookings WHERE status IN ('pending', 'confirmed')
    ''').fetchall()
    conn.close()

    return jsonify({
        'bookings': [{'checkIn': b['check_in'], 'checkOut': b['check_out']} for b in bookings_list]
    })


@app.route('/api/credits', methods=['GET'])
def get_credits():
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
    data = request.json
    conn = get_db()
    conn.execute('''
        INSERT INTO maintenance_log (task_id, completed_by, notes, photo_filename)
        VALUES (?, ?, ?, ?)
    ''', (data['taskId'], data['completedBy'], data.get('notes'), data.get('photoFilename')))

    if data.get('creditValue', 0) > 0:
        conn.execute('''
            INSERT INTO credits (guest_email, amount, reason, type)
            VALUES (?, ?, ?, 'earned')
        ''', (data['completedBy'], data['creditValue'], data.get('taskTitle', 'Wartungsarbeit')))

    conn.commit()
    conn.close()

    return jsonify({'success': True})


if __name__ == '__main__':
    init_db()
    print("🌳 Voigt-Garten Server starting...")
    print(f"📁 Dist dir: {DIST_DIR}")
    print(f"📁 Gallery dir: {GALLERY_DIR}")
    print(f"🗃️ Database: {DB_PATH}")
    app.run(host='0.0.0.0', port=5050, debug=True)
