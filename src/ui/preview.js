/* MontajeMX — compositor de vista previa en tiempo real (canvas 2D + elementos de vídeo).
 * Usa las mismas fórmulas que el motor de exportación (core/model.js).
 * Copyright (C) 2026 Santiago Miguel — GPL-3.0-or-later. */
'use strict';
const Preview = (() => {
  let cv, ctx, scratch, sctx, tiny, tctx, need = 6, last = 0, frameNo = 0;
  const els = new Map(), imgs = new Map(), titles = new Map(), luts = new Map(), masks = new Map();

  function init() {
    cv = $('#view'); ctx = cv.getContext('2d');
    scratch = document.createElement('canvas'); sctx = scratch.getContext('2d', { willReadFrequently: true });
    tiny = document.createElement('canvas'); tctx = tiny.getContext('2d');
    $('#quality').addEventListener('change', () => { resize(); });
    resize(); initPointer(); requestAnimationFrame(loop);
  }
  function resize() { const w = +$('#quality').value; cv.width = w; cv.height = Math.round(w * S.p.height / S.p.width); titles.clear(); invalidate(); }
  function invalidate() { need = 8; }

  function loop(now) {
    if (S.playing) {
      S.t += (now - last) / 1000;
      const d = duration();
      if (S.t >= d) { S.t = d; pause(); }
      movePlayhead();
      const sc = $('#tl-scroll'), x = S.t * S.zoom;
      if (x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = x - 80;
      if (frameNo % 6 === 0) Inspector.sync();
    }
    last = now;
    if (S.playing || need > 0) { need--; draw(); }
    frameNo++;
    requestAnimationFrame(loop);
  }
  function play() { if (duration() <= 0) return; if (S.t >= duration() - 0.01) S.t = 0; S.playing = true; $('#btn-play').textContent = '❚❚'; $('#exact').hidden = true; last = performance.now(); }
  function pause() { S.playing = false; $('#btn-play').textContent = '▶'; for (const e of els.values()) e.el.pause(); invalidate(); }
  const toggle = () => (S.playing ? pause() : play());

  /* ---------- fuentes ---------- */
  function mediaEl(c, m) {
    const url = mediaUrl(m.proxy || m.path);
    let e = els.get(c.id);
    if (!e || e.url !== url) {
      if (e) { e.el.pause(); e.el.removeAttribute('src'); e.el.load(); }
      const el = document.createElement('video'); el.preload = 'auto'; el.playsInline = true; el.src = url;
      el.addEventListener('seeked', invalidate); el.addEventListener('loadeddata', invalidate);
      e = { el, url }; els.set(c.id, e);
    }
    return e.el;
  }
  function syncEl(el, c, src) {
    if (S.playing && !c.reverse && c.speed >= 0.07) {
      const rate = MMX.clamp(c.speed, 0.07, 16); if (el.playbackRate !== rate) el.playbackRate = rate;
      if (el.paused) { if (Math.abs(el.currentTime - src) > 0.05) el.currentTime = src; el.play().catch(() => {}); }
      else if (Math.abs(el.currentTime - src) > 0.4) el.currentTime = src;
    } else {
      if (!el.paused) el.pause();
      if (!el.seeking && Math.abs(el.currentTime - src) > 0.02) el.currentTime = src;
    }
  }
  function imageEl(m) {
    const url = mediaUrl(m.proxy || m.path); let i = imgs.get(url);
    if (!i) { i = new Image(); i.onload = invalidate; i.src = url; imgs.set(url, i); }
    return i.complete && i.naturalWidth ? i : null;
  }
  function drawTitle(g, c, W, H) {
    const t = c.title, k = H / 1080, size = t.size * k, lines = t.text.split('\n'), lh = size * 1.22;
    g.font = `${t.italic ? 'italic ' : ''}${t.bold ? '700' : '400'} ${size}px ${t.font}`;
    g.textAlign = t.align; g.textBaseline = 'middle';
    const x = t.px * W, y0 = t.py * H - lh * (lines.length - 1) / 2;
    if (t.bg) {
      const mw = Math.max(...lines.map((l) => g.measureText(l).width)), pad = size * 0.35;
      const bx = t.align === 'center' ? x - mw / 2 : t.align === 'right' ? x - mw : x;
      g.fillStyle = t.bg; g.beginPath(); g.roundRect(bx - pad, y0 - lh / 2 - pad * 0.5, mw + pad * 2, lh * lines.length + pad, size * 0.18); g.fill();
    }
    g.lineJoin = 'round';
    lines.forEach((l, i) => {
      const y = y0 + i * lh;
      if (t.shadow > 0) { g.shadowColor = 'rgba(0,0,0,.65)'; g.shadowBlur = t.shadow * k * 1.5; g.shadowOffsetY = t.shadow * k * 0.5; }
      if (t.strokeW > 0) { g.strokeStyle = t.stroke; g.lineWidth = t.strokeW * k * 2; g.strokeText(l, x, y); g.shadowColor = 'transparent'; }
      g.fillStyle = t.color; g.fillText(l, x, y); g.shadowColor = 'transparent';
    });
  }
  function titleCanvas(c, W, H) {
    const key = JSON.stringify(c.title) + W + 'x' + H; let e = titles.get(c.id);
    if (!e || e.key !== key) { const cn = document.createElement('canvas'); cn.width = W; cn.height = H; drawTitle(cn.getContext('2d'), c, W, H); e = { key, cn }; titles.set(c.id, e); }
    return e.cn;
  }
  /* Escribe en una carpeta temporal los PNG de los títulos (y las secuencias de los títulos 3D animados) para exportar.
   * at = instante único (fotograma exacto); sin at = película completa. */
  async function collectAssets(at, onProgress) {
    const p = S.p, dir = await api.invoke('asset:new'), assets = {}, W = p.width, H = p.height, single = typeof at === 'number';
    const jobs = [];
    for (const tr of p.tracks) for (const c of tr.clips) {
      const ext = MMX.tailExt(tr, c);
      if (single && !(at >= c.start - 1e-6 && at < c.start + c.dur + ext)) continue;
      if (c.kind === 'title') jobs.push({ c, n: 1 });
      else if (c.kind === 'title3d' && window.Title3D) jobs.push({ c, n: single || !Title3D.isAnimated(c) ? 1 : Math.ceil((c.dur + ext) * p.fps) + 1, rel0: single ? at - c.start : 0 });
    }
    const total = jobs.reduce((a, j) => a + j.n, 0); let done = 0;
    for (const j of jobs) {
      const c = j.c, id = c.id.replace(/[^A-Za-z0-9]/g, '');
      if (c.kind === 'title') { const cn = document.createElement('canvas'); cn.width = W; cn.height = H; drawTitle(cn.getContext('2d'), c, W, H); await api.invoke('asset:put', dir, `title_${id}.png`, cn.toDataURL('image/png')); assets[c.id] = { image: `title_${id}.png` }; done++; continue; }
      await Title3D.loadFont(c.t3.font);
      for (let i = 0; i < j.n; i++) {
        const cn = Title3D.frame(c, j.rel0 + i / p.fps, W, H); if (!cn) break;
        await api.invoke('asset:put', dir, j.n === 1 ? `t3_${id}.png` : `t3_${id}_${String(i).padStart(5, '0')}.png`, cn.toDataURL('image/png'));
        if (onProgress && ++done % 5 === 0) onProgress(done / total);
      }
      assets[c.id] = j.n === 1 ? { image: `t3_${id}.png` } : { seq: `t3_${id}_%05d.png` };
    }
    titles.clear(); invalidate();
    return { dir, assets };
  }

  /* ---------- pase por píxel: LUT de color, croma y máscara ---------- */
  function lutFor(c) {
    const key = JSON.stringify(c.color); let e = luts.get(c.id);
    if (!e || e.key !== key) { e = { key, lut: MMX.buildLut(c.color, 17) }; luts.set(c.id, e); }
    return e.lut;
  }
  /* Textura de la forma de la máscara; se escala y coloca igual que hace FFmpeg al exportar. */
  function shapeTex(shape, feather) {
    const key = shape + feather; let cn = masks.get(key);
    if (!cn) { const N = 128; cn = document.createElement('canvas'); cn.width = cn.height = N; const g = cn.getContext('2d'), im = g.createImageData(N, N), m = { shape, feather, x: 0.5, y: 0.5, w: 1, h: 1, invert: false };
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const q = (y * N + x) * 4; im.data[q] = im.data[q + 1] = im.data[q + 2] = 255; im.data[q + 3] = 255 * MMX.maskAlpha(m, (x + 0.5) / N, (y + 0.5) / N); }
      g.putImageData(im, 0, 0); if (masks.size > 40) masks.clear(); masks.set(key, cn); }
    return cn;
  }
  function srcRect(c, box, sw0, sh0) {
    let sx = sw0 * c.crop.l, sy = sh0 * c.crop.t, sw = sw0 * (1 - c.crop.l - c.crop.r), sh = sh0 * (1 - c.crop.t - c.crop.b);
    if (box.cover) { const ar = box.bw / box.bh; if (sw / sh > ar) { const w2 = sh * ar; sx += (sw - w2) / 2; sw = w2; } else { const h2 = sw / ar; sy += (sh - h2) / 2; sh = h2; } }
    return { sx, sy, sw, sh };
  }
  function pixelPass(c, w, hh) {
    const doLut = !MMX.colorIsDefault(c.color), ch = c.chroma.enabled ? c.chroma : null;
    if (!doLut && !ch) return;
    const im = sctx.getImageData(0, 0, w, hh), d = im.data, n = w * hh;
    let L, N, N2, f; if (doLut) { const l = lutFor(c); L = l.data; N = l.size; N2 = N * N; f = (N - 1) / 255; }
    let key, sim, bl; if (ch) { const k = MMX.hexRgb(ch.color), q = MMX.yuv(k[0], k[1], k[2]); key = q; sim = Math.max(0.01, ch.similarity); bl = ch.blend; }
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      let r = d[p], g = d[p + 1], b = d[p + 2];
      if (ch) { const u = -0.169 * r - 0.331 * g + 0.5 * b + 128 - key[1], v = 0.5 * r - 0.419 * g - 0.081 * b + 128 - key[2], ds = Math.sqrt((u * u + v * v) / 130050); d[p + 3] *= bl > 0.0001 ? Math.min(1, Math.max(0, (ds - sim) / bl)) : (ds > sim ? 1 : 0); }
      if (doLut) {
        const x = r * f, y = g * f, z = b * f, x0 = x | 0, y0 = y | 0, z0 = z | 0, x1 = x0 < N - 1 ? x0 + 1 : x0, y1 = y0 < N - 1 ? y0 + 1 : y0, z1 = z0 < N - 1 ? z0 + 1 : z0, fx = x - x0, fy = y - y0, fz = z - z0;
        const i000 = (x0 + y0 * N + z0 * N2) * 3, i100 = (x1 + y0 * N + z0 * N2) * 3, i010 = (x0 + y1 * N + z0 * N2) * 3, i110 = (x1 + y1 * N + z0 * N2) * 3, i001 = (x0 + y0 * N + z1 * N2) * 3, i101 = (x1 + y0 * N + z1 * N2) * 3, i011 = (x0 + y1 * N + z1 * N2) * 3, i111 = (x1 + y1 * N + z1 * N2) * 3;
        for (let k = 0; k < 3; k++) {
          const a = L[i000 + k] + (L[i100 + k] - L[i000 + k]) * fx, bb = L[i010 + k] + (L[i110 + k] - L[i010 + k]) * fx, cc = L[i001 + k] + (L[i101 + k] - L[i001 + k]) * fx, dd = L[i011 + k] + (L[i111 + k] - L[i011 + k]) * fx;
          const lo = a + (bb - a) * fy, hi = cc + (dd - cc) * fy;
          d[p + k] = (lo + (hi - lo) * fz) * 255;
        }
      }
    }
    sctx.putImageData(im, 0, 0);
  }

  /* ---------- dibujo ---------- */
  function drawClip(tr, c, t, ps) {
    const p = S.p, m = p.media[c.mediaId], st = MMX.clipState(p, tr, c, t), box = MMX.fitBox(p, c);
    let src, sw0, sh0;
    if (c.kind === 'video') { if (!m || m.missing || (m.needsProxy && !m.proxy)) return placeholder(box, st, ps, m && m.needsProxy && !m.missing ? 'Creando proxy…' : 'Medio no disponible'); const el = mediaEl(c, m); syncEl(el, c, st.src); if (el.readyState < 2) return; src = el; sw0 = el.videoWidth; sh0 = el.videoHeight; }
    else if (c.kind === 'image') { if (!m) return; src = imageEl(m); if (!src) return; sw0 = src.naturalWidth; sh0 = src.naturalHeight; }
    else if (c.kind === 'title') { src = titleCanvas(c, cv.width, cv.height); sw0 = src.width; sh0 = src.height; }
    else if (c.kind === 'title3d') { src = window.Title3D ? window.Title3D.frame(c, t - c.start, cv.width, cv.height) : null; if (!src) return; sw0 = src.width; sh0 = src.height; }
    const bw = Math.max(2, Math.round(box.bw * ps)), bh = Math.max(2, Math.round(box.bh * ps));
    scratch.width = bw; scratch.height = bh;
    if (c.kind === 'color') { sctx.fillStyle = c.fill; sctx.fillRect(0, 0, bw, bh); }
    else {
      const { sx, sy, sw, sh } = srcRect(c, box, sw0, sh0);
      sctx.save(); sctx.translate(c.flipH ? bw : 0, c.flipV ? bh : 0); sctx.scale(c.flipH ? -1 : 1, c.flipV ? -1 : 1);
      const blur = c.fx.blur > 0 ? c.fx.blur * (p.height / 1080) * ps : 0;
      if (c.fx.mosaic > 0) {
        const b = Math.max(2, c.fx.mosaic * (p.height / 1080) * ps); tiny.width = Math.max(1, Math.ceil(bw / b)); tiny.height = Math.max(1, Math.ceil(bh / b));
        tctx.drawImage(src, sx, sy, sw, sh, 0, 0, tiny.width, tiny.height); sctx.imageSmoothingEnabled = false; sctx.drawImage(tiny, 0, 0, bw, bh);
      } else { if (blur) sctx.filter = `blur(${blur}px)`; sctx.drawImage(src, sx, sy, sw, sh, 0, 0, bw, bh); }
      sctx.restore();
    }
    pixelPass(c, bw, bh);
    if (c.mask) { const mk = MMX.maskAt(c, t - c.start); sctx.globalCompositeOperation = mk.invert ? 'destination-out' : 'destination-in'; sctx.drawImage(shapeTex(mk.shape, mk.feather), (mk.x - mk.w / 2) * bw, (mk.y - mk.h / 2) * bh, mk.w * bw, mk.h * bh); }
    if (st.wx || st.wy) { sctx.globalCompositeOperation = 'destination-in'; sctx.fillStyle = '#fff'; sctx.fillRect(st.wx * bw, st.wy * bh, bw, bh); }
    sctx.globalCompositeOperation = 'source-atop';
    if (c.fx.vignette > 0) { const g = sctx.createRadialGradient(bw / 2, bh / 2, Math.min(bw, bh) * 0.25, bw / 2, bh / 2, Math.hypot(bw, bh) / 2); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${Math.min(0.95, c.fx.vignette)})`); sctx.fillStyle = g; sctx.fillRect(0, 0, bw, bh); }
    if (c.fx.grain > 0) { sctx.globalAlpha = Math.min(0.5, c.fx.grain / 60); for (let i = 0; i < 500; i++) { sctx.fillStyle = Math.random() > 0.5 ? '#fff' : '#000'; sctx.fillRect(Math.random() * bw, Math.random() * bh, 2, 2); } sctx.globalAlpha = 1; }
    if (st.black > 0) { sctx.fillStyle = `rgba(0,0,0,${st.black})`; sctx.fillRect(0, 0, bw, bh); }
    sctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.translate((box.cx + st.x * p.width) * ps, (box.cy + st.y * p.height) * ps); ctx.rotate(st.rotation * Math.PI / 180); ctx.scale(st.scale, st.scale);
    ctx.globalAlpha = st.alpha; ctx.globalCompositeOperation = c.blend === 'normal' ? 'source-over' : c.blend;
    ctx.drawImage(scratch, -bw / 2, -bh / 2);
    ctx.restore();
  }
  function placeholder(box, st, ps, text) { ctx.save(); ctx.translate((box.cx + st.x * S.p.width) * ps, (box.cy + st.y * S.p.height) * ps); ctx.fillStyle = '#1b1e25'; ctx.fillRect(-box.bw * ps / 2, -box.bh * ps / 2, box.bw * ps, box.bh * ps); ctx.fillStyle = '#8d94a3'; ctx.font = '14px system-ui'; ctx.textAlign = 'center'; ctx.fillText(text, 0, 0); ctx.restore(); }

  function draw() {
    const p = S.p, t = S.t, ps = cv.width / p.width, live = new Set();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
    for (let ti = p.tracks.length - 1; ti >= 0; ti--) {
      const tr = p.tracks[ti];
      for (const c of tr.clips) {
        const ext = MMX.tailExt(tr, c), on = t >= c.start - 1e-6 && t < c.start + c.dur + ext;
        if (!on) continue;
        live.add(c.id);
        if (MMX.isVisual(c) && !tr.hidden) { try { drawClip(tr, c, t, ps); } catch (e) { console.error(e); } }
        if (MMX.hasAudio(p, c)) {
          const m = p.media[c.mediaId]; if (m.missing || (m.needsProxy && !m.proxy)) continue;
          const el = mediaEl(c, m), r = t - c.start;
          if (c.kind === 'audio' || tr.hidden) syncEl(el, c, MMX.sourceTime(p, c, r));
          let v = MMX.valueAt(c, 'volume', r) * tr.volume * MMX.duckGain(p, tr, t);
          if (c.fadeIn > 0) v *= Math.min(1, r / c.fadeIn); if (c.fadeOut > 0) v *= MMX.clamp((c.dur - r) / c.fadeOut, 0, 1);
          el.volume = MMX.clamp(v, 0, 1); el.muted = tr.muted || c.muted || r > c.dur || !S.playing;
        } else if (c.kind === 'video' && els.has(c.id)) els.get(c.id).el.muted = true;
      }
    }
    for (const [id, e] of els) { if (!live.has(id)) { if (!e.el.paused) e.el.pause(); if (!findClip(id)) { e.el.removeAttribute('src'); e.el.load(); els.delete(id); } } }
    const s = selected();
    if (s && !S.playing && MMX.isVisual(s.clip) && live.has(s.clip.id)) {
      const st = MMX.clipState(p, s.track, s.clip, t), box = MMX.fitBox(p, s.clip);
      ctx.save(); ctx.translate((box.cx + st.x * p.width) * ps, (box.cy + st.y * p.height) * ps); ctx.rotate(st.rotation * Math.PI / 180); ctx.scale(st.scale, st.scale);
      ctx.strokeStyle = '#5fd4b8'; ctx.lineWidth = 2 / st.scale; ctx.setLineDash([6 / st.scale, 4 / st.scale]); ctx.strokeRect(-box.bw * ps / 2, -box.bh * ps / 2, box.bw * ps, box.bh * ps);
      if (s.clip.mask) { const mk = MMX.maskAt(s.clip, t - s.clip.start), bw = box.bw * ps, bh = box.bh * ps; ctx.strokeStyle = '#ff7a59'; ctx.beginPath(); if (mk.shape === 'rect') ctx.rect((mk.x - mk.w / 2 - 0.5) * bw, (mk.y - mk.h / 2 - 0.5) * bh, mk.w * bw, mk.h * bh); else ctx.ellipse((mk.x - 0.5) * bw, (mk.y - 0.5) * bh, mk.w * bw / 2, mk.h * bh / 2, 0, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    }
    if (!$('#scope').hidden && frameNo % 3 === 0) drawScope();
  }
  function drawScope() {
    const sc = $('#scope'), g = sc.getContext('2d'), d = ctx.getImageData(0, 0, cv.width, cv.height).data, hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    for (let i = 0; i < d.length; i += 16) { hist[0][d[i]]++; hist[1][d[i + 1]]++; hist[2][d[i + 2]]++; }
    let mx = 1; for (const hh of hist) for (let i = 2; i < 254; i++) if (hh[i] > mx) mx = hh[i];
    g.clearRect(0, 0, 256, 90); g.globalCompositeOperation = 'lighter';
    ['#ff4040', '#40ff60', '#4080ff'].forEach((col, k) => { g.fillStyle = col; for (let i = 0; i < 256; i++) { const v = Math.min(88, hist[k][i] / mx * 88); g.fillRect(i, 90 - v, 1, v); } });
    g.globalCompositeOperation = 'source-over';
  }

  /* Arrastrar en el visor mueve el clip seleccionado; la rueda lo escala. */
  function initPointer() {
    const active = (c) => S.t >= c.start && S.t < c.start + c.dur;
    cv.addEventListener('pointerdown', (e) => {
      const r = cv.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      let s = selected();
      if (!s || !MMX.isVisual(s.clip) || !active(s.clip)) {
        s = null;
        for (let ti = 0; ti < S.p.tracks.length && !s; ti++) for (const c of S.p.tracks[ti].clips) if (MMX.isVisual(c) && active(c) && !S.p.tracks[ti].hidden) {
          const st = MMX.clipState(S.p, S.p.tracks[ti], c, S.t), b = MMX.fitBox(S.p, c), cx = b.cx / S.p.width + st.x, cy = b.cy / S.p.height + st.y, hw = b.bw * st.scale / S.p.width / 2, hh = b.bh * st.scale / S.p.height / 2;
          if (Math.abs(px - cx) <= hw && Math.abs(py - cy) <= hh) { s = { clip: c, track: S.p.tracks[ti] }; break; }
        }
        if (!s) return; select(s.clip.id);
      }
      if (s.track.locked) return;
      const c = s.clip, rel = S.t - c.start, x0 = MMX.valueAt(c, 'x', rel), y0 = MMX.valueAt(c, 'y', rel), sx = e.clientX, sy = e.clientY;
      if (e.shiftKey && c.mask) { // Mayús + arrastrar mueve la máscara
        const mk0 = MMX.maskAt(c, rel), b = MMX.fitBox(S.p, c), st = MMX.clipState(S.p, s.track, c, S.t), kx = S.p.width / (b.bw * st.scale), ky = S.p.height / (b.bh * st.scale);
        const mm = (ev) => { mutate('mask-' + c.id, () => { Inspector.setMask(c, 'x', +(mk0.x + (ev.clientX - sx) / r.width * kx).toFixed(4)); Inspector.setMask(c, 'y', +(mk0.y + (ev.clientY - sy) / r.height * ky).toFixed(4)); }, { light: true }); Inspector.sync(); };
        window.addEventListener('pointermove', mm); window.addEventListener('pointerup', () => window.removeEventListener('pointermove', mm), { once: true }); return;
      }
      const mv = (ev) => { const dx = (ev.clientX - sx) / r.width, dy = (ev.clientY - sy) / r.height; if (Math.abs(dx) + Math.abs(dy) < 0.004) return; mutate('drag-' + c.id, () => { Inspector.setProp(c, 'x', Math.round((x0 + dx) * 1000) / 1000); Inspector.setProp(c, 'y', Math.round((y0 + dy) * 1000) / 1000); }, { light: true }); Inspector.sync(); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', () => window.removeEventListener('pointermove', mv), { once: true });
    });
    cv.addEventListener('wheel', (e) => { const s = selected(); if (!s || !MMX.isVisual(s.clip) || s.track.locked) return; e.preventDefault(); const c = s.clip, v = MMX.valueAt(c, 'scale', S.t - c.start); mutate('wheel-' + c.id, () => Inspector.setProp(c, 'scale', MMX.clamp(Math.round(v * (e.deltaY < 0 ? 1.05 : 0.95) * 1000) / 1000, 0.02, 10)), { light: true }); Inspector.sync(); }, { passive: false });
  }
  return { init, resize, invalidate, play, pause, toggle, collectAssets, srcRect };
})();
