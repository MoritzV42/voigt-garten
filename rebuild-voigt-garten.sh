#!/bin/bash
# Rebuild Voigt-Garten Container (ASYNC)
# Usage: ssh is42 "bash ~/rebuild-voigt-garten.sh"
# Logs:  ssh is42 "tail -f /tmp/rebuild-voigt-garten.log"

LOGFILE="/tmp/rebuild-voigt-garten.log"
(
    echo "=== Rebuild gestartet: $(date) ===" > "$LOGFILE"
    cd ~/stacks/voigt-garten

    # WAL Checkpoint + DB Backup
    if docker ps | grep -q voigt-garten-app; then
        echo "DB WAL Checkpoint + Backup..." >> "$LOGFILE"
        docker exec voigt-garten-app python3 -c "
import sqlite3
conn = sqlite3.connect('/app/data/gallery.db', timeout=30)
conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
dst = sqlite3.connect('/app/data/gallery.db.pre-rebuild')
conn.backup(dst)
dst.close()
conn.close()
print('WAL checkpoint + backup done')
" >> "$LOGFILE" 2>&1
        sleep 1
    fi

    # Build
    docker compose up -d --build --force-recreate >> "$LOGFILE" 2>&1
    sleep 5

    # Health-Check
    if curl -sf http://localhost:5055/api/health > /dev/null 2>&1; then
        echo "voigt-garten-app laeuft!" >> "$LOGFILE"
    else
        echo "Health-Check fehlgeschlagen!" >> "$LOGFILE"
        docker logs voigt-garten-app --tail 30 >> "$LOGFILE" 2>&1
    fi

    echo "=== Rebuild beendet: $(date) ===" >> "$LOGFILE"
) &
disown
echo "Rebuild laeuft. Log: $LOGFILE"
