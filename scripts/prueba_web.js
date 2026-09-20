/* Prueba de humo sin navegador: DOM falso + datos reales.
   Ejecuta app.js entero y revienta si algo peta. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = path.join(__dirname, '..', 'web');
const errores = [];

function nodo(tag = 'div') {
  const clases = new Set();
  const el = {
    tagName: tag.toUpperCase(),
    innerHTML: '', textContent: '', hidden: false, style: {}, dataset: {},
    children: [], _attrs: {}, _eventos: {},
    addEventListener(k, f) { (el._eventos[k] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { el._attrs[k] = String(v); },
    getAttribute(k) { return el._attrs[k]; },
    insertAdjacentHTML(_, h) { el.innerHTML += h; },
    closest() { return null; },
    querySelector(s) { return nodo(s); },
    querySelectorAll() { return []; },
    scrollIntoView() {},
    focus() {},
    blur() {},
    matches() { return false; },
    classList: { add: c => clases.add(c), remove: c => clases.delete(c), contains: c => clases.has(c) },
  };
  return el;
}

const registro = new Map();
const documento = {
  querySelector(s) { if (!registro.has(s)) registro.set(s, nodo(s)); return registro.get(s); },
  querySelectorAll() { return []; },
  addEventListener() {},
  createElement: t => nodo(t),
};

const ventana = { CORPUS: null, addEventListener() {}, matchMedia: () => ({ matches: false }) };
const BDIR = path.join(WEB, 'data', 'battles');
const red = url => {
  const m = /battles\/([^/]+)\.json$/.exec(url);
  if (!m) return Promise.resolve({ ok: false, status: 404 });
  const p = path.join(BDIR, m[1] + '.json');
  if (!fs.existsSync(p)) return Promise.resolve({ ok: false, status: 404 });
  return Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) });
};
const ctx = {
  window: ventana, document: documento, location: { protocol: 'http:' },
  console, fetch: red,
  setTimeout, clearTimeout, Intl, Map, Set, Array, Math, JSON, String, Number, Promise,
};
ctx.globalThis = ctx;
vm.createContext(ctx);

// datos reales
vm.runInContext(fs.readFileSync(path.join(WEB, 'data', 'index.js'), 'utf8'), ctx, { filename: 'index.js' });
const corpus = ventana.CORPUS;
if (!Array.isArray(corpus) || !corpus.length) throw new Error('index.js no carga el corpus');
console.log('corpus cargado:', corpus.length, 'batallas');

try {
  vm.runInContext(fs.readFileSync(path.join(WEB, 'app.js'), 'utf8'), ctx, { filename: 'app.js' });
} catch (e) { errores.push('app.js: ' + e.message); }

for (const [sel, el] of registro) {
  if (el.innerHTML && el.innerHTML.includes('undefined')) errores.push(`"undefined" en ${sel}`);
}
// cifras y graficas deben haberse pintado
const cifras = registro.get('#cifras');
const graf = registro.get('#graficas');
const lista = registro.get('#lista');
if (!cifras || !cifras.innerHTML) errores.push('no se pintaron las cifras');
if (!graf || !graf.innerHTML) errores.push('no se pintaron las graficas');
if (!lista || !lista.innerHTML) errores.push('no se pinto la lista');
console.log('cifras:', (cifras?.innerHTML || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90));
console.log('lista filas:', (lista?.innerHTML.match(/class="fila"/g) || []).length);
console.log('bloques corpus:', (graf?.innerHTML.match(/class="bloque"/g) || []).length);

// probar la apertura real de una batalla (transcripcion -> barras + rimas)
const id = corpus.find(b => b.n_words > 400).video_id;
(async () => {
  try { await vm.runInContext(`abre(${JSON.stringify(id)})`, ctx); }
  catch (e) { errores.push('abre(): ' + e.message); }
  const lector = registro.get('#lector');
  const barras = (lector.innerHTML.match(/class="barra"/g) || []).length;
  const rimas = (lector.innerHTML.match(/<em>rima<\/em>/g) || []).length;
  if (!barras) errores.push('no se pintaron barras al abrir ' + id);
  if (!rimas) errores.push('el analisis de rima no encontro ninguna familia en ' + id);
  console.log('batalla abierta:', id, '->', barras, 'barras,', rimas, 'con rima repetida');

  // el nucleo de rima debe acertar casos conocidos
  const casos = [['corazón', 'on'], ['razón', 'on'], ['camino', 'ino'], ['cantar', 'ar'],
                 ['correr', 'er'], ['casa', 'asa'], ['felicidad', 'ad'], ['música', 'usica'],
                 ['camión', 'on'], ['perdón', 'on'], ['rapero', 'ero'], ['final', 'al']];
  for (const [palabra, esperado] of casos) {
    const got = vm.runInContext(`nucleoRima(${JSON.stringify(palabra)})`, ctx);
    if (got !== esperado) errores.push(`rima de "${palabra}": ${got} (esperado ${esperado})`);
  }
  console.log('nucleoRima comprobado en', casos.length, 'palabras');

  const ej = JSON.parse(fs.readFileSync(path.join(BDIR, id + '.json'), 'utf8'));
  console.log('tipo de linea:', typeof ej.lines[0], '| timestamps:', ej.lines[0].start !== undefined);
  if (lector.innerHTML.includes('undefined')) errores.push('"undefined" en la transcripcion');

  if (errores.length) { console.error('\nFALLOS:\n- ' + errores.join('\n- ')); process.exit(1); }
  console.log('\nOK: la app arranca, pinta el corpus, abre una batalla y mide rimas');
})();
