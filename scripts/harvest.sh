#!/bin/bash
# Cosecha de subs: reanudable, con log
cd ~/batallas
mkdir -p subs logs
tail -n +1 canales/todos_ids.txt | while read id; do
  [ -z "$id" ] && continue
  # saltar si ya tenemos sub es
  ls subs/${id}.es*.vtt >/dev/null 2>&1 && continue
  yt-dlp --skip-download --write-subs --write-auto-subs --sub-langs "es.*,es" \
    --convert-subs vtt -o "subs/%(id)s" "https://www.youtube.com/watch?v=$id" >/dev/null 2>&1 \
    && echo "$id OK" >> logs/harvest.log || echo "$id FAIL" >> logs/harvest.log
done
echo "DONE $(date)" >> logs/harvest.log
