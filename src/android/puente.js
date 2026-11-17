/* MontajeMX — puente para Android (y navegadores): implementa window.api sin Electron.
 * Los medios se guardan en IndexedDB, FFmpeg corre en WebAssembly dentro de un worker
 * y los archivos exportados se escriben en Documentos/MontajeMX con el plugin Filesystem de Capacitor.
 * Copyright (C) 2026 Santiago Miguel — GPL-3.0-or-later. */
'use strict';
(function () {
  const Render = window.MMXRender, Sync = window.MMXSync;
  const VERSION = window.MMX_VERSION || '0.0.0';
  const cap = (name) => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() ? window.Capacitor.Plugins[name] : null);
  const listeners = {};
  const emit = (ch, ...a) => (listeners[ch] || []).forEach((fn) => { try { fn(...a); } catch (e) { console.error(e); } });

  /* ---------- almacén de archivos (IndexedDB) ---------- */
  const blobs = new Map(), urls = new Map();
  let db = null;
  const req = (r) => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
  const store = (name, mode) => db.transaction(name, mode || 'readonly').objectStore(name);
  const ready = (async () => {
    const open = indexedDB.open('montajemx', 1);
    open.onupgradeneeded = () => { open.result.createObjectStore('files'); open.result.createObjectStore('kv'); };
    db = await req(open);
    const keys = await req(store('files').getAllKeys()), vals = await req(store('files').getAll());
    keys.forEach((k, i) => blobs.set(k, vals[i]));
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* opcional */ }
  })();
  async function putFile(path, blob) { blobs.set(path, blob); const u = urls.get(path); if (u) { URL.revokeObjectURL(u); urls.delete(path); } await req(store('files', 'readwrite').put(blob, path)); }
  const kvGet = async (k) => { await ready; return req(store('kv').get(k)); };
  const kvPut = async (k, v) => { await ready; return req(store('kv', 'readwrite').put(v, k)); };
  function mediaUrl(path) {
    if (!path) return '';
    let u = urls.get(path);
    if (!u && blobs.has(path)) { u = URL.createObjectURL(blobs.get(path)); urls.set(path, u); }
    return u || '';
  }
  const hash = (s) => { let h1 = 0x811c9dc5, h2 = 0x1b873593; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822507); } return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')); };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const cleanName = (n) => String(n || 'archivo').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'archivo';
  const base = (p) => String(p).split('/').pop();
  const dirOf = (p) => String(p).split('/').slice(0, -1).join('/') || '/';
  const ext = (p) => { const m = /\.[^./]+$/.exec(base(p)); return m ? m[0].toLowerCase() : ''; };

  /* ---------- FFmpeg en un worker (una tarea a la vez) ---------- */
  let worker = null, seq = 0, chain = Promise.resolve(), current = null;
  function getWorker() {
    if (worker) return worker;
    worker = new Worker('../android/ffworker.js');
    worker.onmessage = (ev) => {
      const d = ev.data; if (!current || d.id !== current.id) return;
      if (d.line != null) { if (current.onLine) current.onLine(d.line); return; }
      const c = current; current = null; c.resolve(d);
    };
    worker.onerror = (ev) => { const c = current; current = null; worker.terminate(); worker = null; if (c) c.resolve({ code: -1, out: '', err: 'FFmpeg se detuvo: ' + (ev.message || 'memoria insuficiente'), files: [] }); };
    return worker;
  }
  function cancelFF() {
    if (!current) return;
    const c = current; current = null;
    if (worker) { worker.terminate(); worker = null; }
    c.resolve({ code: -1, out: '', err: 'Exportación cancelada.', files: [], canceled: true });
  }
  /* runs: lista de listas de argumentos; las rutas de entrada que estén en el almacén se montan sin copiarse. */
  function ff(runs, o) {
    o = o || {};
    const job = chain.then(async () => {
      await ready;
      const groups = new Map();
      for (const args of runs) for (const a of args) {
        if (typeof a !== 'string' || !blobs.has(a)) continue;
        const d = dirOf(a); if (!groups.has(d)) groups.set(d, new Map());
        groups.get(d).set(base(a), blobs.get(a));
      }
      const mounts = [...groups].map(([dir, m]) => ({ dir, files: [...m].map(([name, blob]) => ({ name, blob })) }));
      const id = ++seq, cwd = '/trabajo/' + id;
      if (window.MMX_DEBUG) console.log('ffmpeg ' + JSON.stringify(runs));
      return new Promise((resolve) => {
        current = { id, resolve, onLine: o.onLine };
        getWorker().postMessage({ id, runs, probe: !!o.probe, cwd, mounts, writes: o.writes || [], collect: o.collect ? { dir: cwd, match: o.collect } : null });
      });
    });
    chain = job.catch(() => {});
    return job;
  }
  const lastLines = (s, n) => String(s || '').split('\n').slice(-(n || 8)).join('\n');

  /* ---------- archivos auxiliares de la vista previa (títulos, 3D) ---------- */
  const packs = new Map();
  const dataUrlBytes = (d) => { const b = atob(d.split(',')[1]); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  function writesFor(pack, b) {
    const w = [];
    const p = pack && packs.get(pack.dir);
    if (p) for (const [name, data] of p) w.push({ name, data });
    if (b) for (const f of b.files) w.push({ name: f.name, data: new TextEncoder().encode(f.text) });
    return w;
  }

  /* ---------- guardar en el dispositivo ---------- */
  const saved = new Map(); // ruta mostrada → { path, directory }
  const blobB64 = (blob) => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => ko(r.error); r.readAsDataURL(blob); });
  async function saveToDevice(rel, blob) {
    const Fsys = cap('Filesystem');
    if (!Fsys) { // navegador de escritorio: descarga normal
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = base(rel); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      return 'Descargas/' + base(rel);
    }
    try { await Fsys.requestPermissions(); } catch (e) { /* Android 11+ no lo necesita */ }
    let path = 'MontajeMX/' + rel;
    try { await Fsys.stat({ path, directory: 'DOCUMENTS' }); path = path.replace(/(\.[^./]+)?$/, (m) => ' (' + new Date().toTimeString().slice(0, 8).replace(/:/g, '-') + ')' + m); } catch (e) { /* no existe: bien */ }
    const CH = 3 * 1024 * 1024;
    for (let off = 0; off < blob.size || off === 0; off += CH) {
      const data = await blobB64(blob.slice(off, off + CH));
      if (off === 0) await Fsys.writeFile({ path, data, directory: 'DOCUMENTS', recursive: true });
      else await Fsys.appendFile({ path, data, directory: 'DOCUMENTS' });
      if (blob.size === 0) break;
    }
    const shown = 'Documentos/' + path;
    saved.set(shown, { path, directory: 'DOCUMENTS' });
    return shown;
  }
  async function shareSaved(shown) {
    const s = saved.get(shown), Fsys = cap('Filesystem'), Share = cap('Share');
    if (!s || !Fsys || !Share) { toastMsg('Guardado en ' + shown); return; }
    try { const { uri } = await Fsys.getUri(s); await Share.share({ title: base(shown), files: [uri] }); } catch (e) { toastMsg('Guardado en ' + shown); }
  }
  function toastMsg(t) { const el = document.getElementById('toast'); if (!el) return; el.textContent = t; el.hidden = false; clearTimeout(toastMsg.h); toastMsg.h = setTimeout(() => { el.hidden = true; }, 3500); }

  /* ---------- diálogos propios (selector de archivos, confirmación, texto) ---------- */
  function pickFiles(accept, multiple) {
    return new Promise((resolve) => {
      const inp = document.createElement('input'); inp.type = 'file'; if (accept) inp.accept = accept; inp.multiple = !!multiple; inp.style.display = 'none';
      let done = false; const fin = (v) => { if (done) return; done = true; inp.remove(); resolve(v); };
      inp.addEventListener('change', () => fin([...inp.files]));
      inp.addEventListener('cancel', () => fin([]));
      document.body.append(inp); inp.click();
    });
  }
  function overlay(build) {
    return new Promise((resolve) => {
      const bg = document.createElement('div');
      bg.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font:14px system-ui,sans-serif';
      const box = document.createElement('div');
      box.style.cssText = 'background:#1d2027;color:#e8e9ec;border:1px solid #333845;border-radius:12px;padding:20px 22px;max-width:460px;width:86%;box-shadow:0 12px 40px rgba(0,0,0,.5)';
      bg.append(box); document.body.append(bg);
      build(box, (v) => { bg.remove(); resolve(v); });
    });
  }
  const btnCss = 'margin-left:8px;padding:8px 14px;border-radius:8px;border:1px solid #3a3f4c;background:#2a2e38;color:#e8e9ec;font:inherit';
  function confirmBox(message, buttons) {
    return overlay((box, done) => {
      const p = document.createElement('p'); p.textContent = message; p.style.margin = '0 0 16px'; box.append(p);
      const row = document.createElement('div'); row.style.textAlign = 'right'; box.append(row);
      buttons.forEach((t, i) => { const b = document.createElement('button'); b.textContent = t; b.style.cssText = btnCss + (i === 0 ? ';background:#e0533d;border-color:#e0533d;color:#fff' : ''); b.onclick = () => done(i); row.append(b); });
    });
  }
  function askText(title, value) {
    return overlay((box, done) => {
      const p = document.createElement('p'); p.textContent = title; p.style.margin = '0 0 10px'; box.append(p);
      const inp = document.createElement('input'); inp.value = value || ''; inp.style.cssText = 'width:100%;box-sizing:border-box;padding:9px;border-radius:8px;border:1px solid #3a3f4c;background:#121418;color:#fff;font:inherit'; box.append(inp);
      const row = document.createElement('div'); row.style.cssText = 'text-align:right;margin-top:14px'; box.append(row);
      const ok = document.createElement('button'); ok.textContent = 'Aceptar'; ok.style.cssText = btnCss + ';background:#e0533d;border-color:#e0533d;color:#fff';
      const no = document.createElement('button'); no.textContent = 'Cancelar'; no.style.cssText = btnCss;
      ok.onclick = () => done(cleanName(inp.value.trim()) || null); no.onclick = () => done(null);
      inp.onkeydown = (e) => { if (e.key === 'Enter') ok.click(); };
      row.append(no, ok); setTimeout(() => inp.focus(), 50);
    });
  }

  /* ---------- medios ---------- */
  const WEB_V = ['h264', 'vp8', 'vp9', 'av1'], WEB_A = ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_f32le'], WEB_EXT = ['.mp4', '.m4v', '.webm', '.mov', '.mkv', '.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac', '.opus'];
  const IMG_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.svg'];
  const pending = new Map();
  async function addFile(file) { const path = '/vfs/' + uid() + '/' + cleanName(file.name); await ready; await putFile(path, file); return path; }
  function pathOf(file) { // arrastrar y soltar: se registra en el acto y se guarda en segundo plano
    const path = '/vfs/' + uid() + '/' + cleanName(file.name);
    blobs.set(path, file); pending.set(path, ready.then(() => putFile(path, file)));
    return path;
  }
  async function probe(file) {
    await ready; if (pending.has(file)) await pending.get(file);
    const blob = blobs.get(file); if (!blob) throw new Error('No se encontró ' + base(file));
    const e = ext(file), id = 'm' + hash(file + blob.size);
    const media = { id, path: file, name: base(file), type: 'video', duration: 0, width: 0, height: 0, hasAudio: false, hasVideo: false, thumb: null, wave: null, proxy: null, needsProxy: false };
    const r = await ff([['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]], { probe: true });
    let info; try { info = JSON.parse(r.out.slice(r.out.indexOf('{'))); } catch (er) { throw new Error('No se pudo leer ' + media.name); }
    const v = (info.streams || []).find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic)), a = (info.streams || []).find((s) => s.codec_type === 'audio');
    media.duration = parseFloat((info.format || {}).duration) || 0;
    if (v) {
      media.hasVideo = true; media.width = v.width; media.height = v.height; media.vcodec = v.codec_name;
      const rot = Math.abs(parseInt((v.tags && v.tags.rotate) || ((v.side_data_list || []).find((s) => s.rotation != null) || {}).rotation || 0, 10));
      if (rot === 90 || rot === 270) { media.width = v.height; media.height = v.width; }
      const fr = (v.avg_frame_rate || '0/1').split('/'); media.fps = fr[1] > 0 ? fr[0] / fr[1] : 0;
    }
    if (a) { media.hasAudio = true; media.acodec = a.codec_name; }
    const still = IMG_EXT.includes(e) || (v && !a && (media.duration < 0.1 || ['png', 'mjpeg', 'bmp', 'webp', 'tiff'].includes(v.codec_name) && media.duration < 0.2));
    if (still) { media.type = 'image'; media.duration = 0; media.hasAudio = false; } else if (!v) media.type = 'audio';
    if (media.type === 'video') media.needsProxy = !WEB_EXT.includes(e) || !WEB_V.includes(media.vcodec) || (a && !WEB_A.includes(media.acodec)) || media.width > 2600 || media.height > 2600;
    if (media.type === 'audio') media.needsProxy = !WEB_EXT.includes(e) || !WEB_A.includes(media.acodec);
    if (media.type === 'image' && ['.tif', '.tiff'].includes(e)) media.needsProxy = true;
    if (media.type === 'audio') {
      const w = '/cache/' + id + '-wave.png';
      if (!blobs.has(w)) { const t = await ff([['-i', file, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=1200x120:colors=0x7ad7c4', '-frames:v', '1', 'o.png']], { collect: '^o\\.png$' }); if (t.files.length) await putFile(w, new Blob([t.files[0].data], { type: 'image/png' })); }
      if (blobs.has(w)) media.wave = w;
    } else {
      const th = '/cache/' + id + '-thumb.jpg';
      if (!blobs.has(th)) { const t = await ff([['-ss', String(media.type === 'video' ? Math.min(1, media.duration / 3) : 0), '-i', file, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', 'o.jpg']], { collect: '^o\\.jpg$' }); if (t.files.length) await putFile(th, new Blob([t.files[0].data], { type: 'image/jpeg' })); }
      if (blobs.has(th)) media.thumb = th;
    }
    return media;
  }
  async function makeProxy(media) {
    const kind = media.type === 'audio' ? 'm4a' : media.type === 'image' ? 'png' : 'mp4';
    const out = '/cache/' + media.id + '-proxy.' + kind;
    if (blobs.has(out)) return out;
    const args = media.type === 'audio' ? ['-i', media.path, '-vn', '-c:a', 'aac', '-b:a', '160k', 'o.' + kind]
      : media.type === 'image' ? ['-i', media.path, '-frames:v', '1', 'o.' + kind]
      : ['-i', media.path, '-vf', 'scale=-2:540', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-g', '15', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'o.' + kind];
    const r = await ff([args], { collect: '^o\\.' });
    if (r.code !== 0 || !r.files.length) throw new Error('No se pudo crear el proxy: ' + lastLines(r.err, 4));
    await putFile(out, new Blob([r.files[0].data], { type: kind === 'png' ? 'image/png' : kind === 'm4a' ? 'audio/mp4' : 'video/mp4' }));
    return out;
  }

  /* ---------- exportación ---------- */
  const MOBILE_PRESET = { medium: 'veryfast' };
  function tune(args) { // en el teléfono se usa un preset de x264/x265 más rápido
    const a = args.slice();
    for (let i = 0; i < a.length - 1; i++) if (a[i] === '-preset' && MOBILE_PRESET[a[i + 1]]) a[i + 1] = MOBILE_PRESET[a[i + 1]];
    const vp9 = a.indexOf('libvpx-vp9'); // VP9 falla en la compilación WebAssembly: se usa VP8, que también es WebM
    if (vp9 > 0) {
      a[vp9] = 'libvpx'; a.splice(vp9 + 1, 0, '-deadline', 'realtime', '-cpu-used', '8');
      const rm = a.indexOf('-row-mt'); if (rm > 0) a.splice(rm, 2);
      const bv = a.indexOf('-b:v'); if (bv > 0 && a[bv + 1] === '0') a[bv + 1] = '12M';
    }
    const opus = a.indexOf('libopus'); if (opus > 0) a[opus] = 'libvorbis'; // libopus en estéreo cierra el proceso
    
    return a;
  }
  async function renderJob(project, opts, pack, onLine) {
    const b = Render.build(project, Object.assign({}, opts, { assets: (pack && pack.assets) || {} }));
    const r = await ff(b.prejobs.concat([tune(b.args)]), { writes: writesFor(pack, b), collect: '^salida', onLine: onLine && ((l) => onLine(l, b)) });
    return { r, b };
  }
  const mimeOf = (n) => ({ '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.flac': 'audio/flac' }[ext(n)] || 'application/octet-stream');
  async function exportTo(project, opts, pack, wanted) { // wanted: nombre final (p. ej. «Mi película.mp4» o «Clip_%05d.png»)
    const preset = Render.PRESETS[opts.preset];
    const o = Object.assign({}, opts, { out: preset.seq ? 'salida_%05d.' + preset.ext : 'salida.' + preset.ext });
    const { r } = await renderJob(project, o, pack, (line, b) => { const m = /out_time_(?:us|ms)=(\d+)/.exec(line); if (m) emit('export:progress', Math.min(1, parseInt(m[1], 10) / 1e6 / b.total)); });
    if (r.canceled) return { error: 'Exportación cancelada.' };
    if (r.code !== 0 || !r.files.length) return { error: lastLines(r.err) || 'FFmpeg no produjo ningún archivo.' };
    emit('export:progress', 1);
    if (preset.seq) {
      const stem = wanted.replace(/_%05d\.\w+$/, '');
      let first = null;
      for (const f of r.files) { const n = f.name.replace(/^salida/, base(stem)); const s = await saveToDevice(base(stem) + '/' + n, new Blob([f.data], { type: mimeOf(n) })); if (!first) first = s; }
      const shown = first.replace(/_\d{5}(\.\w+)$/, '_%05d$1');
      return { ok: true, out: shown, files: r.files.length };
    }
    return { ok: true, out: await saveToDevice(wanted, new Blob([r.files[0].data], { type: mimeOf(wanted) })) };
  }

  /* ---------- canales ---------- */
  const H = {
    'info': () => ({ version: VERSION, ffmpeg: 'FFmpeg 5.1 · WebAssembly (en el dispositivo)', platform: cap('Filesystem') ? 'android' : 'web',
      presets: Object.fromEntries(Object.entries(Render.PRESETS).filter(([k]) => !UNSUPPORTED.includes(k)).map(([k, v]) => [k, { name: RENAME[k] || v.name, ext: v.ext, crf: !!v.crf, audioOnly: !!v.audioOnly, fixed: v.fixed || null, no51: !!v.no51 }])) }),
    'media:pick': async () => { const fs = await pickFiles('video/*,audio/*,image/*', true); const out = []; for (const f of fs) out.push(await addFile(f)); return out; },
    'media:probe': async (file) => { try { return await probe(file); } catch (e) { return { error: e.message }; } },
    'media:proxy': async (media) => { try { return { path: await makeProxy(media) }; } catch (e) { return { error: e.message }; } },
    'media:exists': async (files) => { await ready; return files.map((f) => !!f && blobs.has(f)); },
    'project:save': async (json, file, saveAs) => {
      let name = file ? base(file).replace(/\.mmx$/, '') : null;
      if (!name || saveAs) { name = await askText('Nombre del proyecto', name || 'Mi proyecto'); if (!name) return null; }
      const Fsys = cap('Filesystem'), rel = 'Proyectos/' + name + '.mmx';
      await kvPut('proyecto:' + name, json);
      if (!Fsys) return saveToDevice(rel, new Blob([json], { type: 'application/json' }));
      try { await Fsys.requestPermissions(); } catch (e) { /* nada */ }
      await Fsys.writeFile({ path: 'MontajeMX/' + rel, data: json, directory: 'DOCUMENTS', encoding: 'utf8', recursive: true });
      return 'Documentos/MontajeMX/' + rel;
    },
    'project:open': async () => {
      const [f] = await pickFiles('', false); if (!f) return null;
      return { file: 'Documentos/MontajeMX/Proyectos/' + cleanName(f.name).replace(/(\.mmx)?$/, '.mmx'), json: await f.text() };
    },
    'autosave:write': async (json) => { await kvPut('autosave', json); return true; },
    'autosave:read': async () => (await kvGet('autosave')) || null,
    'file:pickText': async (name, exts) => { const [f] = await pickFiles(exts.map((x) => '.' + x).join(','), false); return f ? { name: f.name, text: await f.text() } : null; },
    'confirm': (message, buttons) => confirmBox(message, buttons),
    'shell:show': (file) => shareSaved(file),
    'asset:new': () => { const d = '/assets/' + uid(); packs.set(d, new Map()); return d; },
    'asset:put': (dir, name, dataUrl) => { const p = packs.get(dir); if (!p) throw new Error('carpeta no válida'); p.set(base(name), dataUrlBytes(dataUrl)); return true; },
    'asset:drop': (dir) => { packs.delete(dir); },
    'export:pick': async (name, ex) => { const n = await askText('Nombre del archivo (se guarda en Documentos/MontajeMX)', cleanName(name)); return n ? '/salida/' + n.replace(new RegExp('\\.' + ex + '$', 'i'), '') + '.' + ex : null; },
    'export:start': async (project, opts, pack) => {
      try {
        const preset = Render.PRESETS[opts.preset]; let wanted = base(opts.out);
        if (preset.seq) wanted = wanted.replace(/\.\w+$/, '') + '_%05d.' + preset.ext;
        return await exportTo(project, opts, pack, wanted);
      } catch (e) { return { error: e.message }; } finally { if (pack) packs.delete(pack.dir); }
    },
    'export:cancel': () => cancelFF(),
    'frame:pick': async () => { const n = await askText('Nombre de la instantánea', 'Fotograma'); return n ? '/salida/' + n.replace(/\.png$/i, '') + '.png' : null; },
    'frame:render': async (project, t, width, pack, saveTo) => {
      try {
        const h = Math.round(width * project.height / project.width / 2) * 2;
        const { r } = await renderJob(project, { frameAt: t, out: 'salida.png', width, height: h }, pack);
        if (r.code !== 0 || !r.files.length) return { error: lastLines(r.err, 6) };
        const blob = new Blob([r.files[0].data], { type: 'image/png' });
        if (saveTo) return { path: await saveToDevice('Instantáneas/' + base(saveTo), blob) };
        return { data: 'data:image/png;base64,' + await blobB64(blob) };
      } catch (e) { return { error: e.message }; }
    },
    'record:save': async (bytes, kind) => {
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      if (kind === 'foto') { const p = '/vfs/' + uid() + '/Foto ' + stamp + '-' + (Date.now() % 1000) + '.png'; await putFile(p, new Blob([bytes], { type: 'image/png' })); return probe(p); }
      const name = (kind === 'voz' ? 'Voz' : kind === 'camara' ? 'Cámara' : 'Pantalla') + ' ' + stamp + '.webm';
      // MediaRecorder no escribe la duración: se reempaqueta sin recodificar para que sea editable
      const r = await ff([['-i', 'crudo.webm'].concat(kind === 'voz' ? ['-vn'] : []).concat(['-c', 'copy', 'salida.webm'])], { writes: [{ name: 'crudo.webm', data: new Uint8Array(bytes) }], collect: '^salida' });
      if (r.code !== 0 || !r.files.length) return { error: 'No se pudo guardar la grabación: ' + lastLines(r.err, 4) };
      const p = '/vfs/' + uid() + '/' + name; await putFile(p, new Blob([r.files[0].data], { type: 'video/webm' }));
      return probe(p);
    },
    'multicam:sync': async (files) => {
      const envs = [];
      for (const f of files) {
        const r = await ff([['-t', '240', '-i', f, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'salida.pcm']], { collect: '^salida' });
        const d = r.code === 0 && r.files.length ? r.files[0].data : null;
        if (d && d.byteLength > 16000) { const dv = new DataView(d.buffer, d.byteOffset, d.byteLength); envs.push(Sync.envelope({ length: d.byteLength, readInt16LE: (o) => dv.getInt16(o, true) }, 8000)); } else envs.push(null);
      }
      return envs.map((en, i) => (i === 0 || !en || !envs[0] ? { seconds: 0, score: i === 0 ? 1 : 0 } : Sync.delay(envs[0], en, 60)));
    },
    'dvd:tools': () => ({ dvdauthor: false, spumux: false, iso: false, platform: 'android' }),
    'dvd:pickDir': () => '/salida',
    'dvd:build': async (project, pack, cfg) => {
      emit('dvd:stage', 'Codificando la película en MPEG-2…');
      const safe = cleanName(cfg.name || 'DVD');
      try {
        const r = await exportTo(project, { preset: cfg.standard === 'pal' ? 'dvd-pal' : 'dvd-ntsc', surround: !!cfg.surround }, pack, safe + ' DVD/pelicula.mpg');
        if (r.error) return r;
        return { ok: true, partial: true, movie: r.out, outDir: dirOf(r.out) };
      } finally { if (pack) packs.delete(pack.dir); }
    },
  };
  // AV1 no viene en la compilación WebAssembly de FFmpeg y x265 se bloquea sin hilos: en Android se ocultan.
  const UNSUPPORTED = ['mkv-av1', 'mp4-hevc'], RENAME = { 'webm-vp9': 'WebM · VP8 + Vorbis' };

  window.api = {
    invoke: async (ch, ...a) => { const fn = H[ch]; if (!fn) throw new Error('Canal no disponible en esta versión: ' + ch); return fn(...a); },
    send: () => {},
    on: (ch, fn) => { (listeners[ch] = listeners[ch] || []).push(fn); },
    pathOf,
    mediaUrl,
  };
  window.addEventListener('beforeunload', () => urls.forEach((u) => URL.revokeObjectURL(u)));

  /* Botón «Atrás» de Android: cierra el diálogo abierto o pregunta antes de salir. */
  document.addEventListener('DOMContentLoaded', () => {
    const App = cap('App'); if (!App) return;
    App.addListener('backButton', async () => {
      const modal = document.getElementById('modal');
      if (modal && !modal.hidden) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return; }
      if ((await confirmBox('¿Salir de MontajeMX? El proyecto queda autoguardado.', ['Salir', 'Cancelar'])) === 0) App.exitApp();
    });
  });
})();
