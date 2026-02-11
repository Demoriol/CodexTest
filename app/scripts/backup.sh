#!/usr/bin/env bash
set -euo pipefail
DB_PATH="${DB_PATH:-/data/gaduly.db}"
BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
mkdir -p "$BACKUP_DIR"
if [ -f "$DB_PATH" ]; then
  cp "$DB_PATH" "$BACKUP_DIR/gaduly-$(date +%F-%H%M%S).db"
  find "$BACKUP_DIR" -type f -name 'gaduly-*.db' -mtime +30 -delete
  echo "Backup done: $BACKUP_DIR"
else
  echo "No DB found at $DB_PATH"
fi
