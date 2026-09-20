#!/bin/bash
cd ~/batallas
mkdir -p subs logs
fetch() {
  id="$1"
  ls subs/${id}.es*.vtt >/dev/null 2>&1 && return
  if yt-dlp --skip-download --write-subs --write-auto-subs --sub-langs "es.*,es" \
      --convert-subs vtt --socket-timeout 15 -o "subs/%(id)s" \
      "https://www.youtube.com/watch?v=$id" >/dev/null 2>&1; then
    echo "$id OK" >> logs/harvest.log
  else
    echo "$id FAIL" >> logs/harvest.log
  fi
}
export -f fetch
cat canales/todos_ids.txt | xargs -P 6 -I{} bash -c 'fetch "$@"' _ {}
echo "DONE $(date)" >> logs/harvest.log
