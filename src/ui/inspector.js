/* MontajeMX — inspector de propiedades del clip seleccionado.
 * Copyright (C) 2026 Santiago Miguel — GPL-3.0-or-later. */
'use strict';
const Inspector = (() => {
  let binds = [];
  const open = { Clip: true, 'Título': true, Transformar: true };
  const relT = (c) => MMX.clamp(S.t - c.start, 0, c.dur);
  /* Si la propiedad tiene fotogramas clave, escribe uno en el cursor; si no, cambia el valor base. */
  function setMask(c, key, v) { const k = MMX.MASK_KEYS[key]; if (MMX.kfOf(c, k)) MMX.setKey(c, k, relT(c), v); else c.mask[key] = v; }
  function setProp(c, prop, v) { if (MMX.kfOf(c, prop)) MMX.setKey(c, prop, relT(c), v); else c[prop] = v; }
  function sync() { for (const b of binds) { const v = b.get(); if (document.activeElement !== b.num) b.num.value = +(+v).toFixed(3); if (document.activeElement !== b.rng) b.rng.value = v; if (b.kf) b.kf(); } }

  function section(name, ...rows) { const d = h('details', { open: !!open[name], ontoggle: (e) => { open[name] = e.target.open; } }, h('summary', {}, name), rows); return d; }
  function slider(label, get, set, min, max, step, o) {
    o = o || {}; const c = o.clip, key = (o.key || label) + (c ? c.id : '');
    const apply = (v) => { if (isNaN(v)) return; mutate(key, () => set(v), { light: true }); };
    const rng = h('input', { type: 'range', min, max, step, value: get(), oninput: (e) => { num.value = e.target.value; apply(+e.target.value); if (kfUpd) kfUpd(); }, ondblclick: () => { if (o.def != null) { apply(o.def); sync(); } }, title: o.def != null ? 'Doble clic para restablecer' : '' });
    const num = h('input', { type: 'number', min: o.hardMin != null ? o.hardMin : min, max: o.hardMax != null ? o.hardMax : max, step, value: +(+get()).toFixed(3), onchange: (e) => { apply(+e.target.value); rng.value = e.target.value; } });
    let kb = h('span'), kfUpd = null;
    if (o.kf) {
      kb = h('button', { class: 'kf', title: 'Fotograma clave en el cursor', onclick: () => {
        mutate(null, () => { const k = c.kf[o.kf] || [], t = relT(c), i = k.findIndex((q) => Math.abs(q.t - t) < 0.03); if (i >= 0) { k.splice(i, 1); if (!k.length) delete c.kf[o.kf]; } else MMX.setKey(c, o.kf, t, MMX.valueAt(c, o.kf, t, o.kfBase ? o.kfBase() : undefined)); });
      } }, '◆');
      kfUpd = () => { const k = MMX.kfOf(c, o.kf); kb.className = 'kf' + (k ? (k.some((q) => Math.abs(q.t - relT(c)) < 0.03) ? ' at' : ' has') : ''); };
      kfUpd();
    }
    binds.push({ rng, num, get, kf: kfUpd });
    return h('div', { class: 'row' }, h('label', { title: label }, label), rng, num, kb);
  }
  const wide = (label, ...kids) => h('div', { class: 'row' }, h('label', {}, label), h('div', { class: 'wide' }, kids));
  const sel = (opts, val, on) => h('select', { onchange: (e) => on(e.target.value) }, Object.keys(opts).map((k) => h('option', { value: k, selected: k === String(val) }, opts[k])));
  const chk = (label, val, on) => h('label', { class: 'chk', style: { margin: 0 } }, h('input', { type: 'checkbox', checked: !!val, onchange: (e) => on(e.target.checked) }), label);
  const colorIn = (val, on, key) => h('input', { type: 'color', value: (val || '#000000').slice(0, 7), oninput: (e) => mutate(key, () => on(e.target.value), { light: true }) });
  const M = (fn) => mutate(null, fn);

  /* Rueda de color: desplaza sombras / medios / luces hacia un tono. */
  function wheel(label, arr, key) {
    const cv = h('canvas', { class: 'pad', width: 80, height: 80, title: 'Arrastra para teñir · doble clic para restablecer' }), g = cv.getContext('2d');
    const paint = () => {
      g.clearRect(0, 0, 80, 80);
      for (let a = 0; a < 360; a += 6) { g.beginPath(); g.moveTo(40, 40); g.arc(40, 40, 39, (a - 3.5) * Math.PI / 180, (a + 3.5) * Math.PI / 180); g.fillStyle = `hsla(${(360 - a + 360) % 360},80%,55%,.45)`; g.fill(); }
      g.beginPath(); g.arc(40, 40, 22, 0, 7); g.fillStyle = '#12141a'; g.fill();
      const x = arr[0], y = (arr[1] - arr[2]) / Math.sqrt(3); g.beginPath(); g.arc(40 + x * 78, 40 - y * 78, 5, 0, 7); g.fillStyle = '#fff'; g.fill(); g.strokeStyle = '#000'; g.stroke();
    };
    const setAt = (e) => { const r = cv.getBoundingClientRect(); let x = (e.clientX - r.left - 40) / 78, y = -(e.clientY - r.top - 40) / 78; const m = Math.hypot(x, y); if (m > 0.5) { x *= 0.5 / m; y *= 0.5 / m; } const rad = Math.hypot(x, y), an = Math.atan2(y, x);
      mutate(key, () => { arr[0] = +(rad * Math.cos(an)).toFixed(3); arr[1] = +(rad * Math.cos(an - 2.0944)).toFixed(3); arr[2] = +(rad * Math.cos(an + 2.0944)).toFixed(3); }, { light: true }); paint(); };
    cv.addEventListener('pointerdown', (e) => { setAt(e); const mv = (ev) => setAt(ev); window.addEventListener('pointermove', mv); window.addEventListener('pointerup', () => window.removeEventListener('pointermove', mv), { once: true }); });
    cv.addEventListener('dblclick', () => { mutate(null, () => { arr[0] = arr[1] = arr[2] = 0; }, { light: true }); paint(); });
    paint(); return h('div', {}, cv, label);
  }
  function curveEditor(c) {
    const W = 296, H = 150, cv = h('canvas', { class: 'curve', width: W, height: H, title: 'Clic para añadir un punto · arrastra · doble clic para quitar' }), g = cv.getContext('2d'), pts = () => c.color.curve;
    const paint = () => { g.clearRect(0, 0, W, H); g.strokeStyle = '#2c313c'; g.lineWidth = 1; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(i * W / 4, 0); g.lineTo(i * W / 4, H); g.moveTo(0, i * H / 4); g.lineTo(W, i * H / 4); g.stroke(); }
      g.strokeStyle = '#5fd4b8'; g.lineWidth = 2; g.beginPath(); pts().forEach((q, i) => { const x = q[0] * W, y = H - q[1] * H; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke();
      g.fillStyle = '#fff'; pts().forEach((q) => { g.beginPath(); g.arc(q[0] * W, H - q[1] * H, 4, 0, 7); g.fill(); }); };
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [MMX.clamp((e.clientX - r.left) / r.width, 0, 1), MMX.clamp(1 - (e.clientY - r.top) / r.height, 0, 1)]; };
    const near = (q) => pts().findIndex((a) => Math.hypot((a[0] - q[0]) * W, (a[1] - q[1]) * H) < 10);
    cv.addEventListener('pointerdown', (e) => {
      const q = pos(e); let i = near(q);
      if (i < 0) { mutate(null, () => { pts().push([+q[0].toFixed(3), +q[1].toFixed(3)]); pts().sort((a, b) => a[0] - b[0]); }, { light: true }); i = near(q); }
      const mv = (ev) => { const n = pos(ev), a = pts(); mutate('curve' + c.id, () => { const lo = i > 0 ? a[i - 1][0] + 0.01 : 0, hi = i < a.length - 1 ? a[i + 1][0] - 0.01 : 1; a[i] = [i === 0 ? 0 : i === a.length - 1 ? 1 : +MMX.clamp(n[0], lo, hi).toFixed(3), +n[1].toFixed(3)]; }, { light: true }); paint(); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', () => window.removeEventListener('pointermove', mv), { once: true }); paint();
    });
    cv.addEventListener('dblclick', (e) => { const i = near(pos(e)), a = pts(); if (i > 0 && i < a.length - 1) { mutate(null, () => a.splice(i, 1), { light: true }); paint(); } });
    paint(); return cv;
  }

  function render() {
    binds = []; const body = $('#insp-body'), s = selected(), keepScroll = body.scrollTop;
    if (!s) {
      const p = S.p, n = p.tracks.reduce((a, t) => a + t.clips.length, 0);
      body.replaceChildren(h('details', { open: true }, h('summary', {}, 'Proyecto'), wide('Nombre', p.name), wide('Formato', `${p.width}×${p.height} · ${p.fps} fps`), wide('Duración', timecode(duration())), wide('Contenido', `${p.tracks.length} pistas · ${n} clips`)),
        h('p', { class: 'hint', style: { marginTop: '14px' } }, 'Selecciona un clip para editar su transformación, color, efectos, máscara, transiciones y audio.'),
        h('p', { class: 'hint' }, 'Atajos: Espacio reproducir · S dividir · Supr eliminar · ← → fotograma · Ctrl+Z deshacer · Ctrl+D duplicar · Ctrl+rueda zoom.'));
      return;
    }
    const c = s.clip, m = S.p.media[c.mediaId], vis = MMX.isVisual(c), timed = c.kind === 'video' || c.kind === 'audio', out = [];
    const S1 = (label, prop, min, max, step, def, extra) => slider(label, () => c[prop], (v) => { c[prop] = v; }, min, max, step, Object.assign({ clip: c, def, key: prop }, extra));
    const K = (label, prop, min, max, step, def, extra) => slider(label, () => MMX.valueAt(c, prop, relT(c)), (v) => setProp(c, prop, v), min, max, step, Object.assign({ clip: c, kf: prop, def, key: prop }, extra));
    const MK = (label, key, min, max, def) => slider(label, () => MMX.maskAt(c, relT(c))[key], (v) => setMask(c, key, v), min, max, 0.005, { clip: c, def, key: 'mask' + key, kf: MMX.MASK_KEYS[key], kfBase: () => c.mask[key] });
    const O = (obj, label, prop, min, max, step, def) => slider(label, () => obj[prop], (v) => { obj[prop] = v; }, min, max, step, { clip: c, def, key: label + prop });

    out.push(section('Clip',
      wide('Origen', c.kind === 'title' ? 'Título' : c.kind === 'title3d' ? 'Título 3D' : c.kind === 'color' ? 'Fondo de color' : (m ? m.name : 'Medio no encontrado')),
      slider('Inicio (s)', () => c.start, (v) => { c.start = firstFree(s.track, Math.max(0, v), c.dur, c.id); }, 0, Math.max(60, duration()), 0.01, { clip: c, key: 'start' }),
      !timed ? slider('Duración (s)', () => c.dur, (v) => { const nx = s.track.clips.filter((q) => q.start > c.start).reduce((a, q) => Math.min(a, q.start), Infinity); c.dur = MMX.clamp(v, 0.1, nx - c.start); }, 0.1, 60, 0.1, { clip: c, key: 'dur', hardMax: 3600 }) : null,
      timed ? slider('Velocidad', () => c.speed, (v) => { v = MMX.clamp(v, 0.1, 10); const span = c.dur * c.speed, nx = s.track.clips.filter((q) => q.start > c.start).reduce((a, q) => Math.min(a, q.start), Infinity); let d = span / v; if (c.start + d > nx) return; c.dur = d; c.speed = v; }, 0.1, 4, 0.05, { clip: c, key: 'speed', def: 1, hardMax: 10 }) : null,
      timed ? wide('', chk('Reproducir al revés', c.reverse, (v) => M(() => { c.reverse = v; }))) : null,
      c.kind === 'color' ? wide('Color', colorIn(c.fill, (v) => { c.fill = v; }, 'fill' + c.id)) : null));

    if (c.kind === 'title') {
      const t = c.title;
      out.push(section('Título',
        wide('Texto', h('textarea', { rows: 3, oninput: (e) => mutate('ttext' + c.id, () => { t.text = e.target.value; }, { light: true }) }, t.text)),
        wide('Fuente', sel({ 'Helvetica, Arial, sans-serif': 'Sans', 'Georgia, "Times New Roman", serif': 'Serif', '"Courier New", monospace': 'Mono', 'Impact, "Arial Black", sans-serif': 'Impacto', '"Trebuchet MS", Verdana, sans-serif': 'Humanista', '"Brush Script MT", "Comic Sans MS", cursive': 'Manuscrita' }, t.font, (v) => M(() => { t.font = v; }))),
        O(t, 'Tamaño', 'size', 12, 400, 1, 96),
        wide('Estilo', chk('Negrita', t.bold, (v) => M(() => { t.bold = v; })), chk('Cursiva', t.italic, (v) => M(() => { t.italic = v; })), sel({ left: 'Izquierda', center: 'Centro', right: 'Derecha' }, t.align, (v) => M(() => { t.align = v; }))),
        wide('Colores', colorIn(t.color, (v) => { t.color = v; }, 'tc' + c.id), 'texto', colorIn(t.stroke, (v) => { t.stroke = v; }, 'ts' + c.id), 'borde'),
        O(t, 'Borde', 'strokeW', 0, 30, 1, 0), O(t, 'Sombra', 'shadow', 0, 40, 1, 6),
        wide('Fondo', chk('Caja de fondo', !!t.bg, (v) => M(() => { t.bg = v ? '#000000b0' : ''; })), t.bg ? colorIn(t.bg, (v) => { t.bg = v + 'b0'; }, 'tb' + c.id) : null),
        O(t, 'Texto X', 'px', 0, 1, 0.005, 0.5), O(t, 'Texto Y', 'py', 0, 1, 0.005, 0.5)));
    }
    if (c.kind === 'title3d') {
      const t = c.t3;
      out.push(section('Título 3D',
        wide('Texto', h('textarea', { rows: 2, oninput: (e) => mutate('t3text' + c.id, () => { t.text = e.target.value; }, { light: true }) }, t.text)),
        wide('Fuente', sel(MMX.FONTS3D, t.font, (v) => M(() => { t.font = v; }))),
        wide('Color', colorIn(t.color, (v) => { t.color = v; }, 't3c' + c.id)),
        O(t, 'Tamaño', 'size', 0.2, 3, 0.02, 1), O(t, 'Profundidad', 'depth', 0, 1.5, 0.01, 0.3), O(t, 'Bisel', 'bevel', 0, 0.12, 0.005, 0.03),
        O(t, 'Metálico', 'metal', 0, 1, 0.01, 0.55), O(t, 'Rugosidad', 'rough', 0.02, 1, 0.01, 0.3),
        O(t, 'Giro X °', 'rotX', -180, 180, 1, -8), O(t, 'Giro Y °', 'rotY', -180, 180, 1, 22), O(t, 'Giro Z °', 'rotZ', -180, 180, 1, 0), O(t, 'Luz °', 'light', -90, 90, 1, 40),
        wide('Animación', sel(MMX.ANIMS3D, t.anim, (v) => M(() => { t.anim = v; }))),
        h('p', { class: 'note' }, 'Además se puede mover, escalar, animar y combinar con transiciones como cualquier clip.')));
    }
    if (vis) {
      out.push(section('Transformar',
        K('Posición X', 'x', -1.5, 1.5, 0.005, 0), K('Posición Y', 'y', -1.5, 1.5, 0.005, 0), K('Escala', 'scale', 0.05, 4, 0.01, 1, { hardMax: 10 }), K('Rotación °', 'rotation', -360, 360, 1, 0), K('Opacidad', 'opacity', 0, 1, 0.01, 1),
        wide('Mezcla', sel(MMX.BLEND_NAMES, c.blend, (v) => M(() => { c.blend = v; }))),
        wide('Voltear', chk('Horizontal', c.flipH, (v) => M(() => { c.flipH = v; })), chk('Vertical', c.flipV, (v) => M(() => { c.flipV = v; }))),
        h('div', { class: 'btns' }, h('button', { onclick: () => M(() => { c.kf = Object.fromEntries(Object.entries(c.kf).filter(([k]) => k === 'volume')); c.x = c.y = c.rotation = 0; c.scale = c.opacity = 1; }) }, 'Restablecer'),
          h('button', { title: 'Zoom lento de 100 % a 120 % a lo largo del clip', onclick: () => M(() => { c.kf.scale = [{ t: 0, v: 1 }, { t: c.dur, v: 1.2 }]; }) }, 'Zoom lento'),
          h('button', { title: 'Paneo de izquierda a derecha con zoom', onclick: () => M(() => { c.kf.scale = [{ t: 0, v: 1.25 }, { t: c.dur, v: 1.25 }]; c.kf.x = [{ t: 0, v: 0.1 }, { t: c.dur, v: -0.1 }]; }) }, 'Paneo')),
        h('p', { class: 'note' }, '◆ añade o quita un fotograma clave en el cursor. También puedes arrastrar el clip en el visor.')));
      if (!c.kind.startsWith('title') && c.kind !== 'color') out.push(section('Recorte y encuadre',
        O(c.crop, 'Izquierda', 'l', 0, 0.9, 0.005, 0), O(c.crop, 'Derecha', 'r', 0, 0.9, 0.005, 0), O(c.crop, 'Arriba', 't', 0, 0.9, 0.005, 0), O(c.crop, 'Abajo', 'b', 0, 0.9, 0.005, 0),
        wide('Ajuste', sel({ contain: 'Completo (con bandas)', cover: 'Rellenar (recorta)' }, c.fit, (v) => M(() => { c.fit = v; })))));
      const col = c.color;
      out.push(section('Color',
        O(col, 'Exposición', 'exposure', -2, 2, 0.01, 0), O(col, 'Brillo', 'brightness', -0.5, 0.5, 0.005, 0), O(col, 'Contraste', 'contrast', -0.8, 1, 0.01, 0), O(col, 'Saturación', 'saturation', -1, 1.5, 0.01, 0),
        O(col, 'Tono °', 'hue', -180, 180, 1, 0), O(col, 'Temperatura', 'temperature', -1, 1, 0.01, 0), O(col, 'Tinte', 'tint', -1, 1, 0.01, 0), O(col, 'Gamma', 'gamma', 0.3, 3, 0.01, 1),
        h('div', { class: 'pads' }, wheel('Sombras', col.shadows, 'ws' + c.id), wheel('Medios', col.mids, 'wm' + c.id), wheel('Luces', col.highs, 'wh' + c.id)),
        h('p', { class: 'note' }, 'Curva de tonos'), curveEditor(c),
        wide('Look', sel(MMX.LOOKS, col.look, (v) => M(() => { col.look = v; }))),
        wide('Selectivo', chk('Conservar solo un color', col.selective.enabled, (v) => M(() => { col.selective.enabled = v; }))),
        col.selective.enabled ? O(col.selective, 'Tono a conservar', 'hue', 0, 360, 1, 0) : null, col.selective.enabled ? O(col.selective, 'Tolerancia', 'range', 5, 90, 1, 30) : null,
        wide('LUT', h('button', { onclick: async () => { const f = await api.invoke('file:pickText', 'LUT 3D', ['cube']); if (!f) return; try { const l = MMX.parseCube(f.text); l.name = f.name; M(() => { col.lut = l; }); } catch (e) { toast(e.message); } } }, col.lut ? (col.lut.name || 'LUT cargada') : 'Cargar .cube'), col.lut ? h('button', { onclick: () => M(() => { col.lut = null; }) }, 'Quitar') : null),
        h('div', { class: 'btns' }, h('button', { onclick: () => M(() => { c.color = MMX.defaultColor(); }) }, 'Restablecer color'))));
      const fx = c.fx;
      out.push(section('Efectos',
        O(fx, 'Desenfoque', 'blur', 0, 60, 0.5, 0), O(fx, 'Mosaico', 'mosaic', 0, 120, 1, 0), O(fx, 'Viñeta', 'vignette', 0, 1, 0.01, 0), O(fx, 'Grano', 'grain', 0, 40, 1, 0),
        h('p', { class: 'note' }, 'Los siguientes se aplican al exportar; revísalos con «Fotograma exacto».'),
        O(fx, 'Nitidez', 'sharpen', 0, 3, 0.05, 0), O(fx, 'Reducir ruido', 'denoise', 0, 10, 0.5, 0), O(fx, 'Corr. de lente', 'lens', -0.5, 0.5, 0.01, 0),
        c.kind === 'video' ? wide('Estabilizar', chk('Estabilizar imagen', fx.stabilize, (v) => M(() => { fx.stabilize = v; }))) : null,
        wide('Video 360°', sel({ none: 'No es 360°', flat: '360° → vista normal', planet: 'Pequeño planeta' }, fx.v360, (v) => M(() => { fx.v360 = v; }))),
        fx.v360 !== 'none' ? O(fx, 'Giro (yaw)', 'yaw', -180, 180, 1, 0) : null, fx.v360 !== 'none' ? O(fx, 'Inclinación', 'pitch', -90, 90, 1, 0) : null));
      if (!c.kind.startsWith('title') && c.kind !== 'color') out.push(section('Croma (pantalla verde)',
        wide('', chk('Activar croma', c.chroma.enabled, (v) => M(() => { c.chroma.enabled = v; })), colorIn(c.chroma.color, (v) => { c.chroma.color = v; }, 'ck' + c.id)),
        O(c.chroma, 'Tolerancia', 'similarity', 0.01, 0.6, 0.005, 0.18), O(c.chroma, 'Suavizado', 'blend', 0, 0.4, 0.005, 0.08)));
      const mk = c.mask;
      out.push(section('Máscara',
        wide('Forma', sel({ none: 'Sin máscara', ellipse: 'Elipse', rect: 'Rectángulo' }, mk ? mk.shape : 'none', (v) => M(() => { c.mask = v === 'none' ? null : Object.assign({ x: 0.5, y: 0.5, w: 0.6, h: 0.6, feather: 0.1, invert: false }, c.mask, { shape: v }); }))),
        mk ? [MK('Centro X', 'x', 0, 1, 0.5), MK('Centro Y', 'y', 0, 1, 0.5), MK('Ancho', 'w', 0.02, 2, 0.6), MK('Alto', 'h', 0.02, 2, 0.6), O(mk, 'Difuminado', 'feather', 0, 1, 0.01, 0.1), wide('', chk('Invertir', mk.invert, (v) => M(() => { mk.invert = v; }))),
          h('p', { class: 'note' }, 'Mayús + arrastrar en el visor mueve la máscara.'),
          c.kind === 'video' ? h('div', { class: 'btns' },
            h('button', { title: 'Coloca la máscara sobre el objeto en el fotograma actual y pulsa: la máscara lo seguirá durante todo el clip', onclick: () => trackUI(s, false) }, 'Seguir movimiento'),
            h('button', { title: 'Sigue posición y tamaño (objetos que se acercan o se alejan)', onclick: () => trackUI(s, true) }, 'Seguimiento inteligente'),
            MMX.maskAnimated(c) ? h('button', { onclick: () => M(() => { for (const k of Object.values(MMX.MASK_KEYS)) delete c.kf[k]; }) }, 'Borrar rastro') : null) : null,
          MMX.maskAnimated(c) ? followRow(s) : null] : h('p', { class: 'note' }, 'La máscara recorta el clip a una forma. Con «Censurar» se crea una región de mosaico lista para tapar rostros o matrículas.')));
      out.push(section('Transiciones',
        wide('Entrada', sel(MMX.TRANSITIONS, c.transIn.type, (v) => M(() => { c.transIn.type = v; }))), O(c.transIn, 'Duración ent.', 'dur', 0.1, 5, 0.1, 1),
        wide('Salida', sel(MMX.TRANSITIONS, c.transOut.type, (v) => M(() => { c.transOut.type = v; }))), O(c.transOut, 'Duración sal.', 'dur', 0.1, 5, 0.1, 1)));
    }
    if (MMX.hasAudio(S.p, c)) out.push(section('Audio',
      K('Volumen', 'volume', 0, 2, 0.01, 1), wide('', chk('Silenciar clip', c.muted, (v) => M(() => { c.muted = v; }))),
      S1('Entrada gradual', 'fadeIn', 0, 10, 0.1, 0), S1('Salida gradual', 'fadeOut', 0, 10, 0.1, 0), S1('Balance I/D', 'pan', -1, 1, 0.05, 0),
      h('p', { class: 'note' }, 'Los siguientes se aplican al exportar.'),
      S1('Tono (semitonos)', 'pitch', -12, 12, 1, 0), S1('Graves dB', 'bass', -15, 15, 1, 0), S1('Agudos dB', 'treble', -15, 15, 1, 0),
      wide('', chk('Reducir ruido de fondo', c.denoiseAudio, (v) => M(() => { c.denoiseAudio = v; }))),
      c.kind === 'video' ? h('div', { class: 'btns' }, h('button', { title: 'Copia el audio a un clip independiente en otra pista', onclick: () => M(() => { const a = JSON.parse(JSON.stringify(c)); a.id = MMX.uid('c'); a.kind = 'audio'; a.kf = c.kf.volume ? { volume: c.kf.volume } : {}; a.transIn = { type: 'none', dur: 1 }; a.transOut = { type: 'none', dur: 1 }; let tr = S.p.tracks.slice(s.ti + 1).find((t) => !t.locked && !overlaps(t, a.start, a.dur)); if (!tr) tr = addTrack(); tr.clips.push(a); c.muted = true; }) }, 'Separar audio')) : null));
    body.replaceChildren(...out.filter(Boolean)); body.scrollTop = keepScroll;
  }
  /* Lanza el seguimiento con barra de progreso y posibilidad de cancelar. */
  async function trackUI(s, smart) {
    const c = s.clip; let cancel = false;
    if (!(S.t >= c.start && S.t <= c.start + c.dur)) return toast('Pon el cursor dentro del clip, con la máscara sobre el objeto a seguir');
    Preview.pause();
    const bar = h('div', { class: 'bar' }, h('i')), msg = h('p', { class: 'note' }, 'Analizando fotogramas…');
    Dialogs.open(smart ? 'Seguimiento inteligente' : 'Seguimiento de movimiento', h('div', {}, msg, bar), h('button', { onclick: () => { cancel = true; } }, 'Cancelar'), false);
    try {
      const r = await Tracker.run(c, smart, (f) => { bar.firstChild.style.width = (f * 100).toFixed(0) + '%'; }, () => cancel);
      Dialogs.closable = true; Dialogs.close();
      if (!r) return toast('Seguimiento cancelado');
      mutate(null, () => { c.kf.mx = r.mx; c.kf.my = r.my; if (r.mw) { c.kf.mw = r.mw; c.kf.mh = r.mh; } });
      toast(r.lost > r.frames * 0.3 ? 'Rastro creado, pero el objeto se perdió en varios fotogramas: revísalo y corrige con ◆' : `Rastro creado (${r.mx.length} puntos). Revísalo reproduciendo el clip.`, 5000);
    } catch (e) { Dialogs.closable = true; Dialogs.close(); Dialogs.error('No se pudo seguir el movimiento', String(e.message || e)); }
  }
  function followRow(s) {
    const c = s.clip, opts = {};
    for (const tr of S.p.tracks) for (const q of tr.clips) if (q.id !== c.id && MMX.isVisual(q) && q.start < c.start + c.dur && q.start + q.dur > c.start) opts[q.id] = clipLabel(q);
    if (!Object.keys(opts).length) return h('p', { class: 'note' }, 'Para que un título o imagen siga este rastro, colócalo en otra pista durante este clip.');
    const pick = sel(opts, Object.keys(opts)[0], () => {});
    return wide('Que lo siga', pick, h('button', { onclick: () => { const f = findClip(pick.value); if (!f) return; let n = 0; mutate(null, () => { n = Tracker.attach(c, s.track, f.clip); }); toast(n ? 'El clip ahora sigue el rastro' : 'No coinciden en el tiempo'); } }, 'Aplicar'));
  }
  return { render, sync, setProp, setMask };
})();
function renderInspector() { Inspector.render(); }
