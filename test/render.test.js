/* Pruebas de extremo a extremo del motor: generan medios sintéticos, exportan con FFmpeg real y verifican el resultado. */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const M = require('../src/core/model');
const R = require('../src/core/render');

let FF = process.env.FFMPEG || 'ffmpeg', FP = process.env.FFPROBE || 'ffprobe';
if (spawnSync(FF, ['-version']).error) { FF = require('ffmpeg-static'); FP = require('ffprobe-static').path; }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mmx-test-'));
const ff = (args, cwd) => { const r = spawnSync(FF, args, { cwd: cwd || tmp, encoding: 'utf8', maxBuffer: 1 << 26 }); if (r.status !== 0) throw new Error('ffmpeg falló:\n' + args.join(' ') + '\n' + (r.stderr || '').slice(-1500)); return r; };
const probe = (f) => JSON.parse(spawnSync(FP, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', f], { encoding: 'utf8' }).stdout);
const pixel = (file, t, x, y) => { const r = spawnSync(FF, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 20 }); return [...r.stdout.slice(0, 3)]; };
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); } };
const run = (p, opts) => { const b = R.build(p, opts); for (const f of b.files) fs.writeFileSync(path.join(tmp, f.name), f.text); for (const j of b.prejobs) ff(j); ff(b.args); return b; };

// medios sintéticos
const red = path.join(tmp, 'red.mp4'), blue = path.join(tmp, 'blue.mp4'), green = path.join(tmp, 'green.mp4'), tone = path.join(tmp, 'tone.wav'), img = path.join(tmp, 'white.png');
ff(['-y', '-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=30:d=4', '-f', 'lavfi', '-i', 'sine=f=440:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', red]);
ff(['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=30:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', blue]);
ff(['-y', '-f', 'lavfi', '-i', 'color=c=0x00ff00:s=640x360:r=30:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', green]);
ff(['-y', '-f', 'lavfi', '-i', 'sine=f=880:d=6', tone]);
ff(['-y', '-f', 'lavfi', '-i', 'color=c=white:s=200x200', '-frames:v', '1', img]);

const mk = () => { const p = M.newProject(); p.width = 640; p.height = 360; p.fps = 30;
  p.media = { red: { id: 'red', path: red, type: 'video', duration: 4, width: 640, height: 360, hasAudio: true },
    blue: { id: 'blue', path: blue, type: 'video', duration: 4, width: 640, height: 360, hasAudio: false },
    green: { id: 'green', path: green, type: 'video', duration: 4, width: 640, height: 360, hasAudio: false },
    tone: { id: 'tone', path: tone, type: 'audio', duration: 6, hasAudio: true }, img: { id: 'img', path: img, type: 'image', width: 200, height: 200 } };
  return p; };
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= (tol || 40));

console.log('1. Corte, disolvencia y mezcla de audio');
{ const p = mk();
  p.tracks[1].clips.push(M.newClip('video', { mediaId: 'red', start: 0, dur: 2 }), M.newClip('video', { mediaId: 'blue', start: 2, dur: 2, transIn: { type: 'fade', dur: 1 } }));
  p.tracks[3].clips.push(M.newClip('audio', { mediaId: 'tone', start: 0, dur: 4, fadeIn: 0.5, fadeOut: 0.5, volume: 0.5 }));
  const out = path.join(tmp, 't1.mp4'); run(p, { out, preset: 'mp4-h264' });
  const pr = probe(out);
  ok(Math.abs(parseFloat(pr.format.duration) - 4) < 0.15, 'duración 4 s', pr.format.duration);
  ok(pr.streams.some((s) => s.codec_name === 'h264') && pr.streams.some((s) => s.codec_name === 'aac'), 'H.264 + AAC');
  ok(near(pixel(out, 1, 320, 180), [254, 0, 0]), 'rojo en t=1', pixel(out, 1, 320, 180));
  const mid = pixel(out, 2.5, 320, 180); ok(mid[0] > 60 && mid[2] > 60, 'mezcla rojo/azul a mitad de la disolvencia', mid);
  ok(near(pixel(out, 3.5, 320, 180), [0, 0, 254]), 'azul en t=3.5', pixel(out, 3.5, 320, 180)); }

console.log('2. Imagen sobre imagen, pantalla dividida, fotogramas clave, croma, máscara y color');
{ const p = mk();
  p.tracks[3].clips.push(M.newClip('video', { mediaId: 'blue', start: 0, dur: 3 }));
  p.tracks[2].clips.push(M.newClip('video', { mediaId: 'red', start: 0, dur: 3, frame: { x: 0, y: 0, w: 0.5, h: 1 }, fit: 'cover' }));
  p.tracks[1].clips.push(M.newClip('video', { mediaId: 'green', start: 0, dur: 3, chroma: { enabled: true, color: '#00ff00', similarity: 0.2, blend: 0.05 } }));
  const pip = M.newClip('image', { mediaId: 'img', start: 0, dur: 3, scale: 0.5, kf: { x: [{ t: 0, v: 0.25 }, { t: 2, v: 0.25 }], y: [{ t: 0, v: -0.3 }, { t: 2, v: 0.3 }] }, mask: { shape: 'ellipse', x: 0.5, y: 0.5, w: 0.9, h: 0.9, feather: 0.1, invert: false } });
  pip.color.look = 'invert';
  p.tracks[0].clips.push(pip);
  const out = path.join(tmp, 't2.mp4'); run(p, { out, preset: 'mp4-h264' });
  ok(near(pixel(out, 1, 80, 180), [254, 0, 0]), 'mitad izquierda roja (pantalla dividida)', pixel(out, 1, 80, 180));
  ok(near(pixel(out, 1, 600, 20), [0, 0, 254]), 'croma verde eliminado: se ve el azul', pixel(out, 1, 600, 20));
  ok(near(pixel(out, 0, 480, 72), [0, 0, 0], 50), 'PIP invertido (blanco→negro) arriba en t=0', pixel(out, 0, 480, 72));
  ok(near(pixel(out, 2.5, 480, 288), [0, 0, 0], 50), 'PIP se movió abajo en t=2.5 (fotogramas clave)', pixel(out, 2.5, 480, 288));
  ok(near(pixel(out, 2.5, 480, 72), [0, 0, 254]), 'la posición anterior quedó libre', pixel(out, 2.5, 480, 72));
  ok(near(pixel(out, 2.5, 394, 202), [0, 0, 254]), 'esquina fuera de la máscara elíptica es transparente', pixel(out, 2.5, 394, 202)); }

console.log('3. Velocidad, inversa, rotación, modos de mezcla, efectos, atenuación y opacidad animada');
{ const p = mk(); p.duck.enabled = true; p.tracks[2].role = 'voz';
  p.tracks[3].clips.push(M.newClip('video', { mediaId: 'red', start: 0, dur: 2, speed: 2, muted: true }));
  p.tracks[2].clips.push(M.newClip('audio', { mediaId: 'tone', start: 0.5, dur: 1, pitch: 3, pan: -0.5 }));
  const b = M.newClip('video', { mediaId: 'blue', start: 0, dur: 2, blend: 'screen', rotation: 15, reverse: true, scale: 0.8, kf: { opacity: [{ t: 0, v: 1 }, { t: 2, v: 0.6 }], scale: [{ t: 0, v: 0.8 }, { t: 2, v: 1 }] }, transOut: { type: 'slideL', dur: 0.5 } });
  b.fx.blur = 4; b.fx.vignette = 0.5; b.fx.grain = 5; b.fx.mosaic = 12; b.fx.sharpen = 1; b.color.saturation = -0.3; b.color.contrast = 0.2;
  p.tracks[1].clips.push(b);
  p.tracks[0].clips.push(M.newClip('color', { start: 1, dur: 1, fill: '#ffff00', opacity: 0.5, transIn: { type: 'zoom', dur: 0.5 }, transOut: { type: 'black', dur: 0.3 } }));
  const out = path.join(tmp, 't3.webm'); run(p, { out, preset: 'webm-vp9', width: 320, height: 180, crf: 40 });
  const pr = probe(out), v = pr.streams.find((s) => s.codec_type === 'video');
  ok(v.codec_name === 'vp9' && v.width === 320 && v.height === 180, 'WebM VP9 a 320×180');
  ok(Math.abs(parseFloat(pr.format.duration) - 2) < 0.2, 'duración 2 s', pr.format.duration);
  const c = pixel(out, 0.5, 160, 90); ok(c[0] > 150 && c[2] > 80, 'modo Trama: rojo + azul = magenta', c); }

console.log('4. Otros formatos y fotograma único');
{ const p = mk();
  p.tracks[1].clips.push(M.newClip('video', { mediaId: 'red', start: 0, dur: 1 }));
  for (const [preset, codec] of [['gif', 'gif'], ['mov-prores', 'prores'], ['mov-alpha', 'prores'], ['mp4-hevc', 'hevc'], ['avi', 'mpeg4'], ['dvd-ntsc', 'mpeg2video'], ['mp3', 'mp3'], ['wav', 'pcm_s16le'], ['flac', 'flac']]) {
    const out = path.join(tmp, 't4-' + preset + '.' + R.PRESETS[preset].ext);
    try { run(p, { out, preset, width: 320, height: 180 }); ok(probe(out).streams.some((s) => s.codec_name === codec), R.PRESETS[preset].name); }
    catch (e) { ok(false, R.PRESETS[preset].name, e.message.slice(-300)); }
  }
  const png = path.join(tmp, 'frame.png'); run(p, { out: png, frameAt: 0.5, width: 320, height: 180 });
  ok(fs.existsSync(png) && near(pixel(png, 0, 100, 100), [254, 0, 0]), 'fotograma exacto en PNG'); }

console.log('5. Modelo');
{ const c = M.newClip('video', { kf: { x: [{ t: 0, v: 0 }, { t: 2, v: 1 }] } });
  ok(Math.abs(M.valueAt(c, 'x', 1) - 0.5) < 1e-9, 'interpolación lineal de fotogramas clave');
  const lut = M.buildLut(Object.assign(M.defaultColor(), { look: 'bw' }), 9), cube = M.parseCube(M.lutToCube(lut));
  ok(cube.size === 9 && Math.abs(cube.data[3] - cube.data[4]) < 1e-4, 'LUT .cube ida y vuelta');
  const p = mk(); p.duck.enabled = true; p.tracks[0].role = 'voz'; p.tracks[0].clips.push(M.newClip('audio', { mediaId: 'tone', start: 2, dur: 2 }));
  ok(Math.abs(M.duckGain(p, p.tracks[1], 3) - 0.25) < 1e-9 && M.duckGain(p, p.tracks[1], 0) === 1, 'atenuación automática'); }


console.log('6. Barridos, morph, máscara animada (seguimiento) y 5.1');
{ const p = mk();
  p.tracks[1].clips.push(M.newClip('video', { mediaId: 'red', start: 0, dur: 2, muted: true }), M.newClip('video', { mediaId: 'blue', start: 2, dur: 2, transIn: { type: 'wipeR', dur: 1 } }));
  const out = path.join(tmp, 't6.mp4'); run(p, { out, preset: 'mp4-h264' });
  ok(near(pixel(out, 2.5, 100, 180), [0, 0, 254]) && near(pixel(out, 2.5, 540, 180), [254, 0, 0]), 'barrido →: a la mitad, izquierda azul y derecha roja', [pixel(out, 2.5, 100, 180), pixel(out, 2.5, 540, 180)]);
  ok(near(pixel(out, 3.5, 540, 180), [0, 0, 254]), 'barrido terminado', pixel(out, 3.5, 540, 180));
  const p2 = mk();
  p2.tracks[2].clips.push(M.newClip('video', { mediaId: 'blue', start: 0, dur: 3 }));
  p2.tracks[1].clips.push(M.newClip('video', { mediaId: 'red', start: 0, dur: 3, muted: true, mask: { shape: 'rect', x: 0.2, y: 0.5, w: 0.2, h: 0.4, feather: 0, invert: false }, kf: { mx: [{ t: 0, v: 0.2 }, { t: 2, v: 0.8 }], mw: [{ t: 0, v: 0.2 }, { t: 2, v: 0.3 }] } }));
  p2.tracks[0].clips.push(M.newClip('video', { mediaId: 'green', start: 0, dur: 3, scale: 0.3, y: -0.3, transIn: { type: 'morph', dur: 1 }, transOut: { type: 'wipeU', dur: 1 } }));
  const o2 = path.join(tmp, 't6b.mp4'); run(p2, { out: o2, preset: 'mp4-h264' });
  ok(near(pixel(o2, 0.1, 128, 180), [254, 0, 0]) && near(pixel(o2, 0.1, 512, 180), [0, 0, 254]), 'máscara en x=0.2 al inicio', [pixel(o2, 0.1, 128, 180), pixel(o2, 0.1, 512, 180)]);
  ok(near(pixel(o2, 2.5, 512, 180), [254, 0, 0]) && near(pixel(o2, 2.5, 128, 180), [0, 0, 254]), 'la máscara siguió el rastro hasta x=0.8', [pixel(o2, 2.5, 512, 180), pixel(o2, 2.5, 128, 180)]);
  ok(near(pixel(o2, 2.5, 420, 180), [254, 0, 0]) , 'la máscara creció (ancho 0.3)', pixel(o2, 2.5, 420, 180));
  const p3 = mk(); p3.tracks[0].surround = 'center'; p3.tracks[1].surround = 'rear';
  p3.tracks[0].clips.push(M.newClip('audio', { mediaId: 'tone', start: 0, dur: 2 }));
  p3.tracks[2].clips.push(M.newClip('video', { mediaId: 'red', start: 0, dur: 2 }));
  const level = (file, ch) => { const r = spawnSync(FF, ['-hide_banner', '-i', file, '-af', `pan=mono|c0=${ch},volumedetect`, '-f', 'null', '-'], { encoding: 'utf8' }); return parseFloat((/mean_volume: ([-\d.]+)/.exec(r.stderr) || [0, -99])[1]); };
  for (const [preset, codec] of [['mp4-h264', 'aac'], ['ac3', 'ac3'], ['webm-vp9', 'opus'], ['dvd-ntsc', 'ac3']]) {
    const o3 = path.join(tmp, 't6c-' + preset + '.' + R.PRESETS[preset].ext); let chs = 0;
    try { run(p3, { out: o3, preset, surround: true, width: 320, height: 180 }); chs = (probe(o3).streams.find((s) => s.codec_type === 'audio') || {}).channels; } catch (e) { console.log(e.message.slice(-400)); }
    ok(chs === 6, '5.1 en ' + R.PRESETS[preset].name, chs);
  }
  const o4 = path.join(tmp, 't6c-ac3.ac3');
  ok(level(o4, 'FC') > -30 && level(o4, 'BL') < -60, 'la pista «Centro» suena en el canal central y no en los traseros', [level(o4, 'FC'), level(o4, 'BL')]);
  ok(level(o4, 'FL') > -30, 'la pista «Frontal» suena en el canal izquierdo', level(o4, 'FL'));
  run(p3, { out: path.join(tmp, 't6d.mp3'), preset: 'mp3', surround: true });
  ok(probe(path.join(tmp, 't6d.mp3')).streams[0].channels === 2, 'MP3 cae a estéreo (no admite 5.1)'); }

console.log(`\n${pass} correctas, ${fail} fallidas   (temporales en ${tmp})`);
process.exit(fail ? 1 : 0);
