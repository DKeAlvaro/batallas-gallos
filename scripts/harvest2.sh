#!/bin/bash
# Cosecha v2: rate-limitado, clasifica OK/NOSUBS/BLOCKED, reintenta bloqueados
cd ~/batallas
mkdir -p subs logs
: > logs/blocked.txt
fetch() {
  id="$1"
  ls subs/${id}.es*.vtt >/dev/null 2>&1 && return
  err=$(yt-dlp --skip-download --write-subs --write-auto-subs --sub-langs "es.*,es" \
      --convert-subs vtt --socket-timeout 20 --js-runtimes node --retries 1 \
      -o "subs/%(id)s" "https://www.youtube.com/watch?v=$id" 2>&1)
  if ls subs/${id}.es*.vtt >/dev/null 2>&1; then
    echo "$id OK" >> logs/harvest.log
  elif echo "$err" | grep -qE "429|not a bot|Sign in to confirm"; then
    echo "$id" >> logs/blocked.txt
  else
    echo "$id NOSUBS" >> logs/harvest.log
  fi
}
export -f fetch
# rondas con backoff: 4 intentos
for r in 1 2 3 4; do
  if [ $r -eq 1 ]; then
    list=$(grep -vE "^$" canales/todos_ids.txt | grep -vFf <(ls subs/ 2>/dev/null | sed 's/\..*//' | sort -u) 2>/dev/null || cat canales/todos_ids.txt)
  else
    list=$(sort -u logs/blocked.txt); : > logs/blocked.txt
  fi
  [ -z "$list" ] && break
  echo "== ronda $r ($(echo "$list" | wc -l) videos)" >> logs/harvest.log
  echo "$list" | xargs -P 2 -I{} bash -c 'fetch "$@"; sleep $((RANDOM % 3))' _ {}
  n=$(wc -l < logs/blocked.txt 2>/dev/null || echo 0)
  [ "$n" -eq 0 ] && break
  sleep $((r * 90))
done
echo "DONE $(date)" >> logs/harvest.log
