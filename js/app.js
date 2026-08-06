import state, { getExtracted } from './state.js';
import { $, showToast, copyClip, deepClone } from './utils.js';
import { extractFields } from './chara-card.js';
import { extPNG } from './png-parser.js';
import vault from './storage.js';
import { openVault } from './vault.js';
import { loadProfiles, saveCurP, newPrf, delCurP, chgP, saveD, updLbl, rstDel, applyP, renderSel } from './profiles.js';
import { processText, renderRaw, renderProc, renderJSON, updFab, togEd, resetCardState, updLP, closeExp, closeAddF } from './editor.js';
import { openExpModal, closeExpModal, copyAll } from './export.js';
import { initCanvas, initSidebar, initTabs, setActiveTab, initSearch, initAbout, initExpandModal, initAddFieldModal, initExportModal, initJsonEditor } from './ui.js';

document.addEventListener('DOMContentLoaded', async () => {

    /* ── Init modules ── */
    initCanvas();
    initSidebar();
    initTabs();
    initSearch();
    initAbout();
    initExpandModal();
    initAddFieldModal();
    initExportModal();
    initJsonEditor();

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

    /* ── Vault init ── */
    const dbReady = await vault.init();
    if (dbReady) {
        vault.startAutoSave(() => state);
        vault.on('session-saved', () => {
            const el = $('vaultStatusText');
            if (el) el.textContent = 'Guardado ' + new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
        });

        const saved = await vault.loadSession();
        if (saved && saved.file) {
            const minAgo = Math.round((Date.now() - saved.savedAt) / 60000);
            const timeText = minAgo < 1 ? 'hace un momento' : `hace ${minAgo} min`;
            const recover = confirm(
                `Se encontró una sesión guardada ${timeText}.\n\n` +
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
                if (saved.charName) charNameInput.value = saved.charName;
                if (saved.userName) userNameInput.value = saved.userName;
                if (saved.sysPrompt) sysPromptInput.value = saved.sysPrompt;
                if (saved.userPersona) userPersonaInput.value = saved.userPersona;
                processBtn.disabled = false;
                processText();
                showToast('Sesión recuperada');
            } else {
                await vault.clearSession();
            }
        }
    }

    /* ── Vault buttons ── */
    $('vaultBtn').addEventListener('click', openVault);
    $('vaultStatus').addEventListener('click', openVault);

    /* ── Vault events ── */
    document.addEventListener('vault:load-card', (e) => {
        const { card, name } = e.detail;
        state.file.uploaded = card;
        resetCardState();
        extractFields(card);
        const count = Object.keys(getExtracted()).length;
        if (name) { charNameInput.value = name; updLP(); }
        rawCount.textContent = count;
        renderRaw();
        processBtn.disabled = count === 0;
        renderJSON();
        if (userNameInput.value.trim() || sysPromptInput.value.trim()) processText();
    });

    document.addEventListener('vault:request-card', (e) => {
        e.detail.card = (await import('./chara-card.js')).buildExp();
    });

    /* ── Profiles ── */
    loadProfiles();
    renderJSON();

    $('saveProfileBtn').addEventListener('click', saveCurP);
    $('newProfileBtn').addEventListener('click', newPrf);
    $('deleteProfileBtn').addEventListener('click', delCurP);
    $('profileSelect').addEventListener('change', chgP);
    $('profileLabelInput').addEventListener('input', updLbl);
    charNameInput.addEventListener('input', updLP);
    userNameInput.addEventListener('input', updLP);

    /* ── File handling ── */
    function setStatus(msg, type, html) {
        uploadStatus.classList.remove('hidden');
        uploadStatus.className = 'mt-3 text-xs p-2.5 rounded-lg text-center italic border ' +
            (type === 'error' ? 'border-[#502020] text-[#e05a5a]' : type === 'success' ? 'border-goldDim text-gold' : 'border-border2 text-user');
        if (html) uploadStatus.innerHTML = msg; else uploadStatus.textContent = msg;
    }

    async function handleFile(file) {
        const j = file.type === 'application/json' || file.name.toLowerCase().endsWith('.json');
        const p = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
        if (!j && !p) return setStatus('Solo JSON o PNG.', 'error');
        if (file.size > 10 * 1024 * 1024) return setStatus('Max 10 MB.', 'error');
        setStatus('<i class="fa-solid fa-circle-notch fa-spin"></i> Leyendo...', 'info', true);
        try {
            if (j) {
                const r = new FileReader();
                r.onload = e => { try { state.file.uploaded = JSON.parse(e.target.result); finishLoad(file.name); } catch { setStatus('JSON malformado.', 'error'); } };
                r.readAsText(file);
            } else {
                state.file.uploaded = await extPNG(file);
                finishLoad(file.name);
            }
        } catch (err) { setStatus('Error: ' + (err.message || 'Sin metadatos.'), 'error'); }
    }

    function finishLoad(fn) {
        resetCardState();
        const dup = extractFields(state.file.uploaded), count = Object.keys(getExtracted()).length;
        if (count === 0) return setStatus('Tomo vacio.', 'error');
        const nm = state.file.uploaded.name || state.file.uploaded.data?.name || state.file.uploaded.char_name || '';
        if (nm) { charNameInput.value = nm; updLP(); }
        let msg = '✓ ' + fn + ' — ' + count + ' campo(s).';
        if (dup > 0) msg += ' (' + dup + ' dup.)';
        setStatus(msg, 'success');
        rawCount.textContent = count;
        renderRaw();
        processBtn.disabled = false;
        renderJSON();
        if (userNameInput.value.trim() || sysPromptInput.value.trim()) processText();
        else $('tabRaw').click();
    }

    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
    dropzone.addEventListener('drop', e => { e.preventDefault(); dropzone.classList.remove('drag-over'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
    fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

    /* ── Process / Clear ── */
    processBtn.addEventListener('click', processText);

    clearBtn.addEventListener('click', () => {
        closeExp(); closeAddF(); closeExpModal(); rstDel();
        fileInput.value = '';
        state.file.uploaded = null; state.file.extracted = {};
        state.proc.data = {}; state.proc.edited.clear();
        state.editor.active = false; state.editor.added.clear(); state.editor.removed.clear();
        state.jsonEditor.snap = null; state.jsonEditor.dirty = false; state.jsonEditor.err = null;
        $('editorToggle').classList.remove('active'); $('editorToggle').setAttribute('aria-pressed', 'false');
        $('editorInfoBar').classList.add('hidden');
        uploadStatus.classList.add('hidden');
        charNameInput.value = ''; updLP();
        processBtn.disabled = true;
        $('processedCount').textContent = '0'; rawCount.textContent = '0';
        $('rawView').innerHTML = '';
        $('searchInput').value = ''; $('searchClearBtn').classList.add('hidden');
        searchContainer.classList.remove('hidden');
        document.querySelectorAll('.field-card').forEach(c => c.style.display = '');
        applyP();
        $('processedView').innerHTML = '<div class="flex flex-col items-center justify-center h-full min-h-[40vh] text-center px-4"><div class="text-5xl opacity-20 font-cinzelDeco text-text3 mb-4">&#5765;</div><p class="text-text3 italic max-w-sm text-sm">Las paginas aguardan.</p></div>';
        renderJSON();
        setActiveTab('tabProcessed');
        showToast('Tomo purificado');
    });

    /* ── Editor toggle ── */
    $('editorToggle').addEventListener('click', togEd);

    /* ── FAB ── */
    $('exportJsonBtn').addEventListener('click', openExpModal);
    $('copyAllBtn').addEventListener('click', copyAll);

    /* ── Keyboard shortcuts ── */
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); if (!processBtn.disabled) processBtn.click();
        }
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
            e.preventDefault();
            if (!$('jsonView').classList.contains('hidden') && !$('jsonApplyBtn').disabled) $('jsonApplyBtn').click();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
            if (!e.target.matches('input,textarea,[contenteditable="true"]')) { e.preventDefault(); togEd(); }
        }
        if (e.key === 'Escape') {
            if (!$('aboutModal').classList.contains('hidden')) { $('aboutModal').classList.add('hidden'); $('aboutModal').classList.remove('flex'); }
            else if (!$('expandModal').classList.contains('hidden')) closeExp();
            else if (!$('addFieldModal').classList.contains('hidden')) closeAddF();
            else if (!$('exportModal').classList.contains('hidden')) closeExpModal();
        }
    });

    /* ── Protect before unload ── */
    window.addEventListener('beforeunload', (e) => {
        const hasData = Object.keys(state.proc.data).length > 0;
        const hasFile = state.file.uploaded !== null;
        if (hasData || hasFile) { e.preventDefault(); e.returnValue = ''; }
    });

    window.addEventListener('beforeunload', () => { vault.stopAutoSave(); });
});
