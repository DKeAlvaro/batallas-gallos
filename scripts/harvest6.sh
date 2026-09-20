#!/bin/bash
cd ~/batallas
one() {
  f="$1"
  awk '{print "https://www.youtube.com/watch?v="$0}' "$f" > "$f.urls"
  yt-dlp --skip-download --ignore-no-formats-error --write-subs --write-auto-subs \
    --sub-langs "es.*,es" --convert-subs vtt --js-runtimes node --socket-timeout 20 \
    --retries 2 --extractor-args "youtube:player_client=ios" \
    -o "subs/%(id)s" -a "$f.urls" >/dev/null 2>&1
  rm -f "$f.urls"
}
export -f one
ls logs/chunks/c* | xargs -P 3 -I{} bash -c 'one "$@"' _ {}
echo "CHUNKS-DONE $(date)" >> logs/harvest6.log
