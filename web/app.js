/* Acta de barras — lector del corpus de batallas de gallos.
   Sin frameworks: index.json + battles/<id>.json se cargan bajo demanda. */

const $ = (s, r = document) => r.querySelector(s);
const CHUNK = 12;          // peticiones simultáneas en la búsqueda de texto
const MAX_HITS = 40;       // tope de resultados de texto

let INDICE = [];
let FILTRO = [];
let ACTUAL = null;
let CACHE = new Map();
let busqueda = { q: '', full: false, hits: null, cancelada: 0 };

const nf = new Intl.NumberFormat('es-ES');

/* ---------- utilidades ---------- */

function mmss(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`
           : `${m}:${String(x).padStart(2, '0')}`;
}

function norm(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function escapa(s) {
  return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* resalta las coincidencias sin romper el HTML */
function resalta(texto, q) {
  if (!q) return escapa(texto);
  const t = norm(texto), n = norm(q);
  let out = '', i = 0;
  while (true) {
    const j = t.indexOf(n, i);
    if (j < 0) { out += escapa(texto.slice(i)); break; }
    out += escapa(texto.slice(i, j)) + '<mark>' + escapa(texto.slice(j, j + n.length)) + '</mark>';
    i = j + n.length;
  }
  return out;
}

function escalaAnio(a, min, max) {
  const t = max === min ? 0.5 : (a - min) / (max - min);
  const c1 = [31, 59, 196], c2 = [200, 121, 26];
  return `rgb(${c1.map((v, k) => Math.round(v + (c2[k] - v) * t)).join(',')})`;
}

/* ---------- carga ---------- */

async function cargaBatalla(id) {
  if (CACHE.has(id)) return CACHE.get(id);
  const r = await fetch(`data/battles/${id}.json`);
  if (!r.ok) throw new Error('no se pudo cargar ' + id);
  const d = await r.json();
  CACHE.set(id, d);
  return d;
}

/* ---------- cabecera / estadísticas ---------- */

function pintaCorpus() {
  const palabras = INDICE.reduce((s, b) => s + (b.n_words || 0), 0);
  const lineas = INDICE.reduce((s, b) => s + (b.n_lines || 0), 0);
  const segs = INDICE.reduce((s, b) => s + (b.spoken_s || 0), 0);
  const mcs = new Set();
  INDICE.forEach(b => (b.mcs || []).forEach(m => mcs.add(norm(m))));
  const anios = INDICE.map(b => b.year).filter(Boolean);

  $('#corpus').innerHTML = [
    ['batallas', nf.format(INDICE.length)],
    ['barras', nf.format(lineas)],
    ['palabras', nf.format(palabras)],
    ['horas', (segs / 3600).toFixed(1)],
    ['MC', nf.format(mcs.size)],
    ['años', anios.length ? `${Math.min(...anios)}–${Math.max(...anios)}` : '—'],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

  $('#pie-txt').textContent =
    `${nf.format(INDICE.length)} batallas transcritas a partir de subtítulos automáticos de YouTube, ` +
    `desduplicados a ${nf.format(lineas)} barras. Corpus completo también en data/dataset.jsonl.gz.`;
}

function pintaMuro() {
  const muro = $('#muro');
  const con = FILTRO.filter(b => (b.n_words || 0) > 0);
  if (!con.length) { muro.innerHTML = ''; return; }
  const max = Math.max(...con.map(b => b.n_words || 0));
  const anios = con.map(b => b.year).filter(Boolean);
  const min = Math.min(...anios), tope = Math.max(...anios);
  muro.innerHTML = con.map(b => {
    const h = Math.max(6, Math.round(((b.n_words || 0) / max) * 100));
    const c = b.year ? escalaAnio(b.year, min, tope) : 'var(--regla)';
    return `<b style="height:${h}%;--c:${c}" data-id="${b.video_id}" data-sel="${ACTUAL === b.video_id ? 1 : 0}" ` +
           `title="${escapa(b.mcs ? b.mcs.join(' vs ') : b.title)}${b.year ? ' · ' + b.year : ''}"></b>`;
  }).join('');
}

/* ---------- lista ---------- */

function pintaLista() {
  const lista = $('#lista');
  const q = busqueda.q;

  if (busqueda.full && busqueda.hits) {
    lista.innerHTML = busqueda.hits.map(h => `
      <li class="item" data-id="${h.id}" ${ACTUAL === h.id ? 'aria-current="true"' : ''}>
        <span class="quien">${h.quien}</span>
        <span class="donde">${h.fragmento}</span>
      </li>`).join('') || '<li class="item"><span class="donde">Sin coincidencias.</span></li>';
    $('#rail-pie').textContent = `${busqueda.hits.length} batallas con «${q}»`;
    return;
  }

  let html = '', anio = null;
  for (const b of FILTRO) {
    if (b.year !== anio) {
      anio = b.year;
      html += `<li class="anio">${anio || 'sin año'}</li>`;
    }
    const quien = b.mcs && b.mcs.length
      ? b.mcs.map(m => resalta(m, q)).join(' <span style="color:var(--tenue)">vs</span> ')
      : resalta(b.title || '', q);
    const donde = [b.event, b.round].filter(Boolean).join(' — ');
    html += `<li class="item" data-id="${b.video_id}" ${ACTUAL === b.video_id ? 'aria-current="true"' : ''}>
      <span class="quien">${quien}</span>
      <span class="donde">${resalta(donde, q)}${donde && b.format ? ' · ' : ''}${b.format || ''}</span>
    </li>`;
  }
  lista.innerHTML = html || '<li class="item"><span class="donde">Nada con ese filtro.</span></li>';
  $('#rail-pie').textContent = `${FILTRO.length} de ${INDICE.length} batallas`;
}

/* ---------- filtro y búsqueda ---------- */

function filtra() {
  const q = norm(busqueda.q);
  if (!q) { FILTRO = INDICE.slice(); return; }
  FILTRO = INDICE.filter(b =>
    norm(b.title).includes(q) ||
    norm(b.event).includes(q) ||
    norm((b.mcs || []).join(' ')).includes(q)
  );
}

async function buscaEnTexto(q) {
  const marca = ++busqueda.cancelada;
  const hits = [];
  const cola = INDICE.filter(b => b.n_words).map(b => b.video_id);
  const prog = $('#progreso'), txt = $('#progreso-txt');
  prog.hidden = false;
  let vistas = 0;

  for (let i = 0; i < cola.length && hits.length < MAX_HITS; i += CHUNK) {
    if (marca !== busqueda.cancelada) return;
    const lote = cola.slice(i, i + CHUNK);
    const res = await Promise.all(lote.map(async id => {
      try { return { id, d: await cargaBatalla(id) }; } catch { return null; }
    }));
    for (const r of res) {
      if (!r) continue;
      const { id, d } = r;
      const linea = d.lines.find(l => norm(l.text).includes(q));
      if (linea) {
        const meta = INDICE.find(b => b.video_id === id) || {};
        hits.push({
          id,
          quien: meta.mcs && meta.mcs.length ? escapa(meta.mcs.join(' vs ')) : escapa(meta.title),
          fragmento: `${resalta(linea.text, busqueda.q)} <span style="color:var(--tenue)">· ${mmss(linea.start)}</span>`,
        });
      }
      vistas++;
    }
    txt.textContent = `${nf.format(vistas)} de ${nf.format(cola.length)} batallas revisadas, ${hits.length} coincidencias`;
    busqueda.hits = hits.slice();
    pintaLista();
    if (hits.length >= MAX_HITS) break;
  }
  prog.hidden = true;
  busqueda.hits = hits;
  pintaLista();
}

/* ---------- lector ---------- */

function careoHTML(b) {
  const mcs = b.mcs || [];
  if (mcs.length === 2)
    return `<span class="a">${escapa(mcs[0])}</span><span class="x">contra</span><span class="b">${escapa(mcs[1])}</span>`;
  if (mcs.length > 2)
    return `<span class="solo">${mcs.map(escapa).join(' <span class="x">·</span> ')}</span>`;
  return `<span class="solo">${escapa(b.title || b.video_id)}</span>`;
}

function pintaRitmo(b) {
  const ls = b.lines;
  const el = $('#ritmo');
  if (ls.length < 3) { el.innerHTML = ''; return; }
  const trozos = [];
  let ref = ls[0].start;
  for (let i = 1; i < ls.length; i++) {
    const hueco = Math.max(.15, ls[i].start - ref);
    ref = ls[i].start;
    const wps = ls[i].text.split(' ').length / hueco;
    const p = wps > 3.2 ? '1' : wps < 1.6 ? '2' : '';
    trozos.push(`<i style="flex:${hueco.toFixed(2)} 1 0" ${p ? `data-p="${p}"` : ''} ` +
                `title="${mmss(ls[i].start)} · ${wps.toFixed(1)} palabras/s"></i>`);
  }
  el.innerHTML = trozos.join('');
}

function pintaBarras(b) {
  const ol = $('#barras');
  const url = b.url || `https://youtu.be/${b.video_id}`;
  ol.innerHTML = b.lines.map((l, i) => `
    <li class="barra" id="barra-${i}" data-i="${i}">
      <a class="t" href="${url}&t=${Math.floor(l.start)}s" target="_blank" rel="noopener"
         title="Ver en YouTube en ${mmss(l.start)}">${mmss(l.start)}</a>
      <span class="txt"><span class="n">${i + 1}</span>${escapa(l.text)}</span>
    </li>`).join('');
}

async function abre(id, { fresca = true } = {}) {
  let b;
  try { b = await cargaBatalla(id); }
  catch (e) { $('#ficha').textContent = 'No se pudo cargar esa batalla.'; return; }

  ACTUAL = id;
  const meta = INDICE.find(x => x.video_id === id) || {};
  const m = { ...meta, ...b };

  $('#vacio').hidden = true;
  const acta = $('#acta');
  acta.hidden = false;
  acta.dataset.fresh = fresca ? '1' : '0';

  $('#careo').innerHTML = careoHTML(m);
  const partes = [
    m.event, m.round, m.year,
    m.format,
    `${nf.format(m.n_lines)} barras`,
    `${nf.format(m.n_words)} palabras`,
    `${m.wpm || 0} palabras/min`,
    `${mmss(m.duration_s || 0)} de vídeo`,
  ].filter(Boolean);
  $('#ficha').innerHTML = `${escapa(partes.join(' — '))} · ` +
    `<a href="${m.url}" target="_blank" rel="noopener">vídeo original</a>`;

  pintaRitmo(m);
  pintaBarras(m);
  $('#lector').scrollTop = 0;
  document.querySelectorAll('.item[data-id]').forEach(el => {
    el.setAttribute('aria-current', String(el.dataset.id === id));
  });
  pintaMuro();

  // primera animación: se escalona en una sola pasada
  if (fresca && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const bs = document.querySelectorAll('#barras .barra');
    bs.forEach((el, i) => { el.style.animationDelay = Math.min(i * 4, 320) + 'ms'; });
    setTimeout(() => bs.forEach(el => el.style.animationDelay = ''), 900);
  }
  acta.dataset.fresh = '0';
  setTimeout(() => { acta.dataset.fresh = fresca ? '1' : '0'; }, 1000);
}

/* ---------- navegación con teclado ---------- */

let cursor = -1;

function mueveBarras(d) {
  const bs = document.querySelectorAll('#barras .barra');
  if (!bs.length) return;
  cursor = Math.max(0, Math.min(bs.length - 1, cursor + d));
  bs.forEach((el, i) => el.dataset.actual = String(i === cursor));
  bs[cursor].scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function mueveBatalla(d) {
  const i = FILTRO.findIndex(b => b.video_id === ACTUAL);
  const j = Math.max(0, Math.min(FILTRO.length - 1, (i < 0 ? 0 : i + d)));
  if (FILTRO[j]) { cursor = -1; abre(FILTRO[j].video_id); }
}

/* ---------- eventos ---------- */

function conectaEventos() {
  let t = null;
  $('#q').addEventListener('input', e => {
    busqueda.q = e.target.value.trim();
    busqueda.hits = null;
    clearTimeout(t);
    t = setTimeout(() => {
      filtra();
      pintaLista();
      pintaMuro();
      if (busqueda.full && busqueda.q.length >= 3) buscaEnTexto(norm(busqueda.q));
    }, 220);
  });

  $('#fulltext').addEventListener('change', e => {
    busqueda.full = e.target.checked;
    busqueda.hits = null;
    if (busqueda.full && busqueda.q.length >= 3) buscaEnTexto(norm(busqueda.q));
    else pintaLista();
  });

  document.addEventListener('click', e => {
    const barra = e.target.closest('.muro b');
    if (barra) { cursor = -1; abre(barra.dataset.id); return; }
    const item = e.target.closest('.item[data-id]');
    if (item) { cursor = -1; abre(item.dataset.id); return; }
    const linea = e.target.closest('.barra');
    if (linea) {
      cursor = Number(linea.dataset.i);
      document.querySelectorAll('#barras .barra').forEach((el, i) =>
        el.dataset.actual = String(i === cursor));
    }
  });

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.key === '/') { e.preventDefault(); $('#q').focus(); return; }
    if (e.key === 'j') { e.preventDefault(); mueveBarras(1); }
    else if (e.key === 'k') { e.preventDefault(); mueveBarras(-1); }
    else if (e.key === 'n') { e.preventDefault(); mueveBatalla(1); }
    else if (e.key === 'p') { e.preventDefault(); mueveBatalla(-1); }
  });
}

/* ---------- arranque ---------- */

(async function inicia() {
  const r = await fetch('data/index.json');
  INDICE = await r.json();
  INDICE.sort((a, b) => (b.year || 0) - (a.year || 0) ||
                        String(a.mcs || a.title).localeCompare(String(b.mcs || b.title), 'es'));
  FILTRO = INDICE.slice();
  pintaCorpus();
  pintaLista();
  pintaMuro();
  conectaEventos();
  const primera = INDICE.find(b => b.event && b.event.includes('FU'));
  if (primera) abre(primera.video_id, { fresca: false });
})();
