// js/utils.js - corregido

import { RESERVED_KEYS } from './state.js';

export const $ = (id) => document.getElementById(id);

/* Contenedor de campos visible, o null si esta activo el JSON.
   Vive aqui y no en ui.js porque lo consumen tanto el buscador como el indice de
   la scrollbar, y este modulo es hoja: importarlo desde cualquier parte no crea
   ciclos entre editor.js y ui.js. */
export function activeFieldView() {
    const json = $('jsonView');
    if (json && !json.classList.contains('hidden')) return null;
    const processed = $('processedView');
    if (processed && !processed.classList.contains('hidden')) return processed;
    const raw = $('rawView');
    if (raw && !raw.classList.contains('hidden')) return raw;
    return $('lorebookView');
}

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

/* ─── Toasts ───
   Con cola FIFO: antes un solo nodo se sobrescribia y los avisos rapidos se
   pisaban entre si. Ahora se encolan y cada uno conserva su propia accion. */
const MAX_TOASTS = 4;
const toastQueue = [];
let toastTm = null;
let toastActive = false;
let toastActionFn = null;

function dismissToast() {
    const t = $('toast');
    if (!t) return;
    t.style.opacity = '0';
    t.style.transform = 'translate(-50%,1rem)';
    const btn = $('toastAction');
    if (btn) { btn.classList.add('hidden'); btn.onclick = null; }
    toastActionFn = null;
}

function paintToast({ msg, type, action }) {
    const s = TOAST_STYLES[type] || TOAST_STYLES.success;
    const t = $('toast');
    const icon = $('toastIcon');
    const msgEl = $('toastMsg');
    if (!t || !icon || !msgEl) return;

    icon.className = 'fa-solid ' + s.icon + ' ' + s.cls;
    for (const st of Object.values(TOAST_STYLES)) t.classList.remove(st.bd);
    t.classList.add(s.bd);
    msgEl.textContent = msg;

    const btn = $('toastAction');
    if (btn) {
        toastActionFn = action?.onClick || null;
        if (action?.label && typeof toastActionFn === 'function') {
            btn.textContent = action.label;
            btn.onclick = () => {
                const fn = toastActionFn;
                if (toastTm) { clearTimeout(toastTm); toastTm = null; }
                dismissToast();
                toastActive = false;
                try { fn(); } catch (err) { console.error('[Toast action]', err); }
                pumpToast();
            };
            btn.classList.remove('hidden');
        } else {
            btn.classList.add('hidden');
            btn.onclick = null;
        }
    }

    t.style.opacity = '1';
    t.style.transform = 'translate(-50%,0)';
}

function pumpToast() {
    if (toastActive) return;
    const next = toastQueue.shift();
    if (!next) return;
    toastActive = true;
    paintToast(next);
    if (toastTm) clearTimeout(toastTm);
    // Con accion disponible se deja mas tiempo para reaccionar.
    toastTm = setTimeout(() => {
        dismissToast();
        toastActive = false;
        pumpToast();
    }, next.action ? 9000 : 3000);
}

/**
 * @param {object} [action] Opcional. { label: string, onClick: Function }
 *                 Muestra un boton dentro del toast (p. ej. "Deshacer").
 *                 Al pulsarlo se oculta el toast y se ejecuta onClick.
 */
export function showToast(msg, type = 'success', action = null) {
    const t = $('toast');
    if (!t || !$('toastIcon') || !$('toastMsg')) {
        console.log(`[Toast ${type}] ${msg}`);
        return;
    }
    toastQueue.push({ msg, type, action });
    // Si se disparan muchos de golpe, se descartan los mas viejos.
    if (toastQueue.length > MAX_TOASTS) toastQueue.splice(0, toastQueue.length - MAX_TOASTS);
    pumpToast();
}

/* ─── Confirm dialog ───
   Reemplaza los dialogos nativos del navegador por un modal con el estilo de la app.
   Vive aqui (junto a showToast) para que cualquier modulo pueda usarlo sin
   importar ui.js, lo que crearia un ciclo de modulos. */

const OK_BASE = 'font-cinzel text-[0.65rem] tracking-wider uppercase rounded-lg px-5 py-2 transition-all ';
const OK_NORMAL = 'text-bg bg-gold hover:brightness-110';
const OK_DANGER = 'text-white bg-[#8c2f2f] hover:brightness-110';
const CANCEL_BASE = 'font-cinzel text-[0.65rem] tracking-wider uppercase rounded-lg px-4 py-2 transition-all ';
const CANCEL_NORMAL = 'text-text3 hover:text-text1 border border-border1 hover:border-border2';
const CANCEL_DANGER = 'text-[#e05a5a] border border-[#502020] hover:bg-[#3a1a1a]';

let confirmResolve = null;

/**
 * @returns {Promise<'ok'|'cancel'|'extra'>}
 * @param {string} [opts.danger] 'ok' | 'cancel' — cual de los dos botones se pinta como destructivo.
 * @param {string} [opts.extraLabel] Si se indica, anade un tercer boton que resuelve 'extra'.
 */
export function confirmDialog({
    title = 'Confirmar',
    message = '',
    okLabel = 'Aceptar',
    cancelLabel = 'Cancelar',
    extraLabel = '',
    icon = 'fa-circle-question',
    danger = null
} = {}) {
    return new Promise((resolve) => {
        const modal = $('confirmModal');
        if (!modal) { resolve(window.confirm(message) ? 'ok' : 'cancel'); return; }
        confirmResolve = resolve;

        $('confirmTitle').textContent = title;
        $('confirmMessage').textContent = message;
        $('confirmIcon').className = 'fa-solid ' + icon + ' text-sm ' + (danger === 'cancel' ? 'text-[#e05a5a]' : 'text-gold');

        const ok = $('confirmOkBtn');
        ok.textContent = okLabel;
        ok.className = OK_BASE + (danger === 'ok' ? OK_DANGER : OK_NORMAL);

        const cancel = $('confirmCancelBtn');
        cancel.textContent = cancelLabel || 'Cancelar';
        cancel.className = CANCEL_BASE + (danger === 'cancel' ? CANCEL_DANGER : CANCEL_NORMAL);
        cancel.classList.toggle('hidden', !cancelLabel);

        const extra = $('confirmExtraBtn');
        extra.textContent = extraLabel || '';
        extra.classList.toggle('hidden', !extraLabel);

        modal.classList.remove('hidden');
        modal.classList.add('flex');
        (extraLabel ? extra : ok).focus();
    });
}

/** Cierra el dialogo resolviendo la promesa. Devuelve false si no estaba abierto. */
export function closeConfirmDialog(result) {
    const modal = $('confirmModal');
    if (!modal || modal.classList.contains('hidden')) return false;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    const resolve = confirmResolve;
    confirmResolve = null;
    if (resolve) resolve(result);
    return true;
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