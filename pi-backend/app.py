"""
Voigt-Garten Pi Backend
Flask API + Static File Serving for Pi-hosted deployment.
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
import functools
from email_service import send_booking_confirmation, send_booking_notification_to_admin

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

    conn.close()
    print("Database initialized")


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
def upload_file():
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
    uploaded_by = request.form.get('uploaded_by', 'anonymous')

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

    # Save to database
    conn = get_db()
    conn.execute('''
        INSERT INTO gallery_images (id, filename, original_name, name, description, category, type, size, uploaded_by, thumbnail_path, webp_path, original_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (file_id, display_filename, original_name, name or None, description or None, category, file_type, file_size, uploaded_by, thumbnail_path, webp_path, original_filename))
    conn.commit()
    conn.close()

    print(f"Uploaded: {display_filename} ({file_size} bytes)")

    return jsonify({
        'success': True,
        'id': file_id,
        'filename': display_filename,
        'url': f'/images/gallery/{display_filename}',
        'thumbnailUrl': f'/images/gallery/{thumbnail_path}' if thumbnail_path else None,
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
@require_admin
def register_user(user):
    """Register new user (admin only)."""
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

    return jsonify({
        'projects': [dict(p) for p in projects],
        'total': len(projects)
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
                             estimated_cost, effort, timeframe, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        data['title'],
        data.get('description'),
        data['category'],
        data.get('status', 'offen'),
        data.get('priority', 'mittel'),
        data.get('estimatedCost') or data.get('estimated_cost'),
        data.get('effort'),
        data.get('timeframe'),
        user['email']
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

    return jsonify({'project': dict(project)})


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

    # Build update query dynamically
    updates = []
    params = []
    allowed_fields = ['title', 'description', 'category', 'status', 'priority',
                      'estimated_cost', 'effort', 'timeframe', 'assigned_to']

    for field in allowed_fields:
        # Also check camelCase variants
        camel_field = ''.join(word.capitalize() if i > 0 else word for i, word in enumerate(field.split('_')))
        value = data.get(field) or data.get(camel_field)
        if value is not None:
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

    conn.execute('''
        UPDATE projects SET
            status = 'done',
            completed_at = ?,
            completed_by = ?,
            completion_photo = ?,
            completion_notes = ?,
            updated_at = ?
        WHERE id = ?
    ''', (
        datetime.now().isoformat(),
        user['email'],
        photo_path,
        notes,
        datetime.now().isoformat(),
        project_id
    ))
    conn.commit()
    conn.close()

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

    # Prevent demoting the main admin
    if target_user['email'] == 'moritzvoigt42@gmail.com' and data.get('role') != 'admin':
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


# Initialize database on startup
init_db()

if __name__ == '__main__':
    print("Voigt-Garten Pi Backend starting...")
    print(f"Static dir: {STATIC_DIR}")
    print(f"Gallery dir: {GALLERY_DIR}")
    print(f"Database: {DB_PATH}")
    app.run(host='0.0.0.0', port=5055, debug=False)
