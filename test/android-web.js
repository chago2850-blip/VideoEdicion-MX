/* Prueba del puente de Android en Chromium: la interfaz corre sin Electron (sin preload), con FFmpeg en WebAssembly.
 * Uso: node scripts/build-android-web.js && xvfb-run -a electron --no-sandbox test/android-web.js   (OUT=carpeta para capturas) */
'use strict';
const { app, BrowserWindow, session } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
const { spawnSync } = require('child_process');
const www = path.join(__dirname, '..', 'www'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmx-android-')), OUT = process.env.OUT || dir;
app.setPath('userData', path.join(dir, 'ud'));
const ff = (a) => spawnSync('ffmpeg', ['-y', '-v', 'error', ...a], { cwd: dir });
ff(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=4', '-f', 'lavfi', '-i', 'sine=f=330:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', 'playa.mp4']);
ff(['-f', 'lavfi', '-i', 'smptehdbars=s=640x360:r=30:d=3', '-c:v', 'mpeg4', 'barras.avi']); // necesita proxy
ff(['-f', 'lavfi', '-i', 'mandelbrot=s=640x360:r=1', '-frames:v', '1', 'foto.png']);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  const f = u.startsWith('/prueba/') ? path.join(dir, path.basename(u)) : path.join(www, path.normalize(u));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});
const ffprobe = (f) => spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout.trim().replace(/\n/g, ' ');

app.whenReady().then(() => srv.listen(0, '127.0.0.1', async () => {
  const downloads = [];
  session.defaultSession.on('will-download', (e, item) => { const p = path.join(dir, 'dl-' + item.getFilename()); item.setSavePath(p); item.once('done', () => downloads.push(p)); });
  const win = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  const logs = []; win.webContents.on('console-message', (e, l, m) => { logs.push(m); if (process.env.VERBOSE) console.log('[página]', m); });
  win.webContents.on('render-process-gone', (e, d) => console.log('proceso de la página terminó:', JSON.stringify(d)));
  win.webContents.on('did-start-navigation', (e, u) => console.log('navegación:', String(e.url || u).slice(0, 120)));
  await win.loadURL(`http://127.0.0.1:${srv.address().port}/index.html`);
  await new Promise((r) => setTimeout(r, 1500));
  const js = (c) => win.webContents.executeJavaScript(c, true);
  const res = {}; let fail = 0;
  const check = (name, ok, info) => { res[name] = (ok ? 'OK ' : 'FALLA ') + (info || ''); if (!ok) fail++; console.log(name.padEnd(22), res[name]); };
  try {
    check('puente cargado', await js('!!(window.api && api.mediaUrl && window.MMXRender)'));
    const info = await js("api.invoke('info')");
    check('info', info.platform === 'web' && Object.keys(info.presets).length > 10, info.version + ' · ' + Object.keys(info.presets).length + ' formatos');
    const t0 = Date.now();
    const imp = await js(`(async () => {
      const get = async (n) => new File([await (await fetch('/prueba/' + n)).blob()], n);
      const files = [await get('playa.mp4'), await get('barras.avi'), await get('foto.png')];
      const ms = await importPaths(files.map((f) => api.pathOf(f)));
      window.T = ms; return ms.map((m) => ({ type: m.type, d: m.duration, w: m.width, thumb: !!m.thumb, url: !!mediaUrl(m.thumb), np: m.needsProxy }));
    })()`);
    check('importar y analizar', imp.length === 3 && imp[0].type === 'video' && imp[2].type === 'image' && imp.every((m) => m.thumb && m.url), JSON.stringify(imp) + ` (${Date.now() - t0} ms)`);
    // espera el proxy del AVI
    let proxy = null; for (let i = 0; i < 120 && !proxy; i++) { await new Promise((r) => setTimeout(r, 500)); proxy = await js('S.p.media[T[1].id] && S.p.media[T[1].id].proxy'); }
    check('proxy', !!proxy, proxy);
    await js(`(async () => {
      const [a, b, f] = T;
      const c1 = clipFromMedia(a); insertClip(c1, S.p.tracks[1], 0);
      const c2 = clipFromMedia(b); c2.transIn = { type: 'fade', dur: 1 }; insertClip(c2, S.p.tracks[1], 4);
      const pip = clipFromMedia(f); pip.dur = 4; pip.frame = { x: .6, y: .05, w: .35, h: .35 }; pip.color.look = 'tealorange'; pip.mask = { shape: 'ellipse', x: .5, y: .5, w: .95, h: .95, feather: .15, invert: false }; insertClip(pip, S.p.tracks[0], 0);
      const t = titleClip(0); t.dur = 3; insertClip(t, S.p.tracks[0], 4);
      seek(1); renderTimeline();
    })()`);
    const fr = await js('(async () => { const r = await api.invoke("frame:render", S.p, 1, 640, await Preview.collectAssets(1)); return r.error || r.data.length; })()');
    check('fotograma exacto', typeof fr === 'number' && fr > 5000, String(fr).slice(0, 300));
    const t1 = Date.now();
    const ex = await js(`(async () => {
      let prog = 0; api.on('export:progress', (f) => { prog = Math.max(prog, f); });
      const p = S.p, pack = await Preview.collectAssets();
      const r = await api.invoke('export:start', p, { out: '/salida/Prueba.mp4', preset: 'mp4-h264', width: 640, height: 360, crf: 26 }, pack);
      return Object.assign({ prog }, r);
    })()`);
    await new Promise((r) => setTimeout(r, 1500));
    const mp4 = downloads.find((d) => d.endsWith('.mp4'));
    check('exportar MP4', ex.ok && mp4 && /h264/.test(ffprobe(mp4)) && ex.prog > 0.9, JSON.stringify(ex).slice(0, 300) + ' · ' + (mp4 ? ffprobe(mp4) : 'sin archivo') + ` (${Date.now() - t1} ms)`);
    if (mp4) { const px = spawnSync('ffmpeg', ['-v', 'error', '-ss', '1', '-i', mp4, '-frames:v', '1', path.join(OUT, 'android-export.png')]); check('captura del video', px.status === 0); }
    await js('window.MMX_DEBUG = true'); const keys = await js("Object.keys(S.info.presets).filter((k) => !['dvd-ntsc','dvd-pal','mp4-h264'].includes(k))").then((k) => (process.env.FORMATS ? k.filter((x) => process.env.FORMATS.split(',').includes(x)) : k)), enc = {};
    await js("window.P2 = JSON.parse(JSON.stringify(S.p)); P2.tracks.forEach((t) => { t.clips = t.clips.filter((c) => c.start < 2); t.clips.forEach((c) => { c.dur = Math.min(c.dur, 2 - c.start); }); });");
    for (const k of keys) {
      const t = Date.now();
      const r = await Promise.race([js(`api.invoke('export:start', P2, { out: '/salida/f.' + S.info.presets['${k}'].ext, preset: '${k}', width: 320, height: 180, crf: 30 }, null)`), new Promise((ok) => setTimeout(() => { js("api.invoke('export:cancel')"); ok({ error: 'tiempo agotado' }); }, 120000))]);
      enc[k] = (r.ok ? 'ok' : (r.error || '').slice(-200)) + ' ' + (Date.now() - t) + 'ms'; console.log('  ', k, enc[k]);
    }
    check('todos los formatos', Object.values(enc).every((v) => v.startsWith('ok')), Object.keys(enc).length + ' formatos');
    const ms = await js('(async () => { const r = await api.invoke("multicam:sync", [T[0].path, T[0].path]); return r; })()');
    check('sincronía multicámara', Array.isArray(ms) && ms.length === 2 && Math.abs(ms[1].seconds) < 0.05, JSON.stringify(ms));
    const persist = await js('(async () => { const ok = await api.invoke("media:exists", [T[0].path, T[0].thumb, "/vfs/x/no.mp4"]); return ok; })()');
    check('persistencia', persist[0] && persist[1] && !persist[2], JSON.stringify(persist));
    win.setSize(1180, 640); await new Promise((r) => setTimeout(r, 800));
    fs.writeFileSync(path.join(OUT, 'android-ui.png'), (await win.webContents.capturePage()).toPNG());
  } catch (e) { check('excepción', false, e.stack || String(e)); }
  for (const [k, v] of Object.entries(res)) console.log(k.padEnd(22), v);
  const errs = logs.filter((l) => /error|Uncaught/i.test(l)); if (errs.length) console.log('consola:', errs.slice(0, 8).join('\n'));
  console.log(fail ? `${fail} prueba(s) fallaron` : 'todo bien', '·', OUT);
  app.exit(fail ? 1 : 0);
}));
