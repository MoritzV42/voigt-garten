#!/bin/bash
# Setup script for Voigt-Garten Backend

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🌳 Setting up Voigt-Garten Backend..."

# Create virtual environment
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# Activate and install dependencies
echo "📦 Installing dependencies..."
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# Create gallery directories
echo "📁 Creating gallery directories..."
mkdir -p ../public/images/gallery/{haus,terrasse,luftaufnahmen,beete,wiese,baeume,sonstiges}

# Initialize database
echo "🗃️ Initializing database..."
python3 -c "from app import init_db; init_db()"

# Install systemd service
echo "⚙️ Installing systemd service..."
sudo cp voigt-garten.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable voigt-garten
sudo systemctl restart voigt-garten

# Check status
echo ""
echo "✅ Setup complete!"
echo ""
sudo systemctl status voigt-garten --no-pager

echo ""
echo "📡 Service running on http://localhost:5050"
echo "🔗 API Health: curl http://localhost:5050/api/health"
