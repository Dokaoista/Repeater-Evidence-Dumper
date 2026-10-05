#!/bin/bash
# Watches ~/burp-evidence/inbox/ and automatically renders every new
# *.request.txt / *.response.txt pair to ~/burp-evidence/out/*.png via shot.mjs.
# Never overwrites an existing PNG (assumed already reviewed).
set -u
HOME_DIR="$HOME/burp-evidence"
INBOX="$HOME_DIR/inbox"
OUT="$HOME_DIR/out"
FAILED="$HOME_DIR/.failed"
LOG="$HOME_DIR/watch.log"
LOCK="$HOME_DIR/.watcher.lock"
cd "$HOME_DIR" || exit 1
mkdir -p "$FAILED"

# Stops two watchers from racing over the same files.
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') a watcher is already running (remove $LOCK if that is wrong)" >> "$LOG"
  exit 1
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

echo "$(date '+%Y-%m-%d %H:%M:%S') watcher started (pid $$)" >> "$LOG"

while true; do
  shopt -s nullglob
  for req in "$INBOX"/*.request.txt; do
    base=$(basename "$req" .request.txt)
    resp="$INBOX/$base.response.txt"
    png="$OUT/$base.png"
    marker="$FAILED/$base"

    # Already rendered, or already failed before (delete the marker in .failed/ to retry).
    [ -e "$png" ] && continue
    [ -e "$marker" ] && continue
    # The extension writes request and response separately; only process a complete pair.
    [ -f "$req" ] && [ -f "$resp" ] || continue

    if node shot.mjs --request "$req" --response "$resp" --out "$png" >> "$LOG" 2>&1; then
      echo "$(date '+%Y-%m-%d %H:%M:%S') OK   $base.png" >> "$LOG"
    else
      echo "$(date '+%Y-%m-%d %H:%M:%S') FAIL $base" >> "$LOG"
      touch "$marker"
    fi
  done

  # The log grew without bound; keep the last 1000 lines.
  if [ "$(wc -l < "$LOG" 2>/dev/null || echo 0)" -gt 2000 ]; then
    tail -1000 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
  fi

  sleep 3
done
