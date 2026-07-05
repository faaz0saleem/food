#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="$ROOT_DIR/database/mindmesh.db"
SCHEMA_PATH="$ROOT_DIR/database/schema.sql"

if [[ ! -f "$SCHEMA_PATH" ]]; then
  echo "Schema file not found: $SCHEMA_PATH"
  exit 1
fi

sqlite3 "$DB_PATH" < "$SCHEMA_PATH"

echo "Database initialized at: $DB_PATH"
