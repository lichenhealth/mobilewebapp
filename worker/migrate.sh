#!/usr/bin/env bash
# Apply a migration directly (founder 2026-07-28: "run as many migrations as
# possible, directly"). Wrapped in a single transaction — ON_ERROR_STOP plus
# psql -1 means a failure rolls the whole file back, exactly like the SQL
# editor does. Never echoes the connection string.
#
#   ./worker/migrate.sh supabase/migrations/20260909120000_whatever.sql
#
# Needs SUPABASE_DB_URL in worker/.env (gitignored, same file as the service
# role key). Get it from: Supabase dashboard → Project Settings → Database →
# Connection string → URI (Session pooler).
set -euo pipefail
FILE="${1:?usage: migrate.sh <path-to-.sql>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PSQL="/opt/homebrew/opt/libpq/bin/psql"

set +u
# shellcheck disable=SC1090
source <(grep -E '^SUPABASE_DB_URL=' "$ROOT/worker/.env" 2>/dev/null || true)
set -u

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "SUPABASE_DB_URL is not set in worker/.env — falling back to the clipboard flow." >&2
  exit 2
fi

echo "→ applying $(basename "$FILE")"
"$PSQL" "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 -q -f "$FILE"
echo "✓ applied (single transaction; a failure would have rolled everything back)"
