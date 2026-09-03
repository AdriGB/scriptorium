// js/field-index.js - minimapa de campos sobre la scrollbar

import state from './state.js';
import { $, activeFieldView } from './utils.js';

const TICK_GAP = 2;    // px minimos entre marcas
export const TICK_MIN = 6; // px minimos de una marca: por debajo de ~6px no se acierta
export const LABEL_H = 16; // alto de la etiqueta con el titulo: una linea
const REVEAL_ZONE = 90; // px del borde derecho que revelan el rail

/**
 * Reparte las marcas por el alto del rail, en pixeles.
 *
 * Es pura (no toca el DOM) para poder probarla en Node: concentra toda la
 * aritmetica y es donde se cuelan los dos fallos tipicos —marcas de altura cero
 * en los campos cortos, y solapes cuando el minimo se come el hueco—.
 *
 * Devuelve tambien `labelTop`, la posicion del titulo de cada campo, y el flag
 * `labelsFit`: si los titulos no caben todos, el DOM solo pinta el del campo
 * activo en vez de apilar renglones ilegibles.
 */
export function computeTicks(items, total, trackHeight, minHeight = TICK_MIN, labelHeight = LABEL_H) {
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
    /* Segunda pasada, ahora de atras hacia delante. Sin ella, un campo enorme
       seguido de muchos cortos saca las marcas por debajo del rail: la posicion
       natural de los cortos esta aqui abajo y la primera pasada solo empuja,
       nunca recoge. Es la forma habitual de una carta real (descripcion larga y
       media docena de campos de una linea detras). */
    tops[n - 1] = Math.min(tops[n - 1], trackHeight - heights[n - 1]);
    for (let i = n - 2; i >= 0; i--) {
        tops[i] = Math.min(tops[i], tops[i + 1] - heights[i] - gap);
    }
    /* Si el bloque entero se ha ido arriba, se desplaza sin romper el orden ni los
       huecos... pero solo hasta donde aguante la ultima marca: si el hueco sobra
       abajo y no arriba, mas vale que la primera asome un pelin que sacar la
       ultima del rail (no hay clipping, se veria colgando fuera). */
    if (tops[0] < -1e-9) {
        const shift = Math.min(-tops[0], Math.max(0, trackHeight - heights[n - 1] - tops[n - 1]));
        for (let i = 0; i < n; i++) tops[i] += shift;
    }
    // Lo ultimo es solo ruido de coma flotante: restar deja -1e-15 en vez de 0.
    // Un negativo de verdad se deja estar, porque recortarlo solaparia la
    // siguiente marca, que es peor que asomar un pelin por arriba.
    if (tops[0] < 0 && tops[0] > -1e-6) tops[0] = 0;

    /* Titulos: centrados en su marca, pero con separacion minima —se ven todos a
       la vez, asi que dos no pueden pisarse—. Mismo esquema de dos pasadas que
       las marcas: empujar hacia abajo y luego recoger hacia arriba.
       Si no caben todos, no se aprietan: `labelsFit` avisa al DOM para que solo
       pinte el del campo activo, que es lo unico legible con tantos campos. */
    const labelsFit = n * labelHeight <= trackHeight;
    // El suelo de 0 va aqui, antes de las pasadas: si un titulo arranca en
    // negativo y se recorta al final, su vecino ya no esta a la distancia minima
    // y los dos primeros se solapan (encontrado con fuzz: 1 de cada 6 cartas).
    const labelTops = tops.map((t, i) => Math.max(0, t + heights[i] / 2 - labelHeight / 2));
    if (labelsFit) {
        for (let i = 1; i < n; i++) labelTops[i] = Math.max(labelTops[i], labelTops[i - 1] + labelHeight);
        for (let i = n - 1; i >= 0; i--) {
            const cap = trackHeight - labelHeight - (n - 1 - i) * labelHeight;
            labelTops[i] = Math.min(labelTops[i], cap);
            if (i > 0) labelTops[i - 1] = Math.min(labelTops[i - 1], labelTops[i] - labelHeight);
        }
    }
    for (let i = 0; i < n; i++) {
        labelTops[i] = Math.min(Math.max(0, labelTops[i]), Math.max(0, trackHeight - labelHeight));
    }

    const ticks = items.map((it, i) => ({
        key: it.key,
        label: it.label,
        top: tops[i],
        height: heights[i],
        labelTop: labelTops[i],
        isCreated: Boolean(it.isCreated),
        isDisabled: Boolean(it.isDisabled),
    }));
    ticks.labelsFit = labelsFit;
    return ticks;
}

let rail = null, track = null, viewport = null, scroller = null, wrapper = null;
let entries = [];
let reduced = false;
let rafScroll = 0, rafBuild = 0;

function setVisible(v) {
    if (!rail || rail.hidden) return;
    rail.classList.toggle('is-visible', v);
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
    // El titulo va dentro del boton y se ve con el rail, sin pasar el raton por
    // encima. Va en coordenadas del rail (`labelTop` relativo a la marca) para que
    // dos titulos de campos cortos no se pisen. No captura el puntero —lo hace el
    // CSS— para no tapar el contenido sobre el que flota.
    const lab = document.createElement('span');
    lab.className = 'fi-label';
    b.appendChild(lab);
    b.addEventListener('click', () => jumpTo(Number(b.dataset.index)));
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

function hideRail() {
    rail.hidden = true;
    rail.classList.remove('is-visible');
    entries = [];
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
        const key = card.dataset.key || '';
        const isCreated = Boolean(key && state.editor?.added?.has(key));
        let isDisabled = false;
        if (card.dataset.lbIndex !== undefined) {
            const idx = Number(card.dataset.lbIndex);
            isDisabled = state.characterBook?.entries?.[idx]?.enabled === false;
        }
        return {
            top: r.top - cRect.top + scroller.scrollTop,
            height: r.height,
            key,
            label: fieldLabel(card),
            isCreated,
            isDisabled,
        };
    }).sort((a, b) => a.top - b.top);

    const ticks = computeTicks(entries, scroller.scrollHeight, track.clientHeight);

    // Se reutilizan los botones existentes: repintarlos desde cero le quitaria el
    // foco a quien este recorriendo el indice con el tabulador.
    const nodes = [...track.querySelectorAll('.fi-tick')];
    while (nodes.length > ticks.length) nodes.pop().remove();
    while (nodes.length < ticks.length) nodes.push(createTick());

    // Con mas titulos que alto, solo se pinta el del campo activo: ver cuarenta
    // renglones medio solapados no ayuda a encontrar ninguno.
    rail.classList.toggle('labels-compact', ticks.labelsFit === false);

    nodes.forEach((b, i) => {
        const t = ticks[i];
        b.style.top = t.top + 'px';
        b.style.height = t.height + 'px';
        b.dataset.index = String(i);
        b.title = t.label;
        b.setAttribute('aria-label', 'Ir a ' + t.label);
        b.classList.toggle('is-created', Boolean(t.isCreated));
        b.classList.toggle('is-disabled', Boolean(t.isDisabled));
        // La etiqueta se coloca en coordenadas del rail dentro del boton, porque
        // es donde esta calculado el reparto sin solapes.
        const lab = b.firstElementChild;
        if (!lab) return;
        lab.textContent = t.label;
        lab.style.top = (t.labelTop - t.top) + 'px';
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
    track.appendChild(viewport);
    rail.appendChild(track);

    let isDragging = false;

    function applyScrollFromPointer(clientY, startClientY, startScrollTop, isViewportRelative) {
        const total = scroller.scrollHeight;
        const trackH = track.clientHeight;
        if (!total || !trackH) return;

        if (isViewportRelative) {
            const deltaY = clientY - startClientY;
            const ratio = total / trackH;
            scroller.scrollTop = Math.max(0, Math.min(total - scroller.clientHeight, startScrollTop + deltaY * ratio));
        } else {
            const trackRect = track.getBoundingClientRect();
            const y = Math.max(0, Math.min(trackH, clientY - trackRect.top));
            const targetScroll = (y / trackH) * total - scroller.clientHeight / 2;
            scroller.scrollTop = Math.max(0, Math.min(total - scroller.clientHeight, targetScroll));
        }
    }

    function startScrub(e, isViewportRelative) {
        if (e.button !== 0) return;
        e.preventDefault();
        isDragging = true;
        rail.classList.add('is-dragging');
        const startY = e.clientY;
        const startScroll = scroller.scrollTop;

        if (!isViewportRelative) {
            applyScrollFromPointer(e.clientY, startY, startScroll, false);
        }

        function onPointerMove(ev) {
            ev.preventDefault();
            applyScrollFromPointer(ev.clientY, startY, startScroll, isViewportRelative);
        }

        function onPointerUp() {
            isDragging = false;
            rail.classList.remove('is-dragging');
            window.removeEventListener('mousemove', onPointerMove);
            window.removeEventListener('mouseup', onPointerUp);
            if (!wrapper.matches(':hover') && !rail.contains(document.activeElement)) {
                setVisible(false);
            }
        }

        window.addEventListener('mousemove', onPointerMove);
        window.addEventListener('mouseup', onPointerUp);
    }

    viewport.addEventListener('mousedown', e => {
        e.stopPropagation();
        startScrub(e, true);
    });

    track.addEventListener('mousedown', e => {
        if (e.target.closest('.fi-tick')) return; // los ticks manejan su propio click
        startScrub(e, false);
    });

    scroller.addEventListener('mousemove', e => {
        const r = scroller.getBoundingClientRect();
        setVisible(e.clientX >= r.right - REVEAL_ZONE);
    });
    // El rail es hermano del scroller: sin escuchar el envoltorio, mover el raton
    // hacia el rail dispararia mouseleave y se ocultaria justo al ir a pulsarlo.
    wrapper.addEventListener('mouseleave', () => {
        if (!isDragging && !rail.contains(document.activeElement)) setVisible(false);
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
