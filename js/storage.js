// js/storage.js

const DB_NAME = 'scriptorium_vault';
const DB_VERSION = 1;
const STORES = {
    SESSIONS: 'sessions',
    CHARACTERS: 'characters',
    SETTINGS: 'settings'
};
const AUTO_SAVE_MS = 30_000;

/* ───────── IndexedDB wrapper ───────── */

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (e) => {
            const db = e.target.result;

            if (!db.objectStoreNames.contains(STORES.SESSIONS)) {
                db.createObjectStore(STORES.SESSIONS, { keyPath: 'id' });
            }

            if (!db.objectStoreNames.contains(STORES.CHARACTERS)) {
                const store = db.createObjectStore(STORES.CHARACTERS, { keyPath: 'id' });
                store.createIndex('name', 'name', { unique: false });
                store.createIndex('savedAt', 'savedAt', { unique: false });
            }

            if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
                db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
            }
        };

        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

function dbPut(db, storeName, data) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).put(data);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbGet(db, storeName, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

function dbGetAll(db, storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

function dbDelete(db, storeName, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

function dbClear(db, storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/* ───────── Generar IDs ───────── */

function genId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 12);
}

/* ───────── Clase principal ───────── */

export class Vault {
    constructor() {
        this.db = null;
        this._ready = null;
        this._autoSaveTimer = null;
        this._listeners = new Map();
    }

    /* ── Inicialización ── */

    async init() {
        try {
            this.db = await openDB();
            console.log('[Vault] IndexedDB listo');
            return true;
        } catch (err) {
            console.warn('[Vault] IndexedDB no disponible:', err);
            return false;
        }
    }

    /* ── Eventos ── */

    on(event, fn) {
        if (!this._listeners.has(event)) this._listeners.set(event, new Set());
        this._listeners.get(event).add(fn);
    }

    off(event, fn) {
        this._listeners.get(event)?.delete(fn);
    }

    _emit(event, data) {
        this._listeners.get(event)?.forEach(fn => fn(data));
    }

    /* ── Sesión (auto-guardado) ── */

    async saveSession(state) {
        if (!this.db) return;
        try {
            const snapshot = {
                id: 'current',
                savedAt: Date.now(),
                file: state.file.uploaded,
                extracted: { ...state.file.extracted },
                procData: { ...state.proc.data },
                procEdited: [...state.proc.edited],
                editorAdded: [...state.editor.added],
                editorRemoved: [...state.editor.removed],
                charName: document.getElementById('charName')?.value || '',
                userName: document.getElementById('userName')?.value || '',
                sysPrompt: document.getElementById('sysPrompt')?.value || '',
                userPersona: document.getElementById('userPersona')?.value || '',
                activeProfileId: state.profiles.active,
                editorActive: state.editor.active
            };
            await dbPut(this.db, STORES.SESSIONS, snapshot);
            this._emit('session-saved', snapshot.savedAt);
            return true;
        } catch (err) {
            console.warn('[Vault] Error guardando sesión:', err);
            return false;
        }
    }

    async loadSession() {
        if (!this.db) return null;
        try {
            return await dbGet(this.db, STORES.SESSIONS, 'current');
        } catch {
            return null;
        }
    }

    async clearSession() {
        if (!this.db) return;
        await dbDelete(this.db, STORES.SESSIONS, 'current');
    }

    /* ── Auto-guardado ── */

    startAutoSave(getStateFn, interval = AUTO_SAVE_MS) {
        this.stopAutoSave();
        this._autoSaveTimer = setInterval(async () => {
            const state = getStateFn();
            if (state && Object.keys(state.proc.data).length > 0) {
                await this.saveSession(state);
            }
        }, interval);
    }

    stopAutoSave() {
        if (this._autoSaveTimer) {
            clearInterval(this._autoSaveTimer);
            this._autoSaveTimer = null;
        }
    }

    /* ── Bóveda de personajes ── */

    async saveCharacter({ card, name, charName }) {
        if (!this.db) throw new Error('Base de datos no disponible');

        const existing = await this.findCharacterByName(name || charName || 'Sin nombre');
        const id = existing?.id || genId();

        const record = {
            id,
            name: name || charName || 'Sin nombre',
            card: JSON.parse(JSON.stringify(card)),
            savedAt: Date.now(),
            version: existing ? (existing.version || 0) + 1 : 1
        };

        await dbPut(this.db, STORES.CHARACTERS, record);
        this._emit('character-saved', record);
        return record;
    }

    async getCharacter(id) {
        if (!this.db) return null;
        return dbGet(this.db, STORES.CHARACTERS, id);
    }

    async getAllCharacters() {
        if (!this.db) return [];
        const all = await dbGetAll(this.db, STORES.CHARACTERS);
        return all.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    }

    async findCharacterByName(name) {
        const all = await this.getAllCharacters();
        return all.find(c => c.name === name) || null;
    }

    async deleteCharacter(id) {
        if (!this.db) return;
        await dbDelete(this.db, STORES.CHARACTERS, id);
        this._emit('character-deleted', id);
    }

    async renameCharacter(id, newName) {
        const existing = await this.getCharacter(id);
        if (!existing) throw new Error('Personaje no encontrado');
        existing.name = newName;
        await dbPut(this.db, STORES.CHARACTERS, existing);
        this._emit('character-renamed', existing);
        return existing;
    }

    async getCharacterCount() {
        if (!this.db) return 0;
        const all = await dbGetAll(this.db, STORES.CHARACTERS);
        return all.length;
    }

    /* ── Configuración ── */

    async getSetting(key) {
        if (!this.db) return undefined;
        const record = await dbGet(this.db, STORES.SETTINGS, key);
        return record?.value;
    }

    async setSetting(key, value) {
        if (!this.db) return;
        await dbPut(this.db, STORES.SETTINGS, { key, value });
    }

    /* ── Exportar bóveda completa como archivo ── */

    async exportBundle() {
        const characters = await this.getAllCharacters();
        const session = await this.loadSession();

        const bundle = {
            _format: 'scriptorium_vault',
            _version: 1,
            exportedAt: new Date().toISOString(),
            characterCount: characters.length,
            characters
        };

        if (session) {
            bundle.lastSession = session;
        }

        return bundle;
    }

    async downloadBundle(filename) {
        const bundle = await this.exportBundle();
        const json = JSON.stringify(bundle, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `scriptorium_vault_${new Date().toISOString().slice(0, 10)}.scriptorium`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        return bundle.characterCount;
    }

    /* ── Importar bóveda desde archivo ── */

    async importBundleFromFile(file) {
        const text = await file.text();
        let bundle;

        try {
            bundle = JSON.parse(text);
        } catch {
            throw new Error('El archivo no es JSON válido');
        }

        if (bundle._format !== 'scriptorium_vault') {
            throw new Error('Formato no reconocido. Se esperaba un archivo .scriptorium');
        }

        if (!Array.isArray(bundle.characters)) {
            throw new Error('El archivo no contiene personajes válidos');
        }

        let imported = 0;
        for (const char of bundle.characters) {
            if (!char.id || !char.card) continue;

            const existing = await this.getCharacter(char.id);
            if (existing && existing.savedAt >= char.savedAt) continue;

            await dbPut(this.db, STORES.CHARACTERS, char);
            imported++;
        }

        if (bundle.lastSession) {
            await dbPut(this.db, STORES.SESSIONS, bundle.lastSession);
        }

        this._emit('bundle-imported', imported);
        return imported;
    }

    /* ── Importar personaje individual desde JSON ── */

    async importCharacterFromFile(file) {
        const text = await file.text();
        let card;

        try {
            card = JSON.parse(text);
        } catch {
            throw new Error('JSON no válido');
        }

        const name = card.name
            || card.data?.name
            || card.char_name
            || file.name.replace(/\.json$/i, '')
            || 'Sin nombre';

        return this.saveCharacter({
            card,
            name,
            charName: name
        });
    }

    /* ── Vaciar bóveda ── */

    async clearAll() {
        if (!this.db) return;
        await dbClear(this.db, STORES.CHARACTERS);
        await dbClear(this.db, STORES.SESSIONS);
        this._emit('vault-cleared');
    }

    /* ── Destruir conexión ── */

    destroy() {
        this.stopAutoSave();
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}

/* ───────── Singleton ───────── */
const vault = new Vault();
export default vault;
