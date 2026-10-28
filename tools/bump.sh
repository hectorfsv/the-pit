#!/usr/bin/env bash
# Stamp the page's own files with a new version (?v=…) so a phone that refreshes index.html also refetches the scripts
# and the stylesheet. Run before every commit that changes them:  ./tools/bump.sh
cd "$(dirname "$0")/.."
S=$(date +%Y%m%d%H%M)
sed -E -i '' "s/(\.(css|js))\?v=[0-9a-z]*\"/\1?v=$S\"/g" index.html
sed -E -i '' "s/const APP_VERSION = '[^']*'/const APP_VERSION = '$S'/" pit-core.js
echo "stamped $S: $(grep -c "?v=$S" index.html) files in index.html"
