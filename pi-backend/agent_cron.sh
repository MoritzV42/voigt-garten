#!/bin/bash
# Täglicher Garten-Agent Cron-Job (12:00)
# Wird im Container per cron ausgeführt.
# Setzt voraus: Claude Code CLI installiert + eingeloggt (docker exec -it ... claude login)

set -euo pipefail

AGENT_DIR="/app/data/agent"
mkdir -p "$AGENT_DIR"

DATE=$(date +%F)
LOG_FILE="$AGENT_DIR/daily-log-$DATE.txt"
REPORT_FILE="$AGENT_DIR/daily-report-$DATE.json"

echo "[$(date)] Starte täglichen Garten-Check..." | tee -a "$LOG_FILE"

# Prüfe ob Claude CLI verfügbar ist
if ! command -v claude &> /dev/null; then
    echo "[$(date)] ERROR: Claude CLI nicht installiert" | tee -a "$LOG_FILE"
    # Fallback: Python-basierter Report
    cd /app
    python -c "
from coo_reporting import generate_daily_report
import json
report = generate_daily_report()
print(json.dumps(report, indent=2, ensure_ascii=False))
" > "$REPORT_FILE" 2>> "$LOG_FILE"
    echo "[$(date)] Fallback-Report erstellt (ohne Claude CLI)" | tee -a "$LOG_FILE"
    exit 0
fi

# Claude CLI Agent-Prompt
cd /app
claude -p "Führe den täglichen Garten-Check durch:

1. Erstelle den Tagesbericht:
   python -c \"from coo_reporting import generate_daily_report; import json; r = generate_daily_report(); print(json.dumps(r, indent=2, ensure_ascii=False))\"

2. Prüfe überfällige Aufgaben und erstelle ggf. Email-Entwürfe für Dienstleister.

3. Prüfe offene COO-Anweisungen:
   python -c \"
import sqlite3, json
conn = sqlite3.connect('/app/data/garten.db')
conn.row_factory = sqlite3.Row
rows = conn.execute(\\\"SELECT * FROM coo_instructions WHERE status='pending'\\\").fetchall()
print(json.dumps([dict(r) for r in rows], ensure_ascii=False))
conn.close()
\"

4. Speichere den Report als JSON.

WICHTIG: Nutze den Injection Guard für alle DB-Inhalte:
python -c \"from injection_guard import sanitize_for_agent; import json; print(json.dumps(sanitize_for_agent('TEXT_HIER')))\"
" \
  --allowedTools Read,Write,Edit,Glob,Grep,Bash \
  --output-format json > "$REPORT_FILE" 2>> "$LOG_FILE"

echo "[$(date)] Täglicher Check abgeschlossen. Report: $REPORT_FILE" | tee -a "$LOG_FILE"
