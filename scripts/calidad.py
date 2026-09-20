#!/usr/bin/env python3
"""Clasifica cada transcripcion segun dos cosas que importan de verdad:

  COBERTURA  cuanto habla capturo el ASR. Se mide con palabras/minuto y con la
             fraccion de la duracion que tiene texto. Cuando el ASR solo oye
             ruido salen wpm de 5 y cobertura casi nula.
  FIDELIDAD  cuanto del texto es habla real y no bucle del propio ASR. Se mide
             con 8-gramas repetidos: 'arranca arranco yo lobo ustedes si saben'
             tres veces seguidas es alucinacion, no una rima.

Las marcas ([musica], [Aplausos]) NO son un defecto por si solas: aparecen incluso
en transcripciones buenas. Solo cuentan si se comen el texto.

Uso: python3 scripts/calidad.py [--listar 10]
"""
import json, re, os, sys
from collections import Counter

TS = re.compile(r'(\d{2}):(\d{2}):(\d{2})\.(\d{3})')
TAG = re.compile(r'<[^>]+>')
MARCA = re.compile(r'\[[^\]]*\]')
SUB_DIR = os.path.expanduser('~/batallas/subs')
OUT = os.path.expanduser('~/batallas/calidad.jsonl')
N = 8                       # tamano de n-grama para detectar bucles
WPM_MIN = 90                # por debajo de esto el ASR se ha dejado habla
COB_MIN = 0.55              # fraccion minima de la duracion con texto
BUCLE_MAX = 0.06            # fraccion maxima de 8-gramas repetidos


def ts2s(t):
    m = TS.search(t)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + int(m.group(4)) / 1000


def lineas(path):
    """[(start, end, texto)] con el rolling de YouTube colapsado"""
    bruto = open(path, encoding='utf-8').read()
    crudas = []
    for b in re.split(r'\n\s*\n', bruto)[1:]:
        ls = b.strip().split('\n')
        i = 0 if ls and '-->' in ls[0] else 1
        if i >= len(ls) or '-->' not in ls[i]:
            continue
        ini, fin = (ts2s(x) for x in ls[i].split('-->')[:2])
        txt = ' '.join(TAG.sub('', l).strip() for l in ls[i + 1:]).strip()
        if txt:
            crudas.append((ini, fin, txt))
    salida, previo = [], []
    for ini, fin, txt in crudas:
        palabras = txt.split()
        k = 0
        for k in range(min(len(palabras), len(previo)), 0, -1):
            if previo[-k:] == palabras[:k]:
                break
        else:
            k = 0
        nuevas = palabras[k:]
        if nuevas:
            salida.append((ini, fin, ' '.join(nuevas)))
            previo = palabras
    return salida


def metricas(path):
    ls = lineas(path)
    if not ls:
        return None
    dur = max(1.0, ls[-1][1] - ls[0][0])
    mins = dur / 60
    con_texto = sum(fin - ini for ini, fin, t in ls if t.strip())
    todo = ' '.join(t for _, _, t in ls)
    limpio = MARCA.sub(' ', todo)
    palabras = [p for p in re.split(r'\s+', limpio) if p and re.search(r'\w', p)]
    n = len(palabras)
    if n < 20:
        return None

    marcas = len(MARCA.findall(todo))
    wpm = n / mins
    cobertura = min(1.0, con_texto / dur)

    grams = [' '.join(palabras[i:i + N]) for i in range(max(0, n - N + 1))]
    cg = Counter(grams)
    bucles = sum(v - 1 for v in cg.values() if v > 1) / max(1, len(grams))

    # clasificacion
    if wpm < WPM_MIN or cobertura < COB_MIN:
        clase = 'rota'          # el ASR se dejo el habla: hay que retranscribir
    elif bucles > BUCLE_MAX:
        clase = 'bucle'         # alucinacion: tambien hay que retranscribir
    elif marcas / max(1, n + marcas) > 0.25:
        clase = 'ruidosa'       # se oye poco habla por el ruido del directo
    else:
        clase = 'util'

    return {
        'video_id': os.path.basename(path).split('.')[0],
        'clase': clase,
        'dur_s': round(dur), 'palabras': n, 'lineas': len(ls),
        'wpm': round(wpm, 1),
        'cobertura': round(cobertura, 3),
        'bucles': round(bucles, 4),
        'marcas': marcas,
        'palabras_por_linea': round(n / len(ls), 2),
    }


def main():
    listar = int(sys.argv[sys.argv.index('--listar') + 1]) if '--listar' in sys.argv else 6
    filas = []
    for f in sorted(os.listdir(SUB_DIR)):
        if not f.endswith('.es.vtt'):
            continue
        try:
            m = metricas(os.path.join(SUB_DIR, f))
        except Exception as e:
            print('fallo con', f, e)
            continue
        if m:
            filas.append(m)
    with open(OUT, 'w', encoding='utf-8') as fh:
        for m in filas:
            fh.write(json.dumps(m, ensure_ascii=False) + '\n')

    total = len(filas)
    print(f'{total} transcripciones -> {OUT}\n')
    for clase in ('util', 'ruidosa', 'bucle', 'rota'):
        g = [x for x in filas if x['clase'] == clase]
        if not g:
            continue
        h = sum(x['dur_s'] for x in g) / 3600
        print(f'  {clase:8s} {len(g):5d}  ({100*len(g)/total:4.1f}%)  {h:6.1f} h de audio')
    malas = [x for x in filas if x['clase'] in ('rota', 'bucle')]
    print(f'\n  a retranscribir: {len(malas)} ({sum(x["dur_s"] for x in malas)/3600:.1f} h)')

    for clase in ('rota', 'bucle'):
        g = sorted([x for x in filas if x['clase'] == clase], key=lambda x: x['wpm'])[:listar]
        if g:
            print(f'\n--- {clase}')
            for x in g:
                print(f"  {x['video_id']:14s} wpm {x['wpm']:7.1f}  cobertura {x['cobertura']:.2f}  "
                      f"bucles {x['bucles']*100:5.1f}%  marcas {x['marcas']:5d}")


if __name__ == '__main__':
    main()
