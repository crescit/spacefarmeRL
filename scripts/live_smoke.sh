#!/usr/bin/env bash
# Live boot smoke: start the game server + muted headless Chrome, drive the
# full intro→ship→planet playtest (client/_qa/playtest_full.mjs), tear down.
# Catches runtime crashes static gates miss (undefined names, unregistered
# theme roles) — both of which shipped green through test:offline once.
set -u
cd "$(dirname "$0")/.."
PORT=8900; CDP=9333
PROFILE="$(mktemp -d "${TMPDIR:-/tmp}/sf-live-smoke.XXXXXX")"
LOG="${LIVE_SMOKE_LOG:-${TMPDIR:-/tmp}/sf_live_smoke.log}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
srv=""; chr=""
cleanup() {
  [ -n "$chr" ] && kill "$chr" 2>/dev/null
  [ -n "$srv" ] && kill "$srv" 2>/dev/null
  sleep 1; rm -rf "$PROFILE"
}
trap cleanup EXIT INT TERM

if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "live_smoke: port $PORT busy — reusing the running server"
else
  PORT=$PORT node server.js > "${TMPDIR:-/tmp}/sf_live_server.log" 2>&1 & srv=$!
fi
if lsof -nP -iTCP:$CDP -sTCP:LISTEN >/dev/null 2>&1; then
  echo "live_smoke: CDP $CDP busy — reusing the running Chrome"
else
  "$CHROME" --user-data-dir="$PROFILE" --remote-debugging-port=$CDP --headless=new --mute-audio \
    --window-size=1280,760 --no-sandbox --no-first-run --use-angle=swiftshader --enable-unsafe-swiftshader \
    >/dev/null 2>&1 & chr=$!
fi
for _ in $(seq 1 30); do
  curl -sf "http://127.0.0.1:$PORT/" >/dev/null && curl -sf "http://127.0.0.1:$CDP/json/version" >/dev/null && break
  sleep 1
done
node client/_qa/playtest_full.mjs > "$LOG" 2>&1; rc=$?
grep -E "^FAIL|PLAYTEST" "$LOG" | cut -c1-600
exit $rc
