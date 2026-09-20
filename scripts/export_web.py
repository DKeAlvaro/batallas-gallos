#!/usr/bin/env python3
"""Exporta el dataset a la estructura que consume la web:
  web/data/index.json          -> lista compacta (metadata)
  web/data/battles/<id>.json   -> transcripcion completa por batalla
  web/data/corpus.json.gz      -> corpus completo comprimido (dataset.jsonl.gz)
"""
import json, os, gzip, shutil, sys

ROOT = os.path.expanduser('~/batallas')
OUT = os.path.join(ROOT, 'web', 'data')
BDIR = os.path.join(OUT, 'battles')

def main():
    os.makedirs(BDIR, exist_ok=True)
    src = os.path.join(ROOT, 'dataset.jsonl')
    index, n = [], 0
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as ix:
        ix.write('[')
        first = True
        for line in open(src, encoding='utf-8'):
            d = json.loads(line)
            vid = d['video_id']
            json.dump(d, open(os.path.join(BDIR, vid + '.json'), 'w', encoding='utf-8'),
                      ensure_ascii=False, separators=(',', ':'))
            meta = {k: d[k] for k in ('video_id', 'url', 'title', 'mcs', 'round', 'event',
                                      'year', 'format', 'duration_s', 'n_lines', 'n_words')}
            # longitud total hablada (ultima linea - primera)
            ls = d['lines']
            meta['spoken_s'] = round(ls[-1]['end'] - ls[0]['start'], 1) if ls else 0
            meta['wpm'] = round(d['n_words'] / (meta['spoken_s'] / 60), 1) if meta['spoken_s'] else 0
            if not first:
                ix.write(',')
            json.dump(meta, ix, ensure_ascii=False, separators=(',', ':'))
            first = False
            index.append(meta)
            n += 1
        ix.write(']')
    # corpus completo comprimido
    with open(src, 'rb') as f, gzip.open(os.path.join(OUT, 'dataset.jsonl.gz'), 'wb', compresslevel=9) as g:
        shutil.copyfileobj(f, g)
    sz = lambda p: round(os.path.getsize(p) / 1e6, 2)
    print(f'{n} batallas')
    print(f'index.json      {sz(os.path.join(OUT,"index.json"))} MB')
    print(f'battles/        {sz(BDIR) if os.path.isdir(BDIR) else 0} MB ({len(os.listdir(BDIR))} ficheros)')
    print(f'dataset.jsonl.gz {sz(os.path.join(OUT,"dataset.jsonl.gz"))} MB')

if __name__ == '__main__':
    main()
