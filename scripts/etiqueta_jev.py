"""Pasada completa: etiqueta todos los bloques de todas las batallas con Jev (TypeSafe).

Salida: /root/batallas-gallos/etiquetas.jsonl  (una línea por batalla con sus bloques)
"""
import json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

API = os.environ["TYPESAFE_API_KEY"]
URL = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-latest"
WORDS_PER_BLOCK = 150
MAX_WORKERS = 32          # bloques en vuelo por batalla
MAX_BATTLES_PAR = 8       # batallas procesándose a la vez

PREGUNTAS = {
    "es_rapeo": {
        "type": "noul",
        "instructions": "¿La mayoría de este bloque es rapeo de un MC compitiendo (barras, punchlines, rimas), y no presentación, publicidad, público o música?",
    },
    "es_ruido": {
        "type": "noul",
        "instructions": "¿Este bloque es principalmente ruido no deseado para un corpus de rapeo (presentador, música, aplausos, anuncios, texto corrupto), más que barras de un MC?",
    },
    "pct_rapeo": {
        "type": "score",
        "instructions": "¿Qué fracción de las palabras de este bloque son rapeo de un MC compitiendo? Responde con la fracción aproximada.",
        "criteria": [
            "Casi nada es rapeo (menos del 20%)",
            "Una minoría (20-40%)",
            "Menos de la mitad (40-60%)",
            "Más de la mitad (60-80%)",
            "La gran mayoría (80-95%)",
            "Prácticamente todo (más del 95%)",
        ],
    },
    "calidad_transcripcion": {
        "type": "choice",
        "instructions": "¿Cómo de legible es esta transcripción para análisis de rimas?",
        "criteria": {
            "limpia": "Se entiende el rapeo, poco ruido",
            "con_ruido": "Se entiende a grandes rasgos pero hay trozos corruptos o fuera de lugar",
            "corrupta": "Mayormente ilegible, texto desordenado o sin sentido",
        },
    },
    "score_rima": {
        "type": "score",
        "instructions": "Puntúa la calidad técnica del rapeo en este bloque: multisílabas, rimas internas, esquema sostenido.",
        "criteria": [
            "Texto ilegible o sin ninguna rima",
            "Rimas ocasionales, la mayoría de versos no riman entre sí",
            "Rima asonante al final de verso en la mayoría de barras",
            "Rima consonante al final de verso en la mayoría de barras, con alguna interna",
            "Rimas internas o multisílabas frecuentes, esquema sostenido en todo el bloque",
            "Rimas internas constantes, multisílabas y esquema extendido, nivel de élite",
        ],
    },
    "score_punch": {
        "type": "score",
        "instructions": "Puntúa la fuerza de los punchlines y el humor/agresión directa en este bloque.",
        "criteria": [
            "Ningún golpe de gracia: descripción o relleno sin ataque",
            "Alguna intención de ataque pero débil o genérica",
            "Algunos punchlines efectivos con imágenes o comparaciones",
            "Punchlines frecuentes y directos contra el rival",
            "Golpes contundentes casi cada verso, nivel de élite",
        ],
    },
}


def bloques(lines, target=WORDS_PER_BLOCK):
    out, cur, n = [], [], 0
    for l in lines:
        cur.append(l)
        n += len(l.split())
        if n >= target:
            out.append(" ".join(cur)); cur, n = [], 0
    if cur:
        out.append(" ".join(cur))
    return out


def jev(state, questions, reintentos=4):
    body = json.dumps({"state": state, "model": MODEL, "questions": questions}).encode()
    last = None
    for i in range(reintentos):
        try:
            req = urllib.request.Request(URL, data=body, headers={
                "Authorization": f"Bearer {API}", "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read())
        except Exception as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


def procesa_batalla(b):
    contexto = (f"Batalla de gallos entre {b['mcs'][0]} y {b['mcs'][1]}. "
                f"Evento: {b['event']}. Transcripción de subtítulos de YouTube, fragmentada por el captioning.")
    bs = [contexto + "\n\nFRAGMENTO:\n" + blk for blk in bloques(b["lines"])]
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        results = list(ex.map(lambda blk: jev(blk, PREGUNTAS), bs))
    tags = []
    for i, r in enumerate(results):
        a = r["answers"]
        tags.append({
            "bloque": i,
            "palabras": len(bs[i].split()),
            "rapeo": round(a["es_rapeo"]["noul"], 2),
            "ruido": round(a["es_ruido"]["noul"], 2),
            "pct_rapeo": round(a["pct_rapeo"]["score"], 2),
            "calidad": a["calidad_transcripcion"]["choice"],
            "rima": round(a["score_rima"]["score"], 2),
            "conf_rima": round(a["score_rima"]["confidence"], 2),
            "punch": round(a["score_punch"]["score"], 2),
        })
    return b["video_id"], tags, sum(r["usage"]["input_tokens"] for r in results), sum(r["usage"]["output_tokens"] for r in results)


def main():
    dataset = "/root/batallas-gallos/dataset.jsonl"
    out_path = "/root/batallas-gallos/etiquetas.jsonl"
    done = set()
    if os.path.exists(out_path):
        for line in open(out_path):
            try:
                done.add(json.loads(line)["video_id"])
            except Exception:
                pass
    battles = [json.loads(l) for l in open(dataset)]
    pend = [b for b in battles if b["video_id"] not in done]
    print(f"{len(battles)} batallas, {len(pend)} pendientes, {len(done)} ya hechas", flush=True)

    t0 = time.time()
    tok_in = tok_out = 0
    fout = open(out_path, "a")
    with ThreadPoolExecutor(max_workers=MAX_BATTLES_PAR) as ex:
        futs = {ex.submit(procesa_batalla, b): b for b in pend}
        for n, fut in enumerate(as_completed(futs), 1):
            try:
                vid, tags, i, o = fut.result()
                fout.write(json.dumps({"video_id": vid, "bloques": tags}, ensure_ascii=False) + "\n")
                fout.flush()
                tok_in += i; tok_out += o
            except Exception as e:
                print(f"ERROR {futs[fut]['video_id']}: {e}", flush=True)
            if n % 25 == 0 or n == len(pend):
                dt = time.time() - t0
                print(f"[{n}/{len(pend)}] {dt:.0f}s, {tok_in/1e6:.1f}M in / {tok_out/1e6:.2f}M out, "
                      f"eta {dt/n*(len(pend)-n):.0f}s", flush=True)
    fout.close()
    print(f"LISTO en {time.time()-t0:.0f}s. tokens: {tok_in/1e6:.1f}M in / {tok_out/1e6:.2f}M out")


if __name__ == "__main__":
    main()
