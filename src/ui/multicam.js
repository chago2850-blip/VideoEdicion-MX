/* MontajeMX — editor multicámara: hasta 6 ángulos sincronizados, cambio de cámara en vivo.
 * Copyright (C) 2026 Santiago Miguel — GPL-3.0-or-later. */
'use strict';
const Multicam = (() => {
  const COLORS = ['#5fd4b8', '#ff7a59', '#7aa7ff', '#e8b84a', '#c58af9', '#f472b6'];
  /* Convierte los retrasos de inicio de cada cámara en el punto de entrada común de cada archivo. */
  function offsets(delays) { const g0 = Math.max(...delays); return delays.map((d) => g0 - d); }
  function segments(cuts, total) { return cuts.map((c, i) => ({ cam: c.cam, t: c.t, end: i + 1 < cuts.length ? cuts[i + 1].t : total })).filter((s) => s.end - s.t > 0.03); }
  /* Crea en la línea de tiempo la secuencia de cortes y la pista de audio maestra. */
  function build(cams, offs, cuts, total, audioCam, base) {
    const vt = MMX.newTrack('Multicámara'), at = MMX.newTrack('Audio multicámara');
    for (const s of segments(cuts, total)) vt.clips.push(MMX.newClip('video', { mediaId: cams[s.cam].id, start: base + s.t, dur: s.end - s.t, in: s.t + offs[s.cam], muted: true }));
    if (audioCam >= 0 && cams[audioCam].hasAudio) at.clips.push(MMX.newClip('audio', { mediaId: cams[audioCam].id, start: base, dur: total, in: offs[audioCam] }));
    S.p.tracks.unshift(vt); if (at.clips.length) S.p.tracks.push(at);
    return vt;
  }
  function open() {
    Preview.pause();
    const vids = Object.values(S.p.media).filter((m) => m.type === 'video' && !m.missing);
    if (vids.length < 2) return toast('Importa al menos dos videos para usar la edición multicámara');
    const checks = vids.map((m, i) => h('input', { type: 'checkbox', checked: i < 6, value: m.id }));
    const sync = h('select', {}, h('option', { value: 'audio' }, 'Por audio (automática)'), h('option', { value: 'start' }, 'Alinear inicios de los archivos'));
    const status = h('p', { class: 'note' });
    Dialogs.open('Edición multicámara', h('div', {},
      h('p', { class: 'hint' }, 'Elige de 2 a 6 tomas de la misma escena. La sincronización por audio compara el sonido de cada cámara con la primera.'),
      h('div', { style: { maxHeight: '220px', overflow: 'auto', marginBottom: '10px' } }, vids.map((m, i) => h('label', { class: 'chk', style: { margin: '4px 0' } }, checks[i], `${m.name} · ${fmtDur(m.duration)}`))),
      h('div', { class: 'row' }, h('label', {}, 'Sincronización'), sync), status),
      [h('button', { onclick: Dialogs.close }, 'Cancelar'), h('button', { class: 'primary', onclick: async (e) => {
        const cams = checks.filter((c) => c.checked).map((c) => S.p.media[c.value]).slice(0, 6);
        if (cams.length < 2) { status.textContent = 'Marca al menos dos tomas.'; return; }
        let delays = cams.map(() => 0), note = '';
        if (sync.value === 'audio') {
          e.target.disabled = true; status.textContent = 'Analizando el audio de las cámaras…';
          const r = await api.invoke('multicam:sync', cams.map((m) => m.path));
          delays = r.map((x) => x.seconds); const weak = r.filter((x, i) => i > 0 && x.score < 0.15).length;
          note = weak ? `Atención: ${weak} cámara(s) con coincidencia de audio débil; ajusta su desfase a mano.` : 'Cámaras sincronizadas por audio.';
        }
        editor(cams, delays, note);
      } }, 'Abrir editor')]);
  }
  function editor(cams, delays, note) {
    let offs = offsets(delays), total = Math.min(...cams.map((m, i) => m.duration - offs[i])), T = 0, playing = false, last = 0, raf = 0, audioCam = Math.max(0, cams.findIndex((m) => m.hasAudio));
    const cuts = [{ t: 0, cam: 0 }];
    const camAt = (t) => { let c = cuts[0].cam; for (const q of cuts) if (q.t <= t + 1e-6) c = q.cam; return c; };
    const vs = cams.map((m) => { const v = h('video', { preload: 'auto', playsinline: true }); v.src = mediaUrl(m.proxy || m.path); v.muted = true; return v; });
    const tiles = cams.map((m, i) => h('div', { class: 'mc-tile', onclick: () => switchTo(i) }, vs[i], h('span', { class: 'mc-n', style: { background: COLORS[i] } }, String(i + 1)), h('span', { class: 'mc-name' }, m.name)));
    const bar = h('div', { class: 'mc-bar', onpointerdown: (e) => { const r = bar.getBoundingClientRect(); seekTo((e.clientX - r.left) / r.width * total); } }), head = h('i', { class: 'mc-head' });
    const tcEl = h('span', { id: 'mc-tc', style: { font: '600 14px ui-monospace, monospace', color: 'var(--acc)' } }), playBtn = h('button', { class: 'primary', onclick: toggle }, 'Reproducir');
    const aSel = h('select', { onchange: () => { audioCam = +aSel.value; apply(true); } }, cams.map((m, i) => h('option', { value: i, selected: i === audioCam, disabled: !m.hasAudio }, `Audio de cámara ${i + 1}`)), h('option', { value: -1 }, 'Sin audio'));
    const offIn = cams.map((m, i) => h('input', { type: 'number', step: 0.01, value: +delays[i].toFixed(2), style: { width: '74px' }, title: 'Segundos que esta cámara empezó a grabar después de la cámara 1', onchange: () => { delays = offIn.map((x) => +x.value || 0); offs = offsets(delays); total = Math.min(...cams.map((mm, k) => mm.duration - offs[k])); seekTo(Math.min(T, total)); } }));
    function paint() {
      bar.replaceChildren(...segments(cuts, total).map((s) => h('b', { style: { left: s.t / total * 100 + '%', width: (s.end - s.t) / total * 100 + '%', background: COLORS[s.cam] } }, String(s.cam + 1))), head);
      head.style.left = T / total * 100 + '%'; const act = camAt(T); tiles.forEach((el, i) => el.classList.toggle('on', i === act)); tcEl.textContent = timecode(T) + ' / ' + timecode(total);
    }
    function apply(force) { vs.forEach((v, i) => { const want = T + offs[i]; v.muted = !(playing && i === audioCam); if (playing) { if (v.paused) { v.currentTime = want; v.play().catch(() => {}); } else if (Math.abs(v.currentTime - want) > 0.25) v.currentTime = want; } else { if (!v.paused) v.pause(); if (force || Math.abs(v.currentTime - want) > 0.03) v.currentTime = want; } }); }
    function seekTo(t) { T = MMX.clamp(t, 0, total); apply(true); paint(); }
    function switchTo(i) { if (i >= cams.length) return; const k = cuts.findIndex((q) => Math.abs(q.t - T) < 0.04); if (k >= 0) cuts[k].cam = i; else { cuts.push({ t: +T.toFixed(3), cam: i }); cuts.sort((a, b) => a.t - b.t); } for (let j = cuts.length - 1; j > 0; j--) if (cuts[j].cam === cuts[j - 1].cam) cuts.splice(j, 1); paint(); }
    function toggle() { playing = !playing; playBtn.textContent = playing ? 'Pausa' : 'Reproducir'; last = performance.now(); if (playing && T >= total - 0.05) T = 0; apply(true); }
    function loop(now) { if (playing) { T += (now - last) / 1000; if (T >= total) { T = total; playing = false; playBtn.textContent = 'Reproducir'; } apply(false); paint(); } last = now; raf = requestAnimationFrame(loop); }
    function stop() { cancelAnimationFrame(raf); vs.forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); }); Dialogs.keyHook = null; $('#modal-box').classList.remove('wide'); }
    Dialogs.open('Edición multicámara', h('div', {},
      h('p', { class: 'hint' }, (note ? note + ' ' : '') + 'Reproduce y haz clic en una cámara (o pulsa 1–' + cams.length + ') para cambiar de ángulo en ese instante. Espacio reproduce o pausa.'),
      h('div', { class: 'mc-grid c' + (cams.length <= 4 ? 2 : 3) }, tiles), bar,
      h('div', { class: 'btns', style: { alignItems: 'center' } }, playBtn, tcEl, h('span', { class: 'grow' }), aSel),
      h('div', { class: 'btns', style: { alignItems: 'center' } }, h('span', { class: 'note' }, 'Desfase (s):'), cams.map((m, i) => h('label', { class: 'chk', style: { margin: 0 } }, `C${i + 1}`, offIn[i])))),
      [h('button', { onclick: () => { stop(); Dialogs.close(); } }, 'Cancelar'), h('button', { class: 'primary', onclick: () => {
        const base = duration() > 0 ? Math.ceil(duration()) : 0; stop(); Dialogs.close();
        mutate(null, () => { build(cams, offs, cuts, total, audioCam, base); }); seek(base); Actions.fit(); toast('Secuencia multicámara creada en la línea de tiempo');
      } }, 'Crear en la línea de tiempo')], false);
    $('#modal-box').classList.add('wide');
    Dialogs.keyHook = (e) => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return false; if (e.key === ' ') { e.preventDefault(); toggle(); return true; } const nn = parseInt(e.key, 10); if (nn >= 1 && nn <= cams.length) { switchTo(nn - 1); return true; } return false; };
    vs.forEach((v) => v.addEventListener('loadeddata', () => apply(true), { once: true }));
    paint(); raf = requestAnimationFrame(loop);
    return { switchTo, seekTo, cuts, get total() { return total; } };
  }
  return { open, editor, build, offsets, segments };
})();
