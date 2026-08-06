// js/utils.js

import { RESERVED_KEYS } from './state.js';

export const $ = (id) => document.getElementById(id);

export const sanitizeKey = (raw) =>
    raw.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');

export const isValidKey = (nk, cur) =>
    !!nk && nk !== cur && !RESERVED_KEYS.has(nk);

export const deepClone = (obj) => {
    try { return structuredClone(obj); }
    catch { return JSON.parse(JSON.stringify(obj)); }
};

export const countObjFields = (o) => {
    let c = 0;
    (function w(x) {
        for (const k in x) {
            if (!Object.prototype.hasOwnProperty.call(x, k)) continue;
            if (typeof x[k] === 'object' && x[k] !== null) w(x[k]);
            else if (typeof x[k] === 'string' && x[k].trim()) c++;
        }
    })(o);
    return c;
};

export function setNestedValue(obj, path, value) {
    const parts = path.split('.');
    if (parts.some(p => RESERVED_KEYS.has(p.toLowerCase()) || p === '')) {
        throw new Error('Ruta insegura: ' + path);
    }
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (cur[p] === undefined || cur[p] === null || typeof cur[p] !== 'object' || Array.isArray(cur[p])) {
            cur[p] = {};
        }
        cur = cur[p];
    }
    cur[parts[parts.length - 1]] = value;
}

export function deleteNestedValue(obj, path) {
    const parts = path.split('.');
    if (parts.some(p => RESERVED_KEYS.has(p.toLowerCase()) || !p)) return;
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        cur = cur?.[parts[i]];
        if (!cur || typeof cur !== 'object') return;
    }
    delete cur[parts.at(-1)];
}

export async function copyClip(text) {
    let ok = false;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            ok = true;
        }
    } catch { /* fallback */ }
    if (!ok) {
        let ta;
        try {
            ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            ok = document.execCommand('copy');
        } catch { ok = false; }
        finally { if (ta?.parentNode) ta.remove(); }
    }
    return ok;
}

export const TOAST_STYLES = {
    success: { icon: 'fa-circle-check', cls: 'text-gold', bd: 'border-border2' },
    error:   { icon: 'fa-circle-exclamation', cls: 'text-[#e05a5a]', bd: 'border-[#502020]' },
    info:    { icon: 'fa-circle-info', cls: 'text-user', bd: 'border-border2' }
};

let toastTm = null;
export function showToast(msg, type = 'success') {
    const s = TOAST_STYLES[type] || TOAST_STYLES.success;
    const t = $('toast');
    $('toastIcon').className = 'fa-solid ' + s.icon + ' ' + s.cls;
    for (const st of Object.values(TOAST_STYLES)) t.classList.remove(st.bd);
    t.classList.add(s.bd);
    $('toastMsg').textContent = msg;
    t.style.opacity = '1';
    t.style.transform = 'translate(-50%,0)';
    if (toastTm) clearTimeout(toastTm);
    toastTm = setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translate(-50%,1rem)';
    }, 3000);
}

export function trapFocus(e, el) {
    if (e.key !== 'Tab') return;
    const f = el.querySelectorAll(
        'button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
        'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    );
    if (!f.length) return;
    const a = f[0], z = f[f.length - 1];
    if (e.shiftKey) {
        if (document.activeElement === a) { e.preventDefault(); z.focus(); }
    } else {
        if (document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
}

let lastTrigger = null;
export function saveFocus() { lastTrigger = document.activeElement; }
export function restoreFocus() { if (lastTrigger) { lastTrigger.focus(); lastTrigger = null; } }
