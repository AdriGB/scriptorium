// js/utils.js - corregido

import { RESERVED_KEYS } from './state.js';

export const $ = (id) => document.getElementById(id);

export const sanitizeKey = (raw) => {
    if (!raw || typeof raw !== 'string') return '';
    return raw.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').slice(0, 64).replace(/^_+|_+$/g, '');
};

export const isValidKey = (nk, cur) => {
    if (!nk) return false;
    if (nk.length < 2) return false;
    if (nk === cur) return false;
    if (RESERVED_KEYS.has(nk.toLowerCase())) return false;
    return /^[a-z][a-z0-9_]*$/.test(nk);
};

export const deepClone = (obj) => {
    try { return structuredClone(obj); }
    catch {
        try { return JSON.parse(JSON.stringify(obj)); }
        catch { return {}; }
    }
};

export const countObjFields = (o) => {
    let c = 0;
    const seen = new WeakSet();
    (function w(x) {
        if (!x || typeof x !== 'object') return;
        if (seen.has(x)) return;
        seen.add(x);
        for (const k in x) {
            if (!Object.prototype.hasOwnProperty.call(x, k)) continue;
            const v = x[k];
            if (typeof v === 'object' && v !== null) w(v);
            else if (typeof v === 'string' && v.trim()) c++;
        }
    })(o);
    return c;
};

export function setNestedValue(obj, path, value) {
    if (!obj || typeof obj !== 'object') throw new Error('Objeto invalido');
    const parts = path.split('.');
    if (parts.some(p => !p || RESERVED_KEYS.has(p.toLowerCase()))) {
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
    if (!obj || typeof obj !== 'object') return false;
    const parts = path.split('.');
    if (parts.some(p => !p || RESERVED_KEYS.has(p.toLowerCase()))) return false;
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        cur = cur?.[parts[i]];
        if (!cur || typeof cur !== 'object') return false;
    }
    const last = parts.at(-1);
    if (last in cur) {
        delete cur[last];
        return true;
    }
    return false;
}

export async function copyClip(text) {
    if (!text) return false;
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
            ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            ok = document.execCommand('copy');
        } catch { ok = false; }
        finally { if (ta?.parentNode) ta.remove(); }
    }
    return ok;
}

/* ── Storage wrapper for localStorage ── */
export const Storage = {
    get(key, fallback = null) {
        try {
            const value = localStorage.getItem(key);
            return value === null ? fallback : JSON.parse(value);
        } catch { return fallback; }
    },
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            if (error.name === 'QuotaExceededError' || error.code === 22) {
                showToast('Almacenamiento local lleno.', 'error');
            }
            return false;
        }
    },
    getBool(key) {
        try { return localStorage.getItem(key) === '1'; }
        catch { return false; }
    },
    setBool(key, value) {
        try { localStorage.setItem(key, value ? '1' : '0'); return true; }
        catch { return false; }
    }
};

export const TOAST_STYLES = {
    success: { icon: 'fa-circle-check', cls: 'text-gold', bd: 'border-border2' },
    error:   { icon: 'fa-circle-exclamation', cls: 'text-[#e05a5a]', bd: 'border-[#502020]' },
    info:    { icon: 'fa-circle-info', cls: 'text-user', bd: 'border-border2' }
};

let toastTm = null;
export function showToast(msg, type = 'success') {
    const s = TOAST_STYLES[type] || TOAST_STYLES.success;
    const t = $('toast');
    const icon = $('toastIcon');
    const msgEl = $('toastMsg');
    if (!t || !icon || !msgEl) {
        console.log(`[Toast ${type}] ${msg}`);
        return;
    }
    icon.className = 'fa-solid ' + s.icon + ' ' + s.cls;
    for (const st of Object.values(TOAST_STYLES)) t.classList.remove(st.bd);
    t.classList.add(s.bd);
    msgEl.textContent = msg;
    t.style.opacity = '1';
    t.style.transform = 'translate(-50%,0)';
    if (toastTm) clearTimeout(toastTm);
    toastTm = setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translate(-50%,1rem)';
    }, 3000);
}

export function trapFocus(e, el) {
    if (e.key !== 'Tab' || !el) return;
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
export function restoreFocus() {
    try {
        if (lastTrigger && typeof lastTrigger.focus === 'function') {
            lastTrigger.focus();
        }
    } catch {}
    lastTrigger = null;
}