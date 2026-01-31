#!/bin/bash
set -e

echo "Starting Voigt-Garten Backend..."

# Initialize database first (creates tables if not exist)
echo "Initializing database..."
python -c "from app import init_db; init_db()"

# Run database seed (only inserts if projects table is empty)
echo "Checking for project seed..."
python seed_projects.py

# Start Gunicorn
echo "Starting Gunicorn..."
exec gunicorn --bind 0.0.0.0:5055 --workers 2 --timeout 120 app:app
