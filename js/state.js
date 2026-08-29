export const STORAGE_KEYS = {
    SIDEBAR: 'scriptorium_sidebar_collapsed',
    SIDEBAR_GROUPS: 'scriptorium_sidebar_groups',
    PROFILES: 'scriptorium_profiles',
    PROFILES_LEGACY: 'scriptorium_profile',
    TR_PRIVACY: 'scriptorium_tr_privacy_accepted',
    SEEN_WELCOME: 'scriptorium_seen_welcome'
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
    // pngFile: File original cuando la carta se importo desde PNG. Permite
    // reexportar sin volver a seleccionar la misma imagen. No entra en la sesion
    // del vault (storage.js solo persiste file.uploaded).
    file: { uploaded: null, extracted: {}, pngFile: null },
    // proc.collapsed: que tarjetas estan plegadas, por clave (prefijo RAW_PFX
    // para las de la vista original). Vive aqui porque cada repintado reconstruye
    // el arbol y en el DOM no queda rastro de como estaba.
    proc: { data: {}, edited: new Set(), collapsed: new Set() },
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
