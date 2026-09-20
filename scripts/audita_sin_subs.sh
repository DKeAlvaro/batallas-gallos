#!/bin/bash
# Para los candidatos sin transcripcion: comprueba si es que no hay subtitulos
# o si el video esta caido. Salida: sin_subs.jsonl
cd ~/batallas
split -l 90 -d -a 2 logs/pending.txt logs/aud_ 2>/dev/null
: > sin_subs.jsonl
for f in logs/aud_*; do
  awk '{print "https://www.youtube.com/watch?v="$0}' "$f" > "$f.urls"
  yt-dlp --skip-download --ignore-no-formats-error --js-runtimes node --socket-timeout 15 \
    --extractor-args "youtube:player_client=ios" \
    --print "%(id)s|%(availability)s|%(subtitles.keys)s|%(automatic_captions.keys)s" \
    -a "$f.urls" >> sin_subs.jsonl 2>/dev/null
  rm -f "$f.urls"
done
echo "AUDITADO $(wc -l < sin_subs.jsonl)" >> logs/audita.log
