// js/vault.js

import vault from './storage.js';
import state from './state.js';

const $ = (id) => document.getElementById(id);

const VAULT_MODAL_HTML = `
<div id="vaultModal" role="dialog" aria-modal="true"
     class="fixed inset-0 z-[65] hidden items-center justify-center p-4">
  <div id="vaultBackdrop" class="absolute inset-0 bg-black/70 backdrop-blur-sm"></div>
  <div class="relative bg-surface border border-border2 rounded-xl w-full max-w-2xl max-h-[85vh]
              flex flex-col shadow-[0_20px_60px_rgba(0,0,0,0.6)] animate-fade-in-up">

    <!-- Header -->
    <div class="flex items-center gap-3 px-5 py-3.5 border-b border-border1
                bg-gradient-to-r from-[#2a1f00] to-[#1c1600] rounded-t-xl shrink-0">
      <i class="fa-solid fa-vault text-gold text-sm"></i>
      <h3 class="font-cinzel text-xs tracking-widest uppercase text-gold flex-1">
        Bóveda de Personajes
      </h3>
      <span id="vaultCount"
            class="text-[0.6rem] text-text3 font-crimson italic tracking-normal">
      </span>
      <button id="vaultClose"
              class="text-text3 hover:text-text1 transition-colors ml-1">
        <i class="fa-solid fa-xmark text-lg"></i>
      </button>
    </div>

    <!-- Toolbar -->
    <div class="flex items-center gap-2 px-5 py-3 border-b border-border1 shrink-0 flex-wrap">
      <button id="vaultExportBtn"
              class="font-cinzel text-[0.6rem] tracking-wider uppercase text-text3
                     hover:text-editor border border-border1 hover:border-editor/30
                     rounded-md px-3 py-1.5 transition-all flex items-center gap-1.5">
        <i class="fa-solid fa-file-export text-[0.6rem]"></i>
        Exportar bóveda
      </button>
      <button id="vaultImportBundleBtn"
              class="font-cinzel text-[0.6rem] tracking-wider uppercase text-text3
                     hover:text-gold border border-border1 hover:border-goldDim
                     rounded-md px-3 py-1.5 transition-all flex items-center gap-1.5">
        <i class="fa-solid fa-file-import text-[0.6rem]"></i>
        Importar bóveda
      </button>
      <input type="file" id="vaultImportInput" class="hidden"
             accept=".scriptorium,.json">
      <div class="flex-1"></div>
      <button id="vaultSaveCurrentBtn"
              class="font-cinzel text-[0.6rem] tracking-wider uppercase text-bg
                     bg-gold hover:brightness-110 rounded-md px-3 py-1.5 transition-all
                     flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
        <i class="fa-solid fa-floppy-disk text-[0.6rem]"></i>
        Guardar actual
      </button>
    </div>

    <!-- Character list -->
    <div id="vaultList"
         class="flex-1 overflow-y-auto scrollbar-custom p-4 space-y-2 min-h-[200px]">
    </div>

    <!-- Footer -->
    <div class="px-5 py-2.5 border-t border-border1 text-[0.6rem] text-text3
                font-crimson italic flex items-center gap-2 shrink-0">
      <i class="fa-solid fa-hard-drive text-[0.55rem]"></i>
      <span>Guardado en IndexedDB · Los archivos exportados se guardan donde tú decidas</span>
    </div>
  </div>
</div>`;

/* ───────── Estado de la UI ───────── */

let lastTrigger = null;

/* ───────── Renderizar lista ───────── */

async function renderVaultList() {
    const list = $('vaultList');
    const countEl = $('vaultCount');
    if (!list) return;

    const characters = await vault.getAllCharacters();
    countEl.textContent = characters.length + ' personaje' + (characters.length !== 1 ? 's' : '');

    if (characters.length === 0) {
        list.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12 text-center">
                <i class="fa-solid fa-box-open text-3xl text-text3/30 mb-3"></i>
                <p class="text-text3 italic text-sm">La bóveda está vacía.</p>
                <p class="text-text3/60 text-xs mt-1">Guarda personajes desde el editor o importa una bóveda.</p>
            </div>`;
        return;
    }

    list.innerHTML = '';

    for (const char of characters) {
        const card = document.createElement('div');
        card.className = `flex items-center gap-3 bg-surface2/60 border border-border1
                          rounded-lg px-4 py-3 hover:border-border2 transition-all group`;
        card.dataset.id = char.id;

        const date = new Date(char.savedAt);
        const dateStr = date.toLocaleDateString('es', {
            day: '2-digit', month: 'short', year: 'numeric'
        });
        const timeStr = date.toLocaleTimeString('es', {
            hour: '2-digit', minute: '2-digit'
        });

        const fieldCount = countCardFields(char.card);

        card.innerHTML = `
            <div class="w-9 h-9 rounded-full bg-[radial-gradient(circle_at_50%_60%,rgba(201,168,76,0.15)_0%,transparent_70%)]
                        border border-goldDim/40 flex items-center justify-center shrink-0">
                <i class="fa-solid fa-user-pen text-goldDim text-xs"></i>
            </div>
            <div class="flex-1 min-w-0">
                <div class="font-cinzel text-[0.72rem] tracking-wider uppercase text-text1 truncate">
                    ${escapeHtml(char.name)}
                </div>
                <div class="text-[0.6rem] text-text3 font-crimson italic mt-0.5 flex items-center gap-2">
                    <span>${fieldCount} campo${fieldCount !== 1 ? 's' : ''}</span>
                    <span class="text-border2">·</span>
                    <span>v${char.version || 1}</span>
                    <span class="text-border2">·</span>
                    <span>${dateStr} ${timeStr}</span>
                </div>
            </div>
            <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button class="vault-load-btn w-7 h-7 rounded flex items-center justify-center
                               text-text3 hover:text-gold hover:bg-surface transition-all"
                        title="Cargar en el editor">
                    <i class="fa-solid fa-arrow-up-from-bracket text-xs"></i>
                </button>
                <button class="vault-export-btn w-7 h-7 rounded flex items-center justify-center
                               text-text3 hover:text-editor hover:bg-surface transition-all"
                        title="Descargar como JSON">
                    <i class="fa-solid fa-download text-xs"></i>
                </button>
                <button class="vault-delete-btn w-7 h-7 rounded flex items-center justify-center
                               text-text3 hover:text-[#e05a5a] hover:bg-surface transition-all"
                        title="Eliminar de la bóveda">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            </div>`;

        // Eventos de los botones
        const loadBtn = card.querySelector('.vault-load-btn');
        const exportBtn = card.querySelector('.vault-export-btn');
        const deleteBtn = card.querySelector('.vault-delete-btn');

        loadBtn.addEventListener('click', () => loadCharacterFromVault(char));
        exportBtn.addEventListener('click', () => downloadCharacterAsJSON(char));
        deleteBtn.addEventListener('click', () => deleteCharacterFromVault(char.id));

        list.appendChild(card);
    }
}

/* ───────── Acciones ───────── */

async function loadCharacterFromVault(char) {
    try {
        // Carga el personaje en el editor actual
        state.file.uploaded = JSON.parse(JSON.stringify(char.card));
        state.file.extracted = {};
        state.proc.data = {};
        state.proc.edited.clear();
        state.editor.added.clear();
        state.editor.removed.clear();

        // Disparar el mismo flujo que la carga de archivo
        const event = new CustomEvent('vault:load-card', {
            detail: { card: char.card, name: char.name }
        });
        document.dispatchEvent(event);

        closeVault();
    } catch (err) {
        console.error('[Vault] Error cargando personaje:', err);
    }
}

function downloadCharacterAsJSON(char) {
    const json = JSON.stringify(char.card, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (char.name || 'personaje').replace(/[^a-z0-9_\-]/gi, '_') + '_card.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function deleteCharacterFromVault(id) {
    await vault.deleteCharacter(id);
    await renderVaultList();
}

async function saveCurrentToVault() {
    const card = buildCurrentCard();
    if (!card) return;

    const charName = document.getElementById('charName')?.value?.trim() || 'Sin nombre';
    await vault.saveCharacter({
        card,
        name: charName,
        charName
    });
    await renderVaultList();
}

function buildCurrentCard() {
    // Necesita acceso a buildExp del módulo export.js
    // Se conecta vía evento
    const event = new CustomEvent('vault:request-card');
    document.dispatchEvent(event);
    return event.detail?.card || null;
}

/* ───────── Modal ───────── */

function injectModal() {
    if ($('vaultModal')) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = VAULT_MODAL_HTML;
    document.body.appendChild(wrapper.firstElementChild);

    $('vaultClose').addEventListener('click', closeVault);
    $('vaultBackdrop').addEventListener('click', closeVault);
    $('vaultModal').addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeVault();
    });

    $('vaultExportBtn').addEventListener('click', async () => {
        const count = await vault.downloadBundle();
    });

    $('vaultImportBundleBtn').addEventListener('click', () => {
        $('vaultImportInput').click();
    });

    $('vaultImportInput').addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const imported = await vault.importBundleFromFile(file);
            await renderVaultList();
        } catch (err) {
            console.error('[Vault] Error importando:', err);
        }
        e.target.value = '';
    });

    $('vaultSaveCurrentBtn').addEventListener('click', saveCurrentToVault);
}

export function openVault() {
    injectModal();
    lastTrigger = document.activeElement;
    const modal = $('vaultModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    renderVaultList();
    $('vaultClose').focus();
}

function closeVault() {
    const modal = $('vaultModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    if (lastTrigger) { lastTrigger.focus(); lastTrigger = null; }
}

/* ───────── Helpers ───────── */

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function countCardFields(card) {
    let count = 0;
    (function walk(obj) {
        for (const k in obj) {
            if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
            if (typeof obj[k] === 'object' && obj[k] !== null) walk(obj[k]);
            else if (typeof obj[k] === 'string' && obj[k].trim()) count++;
        }
    })(card?.data || card);
    return count;
}

/* ───────── Funciones públicas ───────── */

export { closeVault, renderVaultList };
