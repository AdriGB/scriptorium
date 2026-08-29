import state from './state.js';
import { $, showToast, copyClip } from './utils.js';
import { buildExp } from './chara-card.js';
import { injectCharaToPng } from './png-writer.js';

/* El PNG base puede venir de la carta cargada (state.file.pngFile) o de una
   seleccion manual. Sincroniza el nombre mostrado y el estado del boton. */
export function syncPngControls() {
    const picked = $('exportPngInput')?.files?.[0] || null;
    const file = picked || state.file.pngFile || null;
    const nameEl = $('exportPngName');
    const btnEl = $('exportDownloadPng');
    if (nameEl) nameEl.textContent = file ? file.name + (picked ? '' : ' · de la carta cargada') : '';
    if (btnEl) btnEl.disabled = !file;
    return file;
}

export function openExpModal() {
    $('exportJsonPreview').value = JSON.stringify(buildExp(), null, 2);
    syncPngControls();
    $('exportModal').classList.remove('hidden'); $('exportModal').classList.add('flex');
    $('exportClose').focus();
}

export function closeExpModal() {
    $('exportModal').classList.add('hidden'); $('exportModal').classList.remove('flex');
    const pngInput = $('exportPngInput');
    if (pngInput) pngInput.value = '';
    syncPngControls();
}

export async function copyAll() {
    const sections = [];
    const globalPrompt = $('sysPrompt')?.value.trim() || '';
    const charName = $('charName')?.value.trim() || '{{char}}';
    const userName = $('userName')?.value.trim() || '{{user}}';
    const hasProcessedFields = Object.keys(state.proc.data).length > 0;
    const processed = Object.fromEntries(
        Object.entries(hasProcessedFields ? state.proc.data : state.file.extracted)
            .map(([key, value]) => [key, typeof value === 'string'
                ? value.replace(/\{\{char\}\}/gi, () => charName).replace(/\{\{user\}\}/gi, () => userName)
                : value])
    );
    delete processed.system_prompt_global;

    // El prompt de la interfaz forma parte de la exportacion actual aunque aun
    // no se haya ejecutado la sustitucion visual.
    if (globalPrompt) {
        const resolvedPrompt = globalPrompt
            .replace(/\{\{char\}\}/gi, () => charName)
            .replace(/\{\{user\}\}/gi, () => userName);
        sections.push(`=== SYSTEM PROMPT GLOBAL ===\n${resolvedPrompt}`);
    }

    for (const [key, value] of Object.entries(processed)) {
        if (typeof value !== 'string' || !value.trim()) continue;
        sections.push(`=== ${key.toUpperCase().replace(/_/g, ' ')} ===\n${value}`);
    }

    if (state.characterBook.present) {
        const metadata = state.characterBook.metadata || {};
        const bookParts = [];

        if (metadata.name) bookParts.push(`Nombre: ${metadata.name}`);
        if (metadata.description) bookParts.push(`Descripción: ${metadata.description}`);

        state.characterBook.entries.forEach((entry, index) => {
            const entryParts = [`--- ENTRADA ${index + 1} ---`];
            if (entry.name) entryParts.push(`Nombre: ${entry.name}`);
            entryParts.push(`Claves: ${Array.isArray(entry.keys) && entry.keys.length ? entry.keys.join(', ') : 'Sin claves'}`);
            entryParts.push(`Estado: ${entry.enabled === false ? 'Desactivada' : 'Activada'}`);
            if (entry.comment) entryParts.push(`Comentario: ${entry.comment}`);
            if (entry.content) entryParts.push('', entry.content);
            bookParts.push(entryParts.join('\n'));
        });

        sections.push(`=== LOREBOOK ===\n${bookParts.join('\n\n')}`);
    }

    if (state.altGreetings.list.length > 0) {
        sections.push('=== SALUDOS ALTERNATIVOS ===\n' + state.altGreetings.list
            .map((greeting, index) => `--- SALUDO ${index + 1} ---\n${greeting}`)
            .join('\n\n'));
    }

    if (!sections.length) {
        showToast('No hay contenido para copiar', 'info');
        return;
    }

    const success = await copyClip(sections.join('\n\n'));
    showToast(success ? 'Contenido completo copiado' : 'No se pudo copiar', success ? 'success' : 'error');
}

export async function exportPng(basePngFile) {
    const file = basePngFile || state.file.pngFile;
    if (!file) {
        showToast('Selecciona una imagen PNG.', 'info');
        return;
    }
    try {
        const blob = await injectCharaToPng(file, buildExp());
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const cn = ($('charName')?.value || 'character').replace(/[^a-z0-9_\-]/gi, '_');
        a.download = cn + '_card.png';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('PNG generado');
    } catch (err) {
        console.error(err);
        showToast('No se pudo generar el PNG: ' + (err.message || 'Error'), 'error');
    }
}
