import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const elements = new Map([
    ['sysPrompt', { value: 'Protege a {{char}} y escucha a {{user}}.' }],
    ['charName', { value: 'Alice' }],
    ['userName', { value: 'Bob' }]
]);

globalThis.document = {
    getElementById(id) { return elements.get(id) || null; }
};

let clipboardText = '';
Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { async writeText(text) { clipboardText = text; } } }
});

const { default: state } = await import('../js/state.js');
const { buildExp } = await import('../js/chara-card.js');
const { copyAll } = await import('../js/export.js');

state.file.uploaded = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: { name: 'Original', description: 'Original', first_mes: 'Original greeting' }
};
state.proc.data = {};
state.characterBook = {
    present: true,
    metadata: { name: 'Mundo', description: 'Lore principal' },
    entries: [{ name: 'Norte', keys: ['reino', 'norte'], content: 'Contenido del lore.', enabled: true, insertion_order: 0, extensions: {} }]
};
state.altGreetings = {
    original: 'Saludo original',
    list: ['Saludo alternativo A', 'Saludo alternativo B'],
    current: 1
};

const beforeProcessing = buildExp();
assert.equal(beforeProcessing.data.system_prompt, 'Protege a Alice y escucha a Bob.');
assert.equal(beforeProcessing.data.description, 'Original');

state.proc.data = { description: 'Descripcion procesada', first_mes: 'Saludo seleccionado' };
const exported = buildExp();
assert.equal(exported.data.system_prompt, 'Protege a Alice y escucha a Bob.');
assert.equal(exported.data.description, 'Descripcion procesada');
assert.equal(exported.data.character_book.entries[0].content, 'Contenido del lore.');
assert.deepEqual(exported.data.alternate_greetings, ['Saludo original', 'Saludo alternativo B']);

await copyAll();
assert.match(clipboardText, /=== SYSTEM PROMPT GLOBAL ===/);
assert.match(clipboardText, /=== DESCRIPTION ===\nDescripcion procesada/);
assert.match(clipboardText, /=== LOREBOOK ===/);
assert.match(clipboardText, /Claves: reino, norte/);
assert.match(clipboardText, /Estado: Activada/);
assert.match(clipboardText, /=== SALUDOS ALTERNATIVOS ===/);
assert.match(clipboardText, /Saludo alternativo B/);

elements.get('sysPrompt').value = '';
state.proc.data.system_prompt_global = 'Prompt obsoleto';
const withoutGlobalPrompt = buildExp();
assert.equal(withoutGlobalPrompt.data.system_prompt, undefined);
await copyAll();
assert.doesNotMatch(clipboardText, /Prompt obsoleto/);

const serviceWorkerSource = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
assert.match(serviceWorkerSource, /scriptorium-v1\.2\.3/);
assert.match(serviceWorkerSource, /fetch\(request, \{ cache: 'no-store' \}\)/);
assert.doesNotMatch(serviceWorkerSource, /cache\.put\('\.\/index\.html'/);
assert.match(appSource, /controllerchange/);
assert.match(appSource, /isLocalDevelopment/);
assert.match(appSource, /renderJSONSafely\(true\)/);

console.log('Regresiones funcionales: OK');
