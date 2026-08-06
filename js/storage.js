const DB_NAME = 'scriptorium_vault';
const DB_VERSION = 1;
const STORES = { SESSIONS: 'sessions', CHARACTERS: 'characters', SETTINGS: 'settings' };
const AUTO_SAVE_MS = 30_000;
const MAX_CHARACTERS = 500;

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
            console.warn('[Vault] DB blocked - cierra otras pestañas');
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
            const snap = {
                id: 'current', savedAt: Date.now(),
                file: state.file.uploaded, extracted: { ...state.file.extracted },
                procData: { ...state.proc.data }, procEdited: [...state.proc.edited],
                editorAdded: [...state.editor.added], editorRemoved: [...state.editor.removed],
                charName: document.getElementById('charName')?.value || '',
                userName: document.getElementById('userName')?.value || '',
                sysPrompt: document.getElementById('sysPrompt')?.value || '',
                userPersona: document.getElementById('userPersona')?.value || '',
                activeProfileId: state.profiles.active, editorActive: state.editor.active
            };
            // limit session size to 4MB
            const size = JSON.stringify(snap).length;
            if (size > 4 * 1024 * 1024) {
                console.warn('[Vault] sesion demasiado grande, no se guarda');
                return false;
            }
            await dbPut(this.db, STORES.SESSIONS, snap);
            this._emit('session-saved', snap.savedAt);
            return true;
        } catch (e) {
            console.warn('[Vault] saveSession', e);
            return false;
        }
    }

    async loadSession() { return this.db ? dbGet(this.db, STORES.SESSIONS, 'current') : null; }
    async clearSession() { if (this.db) await dbDelete(this.db, STORES.SESSIONS, 'current'); }

    startAutoSave(getStateFn, interval = AUTO_SAVE_MS) {
        this.stopAutoSave();
        this._autoSaveTimer = setInterval(async () => {
            try {
                const s = getStateFn();
                if (s && Object.keys(s.proc.data).length > 0) await this.saveSession(s);
            } catch (e) { console.warn('autosave', e); }
        }, interval);
    }
    stopAutoSave() { if (this._autoSaveTimer) { clearInterval(this._autoSaveTimer); this._autoSaveTimer = null; } }

    async saveCharacter({ card, name, charName }) {
        if (!this.db) throw new Error('BD no disponible');
        if (!card || typeof card !== 'object') throw new Error('Carta invalida');
        const all = await this.getAllCharacters();
        if (all.length >= MAX_CHARACTERS) throw new Error(`Boveda llena (${MAX_CHARACTERS} max)`);

        const nm = (name || charName || 'Sin nombre').trim().slice(0, 120);
        const existing = all.find(c => c.name === nm);
        const record = {
            id: existing?.id || genId(), name: nm,
            card: JSON.parse(JSON.stringify(card)),
            savedAt: Date.now(), version: existing ? (existing.version || 0) + 1 : 1
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
        const bundle = { _format: 'scriptorium_vault', _version: 1, exportedAt: new Date().toISOString(), characterCount: characters.length, characters };
        const session = await this.loadSession();
        if (session) bundle.lastSession = session;
        const json = JSON.stringify(bundle, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = filename || `scriptorium_vault_${new Date().toISOString().slice(0, 10)}.scriptorium`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return characters.length;
    }

    async importBundleFromFile(file) {
        if (!file) throw new Error('Sin archivo');
        if (file.size > 20 * 1024 * 1024) throw new Error('Bundle muy grande (max 20MB)');
        const text = await file.text();
        let bundle;
        try { bundle = JSON.parse(text); } catch { throw new Error('JSON no valido'); }
        if (bundle._format !== 'scriptorium_vault') throw new Error('Formato no reconocido - se esperaba scriptorium_vault');
        if (!Array.isArray(bundle.characters)) throw new Error('Sin personajes en bundle');
        let imported = 0;
        for (const char of bundle.characters) {
            if (!char || typeof char !== 'object') continue;
            if (!char.id || !char.card) continue;
            if (typeof char.card !== 'object') continue;
            try {
                const existing = await this.getCharacter(char.id);
                if (existing && existing.savedAt >= char.savedAt) continue;
                // validacion minima
                if (!char.name) char.name = 'Importado';
                await dbPut(this.db, STORES.CHARACTERS, char);
                imported++;
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
