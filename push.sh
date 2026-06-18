#!/bin/sh
# push.sh — bump the app build number, commit everything, and push to GitHub.
# Each run increments the build by one, so the version shown in the sidebar
# (frontend/nav.jsx → APP_BUILD) goes up by one on every push.
#
# Usage:
#   ./push.sh                     # commit msg defaults to "chore: release v1.0.<n>"
#   ./push.sh "feat: add report"  # custom commit message
#
# The version bump is committed together with whatever else is staged/modified,
# then pushed to the current branch's "origin" remote.
set -e

cd "$(dirname "$0")"
NAV="frontend/nav.jsx"

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
msg="${1:-chore: release v1.0.$next}"

git add -A
git commit -m "$msg"
echo "push.sh: build $cur -> $next (v1.0.$next)"

git push -u origin "$branch"
echo "push.sh: pushed v1.0.$next to origin/$branch"
