"""
Invoice Service for Voigt-Garten
Generates PDF invoices with GiroCode QR codes for bank transfers.
"""

import os
import sqlite3
from datetime import datetime, date, timedelta
from io import BytesIO
from typing import Optional

try:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm, cm
    from reportlab.lib.colors import HexColor, black, white
    from reportlab.pdfgen import canvas
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph
    REPORTLAB_AVAILABLE = True
except ImportError:
    REPORTLAB_AVAILABLE = False
    print("Warning: reportlab not available, PDF generation disabled")

try:
    import segno
    SEGNO_AVAILABLE = True
except ImportError:
    SEGNO_AVAILABLE = False
    print("Warning: segno not available, QR code generation disabled")


def get_db(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def get_site_config(db_path: str) -> dict:
    """Get site configuration from database."""
    conn = get_db(db_path)
    try:
        rows = conn.execute('SELECT key, value FROM site_config').fetchall()
        config = {row['key']: row['value'] for row in rows}
    except Exception:
        config = {}
    conn.close()
    return config


def get_next_invoice_number(db_path: str) -> str:
    """Generate next sequential invoice number (YYYY-NNN)."""
    year = datetime.now().year
    conn = get_db(db_path)
    try:
        result = conn.execute(
            "SELECT invoice_number FROM invoices WHERE invoice_number LIKE ? ORDER BY id DESC LIMIT 1",
            (f"{year}-%",)
        ).fetchone()

        if result:
            last_num = int(result['invoice_number'].split('-')[1])
            next_num = last_num + 1
        else:
            next_num = 1
    except Exception:
        next_num = 1
    conn.close()

    return f"{year}-{next_num:03d}"


def generate_girocode_qr(
    iban: str,
    bic: str,
    recipient: str,
    amount: float,
    reference: str,
) -> Optional[BytesIO]:
    """Generate EPC/GiroCode QR code for bank transfer."""
    if not SEGNO_AVAILABLE:
        return None

    try:
        # EPC QR code format (version 002)
        epc_data = '\n'.join([
            'BCD',           # Service Tag
            '002',           # Version
            '1',             # Encoding (UTF-8)
            'SCT',           # Identification
            bic,             # BIC
            recipient,       # Recipient name (max 70 chars)
            iban,            # IBAN
            f'EUR{amount:.2f}',  # Amount
            '',              # Purpose
            reference[:140], # Reference (max 140 chars)
            '',              # Display text
        ])

        qr = segno.make(epc_data, error='m')
        buffer = BytesIO()
        qr.save(buffer, kind='png', scale=4, border=2)
        buffer.seek(0)
        return buffer
    except Exception as e:
        print(f"GiroCode QR generation failed: {e}")
        return None


def generate_invoice_pdf(
    db_path: str,
    invoice_id: int,
    output_dir: str,
) -> Optional[str]:
    """
    Generate a PDF invoice and save it to disk.
    Returns the file path relative to output_dir, or None on failure.
    """
    if not REPORTLAB_AVAILABLE:
        print("reportlab not available")
        return None

    conn = get_db(db_path)
    invoice = conn.execute('SELECT * FROM invoices WHERE id = ?', (invoice_id,)).fetchone()
    if not invoice:
        conn.close()
        return None

    config = get_site_config(db_path)
    conn.close()

    invoice = dict(invoice)

    # Parse line_items JSON
    import json
    try:
        line_items = json.loads(invoice.get('line_items', '[]'))
    except (json.JSONDecodeError, TypeError):
        line_items = []

    # Setup
    os.makedirs(output_dir, exist_ok=True)
    filename = f"rechnung-{invoice['invoice_number']}.pdf"
    filepath = os.path.join(output_dir, filename)

    # Create PDF
    c = canvas.Canvas(filepath, pagesize=A4)
    width, height = A4

    # Colors
    green = HexColor('#16a34a')
    dark = HexColor('#1f2937')
    gray = HexColor('#6b7280')
    light_green = HexColor('#f0fdf4')

    # --- Header ---
    # Company name
    c.setFont('Helvetica-Bold', 20)
    c.setFillColor(green)
    c.drawString(25*mm, height - 25*mm, config.get('company_name', 'Natur Refugium Etzdorf'))

    # Company address (right aligned)
    c.setFont('Helvetica', 9)
    c.setFillColor(gray)
    right_x = width - 25*mm
    y = height - 25*mm
    for line in [
        config.get('company_name', 'Natur Refugium Etzdorf'),
        config.get('address', 'Etzdorf im Rosental'),
        f"Tel: {config.get('phone', '')}",
        config.get('email', 'garten@infinityspace42.de'),
    ]:
        c.drawRightString(right_x, y, line)
        y -= 4*mm

    # Separator line
    c.setStrokeColor(green)
    c.setLineWidth(1)
    c.line(25*mm, height - 45*mm, width - 25*mm, height - 45*mm)

    # --- Recipient ---
    y = height - 55*mm
    c.setFont('Helvetica', 8)
    c.setFillColor(gray)
    c.drawString(25*mm, y, f"{config.get('company_name', '')} · {config.get('address', '')}")

    y -= 8*mm
    c.setFont('Helvetica', 11)
    c.setFillColor(dark)
    c.drawString(25*mm, y, invoice.get('guest_name', ''))
    y -= 5*mm
    if invoice.get('guest_address'):
        for line in invoice['guest_address'].split('\n'):
            c.drawString(25*mm, y, line)
            y -= 5*mm
    c.drawString(25*mm, y, invoice.get('guest_email', ''))

    # --- Invoice Details (right side) ---
    details_y = height - 63*mm
    c.setFont('Helvetica-Bold', 14)
    c.setFillColor(dark)
    c.drawRightString(right_x, details_y, f"Rechnung {invoice['invoice_number']}")

    details_y -= 8*mm
    c.setFont('Helvetica', 10)
    c.setFillColor(gray)

    created = invoice.get('created_at', '')[:10]
    due = invoice.get('due_date', '')[:10] if invoice.get('due_date') else ''

    c.drawRightString(right_x, details_y, f"Datum: {created}")
    details_y -= 5*mm
    if due:
        c.drawRightString(right_x, details_y, f"Zahlungsziel: {due}")

    # --- Line Items Table ---
    table_y = height - 105*mm

    # Table header
    c.setFillColor(light_green)
    c.rect(25*mm, table_y - 2*mm, width - 50*mm, 8*mm, fill=True, stroke=False)

    c.setFont('Helvetica-Bold', 9)
    c.setFillColor(dark)
    c.drawString(27*mm, table_y, 'Beschreibung')
    c.drawRightString(right_x - 30*mm, table_y, 'Anzahl')
    c.drawRightString(right_x - 10*mm, table_y, 'Einzelpreis')
    c.drawRightString(right_x, table_y, 'Gesamt')

    # Table rows
    table_y -= 10*mm
    c.setFont('Helvetica', 9)
    c.setFillColor(dark)

    for item in line_items:
        desc = item.get('description', '')
        qty = item.get('quantity', 1)
        unit_price = item.get('unit_price', 0)
        total = item.get('total', qty * unit_price)

        # Truncate long descriptions
        if len(desc) > 60:
            desc = desc[:57] + '...'

        c.drawString(27*mm, table_y, desc)
        c.drawRightString(right_x - 30*mm, table_y, str(qty))
        c.drawRightString(right_x - 10*mm, table_y, f"{unit_price:.2f} €")
        c.drawRightString(right_x, table_y, f"{total:.2f} €")
        table_y -= 6*mm

    # Separator
    table_y -= 2*mm
    c.setStrokeColor(gray)
    c.setLineWidth(0.5)
    c.line(width/2, table_y, right_x, table_y)
    table_y -= 6*mm

    # Subtotal
    c.setFont('Helvetica', 10)
    c.drawString(width/2, table_y, 'Zwischensumme:')
    c.drawRightString(right_x, table_y, f"{invoice['subtotal']:.2f} €")
    table_y -= 6*mm

    # Credits
    if invoice.get('credits_applied') and invoice['credits_applied'] > 0:
        c.setFillColor(green)
        c.drawString(width/2, table_y, 'Gutschrift (Erhaltungsleistungen):')
        c.drawRightString(right_x, table_y, f"-{invoice['credits_applied']:.2f} €")
        table_y -= 6*mm
        c.setFillColor(dark)

    # Total
    c.setFont('Helvetica-Bold', 12)
    c.setFillColor(dark)
    c.line(width/2, table_y + 2*mm, right_x, table_y + 2*mm)
    c.drawString(width/2, table_y - 4*mm, 'Gesamtbetrag:')
    c.drawRightString(right_x, table_y - 4*mm, f"{invoice['total']:.2f} €")
    table_y -= 12*mm

    # Tax note
    c.setFont('Helvetica-Oblique', 8)
    c.setFillColor(gray)
    c.drawString(25*mm, table_y, invoice.get('tax_note', 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.'))
    table_y -= 10*mm

    # --- Payment Info ---
    c.setFont('Helvetica-Bold', 10)
    c.setFillColor(dark)
    c.drawString(25*mm, table_y, 'Zahlungsinformationen')
    table_y -= 6*mm

    c.setFont('Helvetica', 9)
    payment_info = [
        ('Empfänger:', config.get('account_holder', '[PLACEHOLDER]')),
        ('IBAN:', config.get('iban', '[PLACEHOLDER]')),
        ('BIC:', config.get('bic', '[PLACEHOLDER]')),
        ('Verwendungszweck:', f"Rechnung {invoice['invoice_number']}"),
        ('Zahlungsziel:', f"{due} (14 Tage)" if due else '14 Tage nach Rechnungsdatum'),
    ]

    for label, value in payment_info:
        c.setFont('Helvetica-Bold', 9)
        c.drawString(27*mm, table_y, label)
        c.setFont('Helvetica', 9)
        c.drawString(55*mm, table_y, value)
        table_y -= 5*mm

    # --- GiroCode QR (bottom right) ---
    iban = config.get('iban', '')
    bic = config.get('bic', '')
    holder = config.get('account_holder', '')

    if iban and bic and holder and '[PLACEHOLDER]' not in iban:
        qr_buffer = generate_girocode_qr(
            iban=iban,
            bic=bic,
            recipient=holder,
            amount=invoice['total'],
            reference=f"Rechnung {invoice['invoice_number']}",
        )

        if qr_buffer:
            from reportlab.lib.utils import ImageReader
            qr_img = ImageReader(qr_buffer)
            qr_size = 30*mm
            c.drawImage(qr_img, right_x - qr_size, 25*mm, qr_size, qr_size)
            c.setFont('Helvetica', 7)
            c.setFillColor(gray)
            c.drawCentredString(right_x - qr_size/2, 22*mm, 'GiroCode scannen')

    # --- Footer ---
    c.setFont('Helvetica', 7)
    c.setFillColor(gray)
    footer_y = 15*mm
    c.drawString(25*mm, footer_y, f"{config.get('company_name', 'Natur Refugium Etzdorf')} · {config.get('address', '')}")
    c.drawString(25*mm, footer_y - 3.5*mm, f"E-Mail: {config.get('email', '')} · Tel: {config.get('phone', '')}")
    if config.get('tax_number') and '[PLACEHOLDER]' not in config.get('tax_number', ''):
        c.drawString(25*mm, footer_y - 7*mm, f"Steuernummer: {config.get('tax_number', '')}")

    c.save()

    # Update invoice with PDF path
    rel_path = f"invoices/{filename}"
    conn = get_db(db_path)
    conn.execute('UPDATE invoices SET pdf_path = ? WHERE id = ?', (rel_path, invoice_id))
    conn.commit()
    conn.close()

    print(f"Invoice PDF generated: {filepath}")
    return rel_path


def create_invoice_from_booking(
    db_path: str,
    booking_id: int,
    status: str = 'draft',
) -> Optional[int]:
    """
    Create an invoice record from a booking.
    Returns the invoice ID or None on failure.
    """
    import json

    conn = get_db(db_path)
    booking = conn.execute('SELECT * FROM bookings WHERE id = ?', (booking_id,)).fetchone()

    if not booking:
        conn.close()
        return None

    booking = dict(booking)

    # Check for existing credits
    credits_total = conn.execute(
        'SELECT COALESCE(SUM(amount), 0) as total FROM credits WHERE guest_email = ?',
        (booking['guest_email'],)
    ).fetchone()['total']

    # Generate invoice number
    invoice_number = get_next_invoice_number(db_path)

    # Build line items
    line_items = []

    # Main booking line
    nights = 0
    try:
        from datetime import datetime
        ci = datetime.strptime(booking['check_in'], '%Y-%m-%d')
        co = datetime.strptime(booking['check_out'], '%Y-%m-%d')
        nights = (co - ci).days
    except Exception:
        pass

    line_items.append({
        'description': f"Aufenthalt {booking['check_in']} bis {booking['check_out']} ({nights} Nächte, {booking.get('guests', 2)} Personen)",
        'quantity': 1,
        'unit_price': booking['total_price'],
        'total': booking['total_price'],
    })

    # Calculate totals
    subtotal = booking['total_price']
    credits_applied = min(credits_total, subtotal) if credits_total > 0 else 0
    total = subtotal - credits_applied

    # If credits exist, set status to draft (admin review needed)
    if credits_applied > 0:
        status = 'draft'

    # Due date: 14 days from now
    due_date = (datetime.now() + timedelta(days=14)).strftime('%Y-%m-%d')

    # Insert invoice
    conn.execute('''
        INSERT INTO invoices (booking_id, invoice_number, status, guest_name, guest_email,
            line_items, subtotal, credits_applied, total, due_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        booking_id, invoice_number, status,
        booking['guest_name'], booking['guest_email'],
        json.dumps(line_items), subtotal, credits_applied, total, due_date,
    ))
    invoice_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]

    # Link invoice to booking
    conn.execute('UPDATE bookings SET invoice_id = ? WHERE id = ?', (invoice_id, booking_id))
    conn.commit()
    conn.close()

    print(f"Invoice {invoice_number} created for booking {booking_id}")
    return invoice_id
