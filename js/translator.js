import { Storage, showToast } from './utils.js';
import { STORAGE_KEYS } from './state.js';

export function splitCh(t, ml = 1800) {
    const c = [];
    let r = t;
    while (r.length > ml) {
        let i = r.lastIndexOf('\n', ml);
        if (i < ml * 0.5) i = r.lastIndexOf(' ', ml);
        if (i < 1) i = ml;
        c.push(r.slice(0, i));
        r = r.slice(i);
    }
    if (r) c.push(r);
    return c;
}

export async function trChunk(t, tl, sig) {
    const res = await fetch(
        'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' + tl + '&dt=t&q=' + encodeURIComponent(t),
        { signal: sig }
    );
    if (!res.ok) throw new Error('http-' + res.status);
    const d = await res.json();
    return d[0].map(s => s[0]).join('');
}

export function protectMacros(text) {
    if (!text || typeof text !== 'string') return { text: '', map: [] };
    const map = [];
    const protectedText = text.replace(/\{\{\s*[\w.-]+\s*\}\}/gi, (match) => {
        const token = `⟦VAR_${map.length}⟧`;
        map.push({ token, original: match });
        return token;
    });
    return { text: protectedText, map };
}

export function unprotectMacros(text, map) {
    if (!text || !Array.isArray(map) || map.length === 0) return text || '';
    let restored = text;
    for (const { token, original } of map) {
        const cleanToken = token.replace(/[⟦⟧]/g, '');
        const re = new RegExp(`⟦\\s*${cleanToken}\\s*⟧`, 'g');
        restored = restored.replace(re, original);
    }
    return restored;
}

export async function trText(t, tl = 'es', sig, onProgress) {
    if (!t || !t.trim()) return '';
    const { text: safeText, map } = protectMacros(t);
    const chunks = splitCh(safeText), total = chunks.length, results = [];
    for (let i = 0; i < total; i++) {
        if (sig?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (onProgress) onProgress(i + 1, total);
        try { results.push(await trChunk(chunks[i], tl, sig)); }
        catch (err) {
            if (err.name === 'AbortError') throw err;
            results.push('[fragmento no traducido]');
        }
    }
    return unprotectMacros(results.join(''), map);
}

export function checkTranslationPrivacy() {
    if (Storage.getBool(STORAGE_KEYS.TR_PRIVACY)) return Promise.resolve(true);
    return new Promise(resolve => {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 z-[70] flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="absolute inset-0 bg-black/70 backdrop-blur-sm"></div>
            <div class="relative bg-surface border border-border2 rounded-xl w-full max-w-md shadow-[0_20px_60px_rgba(0,0,0,0.6)] animate-fade-in-up">
                <div class="flex items-center gap-3 px-5 py-3.5 border-b border-border1 bg-gradient-to-r from-[#2a1f00] to-[#1c1600] rounded-t-xl">
                    <i class="fa-solid fa-shield-halved text-gold text-sm"></i>
                    <h3 class="font-cinzel text-xs tracking-widest uppercase text-gold flex-1">Aviso de Privacidad</h3>
                </div>
                <div class="p-5 space-y-4 font-crimson text-sm text-text1 leading-relaxed">
                    <p>La funci&oacute;n de <strong class="text-violet2">Traducir</strong> env&iacute;a el texto seleccionado al servicio externo de <strong>Google Translate</strong>.</p>
                    <div class="bg-[#1a1500] border border-goldDim/30 rounded-lg p-3 text-xs text-gold2">
                        <i class="fa-solid fa-circle-info mr-1"></i>
                        Los archivos permanecen en tu dispositivo. Solo el texto que decidas traducir abandona tu navegador.
                    </div>
                    <label class="flex items-center gap-2 text-xs text-text3 cursor-pointer">
                        <input type="checkbox" id="trRememberCheck" class="accent-[#c9a84c]">
                        <span>No volver a preguntar</span>
                    </label>
                </div>
                <div class="flex items-center justify-end gap-3 px-5 py-3.5 border-t border-border1">
                    <button id="trCancel" class="font-cinzel text-[0.65rem] tracking-wider uppercase text-text3 hover:text-text1 border border-border1 hover:border-border2 rounded-lg px-4 py-2 transition-all">Cancelar</button>
                    <button id="trAccept" class="font-cinzel text-[0.65rem] tracking-wider uppercase text-bg bg-violet hover:brightness-110 rounded-lg px-5 py-2 transition-all"><i class="fa-solid fa-language text-[0.6rem]"></i> Traducir</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        const cancelBtn = modal.querySelector('#trCancel');
        const acceptBtn = modal.querySelector('#trAccept');
        const rememberCheck = modal.querySelector('#trRememberCheck');
        acceptBtn.focus();
        const cleanup = (result) => {
            if (rememberCheck.checked && result) Storage.setBool(STORAGE_KEYS.TR_PRIVACY, true);
            modal.remove();
            resolve(result);
        };
        cancelBtn.addEventListener('click', () => cleanup(false));
        acceptBtn.addEventListener('click', () => cleanup(true));
        modal.addEventListener('keydown', e => { if (e.key === 'Escape') cleanup(false); });
    });
}
