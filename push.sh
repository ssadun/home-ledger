#!/bin/sh
# push.sh — bump the app build number, commit + push to GitHub.
# Each run increments the build by one, so the version shown in the sidebar
# (frontend/nav.jsx → APP_BUILD) goes up by one on every push.
#
# Usage:
#   ./push.sh                        # msg defaults to "chore: release v1.0.<n>"
#   ./push.sh "feat: add report"     # custom commit message
#   ./push.sh --deploy               # also rebuild the frontend container
#   ./push.sh --deploy "fix: ..."    # custom message + rebuild
#
# The version bump is committed together with whatever else is staged/modified,
# then pushed to the current branch's "origin" remote.
#
# NOTE on --deploy: rebuilding is OPT-IN, not the default. The frontend is served
# live from disk by nginx / dev-server.py, so a rebuild is unnecessary for .jsx /
# .css / .html edits and CLAUDE.md explicitly says not to restart home-ledger-web
# during development. Pass --deploy only when nginx.conf or the Dockerfile changed.
#
# NOTE on sw.js: an earlier version of this script also bumped a CACHE_VERSION
# marker in frontend/sw.js. That is gone — sw.js now does NO caching at all (it
# caused a stale-asset bug; see its header comment), so there is no cache to bust.
set -e

cd "$(dirname "$0")"
NAV="frontend/nav.jsx"

# ── Parse args: an optional --deploy flag plus an optional commit message ──
deploy=0
msg=""
for arg in "$@"; do
  case "$arg" in
    --deploy) deploy=1 ;;
    --no-deploy) deploy=0 ;;   # accepted for backwards compatibility; now the default
    *) msg="$arg" ;;
  esac
done

if [ ! -f "$NAV" ]; then
  echo "push.sh: $NAV not found — run from the repo root." >&2
  exit 1
fi

# Read the current build number from the marked line: `const APP_BUILD = N; // build:auto`
cur=$(sed -n 's/.*const APP_BUILD = \([0-9]\{1,\}\);.*build:auto.*/\1/p' "$NAV")
if [ -z "$cur" ]; then
  echo "push.sh: could not find the APP_BUILD marker in $NAV." >&2
  exit 1
fi
next=$((cur + 1))

# Bump it in place.
sed -i "s/const APP_BUILD = [0-9]\{1,\}; \/\/ build:auto/const APP_BUILD = $next; \/\/ build:auto/" "$NAV"

branch=$(git rev-parse --abbrev-ref HEAD)
[ -n "$msg" ] || msg="chore: release v1.0.$next"

git add -A
git commit -m "$msg"
echo "push.sh: build $cur -> $next (v1.0.$next)"

git push -u origin "$branch"
echo "push.sh: pushed v1.0.$next to origin/$branch"

# ── Optional local redeploy (see the --deploy note above) ──
if [ "$deploy" -eq 1 ]; then
  if command -v docker-compose >/dev/null 2>&1; then
    echo "push.sh: rebuilding frontend container…"
    docker-compose up -d --build frontend
    echo "push.sh: frontend redeployed at v1.0.$next"
  else
    echo "push.sh: docker-compose not found — skipping local redeploy." >&2
  fi
fi
