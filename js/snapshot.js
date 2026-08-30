/* js/snapshot.js — el formato de sesion, en un solo sitio.

   Hasta aqui habia dos serializadores: snapState() en app.js (alimenta el
   "Deshacer") y saveSession() en storage.js (escribe en IndexedDB). Nacian
   iguales y ya habian divergido: el primero guardaba pngFile y fileName, el
   segundo no. Y ninguno anotaba la forma del objeto, asi que al recuperar una
   sesion se confiaba en que los campos estuvieran donde se esperaban.

   Aqui se define el contrato una vez. Todo lo que lea o escriba una sesion
   pasa por serialize()/deserialize().

   Es hoja: solo importa state.js y utils.js, asi que lo puede usar storage.js
   (que no debe conocer el DOM) sin crear ciclos. */

import state, { RESERVED_KEYS } from './state.js';
import { $, deepClone } from './utils.js';

/* Subirlo cuando cambie la forma del objeto. No hace falta que coincida con la
   version de package.json: es la version del formato de datos, no de la app.
   Una sesion de otra version no se tira sin mas: se normaliza, y lo que falte
   se rellena con un valor valido. */
export const SNAPSHOT_VERSION = 1;

/* Los cuatro valores que viven en el DOM y no en state. Se leen y se escriben
   aqui porque son parte del contrato de la sesion: si se restauran en otro
   sitio, ese sitio tiene que saber el nombre de los cuatro. */
const FORM_IDS = ['charName', 'userName', 'sysPrompt', 'userPersona'];

function safeEntries(source) {
    const out = {};
    if (!source || typeof source !== 'object') return out;
    for (const [k, v] of Object.entries(source)) {
        if (RESERVED_KEYS.has(k.toLowerCase())) continue;
        if (typeof v === 'string') out[k] = v;
    }
    return out;
}

function cloneArray(value) {
    const cloned = deepClone(Array.isArray(value) ? value : []);
    return Array.isArray(cloned) ? cloned : [];
}

function normalizeBook(book) {
    if (!book || typeof book !== 'object') return { present: false, metadata: {}, entries: [] };
    const metadata = (book.metadata && typeof book.metadata === 'object') ? deepClone(book.metadata) : {};
    return {
        present: Boolean(book.present),
        metadata: (metadata && typeof metadata === 'object') ? metadata : {},
        entries: cloneArray(book.entries).filter(e => e && typeof e === 'object')
    };
}

function normalizeGreetings(g) {
    if (!g || typeof g !== 'object') return { original: '', list: [], current: 0 };
    const list = Array.isArray(g.list) ? g.list.filter(x => typeof x === 'string') : [];
    const original = typeof g.original === 'string' ? g.original : '';
    // current indexa [original, ...list], asi que el maximo es list.length.
    const current = Number.isInteger(g.current) && g.current >= 0 && g.current <= list.length
        ? g.current : 0;
    return { original, list, current };
}

/**
 * @param {object} [s] Estado a serializar (por defecto el singleton).
 * @param {object} [opts] `persist: true` lo deja listo para IndexedDB.
 */
export function serialize(s = state, { persist = false } = {}) {
    const snap = {
        version: SNAPSHOT_VERSION,
        savedAt: Date.now(),
        file: s.file?.uploaded ?? null,
        extracted: safeEntries(s.file?.extracted),
        procData: safeEntries(s.proc?.data),
        procEdited: [...(s.proc?.edited ?? [])],
        editorAdded: [...(s.editor?.added ?? [])],
        editorRemoved: [...(s.editor?.removed ?? [])],
        characterBook: deepClone(s.characterBook),
        altGreetings: deepClone(s.altGreetings),
        activeProfileId: s.profiles?.active ?? null,
        editorActive: Boolean(s.editor?.active)
    };
    for (const id of FORM_IDS) snap[id] = $(id)?.value ?? '';
    snap.fileName = $('statusFileName')?.textContent ?? '';
    /* El File del PNG no entra en lo persistido: es binario de hasta 10 MB y
       JSON.stringify lo mide como `{}`, asi que la compuerta de tamaño de
       storage.js dejaria de servir. Solo viaja en el "Deshacer". */
    if (!persist) snap.pngFile = s.file?.pngFile ?? null;
    return snap;
}

/** Normaliza cualquier sesion guardada. Devuelve null si no es un objeto. */
export function deserialize(snap) {
    if (!snap || typeof snap !== 'object') return null;
    const d = {
        // 0 = anterior a este modulo (1.2.3 y anteriores), que no anotaba forma.
        version: typeof snap.version === 'number' ? snap.version : 0,
        savedAt: typeof snap.savedAt === 'number' ? snap.savedAt : 0,
        file: snap.file ?? null,
        pngFile: snap.pngFile ?? null,
        extracted: safeEntries(snap.extracted),
        procData: safeEntries(snap.procData),
        procEdited: new Set(Array.isArray(snap.procEdited) ? snap.procEdited : []),
        editorAdded: new Set(Array.isArray(snap.editorAdded) ? snap.editorAdded : []),
        editorRemoved: new Set(Array.isArray(snap.editorRemoved) ? snap.editorRemoved : []),
        characterBook: normalizeBook(snap.characterBook),
        altGreetings: normalizeGreetings(snap.altGreetings),
        activeProfileId: typeof snap.activeProfileId === 'string' ? snap.activeProfileId : null,
        editorActive: Boolean(snap.editorActive),
        fileName: typeof snap.fileName === 'string' ? snap.fileName : ''
    };
    for (const id of FORM_IDS) d[id] = typeof snap[id] === 'string' ? snap[id] : '';
    return d;
}

/** ¿Es de una version anterior a la actual? Sirve para avisar sin perder datos. */
export function isLegacy(snap) {
    return Boolean(snap) && snap.version !== SNAPSHOT_VERSION;
}

/** Vuelca una sesion normalizada en el estado y en el formulario. */
export function apply(snap) {
    const d = deserialize(snap);
    if (!d) return null;
    state.file.uploaded = d.file;
    state.file.pngFile = d.pngFile;
    state.file.extracted = d.extracted;
    state.proc.data = d.procData;
    state.proc.edited = d.procEdited;
    state.editor.added = d.editorAdded;
    state.editor.removed = d.editorRemoved;
    state.characterBook = d.characterBook;
    state.altGreetings = d.altGreetings;
    for (const id of FORM_IDS) {
        const el = $(id);
        if (el) el.value = d[id];
    }
    return d;
}
