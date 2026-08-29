import vault from './storage.js';
import { confirmDialog } from './utils.js';

const $ = (id) => document.getElementById(id);

/* Escape sin DOM (antes usaba document.createElement): ademas de permitir importar
   el modulo en Node para los tests, escapa comillas, que hacian falta en los
   aria-label donde se interpolan nombres de personaje. */
function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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

/** Cache de la ultima lectura de IndexedDB; evita releer en cada tecla del buscador. */
let _chars = [];
/** Termino de busqueda normalizado (minusculas, sin espacios extremos). Vacio = sin filtro. */
let _query = '';

/* Exportadas para tests/regression.mjs: importarlas evita replicar aqui la logica. */

/** Resalta TODAS las coincidencias. Se escapa trozo a trozo para no romper el HTML. */
export function highlight(text, query) {
    const raw = String(text ?? '');
    if (!query) return escapeHtml(raw);
    const needle = String(query).toLowerCase();
    if (!needle) return escapeHtml(raw);
    const low = raw.toLowerCase();
    let out = '', from = 0;
    for (;;) {
        const at = low.indexOf(needle, from);
        if (at < 0) { out += escapeHtml(raw.slice(from)); break; }
        out += escapeHtml(raw.slice(from, at));
        out += '<mark class="search-hit">' + escapeHtml(raw.slice(at, at + needle.length)) + '</mark>';
        from = at + needle.length;
    }
    return out;
}

/** Texto plano sobre el que busca la boveda: nombre, descripcion y etiquetas. */
function searchBlob(char) {
    const data = char.card?.data || {};
    const tags = Array.isArray(data.tags) ? data.tags.join(' ') : '';
    return [char.name, data.description, tags].filter(Boolean).join(' ');
}

/**
 * Fragmento de la descripcion para la fila: centrado en la coincidencia si la hay,
 * o el principio del texto. Devuelve texto SIN escapar (lo escapa highlight).
 */
export function buildExcerpt(char, query, max = 140) {
    const desc = String(char.card?.data?.description || '').replace(/\s+/g, ' ').trim();
    if (!desc) return '';
    const at = query ? desc.toLowerCase().indexOf(query.toLowerCase()) : -1;
    if (at < 0) return desc.length > max ? desc.slice(0, max).trimEnd() + '…' : desc;
    const from = Math.max(0, at - 40);
    const to = Math.min(desc.length, from + max);
    return (from > 0 ? '…' : '') + desc.slice(from, to).trim() + (to < desc.length ? '…' : '');
}

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
        <div class="flex items-center gap-2 px-5 py-2.5 border-b border-border1 bg-bg2/40 shrink-0">
          <i class="fa-solid fa-magnifying-glass text-text3 text-[0.65rem]" aria-hidden="true"></i>
          <label for="vaultSearch" class="sr-only">Buscar en la boveda</label>
          <input type="text" id="vaultSearch" placeholder="Buscar por nombre, descripcion o etiquetas..." class="flex-1 min-w-0 bg-transparent border-none outline-none text-text1 font-crimson text-sm placeholder:text-text3 placeholder:italic">
          <span id="vaultSearchCount" class="hidden text-[0.6rem] text-text3 font-crimson italic whitespace-nowrap"></span>
          <button id="vaultSearchClear" type="button" title="Limpiar busqueda" aria-label="Limpiar busqueda" class="hidden text-text3 hover:text-text1 transition-colors"><i class="fa-solid fa-circle-xmark text-xs"></i></button>
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

    $('vaultSearch')?.addEventListener('input', (e) => {
        _query = (e.target.value || '').trim().toLowerCase();
        $('vaultSearchClear')?.classList.toggle('hidden', !_query);
        paintList();
    });

    $('vaultSearchClear')?.addEventListener('click', () => {
        const input = $('vaultSearch');
        if (input) { input.value = ''; input.focus(); }
        _query = '';
        $('vaultSearchClear')?.classList.add('hidden');
        paintList();
    });
}

/** Reinicia el filtro de la boveda (al abrirla o despues de guardar). */
function resetSearch() {
    _query = '';
    const input = $('vaultSearch');
    if (input) input.value = '';
    $('vaultSearchClear')?.classList.add('hidden');
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

/** Lee de IndexedDB y refresca la cache; luego repinta con el filtro activo. */
async function renderList() {
    const list = $('vaultList');
    if (!list) return;
    try {
        _chars = (await vault.getAllCharacters()) || [];
        paintList();
    } catch (err) {
        console.error('[vault] renderList', err);
        _chars = [];
        list.innerHTML = '<div class="text-center py-8 text-[#e05a5a] text-sm">Error al cargar boveda</div>';
    }
}

/** Pinta la lista aplicando el filtro de busqueda sobre la cache `_chars`. */
function paintList() {
    const list = $('vaultList'), countEl = $('vaultCount');
    if (!list) return;

    const visible = _query
        ? _chars.filter(c => searchBlob(c).toLowerCase().includes(_query))
        : _chars;

    if (countEl) countEl.textContent = _chars.length + ' personaje' + (_chars.length !== 1 ? 's' : '');

    const cnt = $('vaultSearchCount');
    if (cnt) {
        cnt.classList.toggle('hidden', !_query);
        cnt.textContent = _query ? `${visible.length} de ${_chars.length}` : '';
    }

    if (!visible.length) {
        list.innerHTML = _query
            ? '<div class="flex flex-col items-center justify-center py-12 text-center"><i class="fa-solid fa-magnifying-glass text-2xl text-text3/30 mb-3"></i><p class="text-text3 italic text-sm">Sin resultados.</p><p class="text-text3/60 text-xs mt-2">Prueba con otro termino.</p></div>'
            : '<div class="flex flex-col items-center justify-center py-12 text-center"><i class="fa-solid fa-box-open text-3xl text-text3/30 mb-3"></i><p class="text-text3 italic text-sm">La boveda esta vacia.</p><p class="text-text3/60 text-xs mt-2">Guarda tu personaje actual para verlo aqui.</p></div>';
        return;
    }

    try {
        list.innerHTML = '';
        for (const char of visible) {
            const card = document.createElement('div');
            card.className = 'flex items-center gap-3 bg-surface2/60 border border-border1 rounded-lg px-4 py-3 hover:border-border2 transition-all group';
            const d = new Date(char.savedAt);
            const dateStr = d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' });
            const timeStr = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
            const fc = countCardFields(char.card);
            const excerpt = highlight(buildExcerpt(char, _query), _query);
            card.innerHTML = `
                <div class="w-9 h-9 rounded-full bg-[radial-gradient(circle_at_50%_60%,rgba(201,168,76,0.15)_0%,transparent_70%)] border border-goldDim/40 flex items-center justify-center shrink-0"><i class="fa-solid fa-user-pen text-goldDim text-xs"></i></div>
                <div class="flex-1 min-w-0">
                    <div class="font-cinzel text-[0.72rem] tracking-wider uppercase text-text1 truncate">${highlight(char.name, _query)}</div>
                    <div class="text-[0.6rem] text-text3 font-crimson italic mt-0.5">${fc} campo${fc !== 1 ? 's' : ''} · v${char.version || 1} · ${dateStr} ${timeStr}</div>
                    ${excerpt ? `<div class="text-[0.62rem] text-text3 font-crimson mt-1 line-clamp-2">${excerpt}</div>` : ''}
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
                const res = await confirmDialog({
                    title: 'Eliminar de la boveda',
                    message: `Se eliminara "${char.name}" de la boveda de forma permanente.`,
                    okLabel: 'Eliminar',
                    danger: 'ok',
                    icon: 'fa-trash-can'
                });
                if (res !== 'ok') return;
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
        console.error('[vault] paintList', err);
        list.innerHTML = '<div class="text-center py-8 text-[#e05a5a] text-sm">Error al mostrar la boveda</div>';
    }
}

export function openVault() {
    injectModal();
    const modal = $('vaultModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    resetSearch();   // cada apertura empieza sin filtro, no con el de la vez anterior
    renderList();
    $('vaultClose')?.focus();
}

export function closeVault() {
    const modal = $('vaultModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}
