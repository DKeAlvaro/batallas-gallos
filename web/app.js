/* Acta de barras — lector y visor del corpus.
   Sin dependencias. Los datos vienen de data/index.js (window.CORPUS), asi que la
   pagina abre tambien con file://. La rima se calcula aqui, en el navegador: el
   dataset no la trae. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const CORPUS = window.CORPUS || [];
const PUEDE_PEDIR = location.protocol !== 'file:';
const PAGINA = 120;
const LOTE_TEXTO = 10;
const MAX_HITS = 30;
const PALABRAS_BARRA = 12;     // una "barra" aproximada: 4x4 suele ir por ahi
const VENTANA_CADENA = 4;      // barras seguidas para considerar cadena de rima

const nf = new Intl.NumberFormat('es-ES');

let filtro = CORPUS.slice();
let mostradas = PAGINA;
let actual = null;
let cursor = -1;
let cache = new Map();
let texto = { q: '', on: false, hits: null, token: 0 };
let soloRimas = false;

/* ---------- utilidades ---------- */

const mmss = s => {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`
           : `${m}:${String(x).padStart(2, '0')}`;
};

const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const escapa = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

/* ---------- rima ---------- */

/* nucleo de rima: desde la vocal tonica hasta el final (convencion de rima
   consonante en espanol). El acento escrito manda; si no, se aplica la regla
   de palabras llanas (terminadas en vocal, n o s).
   "corazon" -> "on"   "camino" -> "ino"   "cantar" -> "ar"   "musica" -> "ica" */
function nucleoRima(palabra) {
  const w = String(palabra || '').toLowerCase().replace(/[^a-záéíóúüñ]/g, '');
  if (w.length < 2) return null;

  const mapa = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u' };
  let plano = '', tonica = -1;
  for (let i = 0; i < w.length; i++) {
    const c = w[i];
    if ('áéíóú'.includes(c)) tonica = i;
    plano += mapa[c] || c;
  }

  const vocales = [];
  for (let i = 0; i < plano.length; i++) if ('aeiou'.includes(plano[i])) vocales.push(i);
  if (!vocales.length) return null;

  let ton = tonica;
  if (ton < 0) {
    ton = (/[aeiouns]$/.test(plano) && vocales.length > 1)
      ? vocales[vocales.length - 2]
      : vocales[vocales.length - 1];
  }

  const cola = plano.slice(ton);
  return cola.length >= 2 ? cola : null;
}

/* parte la transcripcion en barras. Corta al final de una linea de subtitulo
   (que sigue las pausas del habla) en cuanto pasa de ~10 palabras, para que la
   ultima palabra de la barra sea una palabra real y no un corte a ciegas. */
function aBarras(lines) {
  const barras = [];
  let actual = [];
  let n = 0;
  const cierra = () => { if (actual.length) { barras.push(actual.join(' ')); actual = []; n = 0; } };
  for (const cruda of lines || []) {
    // fuera las anotaciones del ASR: [musica], [Aplausos], [Risas]
    const t = String(cruda || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const trozos = t.split(/\s+/).length > 22 ? t.split(/(?<=[,;.!?])\s+/) : [t];
    for (const tr of trozos) {
      actual.push(tr);
      n += tr.split(/\s+/).length;
      if (n >= 10) cierra();
    }
  }
  cierra();
  return barras;
}

const SIN_RIMA = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'y', 'o', 'u', 'e', 'que', 'en', 'a', 'al', 'con', 'por', 'para', 'se', 'le', 'les',
  'mi', 'tu', 'su', 'mis', 'tus', 'sus', 'es', 'son', 'esta', 'este', 'esto', 'mas', 'muy',
  'ya', 'si', 'no', 'ni', 'como', 'lo', 'me', 'te', 'nos', 'os', 'tan', 'sin', 'sobre']);

/* analiza las barras: clave de rima, familias repetidas, cadenas */
function analizaRima(barras) {
  const palabraFinal = texto => {
    const trozos = texto.split(/\s+/);
    for (let k = trozos.length - 1, vistos = 0; k >= 0 && vistos < 4; k--, vistos++) {
      const bruta = trozos[k];
      const limpia = bruta.toLowerCase().replace(/[^a-záéíóúüñ]/g, '');
      if (!limpia || SIN_RIMA.has(limpia)) continue;
      const cola = nucleoRima(limpia);
      if (cola) return { palabra: bruta, cola, pos: texto.lastIndexOf(bruta), letras: limpia.length };
    }
    return { palabra: '', cola: null, pos: -1, letras: 0 };
  };

  const datos = barras.map((texto, i) => {
    const { palabra, cola, pos, letras } = palabraFinal(texto);
    return { i, texto, palabra, cola, pos, letras, familia: null, cadena: false, color: null };
  });

  // familias: solo las claves que aparecen 2+ veces en la batalla
  const cuenta = new Map();
  datos.forEach(d => { if (d.cola) cuenta.set(d.cola, (cuenta.get(d.cola) || 0) + 1); });
  const familias = Array.from(cuenta, ([k, v]) => ({ k, v }))
    .filter(f => f.v >= 2).sort((a, b) => b.v - a.v || a.k.localeCompare(b.k));
  familias.forEach((f, n) => { f.color = `var(--r${(n % 6) + 1})` });
  const porClave = new Map(familias.map(f => [f.k, f]));
  datos.forEach(d => { const f = porClave.get(d.cola); if (f) { d.familia = f; d.color = f.color; } });

  // cadena: misma clave repetida dentro de una ventana de barras seguidas
  let mejor = 0, corriendo = 0, previa = null, previaI = -99;
  datos.forEach(d => {
    if (d.cola && d.cola === previa && d.i - previaI <= VENTANA_CADENA) {
      corriendo++;
      d.cadena = true;
      datos[d.i - 1] && (datos[d.i - 1].cadena = true);
    } else corriendo = 1;
    mejor = Math.max(mejor, corriendo);
    if (d.cola) { previa = d.cola; previaI = d.i; }
  });

  const conRima = datos.filter(d => d.cola).length;
  const repetidas = datos.filter(d => d.familia).length;
  return {
    datos, familias, mejorCadena: mejor,
    conRima, repetidas,
    densidad: datos.length ? Math.round((repetidas / datos.length) * 100) : 0,
    top: familias.slice(0, 3).map(f => f.k),
  };
}

/* ---------- cabecera y corpus ---------- */

function pintaCifras() {
  const lineas = CORPUS.reduce((s, b) => s + (b.n_lines || 0), 0);
  const palabras = CORPUS.reduce((s, b) => s + (b.n_words || 0), 0);
  const horas = CORPUS.reduce((s, b) => s + (b.duration_s || 0), 0) / 3600;
  const mcs = new Set();
  CORPUS.forEach(b => (b.mcs || []).forEach(m => mcs.add(norm(m))));
  $('#cifras').innerHTML = [
    ['batallas', nf.format(CORPUS.length)],
    ['líneas de habla', nf.format(lineas)],
    ['palabras', nf.format(palabras)],
    ['horas de vídeo', horas.toFixed(0)],
    ['MCs distintos', nf.format(mcs.size)],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

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
    <ul class="barras-dato">${html}</ul></div>`;
}

function pintaCorpus() {
  const cuenta = clave => {
    const m = new Map();
    CORPUS.forEach(b => clave(b).forEach(k => k && m.set(k, (m.get(k) || 0) + 1)));
    return Array.from(m, ([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
  };
  const anios = new Map();
  CORPUS.forEach(b => { if (b.year) anios.set(b.year, (anios.get(b.year) || 0) + 1); });
  const filasAnio = Array.from(anios, ([k, v]) => ({ k: String(k), v })).sort((a, b) => a.k.localeCompare(b.k));

  const mcs = cuenta(b => (b.mcs || []).map(m => m.trim()));
  const parejas = new Map();
  CORPUS.forEach(b => {
    const m = (b.mcs || []).map(x => x.trim()).filter(Boolean).sort();
    for (let i = 0; i < m.length; i++)
      for (let j = i + 1; j < m.length; j++) {
        const k = `${m[i]} / ${m[j]}`;
        parejas.set(k, (parejas.get(k) || 0) + 1);
      }
  });
  const filasParejas = Array.from(parejas, ([k, v]) => ({ k, v })).filter(x => x.v > 1).sort((a, b) => b.v - a.v);

  const largas = CORPUS.slice().sort((a, b) => (b.n_words || 0) - (a.n_words || 0)).slice(0, 12)
    .map(b => ({ k: (b.mcs && b.mcs.length ? b.mcs.join(' vs ') : b.title), v: b.n_words || 0 }));

  $('#graficas').innerHTML = [
    bloque('Batallas por año', 'Cuándo se disputaron.', filasAnio, 40),
    bloque('MCs con más batallas', 'Una vez por batalla, sea 1v1, 2v2 o 4-way.', mcs, 15),
    bloque('Enfrentamientos repetidos', 'Parejas que se han visto más de una vez.', filasParejas, 12),
    bloque('Formato', 'Cuánta gente por batalla.', cuenta(b => (b.format ? [b.format] : [])), 6),
    bloque('Eventos con más batallas', 'Ligas, plazas y finales.', cuenta(b => (b.event ? [b.event] : [])), 15),
    bloque('Las más largas', 'Palabras por batalla.', largas, 12),
  ].join('');
}

/* ---------- lista ---------- */

function pintaLista() {
  const q = texto.on && texto.hits ? texto.q : '';
  const lista = $('#lista');

  if (texto.on && texto.hits) {
    lista.innerHTML = texto.hits.length
      ? texto.hits.map(h => `<li><button class="fila" data-id="${h.id}" ${actual === h.id ? 'aria-current="true"' : ''}>
          <span class="quien">${h.quien}</span><span class="donde">${h.fragmento}</span></button></li>`).join('')
      : '<li><p class="vacio">Ninguna batalla contiene esa palabra.</p></li>';
    $('#recuento').textContent = `${texto.hits.length} coincidencias`;
    $('#mas').hidden = true;
    return;
  }

  let html = '', anio = '__';
  for (const b of filtro.slice(0, mostradas)) {
    const a = b.year || 'sin año';
    if (a !== anio) { anio = a; html += `<li class="grupo">${a}</li>`; }
    const quien = b.mcs && b.mcs.length
      ? b.mcs.map(m => resalta(m, q)).join(' <span style="color:var(--tenue)">vs</span> ')
      : resalta(b.title || b.video_id, q);
    const donde = [b.event, b.round, b.format].filter(Boolean).join(' · ');
    html += `<li><button class="fila" data-id="${b.video_id}" ${actual === b.video_id ? 'aria-current="true"' : ''}>
      <span class="quien">${quien}</span><span class="donde">${resalta(donde, q)}</span></button></li>`;
  }
  lista.innerHTML = html || '<li><p class="vacio">Nada con ese filtro.</p></li>';
  $('#recuento').textContent = `${nf.format(filtro.length)} batallas`;
  const mas = $('#mas');
  mas.hidden = filtro.length <= mostradas;
  mas.textContent = `Mostrar más (${nf.format(filtro.length - mostradas)})`;
}

function aplicaFiltro() {
  const q = norm(texto.q);
  filtro = !q ? CORPUS.slice() : CORPUS.filter(b =>
    norm(b.title).includes(q) || norm(b.event).includes(q) ||
    norm(b.round).includes(q) || norm((b.mcs || []).join(' ')).includes(q));
  mostradas = PAGINA;
  pintaLista();
}

/* ---------- busqueda en el texto ---------- */

async function buscaTexto(q) {
  const token = ++texto.token;
  const ids = CORPUS.filter(b => b.n_words).map(b => b.video_id);
  const hits = [];
  const prog = $('#progreso');
  prog.hidden = false;
  let vistas = 0;
  for (let i = 0; i < ids.length && hits.length < MAX_HITS; i += LOTE_TEXTO) {
    if (token !== texto.token) return;
    const res = await Promise.all(ids.slice(i, i + LOTE_TEXTO).map(async id => {
      try { return [id, await carga(id)]; } catch { return null; }
    }));
    for (const r of res) {
      if (!r) continue;
      const [id, d] = r;
      vistas++;
      const linea = d.lines.find(l => norm(l).includes(q));
      if (!linea) continue;
      const meta = CORPUS.find(b => b.video_id === id) || {};
      hits.push({
        id,
        quien: escapa(meta.mcs && meta.mcs.length ? meta.mcs.join(' vs ') : meta.title || id),
        fragmento: resalta(linea, texto.q),
      });
    }
    if (token !== texto.token) return;
    prog.textContent = `${nf.format(vistas)}/${nf.format(ids.length)} · ${hits.length} coincidencias`;
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

function dibujaVacio(msg) { $('#lector').innerHTML = `<p class="vacio">${escapa(msg)}</p>`; }

function barraHTML(d) {
  const texto = escapa(d.texto);
  let cuerpo = texto;
  if (d.cola && d.pos >= 0) {
    const corte = d.pos + d.letras - d.cola.length;
    cuerpo = escapa(d.texto.slice(0, corte)) +
             `<span class="cola" style="--c:${d.color || 'transparent'}">${escapa(d.texto.slice(corte))}</span>`;
  }
  const clave = d.familia ? `<em>rima</em> ${escapa(d.cola)}` : (d.cola ? escapa(d.cola) : '—');
  return `<li class="barra" id="barra-${d.i}" data-i="${d.i}" data-cadena="${d.cadena ? 1 : 0}">
    <span class="n">${d.i + 1}</span>
    <span class="dice">${cuerpo}</span>
    <span class="clave" style="--c:${d.color || 'inherit'}">${clave}</span></li>`;
}

function dibujaBatalla(b, meta) {
  const m = { ...(meta || {}), ...b };
  const nombre = (m.mcs || []).map(escapa);
  const titulo = nombre.length > 1
    ? `${nombre.slice(0, -1).join(', ')}<span class="contra">contra</span>${nombre[nombre.length - 1]}`
    : escapa(m.title || m.video_id);

  const rima = analizaRima(aBarras(m.lines));
  const ficha = [m.event, m.round, m.year, m.format,
    `${nf.format(m.n_lines)} líneas`, `${nf.format(m.n_words)} palabras`,
    `${mmss(m.duration_s)} de vídeo`].filter(Boolean).map(escapa).join(' · ');

  const leyenda = rima.familias.slice(0, 6).map(f =>
    `<i style="color:${f.color}"></i>${escapa(f.k)}`).join(' ');

  $('#lector').innerHTML = `
    <div class="cabecera-batalla">
      <h2 class="titulo-batalla">${titulo}</h2>
      <p class="ficha">${ficha} · <a href="${m.url}" target="_blank" rel="noopener">vídeo</a>
        · <a href="data/battles/${m.video_id}.json" target="_blank">JSON</a></p>
      <dl class="rima-cifras">
        <div><dt>barras</dt><dd>${nf.format(rima.datos.length)}</dd></div>
        <div><dt>con rima repetida</dt><dd>${rima.densidad}%</dd></div>
        <div><dt>familias</dt><dd>${nf.format(rima.familias.length)}</dd></div>
        <div><dt>cadena más larga</dt><dd>${rima.mejorCadena}</dd></div>
        ${rima.top.length ? `<div><dt>más usadas</dt><dd>${rima.top.map(escapa).join(', ')}</dd></div>` : ''}
      </dl>
      <div class="control-rima">
        <label><input type="checkbox" id="solo-rimas"> solo barras con rima repetida</label>
        ${leyenda ? `<span class="leyenda">${leyenda}</span>` : ''}
      </div>
    </div>
    <ol class="barras">${rima.datos.map(barraHTML).join('')}</ol>`;

  $('#solo-rimas').checked = soloRimas;
  aplicaSoloRimas();
  $('#lector').dataset.nueva = '1';
  setTimeout(() => { $('#lector').dataset.nueva = '0'; }, 300);
}

function aplicaSoloRimas() {
  $$('#lector .barra').forEach(el => {
    const tiene = el.querySelector('.clave em') !== null;
    el.hidden = soloRimas && !tiene;
  });
}

async function abre(id) {
  actual = id;
  cursor = -1;
  $$('.fila[data-id]').forEach(el => el.setAttribute('aria-current', String(el.dataset.id === id)));
  if (!PUEDE_PEDIR) {
    dibujaVacio('Abierto con file://: el navegador no deja leer las transcripciones. ' +
                'Sirve la carpeta (por ejemplo `python3 -m http.server`) y recarga.');
    return;
  }
  $('#lector').innerHTML = '<p class="cargando">Cargando…</p>';
  try {
    dibujaBatalla(await carga(id), CORPUS.find(x => x.video_id === id));
    $('#lector').scrollTop = 0;
  } catch (e) {
    console.error('abre(' + id + '):', e);
    dibujaVacio('No se pudo cargar esa transcripción.');
  }
}

/* ---------- teclado y eventos ---------- */

function mueveBarra(d) {
  const b = $$('#lector .barra:not([hidden])');
  if (!b.length) return;
  cursor = Math.max(0, Math.min(b.length - 1, cursor + d));
  b.forEach((el, i) => el.dataset.actual = String(i === cursor));
  b[cursor].scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function mueveBatalla(d) {
  const i = filtro.findIndex(b => b.video_id === actual);
  const j = Math.max(0, Math.min(filtro.length - 1, (i < 0 ? 0 : i + d)));
  if (filtro[j]) abre(filtro[j].video_id);
}

function ponPestana(cual) {
  const lector = cual === 'lector';
  $('#tab-lector').setAttribute('aria-selected', String(lector));
  $('#tab-corpus').setAttribute('aria-selected', String(!lector));
  $('#panel-lector').hidden = !lector;
  $('#panel-corpus').hidden = lector;
  if (!lector) $('#cifras').hidden = false;
}

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
    else { aplicaFiltro(); }
  });

  $('#mas').addEventListener('click', () => { mostradas += PAGINA; pintaLista(); });

  $('#lista').addEventListener('click', e => {
    const b = e.target.closest('.fila');
    if (b) abre(b.dataset.id);
  });

  $('#lector').addEventListener('change', e => {
    if (e.target.id === 'solo-rimas') { soloRimas = e.target.checked; aplicaSoloRimas(); }
  });

  $('#lector').addEventListener('click', e => {
    const b = e.target.closest('.barra');
    if (!b || e.target.closest('a')) return;
    cursor = Number(b.dataset.i);
    $$('#lector .barra').forEach(el => el.dataset.actual = String(Number(el.dataset.i) === cursor));
  });

  $('#tab-lector').addEventListener('click', () => ponPestana('lector'));
  $('#tab-corpus').addEventListener('click', () => ponPestana('corpus'));

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.key === '/') { e.preventDefault(); $('#q').focus(); return; }
    if (!$('#panel-corpus').hidden) return;
    if (e.key === 'j') { e.preventDefault(); mueveBarra(1); }
    else if (e.key === 'k') { e.preventDefault(); mueveBarra(-1); }
    else if (e.key === 'n') { e.preventDefault(); mueveBatalla(1); }
    else if (e.key === 'p') { e.preventDefault(); mueveBatalla(-1); }
  });
}

/* ---------- arranque ---------- */

(function inicia() {
  if (!CORPUS.length) { dibujaVacio('No se han cargado los datos: falta data/index.js.'); return; }
  if (!PUEDE_PEDIR) $('#lbl-full').style.display = 'none';
  CORPUS.sort((a, b) => (b.year || 0) - (a.year || 0) ||
    String(a.mcs || a.title).localeCompare(String(b.mcs || b.title), 'es'));
  filtro = CORPUS.slice();
  pintaCifras();
  pintaLista();
  pintaCorpus();
  conecta();
})();
