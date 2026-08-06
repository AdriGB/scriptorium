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
