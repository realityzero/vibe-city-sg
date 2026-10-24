#!/bin/zsh
# Runs every scripted mission play-test against the no-HMR test server (port 5174) and prints pass/fail.
cd "$(dirname "$0")/.."
for i in 1 2 3 4 5 6 7 8; do
  out=$(node tests/play.mjs "http://127.0.0.1:5174/?skipTitle&newgame&mission=$i&stats" tests/missions/m$i.json /tmp/reg_m$i 2>&1)
  done=$(echo "$out" | grep -o '"done":\[[^]]*\]\|"done":[0-9]*' | tail -1)
  errs=$(echo "$out" | grep -E '^errors:' | tail -1)
  echo "M$i  $done  $errs"
  echo "$out" | grep -E "pageerror|\[error\]" | head -3
done
