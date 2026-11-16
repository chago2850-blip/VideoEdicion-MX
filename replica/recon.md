# Mapa de reconocimiento — editor tipo Pinnacle Studio 26 → MontajeMX

Sala limpia: solo fuentes públicas. No se usó código, recursos, textos ni marca del original.

## Fuentes
| fuente | URL | qué aporta |
| --- | --- | --- |
| Sitio (es) | https://www.pinnaclesys.com/es/ | familia de productos |
| Página Ultimate | https://www.pinnaclesys.com/es/products/studio/ultimate/ | lista de funciones, formatos, requisitos |
| Comparativa Studio / Ultimate | https://www.pinnaclesys.com/es/products/studio/ | qué es exclusivo de la edición de pago |
| Ficha Ultimate | https://pinnaclesys.com/en/pages/product-info-sheet/ult | resumen de herramientas |
| Guía de usuario (índice) | https://help.pinnaclesys.com/pinnacle/v26/Pinnacle-Studio-en/Pinnacle-Studio-26.pdf | estructura: Biblioteca, Editor, Línea de tiempo, Reproductor |

## Alcance
- **App y plataforma:** editor de video de escritorio. El original es solo Windows; el clon es Windows, Linux y macOS.
- **Porción:** el ciclo central importar → montar en multipista → corregir/efectos/títulos/audio → exportar, incluyendo lo exclusivo de Ultimate.
- **Para quién:** la comunidad, bajo GPL-3.0-or-later, sin ediciones ni límites.

## Pantallas
| ID | pantalla | propósito | componentes | estados |
| --- | --- | --- | --- | --- |
| S01 | Espacio de edición | todo el montaje | barra superior, biblioteca, reproductor, inspector, línea de tiempo | vacío, con medios, reproduciendo |
| S02 | Biblioteca | medios y contenido | pestañas Medios / Títulos / Transiciones / Looks / División | vacía, creando proxy, medio no encontrado |
| S03 | Reproductor | vista previa | lienzo, transporte, código de tiempo, calidad, histograma, fotograma exacto | en vivo, fotograma exacto |
| S04 | Inspector | propiedades del clip | Clip, Título, Transformar, Recorte, Color, Efectos, Croma, Máscara, Transiciones, Audio | sin selección, por tipo de clip |
| S05 | Línea de tiempo | montaje | regla, cabeceras de pista, clips, cursor | vacía, pista bloqueada/oculta/silenciada |
| S06 | Exportar | salida | formato, resolución, fotogramas, calidad, progreso | configurando, exportando, listo, error |
| S07 | Capturar | grabación | Pantalla / Cámara / Voz en off / Stop motion | en espera, grabando, guardando |
| S08 | Ajustes del proyecto | formato | resolución, fps, notas | — |
| S09 | Película rápida | montaje automático | título, tiempos, transición, música | sin medios |

## Flujos
- **F01 Montar y exportar** — S02 importar → S05 arrastrar → recortar/dividir → S06 exportar. Borde: códec no reproducible (proxy), medio movido de sitio.
- **F02 Corregir color** — seleccionar clip → S04 Color (deslizadores, ruedas, curva, LUT) → comprobar con histograma.
- **F03 Imagen en imagen / pantalla dividida** — clips en pistas distintas → S02 División → celda → animar con fotogramas clave.
- **F04 Título** — S02 Títulos → pista superior → S04 texto y estilo → transición.
- **F05 Voz en off con atenuación** — S07 Voz → pista «Voz» → activar «Atenuar con voz».
- **F06 Censurar** — seleccionar clip → Censurar → ajustar máscara.
- **F07 Película rápida** — importar → S09 → revisar.

## Modelo de datos (proyecto `.mmx`, JSON)
- **Proyecto**: nombre, ancho, alto, fps, notas, medios{}, pistas[], atenuación.
- **Medio**: ruta, tipo (video/audio/imagen), duración, tamaño, códecs, miniatura, onda, proxy.
- **Pista**: nombre, silenciada, oculta, bloqueada, volumen, opacidad, función (normal/voz), clips[].
- **Clip**: tipo (video/audio/imagen/título/color), medio, inicio, duración, entrada, velocidad, reversa, transformación, fotogramas clave, recorte, celda, mezcla, color, efectos, croma, máscara, transiciones, audio, título.

## Lo que no se clona
Música ScoreFitter, efectos NewBlueFX, plantillas y menús de DVD de Corel (contenido con licencia), subida a servicios en la nube con cuentas, y la marca.

## Tamaño
9 pantallas, 7 flujos, 4 entidades. Partes difíciles: seguimiento de movimiento, multicámara con sincronización por audio, títulos 3D y autoría de DVD. Tamaño total **L**; esta entrega cubre la fase 1 (los «must» y buena parte de los «should»).
