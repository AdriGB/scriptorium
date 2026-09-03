import { serialize, revision, isDirty } from './snapshot.js';

const DB_NAME = 'scriptorium_vault';
const DB_VERSION = 1;
const STORES = { SESSIONS: 'sessions', CHARACTERS: 'characters', SETTINGS: 'settings' };
const AUTO_SAVE_MS = 30_000;
const MAX_CHARACTERS = 500;
export const MAX_PORTRAIT_BYTES = 8 * 1024 * 1024;
const BUNDLE_FORMAT = 'scriptorium_vault';
const BUNDLE_VERSION = 2;
const MAX_BUNDLE_BYTES = 50 * 1024 * 1024;

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORES.SESSIONS)) {
                db.createObjectStore(STORES.SESSIONS, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(STORES.CHARACTERS)) {
                const s = db.createObjectStore(STORES.CHARACTERS, { keyPath: 'id' });
                s.createIndex('name', 'name', { unique: false });
                s.createIndex('savedAt', 'savedAt', { unique: false });
            }
            if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
                db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
            }
        };
        req.onblocked = () => {
            console.warn('[Vault] DB blocked - cierra otras pestanas');
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

function dbPut(db, store, data) {
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(store, 'readwrite');
            tx.onerror = () => reject(tx.error);
            const r = tx.objectStore(store).put(data);
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
        } catch (e) { reject(e); }
    });
}
function dbGet(db, store, key) {
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(store, 'readonly');
            const r = tx.objectStore(store).get(key);
            r.onsuccess = () => resolve(r.result || null);
            r.onerror = () => reject(r.error);
        } catch (e) { reject(e); }
    });
}
function dbGetAll(db, store) {
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(store, 'readonly');
            const r = tx.objectStore(store).getAll();
            r.onsuccess = () => resolve(r.result || []);
            r.onerror = () => reject(r.error);
        } catch (e) { reject(e); }
    });
}
function dbDelete(db, store, key) {
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(store, 'readwrite');
            const r = tx.objectStore(store).delete(key);
            r.onsuccess = () => resolve();
            r.onerror = () => reject(r.error);
        } catch (e) { reject(e); }
    });
}
function dbClear(db, store) {
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(store, 'readwrite');
            const r = tx.objectStore(store).clear();
            r.onsuccess = () => resolve();
            r.onerror = () => reject(r.error);
        } catch (e) { reject(e); }
    });
}

function genId() {
    return crypto.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

/* ── Retrato (PNG de la carta) ──
   IndexedDB clona Blobs; JSON no. La sesion sigue sin llevar el File (snapshot.js
   ya lo deja fuera con persist:true). El personaje de la boveda si: sin el PNG
   no hay reexport, que es la moneda de este ecosistema. El bundle .scriptorium
   va por JSON, asi que ahi se pasa a base64 y al importar se vuelve a File. */

export function isPortraitBlob(value) {
    return value instanceof Blob && value.size > 0 && value.size <= MAX_PORTRAIT_BYTES;
}

export function asPortraitFile(blob, name = 'carta.png') {
    if (!isPortraitBlob(blob)) return null;
    if (blob instanceof File) return blob;
    const type = blob.type || 'image/png';
    const fileName = (typeof name === 'string' && name.trim()) ? name.trim() : 'carta.png';
    return new File([blob], fileName, { type });
}

function bytesToB64(bytes) {
    let binary = '';
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
        binary += String.fromCharCode(...bytes.subarray(i, i + step));
    }
    return btoa(binary);
}

export async function portraitToBundle(blob) {
    if (!isPortraitBlob(blob)) return null;
    const buf = await blob.arrayBuffer();
    if (buf.byteLength > MAX_PORTRAIT_BYTES) return null;
    return {
        b64: bytesToB64(new Uint8Array(buf)),
        name: blob instanceof File && blob.name ? blob.name : 'carta.png',
        type: blob.type || 'image/png'
    };
}

export function portraitFromBundle(entry, fallbackName = 'carta.png') {
    if (!entry || typeof entry !== 'object' || typeof entry.b64 !== 'string' || !entry.b64) return null;
    try {
        const binary = atob(entry.b64);
        if (!binary.length || binary.length > MAX_PORTRAIT_BYTES) return null;
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const type = typeof entry.type === 'string' && entry.type ? entry.type : 'image/png';
        const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : fallbackName;
        return new File([bytes], name, { type });
    } catch {
        return null;
    }
}

export class Vault {
    constructor() { this.db = null; this._autoSaveTimer = null; this._listeners = new Map(); }

    async init() {
        try { this.db = await openDB(); return true; }
        catch (err) { console.warn('[Vault] IndexedDB no disponible:', err); return false; }
    }

    on(ev, fn) { if (!this._listeners.has(ev)) this._listeners.set(ev, new Set()); this._listeners.get(ev).add(fn); }
    off(ev, fn) { this._listeners.get(ev)?.delete(fn); }
    _emit(ev, data) { this._listeners.get(ev)?.forEach(fn => { try { fn(data); } catch {} }); }

    async saveSession(state) {
        if (!this.db) return false;
        try {
            /* El formato es cosa de snapshot.js: aqui solo se anade `id`, que es
               el keyPath del store. `persist` deja fuera el File del PNG porque
               JSON.stringify lo mide como `{}` y la compuerta de tamaño dejaria
               de cumplir su funcion. La huella se toma antes de serializar: si
               algo cambia mientras se escribe, la diferencia queda pendiente
               para el siguiente tick en vez de darse por guardada sin estarlo. */
            const rev = revision(state);
            const snap = { id: 'current', ...serialize(state, { persist: true }) };
            const size = JSON.stringify(snap).length;
            if (size > 4 * 1024 * 1024) {
                console.warn('[Vault] sesion demasiado grande, no se guarda');
                return false;
            }
            await dbPut(this.db, STORES.SESSIONS, snap);
            state.vault.savedRev = rev;
            this._emit('session-saved', snap.savedAt);
            return true;
        } catch (e) {
            console.warn('[Vault] saveSession', e);
            return false;
        }
    }

    async loadSession() { return this.db ? dbGet(this.db, STORES.SESSIONS, 'current') : null; }
    async clearSession() { if (this.db) await dbDelete(this.db, STORES.SESSIONS, 'current'); }

    /* El autosave compara la huella del estado con la del ultimo guardado. Si
       algo muta sin que nadie lo anote, se entera igual. */
    startAutoSave(getStateFn, interval = AUTO_SAVE_MS) {
        this.stopAutoSave();
        // Base: lo que habia al arrancar. Sin ella se guardaria una sesion vacia.
        const s0 = getStateFn();
        if (s0) s0.vault.savedRev = revision(s0);
        this._autoSaveTimer = setInterval(async () => {
            try {
                const s = getStateFn();
                if (s && isDirty(s)) await this.saveSession(s);
            } catch (e) { console.warn('autosave', e); }
        }, interval);
    }
    stopAutoSave() { if (this._autoSaveTimer) { clearInterval(this._autoSaveTimer); this._autoSaveTimer = null; } }

    async saveCharacter({ card, name, charName, portrait } = {}) {
        if (!this.db) throw new Error('BD no disponible');
        if (!card || typeof card !== 'object') throw new Error('Carta invalida');
        const all = await this.getAllCharacters();

        const nm = (name || charName || 'Sin nombre').trim().slice(0, 120);
        // FIX: buscar existing ANTES de verificar limite
        const existing = all.find(c => c.name === nm);
        if (!existing && all.length >= MAX_CHARACTERS) throw new Error(`Boveda llena (${MAX_CHARACTERS} max)`);

        /* Sin retrato nuevo se conserva el que ya habia: cargar un JSON encima
           de un PNG no debe borrar la cara. Si el nuevo no cabe, tampoco. */
        let storedPortrait = existing?.portrait && isPortraitBlob(existing.portrait) ? existing.portrait : null;
        let storedName = typeof existing?.portraitName === 'string' && existing.portraitName
            ? existing.portraitName : 'carta.png';
        if (isPortraitBlob(portrait)) {
            storedPortrait = portrait;
            storedName = portrait instanceof File && portrait.name ? portrait.name : storedName;
        }

        const record = {
            id: existing?.id || genId(), name: nm,
            card: JSON.parse(JSON.stringify(card)),
            savedAt: Date.now(), version: existing ? (existing.version || 0) + 1 : 1,
            portrait: storedPortrait,
            portraitName: storedName
        };
        await dbPut(this.db, STORES.CHARACTERS, record);
        this._emit('character-saved', record);
        return record;
    }

    async getCharacter(id) { return this.db ? dbGet(this.db, STORES.CHARACTERS, id) : null; }

    async getAllCharacters() {
        if (!this.db) return [];
        const all = await dbGetAll(this.db, STORES.CHARACTERS);
        return all.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    }

    async deleteCharacter(id) {
        if (!this.db) return;
        await dbDelete(this.db, STORES.CHARACTERS, id);
        this._emit('character-deleted', id);
    }

    async downloadBundle(filename) {
        const characters = await this.getAllCharacters();
        const exported = [];
        for (const char of characters) {
            const { portrait, ...rest } = char;
            const packed = { ...rest };
            delete packed.portrait;
            const encoded = await portraitToBundle(portrait);
            if (encoded) packed.portraitB64 = encoded;
            exported.push(packed);
        }
        const bundle = {
            _format: BUNDLE_FORMAT,
            _version: BUNDLE_VERSION,
            exportedAt: new Date().toISOString(),
            characterCount: exported.length,
            characters: exported
        };
        const session = await this.loadSession();
        if (session) bundle.lastSession = session;
        const json = JSON.stringify(bundle, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = filename || `scriptorium_vault_${new Date().toISOString().slice(0, 10)}.scriptorium`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return exported.length;
    }

    async importBundleFromFile(file) {
        if (!file) throw new Error('Sin archivo');
        if (file.size > MAX_BUNDLE_BYTES) throw new Error('Bundle muy grande (max 50MB)');
        const text = await file.text();
        let bundle;
        try { bundle = JSON.parse(text); } catch { throw new Error('JSON no valido'); }
        if (bundle._format !== BUNDLE_FORMAT) throw new Error('Formato no reconocido - se esperaba scriptorium_vault');
        if (!Array.isArray(bundle.characters)) throw new Error('Sin personajes en bundle');

        // FIX: verificar limite durante importacion
        const existingAll = await this.getAllCharacters();
        let currentCount = existingAll.length;

        let imported = 0;
        for (const char of bundle.characters) {
            if (!char || typeof char !== 'object') continue;
            if (!char.id || !char.card) continue;
            if (typeof char.card !== 'object') continue;
            try {
                const existing = await this.getCharacter(char.id);
                if (existing && existing.savedAt >= char.savedAt) continue;
                // FIX: respetar limite al importar
                if (!existing && currentCount >= MAX_CHARACTERS) {
                    console.warn(`[Vault] importacion detenida: boveda llena (${MAX_CHARACTERS})`);
                    break;
                }
                if (!char.name) char.name = 'Importado';
                const record = { ...char };
                const fromBundle = portraitFromBundle(record.portraitB64, record.portraitName || record.name || 'carta.png');
                delete record.portraitB64;
                if (fromBundle) {
                    record.portrait = fromBundle;
                    record.portraitName = fromBundle.name;
                } else if (!isPortraitBlob(record.portrait)) {
                    delete record.portrait;
                }
                await dbPut(this.db, STORES.CHARACTERS, record);
                imported++;
                if (!existing) currentCount++;
            } catch (e) { console.warn('import char skip', e); }
        }
        if (bundle.lastSession && typeof bundle.lastSession === 'object') {
            try { await dbPut(this.db, STORES.SESSIONS, bundle.lastSession); } catch {}
        }
        this._emit('bundle-imported', imported);
        return imported;
    }

    async clearAll() {
        if (!this.db) return;
        await dbClear(this.db, STORES.CHARACTERS);
        await dbClear(this.db, STORES.SESSIONS);
        this._emit('vault-cleared');
    }

    destroy() { this.stopAutoSave(); if (this.db) { try { this.db.close(); } catch {} this.db = null; } }
}

const vault = new Vault();
export default vault;
