import state, { STORAGE_KEYS } from './state.js';
import { $, Storage, showToast } from './utils.js';
import { processText, updLP } from './editor.js';

const profileSelect = () => $('profileSelect');
const deleteProfileBtn = () => $('deleteProfileBtn');
const profileLabelContainer = () => $('profileLabelContainer');
const profileLabelInput = () => $('profileLabelInput');
const userNameInput = () => $('userName');
const userPersonaInput = () => $('userPersona');
const sysPromptInput = () => $('sysPrompt');

export function loadProfiles() {
    const s = Storage.get(STORAGE_KEYS.PROFILES);
    if (s && typeof s === 'object' && s.profiles && typeof s.profiles === 'object' && !Array.isArray(s.profiles)) {
        const v = {};
        for (const [k, x] of Object.entries(s.profiles)) if (x && typeof x === 'object' && x.id && x.label) v[k] = x;
        if (Object.keys(v).length) state.profiles.lib = v;
        state.profiles.active = s.activeProfileId || state.profiles.active;
    } else {
        const l = Storage.get(STORAGE_KEYS.PROFILES_LEGACY);
        if (l) {
            state.profiles.lib['default'] = { id: 'default', label: 'Tomo Inicial', name: l.userName || '', persona: l.userPersona || '', sp: l.sysPrompt || '' };
            savePrf();
        }
    }
    if (!state.profiles.lib[state.profiles.active]) {
        state.profiles.active = Object.keys(state.profiles.lib)[0] || 'default';
        if (!state.profiles.lib[state.profiles.active])
            state.profiles.lib[state.profiles.active] = { id: state.profiles.active, label: 'Perfil', name: '', persona: '', sp: '' };
    }
    renderSel();
    applyP();
}

function savePrf() { Storage.set(STORAGE_KEYS.PROFILES, { activeProfileId: state.profiles.active, profiles: state.profiles.lib }); }

export function renderSel() {
    const sel = profileSelect();
    sel.innerHTML = '';
    Object.values(state.profiles.lib).forEach(p => {
        const o = document.createElement('option'); o.value = p.id; o.textContent = p.label;
        if (p.id === state.profiles.active) o.selected = true;
        sel.appendChild(o);
    });
    deleteProfileBtn().classList.toggle('hidden', Object.keys(state.profiles.lib).length <= 1);
}

export function applyP() {
    const p = state.profiles.lib[state.profiles.active];
    if (!p) return;
    userNameInput().value = p.name || '';
    userPersonaInput().value = p.persona || '';
    sysPromptInput().value = p.sp || '';
    profileLabelInput().value = p.label || '';
    profileLabelContainer().classList.remove('hidden');
    updLP();
}

export function saveCurP() {
    const btn = $('saveProfileBtn');
    btn.disabled = true;
    const o = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin z-10"></i><span class="z-10">Guardando...</span>';
    setTimeout(() => {
        try {
            const p = state.profiles.lib[state.profiles.active];
            if (!p) return;
            p.name = userNameInput().value.trim();
            p.persona = userPersonaInput().value.trim();
            p.sp = sysPromptInput().value.trim();
            const l = profileLabelInput().value.trim();
            if (l) p.label = l;
            savePrf(); renderSel();
            showToast('Perfil "' + p.label + '" guardado');
        } catch { showToast('Error', 'error'); }
        finally { btn.disabled = false; btn.innerHTML = o; }
    }, 400);
}

export function newPrf() {
    const n = 'profile_' + (crypto.randomUUID?.() || Date.now() + '_' + Math.random().toString(36).substr(2, 9));
    state.profiles.lib[n] = { id: n, label: 'Aventurero ' + (Object.keys(state.profiles.lib).length + 1), name: '', persona: '', sp: '' };
    saveD();
    state.profiles.active = n;
    savePrf(); renderSel(); applyP();
    showToast('Perfil forjado');
}

export function rstDel() {
    state.ui.dCnf = false;
    if (state.ui.dTm) { clearTimeout(state.ui.dTm); state.ui.dTm = null; }
    deleteProfileBtn().innerHTML = '<i class="fa-solid fa-trash-can text-sm"></i>';
    deleteProfileBtn().title = 'Destruir';
}

export function delCurP() {
    if (Object.keys(state.profiles.lib).length <= 1) { showToast('Ultimo perfil', 'info'); return; }
    if (!state.ui.dCnf) {
        state.ui.dCnf = true;
        deleteProfileBtn().innerHTML = '<i class="fa-solid fa-skull text-red-500 animate-pulse text-sm"></i>';
        showToast('Pulsa de nuevo');
        state.ui.dTm = setTimeout(rstDel, 3000);
    } else {
        clearTimeout(state.ui.dTm); state.ui.dTm = null; state.ui.dCnf = false;
        deleteProfileBtn().innerHTML = '<i class="fa-solid fa-trash-can text-sm"></i>';
        const l = state.profiles.lib[state.profiles.active]?.label || '';
        delete state.profiles.lib[state.profiles.active];
        state.profiles.active = Object.keys(state.profiles.lib)[0];
        savePrf(); renderSel(); applyP();
        showToast('"' + l + '" desintegrado');
    }
}

export function chgP(e) {
    saveD();
    state.profiles.active = e.target.value;
    applyP();
    if (Object.keys(state.file.extracted).length > 0) processText();
}

export function saveD() {
    const p = state.profiles.lib[state.profiles.active];
    if (!p) return;
    p.name = userNameInput().value.trim();
    p.persona = userPersonaInput().value.trim();
    p.sp = sysPromptInput().value.trim();
    const l = profileLabelInput().value.trim();
    if (l) p.label = l;
}

export function updLbl() {
    const p = state.profiles.lib[state.profiles.active], v = profileLabelInput().value.trim();
    if (p && v) {
        p.label = v;
        const o = profileSelect().querySelector('[value="' + state.profiles.active + '"]');
        if (o) o.textContent = v;
    }
}

/* ─── Profile file export/import ─── */

function sanitizeFilename(value) {
    return String(value || 'aventurero')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9_-]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || 'aventurero';
}

function getCurrentProfileSnapshot() {
    saveD();
    const profile = state.profiles.lib[state.profiles.active];
    if (!profile) throw new Error('No hay un perfil activo');
    return {
        id: profile.id,
        label: profile.label || 'Aventurero',
        name: profile.name || '',
        persona: profile.persona || '',
        sp: profile.sp || ''
    };
}

export function exportCurrentProfile() {
    try {
        const profile = getCurrentProfileSnapshot();
        const documentData = {
            _format: 'scriptorium_profile',
            _version: 1,
            exportedAt: new Date().toISOString(),
            profile
        };
        const blob = new Blob(
            [JSON.stringify(documentData, null, 2)],
            { type: 'application/json' }
        );
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = sanitizeFilename(profile.label) + '.scriptorium-profile';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('Perfil "' + profile.label + '" exportado');
    } catch (error) {
        console.error('[Profiles] export', error);
        showToast('No se pudo exportar el perfil', 'error');
    }
}

function validateImportedProfile(value) {
    if (!value || typeof value !== 'object') throw new Error('Perfil invalido');
    const label = String(value.label || '').trim().slice(0, 120);
    const name = String(value.name || '').trim().slice(0, 200);
    const persona = String(value.persona || '');
    const sp = String(value.sp || '');
    if (!label) throw new Error('El perfil no tiene nombre');
    if (persona.length > 500_000 || sp.length > 500_000) throw new Error('El perfil es demasiado grande');
    return { label, name, persona, sp };
}

export async function importProfileFile(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast('El archivo supera los 2 MB', 'error'); return; }
    try {
        const text = await file.text();
        const documentData = JSON.parse(text);
        if (documentData._format !== 'scriptorium_profile' || documentData._version !== 1) {
            throw new Error('Formato de perfil no reconocido');
        }
        const imported = validateImportedProfile(documentData.profile);
        saveD();
        const id = 'profile_' + (crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`);
        state.profiles.lib[id] = { id, ...imported };
        state.profiles.active = id;
        savePrf(); renderSel(); applyP();
        showToast('Perfil "' + imported.label + '" importado');
    } catch (error) {
        console.error('[Profiles] import', error);
        showToast(
            error instanceof SyntaxError
                ? 'El archivo no contiene JSON valido'
                : error.message || 'No se pudo importar',
            'error'
        );
    }
}

export async function importProfilesBundle(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast('Archivo muy grande', 'error'); return; }
    try {
        const text = await file.text();
        const bundle = JSON.parse(text);
        if (
            (bundle._type !== 'scriptorium_profiles_bundle' && bundle._format !== 'scriptorium_profiles_bundle') ||
            !Array.isArray(bundle.profiles) ||
            bundle.profiles.length === 0
        ) {
            throw new Error('Formato de lote invalido');
        }
        if (bundle._version !== 1) throw new Error('Version de lote no soportada: ' + (bundle._version || '?'));
        saveD();
        let imported = 0;
        let firstImportedId = null;
        for (const item of bundle.profiles) {
            try {
                const validated = validateImportedProfile(item);
                const id = 'profile_' + (crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`);
                state.profiles.lib[id] = { id, ...validated };
                if (!firstImportedId) firstImportedId = id;
                imported++;
            } catch { continue; }
        }
        if (imported === 0) throw new Error('Ningun perfil valido en el lote');
        if (firstImportedId) state.profiles.active = firstImportedId;
        savePrf(); renderSel(); applyP();
        showToast('Lote importado: ' + imported + ' perfil(es)');
    } catch (error) {
        console.error('[Profiles] import bundle', error);
        showToast(error.message || 'No se pudo importar', 'error');
    }
}

export function exportAllProfiles() {
    try {
        saveD();
        const bundle = {
            _type: 'scriptorium_profiles_bundle',
            _version: 1,
            exportedAt: new Date().toISOString(),
            profileCount: Object.keys(state.profiles.lib).length,
            profiles: Object.values(state.profiles.lib).map(p => ({
                label: p.label || 'Aventurero',
                name: p.name || '',
                persona: p.persona || '',
                sp: p.sp || ''
            }))
        };
        const blob = new Blob(
            [JSON.stringify(bundle, null, 2)],
            { type: 'application/json' }
        );
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'scriptorium_perfiles.scriptorium-profiles';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast(bundle.profileCount + ' perfil(es) exportado(s)');
    } catch (error) {
        console.error('[Profiles] export all', error);
        showToast('No se pudieron exportar los perfiles', 'error');
    }
}
