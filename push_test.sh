#!/bin/sh
# push_test.sh — send a server-initiated push (to verify Web Push works even
# when the PWA is fully closed) or list the registered subscriptions.
#
# Usage:
#   ./push_test.sh              # POST /api/push/test  (one generic test push)
#   ./push_test.sh credit       # POST /api/push/test-credit (preview latest statement reminder)
#   ./push_test.sh recurring    # POST /api/push/test-recurring (preview latest recurring reminder)
#   ./push_test.sh run-check    # POST /api/push/run-check (real due-date scan)
#   ./push_test.sh list         # list registered subscriptions (device + owner)
#
# Override defaults with env vars:
#   API=https://ledger.example.com EMAIL=me@x.com PASSWORD=secret ./push_test.sh
#   DB=./data/home-ledger.db ./push_test.sh list
set -eu

API="${API:-http://nas:8100}"
EMAIL="${EMAIL:-sadunsevingen@gmail.com}"
PASSWORD="${PASSWORD:-test1234}"
DB="${DB:-./data/home-ledger.db}"

CMD="${1:-test}"

# `list` reads the SQLite DB directly — there is no API endpoint that returns
# every subscription's user_agent. Must be run on the NAS host (DB on disk).
if [ "$CMD" = "list" ]; then
  if [ ! -f "$DB" ]; then
    echo "DB not found at '$DB' — run 'list' on the NAS host, or set DB=..." >&2
    exit 1
  fi
  python3 - "$DB" <<'PY'
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
rows = db.execute(
    "SELECT id, owner_id, endpoint, user_agent FROM push_subscriptions ORDER BY owner_id, id"
).fetchall()
print(f"{len(rows)} subscription(s):")
for sid, owner, endpoint, ua in rows:
    service = endpoint.split("/")[2] if "//" in endpoint else endpoint[:40]
    print(f"  id={sid}  owner={owner}  via {service}")
    print(f"    {ua or '(no user-agent)'}")
PY
  exit 0
fi

ENDPOINT="/api/push/test"
if [ "$CMD" = "run-check" ]; then
  ENDPOINT="/api/push/run-check"
elif [ "$CMD" = "credit" ]; then
  ENDPOINT="/api/push/test-credit"
elif [ "$CMD" = "recurring" ]; then
  ENDPOINT="/api/push/test-recurring"
fi

# Log in (OAuth2 password form) and extract the JWT.
TOKEN=$(curl -fsS -X POST "$API/api/auth/login" \
  -d "username=$EMAIL&password=$PASSWORD" \
  | python3 -c 'import sys, json; print(json.load(sys.stdin)["access_token"])')

if [ -z "$TOKEN" ]; then
  echo "Login failed: no access token returned from $API/api/auth/login" >&2
  exit 1
fi

echo "Sending push via POST $ENDPOINT ..."
curl -fsS -X POST "$API$ENDPOINT" -H "Authorization: Bearer $TOKEN"
echo
