import state, { STORAGE_KEYS } from './state.js';
import { $, Storage, showToast, trapFocus, closeConfirmDialog } from './utils.js';
import { renderJSON, updJS, applyJE, updFab, renderLorebook, setJsonMode } from './editor.js';

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
    const groups = [...leftPanel.querySelectorAll('.sidebar-group')];

    /* Los grupos ya NO son excluyentes: antes abrir uno cerraba los demas, lo que
       obligaba a reabrirlos cada vez. En su lugar se recuerda el estado de cada uno. */
    const savedGroups = Storage.get(STORAGE_KEYS.SIDEBAR_GROUPS, {}) || {};
    groups.forEach((group, i) => {
        const id = group.dataset.group || 'g' + i;
        if (typeof savedGroups[id] === 'boolean') group.open = savedGroups[id];
        group.addEventListener('toggle', () => {
            const map = Storage.get(STORAGE_KEYS.SIDEBAR_GROUPS, {}) || {};
            map[id] = group.open;
            Storage.set(STORAGE_KEYS.SIDEBAR_GROUPS, map);
        });
    });
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
    ['tabProcessed', 'tabRaw', 'tabJson', 'tabLorebook'].forEach(tid => {
        const tab = $(tid), active = tid === id;
        tab.classList.toggle('text-gold', active); tab.classList.toggle('border-gold', active);
        tab.classList.toggle('text-text3', !active); tab.classList.toggle('border-transparent', !active);
        tab.setAttribute('aria-selected', String(active)); tab.classList.toggle('active', active);
    });
    $('processedView').classList.toggle('hidden', id !== 'tabProcessed');
    $('rawView').classList.toggle('hidden', id !== 'tabRaw');
    $('jsonView').classList.toggle('hidden', id !== 'tabJson');
    $('lorebookView').classList.toggle('hidden', id !== 'tabLorebook');
    // El buscador tambien sirve en el lorebook: sus entradas usan la misma
    // estructura .field-card. Solo se oculta en JSON, que es un editor de texto.
    $('searchContainer').classList.toggle('hidden', id === 'tabJson');
    $('processedView').querySelectorAll('.field-card').forEach(c => c.style.display = '');
    $('rawView').querySelectorAll('.field-card').forEach(c => c.style.display = '');
    if (id === 'tabJson' && state.file.uploaded && !state.jsonEditor.dirty) {
        try { renderJSON(); }
        catch (error) { console.error('[JSON] No se pudo renderizar', error); showToast('No se pudo abrir la vista JSON', 'error'); }
    }
    if (id === 'tabLorebook') renderLorebook();
    const si = $('searchInput');
    if (si.value && id !== 'tabJson') si.dispatchEvent(new Event('input'));
    updFab();
}

export function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(tab =>
        tab.addEventListener('click', e => setActiveTab(e.currentTarget.id))
    );
}

/* ─── Search ─── */

/**
 * Texto comparable de una tarjeta: titulo + cuerpo.
 * Se usa textContent y no innerText: innerText devuelve cadena vacia en las tarjetas
 * ocultas, asi que una tarjeta filtrada por una busqueda anterior no volvia a aparecer
 * nunca aunque coincidiera con la nueva.
 */
function cardText(card) {
    const nameInput = card.querySelector('.field-card-head .editor-field-name');
    const title = nameInput ? (nameInput.value || '') : (card.querySelector('.field-card-head span.truncate')?.textContent || '');
    const body = card.querySelector('.field-card-body');
    return (title + ' ' + (body?.textContent || '')).toLowerCase();
}

/** Retira los resaltados anteriores dejando el texto intacto. */
function clearHighlights(root) {
    root.querySelectorAll('mark.search-hit').forEach(m => {
        const parent = m.parentNode;
        if (!parent) return;
        parent.replaceChild(document.createTextNode(m.textContent), m);
        parent.normalize();
    });
}

/**
 * Resalta la coincidencia dentro de la tarjeta. Omite los contenteditable: meter
 * HTML ahi romperia la edicion en linea de la vista procesada.
 */
function highlightCard(card, q) {
    if (!q) return;
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const el = node.parentElement;
            if (!node.nodeValue || !el) return NodeFilter.FILTER_REJECT;
            if (el.closest('[contenteditable="true"]')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    for (const node of nodes) {
        const at = node.nodeValue.toLowerCase().indexOf(q);
        if (at < 0) continue;
        const hit = node.splitText(at);
        if (hit.nodeValue.length > q.length) hit.splitText(q.length);
        const mark = document.createElement('mark');
        mark.className = 'search-hit';
        mark.textContent = hit.nodeValue;
        hit.parentNode.replaceChild(mark, hit);
    }
}

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

    function setCounter(q, shown, total) {
        const counter = $('searchCount');
        if (!counter) return;
        counter.classList.toggle('hidden', !q);
        counter.textContent = q ? `${shown} de ${total}` : '';
    }

    function runSearch() {
        const q = (searchInput.value || '').trim().toLowerCase();
        searchClearBtn.classList.toggle('hidden', !q);

        // Los resaltados se limpian en todas las vistas de campos: al cambiar de
        // pestana las tarjetas se vuelven a mostrar y no deben conservar marcas viejas.
        [$('processedView'), $('rawView'), $('lorebookView')].forEach(v => v && clearHighlights(v));

        // El JSON es un editor de texto: el filtro por tarjetas no aplica ahi.
        if (!$('jsonView').classList.contains('hidden')) return;

        const av = !$('processedView').classList.contains('hidden') ? $('processedView')
            : !$('rawView').classList.contains('hidden') ? $('rawView')
                : $('lorebookView');
        const cards = [...av.querySelectorAll('.field-card')];
        let vc = 0;
        cards.forEach(c => {
            const m = !q || cardText(c).includes(q);
            c.style.display = m ? '' : 'none';
            if (m) { vc++; if (q) highlightCard(c, q); }
        });
        updNR(q, vc, av);
        setCounter(q, vc, cards.length);
    }

    searchInput.addEventListener('input', runSearch);

    searchClearBtn.addEventListener('click', () => {
        searchInput.value = '';
        runSearch();
        searchInput.focus();
    });

    // Tras repintar (procesar la carta, cargar otra, deshacer...) el filtro hay que
    // reaplicarlo o las tarjetas volverian a aparecer sin filtrar ni resaltar.
    document.addEventListener('fields:rendered', () => { if (searchInput.value.trim()) runSearch(); });
}

/* ─── About modal ─── */
export function initAbout() {
    $('aboutBtn').addEventListener('click', () => { $('aboutModal').classList.remove('hidden'); $('aboutModal').classList.add('flex'); $('aboutClose').focus(); });
    const close = () => { $('aboutModal').classList.add('hidden'); $('aboutModal').classList.remove('flex'); };
    $('aboutClose').addEventListener('click', close);
    $('aboutBackdrop').addEventListener('click', close);
}

/* ─── Confirm dialog ───
   confirmDialog / closeConfirmDialog viven en utils.js junto a showToast, para que
   editor.js y vault.js puedan usarlos sin importar ui.js (evita el ciclo de modulos). */
export function initConfirmModal() {
    $('confirmOkBtn').addEventListener('click', () => closeConfirmDialog('ok'));
    $('confirmCancelBtn').addEventListener('click', () => closeConfirmDialog('cancel'));
    $('confirmExtraBtn').addEventListener('click', () => closeConfirmDialog('extra'));
    $('confirmClose').addEventListener('click', () => closeConfirmDialog('cancel'));
    $('confirmBackdrop').addEventListener('click', () => closeConfirmDialog('cancel'));
}

/* ─── Shortcuts modal ───
   Estaba entero en el HTML —boton, lista de atajos, cierre— pero ningun modulo lo
   abria: el boton "Atajos" no hacia nada y la tecla "?" que anuncia tampoco. */
let shortcutsOpen = false;

export function openShortcuts() {
    const m = $('shortcutsModal');
    if (!m) return false;
    m.classList.remove('hidden');
    m.classList.add('flex');
    shortcutsOpen = true;
    $('shortcutsClose')?.focus();
    return true;
}

export function closeShortcuts() {
    const m = $('shortcutsModal');
    if (!m || m.classList.contains('hidden')) return false;
    m.classList.add('hidden');
    m.classList.remove('flex');
    shortcutsOpen = false;
    return true;
}

export function initShortcutsModal() {
    $('shortcutsBtn')?.addEventListener('click', () => (shortcutsOpen ? closeShortcuts() : openShortcuts()));
    $('shortcutsClose')?.addEventListener('click', closeShortcuts);
    $('shortcutsBackdrop')?.addEventListener('click', closeShortcuts);
    document.addEventListener('keydown', (e) => {
        if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.target?.closest?.('input,textarea,[contenteditable="true"]')) return;
        // No se abre encima de otro modal: Esc resolveria el de debajo y dejaria
        // este abierto sin manera evidente de cerrarlo.
        if (MODAL_IDS.some(id => id !== 'shortcutsModal' && !$(id)?.classList.contains('hidden'))) return;
        e.preventDefault();
        if (shortcutsOpen) closeShortcuts(); else openShortcuts();
    });
}

/* ─── Welcome ───
   El panel "Como funciona" vivia oculto en el HTML sin que nada lo mostrara.
   Se ve la primera vez y se recuerda el descarte en localStorage. */
export function initWelcome() {
    const panel = $('welcomePanel');
    if (!panel) return;
    panel.classList.toggle('hidden', Storage.getBool(STORAGE_KEYS.SEEN_WELCOME));
    $('welcomeDismiss')?.addEventListener('click', () => {
        panel.classList.add('hidden');
        Storage.setBool(STORAGE_KEYS.SEEN_WELCOME, true);
    });
}

/* ─── Focus trap para todos los modales ───
   Se resuelve por delegacion para que tambien cubra modales creados dinamicamente
   (p. ej. #vaultModal, que inyecta vault.js al abrir la boveda).
   Ordenados por z-index: shortcuts y confirm van a z-[70], por encima del resto. */
const MODAL_IDS = ['shortcutsModal', 'confirmModal', 'vaultModal', 'aboutModal', 'exportModal', 'addFieldModal', 'expandModal'];

export function initFocusTraps() {
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        for (const id of MODAL_IDS) {
            const el = $(id);
            if (el && !el.classList.contains('hidden')) { trapFocus(e, el); return; }
        }
    });
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
        tx.innerHTML = '<span class="text-violet2 text-xs italic">Traduciendo...</span>';
        const { trText } = await import('./translator.js');
        try {
            state.tr.mc = await trText(src, 'es', state.tr.ma.signal, (cur, tot) => {
                const prog = tx.querySelector('span');
                if (prog) prog.textContent = tot > 1 ? `Traduciendo fragmento ${cur} de ${tot}...` : 'Traduciendo...';
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
    $('exportPngInput')?.addEventListener('change', async () => {
        const { syncPngControls } = await import('./export.js');
        syncPngControls();
    });
    $('exportDownloadPng')?.addEventListener('click', async () => {
        const { exportPng } = await import('./export.js');
        await exportPng($('exportPngInput')?.files?.[0] || state.file.pngFile);
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
    $('jsonTreeModeBtn')?.addEventListener('click', () => setJsonMode('tree'));
    $('jsonRawModeBtn')?.addEventListener('click', () => setJsonMode('code'));
}
