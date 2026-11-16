/* MontajeMX — traduce un proyecto a un grafo de filtros de FFmpeg.
 * Copyright (C) 2026 Santiago Miguel — GPL-3.0-or-later. */
'use strict';
const M = require('./model');
const n = M.n;

const PRESETS = {
  'mp4-h264': { name: 'MP4 · H.264 (recomendado)', ext: 'mp4', v: ['-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p'], crf: true, a: ['-c:a', 'aac', '-b:a', '192k'], extra: ['-movflags', '+faststart'] },
  'mp4-hevc': { name: 'MP4 · HEVC (H.265)', ext: 'mp4', v: ['-c:v', 'libx265', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1'], crf: true, a: ['-c:a', 'aac', '-b:a', '192k'], extra: ['-movflags', '+faststart'] },
  'webm-vp9': { name: 'WebM · VP9', ext: 'webm', v: ['-c:v', 'libvpx-vp9', '-b:v', '0', '-row-mt', '1', '-pix_fmt', 'yuv420p'], crf: true, a: ['-c:a', 'libopus', '-b:a', '160k'] },
  'mkv-av1': { name: 'MKV · AV1', ext: 'mkv', v: ['-c:v', 'libaom-av1', '-cpu-used', '6', '-b:v', '0', '-pix_fmt', 'yuv420p'], crf: true, a: ['-c:a', 'libopus', '-b:a', '160k'] },
  'mov-prores': { name: 'MOV · ProRes 422 HQ', ext: 'mov', v: ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le'], a: ['-c:a', 'pcm_s16le'] },
  'mov-alpha': { name: 'MOV · ProRes 4444 con canal alfa', ext: 'mov', alpha: true, v: ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le'], a: ['-c:a', 'pcm_s16le'] },
  'avi': { name: 'AVI · MPEG-4', ext: 'avi', no51: true, v: ['-c:v', 'mpeg4', '-q:v', '3', '-pix_fmt', 'yuv420p'], a: ['-c:a', 'libmp3lame', '-b:a', '192k'] },
  'wmv': { name: 'WMV', ext: 'wmv', no51: true, v: ['-c:v', 'wmv2', '-q:v', '3', '-pix_fmt', 'yuv420p'], a: ['-c:a', 'wmav2', '-b:a', '192k'] },
  'm2ts': { name: 'M2TS · H.264 + AC3', ext: 'm2ts', v: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'], crf: true, a: ['-c:a', 'ac3', '-b:a', '224k'] },
  'dvd-ntsc': { name: 'DVD MPEG-2 (NTSC)', ext: 'mpg', v: ['-target', 'ntsc-dvd'], fixed: [720, 480, 29.97], a: [] },
  'dvd-pal': { name: 'DVD MPEG-2 (PAL)', ext: 'mpg', v: ['-target', 'pal-dvd'], fixed: [720, 576, 25], a: [] },
  'gif': { name: 'GIF animado', ext: 'gif', gif: true, v: [], a: null },
  'png-seq': { name: 'Secuencia PNG (con alfa)', ext: 'png', seq: true, alpha: true, v: ['-pix_fmt', 'rgba'], a: null },
  'jpg-seq': { name: 'Secuencia JPEG', ext: 'jpg', seq: true, v: ['-q:v', '2'], a: null },
  'mp3': { name: 'Audio MP3', ext: 'mp3', no51: true, audioOnly: true, a: ['-c:a', 'libmp3lame', '-b:a', '256k'] },
  'm4a': { name: 'Audio AAC (M4A)', ext: 'm4a', audioOnly: true, a: ['-c:a', 'aac', '-b:a', '256k'] },
  'wav': { name: 'Audio WAV', ext: 'wav', audioOnly: true, a: ['-c:a', 'pcm_s16le'] },
  'flac': { name: 'Audio FLAC', ext: 'flac', audioOnly: true, a: ['-c:a', 'flac'] },
  'ac3': { name: 'Audio AC3', ext: 'ac3', audioOnly: true, a: ['-c:a', 'ac3', '-b:a', '320k'] },
};
const FF_BLEND = { multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', difference: 'difference', lighter: 'addition' };
const hex = (h) => '0x' + (h || '#000000').replace('#', '');
const even = (v) => Math.max(2, Math.round(v / 2) * 2);

function atempoChain(s) {
  const out = [];
  while (s > 2.0001) { out.push('atempo=2.0'); s /= 2; }
  while (s < 0.4999) { out.push('atempo=0.5'); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-4) out.push('atempo=' + n(s));
  return out;
}
/* Factores de transición como expresiones en el tiempo global t. */
function transExprs(c, start) {
  let x = '', y = '', sc = '';
  const add = (type, f, sign) => {
    const inv = `(1-${f})`, s = sign > 0 ? '+' : '-', o = sign > 0 ? '-' : '+';
    if (type === 'slideL') x += s + inv; else if (type === 'slideR') x += o + inv;
    else if (type === 'slideU') y += s + inv; else if (type === 'slideD') y += o + inv;
    else if (type === 'zoom') sc += `*(0.2+0.8*${f})`;
    else if (type === 'morph') sc += `*(1.15-0.15*${f})`;
  };
  if (c.transIn.type !== 'none') add(c.transIn.type, `clip((t-${n(start)})/${n(Math.max(0.01, c.transIn.dur))},0,1)`, 1);
  if (c.transOut.type !== 'none') add(c.transOut.type, `clip((${n(start + c.dur)}-t)/${n(Math.max(0.01, c.transOut.dur))},0,1)`, -1);
  return { x, y, sc };
}
/* Desplazamiento del rectángulo de barrido, en tiempo local del clip. */
function wipeExprs(c) {
  let x = '0', y = '0';
  const add = (type, f, sign) => { const w = M.WIPES[type]; if (!w) return; if (w[0]) x += `${sign * w[0] > 0 ? '+' : '-'}(1-${f})`; if (w[1]) y += `${sign * w[1] > 0 ? '+' : '-'}(1-${f})`; };
  add(c.transIn.type, `clip(t/${n(Math.max(0.01, c.transIn.dur))},0,1)`, 1);
  add(c.transOut.type, `clip((${n(c.dur)}-t)/${n(Math.max(0.01, c.transOut.dur))},0,1)`, -1);
  return x === '0' && y === '0' ? null : { x, y };
}
function maskExpr(m) {
  const dx = `abs(X/W-${n(m.x)})/${n(m.w / 2)}`, dy = `abs(Y/H-${n(m.y)})/${n(m.h / 2)}`;
  const d = m.shape === 'rect' ? `max(${dx},${dy})` : `hypot(${dx},${dy})`;
  let a = m.feather > 0.001 ? `clip((1-${d})/${n(m.feather)},0,1)` : `lte(${d},1)`;
  if (m.invert) a = `(1-${a})`;
  return `255*${a}`;
}

/**
 * @param project  proyecto MontajeMX
 * @param opts { out, preset, width, height, fps, crf, assets:{[clipId]:{image}}, frameAt, from, to }
 * @returns { args, prejobs, files, total } — ejecutar con cwd = carpeta temporal (LUT y máscaras usan rutas relativas)
 */
function build(project, opts) {
  const p = project, W = even(p.width), H = even(p.height);
  const single = typeof opts.frameAt === 'number';
  const preset = single ? { v: [], a: null, alpha: false } : PRESETS[opts.preset || 'mp4-h264'];
  if (!preset) throw new Error('Formato de exportación desconocido: ' + opts.preset);
  let OW = even(opts.width || W), OH = even(opts.height || H), FPS = opts.fps || p.fps;
  if (preset.fixed) { OW = preset.fixed[0]; OH = preset.fixed[1]; FPS = preset.fixed[2]; }
  if (preset.gif) FPS = Math.min(FPS, 15);
  const total = single ? opts.frameAt + 1 / p.fps : M.projectDuration(p);
  if (total <= 0) throw new Error('La línea de tiempo está vacía.');
  const assets = opts.assets || {};
  const inputs = [], graph = [], files = [], prejobs = [];
  let ni = 0;
  const addInput = (a) => { inputs.push(...a); return ni++; };
  const wantVideo = !preset.audioOnly, wantAudio = !single && preset.a !== null;
  const active = (c, ext) => !single || (opts.frameAt >= c.start - 1e-6 && opts.frameAt < c.start + c.dur + ext);

  /* ----- vídeo ----- */
  let base = 'b0', bi = 0;
  if (wantVideo) {
    graph.push(`color=c=${preset.alpha ? 'black@0.0' : 'black'}:s=${W}x${H}:r=${n(p.fps)}:d=${n(total)}${preset.alpha ? ',format=rgba' : ''}[b0]`);
    const ofmt = preset.alpha ? ':format=auto' : '';
    for (let ti = p.tracks.length - 1; ti >= 0; ti--) {
      const tr = p.tracks[ti];
      if (tr.hidden) continue;
      for (const c of [...tr.clips].sort((a, b) => a.start - b.start)) {
        if (!M.isVisual(c)) continue;
        const ext = M.tailExt(tr, c), D = c.dur + ext;
        if (!active(c, ext)) continue;
        const m = p.media[c.mediaId];
        let idx;
        if (c.kind === 'video') { if (!m) continue; idx = addInput(['-ss', n(c.in), '-t', n(D * c.speed + 0.2), '-i', m.path]); }
        else if (c.kind === 'image') { if (!m) continue; idx = addInput(['-loop', '1', '-framerate', n(p.fps), '-t', n(D), '-i', m.path]); }
        else if (c.kind === 'title' || c.kind === 'title3d') {
          const a = assets[c.id]; if (!a) continue;
          if (a.seq) idx = addInput(['-framerate', n(p.fps), '-i', a.seq]);
          else if (a.image) idx = addInput(['-loop', '1', '-framerate', n(p.fps), '-t', n(D), '-i', a.image]);
          else continue;
        }
        else idx = addInput(['-f', 'lavfi', '-t', n(D), '-i', `color=c=${hex(c.fill)}:s=${W}x${H}:r=${n(p.fps)}`]);

        const box = M.fitBox(p, c), f = [], id = c.id.replace(/[^A-Za-z0-9]/g, '');
        f.push(`setpts=(PTS-STARTPTS)/${n(c.kind === 'video' ? c.speed : 1)}`, `fps=${n(p.fps)}`);
        if (c.kind === 'video' && c.reverse) f.push('reverse');
        f.push(`tpad=stop_mode=clone:stop_duration=${n(D)}`, `trim=duration=${n(D)}`, 'setpts=PTS-STARTPTS');
        const fx = c.fx;
        if (fx.v360 === 'flat') f.push(`v360=e:flat:yaw=${n(fx.yaw)}:pitch=${n(fx.pitch)}:h_fov=100:v_fov=65`);
        if (fx.v360 === 'planet') f.push(`v360=e:sg:yaw=${n(fx.yaw)}:pitch=${n(-90 + fx.pitch)}:h_fov=250:v_fov=250`);
        if (fx.stabilize) f.push('deshake=rx=32:ry=32');
        if (fx.denoise > 0) f.push(`hqdn3d=${n(fx.denoise)}`);
        if (fx.lens) f.push(`lenscorrection=k1=${n(fx.lens)}:k2=${n(fx.lens / 2)}`);
        const cr = c.crop;
        if (cr.l || cr.r || cr.t || cr.b) f.push(`crop=iw*${n(1 - cr.l - cr.r)}:ih*${n(1 - cr.t - cr.b)}:iw*${n(cr.l)}:ih*${n(cr.t)}`);
        f.push(`scale=${box.scw}:${box.sch}:flags=bicubic`);
        if (box.cover) f.push(`crop=${box.bw}:${box.bh}`);
        f.push('setsar=1');
        if (c.flipH) f.push('hflip');
        if (c.flipV) f.push('vflip');
        const ref = H / 1080;
        if (!M.colorIsDefault(c.color)) {
          const name = `lut_${id}.cube`;
          files.push({ name, text: M.lutToCube(M.buildLut(c.color, 33)) });
          f.push(`lut3d=file=${name}`);
        }
        if (fx.sharpen > 0) f.push(`unsharp=5:5:${n(fx.sharpen)}`);
        if (fx.blur > 0) f.push(`gblur=sigma=${n(fx.blur * ref)}`);
        if (fx.mosaic > 0) { const b = Math.max(2, fx.mosaic * ref); f.push(`scale=${Math.max(1, Math.ceil(box.bw / b))}:${Math.max(1, Math.ceil(box.bh / b))}:flags=neighbor`, `scale=${box.bw}:${box.bh}:flags=neighbor`); }
        if (fx.grain > 0) f.push(`noise=alls=${n(fx.grain)}:allf=t`);
        if (fx.vignette > 0) f.push(`vignette=angle=${n(fx.vignette * Math.PI / 2.2)}`);
        if (c.chroma.enabled) f.push(`chromakey=${hex(c.chroma.color)}:${n(Math.max(0.01, c.chroma.similarity))}:${n(c.chroma.blend)}`);
        f.push('format=rgba');
        let cur = `[${idx}:v]`;
        const wipe = wipeExprs(c);
        if (c.mask || wipe) {
          /* Canal alfa adicional = máscara (fija o animada por el seguimiento) × barrido de transición. */
          const g = [`${cur}${f.join(',')}[k${id}]`], bw = box.bw, bh = box.bh, src = (col, lab) => `color=c=${col}:s=${bw}x${bh}:r=${n(p.fps)}:d=${n(D)},format=gray[${lab}]`;
          let am = null;
          if (c.mask) {
            const mk = c.mask, name = `mask_${id}.png`, anim = M.maskAnimated(c);
            const sw = even(Math.min(4 * bw, Math.max(2, mk.w * bw))), sh = even(Math.min(4 * bh, Math.max(2, mk.h * bh)));
            prejobs.push(['-y', '-f', 'lavfi', '-i', `color=c=black:s=${sw}x${sh},format=gray,geq=lum='${maskExpr({ shape: mk.shape, feather: mk.feather, x: 0.5, y: 0.5, w: 1, h: 1, invert: false })}'`, '-frames:v', '1', name]);
            const mi = addInput(['-loop', '1', '-framerate', n(p.fps), '-t', n(D), '-i', name]);
            const ex = (k) => M.kfExpr(c, M.MASK_KEYS[k], 0, mk[k]);
            g.push(src('black', `mb${id}`));
            g.push(anim ? `[${mi}:v]format=gray,scale=w='max(2,(${ex('w')})*${bw})':h='max(2,(${ex('h')})*${bh})':eval=frame:flags=bilinear[ms${id}]` : `[${mi}:v]format=gray[ms${id}]`);
            g.push(`[mb${id}][ms${id}]overlay=x='(${ex('x')})*${bw}-w/2':y='(${ex('y')})*${bh}-h/2':eval=frame:eof_action=pass,format=gray${mk.invert ? ',negate' : ''}[mm${id}]`);
            am = `mm${id}`;
          }
          if (wipe) {
            g.push(src('black', `wb${id}`), src('white', `ww${id}`), `[wb${id}][ww${id}]overlay=x='${bw}*(${wipe.x})':y='${bh}*(${wipe.y})':eval=frame,format=gray[wp${id}]`);
            if (am) { g.push(`[${am}][wp${id}]blend=all_mode=multiply[mw${id}]`); am = `mw${id}`; } else am = `wp${id}`;
          }
          const hasAlpha = c.chroma.enabled || c.kind === 'title' || c.kind === 'title3d' || c.kind === 'image';
          if (hasAlpha) g.push(`[k${id}]split[k1${id}][k2${id}]`, `[k2${id}]alphaextract[ka${id}]`, `[ka${id}][${am}]blend=all_mode=multiply[fa${id}]`, `[k1${id}][fa${id}]alphamerge[a${id}]`);
          else g.push(`[k${id}][${am}]alphamerge[a${id}]`);
          graph.push(...g);
          cur = `[a${id}]`; f.length = 0;
        }
        const S = c.start, E = c.start + D;
        f.push(`setpts=PTS+${n(S)}/TB`);
        if (c.transIn.type === 'black') f.push(`fade=t=in:st=${n(S)}:d=${n(c.transIn.dur)}`);
        if (c.transOut.type === 'black') f.push(`fade=t=out:st=${n(S + c.dur - c.transOut.dur)}:d=${n(c.transOut.dur)}`);
        if (M.kfOf(c, 'opacity')) f.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip((${M.kfExpr(c, 'opacity', S).replace(/\bt\b/g, 'T')})*${n(tr.opacity)},0,1)'`);
        else if (c.opacity * tr.opacity < 0.999) f.push(`colorchannelmixer=aa=${n(M.clamp(c.opacity * tr.opacity, 0, 1))}`);
        if (['fade', 'zoom', 'morph'].includes(c.transIn.type)) f.push(`fade=t=in:st=${n(S)}:d=${n(c.transIn.dur)}:alpha=1`);
        if (['fade', 'zoom', 'morph'].includes(c.transOut.type)) f.push(`fade=t=out:st=${n(S + c.dur - c.transOut.dur)}:d=${n(c.transOut.dur)}:alpha=1`);
        if (M.kfOf(c, 'rotation') || c.rotation) { const dg = even(Math.ceil(Math.hypot(box.bw, box.bh))); f.push(`rotate=a='(${M.kfExpr(c, 'rotation', S)})*PI/180':ow=${dg}:oh=${dg}:c=none`); }
        const te = transExprs(c, S), nx = M.nextTrans(tr, c);
        if (nx && nx.transIn.type === 'morph') te.sc += `*(1+0.15*clip((t-${n(S + c.dur)})/${n(Math.max(0.01, nx.transIn.dur))},0,1))`;
        if (M.kfOf(c, 'scale') || te.sc) { const se = `(${M.kfExpr(c, 'scale', S)})${te.sc}`; f.push(`scale=w='max(2,iw*${se})':h='max(2,ih*${se})':eval=frame:flags=bilinear`); }
        else if (Math.abs(c.scale - 1) > 1e-4) f.push(`scale=w='max(2,iw*${n(c.scale)})':h='max(2,ih*${n(c.scale)})'`);
        graph.push(`${cur}${f.join(',')}[v${id}]`);
        const ox = `${n(box.cx)}+(${M.kfExpr(c, 'x', S)}${te.x})*${W}-w/2`, oy = `${n(box.cy)}+(${M.kfExpr(c, 'y', S)}${te.y})*${H}-h/2`;
        const ov = `overlay=x='${ox}':y='${oy}':eval=frame:eof_action=pass:enable='between(t,${n(S)},${n(E)})'`;
        const next = 'b' + ++bi;
        if (c.blend !== 'normal' && FF_BLEND[c.blend]) {
          graph.push(`color=c=black@0.0:s=${W}x${H}:r=${n(p.fps)}:d=${n(total)},format=rgba[z${id}]`,
            `[z${id}][v${id}]${ov}:format=auto,split[l1${id}][l2${id}]`,
            `[${base}]split[p1${id}][p2${id}]`,
            `[p1${id}]format=gbrp[q1${id}];[l1${id}]format=gbrp[q2${id}];[q1${id}][q2${id}]blend=all_mode=${FF_BLEND[c.blend]}:eof_action=pass[bl${id}]`,
            `[l2${id}]alphaextract[am${id}];[bl${id}][am${id}]alphamerge[bm${id}]`,
            `[p2${id}][bm${id}]overlay=eof_action=pass${ofmt}[${next}]`);
        } else graph.push(`[${base}][v${id}]${ov}${ofmt}[${next}]`);
        base = next;
      }
    }
    let fin = `[${base}]`;
    const tail = [];
    if (OW !== W || OH !== H) tail.push(`scale=${OW}:${OH}:flags=bicubic`);
    if (Math.abs(FPS - p.fps) > 1e-3) tail.push(`fps=${n(FPS)}`);
    if (preset.gif) tail.push('split[g1][g2];[g1]palettegen=stats_mode=diff[gp];[g2][gp]paletteuse=dither=bayer');
    graph.push(fin + (tail.length ? tail.join(',') : 'null') + '[vout]');
  }

  /* ----- audio (estéreo o 5.1) ----- */
  const surround = wantAudio && !!opts.surround && !preset.no51;
  if (wantAudio) {
    const bus = { front: [], center: [], rear: [] };
    const voice = p.duck.enabled ? M.voiceIntervals(p) : [];
    for (const tr of p.tracks) {
      if (tr.muted) continue;
      for (const c of tr.clips) {
        if (!M.hasAudio(p, c) || c.muted) continue;
        const m = p.media[c.mediaId], id = c.id.replace(/[^A-Za-z0-9]/g, '');
        const idx = addInput(['-ss', n(c.in), '-t', n(c.dur * c.speed), '-i', m.path]);
        const f = ['asetpts=PTS-STARTPTS', 'aresample=48000'];
        if (c.reverse) f.push('areverse');
        f.push(...atempoChain(c.speed));
        if (c.pitch) { const r = Math.pow(2, c.pitch / 12); f.push(`asetrate=${Math.round(48000 * r)}`, 'aresample=48000', ...atempoChain(1 / r)); }
        if (c.denoiseAudio) f.push('afftdn=nf=-25');
        if (c.bass) f.push(`bass=g=${n(c.bass)}`);
        if (c.treble) f.push(`treble=g=${n(c.treble)}`);
        let vol = `(${M.kfExpr(c, 'volume', 0)})*${n(tr.volume)}`;
        if (voice.length && tr.role !== 'voz') for (const [a, b] of voice) {
          const r = M.DUCK_RAMP, ra = a - c.start, rb = b - c.start;
          vol += `*(1-${n(1 - p.duck.level)}*clip(min((t-${n(ra - r)})/${n(r)},(${n(rb + r)}-t)/${n(r)}),0,1))`;
        }
        f.push(`volume=volume='${vol}':eval=frame`);
        if (c.fadeIn > 0) f.push(`afade=t=in:st=0:d=${n(c.fadeIn)}`);
        if (c.fadeOut > 0) f.push(`afade=t=out:st=${n(Math.max(0, c.dur - c.fadeOut))}:d=${n(c.fadeOut)}`);
        f.push('aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo');
        if (c.pan) f.push(`pan=stereo|c0=${n(Math.min(1, 1 - c.pan))}*c0|c1=${n(Math.min(1, 1 + c.pan))}*c1`);
        f.push(`atrim=0:${n(c.dur)}`, `adelay=${Math.round(c.start * 1000)}:all=1`);
        const where = surround ? (tr.surround || 'front') : 'front';
        if (where === 'all') { graph.push(`[${idx}:a]${f.join(',')},asplit[s${id}][r${id}]`, `[r${id}]volume=0.7[t${id}]`); bus.front.push(`[s${id}]`); bus.rear.push(`[t${id}]`); }
        else { graph.push(`[${idx}:a]${f.join(',')}[s${id}]`); bus[where].push(`[s${id}]`); }
      }
    }
    const mixBus = (name, list) => { graph.push(`anullsrc=r=48000:cl=stereo,atrim=0:${n(total)}[z${name}]`); graph.push(`[z${name}]${list.join('')}amix=inputs=${list.length + 1}:normalize=0:duration=longest,atrim=0:${n(total)}[bus${name}]`); };
    if (surround) {
      mixBus('f', bus.front); mixBus('c', bus.center); mixBus('r', bus.rear);
      graph.push(`[busf][busc][busr]amerge=inputs=3,pan=5.1|FL=c0|FR=c1|FC=0.5*c2+0.5*c3|LFE=0.3*c0+0.3*c1+0.3*c2+0.3*c3|BL=c4|BR=c5,lowpass=f=120:c=LFE,alimiter=limit=0.97[aout]`);
    } else { mixBus('f', bus.front); graph.push(`[busf]alimiter=limit=0.97[aout]`); }
  }

  const args = ['-y', '-hide_banner', ...inputs, '-filter_complex', graph.join(';')];
  if (wantVideo) args.push('-map', '[vout]');
  if (wantAudio) args.push('-map', '[aout]');
  if (single) args.push('-ss', n(opts.frameAt), '-frames:v', '1', '-update', '1', opts.out);
  else {
    if (wantVideo) { args.push(...preset.v); if (preset.crf) args.push('-crf', String(opts.crf == null ? 20 : opts.crf)); if (!preset.fixed && !preset.gif) args.push('-r', n(FPS)); }
    if (wantAudio) { const a = preset.a.slice(); if (surround) { const i = a.indexOf('-b:a'); if (i >= 0) a[i + 1] = '448k'; if (a.includes('libopus')) a.push('-mapping_family', '1'); } args.push(...a); }
    args.push(...(preset.extra || []), '-t', n(total), '-progress', 'pipe:1', '-nostats', opts.out);
  }
  return { args, prejobs, files, total };
}

module.exports = { build, PRESETS };
