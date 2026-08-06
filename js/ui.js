import state, { STORAGE_KEYS } from './state.js';
import { $, Storage, showToast, trapFocus } from './utils.js';
import { renderJSON, updJS, applyJE } from './editor.js';

/* ─── Canvas ─── */
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let W, H, stars = [], lastFrame = 0;
const FPS_CAP = 30, FRAME_INTERVAL = 1000 / FPS_CAP;

export function initCanvas() {
    const canvas = $('stars-canvas'), ctx = canvas.getContext('2d');
    if (prefersReduced) { canvas.style.display = 'none'; return; }

    function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
    function init() {
        resize();
        const count = Math.min(200, Math.max(40, Math.floor((W * H) / 8000)));
        stars = Array.from({ length: count }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.2, a: Math.random(), da: (Math.random() - 0.5) * 0.008 }));
    }
    function draw(timestamp) {
        if (!state.canvas.run) return;
        requestAnimationFrame(draw);
        if (timestamp - lastFrame < FRAME_INTERVAL) return;
        lastFrame = timestamp;
        ctx.clearRect(0, 0, W, H);
        for (const s of stars) {
            s.a += s.da; if (s.a <= 0 || s.a >= 1) s.da *= -1;
            ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(200,190,255,${Math.max(0, s.a * 0.6)})`; ctx.fill();
        }
    }

    window.addEventListener('resize', () => { resize(); init(); });
    document.addEventListener('visibilitychange', () => {
        state.canvas.run = !document.hidden;
        if (state.canvas.run) { lastFrame = 0; requestAnimationFrame(draw); }
    });
    init();
    requestAnimationFrame(draw);
}

/* ─── Sidebar ─── */
export function initSidebar() {
    const leftPanel = $('leftPanel'), btn = $('sidebarToggleBtn');
    function setCollapsed(c) {
        leftPanel.classList.toggle('panel-collapsed', c);
        btn.classList.toggle('is-collapsed', c);
        btn.setAttribute('aria-expanded', String(!c));
        btn.title = c ? 'Mostrar' : 'Ocultar';
        btn.setAttribute('aria-label', btn.title);
        Storage.setBool(STORAGE_KEYS.SIDEBAR, c);
    }
    btn.addEventListener('click', () => setCollapsed(!leftPanel.classList.contains('panel-collapsed')));
    if (Storage.getBool(STORAGE_KEYS.SIDEBAR)) setCollapsed(true);
}

/* ─── Tabs ─── */
export function setActiveTab(id) {
    ['tabProcessed', 'tabRaw', 'tabJson'].forEach(tid => {
        const tab = $(tid), active = tid === id;
        tab.classList.toggle('text-gold', active); tab.classList.toggle('border-gold', active);
        tab.classList.toggle('text-text3', !active); tab.classList.toggle('border-transparent', !active);
        tab.setAttribute('aria-selected', String(active)); tab.classList.toggle('active', active);
    });
    $('processedView').classList.toggle('hidden', id !== 'tabProcessed');
    $('rawView').classList.toggle('hidden', id !== 'tabRaw');
    $('jsonView').classList.toggle('hidden', id !== 'tabJson');
    $('searchContainer').classList.toggle('hidden', id === 'tabJson');
    $('processedView').querySelectorAll('.field-card').forEach(c => c.style.display = '');
    $('rawView').querySelectorAll('.field-card').forEach(c => c.style.display = '');
    if (id === 'tabJson' && state.file.uploaded && !state.jsonEditor.dirty) renderJSON();
    const si = $('searchInput');
    if (si.value && id !== 'tabJson') si.dispatchEvent(new Event('input'));
}

export function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(tab =>
        tab.addEventListener('click', e => setActiveTab(e.currentTarget.id))
    );
}

/* ─── Search ─── */
export function initSearch() {
    const searchInput = $('searchInput'), searchClearBtn = $('searchClearBtn');

    function updNR(q, vc, v) {
        let nr = v.querySelector('.no-results-state');
        if (q && vc === 0 && v.querySelector('.field-card')) {
            if (!nr) {
                nr = document.createElement('div'); nr.className = 'no-results-state flex flex-col items-center justify-center text-center px-4 py-16';
                const i = document.createElement('i'); i.className = 'fa-solid fa-feather-pointed text-2xl text-text3 opacity-40 mb-3';
                const p = document.createElement('p'); p.className = 'text-text3 italic text-sm';
                nr.append(i, p); v.appendChild(nr);
            }
            nr.querySelector('p').textContent = 'Sin resultados para "' + q + '"';
        } else if (nr) nr.remove();
    }

    searchInput.addEventListener('input', e => {
        const q = e.target.value.toLowerCase();
        searchClearBtn.classList.toggle('hidden', !q);
        if (!$('jsonView').classList.contains('hidden')) return;
        const av = $('processedView').classList.contains('hidden') ? $('rawView') : $('processedView');
        let vc = 0;
        av.querySelectorAll('.field-card').forEach(c => { const m = !q || c.innerText.toLowerCase().includes(q); c.style.display = m ? '' : 'none'; if (m) vc++; });
        updNR(q, vc, av);
    });

    searchClearBtn.addEventListener('click', () => {
        searchInput.value = '';
        $('processedView').querySelectorAll('.field-card').forEach(c => c.style.display = '');
        $('rawView').querySelectorAll('.field-card').forEach(c => c.style.display = '');
        const av = $('processedView').classList.contains('hidden') ? $('rawView') : $('processedView');
        const nr = av.querySelector('.no-results-state'); if (nr) nr.remove();
        searchInput.focus();
    });
}

/* ─── About modal ─── */
export function initAbout() {
    $('aboutBtn').addEventListener('click', () => { $('aboutModal').classList.remove('hidden'); $('aboutModal').classList.add('flex'); $('aboutClose').focus(); });
    const close = () => { $('aboutModal').classList.add('hidden'); $('aboutModal').classList.remove('flex'); };
    $('aboutClose').addEventListener('click', close);
    $('aboutBackdrop').addEventListener('click', close);
}

/* ─── Expand modal listeners ─── */
export function initExpandModal() {
    $('expandModalClose').addEventListener('click', () => {
        $('expandModal').classList.add('hidden'); $('expandModal').classList.remove('flex');
        $('expandModalContent').contentEditable = 'false'; $('expandModalContent').oninput = null;
        $('expandModalTranslation').classList.add('hidden'); state.tr.mc = null;
        if (state.tr.ma) { state.tr.ma.abort(); state.tr.ma = null; }
    });
    $('expandModalBackdrop').addEventListener('click', () => $('expandModalClose').click());
    $('expandModalTranslateBtn').addEventListener('click', async () => {
        const tb = $('expandModalTranslation'), tx = $('expandModalTranslationText');
        if (!tb.classList.contains('hidden')) { tb.classList.add('hidden'); return; }
        const src = $('expandModalContent').innerText;
        if (!src.trim()) { showToast('Sin texto', 'info'); return; }
        const { checkTranslationPrivacy } = await import('./translator.js');
        const ok = await checkTranslationPrivacy();
        if (!ok) return;
        tb.classList.remove('hidden');
        if (state.tr.mc !== null) { tx.textContent = state.tr.mc; return; }
        $('expandModalTranslateBtn').disabled = true;
        if (state.tr.ma) state.tr.ma.abort();
        state.tr.ma = new AbortController();
        tx.innerHTML = '<span class="text-violet2 text-xs italic">Traduciendo…</span>';
        const { trText } = await import('./translator.js');
        try {
            state.tr.mc = await trText(src, 'es', state.tr.ma.signal, (cur, tot) => {
                const prog = tx.querySelector('span');
                if (prog) prog.textContent = tot > 1 ? `Traduciendo fragmento ${cur} de ${tot}…` : 'Traduciendo…';
            });
            tx.textContent = state.tr.mc || '(vacio)';
        } catch (err) { if (err.name === 'AbortError') return; tb.classList.add('hidden'); showToast('Error', 'error'); }
        finally { $('expandModalTranslateBtn').disabled = false; }
    });
}

/* ─── Add field modal listeners ─── */
export function initAddFieldModal() {
    $('addFieldBackdrop').addEventListener('click', () => { import('./editor.js').then(m => m.closeAddF()); });
    $('addFieldClose').addEventListener('click', () => { import('./editor.js').then(m => m.closeAddF()); });
    $('addFieldCancel').addEventListener('click', () => { import('./editor.js').then(m => m.closeAddF()); });
    $('addFieldPreset').addEventListener('change', () => {
        const v = $('addFieldPreset').value;
        if (v && v !== 'custom') { $('addFieldKey').value = v; $('addFieldKey').disabled = true; }
        else { $('addFieldKey').value = ''; $('addFieldKey').disabled = false; if (v === 'custom') $('addFieldKey').focus(); }
        $('addFieldError').classList.add('hidden');
    });
    $('addFieldConfirm').addEventListener('click', async () => {
        const { sanitizeKey, showToast } = await import('./utils.js');
        const { addField, closeAddF } = await import('./editor.js');
        const RESERVED = (await import('./state.js')).RESERVED_KEYS;
        const nk = sanitizeKey($('addFieldKey').value);
        if (!nk) { $('addFieldError').textContent = 'Ingresa un nombre.'; $('addFieldError').classList.remove('hidden'); return; }
        if (RESERVED.has(nk)) { $('addFieldError').textContent = 'Nombre reservado.'; $('addFieldError').classList.remove('hidden'); return; }
        if ((await import('./state.js')).default.proc.data[nk] !== undefined) { $('addFieldError').textContent = '"' + nk + '" ya existe.'; $('addFieldError').classList.remove('hidden'); return; }
        addField(nk, $('addFieldValue').value); closeAddF(); showToast('"' + nk + '" agregado');
    });
}

/* ─── Export modal listeners ─── */
export function initExportModal() {
    $('exportBackdrop').addEventListener('click', () => { import('./export.js').then(m => m.closeExpModal()); });
    $('exportClose').addEventListener('click', () => { import('./export.js').then(m => m.closeExpModal()); });
    $('exportCopyJson').addEventListener('click', async () => { const { copyClip, showToast } = await import('./utils.js'); const ok = await copyClip($('exportJsonPreview').value); showToast(ok ? 'Copiado' : 'Error', ok ? 'success' : 'error'); });
    $('exportDownload').addEventListener('click', async () => {
        const { showToast } = await import('./utils.js');
        const cn = $('charName').value.trim() || 'character';
        const blob = new Blob([$('exportJsonPreview').value], { type: 'application/json' });
        const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url;
        a.download = cn.replace(/[^a-z0-9_\-]/gi, '_') + '_card.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        showToast('Descargado');
    });
}

/* ─── JSON editor listeners ─── */
export function initJsonEditor() {
    const jeT = $('jsonEditorTextarea');
    jeT.addEventListener('input', updJS);
    jeT.addEventListener('keydown', e => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const s = jeT.selectionStart;
            jeT.value = jeT.value.substring(0, s) + '  ' + jeT.value.substring(jeT.selectionEnd);
            jeT.selectionStart = jeT.selectionEnd = s + 2;
            updJS();
        }
    });
    $('jsonFormatBtn').addEventListener('click', () => {
        try { jeT.value = JSON.stringify(JSON.parse(jeT.value), null, 2); updJS(); showToast('Formateado'); }
        catch { showToast('JSON invalido', 'error'); }
    });
    $('jsonResetBtn').addEventListener('click', () => {
        if (!state.jsonEditor.snap) return;
        jeT.value = JSON.stringify(state.jsonEditor.snap, null, 2); updJS(); showToast('Revertido');
    });
    $('jsonApplyBtn').addEventListener('click', applyJE);
}
