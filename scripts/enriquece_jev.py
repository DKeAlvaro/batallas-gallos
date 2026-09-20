#!/usr/bin/env python3
"""Enriquece dataset.jsonl con las etiquetas de Jev (etiquetas.jsonl) y
regenera el export web (battles/*.json + index.js) con las anotaciones integradas.

Para cada batalla añade "bloques": lista de {texto, i0, i1, palabras, rapeo, ruido,
pct_rapeo, calidad, rima, conf_rima, punch}, donde i0:i1 son los índices de las
líneas originales que cubre el bloque (para poder subrayar en el visor).
"""
import json, os, gzip, shutil

ROOT = os.path.expanduser('~/batallas-gallos')
OUT = os.path.join(ROOT, 'docs', 'data')
BDIR = os.path.join(OUT, 'battles')
WORDS_PER_BLOCK = 150


def bloques_indices(lines, target=WORDS_PER_BLOCK):
    """Devuelve [(i0, i1)] con los rangos de líneas de cada bloque."""
    out, start, n = [], 0, 0
    for i, l in enumerate(lines):
        n += len(l.split())
        if n >= target:
            out.append((start, i + 1)); start, n = i + 1, 0
    if start < len(lines):
        out.append((start, len(lines)))
    return out


def main():
    et = {}
    for line in open(os.path.join(ROOT, 'etiquetas.jsonl'), encoding='utf-8'):
        d = json.loads(line)
        et[d['video_id']] = d['bloques']

    battles = []
    for line in open(os.path.join(ROOT, 'dataset.jsonl'), encoding='utf-8'):
        d = json.loads(line)
        tags = et.get(d['video_id'])
        if tags:
            rangos = bloques_indices(d['lines'])
            bloques = []
            for (i0, i1), t in zip(rangos, tags):
                texto = ' '.join(d['lines'][i0:i1])
                bloques.append({
                    'i0': i0, 'i1': i1, 'texto': texto,
                    **{k: t[k] for k in ('palabras', 'rapeo', 'ruido', 'pct_rapeo',
                                          'calidad', 'rima', 'conf_rima', 'punch')},
                })
            d['bloques'] = bloques
        battles.append(d)

    # dataset.jsonl enriquecido
    with open(os.path.join(ROOT, 'dataset_enriquecido.jsonl'), 'w', encoding='utf-8') as f:
        for d in battles:
            f.write(json.dumps(d, ensure_ascii=False) + '\n')

    # export web
    os.makedirs(BDIR, exist_ok=True)
    for viejo in os.listdir(BDIR):
        os.remove(os.path.join(BDIR, viejo))
    index = []
    for d in battles:
        vid = d['video_id']
        json.dump(d, open(os.path.join(BDIR, vid + '.json'), 'w', encoding='utf-8'),
                  ensure_ascii=False, separators=(',', ':'))
        bloques_meta = d.get('bloques')
        meta = {k: d[k] for k in ('video_id', 'url', 'title', 'mcs', 'round', 'event',
                                  'year', 'format', 'duration_s', 'n_lines', 'n_words')}
        if bloques_meta:
            # resumen de calidad para la lista
            utiles = [b for b in bloques_meta if b['ruido'] < 0.7]
            meta['jev'] = {
                'n_bloques': len(bloques_meta),
                'pct_ruido': round(100 * (1 - len(utiles) / len(bloques_meta))),
                'n_corruptos': sum(1 for b in bloques_meta if b['calidad'] == 'corrupta'),
                'rima': round(sum(b['rima'] for b in utiles) / max(len(utiles), 1), 2),
                'punch': round(sum(b['punch'] for b in utiles) / max(len(utiles), 1), 2),
            }
        index.append(meta)
    with open(os.path.join(OUT, 'index.js'), 'w', encoding='utf-8') as jx:
        jx.write('window.CORPUS=')
        json.dump(index, jx, ensure_ascii=False, separators=(',', ':'))
        jx.write(';\n')
    with open(os.path.join(ROOT, 'dataset.jsonl'), 'rb') as f, \
         gzip.open(os.path.join(OUT, 'dataset.jsonl.gz'), 'wb', compresslevel=9) as g:
        shutil.copyfileobj(f, g)
    print(f'{len(battles)} batallas enriquecidas')


if __name__ == '__main__':
    main()
