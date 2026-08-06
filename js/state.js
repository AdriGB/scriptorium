export const STORAGE_KEYS = {
    SIDEBAR: 'scriptorium_sidebar_collapsed',
    PROFILES: 'scriptorium_profiles',
    PROFILES_LEGACY: 'scriptorium_profile',
    TR_PRIVACY: 'scriptorium_tr_privacy_accepted'
};

export const VF = { SP: 'system_prompt_global', UP: 'mi_persona' };

export const TARGET_FIELDS = [
    'description', 'personality', 'scenario', 'first_mes',
    'mes_example', 'system_prompt', 'post_history_instructions',
    'greeting', 'char_greeting', 'world_scenario', 'example_dialogue'
];

export const V2_DATA_FIELDS = new Set([
    'description', 'personality', 'scenario', 'first_mes',
    'mes_example', 'system_prompt', 'post_history_instructions',
    'creator_notes', 'tags', 'creator', 'character_version'
]);

export const RESERVED_KEYS = new Set([
    '__proto__', 'constructor', 'prototype',
    'tostring', 'valueof', 'hasownproperty'
]);

const state = {
    file: { uploaded: null, extracted: {} },
    proc: { data: {}, edited: new Set() },
    editor: { active: false, added: new Set(), removed: new Set(), delKey: null, delTm: null },
    jsonEditor: { snap: null, dirty: false, err: null, mode: 'tree' },
    characterBook: { present: false, metadata: {}, entries: [] },
    altGreetings: { original: '', list: [], current: 0 },
    profiles: {
        active: 'default',
        lib: { default: { id: 'default', label: 'Perfil Inicial', name: '', persona: '', sp: '' } }
    },
    ui: { dCnf: false, dTm: null },
    canvas: { run: true },
    tr: { mc: null, ma: null },
    vault: { db: null, autoSaveInterval: null, dirty: false }
};

export default state;
export function getExtracted() { return state.file.extracted; }
