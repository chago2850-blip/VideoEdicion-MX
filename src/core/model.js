/* MontajeMX — modelo de proyecto y matemáticas compartidas (vista previa y exportación).
 * Copyright (C) 2026 Santiago Miguel
 * Licencia: GPL-3.0-or-later. Ver LICENSE. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MMX = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  let seq = 0;
  const uid = (p) => p + Date.now().toString(36) + (seq++).toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference', 'lighter'];
  const BLEND_NAMES = { normal: 'Normal', multiply: 'Multiplicar', screen: 'Trama', overlay: 'Superponer', darken: 'Oscurecer', lighten: 'Aclarar', difference: 'Diferencia', lighter: 'Añadir' };
  const TRANSITIONS = { none: 'Ninguna', fade: 'Disolvencia', black: 'Fundido a negro', slideL: 'Deslizar ←', slideR: 'Deslizar →', slideU: 'Deslizar ↑', slideD: 'Deslizar ↓', zoom: 'Zoom', wipeR: 'Barrido →', wipeL: 'Barrido ←', wipeD: 'Barrido ↓', wipeU: 'Barrido ↑', morph: 'Morph (zoom fluido)' };
  const OVERLAP = { fade: 1, slideL: 1, slideR: 1, slideU: 1, slideD: 1, zoom: 1, wipeR: 1, wipeL: 1, wipeD: 1, wipeU: 1, morph: 1 };
  const WIPES = { wipeR: [-1, 0], wipeL: [1, 0], wipeD: [0, -1], wipeU: [0, 1] };
  const FONTS3D = { droid_sans_bold: 'Sans negrita', droid_sans_regular: 'Sans', droid_serif_bold: 'Serif negrita', droid_serif_regular: 'Serif', droid_sans_mono_regular: 'Mono', gentilis_bold: 'Clásica negrita', gentilis_regular: 'Clásica' };
  const ANIMS3D = { none: 'Sin animación', spin: 'Giro completo', swing: 'Balanceo', flyin: 'Entrada en vuelo', tilt: 'Inclinación lenta' };
  const SURROUND = { front: 'Frontal (I/D)', center: 'Centro (diálogo)', rear: 'Traseros (envolvente)', all: 'Frontal + traseros' };
  const LOOKS = { none: 'Ninguno', bw: 'Blanco y negro', noir: 'Cine negro', sepia: 'Sepia', vintage: 'Vintage', cool: 'Frío', warm: 'Cálido', tealorange: 'Teal & Orange', bleach: 'Bleach bypass', invert: 'Negativo', poster: 'Posterizar', dream: 'Sueño' };
  const KF_PROPS = { x: 'Posición X', y: 'Posición Y', scale: 'Escala', rotation: 'Rotación', opacity: 'Opacidad', volume: 'Volumen' };

  function defaultColor() {
    return { exposure: 0, brightness: 0, contrast: 0, saturation: 0, hue: 0, temperature: 0, tint: 0, gamma: 1,
      shadows: [0, 0, 0], mids: [0, 0, 0], highs: [0, 0, 0], curve: [[0, 0], [1, 1]], look: 'none',
      selective: { enabled: false, hue: 0, range: 30 }, lut: null };
  }
  function defaultFx() { return { blur: 0, mosaic: 0, vignette: 0, grain: 0, sharpen: 0, denoise: 0, lens: 0, stabilize: false, v360: 'none', yaw: 0, pitch: 0 }; }

  function newProject() {
    return { version: 1, name: 'Sin título', width: 1920, height: 1080, fps: 30, media: {}, notes: '',
      duck: { enabled: false, level: 0.25 },
      tracks: [newTrack('Pista 1'), newTrack('Pista 2'), newTrack('Pista 3'), newTrack('Pista 4')] };
  }
  function newTrack(name) { return { id: uid('t'), name, muted: false, hidden: false, locked: false, volume: 1, opacity: 1, role: 'normal', surround: 'front', clips: [] }; }
  function newClip(kind, o) {
    return Object.assign({ id: uid('c'), kind, mediaId: null, start: 0, dur: 5, in: 0, speed: 1, reverse: false,
      x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, kf: {}, crop: { l: 0, t: 0, r: 0, b: 0 }, frame: null, fit: 'contain',
      flipH: false, flipV: false, blend: 'normal', color: defaultColor(), fx: defaultFx(),
      chroma: { enabled: false, color: '#00ff00', similarity: 0.18, blend: 0.08 }, mask: null,
      transIn: { type: 'none', dur: 1 }, transOut: { type: 'none', dur: 1 },
      volume: 1, muted: false, fadeIn: 0, fadeOut: 0, pan: 0, pitch: 0, bass: 0, treble: 0, denoiseAudio: false,
      title: kind === 'title' ? { text: 'Título', font: 'Helvetica, Arial, sans-serif', size: 96, color: '#ffffff', stroke: '#000000', strokeW: 0, shadow: 6, bg: '', align: 'center', bold: true, italic: false, px: 0.5, py: 0.5 } : null,
      t3: kind === 'title3d' ? { text: 'TÍTULO 3D', font: 'droid_sans_bold', size: 1, depth: 0.3, bevel: 0.03, color: '#5fd4b8', metal: 0.55, rough: 0.3, rotX: -8, rotY: 22, rotZ: 0, anim: 'none', light: 40 } : null,
      fill: '#000000' }, o || {});
  }

  /* ---------- tiempo ---------- */
  function projectDuration(p) {
    let d = 0;
    for (const t of p.tracks) for (const c of t.clips) d = Math.max(d, c.start + c.dur);
    return d;
  }
  /* Cola extra: el clip anterior sigue visible mientras entra la transición del siguiente. */
  function tailExt(track, clip) {
    const end = clip.start + clip.dur;
    for (const n of track.clips) {
      if (n !== clip && Math.abs(n.start - end) < 0.02 && OVERLAP[n.transIn.type]) return Math.min(n.transIn.dur, n.dur);
    }
    return 0;
  }
  function isVisual(c) { return c.kind !== 'audio'; }
  function hasAudio(p, c) { const m = p.media[c.mediaId]; return (c.kind === 'video' || c.kind === 'audio') && m && m.hasAudio; }

  /* ---------- fotogramas clave ---------- */
  function kfOf(c, prop) { const k = c.kf && c.kf[prop]; return k && k.length ? k : null; }
  function valueAt(c, prop, tRel, base) {
    const k = kfOf(c, prop);
    if (!k) return base === undefined ? c[prop] : base;
    if (tRel <= k[0].t) return k[0].v;
    for (let i = 1; i < k.length; i++) {
      if (tRel <= k[i].t) { const a = k[i - 1], b = k[i]; return a.v + (b.v - a.v) * ((tRel - a.t) / Math.max(1e-6, b.t - a.t)); }
    }
    return k[k.length - 1].v;
  }
  const n = (v) => (Math.round(v * 1e5) / 1e5).toString();
  /* Expresión FFmpeg equivalente a valueAt; `off` = tiempo global del inicio del clip (0 para audio). */
  function kfExpr(c, prop, off, base) {
    const k = kfOf(c, prop);
    if (!k) return n(base === undefined ? c[prop] : base);
    let e = n(k[k.length - 1].v);
    for (let i = k.length - 1; i >= 1; i--) {
      const a = k[i - 1], b = k[i], ta = a.t + off, tb = b.t + off;
      e = `if(lt(t,${n(tb)}),${n(a.v)}+(${n(b.v - a.v)})*(t-${n(ta)})/${n(Math.max(1e-6, tb - ta))},${e})`;
    }
    return `if(lt(t,${n(k[0].t + off)}),${n(k[0].v)},${e})`;
  }
  /* Máscara animable: claves mx, my, mw, mh (el rastro del seguimiento de movimiento). */
  const MASK_KEYS = { x: 'mx', y: 'my', w: 'mw', h: 'mh' };
  function maskAt(c, tRel) {
    const m = c.mask;
    return { shape: m.shape, feather: m.feather, invert: m.invert, x: valueAt(c, 'mx', tRel, m.x), y: valueAt(c, 'my', tRel, m.y), w: valueAt(c, 'mw', tRel, m.w), h: valueAt(c, 'mh', tRel, m.h) };
  }
  const maskAnimated = (c) => !!(kfOf(c, 'mx') || kfOf(c, 'my') || kfOf(c, 'mw') || kfOf(c, 'mh'));
  function nextTrans(track, clip) {
    const end = clip.start + clip.dur;
    return track.clips.find((q) => q !== clip && Math.abs(q.start - end) < 0.02 && OVERLAP[q.transIn.type]) || null;
  }
  function setKey(c, prop, tRel, v) {
    const k = (c.kf[prop] = c.kf[prop] || []);
    const hit = k.find((p) => Math.abs(p.t - tRel) < 0.03);
    if (hit) hit.v = v; else { k.push({ t: tRel, v }); k.sort((a, b) => a.t - b.t); }
  }

  /* ---------- geometría ---------- */
  function mediaSize(p, c) {
    const m = p.media[c.mediaId];
    if (c.kind === 'title' || c.kind === 'title3d' || c.kind === 'color' || !m || !m.width) return { w: p.width, h: p.height };
    return { w: m.width, h: m.height };
  }
  /* Caja ajustada del clip antes de escala/rotación del usuario, en píxeles del lienzo. */
  function fitBox(p, c) {
    const W = p.width, H = p.height, s = mediaSize(p, c);
    const sw = s.w * (1 - c.crop.l - c.crop.r), sh = s.h * (1 - c.crop.t - c.crop.b);
    const R = c.frame ? { x: c.frame.x * W, y: c.frame.y * H, w: c.frame.w * W, h: c.frame.h * H } : { x: 0, y: 0, w: W, h: H };
    const cover = c.fit === 'cover';
    const k = cover ? Math.max(R.w / sw, R.h / sh) : Math.min(R.w / sw, R.h / sh);
    const even = (v) => Math.max(2, Math.round(v / 2) * 2);
    const scw = even(sw * k), sch = even(sh * k);
    return { cx: R.x + R.w / 2, cy: R.y + R.h / 2, scw, sch, bw: cover ? Math.min(scw, even(R.w)) : scw, bh: cover ? Math.min(sch, even(R.h)) : sch, cover, sw, sh };
  }
  /* Estado animado del clip en el instante global t. */
  function clipState(p, track, c, t) {
    const r = t - c.start;
    let x = valueAt(c, 'x', r), y = valueAt(c, 'y', r), scale = valueAt(c, 'scale', r);
    let alpha = valueAt(c, 'opacity', r) * track.opacity, black = 0, wx = 0, wy = 0;
    const ap = (type, f, sign) => {
      if (type === 'fade') alpha *= f;
      else if (type === 'black') black = Math.max(black, 1 - f);
      else if (type === 'slideL') x += sign * (1 - f);
      else if (type === 'slideR') x -= sign * (1 - f);
      else if (type === 'slideU') y += sign * (1 - f);
      else if (type === 'slideD') y -= sign * (1 - f);
      else if (type === 'zoom') { scale *= 0.2 + 0.8 * f; alpha *= f; }
      else if (type === 'morph') { scale *= 1.15 - 0.15 * f; alpha *= f; }
      else if (WIPES[type]) { wx += sign * WIPES[type][0] * (1 - f); wy += sign * WIPES[type][1] * (1 - f); }
    };
    if (c.transIn.type !== 'none') ap(c.transIn.type, clamp(r / Math.max(0.01, c.transIn.dur), 0, 1), 1);
    if (c.transOut.type !== 'none') ap(c.transOut.type, clamp((c.dur - r) / Math.max(0.01, c.transOut.dur), 0, 1), -1);
    if (r > c.dur) { const nx = nextTrans(track, c); if (nx && nx.transIn.type === 'morph') scale *= 1 + 0.15 * clamp((r - c.dur) / Math.max(0.01, nx.transIn.dur), 0, 1); }
    return { x, y, scale, rotation: valueAt(c, 'rotation', r), alpha: clamp(alpha, 0, 1), black, wx, wy, src: sourceTime(p, c, r) };
  }
  function sourceTime(p, c, r) {
    const m = p.media[c.mediaId];
    const span = c.dur * c.speed;
    let s = c.reverse ? c.in + span - r * c.speed : c.in + r * c.speed;
    if (m && m.duration) s = clamp(s, 0, Math.max(0, m.duration - 0.03));
    return Math.max(0, s);
  }

  /* ---------- atenuación automática (ducking) ---------- */
  function voiceIntervals(p) {
    const iv = [];
    for (const t of p.tracks) if (t.role === 'voz' && !t.muted) for (const c of t.clips) if (hasAudio(p, c) && !c.muted) iv.push([c.start, c.start + c.dur]);
    return iv;
  }
  const DUCK_RAMP = 0.4;
  function duckGain(p, track, t) {
    if (!p.duck.enabled || track.role === 'voz') return 1;
    let g = 1;
    for (const [a, b] of voiceIntervals(p)) {
      const f = clamp(Math.min((t - (a - DUCK_RAMP)) / DUCK_RAMP, (b + DUCK_RAMP - t) / DUCK_RAMP), 0, 1);
      g = Math.min(g, 1 - (1 - p.duck.level) * f);
    }
    return g;
  }

  /* ---------- color ---------- */
  function hexRgb(h) { const v = parseInt((h || '#000000').replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
  function colorIsDefault(c) {
    const d = defaultColor();
    return c.exposure === 0 && c.brightness === 0 && c.contrast === 0 && c.saturation === 0 && c.hue === 0 && c.temperature === 0 && c.tint === 0 && c.gamma === 1 &&
      c.look === 'none' && !c.selective.enabled && !c.lut && JSON.stringify([c.shadows, c.mids, c.highs, c.curve]) === JSON.stringify([d.shadows, d.mids, d.highs, d.curve]);
  }
  function curveAt(curve, v) {
    if (v <= curve[0][0]) return curve[0][1];
    for (let i = 1; i < curve.length; i++) if (v <= curve[i][0]) { const a = curve[i - 1], b = curve[i]; return a[1] + (b[1] - a[1]) * ((v - a[0]) / Math.max(1e-6, b[0] - a[0])); }
    return curve[curve.length - 1][1];
  }
  function rgbHue(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 1e-5) return -1;
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  }
  function sampleLut(lut, r, g, b) {
    const N = lut.size, d = lut.data, f = N - 1;
    const x = clamp(r, 0, 1) * f, y = clamp(g, 0, 1) * f, z = clamp(b, 0, 1) * f;
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), x1 = Math.min(f, x0 + 1), y1 = Math.min(f, y0 + 1), z1 = Math.min(f, z0 + 1);
    const fx = x - x0, fy = y - y0, fz = z - z0, o = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const at = (i, j, l) => d[(i + j * N + l * N * N) * 3 + k];
      const c00 = at(x0, y0, z0) * (1 - fx) + at(x1, y0, z0) * fx, c10 = at(x0, y1, z0) * (1 - fx) + at(x1, y1, z0) * fx;
      const c01 = at(x0, y0, z1) * (1 - fx) + at(x1, y0, z1) * fx, c11 = at(x0, y1, z1) * (1 - fx) + at(x1, y1, z1) * fx;
      o[k] = (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
    }
    return o;
  }
  /* Etalonaje completo: una sola función usada por la vista previa y por la exportación (LUT 3D). */
  function grade(c, r, g, b) {
    const ex = Math.pow(2, c.exposure);
    r *= ex * (1 + c.temperature * 0.25); g *= ex * (1 + c.tint * 0.2); b *= ex * (1 - c.temperature * 0.25);
    let l = clamp(0.2126 * r + 0.7152 * g + 0.0722 * b, 0, 1);
    const ws = (1 - l) * (1 - l), wh = l * l, wm = 4 * l * (1 - l);
    r += 0.5 * (c.shadows[0] * ws + c.mids[0] * wm + c.highs[0] * wh) + c.brightness;
    g += 0.5 * (c.shadows[1] * ws + c.mids[1] * wm + c.highs[1] * wh) + c.brightness;
    b += 0.5 * (c.shadows[2] * ws + c.mids[2] * wm + c.highs[2] * wh) + c.brightness;
    const k = 1 + c.contrast;
    r = (r - 0.5) * k + 0.5; g = (g - 0.5) * k + 0.5; b = (b - 0.5) * k + 0.5;
    const ig = 1 / Math.max(0.05, c.gamma);
    r = Math.pow(clamp(r, 0, 1), ig); g = Math.pow(clamp(g, 0, 1), ig); b = Math.pow(clamp(b, 0, 1), ig);
    if (c.curve.length > 2 || c.curve[0][1] !== 0 || c.curve[c.curve.length - 1][1] !== 1) { r = curveAt(c.curve, r); g = curveAt(c.curve, g); b = curveAt(c.curve, b); }
    if (c.hue) {
      const a = c.hue * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
      const nr = (0.213 + 0.787 * cs - 0.213 * sn) * r + (0.715 - 0.715 * cs - 0.715 * sn) * g + (0.072 - 0.072 * cs + 0.928 * sn) * b;
      const ng = (0.213 - 0.213 * cs + 0.143 * sn) * r + (0.715 + 0.285 * cs + 0.140 * sn) * g + (0.072 - 0.072 * cs - 0.283 * sn) * b;
      const nb = (0.213 - 0.213 * cs - 0.787 * sn) * r + (0.715 - 0.715 * cs + 0.715 * sn) * g + (0.072 + 0.928 * cs + 0.072 * sn) * b;
      r = nr; g = ng; b = nb;
    }
    l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let sat = 1 + c.saturation;
    if (c.selective.enabled) {
      const h = rgbHue(r, g, b);
      let d = h < 0 ? 180 : Math.abs(h - c.selective.hue); if (d > 180) d = 360 - d;
      sat *= 1 - clamp((d - c.selective.range) / 15, 0, 1);
    }
    r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
    switch (c.look) {
      case 'bw': r = g = b = l; break;
      case 'noir': r = g = b = clamp((l - 0.5) * 1.6 + 0.45, 0, 1); break;
      case 'sepia': r = l * 1.07 + 0.04; g = l * 0.92 + 0.02; b = l * 0.72; break;
      case 'vintage': r = r * 0.9 + 0.1; g = g * 0.85 + 0.08; b = b * 0.7 + 0.12; break;
      case 'cool': r *= 0.9; b = b * 1.08 + 0.03; break;
      case 'warm': r = r * 1.08 + 0.02; b *= 0.88; break;
      case 'tealorange': { const w = clamp(l, 0, 1); r += 0.10 * (w - 0.45); g += 0.02 * (0.5 - w); b += 0.14 * (0.45 - w); break; }
      case 'bleach': { const m = 0.55; r = (l + (r - l) * m - 0.5) * 1.35 + 0.5; g = (l + (g - l) * m - 0.5) * 1.35 + 0.5; b = (l + (b - l) * m - 0.5) * 1.35 + 0.5; break; }
      case 'invert': r = 1 - r; g = 1 - g; b = 1 - b; break;
      case 'poster': r = Math.round(clamp(r, 0, 1) * 4) / 4; g = Math.round(clamp(g, 0, 1) * 4) / 4; b = Math.round(clamp(b, 0, 1) * 4) / 4; break;
      case 'dream': r = r * 0.85 + 0.15; g = g * 0.85 + 0.13; b = b * 0.85 + 0.17; break;
    }
    r = clamp(r, 0, 1); g = clamp(g, 0, 1); b = clamp(b, 0, 1);
    return c.lut ? sampleLut(c.lut, r, g, b) : [r, g, b];
  }
  function buildLut(c, N) {
    N = N || 33;
    const data = new Float32Array(N * N * N * 3);
    let i = 0;
    for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
      const o = grade(c, r / (N - 1), g / (N - 1), b / (N - 1));
      data[i++] = o[0]; data[i++] = o[1]; data[i++] = o[2];
    }
    return { size: N, data };
  }
  function lutToCube(lut) {
    const out = ['TITLE "MontajeMX"', 'LUT_3D_SIZE ' + lut.size];
    for (let i = 0; i < lut.data.length; i += 3) out.push(lut.data[i].toFixed(5) + ' ' + lut.data[i + 1].toFixed(5) + ' ' + lut.data[i + 2].toFixed(5));
    return out.join('\n') + '\n';
  }
  function parseCube(text) {
    let size = 0; const vals = [];
    for (const line of text.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s[0] === '#') continue;
      if (/^LUT_3D_SIZE/i.test(s)) { size = parseInt(s.split(/\s+/)[1], 10); continue; }
      if (/^[A-Za-z_]/.test(s)) continue;
      const p = s.split(/\s+/).map(Number);
      if (p.length >= 3 && p.every((v) => !isNaN(v))) vals.push(p[0], p[1], p[2]);
    }
    if (!size || vals.length !== size * size * size * 3) throw new Error('Archivo .cube no válido');
    return { size, data: Array.from(vals) };
  }

  /* ---------- croma y máscara (misma fórmula que FFmpeg) ---------- */
  function yuv(r, g, b) { return [0.299 * r + 0.587 * g + 0.114 * b, -0.169 * r - 0.331 * g + 0.5 * b + 128, 0.5 * r - 0.419 * g - 0.081 * b + 128]; }
  function chromaAlpha(ch, key, r, g, b) {
    const p = yuv(r, g, b), du = p[1] - key[1], dv = p[2] - key[2];
    const d = Math.sqrt((du * du + dv * dv) / (255 * 255 * 2));
    if (ch.blend > 0.0001) return clamp((d - ch.similarity) / ch.blend, 0, 1);
    return d > ch.similarity ? 1 : 0;
  }
  function maskAlpha(m, u, v) {
    const dx = Math.abs(u - m.x) / (m.w / 2), dy = Math.abs(v - m.y) / (m.h / 2);
    const d = m.shape === 'rect' ? Math.max(dx, dy) : Math.sqrt(dx * dx + dy * dy);
    const a = m.feather > 0.001 ? clamp((1 - d) / m.feather, 0, 1) : (d <= 1 ? 1 : 0);
    return m.invert ? 1 - a : a;
  }

  return { WIPES, FONTS3D, ANIMS3D, SURROUND, MASK_KEYS, maskAt, maskAnimated, nextTrans, uid, clamp, n, BLENDS, BLEND_NAMES, TRANSITIONS, OVERLAP, LOOKS, KF_PROPS, DUCK_RAMP, defaultColor, defaultFx, newProject, newTrack, newClip,
    projectDuration, tailExt, isVisual, hasAudio, kfOf, valueAt, kfExpr, setKey, mediaSize, fitBox, clipState, sourceTime,
    voiceIntervals, duckGain, hexRgb, colorIsDefault, grade, buildLut, lutToCube, parseCube, yuv, chromaAlpha, maskAlpha };
});
