#!/bin/bash
cd ~/batallas
mkdir -p subs logs
: > logs/blocked.txt
fetch() {
  id="$1"
  ls subs/${id}.es*.vtt >/dev/null 2>&1 && return
  err=$(yt-dlp --skip-download --ignore-no-formats-error --write-subs --write-auto-subs \
      --sub-langs "es.*,es" --convert-subs vtt --js-runtimes node --socket-timeout 20 \
      --extractor-args "youtube:player_client=ios" --retries 2 \
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
for r in 1 2 3; do
  if [ $r -eq 1 ]; then
    have=$(ls subs/ 2>/dev/null | sed 's/\..*//' | sort -u)
    list=$(grep -vE "^$" canales/todos_ids.txt | grep -vxF "$have")
  else
    [ -s logs/blocked.txt ] || break
    list=$(sort -u logs/blocked.txt); : > logs/blocked.txt
  fi
  [ -z "$list" ] && break
  echo "== ronda $r: $(echo "$list" | wc -l) videos" >> logs/harvest.log
  echo "$list" | xargs -P 4 -I{} bash -c 'fetch "$@"; sleep $((RANDOM % 2))' _ {}
  [ -s logs/blocked.txt ] || break
  sleep $((r * 60))
done
echo "DONE $(date)" >> logs/harvest.log
