#!/usr/bin/env python3
"""
Seed initial projects into the database.
Run this once after deploying to populate the projects table with the
original infrastructure tasks.
"""

import sqlite3
import os

DATA_DIR = os.environ.get('DATA_DIR', '/app/data')
DB_PATH = os.path.join(DATA_DIR, 'gallery.db')

# Initial projects from the original wartung.astro
INITIAL_PROJECTS = [
    # Wasser-Infrastruktur
    {
        'title': 'Hydrophoranlage erneuern (250l)',
        'description': 'Hydrophoranlage im Duschraum erneuern für frostsicheren Betrieb von Küche und Dusche. Klempnerarbeit erforderlich.',
        'category': 'wasser',
        'priority': 'hoch',
        'estimated_cost': '500-800€',
        'effort': 'Mittel',
        'timeframe': None,
    },
    {
        'title': 'Wasserverteilung im Keller überarbeiten',
        'description': 'Erneuerungsbedürftige Verteilung im Duschraum (Keller) neu machen.',
        'category': 'wasser',
        'priority': 'mittel',
        'estimated_cost': '300-500€',
        'effort': 'Mittel',
        'timeframe': None,
    },
    {
        'title': 'Automatische Bewässerung fertigstellen',
        'description': 'Vorinstallierte Bewässerung für Beete, Weinberg etc. funktioniert nur unzureichend. Behälter: 1000l Vroni-Schuppen, 1000l Carport, 1000l oberer Schuppen, 600l Konnys Schuppen.',
        'category': 'wasser',
        'priority': 'niedrig',
        'estimated_cost': '200-400€',
        'effort': 'Hoch',
        'timeframe': None,
    },

    # Elektrik-Projekte
    {
        'title': 'Erdung installieren',
        'description': 'WICHTIG: Anlage hat keine Erdung! Erdstab kann im Keller in die Grundplatte gebohrt werden.',
        'category': 'elektrik',
        'priority': 'kritisch',
        'estimated_cost': '100-200€',
        'effort': 'Niedrig',
        'timeframe': 'Sobald möglich',
    },
    {
        'title': 'Hausverkabelung auf 220V erneuern',
        'description': 'Aktuelle Kabel nicht 220V tauglich. Alle Kabel im Zwischenboden - mit alten kann man neue durchziehen. Eigenleistung: Moritz, Matti',
        'category': 'elektrik',
        'priority': 'hoch',
        'estimated_cost': '300-500€',
        'effort': 'Hoch',
        'timeframe': None,
    },
    {
        'title': 'Steckdosen installieren',
        'description': 'Zusätzliche Steckdosen im Haus installieren.',
        'category': 'elektrik',
        'priority': 'mittel',
        'estimated_cost': '100-200€',
        'effort': 'Mittel',
        'timeframe': None,
    },
    {
        'title': 'Balkonanlage mit Batterie kaufen',
        'description': 'Zwei 220V~ Anlagen betreiben: eine für Haus, eine für Gartengeräte.',
        'category': 'elektrik',
        'priority': 'mittel',
        'estimated_cost': '800-1500€',
        'effort': 'Mittel',
        'timeframe': None,
    },
    {
        'title': 'Elektriker für Planung & Abnahme',
        'description': 'Professionelle Planung und Abnahme der Elektroanlage.',
        'category': 'elektrik',
        'priority': 'hoch',
        'estimated_cost': '200-400€',
        'effort': 'Niedrig',
        'timeframe': None,
    },

    # Haus-Projekte
    {
        'title': 'Kühlschrank in Küche unterbringen',
        'description': 'Kühlschrank sollte in der Küche untergebracht werden.',
        'category': 'haus',
        'priority': 'niedrig',
        'estimated_cost': '0€',
        'effort': 'Niedrig',
        'timeframe': None,
    },
    {
        'title': 'Auszieh-Couch besorgen',
        'description': 'Für mehrere Übernachtungsgäste (max. 4 Personen).',
        'category': 'haus',
        'priority': 'niedrig',
        'estimated_cost': '300-600€',
        'effort': 'Niedrig',
        'timeframe': None,
    },
    {
        'title': 'Gasbetriebene Dusche reparieren',
        'description': 'Dusche im Kellerraum ist defekt, aber alle Teile sind vorhanden zur Neuinstallation.',
        'category': 'haus',
        'priority': 'mittel',
        'estimated_cost': '100-300€',
        'effort': 'Mittel',
        'timeframe': None,
    },

    # Garten-Projekte
    {
        'title': 'Teich fertigstellen',
        'description': 'Teich 10m², 80cm tief ist ausgehoben und bewässert, aber noch nicht fertiggestellt.',
        'category': 'garten',
        'priority': 'niedrig',
        'estimated_cost': '200-500€',
        'effort': 'Hoch',
        'timeframe': None,
    },
    {
        'title': 'Keller unter Schuppen abdichten',
        'description': 'Keller 8x3mx1,8m als Wasser-Reservoir geplant, muss noch abgedichtet werden. Potenzial für Sauna mit Schwimmbecken!',
        'category': 'garten',
        'priority': 'niedrig',
        'estimated_cost': '1000-2000€',
        'effort': 'Hoch',
        'timeframe': None,
    },
]


def seed_projects():
    """Insert initial projects if table is empty."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # Check if projects already exist
    existing = conn.execute('SELECT COUNT(*) as count FROM projects').fetchone()['count']

    if existing > 0:
        print(f"Projects table already has {existing} entries. Skipping seed.")
        conn.close()
        return

    print(f"Seeding {len(INITIAL_PROJECTS)} projects...")

    for project in INITIAL_PROJECTS:
        conn.execute('''
            INSERT INTO projects (title, description, category, status, priority, estimated_cost, effort, timeframe, created_by)
            VALUES (?, ?, ?, 'offen', ?, ?, ?, ?, 'system')
        ''', (
            project['title'],
            project['description'],
            project['category'],
            project['priority'],
            project['estimated_cost'],
            project['effort'],
            project['timeframe'],
        ))

    conn.commit()
    conn.close()
    print("Done! Projects seeded successfully.")


if __name__ == '__main__':
    seed_projects()
