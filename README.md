# Acta de barras — corpus de batallas de gallos

Transcripciones de batallas de gallos en español, sacadas de los subtítulos de YouTube,
desduplicadas y sin marcas de tiempo.

La idea es tener el material en un formato que se pueda analizar (rimas, métrica,
rankings, entrenar un modelo) sin volver a tocar el vídeo.

## Qué hay aquí

- `web/index.html` — el visor. Un solo fichero con el CSS y el JS dentro: una lista de
  batallas y, al pulsar una, su transcripción a pantalla completa. Funciona abierto
  (`file://`) para navegar el corpus; para leer las transcripciones hay que servirlo
  (por ejemplo `python3 -m http.server -d web`).
- `web/data/index.js` — una entrada por batalla (sin el texto): MCs, ronda, evento, año,
  formato, duración, líneas, palabras. Es `.js` y no `.json` para poder abrir sin servidor.
- `web/data/battles/<id>.json` — la transcripción completa: la lista de líneas de habla.
- `web/data/dataset.jsonl.gz` — el corpus entero, una batalla por línea, comprimido.
- `scripts/` — el pipeline, tal como se usó.
- `canales/` — los índices de descubrimiento (`id|título|duración` por canal).

## Formato

Cada batalla:

```json
{
  "video_id": "GVVuZzxFw_A",
  "url": "https://youtu.be/GVVuZzxFw_A",
  "title": "K-NUTO vs TINTA – Octavos: Semifinal Bogotá, Colombia 2019",
  "mcs": ["K-NUTO", "TINTA"],
  "round": "octavos",
  "event": "Semifinal Bogotá, Colombia",
  "year": 2019,
  "format": "1v1",
  "duration_s": 358,
  "n_lines": 124,
  "n_words": 859,
  "source": "youtube-autosub",
  "lines": [
    "volver este primero dos minutos 4x4",
    "libre rat race está listo los jurados"
  ]
}
```

`lines` es texto plano, en el orden en que se habló y ya desduplicado. No hay marcas de
tiempo: se quitaron a propósito para simplificar el dataset. Tampoco hay etiqueta de quién
habla. El visor junta las líneas en párrafos de unas 45 palabras para que se puedan leer.

## Cómo se construyó

1. **Descubrimiento.** Canales oficiales (Red Bull Batalla, Urban Roosters, BDM,
   Batalla de Campeones, Supremacía MC, FU Movement, FMS España). Se lista el canal
   entero con `yt-dlp --flat-playlist` y se filtra por título (`vs`) y duración (5–40 min).
2. **Cosecha de subtítulos.** `yt-dlp --skip-download --write-subs --write-auto-subs
   --sub-langs "es.*,es"`, con el cliente `ios` (el cliente web devuelve 429 enseguida).
   Los `.vtt` se guardan crudos.
3. **Parseo.** Los subtítulos automáticos de YouTube vienen en *rolling captions*: cada
   bloque repite la frase anterior y añade palabras. `scripts/build_dataset.py` colapsa
   esa redundancia (43 KB de VTT → 12 KB de JSON en una batalla de 6 minutos).
4. **Metadata.** `scripts/enrich.py` deduce MCs, ronda, evento, año y formato del título,
   que en estos canales sigue patrones bastante fijos.

Para rehacerlo:

```bash
bash scripts/harvest5.sh          # cosecha (reanudable: salta lo ya descargado)
python3 scripts/enrich.py         # titulos -> metadata
python3 scripts/build_dataset.py  # vtt -> dataset.jsonl
python3 scripts/export_web.py     # -> web/data/
```

## Límites, que los hay

- **Subtítulos automáticos.** Hay errores en nombres propios y jerga (ERRECÉ aparece como
  «RC», «rat race» donde decía otra cosa). Sirve para analizar rima y métrica; para
  entrenar un modelo conviene limpiarlo.
- **Cobertura.** Una parte de los vídeos no tiene subtítulos de ningún tipo (~13% en la
  muestra medida). Esos necesitarían ASR propio (Whisper) sobre el audio.
- **Sin hablante.** No hay diarización: no se sabe qué línea es de qué MC salvo por el
  contexto y el turno de palabra.
- **Sin marcas de tiempo.** Se quitaron a propósito. Se pierde saltar al minuto exacto del
  vídeo, y la velocidad de habla. El `.vtt` original se puede volver a descargar con el
  script de cosecha si hiciera falta.
- **Vídeos, no audio.** Este repo no distribuye vídeo ni audio, solo transcripciones y
  metadata. Las transcripciones son de YouTube; el texto de las batallas pertenece a sus
  autores. Uso personal y de investigación.
- **Las líneas** vienen del subtítulo, no de la barra de 4x4. Los párrafos del visor son
  unas 45 palabras seguidas.

## Herramientas

`yt-dlp` y `ffmpeg` no están incluidos. El cliente `ios` de yt-dlp puede dejar de
funcionar cuando YouTube cambie algo; si pasa, hay que volver a buscar el cliente que
funcione ese día.
