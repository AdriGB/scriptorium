import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

/* ── Tests estructurales ──
   Aqui van los asserts que leen el codigo como texto en lugar de ejecutarlo.
   Estan separados de regression.mjs por una razon practica: cada refactor que
   no cambiaba el comportamiento rompia los de alla. Solo en esta tanda cayeron
   tres (el `renderJSONSafely(true)` literal, el `showCard()` unificado y el
   bloque de init), y al estar revueltos con los de comportamiento el fallo no
   decia nada util: "npm test" se ponia rojo entero por un regex viejo.

   Cuando uno de estos salta, la pregunta es siempre la misma: ha cambiado la
   forma del codigo, o se ha perdido la propiedad que se queria blindar? Si es
   lo primero se ajusta el patron; si es lo segundo, el arreglo esta en el
   fuente, no aqui. */

const jsDir = new URL('../js/', import.meta.url);
const jsFiles = (await readdir(jsDir)).filter(f => f.endsWith('.js'));

const serviceWorkerSource = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const editorSource = await readFile(new URL('../js/editor.js', import.meta.url), 'utf8');
const uiSource = await readFile(new URL('../js/ui.js', import.meta.url), 'utf8');
const vaultSource = await readFile(new URL('../js/vault.js', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../assets/app.css', import.meta.url), 'utf8');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

/* ── Service worker ──
   La version del paquete y la de la cache van atadas: si se publica una
   version y la cache no se invalida, el usuario sigue con el shell viejo. */
assert.match(
    serviceWorkerSource,
    new RegExp('scriptorium-v' + pkg.version.replace(/\./g, '\\.')),
    'CACHE_VERSION del service worker no coincide con la version de package.json'
);
assert.match(serviceWorkerSource, /fetch\(request, \{ cache: 'no-store' \}\)/);
assert.doesNotMatch(serviceWorkerSource, /cache\.put\('\.\/index\.html'/);
assert.match(appSource, /controllerchange/);
assert.match(appSource, /isLocalDevelopment/);

/* Cargar una carta tiene que avisar si la vista JSON falla: showCard recibe el
   flag y se lo pasa. Antes era un `renderJSONSafely(true)` literal en cada ruta. */
assert.match(appSource, /renderJSONSafely\(notify\)/);
/* Pintar una carta pasa por un solo sitio. Con tres rutas pintando por su
   cuenta cada arreglo habia que repetirlo tres veces, y de hecho se habian
   desincronizado (la boveda no actualizaba el contador de la pestana original
   y la sesion recuperada no recogia el panel en movil). */
assert.match(appSource, /function showCard\(/);
assert.equal(
    [...appSource.matchAll(/[^.\w]renderRaw\(/g)].length, 1,
    'app.js debe llamar a renderRaw() una sola vez, dentro de showCard()'
);

/* Todos los modulos de js/ tienen que estar en el APP_SHELL: el fetch de los
   .js es solo de red (con la cache como respaldo), asi que el que falte no
   llega nunca al precargado y offline revienta el grafo de modulos entero.
   Es lo que paso con field-index.js al anadirlo sin tocar el worker. */
const precached = [...serviceWorkerSource.matchAll(/'\.\/js\/([A-Za-z0-9-]+\.js)'/g)].map(m => m[1]);
const onDisk = (await readdir(new URL('../js/', import.meta.url))).filter(f => f.endsWith('.js'));
assert.deepEqual(
    onDisk.filter(f => !precached.includes(f)), [],
    'Modulos de js/ ausentes del APP_SHELL de service-worker.js'
);

/* ── Regresiones estructurales de UX ──
   Blinda el Tier 1: dialogo tematico en lugar de los nativos, focus trap activo
   y los elementos nuevos presentes en el HTML. */

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

for (const id of ['confirmModal', 'confirmOkBtn', 'confirmCancelBtn', 'confirmExtraBtn', 'toastAction']) {
    assert.match(indexSource, new RegExp(`id="${id}"`), `Falta #${id} en index.html`);
}

// El undo depende de que el snapshot y la sesion del vault compartan forma.
assert.match(appSource, /function snapState\(\)/);
assert.match(appSource, /async function hydrateFrom\(saved\)/);
assert.match(appSource, /label: 'Deshacer'/);

/* ── Tier 2 de UX ── */

// Buscador de la boveda: filtro propia pestana y resaltado.
assert.match(vaultSource, /function buildExcerpt\(/, 'Falta buildExcerpt()');
assert.match(vaultSource, /const excerpt = highlight\(/, 'La fila debe construir su extracto');
assert.match(vaultSource, /resetSearch\(\);/, 'Al abrir la boveda hay que limpiar el filtro anterior');
assert.match(vaultSource, /id="vaultSearch"/);
assert.match(vaultSource, /id="vaultSearchCount"/);

// Sidebar: grupos no excluyentes y con estado persistido (la clave existia sin usarse).
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
assert.match(editorSource, /export function emptyFieldsState\(/);
assert.match(editorSource, /fields:rendered/);
// renderRaw, renderProc (vacio y con datos) y renderLorebook.
assert.ok((editorSource.match(/announceRender\(\)/g) || []).length >= 4, 'Falta anunciar el repintado en alguna vista');

/* ── Tier 3: UI muerta cableada ── */
assert.match(appSource, /closeShortcuts\(\)/, 'Esc no cierra el modal de atajos');
/* Todos los init importados tienen que estar en el mapa de arranque. Antes
   iban en un unico try y el primero que fallaba se llevaba por delante los
   demas sin dejar rastro; ahora cada uno va por su cuenta, pero eso no sirve
   de nada si se olvida anadirlo a la lista. */
const initFns = [...new Set([...appSource.matchAll(/\binit[A-Z]\w+/g)].map(m => m[0]))];
const stepsBlock = appSource.slice(
    appSource.indexOf('const initSteps'),
    appSource.indexOf('for (const [name, step]')
);
assert.ok(stepsBlock.length > 0, 'Falta el mapa de arranque initSteps');
for (const fn of initFns) {
    if (fn === 'initSteps') continue;
    assert.ok(stepsBlock.includes(fn), fn + ' no esta en el mapa de arranque');
}
assert.ok(initFns.length >= 14, 'Se esperaban al menos 14 pasos de arranque, hay ' + initFns.length);
assert.match(appSource, /refreshProcessHint\(\)/, 'El #processHint sigue sin usar');
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

/* ─── Elementos muertos ───
   Un id en el HTML que nadie referencia es UI muerta. Asi llevaban tiempo el modal
   de atajos (boton y tecla "?" sin cablear) y el panel de bienvenida: completos en
   el HTML, invisibles en la practica. */
const allJs = (await Promise.all(jsFiles.map(f => readFile(new URL(f, jsDir), 'utf8')))).join('\n');
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
assert.ok(/label:\s*'Deshacer'/.test(editorSource), 'El aviso de la sustitucion no ofrece deshacer');
assert.ok(/function restoreProcessed/.test(editorSource), 'Falta la funcion que deshace la sustitucion');

/* La traduccion se mostraba como referencia y no habia forma de volcarla al
   campo: se leia y se copiaba a mano. Son cuatro piezas, en la tarjeta y en el
   modal expandido: la escritura comun, la aplicacion con deshacer y el volcado
   desde el modal. Si alguien borra el boton del HTML lo caza el control de ids
   muertos de mas arriba; si lo deja sin cablear, el mismo control. */
assert.ok(/function writeFieldText\(/.test(editorSource), 'Falta la escritura comun de un campo');
assert.ok(/function applyTranslation\(/.test(editorSource), 'Falta la funcion que aplica la traduccion');
assert.ok(/function applyExpandedTranslation\(/.test(editorSource), 'Falta el volcado de la traduccion del modal');
assert.match(indexSource, /id="expandModalApplyBtn"/, 'Falta el boton de aplicar en el modal expandido');
/* Aplicar reemplaza el campo entero, asi que se deshace como el resto de los
   rituales. Y la vuelta atras tiene que devolver tambien la insignia "editado":
   si el campo estaba intacto, dejarla puesta haria que el siguiente "Invocar y
   sustituir" respetara un texto que el usuario no escribio. */
const applyBody = editorSource.match(/function applyTranslation\([\s\S]*?\n\}/);
assert.ok(applyBody, 'No se encuentra el cuerpo de applyTranslation');
assert.match(applyBody[0], /Deshacer/, 'Aplicar la traduccion no ofrece deshacer');
assert.match(applyBody[0], /proc\.edited\.delete/, 'Deshacer no devuelve la insignia de editado');

/* "Invocar y sustituir" quedaba bajo el pliegue con los cuatro grupos del
   lateral abiertos, y con el tambien #processHint (la pista de por que esta
   desactivado). Se queda pegado al borde inferior del panel, pero solo desde
   md: en movil quien desplaza es el main entero, asi que una barra fija
   taparia la carta. */
const actionSection = indexSource.match(/<section class="order-5[^"]*"/);
assert.ok(actionSection, 'Falta la seccion de la accion principal');
assert.match(actionSection[0], /md:sticky/, 'La accion principal volvio a quedar bajo el pliegue');
assert.match(actionSection[0], /md:bottom-0/, 'La barra pegajosa no se ancla al borde inferior');
assert.match(actionSection[0], /md:z-30/, 'Sin z-index la barra queda detras del contenido');
assert.doesNotMatch(actionSection[0], /(?:^|\s)sticky/, 'En movil una barra fija taparia la carta');
// Tailwind escanea el HTML: si la clase no se genera, la barra no se pega aunque este puesta.
assert.match(cssSource, /\.md\\:sticky/, 'md:sticky no llego al CSS generado');

/* El grupo "Aventurero" esta cerrado por defecto, asi que el perfil activo (que
   es lo que decide el {{user}} de la carta) no se veia sin abrirlo. La cabecera
   lo repite, y hay dos caminos que la tienen que refrescar: cambiar de perfil
   (applyP, porque el <select> no se vuelve a pintar) y renombrarlo (updLbl,
   que edita la opcion en sitio sin pasar por renderSel). */
const profilesSrc = await readFile(new URL('../js/profiles.js', import.meta.url), 'utf8');
assert.match(indexSource, /id="profileSummaryLabel"/, 'Falta la etiqueta del perfil activo');
assert.ok(/function updSummary\(/.test(profilesSrc), 'Falta quien refresca la cabecera del grupo');
for (const fn of ['applyP', 'updLbl']) {
    const body = profilesSrc.match(new RegExp(`function ${fn}\\([\\s\\S]*?\\n\\}`));
    assert.ok(body, `No se encuentra el cuerpo de ${fn}`);
    assert.match(body[0], /updSummary\(/, `${fn} no refresca la cabecera del perfil activo`);
}

/* En movil el panel lateral es una pagina entera y la carta queda debajo. Con
   carta cargada se recoge solo; al limpiar vuelve a abrirse, porque dentro vive
   el area de arrastre. Dos detalles faciles de perder: el estado automatico NO
   se persiste (si no, una sesion en movil dejaria el panel plegado tambien en
   escritorio, donde no estorba) y el usuario manda si ya pulso el boton. */
assert.ok(/function autoSidebarCollapse\(/.test(uiSource), 'Falta el recogido automatico del panel');
assert.ok(/function autoSidebarExpand\(/.test(uiSource), 'Falta la apertura automatica del panel');
assert.ok(/panelSetByUser/.test(uiSource), 'El usuario debe poder decidir por encima del automatico');
assert.match(uiSource, /max-width: 767\.98px/, 'El automatico debe limitarse al ancho de movil');
// Cada uno por su cuenta: mirar el fichero entero no sirve, porque el otro
// camino (la apertura) seguira cumpliendo el patron aunque este falle.
const collapseBody = uiSource.match(/function autoSidebarCollapse\([\s\S]*?\n\}/);
const expandBody = uiSource.match(/function autoSidebarExpand\([\s\S]*?\n\}/);
assert.ok(collapseBody, 'No se encuentra el cuerpo de autoSidebarCollapse');
assert.ok(expandBody, 'No se encuentra el cuerpo de autoSidebarExpand');
assert.match(collapseBody[0], /setPanelCollapsed\(true, false\)/, 'El recogido automatico no debe persistirse');
assert.match(expandBody[0], /setPanelCollapsed\(false, false\)/, 'La apertura automatica no debe persistirse');
// Sin la guarda de ancho, el panel se recogeria tambien en escritorio, donde es
// una columna y no estorba a nada.
assert.match(collapseBody[0], /isNarrow\(\)/, 'El recogido automatico debe limitarse a movil');
assert.match(expandBody[0], /isNarrow\(\)/, 'La apertura automatica debe limitarse a movil');
assert.match(appSource, /autoSidebarCollapse\(\)/, 'Cargar una carta no recoge el panel en movil');
assert.match(appSource, /autoSidebarExpand\(\)/, 'Limpiar no vuelve a abrir el panel en movil');

/* Ctrl+Enter dentro de un campo de la carta disparaba el ritual: el repintado
   reemplaza el nodo y se lleva por delante la pila nativa de Ctrl+Z (no hay
   forma de conservarla, el elemento es otro). El atajo tiene que callarse ahi,
   pero no en los inputs del lateral, que es donde se espera: escribes el nombre
   e invocas sin soltar el teclado. */
const appLines = appSource.split('\n');
const ctrlEnterLine = appLines.find(l => l.includes("e.key === 'Enter'") && l.includes('!e.shiftKey'));
assert.ok(ctrlEnterLine, 'Falta el atajo Ctrl+Enter');
assert.match(ctrlEnterLine, /!inCard/, 'Ctrl+Enter vuelve a repintar mientras se escribe en un campo');
assert.ok(appLines.some(l => l.includes("const inCard = e.target.matches('[contenteditable=\"true\"]')")),
    'inCard debe mirar solo el atributo contenteditable: en un input no vale');

/* Alternar el modo editor repinta la vista entera, y eso tiraba el scroll al
   techo, reabria las tarjetas plegadas y repetia la entrada escalonada. Las
   tres vistas se reparan igual, asi que mirar el fichero entero no vale: una
   sola cumpliria el patron de las otras dos. Se extrae el cuerpo de cada una. */
for (const name of ['renderProc', 'renderRaw', 'renderLorebook']) {
    const m = editorSource.match(new RegExp('export function ' + name + '\\([\\s\\S]*?\\n\\}'));
    assert.ok(m, 'No se encuentra el cuerpo de ' + name);
    const body = m[0];
    assert.match(body, /captureAnchor\(/, name + ' no guarda el ancla: repintar manda al usuario al techo');
    assert.match(body, /restoreAnchor\(/, name + ' no restaura el ancla despues de repintar');
    assert.match(body, /querySelector\('\.field-card'\)/, name + ' no comprueba si ya habia tarjetas: la entrada escalonada se repetiria');
    /* El ancla se mide AL FINAL: el aviso de repintado reaplica el buscador, que
       oculta tarjetas con display:none, y el decorado cambia altos. Con el ancla
       antes, las alturas sobre las que se calculo ya no son las de la pantalla. */
    assert.ok(body.lastIndexOf('restoreAnchor(') > body.lastIndexOf('announceRender('),
        name + ' restaura el ancla antes de reaplicar el buscador: se mediria sobre alturas que no valen');
}
assert.ok(editorSource.indexOf('restoreAnchor(pv, anchor)') > editorSource.indexOf('decorateEd();'),
    'El ancla se restaura antes del decorado del editor');

/* El plegado sobrevive al repintado porque se guarda en state, no en el DOM. */
assert.match(editorSource, /const collapseKey = \(isRaw \? RAW_PFX : ''\) \+ key;/, 'Falta la clave de plegado de los campos');
assert.match(editorSource, /const collapseKey = LB_PFX \+ i;/, 'Falta la clave de plegado del lorebook');
assert.match(editorSource, /state\.proc\.collapsed\.add\(collapseKey\); else state\.proc\.collapsed\.delete\(collapseKey\)/,
    'Plegar una tarjeta no se anota en el estado');
assert.match(editorSource, /state\.proc\.collapsed\.clear\(\)/, 'Cargar otra carta deja plegados heredados');
/* Las tres clases de clave conviven en el mismo conjunto, asi que la poda de
   una no puede barrer las de las otras: las del lorebook ('lb:0') no estan
   entre los campos vivos y desapareceria su plegado en cada repintado. */
const pruneBody = editorSource.match(/function pruneCollapsed\([\s\S]*?\n\}/);
assert.ok(pruneBody, 'No se encuentra el cuerpo de pruneCollapsed');
assert.match(pruneBody[0], /ck\.startsWith\(LB_PFX\)/, 'La poda de campos se lleva por delante el plegado del lorebook');
assert.match(pruneBody[0], /ck\.startsWith\(RAW_PFX\)/, 'La poda de campos se lleva por delante el plegado de la vista original');

/* Apagar el editor no avisa: el boton pierde el color y la barra desaparece,
   que es la confirmacion. Y la restauracion de sesion tampoco, porque ahi el
   usuario no ha hecho nada. */
const togEdBody = editorSource.match(/export function togEd\([\s\S]*?\n\}/);
assert.ok(togEdBody, 'No se encuentra el cuerpo de togEd');
assert.match(togEdBody[0], /\{ notify = true \} = \{\}/, 'togEd debe poder callarse');
assert.match(togEdBody[0], /notify && state\.editor\.active/, 'Apagar el editor avisa de algo que el boton ya esta diciendo');
assert.match(appSource, /togEd\(\{ notify: false \}\)/, 'Restaurar la sesion avisa de un editor que nadie acaba de activar');

console.log('Regresiones estructurales: OK');
