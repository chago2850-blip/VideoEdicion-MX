/* MontajeMX — DVD con menú: plantillas, capítulos, estructura VIDEO_TS e imagen ISO.
 * La autoría usa dvdauthor/spumux (software libre) si están instalados en el equipo.
 * Copyright (C) 2026 Santiago Miguel — GPL-3.0-or-later. */
'use strict';
const Dvd = (() => {
  const TEMPLATES = [
    { name: 'Cine oscuro', bg: ['#0f1116', '#2a3140'], text: '#ffffff', acc: '#5fd4b8', font: 'Helvetica, Arial, sans-serif', layout: 'left' },
    { name: 'Atardecer', bg: ['#3b1d4a', '#ff7a59'], text: '#fff6ec', acc: '#ffd23f', font: 'Georgia, "Times New Roman", serif', layout: 'center' },
    { name: 'Océano', bg: ['#06283d', '#1f8a9e'], text: '#eaffff', acc: '#7af0ff', font: 'Helvetica, Arial, sans-serif', layout: 'center' },
    { name: 'Clásico', bg: ['#1a1410', '#4a3520'], text: '#f3e3c3', acc: '#e8b84a', font: 'Georgia, "Times New Roman", serif', layout: 'left' },
    { name: 'Boda', bg: ['#f7efe6', '#e2cdb8'], text: '#4a3b30', acc: '#b0703a', font: 'Georgia, "Times New Roman", serif', layout: 'center' },
    { name: 'Fiesta', bg: ['#2b0a5c', '#e5388a'], text: '#ffffff', acc: '#ffe14a', font: 'Impact, "Arial Black", sans-serif', layout: 'center' },
    { name: 'Naturaleza', bg: ['#0f2b1a', '#5c9a4a'], text: '#f2ffe9', acc: '#d4f06a', font: '"Trebuchet MS", Verdana, sans-serif', layout: 'left' },
    { name: 'Minimal', bg: ['#f4f5f7', '#d9dde3'], text: '#1b1e25', acc: '#2fa58c', font: 'Helvetica, Arial, sans-serif', layout: 'bottom' },
  ];
  const fmtT = (t) => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  function chaptersFor(mode) {
    const d = duration(); let ts = [];
    if (mode === 'cuts') { const tr = [...S.p.tracks].reverse().find((t) => t.clips.some((c) => MMX.isVisual(c))); if (tr) ts = tr.clips.map((c) => c.start); }
    else if (+mode > 0) for (let t = +mode * 60; t < d - 5; t += +mode * 60) ts.push(t);
    return [...new Set(ts.map((t) => Math.round(t)))].filter((t) => t > 1 && t < d - 2).sort((a, b) => a - b).slice(0, 98);
  }
  /* Dibuja el menú. Devuelve el fondo y las dos capas de resaltado (sin suavizado, como exige el formato DVD). */
  function render(cfg, bgImage) {
    const W = 720, H = cfg.standard === 'pal' ? 576 : 480, tp = TEMPLATES[cfg.template], LW = 1024, LH = 576, sx = W / LW, sy = H / LH;
    const cn = document.createElement('canvas'); cn.width = W; cn.height = H; const g = cn.getContext('2d');
    g.save(); g.scale(sx, sy);
    const gr = g.createLinearGradient(0, 0, LW, LH); gr.addColorStop(0, tp.bg[0]); gr.addColorStop(1, tp.bg[1]); g.fillStyle = gr; g.fillRect(0, 0, LW, LH);
    if (bgImage) { const k = Math.max(LW / bgImage.width, LH / bgImage.height); g.globalAlpha = 0.55; g.drawImage(bgImage, (LW - bgImage.width * k) / 2, (LH - bgImage.height * k) / 2, bgImage.width * k, bgImage.height * k); g.globalAlpha = 0.45; g.fillStyle = tp.bg[0]; g.fillRect(0, 0, LW, LH); g.globalAlpha = 1; }
    const center = tp.layout !== 'left', items = ['Reproducir película'].concat(cfg.chapters.slice(0, 6).map((t, i) => `Capítulo ${i + 2}  ·  ${fmtT(t)}`));
    const x = center ? LW / 2 : 110, lh = Math.min(52, 300 / items.length), y0 = tp.layout === 'bottom' ? LH - 70 - lh * items.length : 250;
    g.textAlign = center ? 'center' : 'left'; g.textBaseline = 'middle'; g.fillStyle = tp.text;
    g.font = `700 64px ${tp.font}`; g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 10; g.fillText(cfg.title || 'Mi película', x, tp.layout === 'bottom' ? 120 : 140, LW - 160);
    g.shadowBlur = 0; g.fillStyle = tp.acc; g.fillRect(center ? LW / 2 - 60 : 110, tp.layout === 'bottom' ? 170 : 190, 120, 5);
    g.font = `500 ${Math.min(34, lh * 0.66)}px ${tp.font}`; g.fillStyle = tp.text;
    const buttons = [];
    items.forEach((label, i) => {
      const y = y0 + i * lh + lh / 2, w = Math.min(LW - 200, g.measureText(label).width);
      g.fillText(label, x, y, LW - 200);
      const lx = center ? x - w / 2 : x, even = (v) => Math.round(v / 2) * 2;
      buttons.push({ x0: even((lx - 26) * sx), y0: even((y - lh / 2 + 4) * sy), x1: even((lx + w + 26) * sx), y1: even((y + lh / 2 - 4) * sy), chapter: i + 1, ux: lx, uw: w, uy: y + lh / 2 - 8 });
    });
    g.restore();
    const layer = (color) => { const c2 = document.createElement('canvas'); c2.width = W; c2.height = H; const q = c2.getContext('2d'); q.fillStyle = color; for (const b of buttons) { const bx = Math.round(b.ux * sx), bw = Math.round(b.uw * sx), by = Math.round(b.uy * sy); q.fillRect(bx, by, bw, 4); q.fillRect(bx - 16, Math.round((b.uy - 22) * sy), 8, 8); } return c2.toDataURL('image/png'); };
    return { canvas: cn, bg: cn.toDataURL('image/png'), hl: layer(tp.acc), sel: layer('#ffffff'), buttons: buttons.map((b) => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, chapter: b.chapter })) };
  }
  async function open() {
    if (duration() <= 0) return toast('La línea de tiempo está vacía');
    Preview.pause();
    const tools = await api.invoke('dvd:tools'), row = (l, c) => h('div', { class: 'row' }, h('label', {}, l), c);
    const cfg = { template: 0, standard: 'ntsc', title: S.p.name === 'Sin título' ? 'Mi película' : S.p.name, chapters: [], useFrame: true };
    let frameImg = null;
    const pv = h('canvas', { width: 720, height: 480, style: { width: '100%', borderRadius: '8px', background: '#000', aspectRatio: '16 / 9' } });
    const repaint = () => { cfg.chapters = chaptersFor(chap.value); const r = render(cfg, cfg.useFrame ? frameImg : null); pv.width = r.canvas.width; pv.height = r.canvas.height; const g = pv.getContext('2d'); g.drawImage(r.canvas, 0, 0); const hl = new Image(); hl.onload = () => g.drawImage(hl, 0, 0); hl.src = r.hl; return r; };
    const title = h('input', { type: 'text', value: cfg.title, oninput: (e) => { cfg.title = e.target.value; repaint(); } });
    const tsel = h('select', { onchange: (e) => { cfg.template = +e.target.value; repaint(); } }, TEMPLATES.map((t, i) => h('option', { value: i }, t.name)));
    const std = h('select', { onchange: (e) => { cfg.standard = e.target.value; repaint(); } }, h('option', { value: 'ntsc' }, 'NTSC (América, Japón)'), h('option', { value: 'pal' }, 'PAL (Europa)'));
    const chap = h('select', { onchange: repaint }, h('option', { value: 'cuts' }, 'En cada clip de la pista principal'), h('option', { value: '5' }, 'Cada 5 minutos'), h('option', { value: '10' }, 'Cada 10 minutos'), h('option', { value: '0' }, 'Sin capítulos'));
    const useF = h('input', { type: 'checkbox', checked: true, onchange: (e) => { cfg.useFrame = e.target.checked; repaint(); } }), sur = h('input', { type: 'checkbox' });
    const bar = h('div', { class: 'bar', hidden: true }, h('i')), status = h('p', { class: 'note' });
    const go = h('button', { class: 'primary', onclick: build }, 'Crear DVD'), cancel = h('button', { onclick: () => (busy ? api.invoke('export:cancel') : Dialogs.close()) }, 'Cerrar');
    let busy = false;
    const missing = !tools.dvdauthor || !tools.spumux;
    const how = tools.platform === 'android' ? 'En Android se crea el video MPEG-2 listo para DVD; para el menú y la carpeta VIDEO_TS ábrelo en MontajeMX de escritorio' : tools.platform === 'darwin' ? 'En macOS: brew install dvdauthor' : tools.platform === 'win32' ? 'En Windows: instala dvdauthor (por ejemplo con MSYS2 o los binarios de dvdauthor para Windows) y añádelo al PATH' : 'En Linux: sudo apt install dvdauthor genisoimage';
    async function build() {
      const outDir = await api.invoke('dvd:pickDir'); if (!outDir) return;
      const menu = repaint(); busy = true; Dialogs.closable = false; go.disabled = true; bar.hidden = false; cancel.textContent = 'Cancelar';
      status.textContent = 'Preparando títulos…';
      const pack = await Preview.collectAssets();
      const r = await api.invoke('dvd:build', S.p, pack, { outDir, name: cfg.title, standard: cfg.standard, chapters: cfg.chapters, surround: sur.checked, menu: { bg: menu.bg, hl: menu.hl, sel: menu.sel, buttons: menu.buttons } });
      busy = false; Dialogs.closable = true; go.disabled = false; cancel.textContent = 'Cerrar';
      if (r.error) { status.replaceChildren(h('pre', { class: 'err' }, r.error)); bar.hidden = true; return; }
      bar.firstChild.style.width = '100%';
      status.replaceChildren(r.partial ? 'Se creó la película en MPEG-2 para DVD, pero falta dvdauthor para el menú y la estructura del disco. ' + how + '.  ' : r.iso ? 'DVD listo: carpeta VIDEO_TS e imagen ISO para grabar.  ' : 'DVD listo: carpeta VIDEO_TS (no se encontró herramienta para crear la ISO).  ', h('button', { onclick: () => api.invoke('shell:show', r.iso || r.movie || r.disc) }, 'Mostrar en la carpeta'));
    }
    api.on('dvd:stage', (t) => { if (busy) status.textContent = t; });
    api.on('export:progress', (f) => { if (busy) bar.firstChild.style.width = (f * 80).toFixed(1) + '%'; });
    Dialogs.open('DVD con menú', h('div', {}, pv,
      missing ? h('p', { class: 'note', style: { color: '#ffb38a' } }, 'No se encontró dvdauthor en este equipo: se generará solo el video MPEG-2. ' + how + '.') : null,
      row('Título del disco', title), row('Plantilla de menú', tsel), row('Norma', std), row('Capítulos', chap),
      row('Fondo', h('label', { class: 'chk', style: { margin: 0 } }, useF, 'Usar el fotograma actual como fondo')), row('Audio', h('label', { class: 'chk', style: { margin: 0 } }, sur, 'Mezcla 5.1 (AC-3)')), bar, status), [cancel, go]);
    repaint();
    const at = Math.min(S.t, duration() - 1 / S.p.fps);
    api.invoke('frame:render', S.p, at, 854, await Preview.collectAssets(at)).then((r) => { if (r.data) { const im = new Image(); im.onload = () => { frameImg = im; if (!$('#modal').hidden) repaint(); }; im.src = r.data; } });
  }
  return { open, render, chaptersFor, TEMPLATES };
})();
