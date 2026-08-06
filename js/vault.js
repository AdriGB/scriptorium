import vault from './storage.js';

const $ = (id) => document.getElementById(id);

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function countCardFields(card) {
    let c = 0;
    (function w(o) { for (const k in o) { if (!Object.prototype.hasOwnProperty.call(o, k)) continue; if (typeof o[k] === 'object' && o[k] !== null) w(o[k]); else if (typeof o[k] === 'string' && o[k].trim()) c++; } })(card?.data || card);
    return c;
}

let _injected = false;

function injectModal() {
    if (_injected) return;
    _injected = true;
    const el = document.createElement('div');
    el.innerHTML = `
    <div id="vaultModal" role="dialog" aria-modal="true" class="fixed inset-0 z-[65] hidden items-center justify-center p-4">
      <div id="vaultBackdrop" class="absolute inset-0 bg-black/70 backdrop-blur-sm"></div>
      <div class="relative bg-surface border border-border2 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-[0_20px_60px_rgba(0,0,0,0.6)] animate-fade-in-up">
        <div class="flex items-center gap-3 px-5 py-3.5 border-b border-border1 bg-gradient-to-r from-[#2a1f00] to-[#1c1600] rounded-t-xl shrink-0">
          <i class="fa-solid fa-box-archive text-gold text-sm"></i>
          <h3 class="font-cinzel text-xs tracking-widest uppercase text-gold flex-1">B&oacute;veda de Personajes</h3>
          <span id="vaultCount" class="text-[0.6rem] text-text3 font-crimson italic"></span>
          <button id="vaultClose" class="text-text3 hover:text-text1 transition-colors ml-1"><i class="fa-solid fa-xmark text-lg"></i></button>
        </div>
        <div class="flex items-center gap-2 px-5 py-3 border-b border-border1 shrink-0 flex-wrap">
          <button id="vaultExportBtn" class="font-cinzel text-[0.6rem] tracking-wider uppercase text-text3 hover:text-editor border border-border1 hover:border-editor/30 rounded-md px-3 py-1.5 transition-all flex items-center gap-1.5"><i class="fa-solid fa-file-export text-[0.6rem]"></i> Exportar b&oacute;veda</button>
          <button id="vaultImportBundleBtn" class="font-cinzel text-[0.6rem] tracking-wider uppercase text-text3 hover:text-gold border border-border1 hover:border-goldDim rounded-md px-3 py-1.5 transition-all flex items-center gap-1.5"><i class="fa-solid fa-file-import text-[0.6rem]"></i> Importar b&oacute;veda</button>
          <input type="file" id="vaultImportInput" class="hidden" accept=".scriptorium,.json">
          <div class="flex-1"></div>
          <button id="vaultSaveCurrentBtn" class="font-cinzel text-[0.6rem] tracking-wider uppercase text-bg bg-gold hover:brightness-110 rounded-md px-3 py-1.5 transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"><i class="fa-solid fa-floppy-disk text-[0.6rem]"></i> Guardar actual</button>
        </div>
        <div id="vaultList" class="flex-1 overflow-y-auto scrollbar-custom p-4 space-y-2 min-h-[200px]"></div>
        <div class="px-5 py-2.5 border-t border-border1 text-[0.6rem] text-text3 font-crimson italic flex items-center gap-2 shrink-0"><i class="fa-solid fa-hard-drive text-[0.55rem]"></i><span>Guardado en IndexedDB &middot; Los archivos exportados se guardan donde t&uacute; decidas</span></div>
      </div>
    </div>`;
    document.body.appendChild(el.firstElementChild);

    $('vaultClose').addEventListener('click', closeVault);
    $('vaultBackdrop').addEventListener('click', closeVault);
    $('vaultModal').addEventListener('keydown', e => { if (e.key === 'Escape') closeVault(); });
    $('vaultExportBtn').addEventListener('click', async () => { await vault.downloadBundle(); });
    $('vaultImportBundleBtn').addEventListener('click', () => $('vaultImportInput').click());
    $('vaultImportInput').addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try { const n = await vault.importBundleFromFile(file); await renderList(); }
        catch (err) { console.error(err); }
        e.target.value = '';
    });
    $('vaultSaveCurrentBtn').addEventListener('click', async () => {
        const ev = new CustomEvent('vault:request-card');
        document.dispatchEvent(ev);
        if (!ev.detail?.card) return;
        const charName = document.getElementById('charName')?.value?.trim() || 'Sin nombre';
        await vault.saveCharacter({ card: ev.detail.card, name: charName, charName });
        await renderList();
    });
}

async function renderList() {
    const list = $('vaultList'), countEl = $('vaultCount');
    if (!list) return;
    const chars = await vault.getAllCharacters();
    countEl.textContent = chars.length + ' personaje' + (chars.length !== 1 ? 's' : '');
    if (!chars.length) {
        list.innerHTML = '<div class="flex flex-col items-center justify-center py-12 text-center"><i class="fa-solid fa-box-open text-3xl text-text3/30 mb-3"></i><p class="text-text3 italic text-sm">La b&oacute;veda est&aacute; vac&iacute;a.</p></div>';
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
                <div class="text-[0.6rem] text-text3 font-crimson italic mt-0.5">${fc} campo${fc !== 1 ? 's' : ''} &middot; v${char.version || 1} &middot; ${dateStr} ${timeStr}</div>
            </div>
            <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button class="vault-load-btn w-7 h-7 rounded flex items-center justify-center text-text3 hover:text-gold hover:bg-surface transition-all" title="Cargar"><i class="fa-solid fa-arrow-up-from-bracket text-xs"></i></button>
                <button class="vault-export-btn w-7 h-7 rounded flex items-center justify-center text-text3 hover:text-editor hover:bg-surface transition-all" title="Descargar"><i class="fa-solid fa-download text-xs"></i></button>
                <button class="vault-delete-btn w-7 h-7 rounded flex items-center justify-center text-text3 hover:text-[#e05a5a] hover:bg-surface transition-all" title="Eliminar"><i class="fa-solid fa-trash-can text-xs"></i></button>
            </div>`;
        card.querySelector('.vault-load-btn').addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('vault:load-card', { detail: { card: char.card, name: char.name } }));
            closeVault();
        });
        card.querySelector('.vault-export-btn').addEventListener('click', () => {
            const json = JSON.stringify(char.card, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url;
            a.download = (char.name || 'personaje').replace(/[^a-z0-9_\-]/gi, '_') + '_card.json';
            document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        });
        card.querySelector('.vault-delete-btn').addEventListener('click', async () => {
            await vault.deleteCharacter(char.id); await renderList();
        });
        list.appendChild(card);
    }
}

export function openVault() {
    injectModal();
    $('vaultModal').classList.remove('hidden');
    $('vaultModal').classList.add('flex');
    renderList();
    $('vaultClose').focus();
}

export function closeVault() {
    $('vaultModal').classList.add('hidden');
    $('vaultModal').classList.remove('flex');
}
