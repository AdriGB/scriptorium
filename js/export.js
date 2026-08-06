import state from './state.js';
import { $, showToast, copyClip } from './utils.js';
import { buildExp } from './chara-card.js';
import { injectCharaToPng } from './png-writer.js';

export function openExpModal() {
    $('exportJsonPreview').value = JSON.stringify(buildExp(), null, 2);
    $('exportModal').classList.remove('hidden'); $('exportModal').classList.add('flex');
    $('exportClose').focus();
}

export function closeExpModal() {
    $('exportModal').classList.add('hidden'); $('exportModal').classList.remove('flex');
    // Reset PNG input al cerrar
    const pngInput = $('exportPngInput');
    if (pngInput) pngInput.value = '';
    const pngName = $('exportPngName');
    if (pngName) pngName.textContent = '';
    const pngBtn = $('exportDownloadPng');
    if (pngBtn) pngBtn.disabled = true;
}

export function copyAll() {
    if (!Object.keys(state.proc.data).length) return;
    copyClip(Object.entries(state.proc.data).map(([k, v]) => '=== ' + k.toUpperCase().replace(/_/g, ' ') + ' ===\n' + v).join('\n\n'));
}

export async function exportPng(basePngFile) {
    if (!basePngFile) {
        showToast('Selecciona una imagen PNG.', 'info');
        return;
    }
    try {
        const blob = await injectCharaToPng(basePngFile, buildExp());
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