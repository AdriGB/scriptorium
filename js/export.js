import state from './state.js';
import { $, showToast, copyClip } from './utils.js';
import { buildExp } from './chara-card.js';

export function openExpModal() {
    $('exportJsonPreview').value = JSON.stringify(buildExp(), null, 2);
    $('exportModal').classList.remove('hidden'); $('exportModal').classList.add('flex');
    $('exportClose').focus();
}

export function closeExpModal() {
    $('exportModal').classList.add('hidden'); $('exportModal').classList.remove('flex');
}

export function copyAll() {
    if (!Object.keys(state.proc.data).length) return;
    copyClip(Object.entries(state.proc.data).map(([k, v]) => '=== ' + k.toUpperCase().replace(/_/g, ' ') + ' ===\n' + v).join('\n\n'));
}
