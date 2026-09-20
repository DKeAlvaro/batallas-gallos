/* Acta de barras — lector y visor del corpus.
   Sin dependencias. Los datos vienen de data/index.js (window.CORPUS), asi que
   la pagina funciona tambien abierta con file://. Las transcripciones se piden
   bajo demanda; si no hay servidor, se avisa en lugar de quedarse en blanco. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const CORPUS = window.CORPUS || [];
const PUEDE_PEDIR = location.protocol !== 'file:';
const PAGINA = 150;        // filas por tanda en la lista
const LOTE_TEXTO = 10;     // peticiones simultaneas en la busqueda de texto
const MAX_HITS = 30;

const nf = new Intl.NumberFormat('es-ES');
const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

let filtro = CORPUS.slice();
let mostradas = PAGINA;
let actual = null;
let cursor = -1;
let cache = new Map();
let texto = { q: '', on: false, hits: null, token: 0 };

/* ---------- utilidades ---------- */

const mmss = s => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`
    : `${m}:${String(x).padStart(2, '0')}`;
};

const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const escapa = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function resalta(txt, q) {
  txt = String(txt ?? '');
  if (!q) return escapa(txt);
  const t = norm(txt), n = norm(q);
  if (!n) return escapa(txt);
  let out = '', i = 0, j;
  while ((j = t.indexOf(n, i)) >= 0) {
    out += escapa(txt.slice(i, j)) + '<mark>' + escapa(txt.slice(j, j + n.length)) + '</mark>';
    i = j + n.length;
  }
  return out + escapa(txt.slice(i));
}

/* agrupa lineas de subtitulo en tiradas legibles. Sin timestamps en el dataset,
   el corte es por longitud: cada tirada ronda las 45 palabras. */
function aTiradas(lines) {
  const out = [];
  let actual = [];
  let palabras = 0;
  for (const cruda of lines) {
    const t = (cruda || '').trim();
    if (!t) continue;
    actual.push(t);
    palabras += t.split(/\s+/).length;
    if (palabras >= 45) { out.push(actual.join(' ')); actual = []; palabras = 0; }
  }
  if (actual.length) out.push(actual.join(' '));
  return out;
}

/* ---------- cabecera ---------- */

function pintaCifras() {
  const total = CORPUS.length;
  const lineas = CORPUS.reduce((s, b) => s + (b.n_lines || 0), 0);
  const palabras = CORPUS.reduce((s, b) => s + (b.n_words || 0), 0);
  const segundos = CORPUS.reduce((s, b) => s + (b.duration_s || 0), 0);
  const mcs = new Set();
  CORPUS.forEach(b => (b.mcs || []).forEach(m => mcs.add(norm(m))));

  $('#cifras').innerHTML = [
    ['batallas', nf.format(total)],
    ['tiradas de subtítulo', nf.format(lineas)],
    ['palabras', nf.format(palabras)],
    ['horas de vídeo', nf1.format(segundos / 3600)],
    ['MCs distintos', nf.format(mcs.size)],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

  $('#pie-txt').textContent =
    `${nf.format(total)} batallas obtenidas de los subtítulos automáticos de YouTube, ` +
    `desduplicados a ${nf.format(lineas)} líneas de habla. Corpus completo en data/dataset.jsonl.gz.`;
}

/* ---------- lista ---------- */

function pintaLista() {
  const q = texto.on && texto.hits ? texto.q : '';
  const lista = $('#lista');

  if (texto.on && texto.hits) {
    lista.innerHTML = texto.hits.length
      ? texto.hits.map(h => `
          <li>
            <button class="fila" data-id="${h.id}" ${actual === h.id ? 'aria-current="true"' : ''}>
              <span class="quien">${h.quien}</span>
              <span class="donde">${h.fragmento}</span>
            </button>
          </li>`).join('')
      : '<li><p class="vacio">Ninguna batalla contiene esa palabra.</p></li>';
    $('#mas').hidden = true;
    return;
  }

  const trozo = filtro.slice(0, mostradas);
  let html = '', anio = '__';
  for (const b of trozo) {
    const a = b.year || 'sin año';
    if (a !== anio) { anio = a; html += `<li class="grupo">${a}</li>`; }
    const quien = b.mcs && b.mcs.length
      ? b.mcs.map(m => resalta(m, q)).join(' <span style="color:var(--tenue)">vs</span> ')
      : resalta(b.title || b.video_id, q);
    const donde = [b.event, b.round, b.format].filter(Boolean).join(' · ');
    html += `<li>
      <button class="fila" data-id="${b.video_id}" ${actual === b.video_id ? 'aria-current="true"' : ''}>
        <span class="quien">${quien}</span>
        <span class="donde">${resalta(donde, q)}</span>
      </button></li>`;
  }
  lista.innerHTML = html || '<li><p class="vacio">Nada con ese filtro.</p></li>';
  const mas = $('#mas');
  mas.hidden = filtro.length <= mostradas;
  mas.textContent = `Mostrar más (${nf.format(filtro.length - mostradas)})`;
}

function aplicaFiltro() {
  const q = norm(texto.q);
  filtro = !q ? CORPUS.slice() : CORPUS.filter(b =>
    norm(b.title).includes(q) ||
    norm(b.event).includes(q) ||
    norm(b.round).includes(q) ||
    norm((b.mcs || []).join(' ')).includes(q));
  mostradas = PAGINA;
  pintaLista();
}

/* ---------- busqueda dentro de las transcripciones ---------- */

async function buscaTexto(q) {
  const token = ++texto.token;
  const ids = CORPUS.filter(b => b.n_words).map(b => b.video_id);
  const hits = [];
  const prog = $('#progreso');
  prog.hidden = false;
  let vistas = 0;

  for (let i = 0; i < ids.length && hits.length < MAX_HITS; i += LOTE_TEXTO) {
    if (token !== texto.token) return;
    const lote = ids.slice(i, i + LOTE_TEXTO);
    const res = await Promise.all(lote.map(async id => {
      try { return [id, await carga(id)]; } catch { return null; }
    }));
    for (const r of res) {
      if (!r) continue;
      const [id, d] = r;
      vistas++;
      const linea = d.lines.find(l => norm(l.text).includes(q));
      if (!linea) continue;
      const meta = CORPUS.find(b => b.video_id === id) || {};
      hits.push({
        id,
        quien: escapa(meta.mcs && meta.mcs.length ? meta.mcs.join(' vs ') : meta.title || id),
        fragmento: `${resalta(linea.text, texto.q)} <span style="color:var(--tenue)">· ${mmss(linea.start)}</span>`,
      });
    }
    if (token !== texto.token) return;
    prog.textContent = `${nf.format(vistas)} de ${nf.format(ids.length)} batallas revisadas · ${hits.length} coincidencias`;
    texto.hits = hits.slice();
    pintaLista();
  }
  prog.hidden = true;
  texto.hits = hits;
  pintaLista();
}

/* ---------- transcripcion ---------- */

function carga(id) {
  if (cache.has(id)) return Promise.resolve(cache.get(id));
  return fetch(`data/battles/${id}.json`)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => { cache.set(id, d); return d; });
}

function dibujaVacio(msg) {
  $('#lector').innerHTML = `<p class="vacio">${escapa(msg)}</p>`;
}

function dibujaBatalla(b) {
  const meta = CORPUS.find(x => x.video_id === b.video_id) || {};
  const m = { ...meta, ...b };
  const nombre = (m.mcs || []).map(escapa);
  const titulo = nombre.length > 1
    ? `${nombre.slice(0, -1).join(', ')}<span class="contra">contra</span>${nombre[nombre.length - 1]}`
    : escapa(m.title || m.video_id);

  const ficha = [
    m.event, m.round, m.year, m.format,
    `${nf.format(m.n_lines)} líneas`, `${nf.format(m.n_words)} palabras`,
    `${mmss(m.duration_s)} de vídeo`,
  ].filter(Boolean).map(escapa).join(' · ');

  const tiradas = aTiradas(m.lines);
  const filas = tiradas.map((t, i) => `
    <li class="tirada" id="tirada-${i}" data-i="${i}">${escapa(t)}</li>`).join('');

  $('#lector').innerHTML = `
    <h2 class="titulo-batalla">${titulo}</h2>
    <p class="ficha">${ficha} · <a href="${m.url}" target="_blank" rel="noopener">vídeo original</a>
       · <a href="data/battles/${m.video_id}.json" target="_blank">JSON</a></p>
    <ol class="tiradas">${filas}</ol>`;
  $('#lector').dataset.nueva = '1';
  setTimeout(() => { $('#lector').dataset.nueva = '0'; }, 400);
}

async function abre(id) {
  actual = id;
  cursor = -1;
  $$('.fila[data-id]').forEach(el => el.setAttribute('aria-current', String(el.dataset.id === id)));
  if (!PUEDE_PEDIR) {
    dibujaVacio('Abierto con file://, así que el navegador no deja leer las transcripciones. ' +
                'Sirve la carpeta con un servidor (por ejemplo `python3 -m http.server`) y recarga.');
    return;
  }
  $('#lector').innerHTML = '<p class="cargando">Cargando transcripción…</p>';
  try {
    dibujaBatalla(await carga(id));
  } catch (e) {
    console.error('abre(' + id + '):', e);
    dibujaVacio('No se pudo cargar esa transcripción.');
  }
}

/* ---------- corpus: graficas ---------- */

function bloque(titulo, nota, filas, tope, unidad = '') {
  const max = Math.max(...filas.map(f => f.v), 1);
  const html = filas.slice(0, tope).map((f, i) => `
    <li data-alto="${i < 3 ? 1 : 0}">
      <span class="rotulo">
        <span class="nombre" title="${escapa(f.k)}">${escapa(f.k)}</span>
        <span class="pista"><i style="width:${Math.max(2, (f.v / max) * 100)}%"></i></span>
      </span>
      <span class="valor">${nf.format(f.v)}${unidad}</span>
    </li>`).join('');
  return `<div class="bloque"><h2>${escapa(titulo)}</h2><p class="nota">${escapa(nota)}</p>
    <ul class="barras">${html}</ul></div>`;
}

function pintaCorpus() {
  const cuenta = (lista, clave) => {
    const m = new Map();
    lista.forEach(x => clave(x).forEach(k => k && m.set(k, (m.get(k) || 0) + 1)));
    return Array.from(m, ([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
  };

  const anios = new Map();
  CORPUS.forEach(b => { if (b.year) anios.set(b.year, (anios.get(b.year) || 0) + 1); });
  const filasAnio = Array.from(anios, ([k, v]) => ({ k: String(k), v })).sort((a, b) => a.k.localeCompare(b.k));

  const mcs = cuenta(CORPUS, b => (b.mcs || []).map(m => m.trim()));
  const parejas = new Map();
  CORPUS.forEach(b => {
    const m = (b.mcs || []).map(x => x.trim()).filter(Boolean).sort();
    for (let i = 0; i < m.length; i++)
      for (let j = i + 1; j < m.length; j++) {
        const k = `${m[i]} / ${m[j]}`;
        parejas.set(k, (parejas.get(k) || 0) + 1);
      }
  });
  const filasParejas = Array.from(parejas, ([k, v]) => ({ k, v }))
    .filter(x => x.v > 1).sort((a, b) => b.v - a.v);

  const formatos = cuenta(CORPUS, b => (b.format ? [b.format] : []));
  const eventos = cuenta(CORPUS, b => (b.event ? [b.event] : []));

  const largas = CORPUS.slice().sort((a, b) => (b.n_words || 0) - (a.n_words || 0)).slice(0, 12)
    .map(b => ({ k: (b.mcs && b.mcs.length ? b.mcs.join(' vs ') : b.title), v: b.n_words || 0 }));

  $('#graficas').innerHTML = [
    bloque('Batallas por año', 'Cuándo se disputaron las batallas del corpus.', filasAnio, 40),
    bloque('MCs con más batallas', 'Un MC cuenta una vez por batalla, sea 1v1, 2v2 o 4-way.', mcs, 15),
    bloque('Enfrentamientos repetidos', 'Parejas que se han visto más de una vez.', filasParejas, 12),
    bloque('Formato', 'Cuánta gente por batalla.', formatos, 6),
    bloque('Eventos con más batallas', 'Ligas, plazas y finales.', eventos, 15),
    bloque('Las más largas', 'Palabras totales por batalla.', largas, 12),
  ].join('');
  const conAnio = CORPUS.filter(b => b.year).length;
  $('#graficas').insertAdjacentHTML('beforeend',
    `<p class="nota-pie">${nf.format(conAnio)} de ${nf.format(CORPUS.length)} batallas tienen año identificado; ` +
    `el resto depende de que el título lo mencione.</p>`);
}

/* ---------- teclado ---------- */

function mueveBarra(d) {
  const t = $$('#lector .tirada');
  if (!t.length) return;
  cursor = Math.max(0, Math.min(t.length - 1, cursor + d));
  t.forEach((el, i) => el.dataset.actual = String(i === cursor));
  t[cursor].scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function mueveBatalla(d) {
  const i = filtro.findIndex(b => b.video_id === actual);
  const j = Math.max(0, Math.min(filtro.length - 1, (i < 0 ? 0 : i + d)));
  if (filtro[j]) abre(filtro[j].video_id);
}

/* ---------- pestañas ---------- */

function ponPestana(cual) {
  const lector = cual === 'lector';
  $('#tab-lector').setAttribute('aria-selected', String(lector));
  $('#tab-corpus').setAttribute('aria-selected', String(!lector));
  $('#panel-lector').hidden = !lector;
  $('#panel-corpus').hidden = lector;
}

/* ---------- eventos ---------- */

let temporizador = null;
function conecta() {
  $('#q').addEventListener('input', e => {
    texto.q = e.target.value.trim();
    texto.hits = null;
    texto.token++;
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      aplicaFiltro();
      if (texto.on && texto.q.length >= 3 && PUEDE_PEDIR) buscaTexto(norm(texto.q));
    }, 250);
  });

  $('#fulltext').addEventListener('change', e => {
    texto.on = e.target.checked;
    texto.hits = null;
    texto.token++;
    if (texto.on && texto.q.length >= 3 && PUEDE_PEDIR) buscaTexto(norm(texto.q));
    else pintaLista();
  });

  $('#mas').addEventListener('click', () => { mostradas += PAGINA; pintaLista(); });

  $('#lista').addEventListener('click', e => {
    const b = e.target.closest('.fila');
    if (b) abre(b.dataset.id);
  });

  $('#lector').addEventListener('click', e => {
    const t = e.target.closest('.tirada');
    if (!t || e.target.closest('a')) return;
    cursor = Number(t.dataset.i);
    $$('#lector .tirada').forEach((el, i) => el.dataset.actual = String(i === cursor));
  });

  $('#tab-lector').addEventListener('click', () => ponPestana('lector'));
  $('#tab-corpus').addEventListener('click', () => ponPestana('corpus'));

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.key === '/') { e.preventDefault(); $('#q').focus(); return; }
    if ($('#panel-corpus').hidden === false) return;
    if (e.key === 'j') { e.preventDefault(); mueveBarra(1); }
    else if (e.key === 'k') { e.preventDefault(); mueveBarra(-1); }
    else if (e.key === 'n') { e.preventDefault(); mueveBatalla(1); }
    else if (e.key === 'p') { e.preventDefault(); mueveBatalla(-1); }
  });
}

/* ---------- arranque ---------- */

(function inicia() {
  if (!CORPUS.length) {
    dibujaVacio('No se han cargado los datos. Comprueba que existe data/index.js.');
    return;
  }
  if (!PUEDE_PEDIR) {
    $('#aviso').hidden = false;
    $('#aviso').textContent = 'Abierto con file:// — las transcripciones necesitan un servidor local.';
    $('#lbl-full').style.display = 'none';
  }
  CORPUS.sort((a, b) => (b.year || 0) - (a.year || 0) ||
    String(a.mcs || a.title).localeCompare(String(b.mcs || b.title), 'es'));
  filtro = CORPUS.slice();
  pintaCifras();
  pintaLista();
  pintaCorpus();
  conecta();
})();
