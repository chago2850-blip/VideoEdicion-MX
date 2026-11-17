/* Arma la carpeta www/ que Capacitor empaqueta en la app de Android.
 * Reutiliza la misma interfaz de escritorio (src/ui) y sustituye el proceso principal de Electron
 * por src/android/puente.js (FFmpeg en WebAssembly).  Uso: node scripts/build-android-web.js
 * Copyright (C) 2026 Santiago Miguel — GPL-3.0-or-later. */
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), www = path.join(root, 'www');
const pkg = require(path.join(root, 'package.json'));
const cp = (a, b) => fs.cpSync(path.join(root, a), path.join(www, b), { recursive: true });

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });
cp('src/ui', 'ui');
cp('src/vendor', 'vendor');
cp('src/core/model.js', 'core/model.js');
cp('src/android', 'android');
cp('LICENSE', 'LICENSE');
const core = path.join(root, 'node_modules', '@ffmpeg', 'core');
fs.mkdirSync(path.join(www, 'android', 'ffmpeg'), { recursive: true });
for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) fs.copyFileSync(path.join(core, 'dist', 'umd', f), path.join(www, 'android', 'ffmpeg', f));

// render.js y sync.js son módulos CommonJS: se envuelven para el navegador.
const wrap = (file, dep) => `(function () { const module = { exports: {} }; const require = () => ${dep};\n${fs.readFileSync(path.join(root, file), 'utf8')}\nreturn module.exports; })()`;
fs.writeFileSync(path.join(www, 'core', 'web.js'), `/* Generado por scripts/build-android-web.js — no editar. GPL-3.0-or-later. */
window.MMX_VERSION = ${JSON.stringify(pkg.version)};
window.MMXRender = ${wrap('src/core/render.js', 'window.MMX')};
window.MMXSync = ${wrap('src/core/sync.js', 'null')};
`);

let html = fs.readFileSync(path.join(www, 'ui', 'index.html'), 'utf8');
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,
  `<meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; media-src 'self' blob: mediastream:; img-src 'self' data: blob:">
<meta name="viewport" content="width=1180, user-scalable=no">
<link rel="stylesheet" href="../android/movil.css">`);
html = html.replace('<script src="../core/model.js"></script>', '<script src="../core/model.js"></script>\n<script src="../core/web.js"></script>\n<script src="../android/puente.js"></script>');
if (!html.includes('android/puente.js')) throw new Error('No se pudo insertar el puente en index.html');
fs.writeFileSync(path.join(www, 'ui', 'index.html'), html);
fs.writeFileSync(path.join(www, 'index.html'), '<!DOCTYPE html><meta charset="utf-8"><title>MontajeMX</title><script>location.replace("ui/index.html")</script>\n');

// versión de la app Android = versión de package.json
const gradle = path.join(root, 'android', 'app', 'build.gradle');
if (fs.existsSync(gradle)) {
  const [ma, mi, pa] = pkg.version.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const code = ma * 10000 + mi * 100 + pa;
  let g = fs.readFileSync(gradle, 'utf8');
  g = g.replace(/versionCode \d+/, 'versionCode ' + code).replace(/versionName "[^"]*"/, `versionName "${pkg.version}"`);
  fs.writeFileSync(gradle, g);
}
console.log('www listo · MontajeMX', pkg.version);
