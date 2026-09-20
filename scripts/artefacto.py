#!/usr/bin/env python3
"""Anade la tarjeta del artefacto al artifacts.html del sitio, arriba del todo.

Uso (en el VPS): python3 artefacto.py <fecha-iso> <dia-corto>
Se ejecuta desde /root/DKeAlvaro.github.io. Es idempotente: si la tarjeta ya
esta, no hace nada.
"""
import sys, re, os

os.chdir('/root/DKeAlvaro.github.io')
fecha, dia = sys.argv[1], sys.argv[2]
p = 'artifacts.html'
h = open(p, encoding='utf-8').read()
if 'batallas-gallos' in h:
    print('ya estaba')
    sys.exit()

card = '''                    <li>
                        <button type="button" class="artifacts-thumb" aria-expanded="false" aria-label="Preview">
                            <img src="images/artifacts/batallas-gallos.webp" alt="" width="640" height="397" loading="lazy">
                        </button>
                        <div class="artifacts-copy">
                            <a href="https://dkealvaro.github.io/batallas-gallos/">Acta de barras — batallas de gallos transcritas</a>
                            <p>1.764 batallas de gallos en español transcritas línea a línea desde YouTube: 2,9 millones de palabras improvisadas, con visor para leerlas.</p>
                        </div>
                        <time datetime="%s">%s</time>
                        <div class="artifacts-preview">
                            <img src="images/artifacts/batallas-gallos.webp" alt="" width="640" height="397" loading="lazy">
                        </div>
                    </li>
''' % (fecha, dia)

m = re.search(r'<section class="artifacts-group">\s*<ul>\s*', h)
if not m:
    print('ERROR: no encuentro el primer grupo de artifacts.html')
    sys.exit(1)
open(p, 'w', encoding='utf-8').write(h[:m.end()] + card + h[m.end():])
print('tarjeta insertada:', dia)
