#!/bin/bash
# Cosecha final: lotes de 40 URLs por proceso, 3 en paralelo, cliente ios.
cd ~/batallas
mkdir -p subs logs
one() {
  f="$1"
  awk '{print "https://www.youtube.com/watch?v="$0}' "$f" > "$f.urls"
  yt-dlp --skip-download --ignore-no-formats-error --write-subs --write-auto-subs \
    --sub-langs "es.*" --convert-subs vtt --js-runtimes node --socket-timeout 20 \
    --retries 2 --extractor-args "youtube:player_client=ios" \
    -o "subs/%(id)s" -a "$f.urls" >/dev/null 2>&1
  rm -f "$f.urls"
}
export -f one
rm -rf logs/chunks7; mkdir -p logs/chunks7
split -l 40 -d -a 3 logs/pending.txt logs/chunks7/c
echo "INICIO $(date) pendientes $(wc -l < logs/pending.txt)" > logs/harvest7.log
ls logs/chunks7/c* | xargs -P 3 -I{} bash -c 'one "$@"; echo "hecho {}" >> logs/harvest7.log' _ {}
echo "FIN $(date) total $(ls subs/*.es.vtt | wc -l)" >> logs/harvest7.log
