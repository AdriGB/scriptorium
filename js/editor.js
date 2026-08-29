import state, { VF, getExtracted, RESERVED_KEYS } from './state.js';
import { $, deepClone, showToast, copyClip, sanitizeKey, isValidKey, confirmDialog, textStats, statsLabel, countMarkers, HEAVY_FIELD, HEAVY_CARD } from './utils.js';
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
    updateWeight();
}

/* Peso de la carta procesada en la barra de estado. Se recalcula entera en vez
   de llevar un acumulado: son veinte campos y asi no hay que perseguir cual
   cambio (escribir, restaurar, borrar, anadir). */
let weightTm = 0;
export function updateWeight() {
    const el = $('statusWeight');
    if (!el) return;
    const all = Object.values(state.proc.data).map(v => String(v ?? '')).join('\n');
    if (!all.trim()) {
        el.textContent = 'sin texto';
        el.classList.remove('text-gold');
        el.title = 'Peso aproximado de la carta procesada';
        return;
    }
    const { tokens } = textStats(all);
    el.textContent = statsLabel(all);
    el.classList.toggle('text-gold', tokens >= HEAVY_CARD);
    el.title = tokens >= HEAVY_CARD
        ? 'Carta pesada: consumira bastante contexto en cada mensaje'
        : 'Peso aproximado de la carta procesada';
}

function scheduleWeight() {
    if (weightTm) return;
    weightTm = setTimeout(() => { weightTm = 0; updateWeight(); }, 150);
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

/* Insignia de peso: los chars a la vista y el detalle al pasar por encima, para
   no ensanchar la cabecera de la tarjeta. En oro a partir del umbral. */
function setCardStats(cc, text) {
    const { chars, tokens } = textStats(text);
    cc.textContent = chars.toLocaleString('es') + ' chars';
    cc.title = statsLabel(text) + (tokens >= HEAVY_FIELD ? ' — campo muy pesado' : '');
    cc.classList.toggle('text-gold', tokens >= HEAVY_FIELD);
}

/* Marcadores que quedaron literales en un campo ya procesado. */
function setCardMarkers(mk, text) {
    const n = countMarkers(text);
    mk.classList.toggle('hidden', n === 0);
    mk.textContent = n + ' sin sustituir';
    mk.title = n === 1
        ? 'Queda 1 marcador literal: rellena el nombre y vuelve a invocar'
        : `Quedan ${n} marcadores literales: rellena el nombre y vuelve a invocar`;
}

/* Escribe un texto en un campo ya procesado desde fuera del contenteditable.
   Lleva la misma contabilidad que la edicion a mano (datos, peso, insignias y
   boveda sucia); `els` son los nodos de la tarjeta que hay que repintar, y se
   admiten vacios porque desde el modal expandido solo se conocen unos cuantos. */
function writeFieldText(key, text, els = {}) {
    state.proc.data[key] = text;
    state.proc.edited.add(key);
    state.vault.dirty = true;
    if (els.ce) els.ce.textContent = text;
    if (els.cc) setCardStats(els.cc, text);
    scheduleWeight();
    refreshCardBadges();
}

/* ─── Aplicar la traduccion ───
   La traduccion se mostraba solo como referencia y no habia forma de volcarla al
   campo: se leia y se copiaba a mano. Se aplica con deshacer, igual que "Limpiar
   todo" e "Invocar y sustituir". Devuelve false si no habia nada que aplicar. */
export function applyTranslation(key, text, els = {}) {
    const prev = state.proc.data[key] ?? '';
    /* Sin texto o sin cambios: el boton no puede quedarse mudo, que es justo el
       callejon sin salida que se esta resolviendo. */
    if (!text || text === prev) { showToast('Nada que aplicar', 'info'); return false; }
    const wasEdited = state.proc.edited.has(key);
    writeFieldText(key, text, els);
    showToast('Traduccion aplicada', 'success', {
        label: 'Deshacer',
        onClick: () => {
            writeFieldText(key, prev, els);
            // Si el campo estaba intacto, la vuelta atras lo deja intacto: la
            // insignia "editado" no es cierta y el siguiente ritual la respeta.
            if (!wasEdited) state.proc.edited.delete(key);
            refreshCardBadges();
            showToast('Traduccion descartada', 'info');
        }
    });
    return true;
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

    const cc = document.createElement('span'); cc.className = 'text-[0.65rem] text-text3 font-crimson italic';
    setCardStats(cc, text);
    const tg = document.createElement('i'); tg.className = 'fa-solid fa-chevron-down text-text3 text-[0.7rem] transition-transform duration-300';
    // Badge "editado": state.proc.edited ya se rastreaba en 11 sitios, pero nunca se mostraba.
    const ed = document.createElement('span');
    ed.className = 'edited-badge hidden shrink-0 text-[0.55rem] px-1.5 py-0.5 rounded font-crimson italic bg-editor/20 text-editor border border-editor/30';
    ed.textContent = 'editado';
    ed.title = 'Modificado manualmente';
    /* Marcadores sin sustituir. En la vista original las llaves van resaltadas a
       proposito, asi que la insignia solo tiene sentido en la procesada: si algo
       sigue entre llaves ahi, es que la sustitucion no llego (nombre vacio). */
    const mk = document.createElement('span');
    mk.className = 'marker-badge hidden shrink-0 text-[0.55rem] px-1.5 py-0.5 rounded font-crimson italic bg-[#3a2900] text-[#e8cc80] border border-[#7a6230]/30';
    mk.textContent = 'sin sustituir';
    head.append(tEl, cc, ed, tg);
    if (!isRaw) { head.insertBefore(mk, tg); setCardMarkers(mk, text); }

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
    const tH = document.createElement('div'); tH.className = 'flex items-center gap-2 mb-1.5';
    const tL = document.createElement('p'); tL.className = 'text-[0.6rem] font-cinzel tracking-widest uppercase text-violet2 flex-1';
    tL.innerHTML = '<i class="fa-solid fa-language"></i> Traduccion';
    const tX = document.createElement('div'); tX.className = 'font-crimson text-base text-text2 italic whitespace-pre-wrap leading-[1.7]';
    tB.append(tH, tX); tH.append(tL);

    if (!isRaw) ce.addEventListener('input', e => {
        state.proc.data[key] = e.target.innerText;
        setCardStats(cc, e.target.innerText);
        setCardMarkers(mk, e.target.innerText);
        scheduleWeight();
        state.proc.edited.add(key);
        ed.classList.remove('hidden');
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

    /* Aplicar: la traduccion deja de ser una referencia de lectura y pasa al
       campo. En la vista original no se ofrece, porque ahi no se puede escribir. */
    if (!isRaw) {
        const tAp = mkB('<i class="fa-solid fa-check"></i>', 'Aplicar', 'hover:text-violet2 hover:border-violetDim');
        tAp.addEventListener('click', () => {
            if (!applyTranslation(key, tC, { ce, cc })) return;
            tC = null; tB.classList.add('hidden');
        });
        tH.append(tAp);
    }

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
                ed.classList.add('hidden');
                setCardStats(cc, res); setCardMarkers(mk, res); updateWeight();
                tC = null; tB.classList.add('hidden');
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
/* Refleja en las tarjetas ya pintadas lo que se puede deducir del texto: campos
   editados a mano y marcadores que quedaron sin sustituir. */
export function refreshCardBadges() {
    processedView().querySelectorAll('.field-card').forEach(card => {
        const key = card.dataset.key;
        const badge = card.querySelector('.edited-badge');
        if (badge) badge.classList.toggle('hidden', !key || !state.proc.edited.has(key));
        const mk = card.querySelector('.marker-badge');
        if (mk && key) setCardMarkers(mk, state.proc.data[key] ?? '');
    });
}

/* ─── Empty states ───
   Avisa al modulo de busqueda (ui.js) de que el arbol se ha repintado, para que
   reaplique el filtro. Se hace por evento para no crear el ciclo editor <-> ui. */
function announceRender() {
    document.dispatchEvent(new CustomEvent('fields:rendered'));
}

export function emptyFieldsState(glyphHtml, title, hint) {
    // glyphHtml va tal cual (es marcado); el texto se escapa por si alguna vez
    // llega de la propia carta en lugar de ser un literal.
    const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const box = document.createElement('div');
    box.className = 'fields-empty-state flex flex-col items-center justify-center min-h-[40vh] text-center px-4 py-10';
    box.innerHTML =
        '<div class="mb-4 text-text3 opacity-20 ' + (glyphHtml.startsWith('&#') ? 'text-5xl font-cinzelDeco' : 'text-3xl') + '">' + glyphHtml + '</div>' +
        '<p class="text-text3 italic max-w-sm text-sm">' + esc(title) + '</p>' +
        (hint ? '<p class="text-text3/60 text-xs mt-2">' + esc(hint) + '</p>' : '');
    return box;
}

export function renderRaw() {
    const rv = rawView();
    rv.innerHTML = '<p class="text-[0.78rem] text-text3 italic mb-4 px-1">Plantilla: <span class="tag-char">{{char}}</span> y <span class="tag-user">{{user}}</span></p>';
    const entries = Object.entries(getExtracted());
    if (entries.length) entries.forEach(([k, v]) => rv.appendChild(createCard(k, v, true)));
    // Antes la pestana quedaba en blanco salvo el pie de plantilla: sin carta no
    // se explicaba por que no habia nada.
    else rv.appendChild(emptyFieldsState('<i class="fa-solid fa-scroll"></i>', 'La plantilla no tiene campos.', 'Carga una carta para ver aqui sus campos originales.'));
    announceRender();
}

export function renderProc() {
    clearFDC();
    const entries = Object.entries(state.proc.data);
    const pv = processedView();
    pv.innerHTML = '';
    if (entries.length === 0 && !state.editor.active) {
        pv.appendChild(emptyFieldsState('&#5765;', 'Las paginas aguardan.', 'Procesa la carta para ver aqui el resultado.'));
        updFab(); updLorebookCount(); announceRender(); return;
    }
    const h = document.createElement('p');
    h.className = 'text-[0.72rem] text-text3 italic mb-4 px-1 flex items-center gap-2';
    h.innerHTML = state.editor.active
        ? '<i class="fa-solid fa-pen-ruler text-editor"></i> Editor activo.'
        : '<i class="fa-solid fa-pen-to-square"></i> Clica para editar.';
    pv.appendChild(h);
    entries.forEach(([k, v], i) => { const c = createCard(k, v, false); c.style.animationDelay = i * 0.05 + 's'; pv.appendChild(c); });
    refreshCardBadges();
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
    announceRender();
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
    const cnRaw = charNameInput().value.trim(), unRaw = userNameInput().value.trim();
    const cn = cnRaw || '{{char}}', un = unRaw || '{{user}}',
        persona = $('userPersona').value.trim(), sp = $('sysPrompt').value.trim(),
        cR = /\{\{char\}\}/gi, uR = /\{\{user\}\}/gi;
    const prev = { ...state.proc.data };
    const prevEdited = new Set(state.proc.edited);
    let hits = 0, touched = 0;
    /* Sustituye y cuenta. Sin nombre propio no se cuenta nada: cambiar {{char}}
       por {{char}} no es una sustitucion y solo anadiria ruido al aviso. */
    const sub = (value) => {
        const s = String(value ?? '');
        const n = (cnRaw ? (s.match(cR) || []).length : 0) + (unRaw ? (s.match(uR) || []).length : 0);
        if (n > 0) { hits += n; touched++; }
        return s.replace(cR, () => cn).replace(uR, () => un);
    };
    state.proc.data = {};
    if (sp) {
        const k = VF.SP;
        state.proc.data[k] = state.proc.edited.has(k) && prev[k] ? prev[k] : sub(sp);
    }
    const allGreetings = [state.altGreetings.original, ...state.altGreetings.list];
    for (const [k, v] of Object.entries(getExtracted())) {
        let rawValue = v;
        if (k === 'first_mes' && state.altGreetings.list.length > 0) {
            const idx = state.altGreetings.current;
            if (idx > 0 && idx < allGreetings.length) rawValue = allGreetings[idx];
        }
        state.proc.data[k] = state.proc.edited.has(k) && prev[k] !== undefined ? prev[k] : sub(rawValue);
    }
    if (persona) {
        const k = VF.UP;
        state.proc.data[k] = state.proc.edited.has(k) && prev[k] ? prev[k] : sub(persona);
    }
    for (const ek of state.editor.added) if (prev[ek] !== undefined && state.proc.data[ek] === undefined) state.proc.data[ek] = prev[ek];
    setProcessedCount(Object.keys(state.proc.data).length);
    state.vault.dirty = true;
    renderProc();
    $('tabProcessed').click();
    /* Deshacer, igual que en "Limpiar todo": el aviso lleva la accion. Aqui
       basta con guardar el texto procesado anterior, porque este ritual no toca
       ni el fichero ni el lorebook. Si no habia nada antes no se ofrece:
       deshacer hacia un panel vacio se confunde con un fallo, no con un retorno. */
    const canUndo = Object.keys(prev).length > 0;
    /* Marcadores que quedaron literales: si falto el nombre del personaje o del
       aventurero, la sustitucion no llega y la carta se exporta con las llaves
       puestas — antes el aviso decia "Ritual completado" y no habia forma de
       enterarse. Es mas urgente que el recuento, asi que se queda con el aviso
       (y con su unica accion) cuando los hay. */
    const pending = Object.values(state.proc.data).reduce((a, v) => a + countMarkers(v), 0);
    if (pending) {
        showToast(`${pending} marcador${pending === 1 ? '' : 'es'} sin sustituir`, 'error',
            { label: 'Ver', onClick: jumpToMarker });
        return;
    }
    const msg = hits
        ? `${hits} sustitucion${hits === 1 ? '' : 'es'} en ${touched} campo${touched === 1 ? '' : 's'}`
        : 'Ritual completado';
    showToast(msg, hits ? 'success' : 'info',
        canUndo ? { label: 'Deshacer', onClick: () => restoreProcessed(prev, prevEdited) } : null);
}

/* Salta al primer campo con marcadores literales, lo abre si estaba plegado y lo
   destaca un momento: con la carta entera delante, decir "hay 7" no sirve de
   mucho si no se ve donde estan. */
function jumpToMarker() {
    const card = [...processedView().querySelectorAll('.field-card')]
        .find(c => countMarkers(state.proc.data[c.dataset.key] ?? '') > 0);
    if (!card) return;
    if (card.classList.contains('collapsed')) card.querySelector('.field-card-head')?.click();
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Sin el reflow de por medio, repetir el salto no reinicia la animacion.
    card.classList.remove('flash-card');
    void card.offsetWidth;
    card.classList.add('flash-card');
}

/* Vuelta atras de "Invocar y sustituir". Recupera tambien el conjunto de campos
   editados a mano: es lo que el siguiente ritual respeta para no pisarlos. */
function restoreProcessed(data, edited) {
    state.proc.data = { ...data };
    state.proc.edited = new Set(edited);
    state.vault.dirty = true;
    setProcessedCount(Object.keys(state.proc.data).length);
    renderProc();
    showToast('Sustitucion deshecha', 'info');
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

/* Destino de la escritura del modal expandido: null mientras muestra un campo de
   solo lectura (vista original), donde no hay nada que aplicar. */
let expTarget = null;

export function openExp(key, label, cls, isRaw, ce, cc) {
    $('expandModalTranslation').classList.add('hidden');
    state.tr.mc = null;
    expTarget = isRaw ? null : { key, ce, cc };
    // En la vista original el texto es de solo lectura: no hay campo donde volcar.
    $('expandModalApplyBtn')?.classList.toggle('hidden', isRaw);
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
            // Misma contabilidad que escribir en la tarjeta (peso e insignias
            // incluidos): antes este camino dejaba el contador a medias.
            writeFieldText(key, v, { ce, cc });
            $('expandModalCount').textContent = wci(v);
            state.tr.mc = null; $('expandModalTranslation').classList.add('hidden');
        };
    }
    $('expandModal').classList.remove('hidden'); $('expandModal').classList.add('flex');
    if (isRaw) $('expandModalClose').focus(); else $('expandModalContent').focus();
}

export function closeExp() {
    $('expandModal').classList.add('hidden'); $('expandModal').classList.remove('flex');
    $('expandModalContent').contentEditable = 'false'; $('expandModalContent').oninput = null;
    $('expandModalTranslation').classList.add('hidden'); state.tr.mc = null;
    expTarget = null;
    if (state.tr.ma) { state.tr.ma.abort(); state.tr.ma = null; }
}

/* Vuelca la traduccion del modal sobre el campo. Se cierra antes de avisar: el
   toast vive en z-50 y el modal en z-[60], asi que con el modal abierto el
   aviso (y su "Deshacer") quedaria detras del fondo y no se podria pulsar. */
export function applyExpandedTranslation() {
    if (!expTarget) return false;
    const text = state.tr.mc;
    if (!text) { showToast('Nada que aplicar', 'info'); return false; }
    const target = expTarget;
    closeExp();
    return applyTranslation(target.key, text, { ce: target.ce, cc: target.cc });
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

export async function applyJE() {
    try {
        const parsed = JSON.parse($('jsonEditorTextarea').value);
        if (Object.keys(state.proc.data).length > 0) {
            const hasEdits = state.proc.edited.size > 0 || state.editor.added.size > 0;
            if (hasEdits) {
                const res = await confirmDialog({
                    title: 'Aplicar JSON',
                    message: 'Hay ediciones visuales activas.\n\nAplicar el JSON reemplazara todo el estado actual.',
                    okLabel: 'Aplicar',
                    danger: 'ok',
                    icon: 'fa-triangle-exclamation'
                });
                if (res !== 'ok') return;
            }
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
            delBtn.addEventListener('click', async () => {
                const res = await confirmDialog({
                    title: 'Eliminar entrada',
                    message: 'Se eliminara "' + (entry.keys.join(', ') || '(sin claves)') + '" del lorebook.',
                    okLabel: 'Eliminar',
                    danger: 'ok',
                    icon: 'fa-trash-can'
                });
                if (res !== 'ok') return;
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
    announceRender();
}
