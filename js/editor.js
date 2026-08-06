import state, { VF, getExtracted, RESERVED_KEYS } from './state.js';
import { $, deepClone, showToast, copyClip, sanitizeKey, isValidKey } from './utils.js';
import { extractFields, buildExp, findCardByKey } from './chara-card.js';
import { trText, checkTranslationPrivacy } from './translator.js';

/* ─── Cached DOM ─── */
const charNameInput = () => $('charName');
const userNameInput = () => $('userName');
const processedView = () => $('processedView');
const rawView = () => $('rawView');
const processedCount = () => $('processedCount');
const rawCount = () => $('rawCount');
const processBtn = () => $('processBtn');
const fabContainer = () => $('fabContainer');

function setProcessedCount(value) {
    processedCount().textContent = value;
    const status = $('statusFields');
    if (status) status.textContent = value + ' campos';
}

/* ─── Helpers ─── */
export function fIcon(k) {
    const l = k.toLowerCase();
    if (l.includes('description')) return 'fa-user-large';
    if (l.includes('personality')) return 'fa-masks-theater';
    if (l.includes('scenario')) return 'fa-mountain-sun';
    if (l.includes('greeting') || l.includes('first_mes')) return 'fa-hand-sparkles';
    if (l.includes('example')) return 'fa-comments';
    if (l.includes('system_prompt') || k === VF.SP) return 'fa-terminal';
    if (l.includes('post_history')) return 'fa-clock-rotate-left';
    if (k === VF.UP) return 'fa-user-shield';
    return 'fa-bookmark';
}

export function updLP() {
    const cn = charNameInput().value.trim(), cp = $('charPreview');
    if (cn) { $('charBadge').textContent = cn + ' = {{char}}'; cp.classList.remove('hidden'); cp.classList.add('flex'); }
    else cp.classList.add('hidden');
    const un = userNameInput().value.trim(), up = $('userPreview');
    if (un) { $('userBadge').textContent = un + ' = {{user}}'; up.classList.remove('hidden'); up.classList.add('flex'); }
    else up.classList.add('hidden');
}

/* ─── Delete confirmation ─── */
export function clearFDC() {
    if (state.editor.delTm) { clearTimeout(state.editor.delTm); state.editor.delTm = null; }
    if (state.editor.delKey) {
        const prev = findCardByKey(state.editor.delKey);
        if (prev) {
            const b = prev.querySelector('.editor-ctrl-btn.del');
            if (b) { b.dataset.cf = '0'; b.innerHTML = '<i class="fa-solid fa-xmark"></i>'; b.style.color = ''; }
        }
        state.editor.delKey = null;
    }
}

export function reqDel(key) {
    if (state.editor.delKey === key) { clearFDC(); deleteField(key); }
    else {
        clearFDC(); state.editor.delKey = key;
        const card = findCardByKey(key);
        if (card) { const b = card.querySelector('.editor-ctrl-btn.del'); if (b) { b.dataset.cf = '1'; b.innerHTML = '<i class="fa-solid fa-skull"></i>'; b.style.color = '#e05a5a'; } }
        showToast('Pulsa de nuevo', 'info');
        state.editor.delTm = setTimeout(clearFDC, 2500);
    }
}

/* ─── Reset state ─── */
export function resetCardState() {
    clearFDC();
    state.proc.data = {};
    state.proc.edited.clear();
    state.editor.added.clear();
    state.editor.removed.clear();
    state.file.extracted = {};
    state.jsonEditor.snap = null;
    state.jsonEditor.dirty = false;
    state.jsonEditor.err = null;
    state.characterBook.entries = [];
    state.characterBook.present = false;
    state.characterBook.metadata = {};
    state.altGreetings.original = '';
    state.altGreetings.list = [];
    state.altGreetings.current = 0;
}

/* ─── Create card ─── */
export function createCard(key, text, isRaw) {
    const card = document.createElement('div');
    card.className = 'field-card bg-surface border border-border1 rounded-xl overflow-hidden mb-4 transition-all duration-300 hover:border-border2 hover:shadow-[0_4px_20px_rgba(0,0,0,0.4)] animate-fade-in-up';
    card.dataset.key = key;

    const head = document.createElement('div');
    head.className = 'field-card-head flex items-center px-4 py-3 bg-gradient-to-r from-[#12142a] to-[#0e1025] border-b border-border1 gap-3 cursor-pointer select-none';
    head.tabIndex = 0; head.setAttribute('role', 'button'); head.setAttribute('aria-expanded', 'true');

    const tEl = document.createElement('div');
    tEl.className = 'font-cinzel text-[0.68rem] tracking-widest uppercase text-gold flex-1 flex items-center gap-2 min-w-0';
    const fI = document.createElement('i'); fI.className = 'fa-solid ' + fIcon(key) + ' text-goldDim text-[0.7rem] shrink-0';
    const tT = document.createElement('span'); tT.className = 'truncate'; tT.textContent = key.replace(/_/g, ' ').replace(/\./g, ' › ');
    tEl.append(fI, tT);

    const cc = document.createElement('span'); cc.className = 'text-[0.65rem] text-text3 font-crimson italic'; cc.textContent = text.length + ' chars';
    const tg = document.createElement('i'); tg.className = 'fa-solid fa-chevron-down text-text3 text-[0.7rem] transition-transform duration-300';
    head.append(tEl, cc, tg);

    const body = document.createElement('div'); body.className = 'field-card-body px-5 py-4'; body.style.overflow = 'hidden';

    const togC = () => {
        const c = !card.classList.contains('collapsed');
        if (c) { body.style.maxHeight = body.scrollHeight + 'px'; requestAnimationFrame(() => { card.classList.add('collapsed'); body.style.maxHeight = '0px'; }); }
        else { card.classList.remove('collapsed'); body.style.maxHeight = body.scrollHeight + 'px'; body.addEventListener('transitionend', function oe(e) { if (e.propertyName === 'max-height') { body.style.maxHeight = 'none'; body.removeEventListener('transitionend', oe); } }); }
        head.setAttribute('aria-expanded', String(!c));
    };
    head.addEventListener('click', e => { if (e.target.closest('.editor-field-name') || e.target.closest('.editor-ctrl-btn')) return; togC(); });
    head.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togC(); } });

    const ce = document.createElement('div');
    if (isRaw) {
        ce.className = 'font-crimson text-[0.95rem] text-text2 whitespace-pre-wrap leading-[1.7]';
        const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        ce.innerHTML = esc(text).replace(/\{\{char\}\}/gi, '<span class="tag-char">{{char}}</span>').replace(/\{\{user\}\}/gi, '<span class="tag-user">{{user}}</span>');
    } else {
        ce.className = 'font-crimson text-base text-text1 whitespace-pre-wrap leading-[1.7] outline-none border border-transparent rounded-lg p-2 -mx-2 transition-colors hover:bg-surface2 focus:bg-[#14162a] focus:border-border2 min-h-[2rem]';
        ce.contentEditable = 'true'; ce.textContent = text;
    }

    let tC = null, tA = null;
    const tB = document.createElement('div'); tB.className = 'hidden mt-3 pt-3 border-t border-dashed border-violetDim/50';
    const tL = document.createElement('p'); tL.className = 'text-[0.6rem] font-cinzel tracking-widest uppercase text-violet2 mb-1.5';
    tL.innerHTML = '<i class="fa-solid fa-language"></i> Traduccion';
    const tX = document.createElement('div'); tX.className = 'font-crimson text-base text-text2 italic whitespace-pre-wrap leading-[1.7]';
    tB.append(tL, tX);

    if (!isRaw) ce.addEventListener('input', e => {
        state.proc.data[key] = e.target.innerText;
        cc.textContent = e.target.innerText.length + ' chars';
        state.proc.edited.add(key);
        state.vault.dirty = true;
        tC = null; tB.classList.add('hidden');
        if (tA) { tA.abort(); tA = null; }
    });

    const acts = document.createElement('div'); acts.className = 'flex gap-2 mt-4 pt-3 border-t border-border1';
    const mkB = (icon, label, cls = '') => {
        const b = document.createElement('button');
        b.className = 'font-cinzel text-[0.6rem] tracking-[0.12em] uppercase text-text3 hover:text-text1 bg-transparent hover:bg-surface2 border border-border1 hover:border-border2 active:scale-95 rounded-md px-3 py-1.5 transition-all flex items-center gap-1.5 ' + cls;
        b.innerHTML = icon + ' ' + label; return b;
    };

    const eB = mkB('<i class="fa-solid fa-expand"></i>', 'Expandir');
    eB.addEventListener('click', () => openExp(key, tT.textContent, fI.className, isRaw, ce, cc));

    const trB = mkB('<i class="fa-solid fa-language"></i>', 'Traducir', 'hover:text-violet2 hover:border-violetDim');
    trB.addEventListener('click', async () => {
        if (!tB.classList.contains('hidden')) { tB.classList.add('hidden'); return; }
        const src = isRaw ? text : (state.proc.data[key] ?? ce.innerText);
        if (!src.trim()) { showToast('Sin texto', 'info'); return; }
        const ok = await checkTranslationPrivacy();
        if (!ok) return;
        tB.classList.remove('hidden');
        if (tC !== null) { tX.textContent = tC; return; }
        trB.disabled = true;
        if (tA) tA.abort();
        tA = new AbortController();
        tX.innerHTML = '<span class="text-violet2 text-xs italic">Traduciendo...</span>';
        try {
            tC = await trText(src, 'es', tA.signal, (cur, tot) => {
                const prog = tX.querySelector('span');
                if (prog) prog.textContent = tot > 1 ? `Traduciendo fragmento ${cur} de ${tot}...` : 'Traduciendo...';
            });
            tX.textContent = tC || '(vacio)';
        } catch (err) { if (err.name === 'AbortError') return; tB.classList.add('hidden'); showToast('Error', 'error'); }
        finally { trB.disabled = false; }
    });

    const cB = mkB('<i class="fa-regular fa-copy"></i>', 'Copiar');
    cB.addEventListener('click', () => copyClip(isRaw ? text : (state.proc.data[key] ?? ce.innerText)));

    if (!isRaw) {
        if (state.editor.added.has(key)) {
            const d = mkB('<i class="fa-solid fa-trash-can"></i>', 'Eliminar', 'hover:text-[#e05a5a] hover:border-[#502020]');
            d.addEventListener('click', () => deleteField(key)); acts.append(d);
        } else {
            const r = mkB('<i class="fa-solid fa-rotate-left"></i>', 'Restaurar');
            r.addEventListener('click', () => {
                const o = getExtracted()[key] || (key === VF.SP ? $('sysPrompt').value : (key === VF.UP ? $('userPersona').value : ''));
                const cn = charNameInput().value.trim() || '{{char}}', un = userNameInput().value.trim() || '{{user}}';
                const res = (o || '').replace(/\{\{char\}\}/gi, () => cn).replace(/\{\{user\}\}/gi, () => un);
                ce.textContent = res; state.proc.data[key] = res; state.proc.edited.delete(key);
                cc.textContent = res.length + ' chars'; tC = null; tB.classList.add('hidden');
                state.vault.dirty = true;
                if (tA) { tA.abort(); tA = null; }
                showToast('Restaurado');
            });
            acts.append(r);
        }
    }

    acts.append(eB, trB, cB);
    body.append(ce, acts, tB);
    card.append(head, body);
    return card;
}

/* ─── Render ─── */
export function renderRaw() {
    const rv = rawView();
    rv.innerHTML = '<p class="text-[0.78rem] text-text3 italic mb-4 px-1">Plantilla: <span class="tag-char">{{char}}</span> y <span class="tag-user">{{user}}</span></p>';
    Object.entries(getExtracted()).forEach(([k, v]) => rv.appendChild(createCard(k, v, true)));
}

export function renderProc() {
    clearFDC();
    const entries = Object.entries(state.proc.data);
    const pv = processedView();
    pv.innerHTML = '';
    if (entries.length === 0 && !state.editor.active) {
        pv.innerHTML = '<div class="flex flex-col items-center justify-center h-full min-h-[40vh] text-center px-4"><div class="text-5xl opacity-20 font-cinzelDeco text-text3 mb-4">&#5765;</div><p class="text-text3 italic max-w-sm text-sm">Las paginas aguardan.</p></div>';
        updFab(); updLorebookCount(); return;
    }
    const h = document.createElement('p');
    h.className = 'text-[0.72rem] text-text3 italic mb-4 px-1 flex items-center gap-2';
    h.innerHTML = state.editor.active
        ? '<i class="fa-solid fa-pen-ruler text-editor"></i> Editor activo.'
        : '<i class="fa-solid fa-pen-to-square"></i> Clica para editar.';
    pv.appendChild(h);
    entries.forEach(([k, v], i) => { const c = createCard(k, v, false); c.style.animationDelay = i * 0.05 + 's'; pv.appendChild(c); });
    if (state.editor.active) {
        decorateEd();
        const ab = document.createElement('button');
        ab.className = 'add-field-btn w-full flex items-center justify-center gap-3 py-6 text-text3 hover:text-editor transition-all animate-fade-in-up';
        ab.style.animationDelay = entries.length * 0.05 + 's';
        ab.innerHTML = '<i class="fa-solid fa-plus text-lg"></i> <span class="font-cinzel text-[0.7rem] tracking-[0.15em] uppercase">Agregar Campo</span>';
        ab.addEventListener('click', openAddF);
        pv.appendChild(ab);
    }
    // Alt greetings decoration
    if (state.altGreetings.list.length > 0) decorateAltGreetings();
    updFab();
    updLorebookCount();
}

/* ─── Editor decorations ─── */
export function decorateEd() {
    processedView().querySelectorAll('.field-card').forEach(card => {
        const key = card.dataset.key;
        if (!key) return;
        card.classList.add('editor-card');
        const head = card.querySelector('.field-card-head');
        if (!head) return;
        const tc = head.querySelector('.font-cinzel');
        if (tc) {
            const sp = tc.querySelector('span.truncate');
            if (sp) {
                const inp = document.createElement('input');
                inp.type = 'text'; inp.className = 'editor-field-name'; inp.value = key; inp.title = 'Renombrar';
                inp.addEventListener('focus', e => e.stopPropagation());
                inp.addEventListener('click', e => e.stopPropagation());
                inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = key; inp.blur(); } });
                inp.addEventListener('blur', () => { if (inp.value.trim() && inp.value !== key) renameField(key, inp.value); });
                sp.replaceWith(inp);
            }
        }
        const ctrl = document.createElement('div'); ctrl.className = 'editor-controls flex items-center gap-0.5 ml-1';
        const mkC = (i, c, t) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'editor-ctrl-btn ' + (c || ''); b.innerHTML = '<i class="fa-solid ' + i + '"></i>'; b.title = t; return b; };
        const u = mkC('fa-caret-up', '', 'Arriba'); u.addEventListener('click', e => { e.stopPropagation(); movField(key, -1); });
        const d = mkC('fa-caret-down', '', 'Abajo'); d.addEventListener('click', e => { e.stopPropagation(); movField(key, 1); });
        const dl = mkC('fa-xmark', 'del', 'Eliminar'); dl.addEventListener('click', e => { e.stopPropagation(); reqDel(key); });
        ctrl.append(u, d, dl);
        const ch = head.querySelector('.fa-chevron-down');
        if (ch) ch.after(ctrl); else head.appendChild(ctrl);
    });
}

/* ─── Field operations ─── */
export function movField(key, dir) {
    const e = Object.entries(state.proc.data), i = e.findIndex(([k]) => k === key);
    if (i === -1) return;
    const ni = i + dir;
    if (ni < 0 || ni >= e.length) return;
    [e[i], e[ni]] = [e[ni], e[i]];
    state.proc.data = Object.fromEntries(e);
    state.vault.dirty = true;
    renderProc();
}

export function addField(key, val) {
    state.proc.data[key] = val;
    state.proc.edited.add(key); state.editor.added.add(key); state.editor.removed.delete(key);
    state.vault.dirty = true;
    setProcessedCount(Object.keys(state.proc.data).length);
    renderProc();
}

export function deleteField(key) {
    delete state.proc.data[key];
    state.proc.edited.delete(key);
    if (state.editor.added.has(key)) state.editor.added.delete(key);
    else state.editor.removed.add(key);
    delete getExtracted()[key];
    state.vault.dirty = true;
    setProcessedCount(Object.keys(state.proc.data).length);
    renderProc(); updFab();
    showToast('"' + key + '" eliminado', 'info');
}

export function renameField(oldKey, newName) {
    const nk = sanitizeKey(newName);
    if (!isValidKey(nk, oldKey)) {
        if (nk === oldKey) return;
        showToast(RESERVED_KEYS.has(nk) ? 'Nombre reservado' : 'Nombre invalido', 'error');
        renderProc(); return;
    }
    if (state.proc.data[nk] !== undefined) { showToast('Ya existe "' + nk + '"', 'error'); renderProc(); return; }
    const e = Object.entries(state.proc.data), i = e.findIndex(([k]) => k === oldKey);
    if (i === -1) return;
    e[i] = [nk, e[i][1]];
    state.proc.data = Object.fromEntries(e);
    if (state.proc.edited.has(oldKey)) { state.proc.edited.delete(oldKey); state.proc.edited.add(nk); }
    if (state.editor.added.has(oldKey)) { state.editor.added.delete(oldKey); state.editor.added.add(nk); }
    else state.editor.removed.add(oldKey);
    if (getExtracted()[oldKey] !== undefined) { getExtracted()[nk] = getExtracted()[oldKey]; delete getExtracted()[oldKey]; }
    state.vault.dirty = true;
    renderProc();
    showToast('Renombrado a "' + nk + '"');
}

/* ─── Process text ─── */
export function processText() {
    if (!Object.keys(getExtracted()).length && !$('sysPrompt').value.trim() && !state.characterBook.present) return;
    const cn = charNameInput().value.trim() || '{{char}}', un = userNameInput().value.trim() || '{{user}}',
        persona = $('userPersona').value.trim(), sp = $('sysPrompt').value.trim(),
        cR = /\{\{char\}\}/gi, uR = /\{\{user\}\}/gi;
    const prev = { ...state.proc.data };
    state.proc.data = {};
    if (sp) {
        const k = VF.SP;
        state.proc.data[k] = state.proc.edited.has(k) && prev[k] ? prev[k] : sp.replace(cR, () => cn).replace(uR, () => un);
    }
    const allGreetings = [state.altGreetings.original, ...state.altGreetings.list];
    for (const [k, v] of Object.entries(getExtracted())) {
        let rawValue = v;
        if (k === 'first_mes' && state.altGreetings.list.length > 0) {
            const idx = state.altGreetings.current;
            if (idx > 0 && idx < allGreetings.length) rawValue = allGreetings[idx];
        }
        state.proc.data[k] = state.proc.edited.has(k) && prev[k] !== undefined ? prev[k] : rawValue.replace(cR, () => cn).replace(uR, () => un);
    }
    if (persona) {
        const k = VF.UP;
        state.proc.data[k] = state.proc.edited.has(k) && prev[k] ? prev[k] : persona.replace(cR, () => cn).replace(uR, () => un);
    }
    for (const ek of state.editor.added) if (prev[ek] !== undefined && state.proc.data[ek] === undefined) state.proc.data[ek] = prev[ek];
    setProcessedCount(Object.keys(state.proc.data).length);
    state.vault.dirty = true;
    renderProc();
    $('tabProcessed').click();
    showToast('Ritual completado');
}

/* ─── Toggle editor ─── */
export function togEd() {
    state.editor.active = !state.editor.active;
    $('editorToggle').classList.toggle('active', state.editor.active);
    $('editorToggle').setAttribute('aria-pressed', String(state.editor.active));
    $('editorInfoBar').classList.toggle('hidden', !state.editor.active);
    if (state.editor.active && processedView().classList.contains('hidden') && $('lorebookView')?.classList.contains('hidden')) $('tabProcessed').click();
    if (Object.keys(state.proc.data).length > 0 || state.editor.active) renderProc();
    if (!$('lorebookView')?.classList.contains('hidden')) renderLorebook();
    updFab();
    showToast(state.editor.active ? 'Editor activado' : 'Editor desactivado', 'info');
}

/* ─── FAB ─── */
export function updFab() {
    const hasContent = Boolean(state.file.uploaded) && (
        Object.keys(state.proc.data).length > 0 ||
        Object.keys(getExtracted()).length > 0 ||
        state.characterBook.present
    );
    fabContainer().classList.toggle('hidden', !hasContent);
}

/* ─── Expand modal ─── */
function wci(t) { const w = t.trim() ? t.trim().split(/\s+/).length : 0; return t.length + ' chars · ' + w + ' palabras'; }

export function openExp(key, label, cls, isRaw, ce, cc) {
    $('expandModalTranslation').classList.add('hidden');
    state.tr.mc = null;
    $('expandModalTitle').textContent = label;
    $('expandModalIcon').className = cls;
    const cur = ce.innerText;
    $('expandModalContent').textContent = cur;
    $('expandModalCount').textContent = wci(cur);
    if (isRaw) {
        $('expandModalContent').contentEditable = 'false';
        $('expandModalContent').className = 'font-crimson text-base text-text1 whitespace-pre-wrap leading-[1.8] outline-none min-h-[30vh]';
        $('expandModalHint').textContent = 'Solo lectura.';
    } else {
        $('expandModalContent').contentEditable = 'true';
        $('expandModalContent').className = 'font-crimson text-base text-text1 whitespace-pre-wrap leading-[1.8] outline-none min-h-[30vh] focus:bg-[#14162a] rounded-lg p-2 -m-2';
        $('expandModalHint').innerHTML = '<i class="fa-solid fa-circle-info mr-1"></i> Cambios instantaneos.';
        $('expandModalContent').oninput = () => {
            const v = $('expandModalContent').innerText;
            ce.textContent = v; state.proc.data[key] = v; state.proc.edited.add(key);
            cc.textContent = v.length + ' chars'; $('expandModalCount').textContent = wci(v);
            state.tr.mc = null; $('expandModalTranslation').classList.add('hidden');
            state.vault.dirty = true;
        };
    }
    $('expandModal').classList.remove('hidden'); $('expandModal').classList.add('flex');
    if (isRaw) $('expandModalClose').focus(); else $('expandModalContent').focus();
}

export function closeExp() {
    $('expandModal').classList.add('hidden'); $('expandModal').classList.remove('flex');
    $('expandModalContent').contentEditable = 'false'; $('expandModalContent').oninput = null;
    $('expandModalTranslation').classList.add('hidden'); state.tr.mc = null;
    if (state.tr.ma) { state.tr.ma.abort(); state.tr.ma = null; }
}

/* ─── Add field modal ─── */
export function openAddF() {
    $('addFieldPreset').value = ''; $('addFieldKey').value = ''; $('addFieldValue').value = '';
    $('addFieldKey').disabled = false; $('addFieldError').classList.add('hidden');
    $('addFieldModal').classList.remove('hidden'); $('addFieldModal').classList.add('flex');
    $('addFieldPreset').focus();
}

export function closeAddF() {
    $('addFieldModal').classList.add('hidden'); $('addFieldModal').classList.remove('flex');
}

/* ─── JSON editor ─── */
export function renderJSON() {
    const jeE = $('jsonEditorEmpty'), jeA = $('jsonEditorActive');
    if (!state.file.uploaded) { jeE.classList.remove('hidden'); jeA.classList.add('hidden'); return; }
    jeE.classList.add('hidden'); jeA.classList.remove('hidden');
    const cur = buildExp();
    $('jsonEditorTextarea').value = JSON.stringify(cur, null, 2);
    state.jsonEditor.snap = deepClone(cur);
    state.jsonEditor.dirty = false;
    updJS();
    setJsonMode(state.jsonEditor.mode || 'tree');
}

function appendTreeNode(parent, key, value, depth = 0) {
    const isContainer = value !== null && typeof value === 'object';
    if (isContainer) {
        const details = document.createElement('details');
        details.className = 'json-tree-branch';
        details.open = depth < 2;

        const summary = document.createElement('summary');
        const keyEl = document.createElement('span');
        keyEl.className = 'json-tree-key';
        keyEl.textContent = key;
        const count = document.createElement('span');
        count.className = 'json-tree-count';
        const keys = Object.keys(value);
        count.textContent = Array.isArray(value) ? `[${keys.length}]` : `{${keys.length}}`;
        summary.append(keyEl, count);

        const children = document.createElement('div');
        children.className = 'json-tree-children';
        keys.forEach(childKey => appendTreeNode(children, childKey, value[childKey], depth + 1));
        details.append(summary, children);
        parent.appendChild(details);
        return;
    }

    const row = document.createElement('div');
    row.className = 'json-tree-leaf';
    const keyEl = document.createElement('span');
    keyEl.className = 'json-tree-key';
    keyEl.textContent = key;
    const valueEl = document.createElement('span');
    const type = value === null ? 'null' : typeof value;
    valueEl.className = `json-tree-value json-tree-${type}`;
    valueEl.textContent = type === 'string' ? JSON.stringify(value) : String(value);
    row.append(keyEl, valueEl);
    parent.appendChild(row);
}

export function renderJSONTree() {
    const tree = $('jsonTreeView');
    if (!tree) return false;
    let parsed;
    try {
        parsed = JSON.parse($('jsonEditorTextarea').value);
    } catch {
        showToast('Corrige el JSON antes de abrir el arbol', 'error');
        return false;
    }
    tree.replaceChildren();
    const root = document.createElement('div');
    root.className = 'json-tree-root';
    if (parsed !== null && typeof parsed === 'object') {
        Object.keys(parsed).forEach(key => appendTreeNode(root, key, parsed[key], 0));
    } else {
        appendTreeNode(root, 'valor', parsed, 0);
    }
    tree.appendChild(root);
    return true;
}

export function setJsonMode(mode) {
    const next = mode === 'code' ? 'code' : 'tree';
    if (next === 'tree' && !renderJSONTree()) return false;
    state.jsonEditor.mode = next;
    $('jsonTreeView')?.classList.toggle('hidden', next !== 'tree');
    $('jsonRawView')?.classList.toggle('hidden', next !== 'code');
    $('jsonCodeActions')?.classList.toggle('hidden', next !== 'code');
    const treeBtn = $('jsonTreeModeBtn'), rawBtn = $('jsonRawModeBtn');
    treeBtn?.setAttribute('aria-pressed', String(next === 'tree'));
    rawBtn?.setAttribute('aria-pressed', String(next === 'code'));
    treeBtn?.classList.toggle('active', next === 'tree');
    rawBtn?.classList.toggle('active', next === 'code');
    return true;
}

export function updJS() {
    const t = $('jsonEditorTextarea').value;
    $('jsonStatusSize').textContent = (new TextEncoder().encode(t).length / 1024).toFixed(1) + ' KB';
    try {
        const p = JSON.parse(t);
        state.jsonEditor.err = null;
        $('jsonStatusLine').innerHTML = '<i class="fa-solid fa-circle-check text-[0.5rem]"></i> JSON valido';
        $('jsonStatusLine').className = 'text-editor flex items-center gap-1.5';
        $('jsonStatusFields').textContent = countObjFieldsLocal(p) + ' campo(s)';
        $('jsonStatusBar').classList.remove('has-error');
        $('jsonEditorTextarea').classList.remove('has-error');
        $('jsonApplyBtn').disabled = false;
        const sn = state.jsonEditor.snap ? JSON.stringify(state.jsonEditor.snap, null, 2) : '';
        state.jsonEditor.dirty = t !== sn;
        $('jsonEditorTextarea').classList.toggle('is-dirty', state.jsonEditor.dirty);
        $('jsonDirtyBadge').classList.toggle('hidden', !state.jsonEditor.dirty);
    } catch (err) {
        state.jsonEditor.err = err;
        const m = err.message.match(/position\s+(\d+)/);
        let pos = '';
        if (m) { const l = (t.substring(0, parseInt(m[1])).match(/\n/g) || []).length + 1; pos = ' (l' + l + ')'; }
        $('jsonStatusLine').innerHTML = '<i class="fa-solid fa-circle-exclamation text-[0.5rem]"></i> Error' + pos;
        $('jsonStatusLine').className = 'text-[#e05a5a] flex items-center gap-1.5';
        $('jsonStatusFields').textContent = '';
        $('jsonStatusBar').classList.add('has-error');
        $('jsonEditorTextarea').classList.add('has-error');
        $('jsonApplyBtn').disabled = true;
        $('jsonDirtyBadge').classList.toggle('hidden', t === (state.jsonEditor.snap ? JSON.stringify(state.jsonEditor.snap, null, 2) : ''));
    }
}

function countObjFieldsLocal(o) {
    let c = 0;
    (function w(x) { for (const k in x) { if (!Object.prototype.hasOwnProperty.call(x, k)) continue; if (typeof x[k] === 'object' && x[k] !== null) w(x[k]); else if (typeof x[k] === 'string' && x[k].trim()) c++; } })(o);
    return c;
}

export function applyJE() {
    try {
        const parsed = JSON.parse($('jsonEditorTextarea').value);
        if (Object.keys(state.proc.data).length > 0) {
            const hasEdits = state.proc.edited.size > 0 || state.editor.added.size > 0;
            if (hasEdits) { if (!confirm('Hay ediciones visuales activas.\n\nAplicar el JSON reemplazara todo el estado actual.\nContinuar?')) return; }
        }
        state.file.uploaded = parsed;
        resetCardState();
        state.jsonEditor.snap = deepClone(parsed);
        const dup = extractFields(parsed), count = Object.keys(getExtracted()).length;
        const nm = parsed.name || parsed.data?.name || parsed.char_name || '';
        if (nm) { charNameInput().value = nm; updLP(); }
        rawCount().textContent = count;
        renderRaw(); renderJSON();
        const hasContent = count > 0 || state.characterBook.present;
        processBtn().disabled = !hasContent;
        if (count > 0 && (userNameInput().value.trim() || $('sysPrompt').value.trim())) processText();
        else { updJS(); updLorebookCount(); showToast(hasContent ? 'Aplicado: ' + count + ' campo(s)' : 'Aplicado', 'info'); }
        state.vault.dirty = true;
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

/* ═══════════════════════════════════════════════════
   ALTERNATE GREETINGS
   ═══════════════════════════════════════════════════ */

function getAllGreetings() {
    return [state.altGreetings.original, ...state.altGreetings.list];
}

function swapAltGreeting(newIndex) {
    const all = getAllGreetings();
    if (newIndex < 0 || newIndex >= all.length) return;
    state.altGreetings.current = newIndex;
    const cn = charNameInput().value.trim() || '{{char}}';
    const un = userNameInput().value.trim() || '{{user}}';
    const processed = all[newIndex].replace(/\{\{char\}\}/gi, () => cn).replace(/\{\{user\}\}/gi, () => un);
    state.proc.data['first_mes'] = processed;
    state.vault.dirty = true;

    const card = findCardByKey('first_mes');
    if (card) {
        const contentEl = card.querySelector('.field-card-body [contenteditable]');
        if (contentEl) contentEl.textContent = processed;
        const countEl = card.querySelector('.field-card-head .font-crimson');
        if (countEl) countEl.textContent = processed.length + ' chars';
    }
    updateAltGreetingNav();
}

function updateAltGreetingNav() {
    const nav = processedView()?.querySelector('.alt-greeting-nav');
    if (!nav) return;
    const all = getAllGreetings();
    const label = nav.querySelector('.alt-greeting-label');
    const prevBtn = nav.querySelector('.alt-prev');
    const nextBtn = nav.querySelector('.alt-next');
    if (label) label.textContent = 'Saludo ' + (state.altGreetings.current + 1) + ' / ' + all.length;
    if (prevBtn) prevBtn.classList.toggle('opacity-30', state.altGreetings.current === 0);
    if (nextBtn) nextBtn.classList.toggle('opacity-30', state.altGreetings.current >= all.length - 1);
}

function decorateAltGreetings() {
    const all = getAllGreetings();
    if (all.length <= 1) return;
    const card = findCardByKey('first_mes');
    if (!card) return;
    const body = card.querySelector('.field-card-body');
    if (!body || body.querySelector('.alt-greeting-nav')) return;

    const nav = document.createElement('div');
    nav.className = 'alt-greeting-nav flex items-center justify-between bg-surface2 border border-border1 rounded-lg px-3 py-2 mb-3';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'alt-prev w-7 h-7 rounded flex items-center justify-center text-text3 hover:text-gold hover:bg-surface transition-all';
    prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left text-xs"></i>';

    const label = document.createElement('span');
    label.className = 'alt-greeting-label font-cinzel text-[0.6rem] tracking-wider uppercase text-text3';

    const nextBtn = document.createElement('button');
    nextBtn.className = 'alt-next w-7 h-7 rounded flex items-center justify-center text-text3 hover:text-gold hover:bg-surface transition-all';
    nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right text-xs"></i>';

    prevBtn.addEventListener('click', e => { e.stopPropagation(); if (state.altGreetings.current > 0) swapAltGreeting(state.altGreetings.current - 1); });
    nextBtn.addEventListener('click', e => { e.stopPropagation(); if (state.altGreetings.current < all.length - 1) swapAltGreeting(state.altGreetings.current + 1); });

    nav.append(prevBtn, label, nextBtn);
    body.insertBefore(nav, body.firstChild);
    updateAltGreetingNav();
}

/* ═══════════════════════════════════════════════════
   LOREBOOK (CHARACTER BOOK)
   ═══════════════════════════════════════════════════ */

export function updLorebookCount() {
    const el = $('lorebookCount');
    if (el) el.textContent = state.characterBook.entries.length;
    const status = $('statusLorebook');
    if (status) status.textContent = state.characterBook.entries.length + ' entradas de lorebook';
}

export function addLorebookEntry() {
    state.characterBook.present = true;
    state.characterBook.entries.push({
        keys: [],
        content: '',
        enabled: true,
        insertion_order: state.characterBook.entries.length,
        extensions: {}
    });
    state.vault.dirty = true;
    renderLorebook();
}

function moveLorebookEntry(index, dir) {
    const entries = state.characterBook.entries;
    const ni = index + dir;
    if (ni < 0 || ni >= entries.length) return;
    [entries[index], entries[ni]] = [entries[ni], entries[index]];
    state.vault.dirty = true;
    renderLorebook();
}

export function renderLorebook() {
    const lv = $('lorebookView');
    if (!lv) return;
    lv.innerHTML = '';
    const entries = state.characterBook.entries;

    if (entries.length === 0 && !state.editor.active) {
        lv.innerHTML = '<div class="flex flex-col items-center justify-center h-full min-h-[40vh] text-center px-4"><div class="text-5xl opacity-20 mb-4"><i class="fa-solid fa-book-atlas text-text3"></i></div><p class="text-text3 italic max-w-sm text-sm">Sin entradas de lorebook.</p><p class="text-text3/60 text-xs mt-2">Carga un tomo con character_book o activa el editor para crear entradas.</p></div>';
        updLorebookCount();
        return;
    }

    const header = document.createElement('p');
    header.className = 'text-[0.72rem] text-text3 italic mb-4 px-1 flex items-center gap-2';
    header.innerHTML = state.editor.active
        ? '<i class="fa-solid fa-pen-ruler text-editor"></i> Editando lorebook (' + entries.length + ' entradas).'
        : '<i class="fa-solid fa-book-atlas"></i> ' + entries.length + ' entradas del lorebook.';
    lv.appendChild(header);

    entries.forEach((entry, i) => {
        const card = document.createElement('div');
        card.className = 'field-card bg-surface border border-border1 rounded-xl overflow-hidden mb-4 transition-all duration-300 hover:border-border2 hover:shadow-[0_4px_20px_rgba(0,0,0,0.4)] animate-fade-in-up';
        card.style.animationDelay = i * 0.05 + 's';
        card.dataset.lbIndex = i;

        // Head
        const head = document.createElement('div');
        head.className = 'field-card-head flex items-center px-4 py-3 bg-gradient-to-r from-[#0e2a24] to-[#0a1e1a] border-b border-border1 gap-3 cursor-pointer select-none';
        head.tabIndex = 0; head.setAttribute('role', 'button'); head.setAttribute('aria-expanded', 'true');

        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-book-bookmark text-editor text-[0.7rem] shrink-0';

        const keysEl = document.createElement('span');
        keysEl.className = 'font-cinzel text-[0.65rem] tracking-wider uppercase text-editor flex-1 truncate';
        keysEl.textContent = entry.keys.length > 0 ? entry.keys.join(', ') : '(sin claves)';

        const enabledBadge = document.createElement('span');
        enabledBadge.className = 'text-[0.55rem] px-1.5 py-0.5 rounded font-crimson ' + (entry.enabled ? 'bg-editor/20 text-editor' : 'bg-[#3a2020] text-[#e05a5a]');
        enabledBadge.textContent = entry.enabled ? 'activo' : 'inactivo';

        const countEl = document.createElement('span');
        countEl.className = 'text-[0.6rem] text-text3 font-crimson italic';
        countEl.textContent = entry.content.length + ' chars';

        const arrow = document.createElement('i');
        arrow.className = 'fa-solid fa-chevron-down text-text3 text-[0.7rem] transition-transform duration-300';

        head.append(icon, keysEl, enabledBadge, countEl, arrow);

        // Body
        const body = document.createElement('div');
        body.className = 'field-card-body px-5 py-4';
        body.style.overflow = 'hidden';

        const togC = () => {
            const c = !card.classList.contains('collapsed');
            if (c) { body.style.maxHeight = body.scrollHeight + 'px'; requestAnimationFrame(() => { card.classList.add('collapsed'); body.style.maxHeight = '0px'; }); }
            else { card.classList.remove('collapsed'); body.style.maxHeight = body.scrollHeight + 'px'; body.addEventListener('transitionend', function oe(e) { if (e.propertyName === 'max-height') { body.style.maxHeight = 'none'; body.removeEventListener('transitionend', oe); } }); }
            head.setAttribute('aria-expanded', String(!c));
        };
        head.addEventListener('click', e => { if (e.target.closest('.editor-ctrl-btn')) return; togC(); });

        // Keys editing (editor mode)
        let keysInput = null;
        if (state.editor.active) {
            const keysSection = document.createElement('div');
            keysSection.className = 'mb-3';
            const kl = document.createElement('label');
            kl.className = 'font-cinzel text-[0.55rem] tracking-wider uppercase text-text3 mb-1 block';
            kl.textContent = 'Claves (separadas por coma)';
            keysInput = document.createElement('input');
            keysInput.type = 'text';
            keysInput.className = 'w-full bg-bg2 border border-border1 rounded-lg px-3 py-1.5 text-text1 text-xs outline-none focus:border-editor font-mono';
            keysInput.value = entry.keys.join(', ');
            keysInput.addEventListener('click', e => e.stopPropagation());
            keysInput.addEventListener('blur', () => {
                entry.keys = keysInput.value.split(',').map(k => k.trim()).filter(k => k);
                keysEl.textContent = entry.keys.length > 0 ? entry.keys.join(', ') : '(sin claves)';
                state.vault.dirty = true;
            });
            keysSection.append(kl, keysInput);
            body.append(keysSection);
        }

        // Content
        const contentEl = document.createElement('div');
        if (state.editor.active) {
            contentEl.className = 'font-crimson text-sm text-text1 whitespace-pre-wrap leading-[1.7] min-h-[2rem] outline-none border border-transparent rounded-lg p-2 -mx-2 transition-colors hover:bg-surface2 focus:bg-[#14162a] focus:border-border2';
            contentEl.contentEditable = 'true';
            contentEl.textContent = entry.content;
            contentEl.addEventListener('input', () => {
                entry.content = contentEl.innerText;
                countEl.textContent = contentEl.innerText.length + ' chars';
                state.vault.dirty = true;
            });
        } else {
            contentEl.className = 'font-crimson text-sm text-text1 whitespace-pre-wrap leading-[1.7] min-h-[2rem]';
            contentEl.textContent = entry.content || '(vacio)';
        }
        body.append(contentEl);

        // Actions
        const acts = document.createElement('div');
        acts.className = 'flex gap-2 mt-4 pt-3 border-t border-border1';

        const mkB = (ic, label, cls = '') => {
            const b = document.createElement('button');
            b.className = 'font-cinzel text-[0.6rem] tracking-[0.12em] uppercase text-text3 hover:text-text1 bg-transparent hover:bg-surface2 border border-border1 hover:border-border2 rounded-md px-3 py-1.5 transition-all flex items-center gap-1.5 ' + cls;
            b.innerHTML = ic + ' ' + label;
            return b;
        };

        const toggleBtn = mkB(entry.enabled ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>', entry.enabled ? 'Desactivar' : 'Activar');
        toggleBtn.addEventListener('click', () => {
            entry.enabled = !entry.enabled;
            enabledBadge.textContent = entry.enabled ? 'activo' : 'inactivo';
            enabledBadge.className = 'text-[0.55rem] px-1.5 py-0.5 rounded font-crimson ' + (entry.enabled ? 'bg-editor/20 text-editor' : 'bg-[#3a2020] text-[#e05a5a]');
            toggleBtn.innerHTML = (entry.enabled ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>') + ' ' + (entry.enabled ? 'Desactivar' : 'Activar');
            state.vault.dirty = true;
        });

        acts.append(toggleBtn);

        if (state.editor.active) {
            const delBtn = mkB('<i class="fa-solid fa-trash-can"></i>', 'Eliminar', 'hover:text-[#e05a5a] hover:border-[#502020]');
            delBtn.addEventListener('click', () => {
                if (!confirm('Eliminar entrada "' + (entry.keys.join(', ') || '(sin claves)') + '"?')) return;
                state.characterBook.entries.splice(i, 1);
                state.vault.dirty = true;
                renderLorebook();
            });
            acts.append(delBtn);
        }

        body.append(acts);

        // Editor controls in head
        if (state.editor.active) {
            card.classList.add('editor-card');
            const ctrl = document.createElement('div');
            ctrl.className = 'editor-controls flex items-center gap-0.5 ml-1';
            const mkC = (ic, t) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'editor-ctrl-btn'; b.innerHTML = '<i class="fa-solid ' + ic + '"></i>'; b.title = t; return b; };
            const up = mkC('fa-caret-up', 'Arriba');
            up.addEventListener('click', e => { e.stopPropagation(); moveLorebookEntry(i, -1); });
            const dn = mkC('fa-caret-down', 'Abajo');
            dn.addEventListener('click', e => { e.stopPropagation(); moveLorebookEntry(i, 1); });
            ctrl.append(up, dn);
            const ch = head.querySelector('.fa-chevron-down');
            if (ch) ch.after(ctrl); else head.appendChild(ctrl);
        }

        card.append(head, body);
        lv.appendChild(card);
    });

    if (state.editor.active) {
        const addBtn = document.createElement('button');
        addBtn.className = 'add-field-btn w-full flex items-center justify-center gap-3 py-6 text-text3 hover:text-editor transition-all animate-fade-in-up';
        addBtn.style.animationDelay = entries.length * 0.05 + 's';
        addBtn.innerHTML = '<i class="fa-solid fa-plus text-lg"></i> <span class="font-cinzel text-[0.7rem] tracking-[0.15em] uppercase">Agregar Entrada</span>';
        addBtn.addEventListener('click', addLorebookEntry);
        lv.appendChild(addBtn);
    }

    updLorebookCount();
}
