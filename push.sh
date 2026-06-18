#!/bin/sh
# push.sh — bump the app build number, commit + push to GitHub, then redeploy
# the frontend container locally so the running app shows the new version.
# Each run increments the build by one, so the version shown in the sidebar
# (frontend/nav.jsx → APP_BUILD) goes up by one on every push.
#
# Usage:
#   ./push.sh                        # msg defaults to "chore: release v1.0.<n>", then redeploy
#   ./push.sh "feat: add report"     # custom commit message
#   ./push.sh --no-deploy            # push only, skip the local docker rebuild
#   ./push.sh --no-deploy "fix: ..." # custom message, skip redeploy
#
# The version bump is committed together with whatever else is staged/modified,
# then pushed to the current branch's "origin" remote.
set -e

cd "$(dirname "$0")"
NAV="frontend/nav.jsx"

# ── Parse args: an optional --no-deploy flag plus an optional commit message ──
deploy=1
msg=""
for arg in "$@"; do
  case "$arg" in
    --no-deploy) deploy=0 ;;
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

# Keep the service-worker cache version in sync so each release purges the old
# cache on activate — otherwise stale-while-revalidate serves the old assets and
# the new version only appears on a second reload.
SW="frontend/sw.js"
if [ -f "$SW" ]; then
  sed -i "s/const CACHE_VERSION = '[^']*'; \/\/ build:auto/const CACHE_VERSION = 'hl-v1.0.$next'; \/\/ build:auto/" "$SW"
fi

branch=$(git rev-parse --abbrev-ref HEAD)
[ -n "$msg" ] || msg="chore: release v1.0.$next"

git add -A
git commit -m "$msg"
echo "push.sh: build $cur -> $next (v1.0.$next)"

git push -u origin "$branch"
echo "push.sh: pushed v1.0.$next to origin/$branch"

# ── Redeploy the frontend locally so the running app reflects the new build ──
if [ "$deploy" -eq 1 ]; then
  if command -v docker-compose >/dev/null 2>&1; then
    echo "push.sh: rebuilding frontend container…"
    docker-compose up -d --build frontend
    echo "push.sh: frontend redeployed at v1.0.$next"
  else
    echo "push.sh: docker-compose not found — skipping local redeploy." >&2
  fi
else
  echo "push.sh: --no-deploy set, skipping local redeploy."
fi
