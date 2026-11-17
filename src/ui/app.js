/* MontajeMX — estado, biblioteca y línea de tiempo.
 * Copyright (C) 2026 Santiago Miguel — GPL-3.0-or-later. */
'use strict';
const $ = (s, r) => (r || document).querySelector(s);
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const S = { p: MMX.newProject(), file: null, dirty: false, sel: null, t: 0, playing: false, zoom: 60, undo: [], redo: [], snap: true, ripple: false, tab: 'medios', clipboard: null, proxying: {}, info: null };
const TRACK_H = 54;
const mediaUrl = (f) => (api.mediaUrl ? api.mediaUrl(f) : 'mmx://app/media?p=' + encodeURIComponent(f));
const fmtDur = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); return m + ':' + String(Math.floor(s % 60)).padStart(2, '0'); };
function timecode(t) { const f = S.p.fps, fr = Math.round(t * f), ff = Math.round(f); const p2 = (v) => String(v).padStart(2, '0'); return `${p2(Math.floor(fr / ff / 3600))}:${p2(Math.floor(fr / ff / 60) % 60)}:${p2(Math.floor(fr / ff) % 60)}:${p2(fr % ff)}`; }
function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, ms || 2600); }

function findClip(id) { for (let ti = 0; ti < S.p.tracks.length; ti++) { const c = S.p.tracks[ti].clips.find((x) => x.id === id); if (c) return { clip: c, track: S.p.tracks[ti], ti }; } return null; }
const selected = () => (S.sel ? findClip(S.sel) : null);
const duration = () => MMX.projectDuration(S.p);

/* ---------- deshacer / rehacer ---------- */
let lastKey = null, lastAt = 0;
function pushUndo(key) {
  const now = Date.now();
  if (key && key === lastKey && now - lastAt < 900) { lastAt = now; return; }
  lastKey = key; lastAt = now;
  S.undo.push(JSON.stringify(S.p)); if (S.undo.length > 80) S.undo.shift();
  S.redo = [];
}
/* Cambia el proyecto. opts.light = no reconstruir el inspector (para deslizadores). */
function mutate(key, fn, opts) {
  pushUndo(key); fn(); S.dirty = true;
  renderTimeline(); if (!(opts && opts.light)) renderInspector();
  if (opts && opts.lib) renderLibrary();
  Preview.invalidate(); updateTitle(); scheduleAutosave();
}
function restore(from, to) {
  if (!from.length) return;
  to.push(JSON.stringify(S.p)); S.p = JSON.parse(from.pop()); lastKey = null; S.dirty = true;
  if (S.sel && !findClip(S.sel)) S.sel = null;
  refreshAll();
}
function refreshAll() { $('#duck').checked = S.p.duck.enabled; Preview.resize(); renderLibrary(); renderTimeline(); renderInspector(); Preview.invalidate(); updateTitle(); }
function updateTitle() { $('#pname').textContent = (S.p.name || 'Sin título') + (S.dirty ? ' •' : '') + `   ·   ${S.p.width}×${S.p.height} · ${S.p.fps} fps`; }
let autoH = null;
function scheduleAutosave() { clearTimeout(autoH); autoH = setTimeout(() => api.invoke('autosave:write', JSON.stringify({ file: S.file, p: S.p })), 4000); }

/* ---------- colocación en pistas ---------- */
function overlaps(track, start, dur, ignore) { return track.clips.some((c) => c.id !== ignore && start < c.start + c.dur - 1e-4 && start + dur > c.start + 1e-4); }
function firstFree(track, start, dur, ignore) {
  start = Math.max(0, start);
  for (let i = 0; i < 200 && overlaps(track, start, dur, ignore); i++) {
    const hit = track.clips.filter((c) => c.id !== ignore && start < c.start + c.dur - 1e-4 && start + dur > c.start + 1e-4).sort((a, b) => a.start - b.start)[0];
    start = hit.start + hit.dur;
  }
  return start;
}
const trackEnd = (track) => track.clips.reduce((m, c) => Math.max(m, c.start + c.dur), 0);
function addTrack(top) { const t = MMX.newTrack('Pista ' + (S.p.tracks.length + 1)); if (top) S.p.tracks.unshift(t); else S.p.tracks.push(t); return t; }
function clipFromMedia(m) { return MMX.newClip(m.type, { mediaId: m.id, dur: m.type === 'image' ? 4 : Math.max(0.2, m.duration) }); }
function defaultTrack(kind) {
  const tr = S.p.tracks, pick = kind === 'audio' ? tr.length - 1 : kind === 'title' || kind === 'title3d' ? 0 : Math.min(1, tr.length - 1);
  return tr[pick].locked ? tr.find((t) => !t.locked) || addTrack() : tr[pick];
}
function insertClip(clip, track, start) {
  mutate(null, () => {
    track = track || defaultTrack(clip.kind);
    clip.start = firstFree(track, start == null ? (clip.kind === 'title' || clip.kind === 'title3d' || clip.kind === 'color' ? S.t : trackEnd(track)) : start, clip.dur);
    track.clips.push(clip); S.sel = clip.id;
  });
}

/* ---------- biblioteca ---------- */
const TABS = { medios: 'Medios', titulos: 'Títulos', trans: 'Transiciones', looks: 'Looks', division: 'División' };
const TITLE_PRESETS = [
  { name: 'Título central', t: { text: 'Mi película', size: 120, py: 0.5 } },
  { name: 'Subtítulo', t: { text: 'Subtítulo de ejemplo', size: 54, py: 0.88, bold: false, shadow: 4, strokeW: 3 } },
  { name: 'Tercio inferior', t: { text: 'Nombre Apellido\nCargo o descripción', size: 48, align: 'left', px: 0.07, py: 0.8, bg: '#000000b0' } },
  { name: 'Créditos', t: { text: 'Dirección\nSantiago Miguel\n\nEdición\nMontajeMX', size: 56, bold: false }, anim: true },
  { name: 'Cita', t: { text: '«El cine es un espejo pintado»', size: 70, italic: true, bold: false, font: 'Georgia, "Times New Roman", serif' } },
  { name: 'Impacto', t: { text: 'ACCIÓN', size: 200, color: '#ffd23f', stroke: '#000000', strokeW: 10, font: 'Impact, "Arial Black", sans-serif' } },
];
const SPLITS = [
  { name: '2 columnas', cells: [[0, 0, .5, 1], [.5, 0, .5, 1]] }, { name: '2 filas', cells: [[0, 0, 1, .5], [0, .5, 1, .5]] },
  { name: '3 columnas', cells: [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]] }, { name: 'Cuadrícula 2×2', cells: [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]] },
  { name: '1 grande + 2', cells: [[0, 0, 2 / 3, 1], [2 / 3, 0, 1 / 3, .5], [2 / 3, .5, 1 / 3, .5]] }, { name: 'Imagen en imagen', cells: [[0, 0, 1, 1], [.66, .06, .3, .3], [.04, .06, .3, .3], [.66, .64, .3, .3], [.04, .64, .3, .3]] },
  { name: 'Cuadrícula 3×3', cells: Array.from({ length: 9 }, (_, i) => [(i % 3) / 3, Math.floor(i / 3) / 3, 1 / 3, 1 / 3]) }, { name: 'Franja central', cells: [[0, 0, 1, .25], [0, .25, 1, .5], [0, .75, 1, .25]] },
];
function renderLibrary() {
  const tabs = $('#lib-tabs'), body = $('#lib-body');
  tabs.replaceChildren(...Object.keys(TABS).map((k) => h('button', { class: S.tab === k ? 'on' : '', onclick: () => { S.tab = k; renderLibrary(); } }, TABS[k])));
  body.replaceChildren();
  const sc = selected();
  if (S.tab === 'medios') {
    body.append(h('div', { class: 'lib-actions' }, h('button', { class: 'primary', onclick: pickMedia }, 'Importar medios'), h('button', { onclick: () => insertClip(MMX.newClip('color', { dur: 4, fill: '#101820' })) }, '+ Fondo de color')));
    const list = Object.values(S.p.media);
    if (!list.length) { body.append(h('div', { class: 'empty' }, 'Arrastra aquí tus videos, fotos y audio,', h('br'), 'o usa «Importar medios».')); return; }
    body.append(h('div', { class: 'grid' }, list.map((m) => h('div', { class: 'item', draggable: true, title: m.path + '\nDoble clic para añadir a la línea de tiempo',
      ondragstart: (e) => e.dataTransfer.setData('text/mmx', JSON.stringify({ media: m.id })), ondblclick: () => insertClip(clipFromMedia(m)) },
      h('div', { class: 'th' + (m.wave ? ' wave' : ''), style: { backgroundImage: m.thumb || m.wave ? `url("${mediaUrl(m.thumb || m.wave)}")` : '' } }, m.thumb || m.wave ? '' : (m.type === 'audio' ? '♪' : '▦')),
      m.duration ? h('span', { class: 'du' }, fmtDur(m.duration)) : null,
      m.missing ? h('span', { class: 'badge' }, 'no encontrado') : S.proxying[m.id] ? h('span', { class: 'badge' }, 'creando proxy…') : null,
      h('button', { class: 'rm', title: 'Quitar de la biblioteca', onclick: (e) => { e.stopPropagation(); removeMedia(m); } }, '×'),
      h('div', { class: 'nm' }, m.name)))));
  } else if (S.tab === 'titulos') {
    body.append(h('p', { class: 'hint' }, 'Doble clic o arrastra a una pista. El texto y el estilo se editan en el panel derecho.'));
    body.append(h('div', { class: 'grid' }, TITLE_PRESETS.map((pr, i) => h('div', { class: 'item', draggable: true, ondragstart: (e) => e.dataTransfer.setData('text/mmx', JSON.stringify({ title: i })), ondblclick: () => insertClip(titleClip(i)) },
      h('div', { class: 'sw', style: { fontFamily: pr.t.font || '', fontStyle: pr.t.italic ? 'italic' : '', color: pr.t.color || '#fff', background: '#0e1014' } }, 'Aa'), h('div', { class: 'nm' }, pr.name)))));
    body.append(h('p', { class: 'hint', style: { marginTop: '14px' } }, 'Títulos 3D: texto extruido con bisel, luces, material metálico y animación.'));
    body.append(h('div', { class: 'grid' }, TITLE3D_PRESETS.map((pr, i) => h('div', { class: 'item', draggable: true, ondragstart: (e) => e.dataTransfer.setData('text/mmx', JSON.stringify({ title3d: i })), ondblclick: () => insertClip(title3dClip(i)) },
      h('div', { class: 'sw', style: { color: pr.t.color, background: 'radial-gradient(circle at 50% 30%, #2a3140, #0e1014)', textShadow: `1px 1px 0 #0008, 2px 2px 0 #0008, 3px 3px 0 #0008, 4px 4px 6px #000`, fontSize: '22px' } }, '3D'), h('div', { class: 'nm' }, pr.name)))));
  } else if (S.tab === 'trans') {
    body.append(h('p', { class: 'hint' }, sc ? 'Clic: transición de entrada del clip seleccionado. Mayús+clic: de salida.' : 'Selecciona un clip para aplicarle una transición.'));
    body.append(h('div', { class: 'grid' }, Object.keys(MMX.TRANSITIONS).map((k) => h('div', { class: 'item', onclick: (e) => { const s = selected(); if (!s) return toast('Selecciona un clip primero'); mutate(null, () => { s.clip[e.shiftKey ? 'transOut' : 'transIn'].type = k; }); } },
      h('div', { class: 'sw', style: { background: 'linear-gradient(90deg,#33607a,#0e1014)' } }, k === 'none' ? '∅' : '⇄'), h('div', { class: 'nm' }, MMX.TRANSITIONS[k])))));
  } else if (S.tab === 'looks') {
    body.append(h('p', { class: 'hint' }, sc ? 'Aplica un look de color al clip seleccionado.' : 'Selecciona un clip para aplicarle un look.'));
    body.append(h('div', { class: 'grid' }, Object.keys(MMX.LOOKS).map((k) => { const c = Object.assign(MMX.defaultColor(), { look: k }), g = (r, gg, b) => 'rgb(' + MMX.grade(c, r, gg, b).map((v) => Math.round(v * 255)).join(',') + ')';
      return h('div', { class: 'item', onclick: () => { const s = selected(); if (!s) return toast('Selecciona un clip primero'); mutate(null, () => { s.clip.color.look = k; }); } },
        h('div', { class: 'sw', style: { background: `linear-gradient(90deg, ${g(.85, .3, .25)}, ${g(.95, .8, .3)}, ${g(.3, .7, .4)}, ${g(.25, .45, .85)})` } }), h('div', { class: 'nm' }, MMX.LOOKS[k])); })));
  } else {
    body.append(h('p', { class: 'hint' }, 'Pantalla dividida: selecciona un clip y haz clic en una celda. Pon cada clip en una pista distinta. La posición de cada celda se puede animar con fotogramas clave.'));
    body.append(h('div', { class: 'grid' }, SPLITS.map((sp) => h('div', { class: 'item' }, h('div', { class: 'tpl' }, sp.cells.map((c) => h('i', { style: { left: c[0] * 100 + '%', top: c[1] * 100 + '%', width: c[2] * 100 + '%', height: c[3] * 100 + '%' }, onclick: () => applyCell(c) }))), h('div', { class: 'nm' }, sp.name)))));
    body.append(h('div', { class: 'btns' }, h('button', { onclick: () => applyCell(null) }, 'Quitar celda (pantalla completa)')));
  }
}
function applyCell(c) { const s = selected(); if (!s || !MMX.isVisual(s.clip)) return toast('Selecciona un clip de video o imagen'); mutate(null, () => { s.clip.frame = c ? { x: c[0], y: c[1], w: c[2], h: c[3] } : null; s.clip.fit = c ? 'cover' : 'contain'; s.clip.x = 0; s.clip.y = 0; s.clip.scale = 1; }); }
const TITLE3D_PRESETS = [
  { name: '3D Esmeralda', t: { color: '#5fd4b8', metal: 0.55, rough: 0.3 } }, { name: '3D Oro', t: { color: '#e8b84a', metal: 1, rough: 0.22, font: 'droid_serif_bold' } },
  { name: '3D Cromo', t: { color: '#dfe6ee', metal: 1, rough: 0.08 } }, { name: '3D Rojo mate', t: { color: '#e5484d', metal: 0.1, rough: 0.7, depth: 0.5 } },
  { name: '3D Giro', t: { color: '#7aa7ff', metal: 0.7, rough: 0.25, anim: 'spin', rotY: 0 } }, { name: '3D Entrada en vuelo', t: { color: '#ff7a59', metal: 0.6, rough: 0.3, anim: 'flyin' } },
];
function title3dClip(i) { const c = MMX.newClip('title3d', { dur: 5, transOut: { type: 'fade', dur: 0.5 } }); Object.assign(c.t3, TITLE3D_PRESETS[i].t); return c; }
function titleClip(i) {
  const pr = TITLE_PRESETS[i], c = MMX.newClip('title', { dur: 5, transIn: { type: 'fade', dur: 0.6 }, transOut: { type: 'fade', dur: 0.6 } });
  Object.assign(c.title, pr.t);
  if (pr.anim) { c.dur = 8; c.kf.y = [{ t: 0, v: 0.9 }, { t: 8, v: -0.9 }]; c.transIn.type = c.transOut.type = 'none'; }
  return c;
}
async function pickMedia() { importPaths(await api.invoke('media:pick')); }
async function importPaths(paths) {
  const added = [];
  for (const f of paths) {
    const m = await api.invoke('media:probe', f);
    if (m.error) { toast(m.error); continue; }
    S.p.media[m.id] = Object.assign(S.p.media[m.id] || {}, m); added.push(S.p.media[m.id]);
    renderLibrary(); ensureProxy(S.p.media[m.id]);
  }
  if (added.length) { S.dirty = true; updateTitle(); }
  return added;
}
async function ensureProxy(m) {
  if (!m.needsProxy || m.proxy || S.proxying[m.id]) return;
  S.proxying[m.id] = true; renderLibrary();
  const r = await api.invoke('media:proxy', m);
  delete S.proxying[m.id];
  if (r.error) toast(r.error, 5000); else { m.proxy = r.path; Preview.invalidate(); }
  renderLibrary();
}
function removeMedia(m) {
  if (S.p.tracks.some((t) => t.clips.some((c) => c.mediaId === m.id))) return toast('Ese medio está en uso en la línea de tiempo');
  mutate(null, () => { delete S.p.media[m.id]; }, { lib: true });
}

/* ---------- línea de tiempo ---------- */
function renderTimeline() {
  const p = S.p, heads = $('#heads'), lanes = $('#lanes'), z = S.zoom;
  const total = Math.max(duration() + 30, ($('#tl-scroll').clientWidth || 1200) / z);
  $('#tl-inner').style.width = Math.ceil(total * z) + 'px';
  // regla
  const steps = [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600], step = steps.find((s) => s * z >= 70) || 600, marks = [];
  for (let t = 0; t <= total; t += step) marks.push(h('span', { style: { left: t * z + 'px' } }, step < 1 ? t.toFixed(1) + 's' : fmtDur(t)));
  $('#ruler').replaceChildren(...marks);
  heads.replaceChildren(...p.tracks.map((tr, ti) => h('div', { class: 'head' },
    h('input', { class: 'tn', value: tr.name, title: 'Nombre de la pista', onchange: (e) => mutate(null, () => { tr.name = e.target.value; }) }),
    h('div', { class: 'hb' },
      h('button', { class: tr.muted ? 'on' : '', title: 'Silenciar pista', onclick: () => mutate(null, () => { tr.muted = !tr.muted; }) }, 'M'),
      h('button', { class: tr.hidden ? 'on' : '', title: 'Ocultar video de la pista', onclick: () => mutate(null, () => { tr.hidden = !tr.hidden; }) }, 'O'),
      h('button', { class: tr.locked ? 'on' : '', title: 'Bloquear pista', onclick: () => mutate(null, () => { tr.locked = !tr.locked; }) }, 'B'),
      h('select', { title: 'Función de audio (para «Atenuar con voz»)', onchange: (e) => mutate(null, () => { tr.role = e.target.value; }) }, h('option', { value: 'normal', selected: tr.role === 'normal' }, 'Normal'), h('option', { value: 'voz', selected: tr.role === 'voz' }, 'Voz')),
      h('button', { title: 'Transparencia y volumen de la pista', onclick: () => trackDialog(tr) }, '⋯'),
      h('button', { title: 'Eliminar pista', onclick: () => { if (tr.clips.length) return toast('La pista tiene clips; vacíala primero'); if (p.tracks.length < 2) return; mutate(null, () => { p.tracks.splice(ti, 1); }); } }, '×')))));
  lanes.replaceChildren(...p.tracks.map((tr, ti) => h('div', { class: 'lane' + (tr.locked ? ' locked' : ''), 'data-ti': ti }, tr.clips.map((c) => clipEl(c)))));
  movePlayhead();
}
function clipLabel(c) { const m = S.p.media[c.mediaId]; return c.kind === 'title' ? 'T  ' + c.title.text.split('\n')[0] : c.kind === 'title3d' ? '3D  ' + c.t3.text.split('\n')[0] : c.kind === 'color' ? 'Color' : (m ? m.name : '¿medio?') + (c.speed < 0.01 ? '  ❄ congelado' : c.speed !== 1 ? `  ×${+c.speed.toFixed(2)}` : '') + (c.reverse ? '  ◀' : ''); }
function clipEl(c) {
  const z = S.zoom, m = S.p.media[c.mediaId], w = Math.max(4, c.dur * z);
  const e = h('div', { class: `clip ${c.kind}${c.id === S.sel ? ' sel' : ''}`, 'data-id': c.id, style: { left: c.start * z + 'px', width: w + 'px' }, title: clipLabel(c) });
  if (m && m.thumb) e.append(h('div', { class: 'bgi', style: { backgroundImage: `url("${mediaUrl(m.thumb)}")` } }));
  if (m && m.wave && m.duration) { const span = c.dur * c.speed, full = w * m.duration / span; e.append(h('div', { class: 'bgi', style: { backgroundImage: `url("${mediaUrl(m.wave)}")`, backgroundSize: `${full}px 100%`, backgroundPosition: `${-c.in / m.duration * full}px 0` } })); }
  if (c.kind === 'color') e.style.background = c.fill;
  if (c.transIn.type !== 'none') e.append(h('div', { class: 'ti', style: { left: 0, width: Math.min(w, c.transIn.dur * z) + 'px' } }));
  if (c.transOut.type !== 'none') e.append(h('div', { class: 'to', style: { width: Math.min(w, c.transOut.dur * z) + 'px' } }));
  const ks = new Set(); for (const k in c.kf) for (const q of c.kf[k]) ks.add(q.t);
  for (const t of ks) e.append(h('div', { class: 'kd', style: { left: t * z + 'px' } }));
  e.append(h('div', { class: 'lb' }, clipLabel(c)), h('div', { class: 'hl' }), h('div', { class: 'hr' }));
  return e;
}
function movePlayhead() { $('#playhead').style.left = S.t * S.zoom + 'px'; $('#tc').textContent = timecode(S.t); }
function seek(t, keepPlaying) { S.t = MMX.clamp(Math.round(t * S.p.fps) / S.p.fps, 0, Math.max(duration(), 0)); if (!keepPlaying && S.playing) Preview.pause(); $('#exact').hidden = true; movePlayhead(); Preview.invalidate(); Inspector.sync(); }
function select(id) { if (S.sel === id) return; S.sel = id; document.querySelectorAll('.clip.sel').forEach((e) => e.classList.remove('sel')); if (id) { const e = document.querySelector(`.clip[data-id="${id}"]`); if (e) e.classList.add('sel'); } renderInspector(); if (S.tab !== 'medios' && S.tab !== 'titulos') renderLibrary(); Preview.invalidate(); }

function snapTime(t, ignoreId) {
  if (!S.snap) return t;
  const pts = [0, S.t], tol = 8 / S.zoom;
  for (const tr of S.p.tracks) for (const c of tr.clips) if (c.id !== ignoreId) pts.push(c.start, c.start + c.dur);
  let best = t, bd = tol;
  for (const q of pts) if (Math.abs(q - t) < bd) { bd = Math.abs(q - t); best = q; }
  return best;
}
function initTimeline() {
  const lanes = $('#lanes'), scroll = $('#tl-scroll');
  scroll.addEventListener('scroll', () => { $('#heads').style.transform = `translateY(${-scroll.scrollTop}px)`; });
  const xToT = (clientX) => (clientX - $('#tl-inner').getBoundingClientRect().left) / S.zoom;
  const laneAt = (clientY) => { const r = lanes.getBoundingClientRect(); return MMX.clamp(Math.floor((clientY - r.top) / TRACK_H), 0, S.p.tracks.length - 1); };
  $('#ruler').addEventListener('pointerdown', (e) => { seek(xToT(e.clientX)); const mv = (ev) => seek(xToT(ev.clientX)); window.addEventListener('pointermove', mv); window.addEventListener('pointerup', () => window.removeEventListener('pointermove', mv), { once: true }); });
  lanes.addEventListener('pointerdown', (e) => {
    const ce = e.target.closest('.clip');
    if (!ce) { select(null); seek(xToT(e.clientX)); return; }
    const f = findClip(ce.dataset.id); if (!f) return;
    select(f.clip.id);
    if (f.track.locked) return;
    const c = f.clip, m = S.p.media[c.mediaId], mode = e.target.classList.contains('hl') ? 'l' : e.target.classList.contains('hr') ? 'r' : 'm';
    const x0 = e.clientX, o = { start: c.start, dur: c.dur, in: c.in }, timed = (c.kind === 'video' || c.kind === 'audio') && m && m.duration;
    const el = document.querySelector(`.clip[data-id="${c.id}"]`);
    const others = f.track.clips.filter((q) => q.id !== c.id);
    const prevEnd = others.filter((q) => q.start + q.dur <= o.start + 1e-4).reduce((mx, q) => Math.max(mx, q.start + q.dur), 0);
    const nextStart = others.filter((q) => q.start >= o.start + o.dur - 1e-4).reduce((mn, q) => Math.min(mn, q.start), Infinity);
    let moved = false, n = Object.assign({}, o), ti = f.ti;
    const mv = (ev) => {
      const dt = (ev.clientX - x0) / S.zoom; if (Math.abs(ev.clientX - x0) > 3) moved = true; if (!moved) return;
      if (mode === 'm') { n.start = Math.max(0, snapTime(o.start + dt, c.id)); const e2 = snapTime(n.start + o.dur, c.id); if (e2 !== n.start + o.dur) n.start = Math.max(0, e2 - o.dur); ti = laneAt(ev.clientY); el.style.transform = `translateY(${(ti - f.ti) * TRACK_H}px)`; }
      else if (mode === 'l') {
        let s = snapTime(o.start + dt, c.id); s = Math.max(prevEnd, Math.min(s, o.start + o.dur - 0.1));
        if (timed && !c.reverse) s = Math.max(s, o.start - o.in / c.speed);
        if (timed && c.reverse) s = Math.max(s, o.start - (m.duration - o.in - o.dur * c.speed) / c.speed);
        n.start = s; n.dur = o.dur - (s - o.start); n.in = timed && !c.reverse ? o.in + (s - o.start) * c.speed : o.in;
      } else {
        let en = snapTime(o.start + o.dur + dt, c.id); en = Math.min(nextStart, Math.max(en, o.start + 0.1));
        if (timed && !c.reverse) en = Math.min(en, o.start + (m.duration - o.in) / c.speed);
        if (timed && c.reverse) en = Math.min(en, o.start + o.dur + o.in / c.speed);
        n.dur = en - o.start; n.in = timed && c.reverse ? o.in - (n.dur - o.dur) * c.speed : o.in;
      }
      el.style.left = n.start * S.zoom + 'px'; el.style.width = n.dur * S.zoom + 'px';
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      if (!moved) return;
      mutate(null, () => {
        let tr = S.p.tracks[ti]; if (tr.locked) { tr = f.track; ti = f.ti; }
        if (mode === 'm') { n.start = firstFree(tr, n.start, o.dur, c.id); if (tr !== f.track) { f.track.clips.splice(f.track.clips.indexOf(c), 1); tr.clips.push(c); } }
        if (mode === 'l') for (const k in c.kf) c.kf[k].forEach((q) => { q.t -= n.start - o.start; });
        c.start = n.start; c.dur = n.dur; c.in = Math.max(0, n.in);
      });
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up, { once: true });
  });
  lanes.addEventListener('dragover', (e) => { e.preventDefault(); document.querySelectorAll('.lane.over').forEach((l) => l.classList.remove('over')); const l = lanes.children[laneAt(e.clientY)]; if (l) l.classList.add('over'); });
  lanes.addEventListener('dragleave', () => document.querySelectorAll('.lane.over').forEach((l) => l.classList.remove('over')));
  lanes.addEventListener('drop', async (e) => {
    e.preventDefault(); document.querySelectorAll('.lane.over').forEach((l) => l.classList.remove('over'));
    const tr = S.p.tracks[laneAt(e.clientY)], t = snapTime(Math.max(0, xToT(e.clientX)));
    if (tr.locked) return toast('La pista está bloqueada');
    const raw = e.dataTransfer.getData('text/mmx');
    if (raw) { const d = JSON.parse(raw); if (d.media && S.p.media[d.media]) insertClip(clipFromMedia(S.p.media[d.media]), tr, t); else if (d.title != null) insertClip(titleClip(d.title), tr, t); else if (d.title3d != null) insertClip(title3dClip(d.title3d), tr, t); }
    else if (e.dataTransfer.files.length) { let at = t; for (const m of await importPaths([...e.dataTransfer.files].map((f) => api.pathOf(f)))) { const c = clipFromMedia(m); insertClip(c, tr, at); at = c.start + c.dur; } }
  });
  const lib = $('#lib');
  lib.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  lib.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) { e.preventDefault(); S.tab = 'medios'; importPaths([...e.dataTransfer.files].map((f) => api.pathOf(f))); } });
  $('#zoom').addEventListener('input', (e) => setZoom(+e.target.value));
  scroll.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(S.zoom * (e.deltaY < 0 ? 1.15 : 0.87)); } }, { passive: false });
  $('#snap').addEventListener('change', (e) => { S.snap = e.target.checked; });
  $('#ripple').addEventListener('change', (e) => { S.ripple = e.target.checked; });
  $('#duck').addEventListener('change', (e) => mutate(null, () => { S.p.duck.enabled = e.target.checked; }));
}
function setZoom(z) { const sc = $('#tl-scroll'), keep = S.t * S.zoom - sc.scrollLeft; S.zoom = MMX.clamp(z, 4, 300); $('#zoom').value = S.zoom; renderTimeline(); sc.scrollLeft = S.t * S.zoom - keep; }

/* ---------- acciones de edición ---------- */
function splitClip(f, t) {
  const c = f.clip, d1 = t - c.start; if (d1 < 0.05 || c.dur - d1 < 0.05) return false;
  for (const k in c.kf) MMX.setKey(c, k, d1, MMX.valueAt(c, k, d1));
  const b = JSON.parse(JSON.stringify(c)); b.id = MMX.uid('c'); b.start = t; b.dur = c.dur - d1;
  if (c.reverse) { c.in = c.in + b.dur * c.speed; } else b.in = c.in + d1 * c.speed;
  for (const k in b.kf) b.kf[k] = b.kf[k].filter((q) => q.t >= d1 - 1e-6).map((q) => ({ t: q.t - d1, v: q.v }));
  for (const k in c.kf) c.kf[k] = c.kf[k].filter((q) => q.t <= d1 + 1e-6);
  c.dur = d1; c.transOut = { type: 'none', dur: 1 }; b.transIn = { type: 'none', dur: 1 }; b.fadeIn = 0; c.fadeOut = 0;
  f.track.clips.push(b); return b;
}
const Actions = {
  split() {
    const s = selected(), targets = s && S.t > s.clip.start && S.t < s.clip.start + s.clip.dur ? [s] : S.p.tracks.filter((t) => !t.locked).flatMap((t) => t.clips.filter((c) => S.t > c.start + 0.05 && S.t < c.start + c.dur - 0.05).map((c) => ({ clip: c, track: t })));
    if (!targets.length) return toast('Coloca el cursor sobre un clip para dividirlo');
    mutate(null, () => targets.forEach((f) => splitClip(f, S.t)));
  },
  delete() { const s = selected(); if (!s || s.track.locked) return; mutate(null, () => { s.track.clips.splice(s.track.clips.indexOf(s.clip), 1); if (S.ripple) s.track.clips.forEach((c) => { if (c.start >= s.clip.start) c.start -= s.clip.dur; }); S.sel = null; }); },
  dup() { const s = selected(); if (!s) return; mutate(null, () => { const b = JSON.parse(JSON.stringify(s.clip)); b.id = MMX.uid('c'); b.start = firstFree(s.track, s.clip.start + s.clip.dur, b.dur); s.track.clips.push(b); S.sel = b.id; }); },
  copy() { const s = selected(); if (s) { S.clipboard = JSON.stringify(s.clip); toast('Clip copiado'); } },
  paste() { if (!S.clipboard) return; const b = JSON.parse(S.clipboard); b.id = MMX.uid('c'); const s = selected(); insertClip(b, s ? s.track : null, S.t); },
  freeze() {
    const s = selected(); if (!s || s.clip.kind !== 'video' || !(S.t > s.clip.start && S.t < s.clip.start + s.clip.dur)) return toast('Selecciona un clip de video y pon el cursor en el fotograma a congelar');
    mutate(null, () => {
      const b = splitClip(s, S.t); if (!b) return;
      const fz = JSON.parse(JSON.stringify(b)); fz.id = MMX.uid('c'); fz.dur = 2; fz.speed = 0.001; fz.muted = true; fz.kf = {}; fz.transOut = { type: 'none', dur: 1 };
      s.track.clips.forEach((c) => { if (c.start >= S.t - 1e-6) c.start += 2; }); fz.start = S.t; s.track.clips.push(fz); S.sel = fz.id;
    });
  },
  censor() {
    const s = selected(); if (!s || !MMX.isVisual(s.clip) || s.clip.kind.startsWith('title')) return toast('Selecciona un clip de video o imagen');
    mutate(null, () => {
      const b = JSON.parse(JSON.stringify(s.clip)); b.id = MMX.uid('c'); b.muted = true; b.fx.mosaic = 36; b.transIn = { type: 'none', dur: 1 }; b.transOut = { type: 'none', dur: 1 };
      b.mask = { shape: 'ellipse', x: 0.5, y: 0.4, w: 0.25, h: 0.35, feather: 0.15, invert: false };
      let tr = S.p.tracks.slice(0, s.ti).reverse().find((t) => !t.locked && !overlaps(t, b.start, b.dur));
      if (!tr) { tr = MMX.newTrack('Censura'); S.p.tracks.splice(s.ti, 0, tr); }
      tr.clips.push(b); S.sel = b.id;
    });
    toast('Región de mosaico creada: ajusta la máscara en el panel derecho');
  },
  addtrack() { mutate(null, () => addTrack(true)); },
  zoomin() { setZoom(S.zoom * 1.3); }, zoomout() { setZoom(S.zoom / 1.3); },
  fit() { setZoom(($('#tl-scroll').clientWidth - 40) / Math.max(5, duration())); $('#tl-scroll').scrollLeft = 0; },
  undo() { restore(S.undo, S.redo); }, redo() { restore(S.redo, S.undo); },
  play() { Preview.toggle(); }, home() { seek(0); }, end() { seek(duration()); },
  prev() { seek(S.t - 1 / S.p.fps); }, next() { seek(S.t + 1 / S.p.fps); },
  async new() { if (!(await confirmDiscard())) return; S.p = MMX.newProject(); S.file = null; S.dirty = false; S.sel = null; S.t = 0; S.undo = []; S.redo = []; refreshAll(); },
  async open() { if (!(await confirmDiscard())) return; const r = await api.invoke('project:open'); if (r) loadProject(r.json, r.file); },
  async save(as) { const f = await api.invoke('project:save', JSON.stringify(S.p), S.file, as === true); if (f) { S.file = f; S.p.name = f.split(/[\\/]/).pop().replace(/\.mmx$/, ''); S.dirty = false; updateTitle(); toast('Proyecto guardado'); } return !!f; },
  settings() { Dialogs.settings(); }, multicam() { Multicam.open(); }, dvd() { Dvd.open(); }, export() { Dialogs.exportDlg(); }, capture() { Dialogs.capture(); }, quick() { Dialogs.quick(); }, about() { Dialogs.about(); },
  scope() { const s = $('#scope'); s.hidden = !s.hidden; Preview.invalidate(); },
  async exact() {
    if (duration() <= 0) return; toast('Renderizando fotograma con el motor de exportación…', 8000);
    const at = Math.min(S.t, duration() - 1 / S.p.fps), r = await api.invoke('frame:render', S.p, at, 960, await Preview.collectAssets(at));
    if (r.error) return Dialogs.error('No se pudo renderizar el fotograma', r.error);
    const img = $('#exact'); img.src = r.data; img.hidden = false; toast('Fotograma exacto (clic en la imagen para volver a la vista en vivo)');
  },
  async snapshot() { if (duration() <= 0) return; const f = await api.invoke('frame:pick'); if (!f) return; toast('Guardando instantánea…', 8000); const at = Math.min(S.t, duration() - 1 / S.p.fps), r = await api.invoke('frame:render', S.p, at, S.p.width, await Preview.collectAssets(at), f); if (r.error) Dialogs.error('No se pudo guardar', r.error); else toast('Instantánea guardada'); },
};
async function confirmDiscard() { if (!S.dirty) return true; const r = await api.invoke('confirm', '¿Guardar los cambios del proyecto actual?', ['Guardar', 'No guardar', 'Cancelar']); if (r === 0) return Actions.save(); return r === 1; }
async function loadProject(json, file) {
  try {
    const p = JSON.parse(json); if (!p.tracks || !p.media) throw new Error('formato');
    const base = MMX.newClip('video');
    for (const t of p.tracks) { t.clips = t.clips.map((c) => Object.assign({}, JSON.parse(JSON.stringify(base)), c, { color: Object.assign(MMX.defaultColor(), c.color), fx: Object.assign(MMX.defaultFx(), c.fx) })); if (t.opacity == null) t.opacity = 1; if (!t.role) t.role = 'normal'; if (!t.surround) t.surround = 'front'; }
    p.duck = p.duck || { enabled: false, level: 0.25 };
    S.p = p; S.file = file; S.dirty = false; S.sel = null; S.t = 0; S.undo = []; S.redo = [];
    const list = Object.values(p.media), ok = await api.invoke('media:exists', list.map((m) => m.path));
    const aux = await api.invoke('media:exists', list.flatMap((m) => [m.thumb || '', m.proxy || '', m.wave || '']));
    list.forEach((m, i) => { m.missing = !ok[i]; if (m.thumb && !aux[i * 3]) m.thumb = null; if (m.proxy && !aux[i * 3 + 1]) m.proxy = null; if (m.wave && !aux[i * 3 + 2]) m.wave = null; if (ok[i]) ensureProxy(m); });
    refreshAll(); if (list.some((m) => m.missing)) toast('Algunos medios no se encontraron en su ubicación original', 5000);
  } catch (e) { Dialogs.error('No se pudo abrir el proyecto', String(e.message || e)); }
}
function trackDialog(tr) { Dialogs.track(tr); }

function initKeys() {
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && Actions[b.dataset.act]) Actions[b.dataset.act](); });
  $('#exact').addEventListener('click', () => { $('#exact').hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (!$('#modal').hidden) { if (Dialogs.keyHook && Dialogs.keyHook(e)) return; if (e.key === 'Escape' && Dialogs.closable) Dialogs.close(); return; }
    const tag = e.target.tagName, typing = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !['range', 'checkbox', 'color'].includes(e.target.type));
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 's') { e.preventDefault(); return Actions.save(e.shiftKey); }
    if (typing) return;
    const map = mod ? { z: e.shiftKey ? 'redo' : 'undo', y: 'redo', c: 'copy', v: 'paste', d: 'dup', n: 'new', o: 'open', e: 'export' }
      : { ' ': 'play', s: 'split', delete: 'delete', backspace: 'delete', arrowleft: 'prev', arrowright: 'next', home: 'home', end: 'end', '+': 'zoomin', '=': 'zoomin', '-': 'zoomout' };
    if (map[k]) { e.preventDefault(); Actions[map[k]](); }
  });
}
window.addEventListener('DOMContentLoaded', async () => {
  S.info = await api.invoke('info');
  initTimeline(); initKeys(); Preview.init(); refreshAll();
  api.on('app:closing', async () => { if (await confirmDiscard()) api.send('app:close-ok'); });
  window.addEventListener('resize', () => renderTimeline());
  const auto = await api.invoke('autosave:read');
  if (auto) { try { const a = JSON.parse(auto); if (a.p && MMX.projectDuration(a.p) > 0 && (await api.invoke('confirm', 'Hay un proyecto de la sesión anterior. ¿Quieres recuperarlo?', ['Recuperar', 'Empezar de cero'])) === 0) { await loadProject(JSON.stringify(a.p), a.file); S.dirty = true; updateTitle(); } } catch (e) { /* autoguardado dañado: se ignora */ } }
  if (window.__smoke) window.__smoke();
});
