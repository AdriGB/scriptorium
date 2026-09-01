/* ── Tests de comportamiento ──
   Aqui se importan los modulos de verdad y se comprueba lo que hacen, no como
   estan escritos. Los asserts que leen el codigo como texto viven en
   structure.mjs: mezclados, cualquier refactor los rompia sin haber cambiado
   nada, y "npm test" se ponia rojo entero por un regex desactualizado. */
import assert from 'node:assert/strict';

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

/* ── Formato de sesion ──
   snapshot.js es el unico sitio que define el contrato: la sesion de IndexedDB
   (storage.js) y el "Deshacer" (app.js) tienen que hablar el mismo idioma. Si se
   anade un campo al estado y se olvida en serialize(), el round-trip lo delata. */
const { serialize, deserialize, apply, isLegacy, revision, isDirty, SNAPSHOT_VERSION } =
    await import('../js/snapshot.js');

state.file.extracted = { description: 'Texto', ['__proto__']: 'no', constructor: 'no' };
state.proc.data = { personality: 'Procesado' };
state.proc.edited = new Set(['description']);
state.file.pngFile = { name: 'carta.png' };

const snap = serialize(state);
assert.equal(snap.version, SNAPSHOT_VERSION);
assert.equal(snap.extracted.description, 'Texto');
assert.ok(!Object.prototype.hasOwnProperty.call(snap.extracted, '__proto__'),
    'Las claves reservadas no se serializan');
assert.ok(!Object.prototype.hasOwnProperty.call(snap.extracted, 'constructor'),
    'Las claves reservadas no se serializan');
assert.equal(snap.pngFile.name, 'carta.png', 'El Deshacer conserva el File del PNG');
assert.equal(serialize(state, { persist: true }).pngFile, undefined,
    'Lo que va a IndexedDB no lleva el File: JSON.stringify lo mide como {} y la compuerta de tamaño dejaria de servir');

const back = deserialize(JSON.parse(JSON.stringify(snap)));
assert.equal(back.procData.personality, 'Procesado');
assert.ok(back.procEdited instanceof Set && back.procEdited.has('description'),
    'procEdited vuelve como Set, no como array');

/* Sesion de 1.2.3 o anterior: no llevaba `version` ni normalizaba la forma. No
   se tira, se rellena. */
const normalized = deserialize({
    savedAt: 1,
    file: { data: { name: 'Vieja' } },
    procData: 'no es un objeto',
    characterBook: null,
    altGreetings: { list: 'roto' }
});
assert.ok(isLegacy(normalized), 'Una sesion sin version se marca como antigua');
assert.deepEqual(normalized.procData, {});
assert.deepEqual(normalized.characterBook, { present: false, metadata: {}, entries: [] });
assert.deepEqual(normalized.altGreetings, { original: '', list: [], current: 0 });
assert.equal(normalized.fileName, '');

delete state.proc.data.personality;
apply(snap);
assert.equal(state.proc.data.personality, 'Procesado', 'apply() vuelca la sesion en el estado');
assert.equal(elements.get('charName').value, 'Alice', 'apply() restaura el formulario');

/* La huella sustituye al `state.vault.dirty = true` que habia que acordarse de
   poner en unos veinte sitios. Lo que se hace aqui es lo que antes se olvidaba. */
state.vault.savedRev = revision(state);
assert.equal(isDirty(state), false, 'Recien guardado no hay trabajo pendiente');
state.proc.data.description = 'Otro texto';
assert.equal(isDirty(state), true, 'Tocar un campo cuenta sin que nadie lo marque');

state.vault.savedRev = revision(state);
state.tr.mc = new AbortController();
state.ui.dCnf = true;
state.proc.collapsed.add('description');
assert.equal(isDirty(state), false,
    'Lo efimero (traduccion, modales, plegado) no es trabajo pendiente');

const revBefore = revision(state);
await new Promise(r => setTimeout(r, 5));
assert.equal(revision(state), revBefore, 'savedAt no entra en la huella: cambia en cada serialize');

/* ── Lectura de PNG ──
   `extPNG` es la unica entrada de cartas en la app y no tenia ni un test: era la
   pieza mas grande sin cubrir. Los PNG se construyen aqui mismo
   (tests/png-fixture.mjs) en vez de versionar un binario, y se le pasan al modulo
   real, que corre en Node porque File, atob y DecompressionStream son globales
   desde Node 18. */
/* El `atob` de Node es "indulgente": acepta base64url y separadores. El de los
   navegadores es estricto y lanza InvalidCharacterError. Como el modulo corre en
   el navegador, el test tiene que usar esa semantica: si no, un payload
   base64url daria verde aqui y reventaria alla, que es exactamente el bug que
   se arreglo en png-parser.js. Se restaura al acabar la seccion. */
const nodeAtob = globalThis.atob;
globalThis.atob = (s) => {
    if (/[^A-Za-z0-9+/=]/.test(s) || s.length % 4 !== 0) {
        throw new Error('InvalidCharacterError');
    }
    return nodeAtob(s);
};

const { extPNG } = await import(new URL('../js/png-parser.js', import.meta.url));
const { tEXtBase64, tEXtJson, tEXtRaw, zTXt, iTXt, plainPng, toFile, sampleCard } =
    await import(new URL('./png-fixture.mjs', import.meta.url));

const pngCard = sampleCard();
/* Sin + ni / en el base64, la variante base64url sale identica a la normal y el
   caso pasa sin probar nada — me paso en la primera version de este test: el
   base64 de la carta no tenia ninguno de los dos y el assert de base64url daba
   verde incluso con el arreglo del parser quitado. Si alguien toca la carta de
   prueba y dejan de aparecer, esto lo dice en vez de callarse. */
const pngB64 = Buffer.from(JSON.stringify(pngCard), 'utf8').toString('base64');
assert.ok(/[+/]/.test(pngB64), 'La carta de prueba debe producir + o / en base64: si no, el caso base64url no prueba nada');

/* Cinco formas de incrustar la misma carta: son las que escriben las herramientas
   de verdad. Un fallo aqui es una carta que el usuario no puede abrir, y no hay
   forma de enterarse salvo probandolo. */
for (const [name, bytes] of [
    ['tEXt base64', tEXtBase64(pngCard)],
    ['tEXt base64url sin padding', tEXtBase64(pngCard, { url: true })],
    ['tEXt con JSON en claro', tEXtJson(pngCard)],
    ['zTXt comprimido', zTXt(pngCard)],
    ['iTXt sin comprimir', iTXt(pngCard)]
]) {
    const read = await extPNG(toFile(bytes));
    assert.deepEqual(read, pngCard, name + ': la carta no vuelve intacta');
}

// Un PNG normal: es lo que pasa si se arrastra una imagen que no es una carta.
await assert.rejects(() => extPNG(toFile(plainPng())), /Sin metadatos/);
// Un tEXt que no se llama chara no es una carta, pero tampoco un error de lectura.
await assert.rejects(() => extPNG(toFile(tEXtRaw('Comment', 'una nota'))), /Sin metadatos/);
await assert.rejects(() => extPNG(toFile(Buffer.from('esto no es un png'))), /PNG invalido/);
await assert.rejects(() => extPNG(toFile(Buffer.alloc(0))), /vacio/);
/* Payload roto: se encontro el chunk pero no se puede decodificar. El mensaje
   tiene que distinguirlo de "no habia carta", si no el usuario busca en el
   sitio equivocado. */
await assert.rejects(() => extPNG(toFile(tEXtRaw('chara', 'no es json ni base64'))),
    /no se pudo decodificar|no es JSON/);

globalThis.atob = nodeAtob;

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
const { textStats, statsLabel, countMarkers, deepClone, escapeHtml, HEAVY_CARD } =
    await import(new URL('../js/utils.js', import.meta.url));

/* ── Escape HTML ──
   Vivia triplicado: dos `esc` locales en editor.js y este en vault.js, y solo
   el de vault.js escapaba comillas. Hoy las tres versiones se usan en sitios
   donde llegan, pero dos de ellas son una inyeccion esperando sitio: basta con
   que alguien las reutilice en un atributo —que es exactamente como se
   interpola el nombre de personaje en los botones de la boveda— para que un
   nombre con comillas se salga del atributo. */
assert.equal(escapeHtml('a & b'), 'a &amp; b');
assert.equal(escapeHtml('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;');
/* Las comillas son las que faltaban en las dos copias de editor.js: sin ellas,
   `Ada" onmouseover="...` dentro de un title="..." cierra el atributo y mete el
   suyo. El `&` va primero en la cadena de reemplazos, si no lo que se acaba de
   escapar se volveria a escapar. */
assert.equal(escapeHtml('Ada" onmouseover="x'), 'Ada&quot; onmouseover=&quot;x');
assert.equal(escapeHtml("it's"), 'it&#39;s');
assert.equal(escapeHtml('&amp;'), '&amp;amp;', 'El & ya escapado se vuelve a escapar: es lo correcto');
// No revienta con lo que no es texto, que es lo que llegaria de una carta rara.
assert.equal(escapeHtml(null), '');
assert.equal(escapeHtml(undefined), '');
assert.equal(escapeHtml(0), '0');
assert.equal(escapeHtml(42), '42');

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

/* ── deepClone ──
   Devuelve el valor o falla. Nada de `{}`: un clon que se rinde en silencio es
   una perdida de datos con forma de exito, y es justo lo que pasaba con el
   lorebook al guardar la sesion. */
const original = { a: 1, b: { c: [1, 2, { d: 'fondo' }] } };
const copy = deepClone(original);
assert.deepEqual(copy, original);
copy.b.c[2].d = 'cambiado';
assert.equal(original.b.c[2].d, 'fondo', 'El clon no comparte referencias con el original');

/* Referencias circulares, Map, Set y Date: son los cuatro casos que un
   `JSON.parse(JSON.stringify())` no puede ni de lejos. Si algun dia se cambia
   structuredClone por JSON a secas, salta por aqui. */
const circ = { nombre: 'raiz' };
circ.self = circ;
const circCopy = deepClone(circ);
assert.equal(circCopy.self, circCopy, 'El clon conserva el ciclo apuntandose a si mismo');
assert.equal(circCopy.self.self.nombre, 'raiz');

const rich = { m: new Map([['k', 1]]), s: new Set([1, 2]), d: new Date(0) };
const richCopy = deepClone(rich);
assert.ok(richCopy.m instanceof Map && richCopy.m.get('k') === 1, 'Map se pierde por el camino');
assert.ok(richCopy.s instanceof Set && richCopy.s.has(2), 'Set se pierde por el camino');
assert.ok(richCopy.d instanceof Date && richCopy.d.getTime() === 0, 'Date degrada a cadena');

// Los primitivos pasan tal cual: son inmutables y no hay nada que clonar.
assert.equal(deepClone('texto'), 'texto');
assert.equal(deepClone(7), 7);
assert.equal(deepClone(null), null);
assert.equal(deepClone(undefined), undefined);
const fn = () => {};
assert.equal(deepClone(fn), fn, 'Una funcion se devuelve tal cual, no se lanza por ella');

/* Un valor que no admite ni un camino ni el otro tiene que fallar. Antes
   devolvia `{}` y con eso se sobrescribia la sesion buena: al recargar, el
   lorebook habia desaparecido sin que nada avisara. */
const unclonable = new Proxy({}, {
    ownKeys() { throw new Error('inaccesible'); },
    get() { throw new Error('inaccesible'); }
});
/* El aviso de degradacion salta a proposito en estos dos casos, y una traza
   completa por ejecucion no le dice nada a nadie. Se silencia solo aqui y se
   devuelve enseguida: un aviso inesperado tiene que seguir viendose. */
const warnDeVerdad = console.warn;
console.warn = () => {};
assert.throws(() => deepClone(unclonable), /no se puede clonar/);

/* El caso que importa de verdad: si el lorebook no se puede clonar, `serialize`
   tiene que fallar ANTES de escribir. `saveSession` la llama en la linea previa
   al `dbPut`, asi que abortar deja la sesion anterior intacta en el disco en vez
   de reemplazarla por una sin lorebook. */
const bookAntes = state.characterBook;
state.characterBook = { present: true, metadata: { name: 'Mundo' }, entries: [], extensions: unclonable };
assert.throws(() => serialize(state), /no se puede clonar/,
    'Un lorebook inclonable se guardaria vacio en vez de fallar el guardado');
state.characterBook = bookAntes;
console.warn = warnDeVerdad;
assert.doesNotThrow(() => serialize(state), 'El estado se queda como estaba');

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

console.log('Regresiones funcionales: OK');
