import state, { TARGET_FIELDS, V2_DATA_FIELDS, RESERVED_KEYS, getExtracted } from './state.js';
import { $, deepClone, setNestedValue, deleteNestedValue, showToast } from './utils.js';

export function extractFields(obj) {
    state.file.extracted = {};
    state.characterBook.entries = [];
    state.altGreetings.original = '';
    state.altGreetings.list = [];
    state.altGreetings.current = 0;

    if (!obj || typeof obj !== 'object') return 0;
    let dup = 0;

    const seenObjects = new WeakSet();

    function walk(o, path) {
        if (!o || typeof o !== 'object') return;
        if (seenObjects.has(o)) return;
        seenObjects.add(o);
        if (Array.isArray(o)) return;
        for (const k in o) {
            if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
            if (RESERVED_KEYS.has(k.toLowerCase())) continue;
            const p = path ? path + '.' + k : k;
            const lk = k.toLowerCase();
            const v = o[k];
            if (typeof v === 'object' && v !== null) {
                if (path === '' && k === 'extensions') continue;
                walk(v, p);
                continue;
            }
            if (typeof v === 'string' && v.trim()) {
                let tk;
                if (TARGET_FIELDS.includes(lk)) {
                    if (state.file.extracted[k] === undefined) tk = k;
                    else { tk = p; dup++; }
                } else {
                    tk = p;
                }
                if (state.file.extracted[tk] !== undefined) continue;
                if (TARGET_FIELDS.includes(lk) || v.includes('{{char}}') || v.includes('{{user}}') || p.includes('persona') || p.includes('description')) {
                    state.file.extracted[tk] = v;
                }
            }
        }
    }

    const dataRoot = obj.data && typeof obj.data === 'object' ? obj.data : obj;
    walk(dataRoot, '');

    if (Object.keys(state.file.extracted).length === 0 && dataRoot !== obj) {
        walk(obj, '');
    }

    const ext = obj.data?.extensions ?? obj.extensions;
    if (ext && typeof ext === 'object' && !Array.isArray(ext)) {
        const scr = ext.scriptorium;
        if (scr && typeof scr === 'object' && scr.fields && typeof scr.fields === 'object') {
            for (const [k, v] of Object.entries(scr.fields)) {
                if (RESERVED_KEYS.has(k.toLowerCase())) continue;
                if (state.file.extracted[k] !== undefined) continue;
                let val;
                if (typeof v === 'object' && v !== null && 'value' in v) val = v.value;
                else if (typeof v === 'string') val = v;
                else continue;
                if (typeof val === 'string' && val.trim()) state.file.extracted[k] = val;
            }
        }
    }

    // Character Book
    state.characterBook.present = false;
    state.characterBook.metadata = {};

    const bookSrc = dataRoot.character_book ?? obj.character_book;
    if (bookSrc) {
        state.characterBook.present = true;
        const { entries: _omitEntries, ...bookMeta } = bookSrc;
        state.characterBook.metadata = (bookMeta && typeof bookMeta === 'object')
            ? JSON.parse(JSON.stringify(bookMeta))
            : {};

        if (bookSrc.entries && Array.isArray(bookSrc.entries)) {
            state.characterBook.entries = bookSrc.entries
                .filter(e => e && typeof e === 'object')
                .map(e => {
                    const preserved = JSON.parse(JSON.stringify(e));
                    preserved.keys = Array.isArray(e.keys)
                        ? e.keys.filter(k => typeof k === 'string')
                        : [];
                    preserved.content = String(e.content || '');
                    preserved.enabled = e.enabled !== false;
                    preserved.insertion_order = typeof e.insertion_order === 'number'
                        ? e.insertion_order : 0;
                    preserved.extensions = (e.extensions && typeof e.extensions === 'object')
                        ? JSON.parse(JSON.stringify(e.extensions))
                        : {};
                    return preserved;
                });
        }
    }

    // Alternate Greetings
    const altSrc = dataRoot.alternate_greetings ?? obj.alternate_greetings;
    if (Array.isArray(altSrc) && altSrc.length > 0) {
        state.altGreetings.list = altSrc.filter(g => typeof g === 'string' && g.trim());
        const fmSrc = dataRoot.first_mes ?? obj.first_mes ?? '';
        state.altGreetings.original = typeof fmSrc === 'string' ? fmSrc : '';
        state.altGreetings.current = 0;
    }

    return dup;
}

export function findCardByKey(key, view) {
    const v = view || document.getElementById('processedView');
    if (!v) return null;
    return [...v.querySelectorAll('.field-card')].find(c => c.dataset.key === key) ?? null;
}

export function buildExp() {
    const charNameEl = $('charName');
    const cn = charNameEl?.value.trim() || 'Character';
    let card;
    if (state.file.uploaded && typeof state.file.uploaded === 'object') {
        card = deepClone(state.file.uploaded);
        if (!card.data || typeof card.data !== 'object' || Array.isArray(card.data)) card.data = {};
    } else {
        card = { spec: 'chara_card_v2', spec_version: '2.0', data: {} };
    }
    card.spec = 'chara_card_v2';
    card.spec_version = '2.0';
    card.data.name = cn;

    // Migrate legacy extensions
    const legacyScriptorium = card.extensions?.scriptorium;
    if (legacyScriptorium) {
        if (!card.data.extensions || typeof card.data.extensions !== 'object' || Array.isArray(card.data.extensions)) {
            card.data.extensions = {};
        }
        const existingDataScr = card.data.extensions.scriptorium && typeof card.data.extensions.scriptorium === 'object' ? card.data.extensions.scriptorium : {};
        const existingDataFields = existingDataScr.fields && typeof existingDataScr.fields === 'object' ? existingDataScr.fields : {};
        const legacyFields = legacyScriptorium.fields && typeof legacyScriptorium.fields === 'object' ? legacyScriptorium.fields : {};
        card.data.extensions.scriptorium = {
            ...existingDataScr,
            version: legacyScriptorium.version || existingDataScr.version || 1,
            fields: { ...legacyFields, ...existingDataFields }
        };
        delete card.extensions.scriptorium;
        if (Object.keys(card.extensions).length === 0) {
            delete card.extensions;
        }
    }

    // Removidos
    for (const key of state.editor.removed) {
        try {
            deleteNestedValue(card.data, key);
            if (card.data?.extensions?.scriptorium?.fields?.[key] !== undefined) {
                delete card.data.extensions.scriptorium.fields[key];
            }
        } catch (err) {
            console.warn('remove key fail', key, err);
        }
    }

    const extFields = {};
    for (const [k, v] of Object.entries(state.proc.data)) {
        if (typeof v !== 'string') continue;
        if (k === 'system_prompt_global') { card.data.system_prompt = v; continue; }
        if (k in card.data || V2_DATA_FIELDS.has(k)) { card.data[k] = v; continue; }
        if (k.includes('.')) {
            try { setNestedValue(card.data, k, v); }
            catch (err) { showToast('Error en campo ' + k + ': ' + err.message, 'error'); }
            continue;
        }
        extFields[k] = { value: v, created: state.editor.added.has(k) };
    }

    if (Object.keys(extFields).length > 0) {
        if (!card.data.extensions || typeof card.data.extensions !== 'object' || Array.isArray(card.data.extensions)) {
            card.data.extensions = {};
        }
        const existing = card.data.extensions.scriptorium && typeof card.data.extensions.scriptorium === 'object' ? card.data.extensions.scriptorium : {};
        const existingFields = existing.fields && typeof existing.fields === 'object' ? existing.fields : {};
        card.data.extensions.scriptorium = {
            ...existing,
            version: 1,
            fields: { ...existingFields, ...extFields }
        };
    }

    if (card.data.extensions?.scriptorium?.fields && Object.keys(card.data.extensions.scriptorium.fields).length === 0) {
        delete card.data.extensions.scriptorium.fields;
    }

    // Character Book
    if (state.characterBook.present) {
        card.data.character_book = {
            ...deepClone(state.characterBook.metadata),
            entries: state.characterBook.entries.map(e => {
                const preserved = deepClone(e);
                preserved.keys = [...e.keys];
                preserved.content = e.content;
                preserved.enabled = e.enabled;
                preserved.insertion_order = e.insertion_order;
                preserved.extensions = deepClone(e.extensions || {});
                return preserved;
            })
        };
    }

    // Alternate Greetings (swap-aware)
    if (state.altGreetings.list.length > 0) {
        const allGreetings = [state.altGreetings.original, ...state.altGreetings.list];
        const current = state.altGreetings.current;
        const rest = allGreetings.filter((_, i) => i !== current);
        if (rest.length > 0) {
            card.data.alternate_greetings = rest;
        }
    }

    return card;
}
