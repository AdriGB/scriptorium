import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const elements = new Map([
    ['sysPrompt', { value: 'Protege a {{char}} y escucha a {{user}}.' }],
    ['charName', { value: 'Alice' }],
    ['userName', { value: 'Bob' }]
]);

globalThis.document = {
    getElementById(id) { return elements.get(id) || null; }
};

let clipboardText = '';
Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { async writeText(text) { clipboardText = text; } } }
});

const { default: state } = await import('../js/state.js');
const { buildExp } = await import('../js/chara-card.js');
const { copyAll } = await import('../js/export.js');

state.file.uploaded = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: { name: 'Original', description: 'Original', first_mes: 'Original greeting' }
};
state.proc.data = {};
state.characterBook = {
    present: true,
    metadata: { name: 'Mundo', description: 'Lore principal' },
    entries: [{ name: 'Norte', keys: ['reino', 'norte'], content: 'Contenido del lore.', enabled: true, insertion_order: 0, extensions: {} }]
};
state.altGreetings = {
    original: 'Saludo original',
    list: ['Saludo alternativo A', 'Saludo alternativo B'],
    current: 1
};

const beforeProcessing = buildExp();
assert.equal(beforeProcessing.data.system_prompt, 'Protege a Alice y escucha a Bob.');
assert.equal(beforeProcessing.data.description, 'Original');

state.proc.data = { description: 'Descripcion procesada', first_mes: 'Saludo seleccionado' };
const exported = buildExp();
assert.equal(exported.data.system_prompt, 'Protege a Alice y escucha a Bob.');
assert.equal(exported.data.description, 'Descripcion procesada');
assert.equal(exported.data.character_book.entries[0].content, 'Contenido del lore.');
assert.deepEqual(exported.data.alternate_greetings, ['Saludo original', 'Saludo alternativo B']);

await copyAll();
assert.match(clipboardText, /=== SYSTEM PROMPT GLOBAL ===/);
assert.match(clipboardText, /=== DESCRIPTION ===\nDescripcion procesada/);
assert.match(clipboardText, /=== LOREBOOK ===/);
assert.match(clipboardText, /Claves: reino, norte/);
assert.match(clipboardText, /Estado: Activada/);
assert.match(clipboardText, /=== SALUDOS ALTERNATIVOS ===/);
assert.match(clipboardText, /Saludo alternativo B/);

elements.get('sysPrompt').value = '';
state.proc.data.system_prompt_global = 'Prompt obsoleto';
const withoutGlobalPrompt = buildExp();
assert.equal(withoutGlobalPrompt.data.system_prompt, undefined);
await copyAll();
assert.doesNotMatch(clipboardText, /Prompt obsoleto/);

const serviceWorkerSource = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
assert.match(serviceWorkerSource, /scriptorium-v1\.2\.3/);
assert.match(serviceWorkerSource, /fetch\(request, \{ cache: 'no-store' \}\)/);
assert.doesNotMatch(serviceWorkerSource, /cache\.put\('\.\/index\.html'/);
assert.match(appSource, /controllerchange/);
assert.match(appSource, /isLocalDevelopment/);
assert.match(appSource, /renderJSONSafely\(true\)/);

/* ── Regresiones estructurales de UX ──
   Blinda el Tier 1: dialogo tematico en lugar de los nativos, focus trap activo
   y los elementos nuevos presentes en el HTML. */
const jsDir = new URL('../js/', import.meta.url);
const jsFiles = (await readdir(jsDir)).filter(f => f.endsWith('.js'));

let nativeConfirms = 0;
let trapFocusCalls = 0;
for (const file of jsFiles) {
    const src = await readFile(new URL(file, jsDir), 'utf8');
    // Cuenta solo `confirm(` suelto: excluye window.confirm (fallback deliberado)
    // y no confunde con confirmDialog( / closeConfirmDialog(.
    nativeConfirms += (src.match(/(?<![\w.])confirm\(/g) || []).length;
    trapFocusCalls += (src.match(/trapFocus\(/g) || []).length;
}
assert.equal(nativeConfirms, 0, 'Quedan dialogos nativos sin migrar a confirmDialog');
// El import muerto de trapFocus estuvo en el repo sin que nadie lo llamara.
assert.ok(trapFocusCalls >= 2, 'trapFocus debe declararse e invocarse');

const indexSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');
for (const id of ['confirmModal', 'confirmOkBtn', 'confirmCancelBtn', 'confirmExtraBtn', 'toastAction']) {
    assert.match(indexSource, new RegExp(`id="${id}"`), `Falta #${id} en index.html`);
}

// El undo depende de que el snapshot y la sesion del vault compartan forma.
const appSourceFull = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
assert.match(appSourceFull, /function snapState\(\)/);
assert.match(appSourceFull, /async function hydrateFrom\(saved\)/);
assert.match(appSourceFull, /label: 'Deshacer'/);

/* ── Tier 2 de UX ── */

// Buscador de la boveda: filtro propia pestaña y resaltado.
const vaultSource = await readFile(new URL('../js/vault.js', import.meta.url), 'utf8');
assert.match(vaultSource, /function buildExcerpt\(/, 'Falta buildExcerpt()');
assert.match(vaultSource, /const excerpt = highlight\(/, 'La fila debe construir su extracto');
assert.match(vaultSource, /resetSearch\(\);/, 'Al abrir la boveda hay que limpiar el filtro anterior');
assert.match(vaultSource, /id="vaultSearch"/);
assert.match(vaultSource, /id="vaultSearchCount"/);

// Sidebar: grupos no excluyentes y con estado persistido (la clave existia sin usarse).
const uiSource = await readFile(new URL('../js/ui.js', import.meta.url), 'utf8');
assert.doesNotMatch(uiSource, /other\.open = false/, 'El acordeon del sidebar volvio a ser excluyente');
assert.match(uiSource, /STORAGE_KEYS\.SIDEBAR_GROUPS/, 'El estado de los grupos del sidebar no se persiste');

// Buscador principal: contador, resaltado y coincidencia por textContent.
assert.match(uiSource, /\$\('searchCount'\)/, 'El contador #searchCount existe en el HTML pero no se usa');
assert.match(uiSource, /function highlightCard\(/);
// Con innerText una tarjeta ya oculta deja de coincidir y no vuelve a aparecer nunca.
const cardTextFn = uiSource.match(/function cardText\(card\)\s*\{[\s\S]*?\n\}/);
assert.ok(cardTextFn, 'Falta cardText() en ui.js');
assert.doesNotMatch(cardTextFn[0], /innerText/, 'cardText debe usar textContent, no innerText');
assert.match(cardTextFn[0], /textContent/);
assert.match(uiSource, /fields:rendered/, 'Sin reaplicar la busqueda tras repintar, el filtro se pierde');

// El lorebook usa la misma estructura .field-card, asi que el buscador tambien aplica.
assert.doesNotMatch(uiSource, /id === 'tabJson' \|\| id === 'tabLorebook'/, 'El buscador volvio a ocultarse en el lorebook');
assert.match(uiSource, /\$\('processedView'\), \$\('rawView'\), \$\('lorebookView'\)/, 'El filtro debe cubrir las tres vistas de campos');

// Empty states en las vistas de campos.
const editorSource = await readFile(new URL('../js/editor.js', import.meta.url), 'utf8');
assert.match(editorSource, /export function emptyFieldsState\(/);
assert.match(editorSource, /fields:rendered/);
// renderRaw, renderProc (vacio y con datos) y renderLorebook.
assert.ok((editorSource.match(/announceRender\(\)/g) || []).length >= 4, 'Falta anunciar el repintado en alguna vista');

/* ── Tier 3: UI muerta cableada ── */
assert.match(appSourceFull, /initShortcutsModal\(\)/, 'El modal de atajos no se inicializa');
assert.match(appSourceFull, /initWelcome\(\)/, 'El panel de bienvenida no se inicializa');
assert.match(appSourceFull, /closeShortcuts\(\)/, 'Esc no cierra el modal de atajos');
assert.match(appSourceFull, /refreshProcessHint\(\)/, 'El #processHint sigue sin usar');
// El focus trap se resuelve por una lista de ids: el modal tiene que estar en ella.
assert.match(uiSource, /const MODAL_IDS = \[[^\]]*'shortcutsModal'/);
assert.match(uiSource, /STORAGE_KEYS\.SEEN_WELCOME/);

/* ── Identificadores sin declarar en template literals ──
   `${excerpt}` estuvo en vault.js sin definirse: esbuild lo empaqueta igual y
   solo revienta en tiempo de ejecucion, al pintar la lista de la boveda. */
const GLOBALS = new Set([
    'window', 'document', 'console', 'navigator', 'location', 'localStorage', 'sessionStorage',
    'indexedDB', 'IDBKeyRange', 'alert', 'structuredClone', 'performance',
    'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'RegExp', 'Error',
    'TypeError', 'RangeError', 'SyntaxError', 'Set', 'Map', 'WeakSet', 'WeakMap', 'Promise',
    'Symbol', 'Proxy', 'Reflect', 'Intl', 'BigInt',
    'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Int32Array',
    'Float32Array', 'Float64Array', 'ArrayBuffer', 'DataView', 'TextDecoder', 'TextEncoder',
    'Blob', 'File', 'FileReader', 'FileList', 'FormData', 'URL', 'URLSearchParams', 'Event',
    'CustomEvent', 'EventTarget', 'NodeFilter', 'Node', 'Element', 'HTMLElement', 'Image',
    'MutationObserver', 'IntersectionObserver', 'ResizeObserver', 'AbortController', 'DOMParser',
    'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout',
    'setInterval', 'clearInterval', 'queueMicrotask', 'fetch', 'Headers', 'Request', 'Response',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
    'encodeURI', 'decodeURI', 'globalThis', 'undefined', 'NaN', 'Infinity', 'true', 'false', 'null'
]);

const DECL_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)|(?:\bfunction\s*\*?\s*)([A-Za-z_$][\w$]*)|(?:\bclass\s+)([A-Za-z_$][\w$]*)|(?:\bcatch\s*\(\s*)([A-Za-z_$][\w$]*)/g;

/* `let a = 0, b = 0;` — DECL_RE solo recoge el primer nombre de la lista, asi que
   `b` pareceria sin declarar. Se recogen los declaradores siguientes, pero solo
   si su inicializador no lleva comas propias (arrays, objetos, llamadas): ahi la
   coma es ambigua y preferimos no arriesgar. Del ultimo declarador solo importa
   el nombre, asi que su inicializador puede ser cualquier cosa hasta el `;`. */
const MULTI_DECL_RE = /\b(?:const|let|var)\s+((?:[A-Za-z_$][\w$]*\s*(?:=\s*[^,;{}()[\]]*)?\s*,\s*)+[A-Za-z_$][\w$]*\s*(?:=[^;]*)?)/g;

function declaredNames(src) {
    const names = new Set();
    for (const m of src.matchAll(DECL_RE)) names.add(m[1] || m[2] || m[3] || m[4]);
    for (const m of src.matchAll(MULTI_DECL_RE)) {
        for (const part of m[1].split(',')) {
            const id = part.split('=')[0].trim();
            if (/^[A-Za-z_$][\w$]*$/.test(id)) names.add(id);
        }
    }
    /* Destructuring en declaraciones y parametros. Ojo: un `{...}` generico no sirve,
       porque el propio `${x}` del template literal casa con el y daria por declarado
       cualquier identificador. Solo se acepta en posicion de declaracion. */
    const addParts = (list) => {
        for (const part of list.split(',')) {
            const id = part.split(':').pop().trim().replace(/^\.\.\./, '');
            if (/^[A-Za-z_$][\w$]*$/.test(id)) names.add(id);
        }
    };
    for (const m of src.matchAll(/(?:const|let|var)\s*\{([^{}]*)\}/g)) addParts(m[1]);
    for (const m of src.matchAll(/(?:const|let|var)\s*\[([^\]]*)\]/g)) addParts(m[1]);
    for (const m of src.matchAll(/function\s*[A-Za-z_$\w]*\s*\(\s*\{([^{}]*)\}/g)) addParts(m[1]);
    for (const m of src.matchAll(/\(\s*\{([^{}]*)\}\s*\)\s*=>/g)) addParts(m[1]);
    for (const m of src.matchAll(/import\s+([^'";]+?)\s+from/g)) {
        const clause = m[1].trim();
        if (clause.startsWith('*')) { const id = clause.split(/\s+as\s+/)[1]; if (id) names.add(id.trim()); continue; }
        const braced = clause.match(/\{([^}]*)\}/);
        const parts = braced ? braced[1].split(',') : [clause.split(',')[0]];
        for (const part of parts) {
            const id = part.trim().split(/\s+as\s+/).pop().trim();
            if (/^[A-Za-z_$][\w$]*$/.test(id)) names.add(id);
        }
    }
    // Parametros: function f(a, b) {}, (a) => ..., async ({ x }) => {}
    for (const m of src.matchAll(/(?:function\s*[A-Za-z_$\w]*\s*)?\(([^()]*)\)\s*(?:=>|\{|:\s)/g)) {
        for (const part of m[1].split(',')) {
            const id = part.split('=')[0].trim().replace(/^\.\.\./, '').replace(/:\s*[\w<>[\]{}\s.|]+$/, '').trim();
            if (/^[A-Za-z_$][\w$]*$/.test(id)) names.add(id);
        }
    }
    return names;
}

/* ── Logica pura del buscador de la boveda ──
   Se importa el modulo real en vez de replicar la funcion: fue justo aqui donde
   se colo un `${excerpt}` sin definir que reventaba al pintar la lista. */
const { highlight, buildExcerpt } = await import(new URL('../js/vault.js', import.meta.url));

assert.equal(highlight('Ada Lovelace', 'ada'), '<mark class="search-hit">Ada</mark> Lovelace');
assert.equal(highlight('la casa de la pradera', 'la'),
    '<mark class="search-hit">la</mark> casa de <mark class="search-hit">la</mark> pradera');
// El texto se escapa trozo a trozo: ni el HTML del campo ni la query con caracteres
// de expresion regular pueden romper el marcado.
assert.equal(highlight('<b>x</b>', 'b'), '&lt;<mark class="search-hit">b</mark>&gt;x&lt;/<mark class="search-hit">b</mark>&gt;');
assert.equal(highlight('a.b+c', '.'), 'a<mark class="search-hit">.</mark>b+c');
assert.equal(highlight('a & b', ''), 'a &amp; b');

const richChar = { card: { data: { description: 'Palabra inicial. ' + 'Relleno. '.repeat(30) + 'Aqui aparece dragon y sigue el texto.' } } };
const excerpt = buildExcerpt(richChar, 'dragon');
assert.ok(excerpt.includes('dragon'), 'El extracto debe centrarse en la coincidencia');
assert.ok(excerpt.length <= 145, 'El extracto debe estar acotado, mide ' + excerpt.length);
assert.ok(highlight(excerpt, 'dragon').includes('<mark class="search-hit">dragon</mark>'));
assert.equal(buildExcerpt({ card: { data: {} } }, 'x'), '');
assert.ok(buildExcerpt(richChar, 'zzz').endsWith('…'));

/* ── Peso de la carta y marcadores sin sustituir ──
   Helpers puros que alimentan la barra de estado y las insignias. El caso que
   importa es el del nombre vacio: la sustitucion no llega, la carta se exporta
   con las llaves puestas y antes la app decia "Ritual completado". */
const { textStats, statsLabel, countMarkers, HEAVY_CARD } = await import(new URL('../js/utils.js', import.meta.url));

assert.deepEqual(textStats(''), { chars: 0, words: 0, tokens: 0 });
assert.deepEqual(textStats('   '), { chars: 3, words: 0, tokens: 1 });
assert.deepEqual(textStats('Hola mundo'), { chars: 10, words: 2, tokens: 3 });
assert.deepEqual(textStats(null), { chars: 0, words: 0, tokens: 0 });
assert.match(statsLabel('Hola mundo'), /^10 chars · 2 palabras · ≈3 tokens$/);
assert.match(statsLabel('Hola'), /1 palabra ·/);
/* Ojo con el separador de millares: en es el CLDR fija minimumGroupingDigits=2,
   asi que 1234 se escribe "1234" y solo a partir de 5 cifras aparece el punto.
   No es un bug nuestro, es la convencion del idioma. */
assert.match(statsLabel('a'.repeat(12345)), /^12\.345 chars · 1 palabra/);
assert.match(statsLabel('a'.repeat(1234)), /^1234 chars/);
// Los tokens son una estimacion, pero tienen que ser proporcionales: es lo que
// permite comparar dos cartas y saber cual se come antes el contexto.
assert.ok(textStats('a'.repeat(4000)).tokens > textStats('a'.repeat(400)).tokens * 9);
assert.ok(HEAVY_CARD > 0);

assert.equal(countMarkers('Hola {{char}}'), 1);
assert.equal(countMarkers('{{char}} y {{USER}}'), 2);
assert.equal(countMarkers('{{Char}} {{char}}'), 2);
assert.equal(countMarkers('{{personaje}} {{char }}'), 0, 'Solo cuentan los marcadores exactos');
assert.equal(countMarkers(''), 0);
assert.equal(countMarkers(null), 0);

/* ── Indice de la scrollbar ──
   Funcion pura que reparte las marcas por el rail. Es donde se cuelan los dos
   fallos tipicos: marcas de altura cero en los campos cortos, y solapes cuando
   la altura minima y los huecos se acumulan. */
const { computeTicks, TICK_MIN, LABEL_H } = await import(new URL('../js/field-index.js', import.meta.url));

const RAIL = 200;
const tickSets = [
    ['proporcional', [
        { key: 'a', label: 'Nombre', top: 0, height: 100 },
        { key: 'b', label: 'Descripcion', top: 100, height: 800 },
        { key: 'c', label: 'Saludo', top: 900, height: 100 },
    ], 1000],
    // Un campo que se come el 99% del contenido y dos de una linea: el caso que
    // solapaba marcas al aplicar la altura minima sin descontar antes los huecos.
    ['campo gigante', [
        { key: 'a', label: 'A', top: 0, height: 2 },
        { key: 'b', label: 'B', top: 2, height: 2 },
        { key: 'c', label: 'C', top: 4, height: 994 },
    ], 1000],
    ['muchos campos', Array.from({ length: 50 }, (_, i) => ({ key: 'k' + i, label: 'Campo ' + i, top: i * 100, height: 100 })), 5000],
];

for (const [name, items, total] of tickSets) {
    const ticks = computeTicks(items, total, RAIL);
    assert.equal(ticks.length, items.length, name + ': una marca por campo');
    // La proporcion entre campos se conserva: es justo lo que el rail comunica.
    const ratio = ticks[1].height / ticks[0].height;
    assert.ok(Math.abs(ratio - items[1].height / items[0].height) < 0.05, name + ': proporcion alterada');
    ticks.forEach((tick, i) => {
        assert.ok(tick.top >= 0, name + ': la marca ' + i + ' se sale por arriba');
        assert.ok(tick.top + tick.height <= RAIL + 0.01, name + ': la marca ' + i + ' se sale por abajo');
        assert.ok(tick.height > 0, name + ': la marca ' + i + ' no tiene altura');
        if (i > 0) {
            assert.ok(tick.top >= ticks[i - 1].top + ticks[i - 1].height - 1e-9,
                name + ': solape entre las marcas ' + (i - 1) + ' y ' + i);
        }
    });
}
// Cada marca conserva la identidad de su campo: es lo que hace que el clic
// salte al sitio correcto incluso despues de reordenar por posicion.
assert.deepEqual(computeTicks(tickSets[0][1], 1000, RAIL).map(t => t.label),
    ['Nombre', 'Descripcion', 'Saludo']);

/* Los titulos se pintan todos a la vez, asi que no pueden pisarse ni salirse del
   rail. Cuando no caben, `labelsFit` avisa al DOM para que solo pinte el del
   campo activo en lugar de apilar cuarenta renglones ilegibles. */
const labelled = computeTicks(tickSets[0][1], 1000, RAIL);
assert.equal(labelled.labelsFit, true, 'Tres titulos caben en el rail');
labelled.forEach((t, i) => {
    assert.ok(t.labelTop >= 0 && t.labelTop + LABEL_H <= RAIL + 0.01, 'El titulo ' + i + ' se sale del rail');
    if (i > 0) {
        assert.ok(t.labelTop >= labelled[i - 1].labelTop + LABEL_H - 1e-9,
            'Los titulos ' + (i - 1) + ' y ' + i + ' se solapan');
    }
});
assert.equal(computeTicks(tickSets[2][1], 5000, RAIL).labelsFit, false, 'Cincuenta titulos no caben en 200px');

/* Los tres juegos de arriba son casos escogidos; este barre combinaciones al azar
   con semilla fija (para que no baile entre ejecuciones). Es lo que encontro los
   dos unicos fallos que quedaban:
     - el desplazamiento final sacaba la ultima marca por debajo del rail;
     - recortar los titulos al final dejaba los dos primeros solapados.
   No se exige que la primera marca empiece en 0: con mas marcas que alto util no
   cabe todo y asomar por arriba es lo menos malo (solapar taparia una marca).
   El generador es mulberry32 con semilla fija: con un LCG clasico
   (`seed * 1103515245 + 12345`) el producto supera 2^53, el modulo se degrada y
   de 100000 tiradas solo salen ~11000 distintas — no basta para barrer nada. */
let seed = 20260829;
const rnd = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
// 20000 por el segundo fallo: en la secuencia sembrada su primer caso esta en la
// iteracion 4222 (58 marcas en un rail de 60px), asi que con menos no salta.
for (let iter = 0; iter < 20000; iter++) {
    const n = 2 + Math.floor(rnd() * 60);
    const railH = Math.floor(60 + rnd() * 840);
    let top = 0;
    const items = Array.from({ length: n }, (_, i) => {
        const h = rnd() < 0.5 ? 1 + rnd() * 40 : 40 + rnd() * 5000;
        const it = { key: 'k' + i, label: 'L' + i, top, height: h };
        top += h + rnd() * 30;
        return it;
    });
    const ticks = computeTicks(items, top, railH);
    const where = 'n=' + n + ' rail=' + railH;
    ticks.forEach((tick, i) => {
        assert.ok(tick.height > 0, where + ': marca ' + i + ' sin altura');
        assert.ok(tick.top + tick.height <= railH + 0.01, where + ': la marca ' + i + ' se sale por abajo');
        if (i > 0) {
            assert.ok(tick.top >= ticks[i - 1].top + ticks[i - 1].height - 1e-9, where + ': solape en ' + i);
        }
        if (!ticks.labelsFit) return;
        assert.ok(tick.labelTop >= 0 && tick.labelTop + LABEL_H <= railH + 0.01, where + ': titulo ' + i + ' fuera del rail');
        if (i > 0) {
            assert.ok(tick.labelTop >= ticks[i - 1].labelTop + LABEL_H - 1e-9, where + ': titulos ' + (i - 1) + ' y ' + i + ' solapados');
        }
    });
}

/* Carta real: dos campos enormes (descripcion, personalidad) junto a tres de una
   linea. Es el caso que dejaba el rail inservible: al comprimir todo
   proporcionalmente, los cortos bajaban a 3px y no habia forma de acertarlos. */
const mixed = computeTicks([
    { key: 'a', label: 'Nombre', top: 0, height: 20 },
    { key: 'b', label: 'Descripcion', top: 20, height: 4000 },
    { key: 'c', label: 'Saludo', top: 4020, height: 25 },
    { key: 'd', label: 'Personalidad', top: 4045, height: 3000 },
    { key: 'e', label: 'Escenario', top: 7045, height: 40 },
], 7085, 400);
// El minimo se comprueba contra un suelo absoluto, no solo contra la constante: si
// alguien la baja a 3px el test tiene que quejarse, no acompanarla.
assert.ok(TICK_MIN >= 6, 'Por debajo de 6px una marca no hay quien la acierte');
[0, 2, 4].forEach(i => assert.ok(mixed[i].height >= TICK_MIN,
    'El campo corto ' + i + ' se quedo en ' + mixed[i].height + 'px'));
// Pero los largos siguen dominando: es lo que hace que el rail informe.
assert.ok(mixed[1].height > mixed[0].height * 10, 'El campo largo apenas destaca');

assert.deepEqual(computeTicks([], 1000, RAIL), [], 'Sin campos no hay marcas');
assert.deepEqual(computeTicks(tickSets[0][1], 0, RAIL), [], 'Sin contenido no hay marcas');
assert.deepEqual(computeTicks(tickSets[0][1], 1000, 0), [], 'Rail sin alto no pinta marcas');

/* ─── Elementos muertos ───
   Un id en el HTML que nadie referencia es UI muerta. Asi llevaban tiempo el modal
   de atajos (boton y tecla "?" sin cablear) y el panel de bienvenida: completos en
   el HTML, invisibles en la practica. */
const allJs = (await Promise.all(jsFiles.map(f => readFile(new URL(f, jsDir), 'utf8')))).join('\n');
const cssSource = await readFile(new URL('../assets/app.css', import.meta.url), 'utf8');
const htmlWithoutIds = indexSource.replace(/\sid="[^"]+"/g, '');
// Contenedores puramente estructurales: no necesitan comportamiento ni estilo propio.
const STRUCTURAL_IDS = new Set(['resultsArea']);
const deadIds = [...new Set([...indexSource.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]))]
    .filter(id => !STRUCTURAL_IDS.has(id))
    .filter(id => !allJs.includes(`'${id}`) && !allJs.includes(`"${id}`) && !allJs.includes('#' + id))
    .filter(id => !cssSource.includes('#' + id))
    // Referencias internas del HTML: for=, aria-labelledby=, href=#...
    .filter(id => !htmlWithoutIds.includes(id));
assert.deepEqual(deadIds, [], 'Ids del HTML sin referenciar en JS, CSS ni en el propio HTML');

/* "Invocar y sustituir" reescribe todos los campos de golpe y ademas se dispara
   solo al cargar una carta, asi que el aviso tiene que ofrecer deshacer. Son dos
   piezas: la accion en el toast y la funcion que devuelve el texto anterior. Si
   alguien quita una, sale por aqui. Es el mismo patron que ya usa "Limpiar todo". */
const editorSrc = await readFile(new URL('../js/editor.js', import.meta.url), 'utf8');
assert.ok(/label:\s*'Deshacer'/.test(editorSrc), 'El aviso de la sustitucion no ofrece deshacer');
assert.ok(/function restoreProcessed/.test(editorSrc), 'Falta la funcion que deshace la sustitucion');

const undefinedIdents = [];
for (const file of jsFiles) {
    const src = await readFile(new URL(file, jsDir), 'utf8');
    const declared = declaredNames(src);
    /* Cubre `${x}` y tambien `${x ? a : b}`, `${x.length}`...: basta con que la
       expresion EMPIECE por un identificador. El bug real era `${excerpt ? ...}`,
       que con el patron estricto de `${x}` se colaba. */
    for (const m of src.matchAll(/\$\{\s*([A-Za-z_$][\w$]*)\s*(?=[\}?.,)\]+\-*/%|&<>=:;])/g)) {
        const id = m[1];
        if (!declared.has(id) && !GLOBALS.has(id)) undefinedIdents.push(`${file} -> ${id}`);
    }
}
assert.deepEqual(undefinedIdents, [], 'Identificadores sin declarar dentro de template literals');

console.log('Regresiones funcionales: OK');
