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

/* Escape para interpolar texto en HTML. Sin DOM (ni `createElement` ni `textContent`),
   para poder importarlo en Node desde los tests.

   Escapa tambien las comillas, no solo `& < >`: en el atributo de una etiqueta
   (`title="..."`, `aria-label="..."`) solo con `& < >` no basta, porque un
   nombre de personaje con comillas se saldria del atributo y meteria marcado
   propio. Es justo como se interpola el nombre en los botones de la boveda,
   asi que una version que no las escape es una inyeccion esperando sitio.

   Se usa tanto en posicion de contenido como de atributo: en contenido las
   comillas no hacen dana, y en atributo son imprescindibles. Una sola funcion
   para las dos evita tener que acordarse de cual hacia falta en cada sitio. */
export const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

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

/* Clonar no admite "mas o menos": el `{}` que se devolvia al fallar no era un
   clon, era perder datos con forma de exito. `snapshot.js` clona aqui el
   lorebook y los saludos alternativos, asi que una carta que no se pudiera
   clonar se guardaba sin ellos **por encima de la sesion buena**: al recargar,
   el lorebook habia desaparecido y no habia forma de saber por que.

   Ahora el fallo se propaga. En `saveSession` el throw ocurre al serializar,
   antes del `dbPut`, asi que la sesion anterior sigue intacta en el disco: se
   pierde un guardado, no el trabajo. Y en la exportacion aborta antes de
   escribir una carta vacia.

   Los primitivos (incluidas las funciones) se devuelven tal cual: son
   inmutables, no hay nada que clonar, y `structuredClone` lanzaria por ellas
   sin motivo. */
export const deepClone = (obj) => {
    if (obj === null || typeof obj !== 'object') return obj;
    try {
        return structuredClone(obj);
    } catch (err) {
        // Puede contener funciones, proxies o nodos del DOM.
        console.warn('[deepClone] structuredClone fallo, se intenta por JSON', err);
    }
    try {
        /* Degradacion, no equivalencia: JSON se come las funciones, convierte
           las fechas en cadena y vacia Map y Set. Solo se llega aqui con
           objetos que structuredClone ya rechazo, y se avisa por consola. */
        return JSON.parse(JSON.stringify(obj));
    } catch (err) {
        throw new Error('deepClone: el valor no se puede clonar (' + (err?.message || 'sin detalle') + ')');
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

/* ─── Peso del texto ───
   Los tokens son una estimacion (~4 chars por token en castellano): sirven para
   comparar cartas entre si y para saber si una se va a comer el contexto, no
   para cuadrar la cuenta de un modelo concreto. Los umbrales son orientativos y
   estan aqui, no repartidos por la UI, para que se puedan mover de una vez. */
export const TOKENS_PER_CHAR = 1 / 4;
export const HEAVY_FIELD = 1200; // tokens en un solo campo
export const HEAVY_CARD = 3000;  // tokens en toda la carta procesada

export function textStats(text) {
    const s = String(text ?? '');
    const chars = s.length;
    const words = s.trim() ? s.trim().split(/\s+/).length : 0;
    return { chars, words, tokens: Math.round(chars * TOKENS_PER_CHAR) };
}

export function statsLabel(text) {
    const { chars, words, tokens } = textStats(text);
    const n = (v) => v.toLocaleString('es');
    return `${n(chars)} chars · ${n(words)} palabra${words === 1 ? '' : 's'} · ≈${n(tokens)} tokens`;
}

/* Marcadores {{char}} / {{user}} que siguen literales despues de procesar. Es el
   fallo silencioso tipico: si no se rellena el nombre, la sustitucion no ocurre
   y la carta se exporta con las llaves puestas. */
export function countMarkers(text) {
    return (String(text ?? '').match(/\{\{(?:char|user)\}\}/gi) || []).length;
}

/* Detecta macros mal formadas o con sintaxis invalida:
   {char}}, {{char}, $char o $user. Evita fallos silenciosos en SillyTavern. */
export function detectBrokenMacros(text) {
    if (!text || typeof text !== 'string') return [];
    const issues = [];
    if (/(?:^|[^{])\{(?:\s*(?:char|user)\s*\}\})/i.test(text)) {
        issues.push('{char}} o {user}} (falta una llave de apertura)');
    }
    if (/(\{\{\s*(?:char|user)\s*\})(?:[^}]|$)/i.test(text)) {
        issues.push('{{char} o {{user} (falta una llave de cierre)');
    }
    if (/\$(?:\{)?\s*(?:char|user)\s*(?:\})?/i.test(text)) {
        issues.push('$char o ' + '$' + '{char} (formato no soportado por SillyTavern)');
    }
    return issues;
}

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
let toastRemainingMs = 0;
let toastStartedAt = 0;

function dismissToast() {
    const t = $('toast');
    if (!t) return;
    t.style.opacity = '0';
    t.style.transform = 'translate(-50%,1rem)';
    t.style.pointerEvents = 'none';
    const btn = $('toastAction');
    if (btn) { btn.classList.add('hidden'); btn.onclick = null; }
    const closeBtn = $('toastClose');
    if (closeBtn) { closeBtn.classList.add('hidden'); closeBtn.onclick = null; }
    toastActionFn = null;
    if (toastTm) { clearTimeout(toastTm); toastTm = null; }
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
    const closeBtn = $('toastClose');

    if (btn) {
        toastActionFn = action?.onClick || null;
        if (action?.label && typeof toastActionFn === 'function') {
            btn.textContent = action.label;
            btn.onclick = () => {
                const fn = toastActionFn;
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

    if (closeBtn) {
        if (action?.label) {
            closeBtn.classList.remove('hidden');
            closeBtn.onclick = () => {
                dismissToast();
                toastActive = false;
                pumpToast();
            };
        } else {
            closeBtn.classList.add('hidden');
            closeBtn.onclick = null;
        }
    }

    t.style.opacity = '1';
    t.style.transform = 'translate(-50%,0)';
    t.style.pointerEvents = 'auto';
}

function ensureToastListeners() {
    const t = $('toast');
    if (!t || t.dataset.hoverWired) return;
    t.dataset.hoverWired = 'true';

    t.addEventListener('mouseenter', () => {
        if (toastTm && toastActive) {
            clearTimeout(toastTm);
            toastTm = null;
            const elapsed = Date.now() - toastStartedAt;
            toastRemainingMs = Math.max(1000, toastRemainingMs - elapsed);
        }
    });

    t.addEventListener('mouseleave', () => {
        if (!toastTm && toastActive) {
            toastStartedAt = Date.now();
            toastTm = setTimeout(() => {
                dismissToast();
                toastActive = false;
                pumpToast();
            }, toastRemainingMs);
        }
    });
}

function pumpToast() {
    if (toastActive) return;
    const next = toastQueue.shift();
    if (!next) return;
    ensureToastListeners();
    toastActive = true;
    paintToast(next);
    if (toastTm) clearTimeout(toastTm);
    toastRemainingMs = next.action ? 9000 : 3000;
    toastStartedAt = Date.now();
    toastTm = setTimeout(() => {
        dismissToast();
        toastActive = false;
        pumpToast();
    }, toastRemainingMs);
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