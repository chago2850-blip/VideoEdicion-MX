/* MontajeMX — diálogos: exportar, proyecto, captura, película rápida.
 * Copyright (C) 2026 Santiago Miguel — GPL-3.0-or-later. */
'use strict';
const Dialogs = (() => {
  const D = { closable: true };
  let onClose = null;
  function open(title, body, foot, closable) { D.closable = closable !== false; $('#modal-box').replaceChildren(h('h2', {}, title), body, h('div', { class: 'foot' }, foot)); $('#modal').hidden = false; }
  function close() { D.keyHook = null; $('#modal-box').classList.remove('wide'); $('#modal').hidden = true; $('#modal-box').replaceChildren(); if (onClose) { const f = onClose; onClose = null; f(); } }
  const row = (label, ctl) => h('div', { class: 'row' }, h('label', {}, label), ctl);
  const btnClose = (t) => h('button', { onclick: close }, t || 'Cerrar');
  function error(title, msg) { open(title, h('pre', { class: 'err' }, msg), btnClose()); }
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);

  function settings() {
    const p = S.p, FORMATS = { '1920x1080': 'Full HD 16:9 (1920×1080)', '3840x2160': '4K UHD 16:9 (3840×2160)', '7680x4320': '8K UHD 16:9 (7680×4320)', '1280x720': 'HD 16:9 (1280×720)', '1080x1920': 'Vertical 9:16 (1080×1920)', '1080x1080': 'Cuadrado 1:1 (1080×1080)', '1440x1080': 'Clásico 4:3 (1440×1080)', '2560x1080': 'Cine 21:9 (2560×1080)', custom: 'Personalizado' };
    const cur = `${p.width}x${p.height}`, name = h('input', { type: 'text', value: p.name }), w = h('input', { type: 'number', value: p.width, min: 16, max: 8192 }), hh = h('input', { type: 'number', value: p.height, min: 16, max: 8192 });
    const fmt = h('select', { onchange: () => { if (fmt.value !== 'custom') { const a = fmt.value.split('x'); w.value = a[0]; hh.value = a[1]; } } }, Object.keys(FORMATS).map((k) => h('option', { value: k, selected: k === (FORMATS[cur] ? cur : 'custom') }, FORMATS[k])));
    const fps = h('select', {}, [23.976, 24, 25, 29.97, 30, 50, 59.94, 60].map((f) => h('option', { value: f, selected: f === p.fps }, f + ' fps')));
    const notes = h('textarea', { rows: 4, placeholder: 'Notas del proyecto' }, p.notes || '');
    open('Ajustes del proyecto', h('div', {}, row('Nombre', name), row('Formato', fmt), row('Ancho × alto', h('div', { class: 'grp' }, w, '×', hh)), row('Fotogramas', fps), row('Notas', notes)),
      [btnClose('Cancelar'), h('button', { class: 'primary', onclick: () => { mutate(null, () => { p.name = name.value || 'Sin título'; p.width = even(MMX.clamp(+w.value || 1920, 16, 8192)); p.height = even(MMX.clamp(+hh.value || 1080, 16, 8192)); p.fps = +fps.value; p.notes = notes.value; }); Preview.resize(); close(); } }, 'Aplicar')]);
  }

  function track(tr) {
    const mk = (label, prop, max) => { const n = h('span', {}, Math.round(tr[prop] * 100) + ' %'); return row(label, h('div', { class: 'grp' }, h('input', { type: 'range', min: 0, max, step: 0.01, value: tr[prop], style: { flex: 1 }, oninput: (e) => { mutate('trk' + prop + tr.id, () => { tr[prop] = +e.target.value; }, { light: true }); n.textContent = Math.round(tr[prop] * 100) + ' %'; } }), n)); };
    open('Pista: ' + tr.name, h('div', {}, mk('Transparencia', 'opacity', 1), mk('Volumen', 'volume', 2), row('Salida en 5.1', h('select', { onchange: (e) => mutate(null, () => { tr.surround = e.target.value; }) }, Object.keys(MMX.SURROUND).map((k) => h('option', { value: k, selected: k === (tr.surround || 'front') }, MMX.SURROUND[k])))), h('p', { class: 'note' }, 'La salida 5.1 se usa al exportar con «Audio 5.1»; la vista previa suena en estéreo.')), btnClose('Listo'));
  }

  function exportDlg() {
    if (duration() <= 0) return toast('La línea de tiempo está vacía');
    Preview.pause();
    const p = S.p, pr = S.info.presets, ar = p.width / p.height;
    const preset = h('select', { onchange: upd }, Object.keys(pr).map((k) => h('option', { value: k }, pr[k].name)));
    const sizes = [[p.width, p.height, 'Igual que el proyecto']].concat([[4320, '8K'], [2160, '4K'], [1440, '2K'], [1080, 'Full HD'], [720, 'HD'], [480, 'SD'], [360, 'Baja']].map(([hh, n]) => (ar >= 1 ? [even(hh * ar), hh, n] : [hh, even(hh / ar), n])));
    const size = h('select', {}, sizes.map((s, i) => h('option', { value: i }, `${s[2]} · ${s[0]}×${s[1]}`)));
    const fps = h('select', {}, [['', 'Igual que el proyecto (' + p.fps + ')'], [24, '24'], [25, '25'], [30, '30'], [50, '50'], [60, '60']].map((f) => h('option', { value: f[0] }, f[1])));
    const q = h('input', { type: 'range', min: 1, max: 10, value: 7 }), ql = h('span', {}, 'Alta');
    const chans = h('select', {}, h('option', { value: '' }, 'Estéreo'), h('option', { value: '1' }, '5.1 envolvente (según la salida de cada pista)'));
    q.oninput = () => { ql.textContent = q.value >= 9 ? 'Máxima' : q.value >= 6 ? 'Alta' : q.value >= 4 ? 'Media' : 'Ligera'; };
    const note = h('p', { class: 'note' }), bar = h('div', { class: 'bar', hidden: true }, h('i')), status = h('p', { class: 'note' });
    const go = h('button', { class: 'primary', onclick: start }, 'Exportar'), cancel = h('button', { onclick: () => (busy ? api.invoke('export:cancel') : close()) }, 'Cancelar');
    let busy = false;
    function upd() { const s = pr[preset.value]; size.disabled = fps.disabled = !!s.audioOnly || !!s.fixed; q.disabled = !s.crf; chans.disabled = !!s.no51 || s.ext === 'gif' || s.ext === 'png' || s.ext === 'jpg'; if (chans.disabled) chans.value = ''; note.textContent = s.audioOnly ? 'Solo se exporta la mezcla de audio.' : s.fixed ? `Formato fijo ${s.fixed[0]}×${s.fixed[1]}; el archivo .mpg queda listo para un programa de grabación de DVD.` : `Duración: ${timecode(duration())}`; }
    async function start() {
      const s = pr[preset.value], out = await api.invoke('export:pick', p.name || 'Mi película', s.ext); if (!out) return;
      const sz = sizes[+size.value];
      busy = true; D.closable = false; go.disabled = true; bar.hidden = false; status.textContent = 'Preparando títulos…';
      const pack = await Preview.collectAssets(undefined, (f) => { status.textContent = `Generando títulos 3D… ${(f * 100).toFixed(0)} %`; });
      status.textContent = 'Preparando…';
      const r = await api.invoke('export:start', p, { out, preset: preset.value, width: sz[0], height: sz[1], fps: fps.value ? +fps.value : undefined, crf: Math.round(40 - q.value * 2.8), surround: !!chans.value }, pack);
      busy = false; D.closable = true; go.disabled = false;
      if (r.error) { status.replaceChildren(h('pre', { class: 'err' }, r.error)); bar.hidden = true; return; }
      bar.firstChild.style.width = '100%'; status.replaceChildren('Listo: ' + r.out + '  ', h('button', { onclick: () => api.invoke('shell:show', r.out.replace('_%05d', '_00001')) }, 'Mostrar en la carpeta')); cancel.textContent = 'Cerrar';
    }
    api.on('export:progress', (f) => { if (busy) { bar.firstChild.style.width = (f * 100).toFixed(1) + '%'; status.textContent = `Exportando… ${(f * 100).toFixed(0)} %`; } });
    open('Exportar', h('div', {}, row('Formato', preset), row('Resolución', size), row('Fotogramas', fps), row('Calidad', h('div', { class: 'grp' }, q, ql)), row('Audio', chans), note, bar, status), [cancel, go]);
    upd();
  }

  /* ---------- captura: pantalla, cámara, voz en off, stop motion ---------- */
  function capture() {
    Preview.pause();
    let mode = 'pantalla', stream = null, rec = null, chunks = [], startT = 0, extra = [], lastShot = null;
    const video = h('video', { autoplay: true, muted: true, playsinline: true }), onion = h('img', { style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: 0.35, pointerEvents: 'none' }, hidden: true });
    const stage = h('div', { style: { position: 'relative' } }, video, onion), status = h('p', { class: 'note' }), mic = h('input', { type: 'checkbox', checked: true }), frames = h('input', { type: 'number', value: 4, min: 1, max: 60, style: { width: '70px' } });
    const modes = { pantalla: 'Pantalla', camara: 'Cámara', voz: 'Voz en off', stop: 'Stop motion' };
    const tabs = h('div', { class: 'btns' }), opts = h('div', {}), act = h('button', { class: 'primary', onclick: main }, '');
    const stopStream = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); extra.forEach((s) => s.getTracks().forEach((t) => t.stop())); stream = null; extra = []; video.srcObject = null; };
    function setMode(m) {
      if (rec) return; mode = m; stopStream(); onion.hidden = true;
      tabs.replaceChildren(...Object.keys(modes).map((k) => h('button', { class: k === mode ? 'on' : '', onclick: () => setMode(k) }, modes[k])));
      stage.hidden = mode === 'voz';
      opts.replaceChildren(mode === 'pantalla' ? h('label', { class: 'chk', style: { margin: 0 } }, mic, 'Grabar también el micrófono') : mode === 'stop' ? h('label', { class: 'chk', style: { margin: 0 } }, 'Fotogramas por foto ', frames) : '');
      status.textContent = { pantalla: 'Graba la pantalla completa. Al detener, el video se añade a la biblioteca y a la línea de tiempo.', camara: 'Graba la cámara web con su micrófono.', voz: 'La línea de tiempo se reproduce mientras grabas; la voz se coloca en una pista «Voz» desde la posición del cursor.', stop: 'Cada foto se añade a la línea de tiempo. La foto anterior se muestra semitransparente como guía.' }[mode];
      act.textContent = mode === 'stop' ? 'Capturar foto' : 'Iniciar grabación';
      if (mode === 'camara' || mode === 'stop') navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: mode === 'camara' }).then((s) => { stream = s; video.srcObject = s; }).catch((e) => { status.textContent = 'No se pudo abrir la cámara: ' + e.message; });
    }
    async function main() {
      if (mode === 'stop') return shot();
      if (rec) { rec.stop(); return; }
      try {
        if (mode === 'pantalla') {
          stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
          if (mic.checked) { try { const ms = await navigator.mediaDevices.getUserMedia({ audio: true }); extra.push(ms); const ac = new AudioContext(), dst = ac.createMediaStreamDestination(); if (stream.getAudioTracks().length) ac.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(dst); ac.createMediaStreamSource(ms).connect(dst); stream = new MediaStream([...stream.getVideoTracks(), ...dst.stream.getAudioTracks()]); } catch (e) { /* sin micrófono */ } }
          video.srcObject = stream;
        } else if (mode === 'voz') { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
        if (!stream) return;
      } catch (e) { status.textContent = 'No se pudo iniciar la captura: ' + e.message; return; }
      chunks = []; rec = new MediaRecorder(stream); startT = S.t;
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = finish; rec.start(500);
      if (mode === 'voz' && duration() > 0) Preview.play();
      act.textContent = 'Detener'; status.textContent = '● Grabando…';
    }
    async function finish() {
      const kind = mode; rec = null; Preview.pause(); status.textContent = 'Guardando…'; act.disabled = true;
      const bytes = await new Blob(chunks).arrayBuffer(); if (kind !== 'camara') stopStream();
      const m = await api.invoke('record:save', bytes, kind); act.disabled = false;
      if (m.error) { status.textContent = m.error; act.textContent = 'Iniciar grabación'; return; }
      S.p.media[m.id] = m; renderLibrary();
      if (kind === 'voz') { let tr = S.p.tracks.find((t) => t.role === 'voz' && !t.locked); mutate(null, () => { if (!tr) { tr = addTrack(); tr.name = 'Voz'; tr.role = 'voz'; } }); insertClip(clipFromMedia(m), tr, startT); close(); toast('Voz en off añadida'); }
      else { insertClip(clipFromMedia(m)); close(); toast('Grabación añadida a la línea de tiempo'); }
    }
    async function shot() {
      if (!stream) return; const cn = document.createElement('canvas'); cn.width = video.videoWidth; cn.height = video.videoHeight; cn.getContext('2d').drawImage(video, 0, 0);
      const blob = await new Promise((r) => cn.toBlob(r, 'image/png')), m = await api.invoke('record:save', await blob.arrayBuffer(), 'foto'); if (m.error) return;
      S.p.media[m.id] = m; const c = clipFromMedia(m); c.dur = Math.max(1, +frames.value || 4) / S.p.fps;
      let tr = S.p.tracks.find((t) => t.name === 'Stop motion'); mutate(null, () => { if (!tr) { tr = addTrack(true); tr.name = 'Stop motion'; } }); insertClip(c, tr, lastShot == null ? S.t : lastShot); lastShot = c.start + c.dur;
      onion.src = cn.toDataURL('image/jpeg', 0.7); onion.hidden = false; status.textContent = `Foto ${tr.clips.length} capturada.`; renderLibrary();
    }
    onClose = () => { if (rec) { rec.onstop = null; rec.stop(); rec = null; } stopStream(); };
    open('Capturar', h('div', {}, tabs, stage, opts, status), [btnClose(), act]); setMode('pantalla');
  }

  /* ---------- película rápida: montaje automático ---------- */
  function quick() {
    const vis = Object.values(S.p.media).filter((m) => m.type !== 'audio' && !m.missing), music = Object.values(S.p.media).find((m) => m.type === 'audio' && !m.missing);
    if (!vis.length) return toast('Importa primero algunos videos o fotos');
    const title = h('input', { type: 'text', value: S.p.name === 'Sin título' ? 'Mi película' : S.p.name }), photo = h('input', { type: 'number', value: 4, min: 1, max: 30, step: 0.5 }), maxv = h('input', { type: 'number', value: 8, min: 2, max: 600 });
    const tr = h('select', {}, Object.keys(MMX.TRANSITIONS).map((k) => h('option', { value: k, selected: k === 'fade' }, MMX.TRANSITIONS[k]))), kb = h('input', { type: 'checkbox', checked: true }), mus = h('input', { type: 'checkbox', checked: !!music, disabled: !music });
    open('Película rápida', h('div', {}, h('p', { class: 'hint' }, `Se montarán ${vis.length} medios en orden, con transiciones, título y música. Reemplaza el contenido actual de la línea de tiempo (se puede deshacer).`),
      row('Título inicial', title), row('Segundos por foto', photo), row('Máx. por video (s)', maxv), row('Transición', tr), row('Fotos', h('label', { class: 'chk', style: { margin: 0 } }, kb, 'Zoom lento en las fotos')), row('Música', h('label', { class: 'chk', style: { margin: 0 } }, mus, music ? music.name : 'No hay audio en la biblioteca'))),
      [btnClose('Cancelar'), h('button', { class: 'primary', onclick: () => {
        mutate(null, () => {
          const p = S.p; p.tracks.forEach((t) => { t.clips = []; }); while (p.tracks.length < 4) addTrack();
          const main = p.tracks[1], D = 1; let t = 0;
          vis.forEach((m, i) => { const c = clipFromMedia(m); c.dur = m.type === 'image' ? +photo.value || 4 : Math.min(m.duration, +maxv.value || 8); c.start = t; c.fit = 'cover';
            if (m.type === 'image' && kb.checked) c.kf.scale = i % 2 ? [{ t: 0, v: 1.18 }, { t: c.dur + D, v: 1 }] : [{ t: 0, v: 1 }, { t: c.dur + D, v: 1.18 }];
            if (i > 0 && tr.value !== 'none') c.transIn = { type: tr.value, dur: Math.min(D, c.dur / 2) };
            main.clips.push(c); t += c.dur; });
          main.clips[0].transIn = { type: 'black', dur: 1 }; main.clips[main.clips.length - 1].transOut = { type: 'black', dur: 1 };
          if (title.value.trim()) { const tc = titleClip(0); tc.title.text = title.value.trim(); tc.start = 0.5; tc.dur = Math.min(4, t - 0.5); p.tracks[0].clips.push(tc); p.name = title.value.trim(); }
          if (mus.checked && music) { const a = p.tracks[p.tracks.length - 1]; let at = 0; while (at < t - 0.05) { const c = clipFromMedia(music); c.start = at; c.dur = Math.min(music.duration, t - at); c.volume = 0.6; if (at === 0) c.fadeIn = 1; if (at + c.dur >= t - 0.05) c.fadeOut = Math.min(2.5, c.dur / 2); a.clips.push(c); at += c.dur; } }
          S.sel = null; S.t = 0;
        }); close(); Actions.fit(); toast('Película armada: revísala y ajusta lo que quieras');
      } }, 'Crear')]);
  }

  function about() {
    open('MontajeMX ' + S.info.version, h('div', { style: { lineHeight: 1.6 } }, h('img', { src: 'logo.svg', width: 96, height: 96, alt: '', style: { display: 'block', margin: '0 auto 8px' } }),
      h('p', {}, 'Editor de video multipista libre para Windows, Linux y macOS. Sin límites de uso, sin marcas de agua y sin funciones de pago.'),
      h('p', {}, 'Copyright © 2026 Santiago Miguel. Software libre bajo la Licencia Pública General de GNU, versión 3 o posterior (GPL-3.0-or-later). Se distribuye SIN NINGUNA GARANTÍA.'),
      h('p', { class: 'note', style: { userSelect: 'text' } }, 'Motor: ' + S.info.ffmpeg), h('p', { class: 'note' }, 'Proyecto independiente; no está afiliado a ningún editor comercial.')), btnClose());
  }
  $('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal' && D.closable) close(); });
  return Object.assign(D, { open, close, error, settings, track, exportDlg, capture, quick, about });
})();
