// js/field-index.js - minimapa de campos sobre la scrollbar

import { $, activeFieldView } from './utils.js';

const TICK_GAP = 2;    // px minimos entre marcas
export const TICK_MIN = 6; // px minimos de una marca: por debajo de ~6px no se acierta
const REVEAL_ZONE = 90; // px del borde derecho que revelan el rail

/**
 * Reparte las marcas por el alto del rail, en pixeles.
 *
 * Es pura (no toca el DOM) para poder probarla en Node: concentra toda la
 * aritmetica y es donde se cuelan los dos fallos tipicos —marcas de altura cero
 * en los campos cortos, y solapes cuando el minimo se come el hueco—.
 */
export function computeTicks(items, total, trackHeight, minHeight = TICK_MIN) {
    if (!(total > 0) || !(trackHeight > 0) || !items.length) return [];
    const n = items.length;
    // El hueco se descuenta ANTES de escalar. Si no, las alturas minimas y los
    // huecos se van acumulando y la ultima marca acaba fuera del rail.
    const gap = n > 1 ? Math.min(TICK_GAP, (trackHeight * 0.1) / n) : 0;
    const usable = Math.max(1, trackHeight - gap * (n - 1));
    const scale = usable / total;

    /* Los campos cortos suben hasta el minimo y SOLO los largos absorben la
       diferencia. Comprimir todo proporcionalmente —lo que hacia antes— era
       precisamente lo que dejaba los cortos en 3px: se les quitaba sitio a los que
       ya no tenian. Un minimapa con marcas de 3px es inutil en cartas donde la
       descripcion mide 100 veces mas que el nombre. */
    const natural = items.map(it => Math.max(0, (it.height || 0) * scale));
    const shortCount = natural.reduce((a, h) => a + (h < minHeight ? 1 : 0), 0);
    const bigSum = natural.reduce((a, h) => a + (h >= minHeight ? h : 0), 0);
    const roomForBig = usable - shortCount * minHeight;
    let heights;
    if (roomForBig <= 0) {
        // Ni siquiera el minimo cabe (muchisimos campos): se reparten el alto a
        // partes iguales. Se pierde el minimo, pero al menos no se solapan.
        heights = natural.map(() => Math.max(1, usable / n));
    } else if (bigSum > roomForBig) {
        const k = roomForBig / bigSum;
        heights = natural.map(h => (h >= minHeight ? h * k : minHeight));
    } else {
        heights = natural.map(h => Math.max(minHeight, h));
    }

    const tops = items.map(it => Math.max(0, (it.top || 0) * scale));
    for (let i = 1; i < n; i++) {
        const floor = tops[i - 1] + heights[i - 1] + gap;
        if (tops[i] < floor) tops[i] = floor;
    }
    // Red de seguridad: si el primer campo no empieza en 0 y el ultimo se sale,
    // se desplaza el bloque entero sin romper el orden ni los huecos.
    const overflow = tops[n - 1] + heights[n - 1] - trackHeight;
    if (overflow > 0) {
        const shift = Math.min(tops[0], overflow);
        for (let i = 0; i < n; i++) tops[i] -= shift;
    }
    return items.map((it, i) => ({ key: it.key, label: it.label, top: tops[i], height: heights[i] }));
}

let rail = null, track = null, viewport = null, tip = null, scroller = null, wrapper = null;
let entries = [];
let reduced = false;
let rafScroll = 0, rafBuild = 0;
let hideTimer = 0;

/* La etiqueta se cierra con un pequeno retardo para que el cursor pueda pasar
   de la marca a la propia etiqueta sin que se esfume: son dos elementos
   separados y, sin el retardo, el mouseleave de la marca gana la carrera. */
function scheduleHide() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { tip.classList.remove('is-visible'); hideTimer = 0; }, 160);
}

function showTip(btn) {
    const e = entries[Number(btn.dataset.index)];
    if (!e || !tip) return;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
    // Etiqueta a dos lineas: nombre del campo y un trozito de su contenido.
    // Asi, aunque la marca sea pequena, el blanco de clic efectivo pasa a ser
    // todo el cuadro de la etiqueta, que es mucho mas facil de acertar.
    tip.replaceChildren();
    const label = document.createElement('div');
    label.className = 'fi-tip-label';
    label.textContent = e.label;
    tip.appendChild(label);
    if (e.snippet) {
        const sn = document.createElement('div');
        sn.className = 'fi-tip-snippet';
        sn.textContent = e.snippet;
        tip.appendChild(sn);
    }
    tip.dataset.index = btn.dataset.index;
    tip.style.top = Math.max(0, btn.offsetTop + btn.offsetHeight / 2 - tip.offsetHeight / 2) + 'px';
    tip.classList.add('is-visible');
}

function setVisible(v) {
    if (!rail || rail.hidden) return;
    rail.classList.toggle('is-visible', v);
    if (!v) scheduleHide();
}

function jumpTo(i) {
    const e = entries[i];
    if (!e || !scroller) return;
    // Margen para que el titulo del campo no quede pegado al borde superior.
    scroller.scrollTo({ top: Math.max(0, e.top - 8), behavior: reduced ? 'auto' : 'smooth' });
}

function createTick() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fi-tick';
    b.addEventListener('click', () => jumpTo(Number(b.dataset.index)));
    b.addEventListener('mouseenter', () => showTip(b));
    b.addEventListener('mouseleave', scheduleHide);
    b.addEventListener('focus', () => showTip(b));
    b.addEventListener('blur', scheduleHide);
    track.appendChild(b);
    return b;
}

function fieldLabel(card) {
    const nameInput = card.querySelector('.field-card-head .editor-field-name');
    if (nameInput && nameInput.value.trim()) return nameInput.value.trim();
    const span = card.querySelector('.field-card-head span.truncate');
    if (span && span.textContent.trim()) return span.textContent.trim();
    return String(card.dataset.key || '').replace(/_/g, ' ');
}

/* Primeras palabras del contenido del campo. Sirve para identificar de un vistazo
   que campo es, y ademas convierte la etiqueta en un blanco de clic amplio: aunque
   la marca mida 6px, el cuadro de la etiqueta puede ser de 200+ px y es clicable. */
function fieldSnippet(card) {
    const ce = card.querySelector('.field-card-body [contenteditable]')
        || card.querySelector('.field-card-body > div:not(.hidden)');
    const text = (ce?.textContent || card.querySelector('.field-card-body')?.textContent || '');
    const t = String(text).replace(/\s+/g, ' ').trim();
    if (!t) return '';
    return t.length > 64 ? t.slice(0, 64).trimEnd() + '…' : t;
}

function hideRail() {
    rail.hidden = true;
    rail.classList.remove('is-visible');
    entries = [];
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
    if (tip) tip.classList.remove('is-visible');
}

function rebuild() {
    if (!rail || !scroller) return;
    const view = activeFieldView();
    const cards = view
        ? [...view.querySelectorAll('.field-card')].filter(c => c.style.display !== 'none' && c.offsetParent !== null)
        : [];
    // Con menos de dos campos no hay nada que indexar: solo estorbaria.
    if (cards.length < 2) { hideRail(); return; }
    rail.hidden = false;

    const cRect = scroller.getBoundingClientRect();
    entries = cards.map(card => {
        const r = card.getBoundingClientRect();
        return {
            top: r.top - cRect.top + scroller.scrollTop,
            height: r.height,
            key: card.dataset.key || '',
            label: fieldLabel(card),
            snippet: fieldSnippet(card),
        };
    }).sort((a, b) => a.top - b.top);

    const ticks = computeTicks(entries, scroller.scrollHeight, track.clientHeight);

    // Se reutilizan los botones existentes: repintarlos desde cero le quitaria el
    // foco a quien este recorriendo el indice con el tabulador.
    const nodes = [...track.querySelectorAll('.fi-tick')];
    while (nodes.length > ticks.length) nodes.pop().remove();
    while (nodes.length < ticks.length) nodes.push(createTick());

    nodes.forEach((b, i) => {
        const t = ticks[i];
        b.style.top = t.top + 'px';
        b.style.height = t.height + 'px';
        b.dataset.index = String(i);
        b.title = t.label;
        b.setAttribute('aria-label', 'Ir a ' + t.label);
    });
}

function sync() {
    if (!track || rail.hidden || !entries.length) return;
    const total = scroller.scrollHeight, trackH = track.clientHeight;
    if (!total || !trackH) return;
    const scale = trackH / total;
    viewport.style.top = (scroller.scrollTop * scale) + 'px';
    viewport.style.height = Math.max(10, scroller.clientHeight * scale) + 'px';

    // Campo activo: el ultimo cuyo inicio ya quedo por encima del borde superior.
    const line = scroller.scrollTop + 12;
    let active = 0;
    for (let i = 0; i < entries.length; i++) if (entries[i].top <= line) active = i;
    [...track.querySelectorAll('.fi-tick')].forEach((b, i) => b.classList.toggle('is-active', i === active));
}

function scheduleSync() {
    if (rafScroll) return;
    rafScroll = requestAnimationFrame(() => { rafScroll = 0; sync(); });
}

/** Recalcular el indice: tras repintar, filtrar, cambiar de pestana o redimensionar. */
export function refreshFieldIndex() {
    if (!rail) return;
    if (rafBuild) return;
    rafBuild = requestAnimationFrame(() => { rafBuild = 0; rebuild(); sync(); });
}

export function initFieldIndex() {
    rail = $('fieldIndex');
    scroller = $('resultsArea');
    if (!rail || !scroller) return;
    wrapper = rail.parentElement;
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    track = document.createElement('div');
    track.className = 'fi-track';
    viewport = document.createElement('div');
    viewport.className = 'fi-viewport';
    tip = document.createElement('div');
    tip.className = 'fi-tip';
    track.appendChild(viewport);
    rail.append(track, tip);

    // La propia etiqueta es clicable: si el cursor pasa de la marca a la
    // etiqueta, scheduleHide da tiempo a que se cancele al reentrar.
    tip.addEventListener('click', () => jumpTo(Number(tip.dataset.index)));
    tip.addEventListener('mouseenter', () => { if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; } });
    tip.addEventListener('mouseleave', scheduleHide);

    scroller.addEventListener('mousemove', e => {
        const r = scroller.getBoundingClientRect();
        setVisible(e.clientX >= r.right - REVEAL_ZONE);
    });
    // El rail es hermano del scroller: sin escuchar el envoltorio, mover el raton
    // hacia el rail dispararia mouseleave y se ocultaria justo al ir a pulsarlo.
    wrapper.addEventListener('mouseleave', () => {
        if (!rail.contains(document.activeElement)) setVisible(false);
    });
    rail.addEventListener('focusin', () => setVisible(true));
    rail.addEventListener('focusout', () => setVisible(false));

    scroller.addEventListener('scroll', scheduleSync, { passive: true });
    window.addEventListener('resize', refreshFieldIndex);
    document.addEventListener('fields:rendered', refreshFieldIndex);

    // Colapsar o expandir una tarjeta, escribir en un contenteditable o filtrar
    // por busqueda cambian los altos sin repintar: no llegaria ningun otro aviso.
    const ro = new ResizeObserver(refreshFieldIndex);
    ['processedView', 'rawView', 'lorebookView'].forEach(id => {
        const el = $(id);
        if (el) ro.observe(el);
    });

    refreshFieldIndex();
}
