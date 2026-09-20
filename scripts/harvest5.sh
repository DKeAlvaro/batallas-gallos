#!/bin/bash
cd ~/batallas
mkdir -p subs logs
fetch() {
  id="$1"
  ls subs/${id}.es*.vtt >/dev/null 2>&1 && return
  out=$(yt-dlp --skip-download --ignore-no-formats-error --write-subs --write-auto-subs \
      --sub-langs "es.*,es" --convert-subs vtt --js-runtimes node --socket-timeout 20 \
      --extractor-args "youtube:player_client=ios" --retries 3 --retry-sleep linear=2:3:8 \
      -o "subs/%(id)s" "https://www.youtube.com/watch?v=$id" 2>&1)
  if ls subs/${id}.es*.vtt >/dev/null 2>&1; then
    echo "$id OK" >> logs/harvest5.log
  else
    r=$(echo "$out" | grep -oE "^ERROR:.*" | tail -1 | cut -c1-110)
    echo "$id FAIL :: ${r:-nosubs}" >> logs/harvest5.log
  fi
}
export -f fetch
have=$(ls subs/ 2>/dev/null | sed 's/\..*//' | sort -u)
printf '%s\n' "$have" > logs/have.txt
list=$(grep -vE "^$" canales/todos_ids.txt | grep -vxFf logs/have.txt)
echo "PENDIENTES $(echo "$list" | wc -l) $(date)" >> logs/harvest5.log
echo "$list" | xargs -P 3 -I{} bash -c 'fetch "$@"; sleep 1' _ {}
echo "PASS-DONE $(date) :: OK=$(grep -c ' OK$' logs/harvest5.log)" >> logs/harvest5.log
