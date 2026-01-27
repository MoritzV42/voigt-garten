"""
Voigt-Garten Pi Backend
Flask API + Static File Serving for Pi-hosted deployment.
"""

from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
import os
import sqlite3
from datetime import datetime
from werkzeug.utils import secure_filename
import hashlib
import subprocess
import re
from email_service import send_booking_confirmation, send_booking_notification_to_admin

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
    ''')
    conn.commit()
    conn.close()
    print("Database initialized")


def allowed_file(filename):
    """Check if file extension is allowed."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


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
        # Main display URL (WebP or original)
        item['url'] = f"/images/gallery/{item['filename']}"
        # Thumbnail URL
        if item.get('thumbnail_path'):
            item['thumbnailUrl'] = f"/images/gallery/{item['thumbnail_path']}"
        else:
            item['thumbnailUrl'] = item['url']  # Fallback to main image
        # Original URL (for download/fallback)
        if item.get('original_path'):
            item['originalUrl'] = f"/images/gallery/{item['original_path']}"
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
    base_name = slugify(name) if name else file_id
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
    item = conn.execute('SELECT * FROM gallery_images WHERE id = ?', (item_id,)).fetchone()

    if not item:
        conn.close()
        return jsonify({'error': 'Bild nicht gefunden'}), 404

    # Delete all associated files
    files_to_delete = [
        item['filename'],
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


# Initialize database on startup
init_db()

if __name__ == '__main__':
    print("Voigt-Garten Pi Backend starting...")
    print(f"Static dir: {STATIC_DIR}")
    print(f"Gallery dir: {GALLERY_DIR}")
    print(f"Database: {DB_PATH}")
    app.run(host='0.0.0.0', port=5055, debug=False)
