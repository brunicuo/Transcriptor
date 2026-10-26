# ffmpeg.wasm (envoltorio)

Copia sin cambios de `@ffmpeg/ffmpeg` 0.12.15, carpeta `dist/esm` (licencia MIT,
https://github.com/ffmpegwasm/ffmpeg.wasm). Está dentro del repo porque su Web Worker
tiene que servirse desde el mismo sitio que la app.

El núcleo (`@ffmpeg/core` 0.12.10, unos 32 MB) se descarga de jsDelivr solo cuando el
navegador no puede leer un audio por su cuenta (por ejemplo AMR, ALAC o WMA).
