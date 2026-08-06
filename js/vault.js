import vault from './storage.js';

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
}

function countCardFields(card) {
    let c = 0;
    const seen = new WeakSet();
    (function w(o) {
        if (!o || typeof o !== 'object' || seen.has(o)) return;
        seen.add(o);
        for (const k in o) {
            if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
            const v = o[k];
            if (typeof v === 'object' && v !== null) w(v);
            else if (typeof v === 'string' && v.trim()) c++;
        }
    })(card?.data || card);
    return c;
}

let _injected = false;

function injectModal() {
    if (_injected) return;
    _injected = true;
    const el = document.createElement('div');
    el.innerHTML = `
    <div id="vaultModal" role="dialog" aria-modal="true" aria-label="Boveda de personajes" class="fixed inset-0 z-[65] hidden items-center justify-center p-4">
      <div id="vaultBackdrop" class="absolute inset-0 bg-black/70 backdrop-blur-sm"></div>
      <div class="relative bg-surface border border-border2 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-[0_20px_60px_rgba(0,0,0,0.6)] animate-fade-in-up">
        <div class="flex items-center gap-3 px-5 py-3.5 border-b border-border1 bg-gradient-to-r from-[#2a1f00] to-[#1c1600] rounded-t-xl shrink-0">
          <i class="fa-solid fa-box-archive text-gold text-sm" aria-hidden="true"></i>
          <h3 class="font-cinzel text-xs tracking-widest uppercase text-gold flex-1">Boveda de Personajes</h3>
          <span id="vaultCount" class="text-[0.6rem] text-text3 font-crimson italic"></span>
          <button id="vaultClose" aria-label="Cerrar boveda" class="text-text3 hover:text-text1 transition-colors ml-1"><i class="fa-solid fa-xmark text-lg"></i></button>
        </div>
        <div class="flex items-center gap-2 px-5 py-3 border-b border-border1 shrink-0 flex-wrap">
          <button id="vaultExportBtn" class="font-cinzel text-[0.6rem] tracking-wider uppercase text-text3 hover:text-editor border border-border1 hover:border-editor/30 rounded-md px-3 py-1.5 transition-all flex items-center gap-1.5"><i class="fa-solid fa-file-export text-[0.6rem]"></i> Exportar boveda</button>
          <button id="vaultImportBundleBtn" class="font-cinzel text-[0.6rem] tracking-wider uppercase text-text3 hover:text-gold border border-border1 hover:border-goldDim rounded-md px-3 py-1.5 transition-all flex items-center gap-1.5"><i class="fa-solid fa-file-import text-[0.6rem]"></i> Importar boveda</button>
          <input type="file" id="vaultImportInput" class="hidden" accept=".scriptorium,.json,application/json">
          <div class="flex-1"></div>
          <button id="vaultSaveCurrentBtn" class="font-cinzel text-[0.6rem] tracking-wider uppercase text-bg bg-gold hover:brightness-110 rounded-md px-3 py-1.5 transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"><i class="fa-solid fa-floppy-disk text-[0.6rem]"></i> Guardar actual</button>
        </div>
        <div id="vaultList" class="flex-1 overflow-y-auto scrollbar-custom p-4 space-y-2 min-h-[200px]"></div>
        <div class="px-5 py-2.5 border-t border-border1 text-[0.6rem] text-text3 font-crimson italic flex items-center gap-2 shrink-0"><i class="fa-solid fa-hard-drive text-[0.55rem]"></i><span>Guardado en IndexedDB · Los archivos exportados se guardan donde tu decidas</span></div>
      </div>
    </div>`;
    document.body.appendChild(el.firstElementChild);

    $('vaultClose')?.addEventListener('click', closeVault);
    $('vaultBackdrop')?.addEventListener('click', closeVault);
    $('vaultModal')?.addEventListener('keydown', e => { if (e.key === 'Escape') closeVault(); });

    $('vaultExportBtn')?.addEventListener('click', async () => {
        try {
            const count = await vault.downloadBundle();
            const { showToast } = await import('./utils.js');
            showToast(`Boveda exportada (${count} personajes)`);
        } catch (err) {
            console.error(err);
            const { showToast } = await import('./utils.js');
            showToast('Error al exportar: ' + err.message, 'error');
        }
    });

    $('vaultImportBundleBtn')?.addEventListener('click', () => $('vaultImportInput')?.click());

    $('vaultImportInput')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const n = await vault.importBundleFromFile(file);
            await renderList();
            const { showToast } = await import('./utils.js');
            showToast(`${n} personajes importados`);
        } catch (err) {
            console.error(err);
            const { showToast } = await import('./utils.js');
            showToast('Error al importar: ' + err.message, 'error');
        } finally {
            e.target.value = '';
        }
    });

    // FIX: sin timeout de 50ms, el listener en app.js es sincrono
    $('vaultSaveCurrentBtn')?.addEventListener('click', saveCurrentToVault);
}

export async function saveCurrentToVault() {
    try {
        const ev = new CustomEvent('vault:request-card', { detail: {} });
        document.dispatchEvent(ev);
        if (!ev.detail?.card) {
            const { showToast } = await import('./utils.js');
            showToast('No hay carta para guardar', 'info');
            return false;
        }
        const charName = document.getElementById('charName')?.value?.trim() || 'Sin nombre';
        await vault.saveCharacter({ card: ev.detail.card, name: charName, charName });
        if ($('vaultModal')) await renderList();
        const { showToast } = await import('./utils.js');
        showToast(`"${charName}" guardado en boveda`);
        return true;
    } catch (err) {
        console.error(err);
        const { showToast } = await import('./utils.js');
        showToast('Error al guardar: ' + err.message, 'error');
        return false;
    }
}

async function renderList() {
    const list = $('vaultList'), countEl = $('vaultCount');
    if (!list) return;
    try {
        const chars = await vault.getAllCharacters();
        if (countEl) countEl.textContent = chars.length + ' personaje' + (chars.length !== 1 ? 's' : '');
        if (!chars.length) {
            list.innerHTML = '<div class="flex flex-col items-center justify-center py-12 text-center"><i class="fa-solid fa-box-open text-3xl text-text3/30 mb-3"></i><p class="text-text3 italic text-sm">La boveda esta vacia.</p><p class="text-text3/60 text-xs mt-2">Guarda tu personaje actual para verlo aqui.</p></div>';
            return;
        }
        list.innerHTML = '';
        for (const char of chars) {
            const card = document.createElement('div');
            card.className = 'flex items-center gap-3 bg-surface2/60 border border-border1 rounded-lg px-4 py-3 hover:border-border2 transition-all group';
            const d = new Date(char.savedAt);
            const dateStr = d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' });
            const timeStr = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
            const fc = countCardFields(char.card);
            card.innerHTML = `
                <div class="w-9 h-9 rounded-full bg-[radial-gradient(circle_at_50%_60%,rgba(201,168,76,0.15)_0%,transparent_70%)] border border-goldDim/40 flex items-center justify-center shrink-0"><i class="fa-solid fa-user-pen text-goldDim text-xs"></i></div>
                <div class="flex-1 min-w-0">
                    <div class="font-cinzel text-[0.72rem] tracking-wider uppercase text-text1 truncate">${escapeHtml(char.name)}</div>
                    <div class="text-[0.6rem] text-text3 font-crimson italic mt-0.5">${fc} campo${fc !== 1 ? 's' : ''} · v${char.version || 1} · ${dateStr} ${timeStr}</div>
                </div>
                <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button class="vault-load-btn w-7 h-7 rounded flex items-center justify-center text-text3 hover:text-gold hover:bg-surface transition-all" title="Cargar" aria-label="Cargar ${escapeHtml(char.name)}"><i class="fa-solid fa-arrow-up-from-bracket text-xs"></i></button>
                    <button class="vault-export-btn w-7 h-7 rounded flex items-center justify-center text-text3 hover:text-editor hover:bg-surface transition-all" title="Descargar" aria-label="Descargar ${escapeHtml(char.name)}"><i class="fa-solid fa-download text-xs"></i></button>
                    <button class="vault-delete-btn w-7 h-7 rounded flex items-center justify-center text-text3 hover:text-[#e05a5a] hover:bg-surface transition-all" title="Eliminar" aria-label="Eliminar ${escapeHtml(char.name)}"><i class="fa-solid fa-trash-can text-xs"></i></button>
                </div>`;

            card.querySelector('.vault-load-btn')?.addEventListener('click', () => {
                document.dispatchEvent(new CustomEvent('vault:load-card', { detail: { card: char.card, name: char.name } }));
                closeVault();
            });

            card.querySelector('.vault-export-btn')?.addEventListener('click', () => {
                try {
                    const json = JSON.stringify(char.card, null, 2);
                    const blob = new Blob([json], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a'); a.href = url;
                    a.download = (char.name || 'personaje').replace(/[^a-z0-9_\-]/gi, '_') + '_card.json';
                    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                } catch (e) { console.error(e); }
            });

            card.querySelector('.vault-delete-btn')?.addEventListener('click', async () => {
                if (!confirm(`Eliminar "${char.name}" de la boveda?`)) return;
                try {
                    await vault.deleteCharacter(char.id);
                    await renderList();
                } catch (e) {
                    console.error(e);
                }
            });

            list.appendChild(card);
        }
    } catch (err) {
        console.error('[vault] renderList', err);
        list.innerHTML = '<div class="text-center py-8 text-[#e05a5a] text-sm">Error al cargar boveda</div>';
    }
}

export function openVault() {
    injectModal();
    const modal = $('vaultModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    renderList();
    $('vaultClose')?.focus();
}

export function closeVault() {
    const modal = $('vaultModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}
