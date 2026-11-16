<p align="center"><img src="build/logo-horizontal.png" alt="MontajeMX" width="520"></p>

# MontajeMX

Editor de video multipista libre para **Windows, Linux y macOS**. Sin ediciones de pago, sin marcas de agua y sin límites de uso.
Licencia **GPL-3.0-or-later**. Copyright © 2026 Santiago Miguel.

## Qué hace (v0.2.0)

- **Montaje**: pistas ilimitadas, arrastrar y soltar, recortar, dividir, imán, cerrar huecos, deshacer/rehacer, copiar/pegar, congelar fotograma, velocidad y reversa.
- **Animación**: fotogramas clave de posición, escala, rotación, opacidad y volumen; zoom lento y paneo con un clic.
- **Color**: exposición, contraste, saturación, tono, temperatura, gamma, ruedas de sombras/medios/luces, curva de tonos, color selectivo, 12 looks, LUT `.cube`, histograma.
- **Efectos**: croma, modos de mezcla, máscaras, censura con mosaico, pantalla dividida, imagen en imagen, desenfoque, viñeta, grano, nitidez, reducción de ruido, estabilización, corrección de lente, video 360° a normal y «pequeño planeta».
- **Títulos** con plantillas, borde, sombra, fondo y créditos animados. **Títulos 3D** extruidos con bisel, material, luz y animación.
- **Transiciones**: disolvencia, fundido, deslizar, zoom, barridos y morph.
- **Seguimiento de movimiento**: la máscara sigue a un objeto (mosaico o desenfoque que lo acompaña) y un título o imagen puede seguir el mismo rastro.
- **Multicámara**: hasta 6 tomas sincronizadas por audio, con cambio de ángulo en vivo.
- **DVD con menú**: plantillas, capítulos, carpeta VIDEO_TS e imagen ISO (necesita `dvdauthor` instalado).
- **Audio 5.1**: cada pista se envía a frontal, centro o traseros.
- **Audio**: volumen, fundidos, balance, tono, graves/agudos, reducción de ruido, separar audio y atenuación automática con la voz.
- **Captura**: pantalla, cámara, voz en off y stop motion con papel cebolla.
- **Película rápida**: montaje automático con transiciones, título y música.
- **Exportación**: MP4 (H.264/HEVC), WebM, AV1, MOV ProRes (también con canal alfa), AVI, WMV, M2TS, MPEG-2 para DVD, GIF, secuencias PNG/JPEG y audio (MP3, AAC, WAV, FLAC, AC3), hasta 8K.

Lo pendiente está en [`replica/features.csv`](replica/features.csv).

## Probarla

```bash
npm install
npm start
```

Para empaquetar hay que traer antes FFmpeg para el sistema de destino:

```bash
node scripts/fetch-ffmpeg.js            # sistema actual
node scripts/fetch-ffmpeg.js win32 x64  # u otro: darwin x64 · darwin arm64 · linux x64
```

Requiere Node.js 20 o superior. En desarrollo se usa `ffmpeg-static` o el FFmpeg del sistema; los instaladores llevan el suyo en `resources/bin`.

## Instaladores

```bash
npm run dist:win     # .exe (instalador y portable) — ejecutar en Windows
npm run dist:linux   # .AppImage y .tar.gz
npm run dist:mac     # .dmg — ejecutar en macOS
```

El flujo `.github/workflows/build.yml` compila los tres al publicar una etiqueta `v*` y los adjunta a la *release*.
Los instaladores no van firmados: en macOS hay que abrir la app con clic derecho → Abrir la primera vez; en Windows, SmartScreen pedirá confirmación.

## Pruebas

```bash
npm test         # exporta proyectos sintéticos con FFmpeg real y verifica píxeles, duración y códecs
npm run smoke    # arranca la app, monta un proyecto, reproduce y exporta
```

## Cómo está hecha

| archivo | función |
| --- | --- |
| `src/core/model.js` | modelo del proyecto y matemáticas compartidas (fotogramas clave, color, croma, máscaras) |
| `src/core/render.js` | convierte el proyecto en un grafo de filtros de FFmpeg |
| `src/main.js` | proceso principal: archivos, FFmpeg, proxies, exportación, grabaciones |
| `src/ui/` | interfaz: biblioteca, visor en tiempo real, inspector y línea de tiempo |

La vista previa y la exportación usan las mismas fórmulas; el color pasa por una misma LUT 3D en ambos lados. Los efectos que solo se aplican al exportar se revisan con **Fotograma exacto**.

Proyecto independiente, escrito desde cero. No está afiliado a ningún editor comercial ni usa su código, recursos o marca.
