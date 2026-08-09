#!/usr/bin/env bash
# Mints a fresh signed-in session for a test account, server-side — no
# browser, no devtools, no founder involvement. Uses the service-role key
# (worker/.env, same trust boundary as the DB URL) to generate a magic-link
# token via Supabase's Admin Auth API, then exchanges it for a real session
# the same way a browser would. Writes worker/test-session.json in the exact
# shape supabase-js persists to localStorage, ready to inject into a preview.
#
# Usage: worker/mint-test-session.sh [email]
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source worker/.env; set +a

EMAIL="${1:-galyn+claudetest@lichen.health}"
ANON_KEY="sb_publishable_pw5ENFOu9gJSXmULI3BW1A_hcUs-xO6"

LINK_RESP=$(curl -s -X POST "$SUPABASE_URL/auth/v1/admin/generate_link" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"magiclink\",\"email\":\"$EMAIL\"}")

HASHED_TOKEN=$(echo "$LINK_RESP" | jq -r '.hashed_token // empty')
if [ -z "$HASHED_TOKEN" ]; then
  echo "Failed to generate link:" >&2
  echo "$LINK_RESP" >&2
  exit 1
fi

SESSION=$(curl -s -X POST "$SUPABASE_URL/auth/v1/verify" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"magiclink\",\"token_hash\":\"$HASHED_TOKEN\"}")

ACCESS_TOKEN=$(echo "$SESSION" | jq -r '.access_token // empty')
if [ -z "$ACCESS_TOKEN" ]; then
  echo "Failed to verify token:" >&2
  echo "$SESSION" >&2
  exit 1
fi

echo "$SESSION" | jq '{
  access_token, token_type, expires_in,
  expires_at: ((now | floor) + .expires_in),
  refresh_token, user, weak_password: null
}' > worker/test-session.json

echo "Minted a fresh session for $EMAIL -> worker/test-session.json"
