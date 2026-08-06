import state, { getExtracted } from './state.js';
import { $, showToast, deepClone } from './utils.js';
import { extractFields, buildExp } from './chara-card.js';
import { extPNG } from './png-parser.js';
import vault from './storage.js';
import { openVault } from './vault.js';
import { loadProfiles, saveCurP, newPrf, delCurP, chgP, saveD, updLbl, rstDel, applyP, renderSel, exportCurrentProfile, importProfileFile, exportAllProfiles, importProfilesBundle } from './profiles.js';
import { processText, renderRaw, renderJSON, updFab, togEd, resetCardState, updLP, closeExp, closeAddF } from './editor.js';
import { openExpModal, closeExpModal, copyAll } from './export.js';
import { initCanvas, initSidebar, initTabs, setActiveTab, initSearch, initAbout, initExpandModal, initAddFieldModal, initExportModal, initJsonEditor } from './ui.js';

document.addEventListener('DOMContentLoaded', async () => {

    /* ── Init modules ── */
    try {
        initCanvas();
        initSidebar();
        initTabs();
        initSearch();
        initAbout();
        initExpandModal();
        initAddFieldModal();
        initExportModal();
        initJsonEditor();
    } catch (err) {
        console.error('[Init] error:', err);
    }

    /* ── Cached DOM ── */
    const fileInput = $('dropzone-file');
    const dropzone = $('dropzone');
    const uploadStatus = $('uploadStatus');
    const charNameInput = $('charName');
    const userNameInput = $('userName');
    const sysPromptInput = $('sysPrompt');
    const userPersonaInput = $('userPersona');
    const processBtn = $('processBtn');
    const clearBtn = $('clearBtn');
    const rawCount = $('rawCount');
    const searchContainer = $('searchContainer');

    if (!fileInput || !dropzone) {
        console.error('DOM critico no encontrado');
        return;
    }

    /* ── Profiles BEFORE vault session ── */
    loadProfiles();
    renderJSON();

    /* ── Vault init ── */
    let dbReady = false;
    try {
        dbReady = await vault.init();
    } catch (e) {
        console.warn('Vault init fallo', e);
    }

    if (dbReady) {
        vault.startAutoSave(() => state);
        vault.on('session-saved', () => {
            const el = $('vaultStatusText');
            if (el) el.textContent = 'Guardado ' + new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
        });

        try {
            const saved = await vault.loadSession();
            if (saved && saved.file) {
                const minAgo = Math.round((Date.now() - saved.savedAt) / 60000);
                const timeText = minAgo < 1 ? 'hace un momento' : `hace ${minAgo} min`;
                const recover = confirm(
                    `Se encontro una sesion guardada ${timeText}.\n\n` +
                    `Personaje: ${saved.charName || '(sin nombre)'}\n` +
                    `Campos: ${Object.keys(saved.procData || {}).length}\n\n` +
                    `¿Deseas recuperarla?`
                );
                if (recover) {
                    state.file.uploaded = saved.file;
                    Object.assign(state.file.extracted, saved.extracted || {});
                    Object.assign(state.proc.data, saved.procData || {});
                    state.proc.edited = new Set(saved.procEdited || []);
                    state.editor.added = new Set(saved.editorAdded || []);
                    state.editor.removed = new Set(saved.editorRemoved || []);

                    // Restore profile AFTER loadProfiles already ran
                    if (saved.activeProfileId && state.profiles.lib[saved.activeProfileId]) {
                        state.profiles.active = saved.activeProfileId;
                        renderSel();
                        applyP();
                    }

                    // Unconditional assignment — overwrites profile values with exact session values
                    charNameInput.value = saved.charName ?? '';
                    userNameInput.value = saved.userName ?? '';
                    sysPromptInput.value = saved.sysPrompt ?? '';
                    userPersonaInput.value = saved.userPersona ?? '';

                    processBtn.disabled = false;
                    processText();
                    state.vault.dirty = false;

                    // Restore editor state
                    if (saved.editorActive && !state.editor.active) {
                        togEd();
                    }

                    showToast('Sesion recuperada');
                } else {
                    await vault.clearSession();
                }
            }
        } catch (e) {
            console.warn('loadSession error', e);
        }
    }

    /* ── Vault buttons ── */
    $('vaultBtn')?.addEventListener('click', openVault);
    $('vaultStatus')?.addEventListener('click', openVault);

    /* ── Vault events ── */
    document.addEventListener('vault:load-card', (e) => {
        const { card, name } = e.detail || {};
        if (!card) return;
        state.file.uploaded = card;
        resetCardState();
        extractFields(card);
        const count = Object.keys(getExtracted()).length;
        if (name && charNameInput) { charNameInput.value = name; updLP(); }
        if (rawCount) rawCount.textContent = count;
        renderRaw();
        if (processBtn) processBtn.disabled = count === 0;
        renderJSON();
        if (userNameInput?.value.trim() || sysPromptInput?.value.trim()) processText();
    });

    document.addEventListener('vault:request-card', (e) => {
        try {
            e.detail.card = buildExp();
        } catch (err) {
            console.error('[vault:request-card] error', err);
            showToast('Error al preparar carta', 'error');
        }
    });

    /* ── Profile buttons ── */
    $('saveProfileBtn')?.addEventListener('click', saveCurP);
    $('newProfileBtn')?.addEventListener('click', newPrf);
    $('deleteProfileBtn')?.addEventListener('click', delCurP);
    $('profileSelect')?.addEventListener('change', chgP);
    $('profileLabelInput')?.addEventListener('input', updLbl);

    /* ── Profile file I/O ── */
    $('exportProfileBtn')?.addEventListener('click', exportCurrentProfile);
    $('importProfileBtn')?.addEventListener('click', () => { $('importProfileInput')?.click(); });
    $('importProfileInput')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (file) await importProfileFile(file);
        e.target.value = '';
    });
    $('exportAllProfilesBtn')?.addEventListener('click', exportAllProfiles);
    $('importProfilesBundleBtn')?.addEventListener('click', () => { $('importProfilesBundleInput')?.click(); });
    $('importProfilesBundleInput')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (file) await importProfilesBundle(file);
        e.target.value = '';
    });

    // Config inputs mark dirty + update labels
    charNameInput?.addEventListener('input', () => { updLP(); state.vault.dirty = true; });
    userNameInput?.addEventListener('input', () => { updLP(); state.vault.dirty = true; });
    sysPromptInput?.addEventListener('input', () => { state.vault.dirty = true; });
    userPersonaInput?.addEventListener('input', () => { state.vault.dirty = true; });

    /* ── File handling ── */
    function setStatus(msg, type, html) {
        if (!uploadStatus) return;
        uploadStatus.classList.remove('hidden');
        uploadStatus.className = 'mt-3 text-xs p-2.5 rounded-lg text-center italic border ' +
            (type === 'error' ? 'border-[#502020] text-[#e05a5a]' : type === 'success' ? 'border-goldDim text-gold' : 'border-border2 text-user');
        if (html) uploadStatus.innerHTML = msg; else uploadStatus.textContent = msg;
    }

    async function handleFile(file) {
        if (!file) return;
        const isJson = file.type === 'application/json' || file.name.toLowerCase().endsWith('.json');
        const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
        if (!isJson && !isPng) return setStatus('Solo JSON o PNG.', 'error');
        if (file.size > 10 * 1024 * 1024) return setStatus('Max 10 MB.', 'error');
        setStatus('<i class="fa-solid fa-circle-notch fa-spin"></i> Leyendo...', 'info', true);
        try {
            if (isJson) {
                const text = await file.text();
                try {
                    state.file.uploaded = JSON.parse(text);
                } catch {
                    return setStatus('JSON malformado.', 'error');
                }
                finishLoad(file.name);
            } else {
                state.file.uploaded = await extPNG(file);
                finishLoad(file.name);
            }
        } catch (err) {
            console.error(err);
            setStatus('Error: ' + (err.message || 'Sin metadatos.'), 'error');
        }
    }

    function finishLoad(fn) {
        resetCardState();
        const dup = extractFields(state.file.uploaded);
        const count = Object.keys(getExtracted()).length;
        if (count === 0) {
            processBtn.disabled = true;
            if (rawCount) rawCount.textContent = '0';
            const pc = $('processedCount');
            if (pc) pc.textContent = '0';
            const rv = $('rawView');
            if (rv) rv.replaceChildren();
            const pv = $('processedView');
            if (pv) pv.innerHTML = '<p class="text-text3 italic text-center py-12">No se encontraron campos compatibles.</p>';
            renderJSON();
            updFab();
            return setStatus('Tomo vacio: no contiene campos compatibles.', 'error');
        }
        const nm = state.file.uploaded.name || state.file.uploaded.data?.name || state.file.uploaded.char_name || '';
        if (nm && charNameInput) { charNameInput.value = nm; updLP(); }
        let msg = '✓ ' + fn + ' - ' + count + ' campo(s).';
        if (dup > 0) msg += ' (' + dup + ' dup. resueltos)';
        setStatus(msg, 'success');
        if (rawCount) rawCount.textContent = count;
        renderRaw();
        if (processBtn) processBtn.disabled = false;
        renderJSON();
        if (userNameInput?.value.trim() || sysPromptInput?.value.trim()) processText();
        else $('tabRaw')?.click();
    }

    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', e => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
        const f = e.dataTransfer?.files?.[0];
        if (f) handleFile(f);
    });
    fileInput.addEventListener('change', e => {
        const f = e.target.files?.[0];
        if (f) handleFile(f);
    });

    /* ── Process / Clear ── */
    processBtn?.addEventListener('click', processText);

    clearBtn?.addEventListener('click', async () => {
        closeExp(); closeAddF(); closeExpModal(); rstDel();
        if (fileInput) fileInput.value = '';
        state.file.uploaded = null;
        state.file.extracted = {};
        state.proc.data = {};
        state.proc.edited.clear();
        state.editor.active = false;
        state.editor.added.clear();
        state.editor.removed.clear();
        state.jsonEditor.snap = null;
        state.jsonEditor.dirty = false;
        state.jsonEditor.err = null;
        state.vault.dirty = false;
        $('editorToggle')?.classList.remove('active');
        $('editorToggle')?.setAttribute('aria-pressed', 'false');
        $('editorInfoBar')?.classList.add('hidden');
        uploadStatus?.classList.add('hidden');
        if (charNameInput) charNameInput.value = '';
        updLP();
        if (processBtn) processBtn.disabled = true;
        const pc = $('processedCount');
        if (pc) pc.textContent = '0';
        if (rawCount) rawCount.textContent = '0';
        const rv = $('rawView');
        if (rv) rv.innerHTML = '';
        const si = $('searchInput');
        if (si) { si.value = ''; $('searchClearBtn')?.classList.add('hidden'); }
        searchContainer?.classList.remove('hidden');
        document.querySelectorAll('.field-card').forEach(c => c.style.display = '');
        applyP();
        const pv = $('processedView');
        if (pv) pv.innerHTML = '<div class="flex flex-col items-center justify-center h-full min-h-[40vh] text-center px-4"><div class="text-5xl opacity-20 font-cinzelDeco text-text3 mb-4">&#5765;</div><p class="text-text3 italic max-w-sm text-sm">Las paginas aguardan.</p></div>';
        renderJSON();
        setActiveTab('tabProcessed');
        showToast('Tomo purificado');
        if (dbReady) {
            try { await vault.clearSession(); } catch {}
        }
    });

    /* ── Editor toggle ── */
    $('editorToggle')?.addEventListener('click', togEd);

    /* ── FAB ── */
    $('exportJsonBtn')?.addEventListener('click', openExpModal);
    $('copyAllBtn')?.addEventListener('click', copyAll);

    /* ── Keyboard shortcuts ── */
    document.addEventListener('keydown', e => {
        const isInput = e.target.matches('input,textarea,[contenteditable="true"]');
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (processBtn && !processBtn.disabled) processBtn.click();
        }
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
            e.preventDefault();
            const jv = $('jsonView');
            const jab = $('jsonApplyBtn');
            if (jv && !jv.classList.contains('hidden') && jab && !jab.disabled) jab.click();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
            if (!isInput) { e.preventDefault(); togEd(); }
        }
        if (e.key === 'Escape') {
            const about = $('aboutModal');
            const exp = $('expandModal');
            const add = $('addFieldModal');
            const expM = $('exportModal');
            const vaultM = $('vaultModal');
            if (vaultM && !vaultM.classList.contains('hidden')) {
                vaultM.classList.add('hidden'); vaultM.classList.remove('flex');
            } else if (about && !about.classList.contains('hidden')) {
                about.classList.add('hidden'); about.classList.remove('flex');
            } else if (exp && !exp.classList.contains('hidden')) closeExp();
            else if (add && !add.classList.contains('hidden')) closeAddF();
            else if (expM && !expM.classList.contains('hidden')) closeExpModal();
        }
    });

    // Beforeunload depends on dirty, not on data presence
    window.addEventListener('beforeunload', (e) => {
        if (!state.vault.dirty) return;
        e.preventDefault();
        e.returnValue = '';
    });

    window.addEventListener('beforeunload', () => { vault.stopAutoSave(); });
});

/* ── PWA Service Worker Registration ── */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
            console.info('[PWA] Service worker registrado:', registration.scope);
        } catch (error) {
            console.error('[PWA] No se pudo registrar', error);
        }
    });
}