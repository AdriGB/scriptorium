import state, { TARGET_FIELDS, V2_DATA_FIELDS, RESERVED_KEYS, getExtracted } from './state.js';
import { $, deepClone, setNestedValue, deleteNestedValue, showToast } from './utils.js';

export function extractFields(obj) {
    state.file.extracted = {};
    if (!obj || typeof obj !== 'object') return 0;
    let dup = 0;

    const seenObjects = new WeakSet();

    function walk(o, path) {
        if (!o || typeof o !== 'object') return;
        if (seenObjects.has(o)) return;
        seenObjects.add(o);
        if (Array.isArray(o)) {
            // no entramos en arrays para evitar ruido, pero si son de strings los ignoramos
            return;
        }
        for (const k in o) {
            if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
            if (RESERVED_KEYS.has(k.toLowerCase())) continue;
            const p = path ? path + '.' + k : k;
            const lk = k.toLowerCase();
            const v = o[k];
            if (typeof v === 'object' && v !== null) {
                // evita entrar en extensions aqui, se maneja aparte
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
                // solo guardamos si es campo target o contiene placeholders
                if (TARGET_FIELDS.includes(lk) || v.includes('{{char}}') || v.includes('{{user}}') || p.includes('persona') || p.includes('description')) {
                    state.file.extracted[tk] = v;
                }
            }
        }
    }

    const dataRoot = obj.data && typeof obj.data === 'object' ? obj.data : obj;
    walk(dataRoot, '');

    // Si no encontro nada en data, intenta en raiz
    if (Object.keys(state.file.extracted).length === 0 && obj.data !== dataRoot) {
        walk(obj, '');
    }

    // Extraer de extensions.scriptorium
    const ext = obj.extensions;
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

    // Removidos
    for (const key of state.editor.removed) {
        try {
            deleteNestedValue(card.data, key);
            if (card.extensions?.scriptorium?.fields?.[key] !== undefined) {
                delete card.extensions.scriptorium.fields[key];
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
        if (!card.extensions) card.extensions = {};
        const existing = card.extensions.scriptorium && typeof card.extensions.scriptorium === 'object' ? card.extensions.scriptorium : {};
        const existingFields = existing.fields && typeof existing.fields === 'object' ? existing.fields : {};
        card.extensions.scriptorium = {
            ...existing,
            version: 1,
            fields: { ...existingFields, ...extFields }
        };
    }

    // Limpia extensiones vacias
    if (card.extensions?.scriptorium?.fields && Object.keys(card.extensions.scriptorium.fields).length === 0) {
        delete card.extensions.scriptorium.fields;
    }

    return card;
}
