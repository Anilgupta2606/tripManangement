#!/bin/sh
# Publish Trip Vault: copy the app into the Money Home site (Anilgupta2606.github.io), which GitHub Pages
# already serves, so it is live at https://anilgupta2606.github.io/tripManangement/ - no Pages setup needed.
# Run from anywhere: ./deploy.sh   (tests run first; nothing is published if one fails)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
SITE="${SITE:-$HERE/../Anilgupta2606.github.io}"
DEST="$SITE/tripManangement"

cd "$HERE"
node --test test/*.test.js >/dev/null || { echo "Tests failed - not publishing."; exit 1; }
[ -d "$SITE/.git" ] || { echo "Money Home repo not found at $SITE"; exit 1; }

mkdir -p "$DEST/data"
# the app only: no tests, no README (the site would render it as a page)
for f in index.html style.css parse.js rules.js cloud.js services.js core.js docs.js plan.js checklist.js live.js shopping.js sw.js manifest.webmanifest icon.svg icon-192.png icon-512.png; do
  cp "$f" "$DEST/$f"
done
cp data/airports.json data/airlines.json "$DEST/data/"

# each publish stamps the app's files with its version, so browsers load the new ones at once (not a cached copy)
REV0="$(git rev-parse --short HEAD)"
sed -i '' -E "s#(src|href)=\"((/ai/)?[a-z]+\.(js|css))\"#\1=\"\2?v=$REV0\"#g" "$DEST/index.html"

REV="$(git rev-parse --short HEAD)"
cd "$SITE"
git add tripManangement
if git diff --cached --quiet; then echo "Already published ($REV)."; exit 0; fi
git commit -q -m "Trip Vault $REV (published from the tripManangement repo)"
git push -q
echo "Published Trip Vault $REV - live in a minute at https://anilgupta2606.github.io/tripManangement/"
