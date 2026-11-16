/* MontajeMX — sincronización de cámaras por audio (correlación cruzada de envolventes).
 * Copyright (C) 2026 Santiago Miguel — GPL-3.0-or-later. */
'use strict';
const HOP_HZ = 100;
/* PCM mono de 16 bits → envolvente de energía (100 valores por segundo). */
function envelope(buf, rate) {
  const hop = Math.round(rate / HOP_HZ), nS = Math.floor(buf.length / 2), nF = Math.floor(nS / hop), env = new Float32Array(nF);
  for (let f = 0; f < nF; f++) { let s = 0; for (let i = 0; i < hop; i++) { const v = buf.readInt16LE((f * hop + i) * 2) / 32768; s += v * v; } env[f] = Math.log(1 + 1000 * Math.sqrt(s / hop)); }
  // se usa la variación (inicios de sonido), más robusta que el nivel absoluto
  const d = new Float32Array(nF); let mean = 0;
  for (let f = 1; f < nF; f++) { d[f] = Math.max(0, env[f] - env[f - 1]); mean += d[f]; }
  mean /= Math.max(1, nF); for (let f = 0; f < nF; f++) d[f] -= mean;
  return d;
}
/* Devuelve cuántos segundos más tarde empezó a grabar b respecto de a (negativo = antes). */
function delay(a, b, maxSeconds) {
  const maxLag = Math.min(Math.round((maxSeconds || 30) * HOP_HZ), Math.max(a.length, b.length) - 1);
  let best = 0, bestScore = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const n0 = Math.max(0, -lag), n1 = Math.min(b.length, a.length - lag);
    if (n1 - n0 < HOP_HZ * 2) continue;
    let s = 0, na = 0, nb = 0;
    for (let n = n0; n < n1; n++) { const x = a[n + lag], y = b[n]; s += x * y; na += x * x; nb += y * y; }
    const score = s / (Math.sqrt(na * nb) + 1e-9);
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  return { seconds: best / HOP_HZ, score: bestScore };
}
module.exports = { envelope, delay, HOP_HZ };
