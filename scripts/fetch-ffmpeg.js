/* Descarga ffmpeg y ffprobe (compilaciones GPL de ffmpeg-static) para empaquetarlos con el instalador.
 * Uso: node scripts/fetch-ffmpeg.js [plataforma] [arquitectura]   p. ej.  win32 x64 · darwin arm64 · linux x64 */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { spawnSync } = require('child_process');
const platform = process.argv[2] || process.platform, arch = process.argv[3] || process.arch;
const tag = require('ffmpeg-static/package.json')['ffmpeg-static']['binary-release-tag'];
const dir = path.join(__dirname, '..', 'vendor', 'bin', `${platform}-${arch}`);
fs.mkdirSync(dir, { recursive: true });
for (const tool of ['ffmpeg', 'ffprobe']) {
  const out = path.join(dir, tool + (platform === 'win32' ? '.exe' : ''));
  if (fs.existsSync(out) && fs.statSync(out).size > 1e6) { console.log('ya existe', out); continue; }
  const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${tag}/${tool}-${platform}-${arch}.gz`, gz = out + '.gz';
  console.log('descargando', url);
  const r = spawnSync('curl', ['-fsSL', '--retry', '3', '-o', gz, url], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('No se pudo descargar ' + url); process.exit(1); }
  fs.writeFileSync(out, zlib.gunzipSync(fs.readFileSync(gz))); fs.unlinkSync(gz); fs.chmodSync(out, 0o755);
  console.log('listo', out, (fs.statSync(out).size / 1e6).toFixed(1) + ' MB');
}
