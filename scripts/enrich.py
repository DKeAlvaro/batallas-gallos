#!/usr/bin/env python3
"""Enriquece metadata a partir del titulo, segun multiples formatos de canal.
Formatos observados:
  Red Bull/Urban Roosters: "MC1 vs MC2 – Ronda: Evento, Pais año"
  BDM:                     "MC1 vs MC2. Ronda. Evento. año. CL"
  Batalla de Campeones:    "MC1 VS MC2"
  Supremacia MC:           "A vs B vs C vs D - Prueba de Cobardía"
  2v2:                     "A & B vs C & D ─ ESTELAR ─ FU II (Logroño)"
"""
import json, re, sys, os, unicodedata

SEP = re.compile(r'\s*(?:[–—─]|\.\s|\s\|\s|\s/\s|\s-\s)\s*')
# marcas de liga que se cuelan al final del nombre del MC: 'ZASKO FMS BILBAO Jornada 5'
MARCA = re.compile(r'\s+(?:FMS|BDM|Jornada|Temporada|Oficial|Official|Matchday|World Series|'
                   r'Red Bull|Urban Roosters|Batalla de Exhibici[oó]n|#).*$', re.I)
# ronda pegada al final del nombre: 'XYTZAR Octavos' -> 'XYTZAR' + ronda 'Octavos'
COLA_RONDA = re.compile(r'\s+([48](?:vos|tos)|Octavos|Cuartos|Semifinal|Final|Temporada\s+\d+|'
                        r'Jornada\s+\d+)\s*$', re.I)
VS = re.compile(r'\s+(?:vs\.?|VS\.?|Vs\.?)\s+', re.I)
ROUNDS = [
    'prueba de cobardía', 'prueba de cobardia', 'main event', 'co-estelar', 'estelar',
    'cartelera principal', 'preliminares', 'preliminar', 'bonus battle',
    'triple amenaza', 'triple threat', 'final', 'semifinal', 'cuartos',
    'octavos', 'primera ronda', 'segunda ronda', 'repesca', 'tercer',
    '3er y 4to puesto', 'replica', 'filtro', 'ronda',
]

def norm(s):
    return unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower().strip()

# Urban Roosters separa con ' I ' mayuscula: 'ACRU vs GAZIR I FMS WORLD SERIES 2025 I Jornada 2'
SEP_I = re.compile(r'\s+I\s+(?=[A-Z0-9#\u00c0-\u00dc])')


def parse_title(title, duration=None):
    out = {'raw_title': title, 'mcs': None, 'round': None, 'event': None, 'year': None,
           'format': None, 'noise': False}
    # quita el separador ' I ' de las ligas, para que la cabeza sea solo 'A vs B'
    if re.search(r'\bFMS\b|World Series|Jornada|Temporada', title, re.I):
        title = SEP_I.sub(' \u2013 ', title).strip()
    # ruido evidente
    if re.search(r'\b(cypher|top \d|mejores|reaccion|resumen|entrevista|presentaci|minutos de|kids|anuncio|tráiler|trailer)\b', norm(title)):
        out['noise'] = True
    # año
    ym = re.search(r'\b(20\d{2})\b', title)
    if ym:
        out['year'] = int(ym.group(1))
    # partir por separador de contexto. Si un trozo acaba en 'vs', el corte partio
    # un 'VS.' por la mitad: se vuelve a unir con el trozo siguiente.
    parts = [p.strip() for p in SEP.split(title) if p.strip()]
    unidas = []
    for p in parts:
        if unidas and (re.search(r'\bvs\.?$', unidas[-1], re.I) or re.match(r'(?i)^vs\.?\s', p)):
            unidas[-1] = unidas[-1] + ' ' + p
        else:
            unidas.append(p)
    parts = unidas
    # la cabeza es el primer trozo con 'vs': hay titulos que empiezan por el torneo
    # ('Copa Camet - Final / POBLA & KRAFFIZ vs DEMENTE & SEBJAZZ')
    idx = next((i for i, p in enumerate(parts) if VS.search(p)), 0)
    head = parts[idx] if parts else title
    cola = []          # texto que se recorta de los nombres y vuelve al evento
    # MCs desde la cabeza
    if VS.search(head):
        mcs = []
        for m in VS.split(head):
            if not m.strip():
                continue
            m = m.split(':')[0]                  # 'KILLER CUBA: Octavos' -> 'KILLER CUBA'
            m2 = MARCA.sub('', m)
            if m2 != m:
                cola.append(m[len(m2):])          # 'FMS Alicante Jornada 2'
            m = m2.strip(' .,-–—:')
            m = re.sub(r'\s+I\s*$', '', m)        # 'LARRIX (CUARTOS) I' -> 'LARRIX (CUARTOS)'
            while True:                            # 'XYTZAR Octavos' -> 'XYTZAR'
                c = COLA_RONDA.search(m)
                if not c:
                    break
                cola.append(c.group(1))
                m = m[:c.start()].strip()
            mcs.append(m.strip(' .,-–—:'))
        mcs = [m for m in mcs if m]
        if len(mcs) >= 2:
            out['mcs'] = mcs
            out['format'] = {2: '1v1', 3: '1v1v1', 4: '4way'}.get(len(mcs), f'{len(mcs)}way')
            if any(' & ' in m or ' y ' in norm(m) for m in mcs):
                out['format'] = '2v2'
    # ronda / evento: lo que va antes del careo, lo que va despues y lo recortado
    rest = ' '.join(parts[:idx] + parts[idx + 1:] + cola)
    nrest = norm(rest)
    # ronda: la coincidencia mas larga gana ('semifinal' antes que 'final')
    for r in sorted(ROUNDS, key=len, reverse=True):
        if r in nrest:
            out['round'] = r
            break
    if rest:
        # evento: quitar la ronda del texto restante
        ev = rest
        if out['round']:
            ev = re.sub(r'(?i)' + re.escape(out['round']), '', ev, count=1)
        ev = re.sub(r'\b(20\d{2})(?:/\d{2})?\b', '', ev)
        ev = re.sub(r'[.#|]|^\s*[-–—:]\s*|\s*[-–—:]\s*$', '', ev).strip(' .,-–—:')
        ev = re.sub(r'\s{2,}', ' ', ev)
        if ev and len(ev) > 2:
            out['event'] = ev
    return out

def main():
    whitelist = set(x for x in open('canales/todos_ids.txt').read().split() if x)
    idx = {}
    for f in os.listdir('canales'):
        if not f.endswith('.txt') or f == 'todos_ids.txt':
            continue
        for line in open(os.path.join('canales', f)):
            p = line.rstrip('\n').split('|')
            if len(p) >= 2 and p[0] in whitelist:
                d = int(p[2]) if len(p) > 2 and p[2].isdigit() else None
                idx.setdefault(p[0], {'title': p[1], 'duration_s': d, 'channel_file': f})
    stats = {'total': 0, 'mcs': 0, 'round': 0, 'event': 0, 'year': 0, 'noise': 0, 'fmt': {}}
    rows = []
    for vid, m in idx.items():
        e = parse_title(m['title'], m['duration_s'])
        e['video_id'] = vid
        e['url'] = f'https://youtu.be/{vid}'
        e['channel_file'] = m['channel_file']
        e['duration_s'] = m['duration_s']
        rows.append(e)
        stats['total'] += 1
        stats['mcs'] += 1 if e['mcs'] else 0
        stats['round'] += 1 if e['round'] else 0
        stats['event'] += 1 if e['event'] else 0
        stats['year'] += 1 if e['year'] else 0
        stats['noise'] += 1 if e['noise'] else 0
        if e['format']:
            stats['fmt'][e['format']] = stats['fmt'].get(e['format'], 0) + 1
    os.makedirs('meta', exist_ok=True)
    with open('meta/index.jsonl', 'w', encoding='utf-8') as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + '\n')
    print(json.dumps(stats, ensure_ascii=False, indent=1))

if __name__ == '__main__':
    main()
