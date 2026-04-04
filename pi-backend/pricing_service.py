"""
Pricing Service for Voigt-Garten
Calculates booking prices with seasonal rates, person discounts, and cancellation policies.
"""

import sqlite3
from datetime import date, datetime, timedelta
from typing import Optional


# Person discount factors (index = number of persons - 1)
PERSON_FACTORS = [1.0, 1.7, 2.25, 2.72, 3.1, 3.48]  # 1-6 persons


def get_db(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def get_season_rate(check_date: date, db_path: str) -> float:
    """Get nightly rate for a specific date based on pricing_rules."""
    conn = get_db(db_path)
    rules = conn.execute(
        'SELECT * FROM pricing_rules WHERE is_active = 1'
    ).fetchall()
    conn.close()

    month = check_date.month
    for rule in rules:
        start = rule['season_start_month']
        end = rule['season_end_month']
        # Handle wrap-around (e.g., Nov-Mar = 11-3)
        if start <= end:
            if start <= month <= end:
                return rule['nightly_rate']
        else:
            if month >= start or month <= end:
                return rule['nightly_rate']

    return 45.0  # Default fallback


def is_weekend_night(check_date: date) -> bool:
    """Check if a night (check_date to check_date+1) is a weekend night.
    Friday night (weekday=4) and Saturday night (weekday=5) count as weekend."""
    return check_date.weekday() in (4, 5)


def calculate_booking_price(
    check_in: str,
    check_out: str,
    guests: int,
    db_path: str,
    is_day_only: bool = False,
    is_first_year: bool = True,
    visit_count: int = 1,
) -> dict:
    """
    Calculate the total booking price with full breakdown.

    Returns dict with:
    - nights: number of nights
    - nightly_breakdown: list of {date, rate, is_weekend, surcharge}
    - base_total: sum of nightly rates
    - weekend_surcharge_total: total weekend surcharge
    - person_factor: multiplier for person count
    - person_total: base x person_factor
    - subtotal: before discounts
    - discounts: list of {name, percent, amount}
    - total: final price
    - per_night_avg: total / nights
    - per_person_per_night: total / nights / guests
    """
    ci = datetime.strptime(check_in, '%Y-%m-%d').date()
    co = datetime.strptime(check_out, '%Y-%m-%d').date()
    nights = (co - ci).days

    if nights <= 0:
        return {'error': 'Check-out muss nach Check-in liegen'}

    if guests < 1:
        return {'error': 'Mindestens 1 Person erforderlich'}

    if not is_day_only and guests > 6:
        return {'error': 'Maximal 6 Personen für Übernachtung (Tagesnutzung bis 20)'}

    if is_day_only and guests > 20:
        return {'error': 'Maximal 20 Personen für Tagesnutzung'}

    # Calculate per-night rates
    nightly_breakdown = []
    base_total = 0.0
    weekend_surcharge_total = 0.0
    weekend_nights = 0

    for i in range(nights):
        night_date = ci + timedelta(days=i)
        rate = get_season_rate(night_date, db_path)
        is_weekend = is_weekend_night(night_date)
        surcharge = 5.0 if is_weekend else 0.0

        if is_weekend:
            weekend_nights += 1

        nightly_breakdown.append({
            'date': night_date.isoformat(),
            'rate': rate,
            'is_weekend': is_weekend,
            'surcharge': surcharge,
        })

        base_total += rate
        weekend_surcharge_total += surcharge

    # Person factor
    if guests <= 6:
        person_factor = PERSON_FACTORS[guests - 1]
    else:
        # Day-use: flat rate calculation for groups
        person_factor = 3.48 + (guests - 6) * 0.3  # Diminishing returns

    person_total = (base_total + weekend_surcharge_total) * person_factor
    subtotal = person_total

    # Apply discounts
    discounts = []
    discount_total = 0.0

    # Week discount (10% for 7+ nights)
    if nights >= 7:
        week_discount = subtotal * 0.10
        discounts.append({
            'name': 'Wochenrabatt (7+ Nächte)',
            'percent': 10,
            'amount': round(week_discount, 2),
        })
        discount_total += week_discount

    # Repeat customer discount (15% from 3rd visit)
    if visit_count >= 3:
        repeat_discount = subtotal * 0.15
        discounts.append({
            'name': 'Stammkundenrabatt (ab 3. Besuch)',
            'percent': 15,
            'amount': round(repeat_discount, 2),
        })
        discount_total += repeat_discount

    # First year discount (42%)
    if is_first_year:
        first_year_amount = (subtotal - discount_total) * 0.42
        discounts.append({
            'name': 'Erstjahr-Rabatt',
            'percent': 42,
            'amount': round(first_year_amount, 2),
        })
        discount_total += first_year_amount

    total = round(subtotal - discount_total, 2)
    total = max(total, 0)  # Never negative

    return {
        'nights': nights,
        'weekend_nights': weekend_nights,
        'guests': guests,
        'nightly_breakdown': nightly_breakdown,
        'base_total': round(base_total, 2),
        'weekend_surcharge_total': round(weekend_surcharge_total, 2),
        'person_factor': round(person_factor, 2),
        'person_total': round(person_total, 2),
        'subtotal': round(subtotal, 2),
        'discounts': discounts,
        'discount_total': round(discount_total, 2),
        'total': total,
        'per_night_avg': round(total / nights, 2) if nights > 0 else 0,
        'per_person_per_night': round(total / nights / guests, 2) if nights > 0 and guests > 0 else 0,
    }


def calculate_cancellation_refund(
    booking_total: float,
    check_in: str,
    cancellation_date: Optional[str] = None,
    is_first_year: bool = True,
) -> dict:
    """
    Calculate cancellation refund based on days until check-in.

    Returns dict with:
    - days_until_checkin: int
    - policy: str description
    - refund_percent: float
    - refund_amount: float
    - retained_amount: float
    """
    ci = datetime.strptime(check_in, '%Y-%m-%d').date()
    cancel = datetime.strptime(cancellation_date, '%Y-%m-%d').date() if cancellation_date else date.today()

    days = (ci - cancel).days

    if is_first_year:
        # First year: generous cancellation
        if days >= 7:
            refund_pct = 100.0
            policy = 'Erstjahr: Kostenlose Stornierung (≥7 Tage)'
        else:
            refund_pct = 75.0
            policy = 'Erstjahr: 75% Erstattung (<7 Tage)'
    else:
        # Standard cancellation
        if days >= 30:
            refund_pct = 100.0
            policy = 'Kostenlose Stornierung (≥30 Tage)'
        elif days >= 14:
            refund_pct = 90.0
            policy = '90% Erstattung (14-29 Tage)'
        elif days >= 7:
            refund_pct = 25.0
            policy = '25% Erstattung (7-13 Tage)'
        else:
            refund_pct = 58.0
            policy = '58% Erstattung (<7 Tage, 42% Einbehalt)'

    refund = round(booking_total * refund_pct / 100, 2)
    retained = round(booking_total - refund, 2)

    return {
        'days_until_checkin': days,
        'policy': policy,
        'refund_percent': refund_pct,
        'refund_amount': refund,
        'retained_amount': retained,
    }


def get_availability(month: str, db_path: str) -> list:
    """
    Get booked dates for a given month (YYYY-MM format).
    Returns list of dates that are NOT available.
    """
    try:
        year, m = month.split('-')
        year, m = int(year), int(m)
    except (ValueError, AttributeError):
        return []

    # First and last day of month
    first_day = date(year, m, 1)
    if m == 12:
        last_day = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        last_day = date(year, m + 1, 1) - timedelta(days=1)

    conn = get_db(db_path)
    bookings = conn.execute('''
        SELECT check_in, check_out FROM bookings
        WHERE status IN ('pending', 'confirmed')
        AND check_out >= ? AND check_in <= ?
    ''', (first_day.isoformat(), last_day.isoformat())).fetchall()
    conn.close()

    booked_dates = set()
    for b in bookings:
        ci = datetime.strptime(b['check_in'], '%Y-%m-%d').date()
        co = datetime.strptime(b['check_out'], '%Y-%m-%d').date()
        current = max(ci, first_day)
        end = min(co, last_day + timedelta(days=1))
        while current < end:
            booked_dates.add(current.isoformat())
            current += timedelta(days=1)

    return sorted(booked_dates)


def validate_booking(
    check_in: str,
    check_out: str,
    guests: int,
    email: str,
    db_path: str,
    is_day_only: bool = False,
) -> Optional[str]:
    """
    Validate booking data. Returns error message or None if valid.
    """
    import re

    # Date validation
    try:
        ci = datetime.strptime(check_in, '%Y-%m-%d').date()
        co = datetime.strptime(check_out, '%Y-%m-%d').date()
    except (ValueError, TypeError):
        return 'Ungültiges Datumsformat (YYYY-MM-DD erwartet)'

    if co <= ci:
        return 'Abreise muss nach Anreise liegen'

    if ci < date.today():
        return 'Anreise kann nicht in der Vergangenheit liegen'

    # Guest validation
    if not is_day_only and guests > 6:
        return 'Maximal 6 Personen für Übernachtung'

    if is_day_only and guests > 20:
        return 'Maximal 20 Personen für Tagesnutzung'

    if guests < 1:
        return 'Mindestens 1 Person erforderlich'

    # Email validation
    if not re.match(r'^[^@]+@[^@]+\.[^@]+$', email):
        return 'Ungültige Email-Adresse'

    # Overlap check
    conn = get_db(db_path)
    overlap = conn.execute('''
        SELECT id, guest_name, check_in, check_out FROM bookings
        WHERE status IN ('pending', 'confirmed')
        AND check_in < ? AND check_out > ?
    ''', (check_out, check_in)).fetchone()
    conn.close()

    if overlap:
        return f'Zeitraum überschneidet sich mit bestehender Buchung ({overlap["check_in"]} bis {overlap["check_out"]})'

    return None
