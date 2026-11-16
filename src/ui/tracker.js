/* MontajeMX — seguimiento de movimiento por coincidencia de plantilla (ZNCC) sobre los fotogramas del clip.
 * El resultado son fotogramas clave de la máscara (mx, my y, en modo inteligente, mw, mh).
 * Copyright (C) 2026 Santiago Miguel — GPL-3.0-or-later. */
'use strict';
const Tracker = (() => {
  const G = 20, AW = 384;
  function sample(gray, w, hh, cx, cy, rw, rh) {
    const out = new Float32Array(G * G); let mean = 0;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const x = Math.min(w - 1, Math.max(0, Math.round(cx + ((i + 0.5) / G - 0.5) * rw))), y = Math.min(hh - 1, Math.max(0, Math.round(cy + ((j + 0.5) / G - 0.5) * rh)));
      const v = gray[y * w + x]; out[j * G + i] = v; mean += v;
    }
    mean /= G * G; let sd = 0;
    for (let k = 0; k < out.length; k++) { out[k] -= mean; sd += out[k] * out[k]; }
    sd = Math.sqrt(sd / out.length) + 1e-3;
    for (let k = 0; k < out.length; k++) out[k] /= sd;
    return out;
  }
  const score = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += a[k] * b[k]; return s / a.length; };
  function search(gray, w, hh, prev, tmpl, smart) {
    const R = Math.min(70, Math.max(12, 0.6 * Math.max(prev.w, prev.h))), scales = smart ? [0.95, 1, 1.05] : [1];
    let best = { s: -2, x: prev.x, y: prev.y, k: 1 };
    const tryAt = (x, y, k) => { const sc = score(tmpl, sample(gray, w, hh, x, y, prev.w * k, prev.h * k)) - (k !== 1 ? 0.015 : 0); if (sc > best.s) best = { s: sc, x, y, k }; };
    for (const k of scales) for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) tryAt(prev.x + dx, prev.y + dy, k);
    const c = { x: best.x, y: best.y };
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) tryAt(c.x + dx, c.y + dy, best.k);
    return { x: MMX.clamp(best.x, 0, w), y: MMX.clamp(best.y, 0, hh), w: MMX.clamp(prev.w * best.k, 6, w * 1.5), h: MMX.clamp(prev.h * best.k, 6, hh * 1.5), s: best.s };
  }
  /* Ramer–Douglas–Peucker sobre (t, v) para dejar pocos fotogramas clave. */
  function simplify(pts, tol) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const rec = (a, b) => { let mx = 0, mi = -1; for (let i = a + 1; i < b; i++) { const v = pts[a].v + (pts[b].v - pts[a].v) * (pts[i].t - pts[a].t) / (pts[b].t - pts[a].t), d = Math.abs(pts[i].v - v); if (d > mx) { mx = d; mi = i; } } if (mx > tol) { keep[mi] = 1; rec(a, mi); rec(mi, b); } };
    rec(0, pts.length - 1);
    return pts.filter((_, i) => keep[i]);
  }
  async function run(c, smart, onProgress, cancelled) {
    const p = S.p, m = p.media[c.mediaId];
    if (c.kind !== 'video' || !m || !c.mask) throw new Error('El seguimiento necesita un clip de video con máscara.');
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = mediaUrl(m.proxy || m.path);
    await new Promise((res, rej) => { v.addEventListener('loadeddata', res, { once: true }); v.addEventListener('error', () => rej(new Error('No se pudo abrir el video')), { once: true }); });
    const box = MMX.fitBox(p, c), aw = AW, ah = Math.max(8, Math.round(AW * box.bh / box.bw));
    const cn = document.createElement('canvas'); cn.width = aw; cn.height = ah; const g = cn.getContext('2d', { willReadFrequently: true });
    const r = Preview.srcRect(c, box, v.videoWidth, v.videoHeight);
    const grab = async (rel) => {
      const st = MMX.sourceTime(p, c, rel);
      if (Math.abs(v.currentTime - st) > 0.004) { v.currentTime = st; await new Promise((res) => v.addEventListener('seeked', res, { once: true })); }
      g.save(); g.translate(c.flipH ? aw : 0, c.flipV ? ah : 0); g.scale(c.flipH ? -1 : 1, c.flipV ? -1 : 1); g.drawImage(v, r.sx, r.sy, r.sw, r.sh, 0, 0, aw, ah); g.restore();
      const d = g.getImageData(0, 0, aw, ah).data, gray = new Float32Array(aw * ah);
      for (let i = 0, q = 0; i < gray.length; i++, q += 4) gray[i] = 0.299 * d[q] + 0.587 * d[q + 1] + 0.114 * d[q + 2];
      return gray;
    };
    const step = 1 / Math.min(p.fps, 15), n0 = Math.round(MMX.clamp(S.t - c.start, 0, c.dur) / step), nMax = Math.floor(c.dur / step);
    const mk = MMX.maskAt(c, n0 * step), start = { x: mk.x * aw, y: mk.y * ah, w: mk.w * aw, h: mk.h * ah };
    const g0 = await grab(n0 * step), t0 = sample(g0, aw, ah, start.x, start.y, start.w, start.h), res = new Map([[n0, start]]);
    let done = 0, lost = 0;
    for (const dir of [1, -1]) {
      let cur = start, tmpl = Float32Array.from(t0);
      for (let k = n0 + dir; k >= 0 && k <= nMax; k += dir) {
        if (cancelled()) { v.removeAttribute('src'); v.load(); return null; }
        const gray = await grab(k * step), f = search(gray, aw, ah, cur, tmpl, smart);
        if (f.s < 0.25) lost++; else { const now = sample(gray, aw, ah, f.x, f.y, f.w, f.h); for (let q = 0; q < tmpl.length; q++) tmpl[q] = 0.93 * tmpl[q] + 0.07 * now[q]; cur = f; }
        res.set(k, { x: cur.x, y: cur.y, w: cur.w, h: cur.h });
        onProgress(++done / nMax);
      }
    }
    v.removeAttribute('src'); v.load();
    const ks = [...res.keys()].sort((a, b) => a - b), series = (fn) => ks.map((k) => ({ t: +(k * step).toFixed(4), v: +fn(res.get(k)).toFixed(5) }));
    const out = { mx: simplify(series((q) => q.x / aw), 0.004), my: simplify(series((q) => q.y / ah), 0.004), lost, frames: ks.length };
    if (smart) { out.mw = simplify(series((q) => q.w / aw), 0.006); out.mh = simplify(series((q) => q.h / ah), 0.006); }
    return out;
  }
  /* Hace que otro clip (título, imagen, video) siga el rastro: escribe sus claves de posición. */
  function attach(src, srcTrack, dst) {
    const p = S.p, times = new Set(); for (const k of ['mx', 'my']) for (const q of src.kf[k] || []) times.add(q.t);
    const db = MMX.fitBox(p, dst), kx = [], ky = [];
    const ox = dst.kind === 'title' ? dst.title.px - 0.5 : 0, oy = dst.kind === 'title' ? dst.title.py - 0.5 : 0; // que el texto, no el centro del lienzo, caiga sobre el objeto
    for (const t of [...times].sort((a, b) => a - b)) {
      const gt = src.start + t, rel = gt - dst.start; if (rel < -1e-6 || rel > dst.dur + 1e-6) continue;
      const st = MMX.clipState(p, srcTrack, src, gt), sb = MMX.fitBox(p, src), mk = MMX.maskAt(src, t);
      kx.push({ t: +rel.toFixed(4), v: +(((sb.cx + st.x * p.width + (mk.x - 0.5) * sb.bw * st.scale) - db.cx) / p.width - ox).toFixed(5) });
      ky.push({ t: +rel.toFixed(4), v: +(((sb.cy + st.y * p.height + (mk.y - 0.5) * sb.bh * st.scale) - db.cy) / p.height - oy).toFixed(5) });
    }
    if (kx.length) { dst.kf.x = kx; dst.kf.y = ky; }
    return kx.length;
  }
  return { run, attach, simplify };
})();
