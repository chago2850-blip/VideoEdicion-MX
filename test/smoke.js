/* Prueba de humo: arranca la app real, monta proyectos de prueba y ejercita cada función de extremo a extremo.
 * Uso: xvfb-run -a electron --no-sandbox test/smoke.js   (OUT=carpeta para guardar capturas) */
const { app, BrowserWindow } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');
const { spawnSync } = require('child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmx-smoke-')), OUT = process.env.OUT || dir;
app.setPath('userData', path.join(dir, 'ud'));
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const ff = (a) => { const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...a], { cwd: dir, encoding: 'utf8' }); if (r.status !== 0) console.log('ffmpeg prep', r.stderr.slice(-300)); };
ff(['-f','lavfi','-i','testsrc2=s=1280x720:r=30:d=6','-f','lavfi','-i','sine=f=330:d=6','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest','playa.mp4']);
ff(['-f','lavfi','-i','smptehdbars=s=1280x720:r=30:d=5','-c:v','libx264','-pix_fmt','yuv420p','barras.mp4']);
ff(['-f','lavfi','-i','mandelbrot=s=1280x720:r=1','-frames:v','1','foto.png']);
ff(['-f','lavfi','-i','sine=f=220:d=20','musica.mp3']);
// objeto en movimiento sobre fondo fijo, con trayectoria conocida (para el seguimiento)
ff(['-loop','1','-i','foto.png','-f','lavfi','-i','smptebars=s=160x120:r=30','-filter_complex',"[0][1]overlay=x='100+120*t':y='200+40*t'",'-t','6','-r','30','-c:v','libx264','-g','10','-pix_fmt','yuv420p','objeto.mp4']);
// dos cámaras de la misma escena; la B empezó a grabar 1.7 s después
const beat = "sine=f=440:d=14,volume='if(lt(mod(t*1.3+sin(t*2.1),1),0.22),1,0.02)':eval=frame";
ff(['-f','lavfi','-i','color=c=0x993333:s=640x360:r=30:d=14','-f','lavfi','-i',beat,'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest','camA.mp4']);
ff(['-ss','1.7','-i','camA.mp4','-vf','hue=h=120','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','camB.mp4']);
require('../src/main.js');
app.whenReady().then(() => setTimeout(async () => {
  const win = BrowserWindow.getAllWindows()[0], wc = win.webContents, logs = [], res = {};
  wc.on('console-message', (e, level, msg) => logs.push(msg));
  const js = (code) => wc.executeJavaScript(code, true);
  const shot = async (n) => fs.writeFileSync(path.join(OUT, n), (await wc.capturePage()).toPNG());
  const P = (f) => JSON.stringify(path.join(dir, f));
  const probe = (f) => spawnSync('ffprobe', ['-v','error','-show_entries','format=duration:stream=codec_name,channels','-of','csv=p=0', f], { encoding: 'utf8' }).stdout.trim().replace(/\n/g, ' ');
  const px = (f, t, x, y) => [...spawnSync('ffmpeg', ['-v','error','-ss',String(t),'-i',f,'-frames:v','1','-vf',`crop=2:2:${x}:${y},scale=1:1`,'-f','rawvideo','-pix_fmt','rgb24','-'], { maxBuffer: 1 << 20 }).stdout.slice(0, 3)];
  try {
    // 1. montaje básico, reproducción y exportación
    await js(`(async () => {
      const [a,b,f,mu] = await importPaths([${P('playa.mp4')},${P('barras.mp4')},${P('foto.png')},${P('musica.mp3')}]);
      window.T = { a, b, f, mu };
      const c1 = clipFromMedia(a); insertClip(c1, S.p.tracks[1], 0);
      const c2 = clipFromMedia(b); c2.transIn = {type:'wipeR',dur:1}; insertClip(c2, S.p.tracks[1], 6);
      const pip = clipFromMedia(f); pip.dur = 6; pip.frame = {x:.66,y:.06,w:.3,h:.3}; pip.fit='cover'; pip.color.look='tealorange'; pip.mask={shape:'ellipse',x:.5,y:.5,w:.95,h:.95,feather:.15,invert:false}; insertClip(pip, S.p.tracks[0], 1);
      const m = clipFromMedia(mu); m.dur = 11; m.fadeOut = 2; insertClip(m, S.p.tracks[3], 0);
      c1.color.contrast = .15; c1.kf.scale=[{t:0,v:1},{t:6,v:1.15}];
      const t3 = title3dClip(4); t3.dur = 3; t3.t3.text = 'MONTAJE'; insertClip(t3, S.p.tracks[2], 0); const tk = S.p.tracks.splice(2,1)[0]; S.p.tracks.unshift(tk);
      select(c2.id); seek(6.5); Actions.fit(); renderTimeline(); renderInspector();
      await new Promise(r => setTimeout(r, 2500));
    })()`);
    await shot('f2-barrido.png');
    await js(`select(S.p.tracks[0].clips[0].id); seek(1.2); new Promise(r => setTimeout(r, 2500))`);
    res.webgl = await js(`Title3D.available()`);
    res.t3pixels = await js(`(() => { const c = document.querySelector('#view'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i+2] > 150 && d[i] < 190 && d[i+1] > 100 && d[i+1] < 220) n++; return n; })()`);
    await shot('f2-titulo3d.png');
    await js(`Actions.play(); new Promise(r => setTimeout(r, 1500))`); res.playT = await js('S.t'); await js('Preview.pause()');
    const out1 = path.join(dir, 'salida.mp4');
    res.export = await js(`Preview.collectAssets().then(pk => api.invoke('export:start', S.p, {out:${JSON.stringify(out1)}, preset:'mp4-h264', width:640, height:360, surround:true}, pk)).then(r => r.ok ? 'ok' : r.error)`);
    res.probe = probe(out1);
    res.t3exported = px(out1, 1.2, 320, 180).join('/');
    res.exact = await js(`Preview.collectAssets(1.2).then(pk => api.invoke('frame:render', S.p, 1.2, 640, pk)).then(r => r.error || 'ok')`);

    // 2. seguimiento de movimiento con trayectoria conocida
    res.track = await js(`(async () => {
      S.p = MMX.newProject(); S.sel = null; refreshAll();
      const [o, f] = await importPaths([${P('objeto.mp4')}, ${P('foto.png')}]);
      const c = clipFromMedia(o); insertClip(c, S.p.tracks[1], 0);
      c.mask = { shape:'rect', x:(100+120+80)/1280, y:(200+40+60)/720, w:170/1280, h:130/720, feather:0, invert:false };
      seek(1); await new Promise(r => setTimeout(r, 600));
      const r = await Tracker.run(c, false, () => {}, () => false);
      c.kf.mx = r.mx; c.kf.my = r.my;
      const at = (t) => [MMX.valueAt(c,'mx',t,0), MMX.valueAt(c,'my',t,0)], exp = (t) => [(180+120*t)/1280, (260+40*t)/720];
      const err = [0, 2.5, 5].map(t => Math.hypot(at(t)[0]-exp(t)[0], at(t)[1]-exp(t)[1]));
      c.fx.mosaic = 40; const bg = clipFromMedia(o); insertClip(bg, S.p.tracks[2], 0);
      const lab = titleClip(1); lab.dur = 6; insertClip(lab, S.p.tracks[0], 0); const n = Tracker.attach(c, S.p.tracks[1], lab);
      select(c.id); seek(4); renderInspector(); await new Promise(r => setTimeout(r, 1200));
      return { keys: r.mx.length, lost: r.lost, frames: r.frames, maxErr: +Math.max(...err).toFixed(4), attached: n };
    })()`);
    await shot('f2-seguimiento.png');
    const out2 = path.join(dir, 'seguimiento.mp4');
    res.trackExport = await js(`Preview.collectAssets().then(pk => api.invoke('export:start', S.p, {out:${JSON.stringify(out2)}, preset:'mp4-h264', width:640, height:360}, pk)).then(r => r.ok ? 'ok' : r.error)`);

    // 3. multicámara: sincronización por audio, cortes y secuencia
    res.multicam = await js(`(async () => {
      S.p = MMX.newProject(); S.sel = null; refreshAll();
      const cams = await importPaths([${P('camA.mp4')}, ${P('camB.mp4')}]);
      const sync = await api.invoke('multicam:sync', cams.map(m => m.path));
      const delays = sync.map(x => x.seconds);
      const ed = Multicam.editor(cams, delays, 'prueba'); await new Promise(r => setTimeout(r, 1500));
      ed.seekTo(3); ed.switchTo(1); ed.seekTo(6); ed.switchTo(0); ed.seekTo(9); ed.switchTo(1); await new Promise(r => setTimeout(r, 800));
      window.__ed = ed; return { delays, score: +sync[1].score.toFixed(2), total: +ed.total.toFixed(2), cuts: ed.cuts.length };
    })()`);
    await shot('f2-multicamara.png');
    res.multicamSeq = await js(`(async () => { document.querySelector('#modal-box .foot .primary').click(); await new Promise(r => setTimeout(r, 800)); const v = S.p.tracks[0]; return { track: v.name, clips: v.clips.map(c => [S.p.media[c.mediaId].name, +c.start.toFixed(2), +c.dur.toFixed(2), +c.in.toFixed(2)].join(' ')), audio: S.p.tracks[S.p.tracks.length-1].clips.length }; })()`);
    const out3 = path.join(dir, 'multicam.mp4');
    res.multicamExport = await js(`Preview.collectAssets().then(pk => api.invoke('export:start', S.p, {out:${JSON.stringify(out3)}, preset:'mp4-h264', width:320, height:180}, pk)).then(r => r.ok ? 'ok' : r.error)`);
    res.multicamPixels = [2, 4, 7].map((t) => px(out3, t, 160, 90).join('/'));

    // 4. DVD con menú
    await js(`Dvd.open(); new Promise(r => setTimeout(r, 2500))`); await shot('f2-dvd.png');
    res.dvd = await js(`(async () => { Dialogs.close(); const cfg = { template: 1, standard: 'ntsc', title: 'Prueba DVD', chapters: Dvd.chaptersFor('cuts') }; const m = Dvd.render(cfg, null); const pk = await Preview.collectAssets();
      const r = await api.invoke('dvd:build', S.p, pk, { outDir: ${JSON.stringify(dir)}, name: cfg.title, standard: 'ntsc', chapters: cfg.chapters, surround: true, menu: { bg: m.bg, hl: m.hl, sel: m.sel, buttons: m.buttons } }); return { tools: await api.invoke('dvd:tools'), chapters: cfg.chapters, buttons: m.buttons.length, r }; })()`);
    if (res.dvd.r.disc) { res.dvdFiles = fs.readdirSync(path.join(res.dvd.r.disc, 'VIDEO_TS')); res.isoMB = res.dvd.r.iso ? +(fs.statSync(res.dvd.r.iso).size / 1e6).toFixed(1) : 0; }

    // 5. acciones de edición y diálogos
    res.acts = await js(`(async () => { const log = []; const step = async (n, f) => { try { await f(); log.push(n + ':ok'); } catch (e) { log.push(n + ':FALLO ' + e.message); } };
      await step('dividir', () => { const c = S.p.tracks[0].clips[0]; select(c.id); seek(c.start + 1); Actions.split(); });
      await step('congelar', () => { const c = S.p.tracks[0].clips[0]; select(c.id); seek(c.start + 0.5); Actions.freeze(); });
      await step('censurar', () => { select(S.p.tracks[0].clips[0].id); Actions.censor(); if (!selected().clip.mask) throw new Error('sin máscara'); });
      await step('duplicar/copiar/pegar', () => { Actions.dup(); Actions.copy(); seek(40); Actions.paste(); });
      await step('deshacer/rehacer', () => { Actions.undo(); Actions.undo(); Actions.redo(); });
      await step('inspector de todos los clips', () => { insertClip(titleClip(0)); insertClip(title3dClip(1)); for (const t of S.p.tracks) for (const c of t.clips) { select(c.id); document.querySelectorAll('#insp-body details').forEach(d => d.open = true); renderInspector(); Inspector.sync(); document.querySelectorAll('#insp-body .kf').forEach(b => b.click()); } });
      await step('pestañas', () => { for (const k of Object.keys(TABS)) { S.tab = k; renderLibrary(); } });
      await step('diálogos', () => { Dialogs.settings(); Dialogs.close(); Dialogs.about(); Dialogs.close(); Dialogs.track(S.p.tracks[0]); Dialogs.close(); Dialogs.exportDlg(); Dialogs.close(); Multicam.open(); Dialogs.close(); });
      await step('guardar/cargar', async () => { await loadProject(JSON.stringify(S.p), null); });
      await step('película rápida', async () => { Dialogs.quick(); document.querySelector('#modal-box .primary').click(); await new Promise(r => setTimeout(r, 600)); });
      return log; })()`);
    res.errors = logs.filter((l) => /error|Uncaught|TypeError|ReferenceError/i.test(l)).slice(0, 8);
    for (const f of ['salida.mp4', 'seguimiento.mp4']) if (fs.existsSync(path.join(dir, f))) fs.copyFileSync(path.join(dir, f), path.join(OUT, f));
    console.log('SMOKE ' + JSON.stringify(res, null, 1));
  } catch (e) { console.log('SMOKE FAIL', e, JSON.stringify(res), logs.slice(-12)); }
  app.exit(0);
}, 2500));
