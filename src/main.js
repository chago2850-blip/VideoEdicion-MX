/* MontajeMX — proceso principal (Electron).
 * Copyright (C) 2026 Santiago Miguel — GPL-3.0-or-later. */
'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, shell, session, desktopCapturer, Menu } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { Readable } = require('stream');
const Render = require('./core/render');
const Sync = require('./core/sync');
app.commandLine.appendSwitch('lang', 'es');

const unpack = (p) => (p || '').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
function findBin(mod, pick, fallback) {
  const local = path.join(process.resourcesPath || '', 'bin', fallback + (process.platform === 'win32' ? '.exe' : ''));
  if (fs.existsSync(local)) return local;
  try { const p = unpack(pick(require(mod))); if (p && fs.existsSync(p)) return p; } catch (e) { /* se usa el del sistema */ }
  return fallback;
}
const FFMPEG = findBin('ffmpeg-static', (m) => m, 'ffmpeg');
const FFPROBE = findBin('ffprobe-static', (m) => m.path, 'ffprobe');

protocol.registerSchemesAsPrivileged([{ scheme: 'mmx', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

let win, cacheDir, exportProc = null;
const MIME = { '.json': 'application/json', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.opus': 'audio/ogg' };

/* Sirve la interfaz y los medios desde un mismo origen (mmx://app) con soporte de rangos para poder buscar en el vídeo. */
function serve(request) {
  const url = new URL(request.url);
  let file;
  if (url.pathname === '/media') file = url.searchParams.get('p');
  else { file = path.normalize(path.join(__dirname, decodeURIComponent(url.pathname))); if (!file.startsWith(__dirname)) return new Response('', { status: 403 }); }
  let st;
  try { st = fs.statSync(file); } catch (e) { return new Response('', { status: 404 }); }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = request.headers.get('range');
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
    const start = m[1] ? parseInt(m[1], 10) : 0, end = m[2] ? Math.min(parseInt(m[2], 10), st.size - 1) : st.size - 1;
    if (start >= st.size) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status: 206, headers: { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' } });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(st.size), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' } });
}

function run(bin, args, opts) {
  return new Promise((resolve) => {
    const p = spawn(bin, args, Object.assign({ windowsHide: true }, opts || {}));
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err = (err + d).slice(-6000); });
    p.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
    p.on('close', (code) => resolve({ code, out, err }));
  });
}
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const WEB_V = ['h264', 'vp8', 'vp9', 'av1'], WEB_A = ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_f32le'], WEB_EXT = ['.mp4', '.m4v', '.webm', '.mov', '.mkv', '.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac', '.opus'];
const IMG_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.svg'];

async function probe(file) {
  const ext = path.extname(file).toLowerCase(), st = fs.statSync(file);
  const id = 'm' + hash(file + st.size + st.mtimeMs);
  const media = { id, path: file, name: path.basename(file), type: 'video', duration: 0, width: 0, height: 0, hasAudio: false, hasVideo: false, thumb: null, wave: null, proxy: null, needsProxy: false };
  const r = await run(FFPROBE, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]);
  if (r.code !== 0) throw new Error('No se pudo leer ' + media.name);
  const info = JSON.parse(r.out), v = (info.streams || []).find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic)), a = (info.streams || []).find((s) => s.codec_type === 'audio');
  media.duration = parseFloat((info.format || {}).duration) || 0;
  if (v) {
    media.hasVideo = true; media.width = v.width; media.height = v.height; media.vcodec = v.codec_name;
    const rot = Math.abs(parseInt((v.tags && v.tags.rotate) || ((v.side_data_list || []).find((s) => s.rotation != null) || {}).rotation || 0, 10));
    if (rot === 90 || rot === 270) { media.width = v.height; media.height = v.width; }
    const fr = (v.avg_frame_rate || '0/1').split('/'); media.fps = fr[1] > 0 ? fr[0] / fr[1] : 0;
  }
  if (a) { media.hasAudio = true; media.acodec = a.codec_name; }
  const still = IMG_EXT.includes(ext) || (v && !a && (media.duration < 0.1 || ['png', 'mjpeg', 'bmp', 'webp', 'tiff'].includes(v.codec_name) && media.duration < 0.2));
  if (still) { media.type = 'image'; media.duration = 0; media.hasAudio = false; }
  else if (!v) media.type = 'audio';
  if (media.type === 'video') media.needsProxy = !WEB_EXT.includes(ext) || !WEB_V.includes(media.vcodec) || (a && !WEB_A.includes(media.acodec)) || media.width > 2600;
  if (media.type === 'audio') media.needsProxy = !WEB_EXT.includes(ext) || !WEB_A.includes(media.acodec);
  if (media.type === 'image' && ['.tif', '.tiff'].includes(ext)) media.needsProxy = true;
  // miniatura / forma de onda
  if (media.type === 'audio') {
    const w = path.join(cacheDir, id + '-wave.png');
    if (!fs.existsSync(w)) await run(FFMPEG, ['-y', '-i', file, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=1200x120:colors=0x7ad7c4', '-frames:v', '1', w]);
    if (fs.existsSync(w)) media.wave = w;
  } else {
    const t = path.join(cacheDir, id + '-thumb.jpg');
    if (!fs.existsSync(t)) await run(FFMPEG, ['-y', '-ss', String(media.type === 'video' ? Math.min(1, media.duration / 3) : 0), '-i', file, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', t]);
    if (fs.existsSync(t)) media.thumb = t;
  }
  return media;
}
async function makeProxy(media) {
  const out = path.join(cacheDir, media.id + (media.type === 'audio' ? '-proxy.m4a' : media.type === 'image' ? '-proxy.png' : '-proxy.mp4'));
  if (fs.existsSync(out)) return out;
  const tmp = out.replace(/(\.\w+)$/, '.part$1');
  const args = media.type === 'audio' ? ['-y', '-i', media.path, '-vn', '-c:a', 'aac', '-b:a', '160k', tmp]
    : media.type === 'image' ? ['-y', '-i', media.path, '-frames:v', '1', tmp]
    : ['-y', '-i', media.path, '-vf', 'scale=-2:540', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-g', '15', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', tmp];
  const r = await run(FFMPEG, args);
  if (r.code !== 0) throw new Error('No se pudo crear el proxy: ' + r.err.slice(-300));
  fs.renameSync(tmp, out);
  return out;
}

/* Los títulos (PNG y secuencias 3D) los escribe la interfaz en una carpeta temporal; aquí se añaden LUT y máscaras. */
const TMP_PREFIX = path.join(os.tmpdir(), 'montajemx-');
const okDir = (d) => typeof d === 'string' && d.startsWith(TMP_PREFIX) && !d.includes('..');
ipcMain.handle('asset:new', () => fs.mkdtempSync(TMP_PREFIX));
ipcMain.handle('asset:put', (e, dir, name, dataUrl) => { if (!okDir(dir)) throw new Error('carpeta no válida'); fs.writeFileSync(path.join(dir, path.basename(name)), Buffer.from(dataUrl.split(',')[1], 'base64')); return true; });
ipcMain.handle('asset:drop', (e, dir) => { if (okDir(dir)) cleanup(dir); });
async function prepare(project, opts, pack) {
  const dir = pack && okDir(pack.dir) ? pack.dir : fs.mkdtempSync(TMP_PREFIX);
  const b = Render.build(project, Object.assign({}, opts, { assets: (pack && pack.assets) || {} }));
  for (const f of b.files) fs.writeFileSync(path.join(dir, f.name), f.text);
  for (const j of b.prejobs) { const r = await run(FFMPEG, j, { cwd: dir }); if (r.code !== 0) throw new Error('Error al preparar máscara: ' + r.err.slice(-300)); }
  return { dir, b };
}
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* nada */ } };

function createWindow() {
  win = new BrowserWindow({ width: 1500, height: 920, minWidth: 1100, minHeight: 680, backgroundColor: '#14161b', title: 'MontajeMX', show: false, icon: path.join(__dirname, 'ui', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  win.loadURL('mmx://app/ui/index.html');
  win.once('ready-to-show', () => win.show());
  let closing = false;
  win.on('close', (e) => { if (!closing) { e.preventDefault(); win.webContents.send('app:closing'); } });
  ipcMain.on('app:close-ok', () => { closing = true; if (exportProc) exportProc.kill(); win.close(); });
}

app.whenReady().then(() => {
  cacheDir = path.join(app.getPath('userData'), 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  protocol.handle('mmx', serve);
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'display-capture'].includes(perm)));
  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((s) => cb(process.platform === 'win32' ? { video: s[0], audio: 'loopback' } : { video: s[0] })).catch(() => cb({}));
  });
  createWindow();
});
app.on('window-all-closed', () => app.quit());

const VIDEO_FILTERS = [{ name: 'Medios', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'wmv', 'mpg', 'mpeg', 'm2ts', 'mts', 'ts', 'mxf', '3gp', 'flv', 'vob', 'dv', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma', 'ac3', 'opus', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg'] }, { name: 'Todos', extensions: ['*'] }];
ipcMain.handle('media:pick', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: VIDEO_FILTERS }); return r.canceled ? [] : r.filePaths; });
ipcMain.handle('media:probe', async (e, file) => { try { return await probe(file); } catch (err) { return { error: err.message }; } });
ipcMain.handle('media:proxy', async (e, media) => { try { return { path: await makeProxy(media) }; } catch (err) { return { error: err.message }; } });
ipcMain.handle('media:exists', (e, files) => files.map((f) => fs.existsSync(f)));

ipcMain.handle('project:save', async (e, json, file, saveAs) => {
  if (!file || saveAs) { const r = await dialog.showSaveDialog(win, { defaultPath: file || 'Mi proyecto.mmx', filters: [{ name: 'Proyecto MontajeMX', extensions: ['mmx'] }] }); if (r.canceled) return null; file = r.filePath; }
  fs.writeFileSync(file, json); return file;
});
ipcMain.handle('project:open', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Proyecto MontajeMX', extensions: ['mmx'] }] });
  if (r.canceled) return null;
  return { file: r.filePaths[0], json: fs.readFileSync(r.filePaths[0], 'utf8') };
});
ipcMain.handle('autosave:write', (e, json) => { fs.writeFileSync(path.join(app.getPath('userData'), 'autosave.mmx'), json); return true; });
ipcMain.handle('autosave:read', () => { const f = path.join(app.getPath('userData'), 'autosave.mmx'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; });
ipcMain.handle('file:pickText', async (e, name, exts) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name, extensions: exts }] });
  return r.canceled ? null : { name: path.basename(r.filePaths[0]), text: fs.readFileSync(r.filePaths[0], 'utf8') };
});
ipcMain.handle('confirm', async (e, message, buttons) => (await dialog.showMessageBox(win, { type: 'question', message, buttons, defaultId: 0, cancelId: buttons.length - 1 })).response);
ipcMain.handle('shell:show', (e, file) => shell.showItemInFolder(file));

ipcMain.handle('export:pick', async (e, name, ext) => { const r = await dialog.showSaveDialog(win, { defaultPath: name + '.' + ext, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] }); return r.canceled ? null : r.filePath; });
ipcMain.handle('export:start', async (e, project, opts, pack) => {
  let prep;
  try {
    const preset = Render.PRESETS[opts.preset];
    if (preset.seq) opts.out = opts.out.replace(/\.\w+$/, '') + '_%05d.' + preset.ext;
    prep = await prepare(project, opts, pack);
    return await runExport(prep);
  } catch (err) { return { error: err.message }; } finally { if (prep) cleanup(prep.dir); else if (pack && okDir(pack.dir)) cleanup(pack.dir); }
});
function runExport(prep, out) {
    return new Promise((resolve) => {
      let err = '', buf = '';
      exportProc = spawn(FFMPEG, prep.b.args, { cwd: prep.dir, windowsHide: true });
      exportProc.stdout.on('data', (d) => {
        buf += d; const m = buf.match(/out_time_(?:us|ms)=(\d+)/g);
        if (m) { win.webContents.send('export:progress', Math.min(1, parseInt(m[m.length - 1].split('=')[1], 10) / 1e6 / prep.b.total)); buf = buf.slice(-200); }
      });
      exportProc.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
      exportProc.on('error', (er) => { exportProc = null; resolve({ error: String(er) }); });
      exportProc.on('close', (code, sig) => { exportProc = null; resolve(code === 0 ? { ok: true, out: prep.b.args[prep.b.args.length - 1] } : { error: sig ? 'Exportación cancelada.' : err.split('\n').slice(-8).join('\n') }); });
    });
}
ipcMain.handle('export:cancel', () => { if (exportProc) exportProc.kill(); });
ipcMain.handle('frame:render', async (e, project, t, width, pack, saveTo) => {
  let prep;
  try {
    const out = saveTo || path.join(os.tmpdir(), 'mmx-frame-' + Date.now() + '.png');
    const h = Math.round(width * project.height / project.width / 2) * 2;
    prep = await prepare(project, { frameAt: t, out, width, height: h }, pack);
    const r = await run(FFMPEG, prep.b.args, { cwd: prep.dir });
    if (r.code !== 0) return { error: r.err.split('\n').slice(-6).join('\n') };
    if (saveTo) return { path: out };
    const data = 'data:image/png;base64,' + fs.readFileSync(out).toString('base64'); fs.unlinkSync(out);
    return { data };
  } catch (err) { return { error: err.message }; } finally { if (prep) cleanup(prep.dir); }
});
ipcMain.handle('frame:pick', async () => { const r = await dialog.showSaveDialog(win, { defaultPath: 'Fotograma.png', filters: [{ name: 'PNG', extensions: ['png'] }] }); return r.canceled ? null : r.filePath; });

/* Grabaciones (pantalla, cámara, voz) y fotos de stop motion. */
ipcMain.handle('record:save', async (e, bytes, kind) => {
  const dir = path.join(app.getPath('videos'), 'MontajeMX'); fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  if (kind === 'foto') { const f = path.join(dir, `Foto ${stamp}-${Date.now() % 1000}.png`); fs.writeFileSync(f, Buffer.from(bytes)); return probe(f); }
  const raw = path.join(dir, `.${stamp}.raw.webm`), out = path.join(dir, `${kind === 'voz' ? 'Voz' : kind === 'camara' ? 'Cámara' : 'Pantalla'} ${stamp}.${kind === 'voz' ? 'm4a' : 'mp4'}`);
  fs.writeFileSync(raw, Buffer.from(bytes));
  const args = kind === 'voz' ? ['-y', '-i', raw, '-vn', '-c:a', 'aac', '-b:a', '192k', out]
    : ['-y', '-i', raw, '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out];
  const r = await run(FFMPEG, args); fs.unlinkSync(raw);
  if (r.code !== 0) return { error: 'No se pudo guardar la grabación: ' + r.err.slice(-300) };
  return probe(out);
});
ipcMain.handle('info', () => ({ version: app.getVersion(), ffmpeg: (spawnSync(FFMPEG, ['-version'], { encoding: 'utf8' }).stdout || 'no encontrado').split('\n')[0], platform: process.platform, presets: Object.fromEntries(Object.entries(Render.PRESETS).map(([k, v]) => [k, { name: v.name, ext: v.ext, crf: !!v.crf, audioOnly: !!v.audioOnly, fixed: v.fixed || null, no51: !!v.no51 }])) }));

/* ---------- multicámara: desfase entre cámaras a partir del audio ---------- */
ipcMain.handle('multicam:sync', async (e, files) => {
  const envs = [];
  for (const f of files) {
    const raw = path.join(os.tmpdir(), 'mmx-sync-' + hash(f) + '.pcm');
    const r = await run(FFMPEG, ['-y', '-t', '240', '-i', f, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', raw]);
    envs.push(r.code === 0 && fs.existsSync(raw) && fs.statSync(raw).size > 16000 ? Sync.envelope(fs.readFileSync(raw), 8000) : null);
    try { fs.unlinkSync(raw); } catch (er) { /* nada */ }
  }
  return envs.map((en, i) => (i === 0 || !en || !envs[0] ? { seconds: 0, score: i === 0 ? 1 : 0 } : Sync.delay(envs[0], en, 60)));
});

/* ---------- DVD con menú (usa dvdauthor/spumux si están instalados) ---------- */
function findTool(names) {
  const exts = process.platform === 'win32' ? ['.exe', ''] : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter).concat(['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/opt/local/bin', path.join(process.resourcesPath || '', 'bin')]);
  for (const nm of names) for (const d of dirs) for (const x of exts) { const f = path.join(d, nm + x); try { if (d && fs.statSync(f).isFile()) return f; } catch (er) { /* sigue */ } }
  return null;
}
const dvdTools = () => ({ dvdauthor: findTool(['dvdauthor']), spumux: findTool(['spumux']), iso: findTool(['genisoimage', 'mkisofs', 'xorriso']) || (process.platform === 'darwin' ? findTool(['hdiutil']) : null) });
ipcMain.handle('dvd:tools', () => { const t = dvdTools(); return { dvdauthor: !!t.dvdauthor, spumux: !!t.spumux, iso: !!t.iso, platform: process.platform }; });
ipcMain.handle('dvd:pickDir', async () => { const r = await dialog.showOpenDialog(win, { title: 'Carpeta donde crear el DVD', properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle('dvd:build', async (e, project, pack, cfg) => {
  const stage = (t) => win.webContents.send('dvd:stage', t);
  const tools = dvdTools(), pal = cfg.standard === 'pal', fmt = pal ? 'pal' : 'ntsc';
  const safe = (cfg.name || 'DVD').replace(/[^\w\- áéíóúñÁÉÍÓÚÑ]/g, '').trim() || 'DVD';
  const outDir = path.join(cfg.outDir, safe + ' DVD');
  let prep;
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const movie = path.join(outDir, 'pelicula.mpg');
    stage('Codificando la película en MPEG-2…');
    prep = await prepare(project, { out: movie, preset: pal ? 'dvd-pal' : 'dvd-ntsc', surround: !!cfg.surround }, pack);
    const r = await runExport(prep);
    if (r.error) return { error: r.error };
    if (!tools.dvdauthor || !tools.spumux) return { ok: true, partial: true, movie, outDir };
    const work = fs.mkdtempSync(TMP_PREFIX), w = (n, d) => fs.writeFileSync(path.join(work, n), Buffer.from(d.split(',')[1], 'base64'));
    try {
      stage('Creando el menú…');
      w('bg.png', cfg.menu.bg); w('hl.png', cfg.menu.hl); w('sel.png', cfg.menu.sel);
      let rr = await run(FFMPEG, ['-y', '-loop', '1', '-i', 'bg.png', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '2', '-target', fmt + '-dvd', '-aspect', '16:9', 'menu.mpg'], { cwd: work });
      if (rr.code !== 0) return { error: 'No se pudo crear el video del menú:\n' + rr.err.slice(-400) };
      const B = cfg.menu.buttons, nm = (i) => 'b' + (((i % B.length) + B.length) % B.length + 1);
      fs.writeFileSync(path.join(work, 'spu.xml'), `<subpictures><stream><spu start="00:00:00.00" highlight="hl.png" select="sel.png" force="yes">\n${B.map((b, i) => `<button name="${nm(i)}" x0="${b.x0}" y0="${b.y0}" x1="${b.x1}" y1="${b.y1}" up="${nm(i - 1)}" down="${nm(i + 1)}"/>`).join('\n')}\n</spu></stream></subpictures>\n`);
      rr = await new Promise((resolve) => {
        const pr = spawn(tools.spumux, ['-m', 'dvd', 'spu.xml'], { cwd: work, env: Object.assign({}, process.env, { VIDEO_FORMAT: fmt.toUpperCase() }), windowsHide: true }); let err = '';
        fs.createReadStream(path.join(work, 'menu.mpg')).pipe(pr.stdin); pr.stdout.pipe(fs.createWriteStream(path.join(work, 'menu_spu.mpg')));
        pr.stderr.on('data', (d) => { err = (err + d).slice(-3000); }); pr.stdin.on('error', () => {}); pr.on('error', (er) => resolve({ code: -1, err: String(er) })); pr.on('close', (code) => resolve({ code, err }));
      });
      if (rr.code !== 0) return { error: 'spumux falló:\n' + rr.err.slice(-500) };
      stage('Escribiendo la estructura del DVD (VIDEO_TS)…');
      const hms = (t) => { const s = Math.floor(t % 60), m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600); return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; };
      const chapters = [0].concat((cfg.chapters || []).filter((t) => t > 1)).map(hms).join(',');
      const esc = (f) => f.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      // el menú vive en el conjunto de títulos (menú raíz) para poder saltar a capítulos concretos
      fs.writeFileSync(path.join(work, 'dvd.xml'), `<dvdauthor>\n<vmgm><fpc>jump titleset 1 menu;</fpc></vmgm>\n<titleset>\n<menus><video format="${fmt}" aspect="16:9"/><pgc entry="root">\n<vob file="${esc(path.join(work, 'menu_spu.mpg'))}" pause="inf"/>\n${B.map((b, i) => `<button name="${nm(i)}">jump title 1 chapter ${b.chapter};</button>`).join('\n')}\n</pgc></menus>\n<titles><video format="${fmt}" aspect="16:9"/><pgc>\n<vob file="${esc(movie)}" chapters="${chapters}"/>\n<post>call menu;</post>\n</pgc></titles>\n</titleset>\n</dvdauthor>\n`);
      const disc = path.join(outDir, 'disco'); fs.rmSync(disc, { recursive: true, force: true });
      rr = await run(tools.dvdauthor, ['-o', disc, '-x', path.join(work, 'dvd.xml')], { env: Object.assign({}, process.env, { VIDEO_FORMAT: fmt.toUpperCase() }) });
      if (rr.code !== 0 || !fs.existsSync(path.join(disc, 'VIDEO_TS', 'VIDEO_TS.IFO'))) return { error: 'dvdauthor falló:\n' + rr.err.slice(-600) };
      let iso = null;
      if (tools.iso) {
        stage('Creando la imagen ISO…');
        iso = path.join(outDir, safe + '.iso'); const label = safe.toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 30) || 'DVD', tool = path.basename(tools.iso).replace('.exe', '');
        const args = tool === 'hdiutil' ? ['makehybrid', '-udf', '-udf-volume-name', label, '-o', iso, disc] : tool === 'xorriso' ? ['-as', 'mkisofs', '-dvd-video', '-V', label, '-o', iso, disc] : ['-dvd-video', '-V', label, '-o', iso, disc];
        try { fs.unlinkSync(iso); } catch (er) { /* no existía */ }
        rr = await run(tools.iso, args); if (rr.code !== 0) iso = null;
      }
      fs.unlinkSync(movie);
      return { ok: true, outDir, disc, iso };
    } finally { cleanup(work); }
  } catch (err) { return { error: err.message }; } finally { if (prep) cleanup(prep.dir); }
});
