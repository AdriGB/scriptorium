import state, { getExtracted } from './state.js';
import { $, showToast, confirmDialog, closeConfirmDialog } from './utils.js';
import { serialize, apply as applySnapshot, revision, isDirty } from './snapshot.js';
import { extractFields, buildExp } from './chara-card.js';
import { extPNG } from './png-parser.js';
import vault from './storage.js';
import { openVault, saveCurrentToVault } from './vault.js';
import { loadProfiles, saveCurP, newPrf, delCurP, chgP, saveD, updLbl, rstDel, applyP, renderSel, exportCurrentProfile, importProfileFile, exportAllProfiles, importProfilesBundle } from './profiles.js';
import { processText, renderRaw, renderProc, renderJSON, updFab, togEd, resetCardState, updLP, closeExp, closeAddF, updLorebookCount, updateWeight, emptyFieldsState } from './editor.js';
import { openExpModal, closeExpModal, copyAll } from './export.js';
import { initCanvas, initSidebar, initTabs, setActiveTab, initSearch, initAbout, initExpandModal, initAddFieldModal, initExportModal, initJsonEditor, initConfirmModal, initFocusTraps, initShortcutsModal, initWelcome, closeShortcuts, autoSidebarCollapse, autoSidebarExpand } from './ui.js';
import { initFieldIndex } from './field-index.js';

document.addEventListener('DOMContentLoaded', async () => {

    /* ── Red de errores ──
       Sin esto un fallo en cualquier manejador se queda en la consola y la
       interfaz simplemente deja de responder. El aviso se dosifica: un error
       que se repite en cada fotograma llenaria la pantalla. */
    let lastErrorToast = 0;
    function reportError(where, err) {
        console.error('[' + where + ']', err);
        const now = Date.now();
        if (now - lastErrorToast < 5000) return;
        lastErrorToast = now;
        showToast('Algo ha fallado: ' + (err?.message || 'error inesperado'), 'error');
    }
    window.addEventListener('error', e => reportError('error', e.error || e.message));
    window.addEventListener('unhandledrejection', e => reportError('promesa', e.reason));

    /* Cada init va por su cuenta: antes iban todos en un unico try y el primero
       que fallaba se llevaba por delante los demas sin dejar rastro. */
    const initSteps = {
        canvas: initCanvas, sidebar: initSidebar, tabs: initTabs, search: initSearch,
        about: initAbout, expandModal: initExpandModal, addFieldModal: initAddFieldModal,
        exportModal: initExportModal, jsonEditor: initJsonEditor, confirmModal: initConfirmModal,
        focusTraps: initFocusTraps, shortcutsModal: initShortcutsModal, welcome: initWelcome,
        fieldIndex: initFieldIndex
    };
    for (const [name, step] of Object.entries(initSteps)) {
        try { step(); } catch (err) { reportError('init:' + name, err); }
    }

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

    const hasCardContent = (count = Object.keys(getExtracted()).length) =>
        count > 0 || Object.keys(state.proc.data).length > 0 || state.characterBook.present;

    /* Explica por que "Invocar y Sustituir" esta desactivado, o que falta por
       rellenar. El parrafo #processHint existia oculto en el HTML sin usarse. */
    function refreshProcessHint() {
        const hint = $('processHint');
        if (!hint) return;
        const count = Object.keys(getExtracted()).length + Object.keys(state.proc.data).length;
        let msg = '';
        if (!state.file.uploaded && count === 0 && !state.characterBook.present) {
            msg = 'Carga una carta JSON o PNG para empezar.';
        } else if (count === 0 && !state.characterBook.present) {
            msg = 'El archivo no contiene campos compatibles.';
        } else if (count > 0 && !userNameInput?.value.trim() && !sysPromptInput?.value.trim()) {
            msg = 'Rellena tu nombre o el prompt de sistema para sustituir las marcas {{char}} y {{user}}.';
        }
        hint.textContent = msg;
        hint.classList.toggle('hidden', !msg);
    }

    function setWorkspaceLoaded(loaded, fileName = '', count = 0) {
        $('workspaceEmpty')?.classList.toggle('hidden', loaded);
        $('workspaceTabs')?.classList.toggle('hidden', !loaded);
        $('workspaceStatusBar')?.classList.toggle('hidden', !loaded);
        $('workspaceViews')?.classList.toggle('hidden', !loaded);
        const fileStatus = $('statusFileName');
        const fieldStatus = $('statusFields');
        if (fileStatus) fileStatus.textContent = loaded ? (fileName || 'Carta cargada') : 'Sin carta';
        if (fieldStatus) fieldStatus.textContent = count + ' campos';
        // El peso se recalcula desde el estado, asi que tambien limpia al vaciar.
        updateWeight();
    }

    function refreshVisibleJSON() {
        const jsonVisible = !$('jsonView')?.classList.contains('hidden');
        if (jsonVisible && !state.jsonEditor.dirty) renderJSONSafely();
    }

    function renderJSONSafely(notify = false) {
        try {
            renderJSON();
            return true;
        } catch (error) {
            console.error('[JSON] No se pudo renderizar', error);
            if (notify) showToast('La carta se cargo, pero fallo la vista JSON', 'error');
            return false;
        }
    }

    /* ── Pintar una carta cargada ──
       Un solo punto de entrada para "ya hay carta en el estado, muestrala". Las
       tres rutas repetian este bloque con pequenas variaciones y cada arreglo
       habia que hacerlo tres veces: la de la boveda no ponia al dia el contador
       de la pestana original y la de la sesion recuperada no recogia el panel en
       movil. `empty` es el caso del fichero que se lee pero no trae campos. */
    function showCard({ title, count, empty = null, notify = true, process = null, editorActive = false } = {}) {
        const total = count ?? Object.keys(getExtracted()).length;
        const hasContent = hasCardContent(total);
        const rc = $('rawCount');
        if (rc) rc.textContent = String(total);
        if (!hasContent) { const pc = $('processedCount'); if (pc) pc.textContent = '0'; }

        if (empty) {
            const rv = $('rawView');
            if (rv) rv.replaceChildren(emptyFieldsState(empty.icon, empty.title, empty.hint));
            const pv = $('processedView');
            if (pv) pv.replaceChildren(emptyFieldsState(
                '<i class="fa-solid fa-triangle-exclamation"></i>',
                'No se encontraron campos compatibles.',
                'El archivo se leyo, pero no contiene campos de CharaCard v2.'
            ));
        } else {
            renderRaw();
        }

        if (processBtn) processBtn.disabled = !hasContent;
        refreshProcessHint();
        setWorkspaceLoaded(true, title, total);
        updLorebookCount();
        // Sin campos pero con lorebook, la pestana que sirve es la del lorebook.
        if (total === 0 && state.characterBook.present) $('tabLorebook')?.click();
        else $('tabRaw')?.click();
        renderJSONSafely(notify);
        if (editorActive && !state.editor.active) togEd({ notify: false });
        if (empty) { updFab(); return; }

        // Ya hay carta que mirar: en movil el panel se recoge para dejarla ver.
        autoSidebarCollapse();
        const shouldProcess = process ?? (total > 0 && Boolean(userNameInput?.value.trim() || sysPromptInput?.value.trim()));
        /* Sin invocar, la pestana procesada se repinta de todas formas: si no,
           se quedaban los campos de la carta anterior despues de cargar otra. */
        if (shouldProcess) processText(); else renderProc();
    }

    /* ── Snapshot / restauracion ──
       El formato vive en snapshot.js y es el mismo para la sesion del vault
       (storage.js), el "deshacer" de aqui y el bundle exportado. Antes cada uno
       construia el suyo y ya habian divergido. */
    function snapState() {
        return serialize(state);
    }

    async function hydrateFrom(saved) {
        const d = applySnapshot(saved);
        if (!d) return false;

        if (d.activeProfileId && state.profiles.lib[d.activeProfileId]) {
            state.profiles.active = d.activeProfileId;
            renderSel();
            applyP();
        }
        updLP();

        const restoredCount = Object.keys(state.file.extracted).length;
        showCard({
            title: d.fileName || (d.charName ? 'Sesion: ' + d.charName : 'Sesion recuperada'),
            count: restoredCount,
            notify: false,
            // Aqui si hay campos procesados basta para invocar: vienen del estado.
            process: restoredCount > 0 ||
                Object.keys(state.proc.data).length > 0 ||
                Boolean(sysPromptInput?.value.trim()),
            editorActive: d.editorActive
        });
        return true;
    }

    if (!fileInput || !dropzone) { console.error('DOM critico no encontrado'); return; }

    /* ── Profiles BEFORE vault session ── */
    loadProfiles();
    renderJSONSafely();
    setWorkspaceLoaded(false);
    refreshProcessHint();
    /* Base de la huella: el estado recien arrancado no es trabajo pendiente, asi
       que cerrar la pestana sin hacer nada no avisa. Si la boveda no llega a
       abrir, esto es lo unico que evita el aviso falso. */
    state.vault.savedRev = revision(state);

    /* ── Vault init ── */
    let dbReady = false;
    try { dbReady = await vault.init(); } catch (e) { console.warn('Vault init fallo', e); }

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
                const choice = await confirmDialog({
                    title: 'Sesion encontrada',
                    message: `Se encontro una sesion guardada ${timeText}.\n\n` +
                        `Personaje: ${saved.charName || '(sin nombre)'}\n` +
                        `Campos: ${Object.keys(saved.procData || {}).length}`,
                    okLabel: 'Recuperar',
                    extraLabel: 'Mas tarde',
                    cancelLabel: 'Descartar',
                    danger: 'cancel',
                    icon: 'fa-box-archive'
                });
                if (choice === 'ok') {
                    await hydrateFrom(saved);
                    // Ya esta en el disco tal cual: que no se vuelva a escribir.
                    state.vault.savedRev = revision(state);
                    showToast('Sesion recuperada');
                } else if (choice === 'cancel') {
                    // Antes cualquier "Cancelar" borraba la sesion sin vuelta atras.
                    // Ahora "Descartar" es explicito y "Mas tarde" la conserva.
                    await vault.clearSession();
                    showToast('Sesion descartada', 'info');
                }
            }
        } catch (e) { console.warn('loadSession error', e); }
    }

    /* ── Vault buttons ── */
    $('vaultBtn')?.addEventListener('click', openVault);
    $('vaultStatus')?.addEventListener('click', openVault);
    $('emptyVaultBtn')?.addEventListener('click', openVault);
    $('saveActionVaultBtn')?.addEventListener('click', saveCurrentToVault);

    /* ── Vault events ── */
    document.addEventListener('vault:load-card', (e) => {
        const { card, name } = e.detail || {};
        if (!card) return;
        state.file.uploaded = card;
        state.file.pngFile = null; // las cartas de la boveda no conservan la imagen
        resetCardState();
        extractFields(card);
        if (name && charNameInput) { charNameInput.value = name; updLP(); }
        showCard({ title: name || 'Carta de la boveda' });
    });

    document.addEventListener('vault:request-card', (e) => {
        try { e.detail.card = buildExp(); }
        catch (err) { console.error('[vault:request-card] error', err); showToast('Error al preparar carta', 'error'); }
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
    $('importProfileInput')?.addEventListener('change', async (e) => { const file = e.target.files?.[0]; if (file) await importProfileFile(file); e.target.value = ''; });
    $('exportAllProfilesBtn')?.addEventListener('click', exportAllProfiles);
    $('importProfilesBundleBtn')?.addEventListener('click', () => { $('importProfilesBundleInput')?.click(); });
    $('importProfilesBundleInput')?.addEventListener('change', async (e) => { const file = e.target.files?.[0]; if (file) await importProfilesBundle(file); e.target.value = ''; });

    // Config inputs: actualizan etiquetas y aviso. Lo de guardar se deriva solo.
    charNameInput?.addEventListener('input', () => { updLP(); refreshVisibleJSON(); });
    userNameInput?.addEventListener('input', () => { updLP(); refreshVisibleJSON(); refreshProcessHint(); });
    sysPromptInput?.addEventListener('input', () => { refreshVisibleJSON(); refreshProcessHint(); });

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
                try { state.file.uploaded = JSON.parse(text); } catch { return setStatus('JSON malformado.', 'error'); }
                state.file.pngFile = null;
                finishLoad(file.name);
            } else {
                const parsed = await extPNG(file);
                state.file.uploaded = parsed;
                // Se guarda el File para reexportar a PNG sin reseleccionarlo.
                state.file.pngFile = file;
                finishLoad(file.name);
            }
        } catch (err) { console.error(err); setStatus('Error: ' + (err.message || 'Sin metadatos.'), 'error'); }
    }

    function finishLoad(fn) {
        resetCardState();
        const dup = extractFields(state.file.uploaded);
        const count = Object.keys(getExtracted()).length;
        if (!hasCardContent(count)) {
            showCard({
                title: fn,
                count,
                empty: {
                    icon: '<i class="fa-solid fa-scroll"></i>',
                    title: 'La plantilla no tiene campos.',
                    hint: ''
                }
            });
            return setStatus('Tomo vacio: no contiene campos compatibles.', 'error');
        }
        const nm = state.file.uploaded.name || state.file.uploaded.data?.name || state.file.uploaded.char_name || '';
        if (nm && charNameInput) { charNameInput.value = nm; updLP(); }
        let msg = '✓ ' + fn + ' - ' + count + ' campo(s).';
        if (state.characterBook.present) msg += ' ' + state.characterBook.entries.length + ' entrada(s) de lorebook.';
        if (dup > 0) msg += ' (' + dup + ' dup. resueltos)';
        setStatus(msg, 'success');
        showCard({ title: fn, count });
    }

    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', e => { e.preventDefault(); dropzone.classList.remove('drag-over'); const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f); });
    fileInput.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) handleFile(f); });
    const centerDropzone = $('centerDropzone');
    centerDropzone?.addEventListener('dragover', e => { e.preventDefault(); centerDropzone.classList.add('drag-over'); });
    centerDropzone?.addEventListener('dragleave', () => centerDropzone.classList.remove('drag-over'));
    centerDropzone?.addEventListener('drop', e => { e.preventDefault(); centerDropzone.classList.remove('drag-over'); const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f); });

    /* ── Process / Clear ── */
    processBtn?.addEventListener('click', processText);

    clearBtn?.addEventListener('click', async () => {
        const hasWork = Boolean(state.file.uploaded) || Object.keys(state.proc.data).length > 0 || state.characterBook.present;
        if (!hasWork) { showToast('No hay nada que limpiar', 'info'); return; }

        const res = await confirmDialog({
            title: 'Limpiar todo',
            message: 'Se borraran la carta cargada, las ediciones y el lorebook de esta sesion.\n\nPodras recuperarlo desde el aviso.',
            okLabel: 'Limpiar',
            danger: 'ok',
            icon: 'fa-broom'
        });
        if (res !== 'ok') return;

        // Snapshot ANTES de destruir nada: alimenta el "Deshacer" del toast.
        const snap = snapState();

        closeExp(); closeAddF(); closeExpModal(); rstDel();
        if (fileInput) fileInput.value = '';
        state.file.uploaded = null; state.file.extracted = {}; state.file.pngFile = null;
        state.proc.data = {}; state.proc.edited.clear(); state.proc.collapsed.clear();
        state.editor.active = false; state.editor.added.clear(); state.editor.removed.clear();
        state.jsonEditor.snap = null; state.jsonEditor.dirty = false; state.jsonEditor.err = null;
        state.characterBook.entries = [];
        state.characterBook.present = false; state.characterBook.metadata = {};
        state.altGreetings.original = ''; state.altGreetings.list = []; state.altGreetings.current = 0;
        $('editorToggle')?.classList.remove('active'); $('editorToggle')?.setAttribute('aria-pressed', 'false');
        $('editorInfoBar')?.classList.add('hidden');
        uploadStatus?.classList.add('hidden');
        if (charNameInput) charNameInput.value = '';
        updLP();
        if (processBtn) processBtn.disabled = true;
        refreshProcessHint();
        const pc = $('processedCount'); if (pc) pc.textContent = '0';
        if (rawCount) rawCount.textContent = '0';
        const rv = $('rawView'); if (rv) rv.innerHTML = '';
        const si = $('searchInput'); if (si) { si.value = ''; $('searchClearBtn')?.classList.add('hidden'); }
        searchContainer?.classList.remove('hidden');
        document.querySelectorAll('.field-card').forEach(c => c.style.display = '');
        applyP();
        const pv = $('processedView');
        if (pv) pv.innerHTML = '<div class="flex flex-col items-center justify-center h-full min-h-[40vh] text-center px-4"><div class="text-5xl opacity-20 font-cinzelDeco text-text3 mb-4">&#5765;</div><p class="text-text3 italic max-w-sm text-sm">Las paginas aguardan.</p></div>';
        renderJSON();
        updLorebookCount();
        setWorkspaceLoaded(false);
        setActiveTab('tabProcessed');
        // Sin carta, en movil el panel vuelve a abrirse: es donde se carga la siguiente.
        autoSidebarExpand();
        /* La huella se iguala al final, con el estado ya vacio y el perfil
           reaplicado: si no, el autosave volveria a escribir una sesion vacia
           encima de la que se acaba de borrar. */
        state.vault.savedRev = revision(state);
        showToast('Tomo purificado', 'success', {
            label: 'Deshacer',
            onClick: async () => {
                await hydrateFrom(snap);
                showToast('Trabajo restaurado');
            }
        });
        if (dbReady) { try { await vault.clearSession(); } catch {} }
    });

    /* ── Editor toggle ── */
    $('editorToggle')?.addEventListener('click', togEd);

    /* ── FAB ── */
    $('exportJsonBtn')?.addEventListener('click', openExpModal);
    $('copyAllBtn')?.addEventListener('click', copyAll);

    /* ── Instalacion PWA ── */
    let installPrompt = null;
    const installBtn = $('installBtn');
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        installPrompt = e;
        installBtn?.classList.remove('hidden');
    });
    installBtn?.addEventListener('click', async () => {
        if (!installPrompt) {
            showToast('La instalacion no esta disponible en este navegador', 'info');
            return;
        }
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null;
        installBtn.classList.add('hidden');
    });
    window.addEventListener('appinstalled', () => {
        installPrompt = null;
        installBtn?.classList.add('hidden');
        showToast('Scriptorium instalado');
    });

    /* ── Keyboard shortcuts ── */
    document.addEventListener('keydown', e => {
        const isInput = e.target.matches('input,textarea,[contenteditable="true"]');
        /* Campo de carta (o el modal expandido), no un input del lateral: ahi
           Ctrl+Enter dispara el ritual, que repinta las tarjetas, y el repintado
           se lleva por delante la pila nativa de Ctrl+Z (el nodo se reemplaza;
           no hay forma de conservarla). Ademas dejaria al modal expandido
           escribiendo sobre una tarjeta que ya no esta en el DOM. En los inputs
           del lateral el atajo sigue valiendo, que es donde se espera: escribes
           el nombre e invocas sin soltar el teclado. */
        const inCard = e.target.matches('[contenteditable="true"]');
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.shiftKey && !inCard) { e.preventDefault(); if (processBtn && !processBtn.disabled) processBtn.click(); }
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') { e.preventDefault(); const jv = $('jsonView'); const jab = $('jsonApplyBtn'); if (jv && !jv.classList.contains('hidden') && jab && !jab.disabled) jab.click(); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') { if (!isInput) { e.preventDefault(); togEd(); } }
        if (e.key === 'Escape') {
            if (closeConfirmDialog('cancel')) return;
            if (closeShortcuts()) return;
            const about = $('aboutModal'), exp = $('expandModal'), add = $('addFieldModal'), expM = $('exportModal'), vaultM = $('vaultModal');
            if (vaultM && !vaultM.classList.contains('hidden')) { vaultM.classList.add('hidden'); vaultM.classList.remove('flex'); }
            else if (about && !about.classList.contains('hidden')) { about.classList.add('hidden'); about.classList.remove('flex'); }
            else if (exp && !exp.classList.contains('hidden')) closeExp();
            else if (add && !add.classList.contains('hidden')) closeAddF();
            else if (expM && !expM.classList.contains('hidden')) closeExpModal();
        }
    });

    window.addEventListener('beforeunload', (e) => { if (!isDirty(state)) return; e.preventDefault(); e.returnValue = ''; });
    window.addEventListener('beforeunload', () => { vault.stopAutoSave(); });
});

if ('serviceWorker' in navigator) {
    const isLocalDevelopment = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!window.__scriptoriumSWRefreshBound) {
        window.__scriptoriumSWRefreshBound = true;
        let serviceWorkerRefreshing = false;
        const hadServiceWorkerController = Boolean(navigator.serviceWorker.controller);
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!hadServiceWorkerController || serviceWorkerRefreshing) return;
            serviceWorkerRefreshing = true;
            window.location.reload();
        });
    }

    window.addEventListener('load', async () => {
        if (isLocalDevelopment) {
            try {
                const registrations = await navigator.serviceWorker.getRegistrations();
                await Promise.all(registrations.map(registration => registration.unregister()));
                if (navigator.serviceWorker.controller && sessionStorage.getItem('scriptorium-local-sw-cleanup') !== '1') {
                    sessionStorage.setItem('scriptorium-local-sw-cleanup', '1');
                    window.location.reload();
                } else {
                    sessionStorage.removeItem('scriptorium-local-sw-cleanup');
                }
            } catch (error) {
                console.warn('[PWA] No se pudo limpiar el service worker local', error);
            }
            return;
        }

        try {
            const registration = await navigator.serviceWorker.register('./service-worker.js', {
                scope: './',
                updateViaCache: 'none'
            });
            await registration.update();
            console.info('[PWA] Service worker registrado:', registration.scope);
        } catch (error) {
            console.error('[PWA] No se pudo registrar', error);
        }
    });
}
