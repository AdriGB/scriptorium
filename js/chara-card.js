import state, { TARGET_FIELDS, V2_DATA_FIELDS, VF, RESERVED_KEYS, getExtracted } from './state.js';
import { $, deepClone, setNestedValue, deleteNestedValue, showToast } from './utils.js';

export function extractFields(obj) {
    state.file.extracted = {};
    let dup = 0;
    function walk(o, path) {
        path = path || '';
        for (const k in o) {
            if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
            if (RESERVED_KEYS.has(k.toLowerCase())) continue;
            const p = path ? path + '.' + k : k, lk = k.toLowerCase();
            if (typeof o[k] === 'object' && o[k] !== null) { walk(o[k], p); continue; }
            if (typeof o[k] === 'string' && o[k].trim()) {
                let tk;
                if (TARGET_FIELDS.includes(lk)) {
                    if (state.file.extracted[k] === undefined) tk = k; else { tk = p; dup++; }
                } else tk = p;
                if (state.file.extracted[tk] !== undefined) continue;
                if (TARGET_FIELDS.includes(lk) || o[k].includes('{{char}}') || o[k].includes('{{user}}'))
                    state.file.extracted[tk] = o[k];
            }
        }
    }
    walk(obj.data && typeof obj.data === 'object' ? obj.data : obj);

    const ext = obj.extensions;
    if (ext && typeof ext === 'object') {
        const scr = ext.scriptorium;
        if (scr && typeof scr === 'object' && scr.fields && typeof scr.fields === 'object') {
            for (const [k, v] of Object.entries(scr.fields)) {
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
    return [...v.querySelectorAll('.field-card')].find(c => c.dataset.key === key) ?? null;
}

export function buildExp() {
    const cn = $('charName').value.trim() || 'Character';
    let card;
    if (state.file.uploaded && typeof state.file.uploaded === 'object') {
        card = deepClone(state.file.uploaded);
        if (!card.data || typeof card.data !== 'object') card.data = {};
    } else card = { spec: 'chara_card_v2', spec_version: '2.0', data: {} };
    card.spec = 'chara_card_v2';
    card.spec_version = '2.0';
    card.data.name = cn;

    for (const key of state.editor.removed) {
        deleteNestedValue(card.data, key);
        if (card.extensions?.scriptorium?.fields?.[key] !== undefined)
            delete card.extensions.scriptorium.fields[key];
    }

    const extFields = {};
    for (const [k, v] of Object.entries(state.proc.data)) {
        if (k === VF.SP) { card.data.system_prompt = v; continue; }
        if (k in card.data || V2_DATA_FIELDS.has(k)) { card.data[k] = v; continue; }
        if (k.includes('.')) { try { setNestedValue(card.data, k, v); } catch (err) { showToast(err.message, 'error'); } continue; }
        extFields[k] = { value: v, created: state.editor.added.has(k) };
    }

    if (Object.keys(extFields).length > 0) {
        if (!card.extensions) card.extensions = {};
        const existing = card.extensions.scriptorium || {};
        card.extensions.scriptorium = { ...existing, version: 1, fields: { ...(existing.fields || {}), ...extFields } };
    }
    return card;
}
