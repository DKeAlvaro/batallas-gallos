#!/usr/bin/env python3
"""Parseo de subs VTT (rolling auto-captions) + merge con metadata enriquecida.
Entrada: subs/*.es.vtt  y  meta/index.jsonl
Salida:  dataset/<vid>.json  y  dataset.jsonl (una linea por batalla)
"""
import json, re, os, glob, sys

# clases de calidad que no entran en el dataset (ver scripts/calidad.py)
MALAS = ('rota', 'bucle')

TS = re.compile(r'(\d{2}):(\d{2}):(\d{2})\.(\d{3})')
TAG = re.compile(r'<[^>]+>')

def ts2s(t):
    m = TS.search(t)
    return int(m.group(1))*3600 + int(m.group(2))*60 + int(m.group(3)) + int(m.group(4))/1000

def parse_vtt(path):
    raw = open(path, encoding='utf-8').read()
    blocks = re.split(r'\n\s*\n', raw)[1:]
    lines = []
    for b in blocks:
        ls = b.strip().split('\n')
        if not ls:
            continue
        i = 0 if '-->' in ls[0] else 1
        if i >= len(ls) or '-->' not in ls[i]:
            continue
        start = ts2s(ls[i].split('-->')[0])
        end = ts2s(ls[i].split('-->')[1]) if '-->' in ls[i] else start
        text = ' '.join(TAG.sub('', l).strip() for l in ls[i+1:]).strip()
        if text:
            lines.append((start, end, text))
    out, prev = [], []
    for start, end, text in lines:
        words = text.split()
        k = 0
        maxk = min(len(words), len(prev))
        for k in range(maxk, 0, -1):
            if prev[-k:] == words[:k]:
                break
        else:
            k = 0
        new = words[k:]
        if new:
            out.append({'start': round(start, 2), 'end': round(end, 2), 'text': ' '.join(new)})
            prev = words
    return out

def main():
    meta = {}
    for line in open('meta/index.jsonl', encoding='utf-8'):
        d = json.loads(line)
        meta[d['video_id']] = d
    # calidad medida con scripts/calidad.py: las mal transcritas se quedan fuera
    calidad = {}
    if os.path.exists('calidad.jsonl'):
        for line in open('calidad.jsonl', encoding='utf-8'):
            c = json.loads(line)
            calidad[c['video_id']] = c
    else:
        print('AVISO: no hay calidad.jsonl, no se filtra nada')
    files = sorted(glob.glob('subs/*.es.vtt')) or sorted(glob.glob('subs/*.es-orig.vtt'))
    os.makedirs('dataset', exist_ok=True)
    seen = set()
    n_lines = n_words = 0
    descartadas = []
    with open('dataset.jsonl', 'w', encoding='utf-8') as out, \
         open('descartadas.jsonl', 'w', encoding='utf-8') as des:
        for path in sorted(glob.glob('subs/*.vtt')):
            vid = os.path.basename(path).split('.')[0]
            if vid in seen:
                continue
            # preferir .es.vtt sobre .es-orig.vtt si ambos
            other = f'subs/{vid}.es.vtt'
            if path.endswith('.es-orig.vtt') and os.path.exists(other):
                continue
            seen.add(vid)
            c = calidad.get(vid)
            if c and c['clase'] in MALAS:
                descendida = dict(c)
                descendida['title'] = (meta.get(vid) or {}).get('raw_title')
                descartadas.append(descendida)
                continue
            lines = parse_vtt(path)
            if not lines:
                continue
            m = meta.get(vid, {})
            rec = {
                'video_id': vid,
                'url': m.get('url', f'https://youtu.be/{vid}'),
                'title': m.get('raw_title'),
                'duration_s': m.get('duration_s'),
                'mcs': m.get('mcs'),
                'round': m.get('round'),
                'event': m.get('event'),
                'year': m.get('year'),
                'format': m.get('format'),
                'source': 'youtube-autosub',
                'n_lines': len(lines),
                'n_words': sum(len(l['text'].split()) for l in lines),
                'lines': [l['text'] for l in lines],
            }
            json.dump(rec, open(f'dataset/{vid}.json', 'w', encoding='utf-8'),
                      ensure_ascii=False, indent=1)
            out.write(json.dumps(rec, ensure_ascii=False) + '\n')
            n_lines += rec['n_lines']
            n_words += rec['n_words']
        for d in descartadas:
            des.write(json.dumps(d, ensure_ascii=False) + '\n')
    print(f'{len(seen) - len(descartadas)} batallas, {n_lines} lineas, {n_words} palabras')
    print(f'descartadas por mala transcripcion: {len(descartadas)} -> descartadas.jsonl')

if __name__ == '__main__':
    main()
