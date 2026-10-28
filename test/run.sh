#!/usr/bin/env bash
# The Pit's page, checked in real WebKit on the sample cooks. Read-only: nothing is sent, nothing is spent.
#   ./test/run.sh            every scenario at every size
#   ./test/run.sh now-brisket  one scenario
# One suite at a time on this Mac (headless runs heat it). The engine copy must equal the source.
set -u
cd "$(dirname "$0")/.."
LOCK="$PWD/test/.running"; mkdir -p test/shots
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then echo "A suite is already running (pid $(cat "$LOCK"))."; exit 2; fi
echo $$ > "$LOCK"; trap 'rm -f "$LOCK"; [ -n "${SRV:-}" ] && kill $SRV 2>/dev/null' EXIT INT TERM
if ! diff -q engine/pit-engine.js ../engine/pit-engine.js >/dev/null; then echo "engine/pit-engine.js differs from ../engine/pit-engine.js: copy it first"; exit 1; fi
echo "  engine copy: identical to the source"
python3 - <<'PY' || exit 1
import json, struct, os
m = json.load(open('manifest.webmanifest'))
for ic in m['icons']:
    p = ic['src']; assert os.path.exists(p), p
    w, h = struct.unpack('>II', open(p, 'rb').read()[16:24]); assert '%dx%d' % (w, h) == ic['sizes'], (p, w, h)
print('  manifest: %d icons at their declared sizes' % len(m['icons']))
PY
PORT=$((8700 + RANDOM % 200))
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 & SRV=$!
for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null "http://127.0.0.1:$PORT/index.html" && break; sleep 0.3; done
node test/check.js --base "http://127.0.0.1:$PORT/" ${1:+--only "$1"}
