#!/bin/bash
# Observa ~/burp-evidence/inbox/ e renderiza automaticamente cada par
# *.request.txt / *.response.txt novo para ~/burp-evidence/out/*.png via shot.mjs.
# Nunca sobrescreve um PNG ja existente (presumido revisado).
set -u
HOME_DIR="$HOME/burp-evidence"
INBOX="$HOME_DIR/inbox"
OUT="$HOME_DIR/out"
FAILED="$HOME_DIR/.failed"
LOG="$HOME_DIR/watch.log"
LOCK="$HOME_DIR/.watcher.lock"
cd "$HOME_DIR" || exit 1
mkdir -p "$FAILED"

# Evita dois watchers concorrendo pelos mesmos arquivos.
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') ja existe watcher rodando (remova $LOCK se for engano)" >> "$LOG"
  exit 1
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

echo "$(date '+%Y-%m-%d %H:%M:%S') watcher iniciado (pid $$)" >> "$LOG"

while true; do
  shopt -s nullglob
  for req in "$INBOX"/*.request.txt; do
    base=$(basename "$req" .request.txt)
    resp="$INBOX/$base.response.txt"
    png="$OUT/$base.png"
    marker="$FAILED/$base"

    # Ja renderizado, ou ja falhou antes (apague o marcador em .failed/ para retentar).
    [ -e "$png" ] && continue
    [ -e "$marker" ] && continue
    # A extensao grava request e response separadamente; so processa o par completo.
    [ -f "$req" ] && [ -f "$resp" ] || continue

    if node shot.mjs --request "$req" --response "$resp" --out "$png" >> "$LOG" 2>&1; then
      echo "$(date '+%Y-%m-%d %H:%M:%S') OK   $base.png" >> "$LOG"
    else
      echo "$(date '+%Y-%m-%d %H:%M:%S') FAIL $base" >> "$LOG"
      touch "$marker"
    fi
  done

  # Log crescia sem limite; mantem as ultimas 1000 linhas.
  if [ "$(wc -l < "$LOG" 2>/dev/null || echo 0)" -gt 2000 ]; then
    tail -1000 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
  fi

  sleep 3
done
