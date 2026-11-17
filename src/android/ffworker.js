/* MontajeMX — FFmpeg (WebAssembly) en un worker para la versión Android.
 * Copyright (C) 2026 Santiago Miguel — GPL-3.0-or-later.
 *
 * Mensaje de entrada: { id, runs: [[args…], …], probe, cwd, mounts: [{ dir, files: [{ name, blob }] }],
 *                       writes: [{ name, data }], collect: { dir, match } }
 * Respuesta: { id, code, out, err, files: [{ name, data }] } y, durante la ejecución, { id, line } con la salida estándar. */
'use strict';
self.importScripts('ffmpeg/ffmpeg-core.js');
let core = null, cur = null, out = [], err = [];
const ready = (async () => {
  // el núcleo solo respeta la ruta del .wasm si va codificada tras «#» en mainScriptUrlOrBlob
  const wasmURL = new URL('ffmpeg/ffmpeg-core.wasm', self.location.href).href;
  core = await self.createFFmpegCore({ mainScriptUrlOrBlob: new URL('ffmpeg/ffmpeg-core.js', self.location.href).href + '#' + btoa(JSON.stringify({ wasmURL, workerURL: '' })) });
  core.setLogger(({ type, message }) => {
    if (type === 'stdout') { out.push(message); if (cur != null && /out_time_(us|ms)=/.test(message)) self.postMessage({ id: cur, line: message }); }
    else { err.push(message); if (err.length > 400) err.splice(0, 200); }
  });
})();

const FS = () => core.FS;
function mkdirp(dir) { let p = ''; for (const part of dir.split('/').filter(Boolean)) { p += '/' + part; try { FS().mkdir(p); } catch (e) { /* ya existe */ } } }
function rmrf(dir) {
  let st; try { st = FS().stat(dir); } catch (e) { return; }
  if (FS().isDir(st.mode)) { for (const n of FS().readdir(dir)) if (n !== '.' && n !== '..') rmrf(dir + '/' + n); try { FS().rmdir(dir); } catch (e) { /* montaje */ } }
  else FS().unlink(dir);
}

self.onmessage = async (ev) => {
  const job = ev.data;
  await ready;
  const fs = FS(), mounted = [];
  cur = job.id; out = []; err = [];
  let code = -1;
  const files = [];
  try {
    for (const m of job.mounts || []) {
      mkdirp(m.dir);
      fs.mount(fs.filesystems.WORKERFS, { blobs: m.files.map((f) => ({ name: f.name, data: f.blob })) }, m.dir);
      mounted.push(m.dir);
    }
    mkdirp(job.cwd); fs.chdir(job.cwd);
    for (const w of job.writes || []) fs.writeFile(job.cwd + '/' + w.name, w.data);
    for (const args of job.runs) { // tareas previas (máscaras) y la principal, en la misma carpeta
      code = job.probe ? core.ffprobe(...args) : core.exec(...args);
      try { core.reset(); } catch (e) { /* nada */ }
      if (code !== 0) break;
    }
    if (job.collect) {
      const re = new RegExp(job.collect.match);
      for (const n of fs.readdir(job.collect.dir).sort()) if (re.test(n)) files.push({ name: n, data: fs.readFile(job.collect.dir + '/' + n) });
    }
  } catch (e) {
    err.push(String(e && e.message || e));
  } finally {
    try { fs.chdir('/'); } catch (e) { /* nada */ }
    for (const d of mounted) { try { fs.unmount(d); } catch (e) { /* nada */ } }
    rmrf(job.cwd);
    try { core.reset(); } catch (e) { /* nada */ }
    cur = null;
  }
  self.postMessage({ id: job.id, code, out: out.join('\n'), err: err.join('\n').slice(-6000), files }, files.map((f) => f.data.buffer));
};
