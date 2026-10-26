// Respaldo para audios que el navegador no sabe leer (AMR, ALAC, WMA, CAF, etc.):
// FFmpeg compilado a WebAssembly. Se descarga (unos 32 MB) solo la primera vez que hace falta.

import { FFmpeg } from './vendor/ffmpeg/index.js';

const NUCLEO = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js';

let instancia = null;

// Si el worker de FFmpeg no llega a arrancar, su promesa nunca termina: le ponemos un límite.
const LIMITE_CARGA_MS = 3 * 60 * 1000;

async function cargar() {
  const nueva = new FFmpeg();
  let temporizador;
  const limite = new Promise((_, reject) => {
    temporizador = setTimeout(() => reject(new Error('FFmpeg tardó demasiado en cargar. Revisá la conexión.')), LIMITE_CARGA_MS);
  });
  try {
    await Promise.race([nueva.load({ coreURL: NUCLEO, wasmURL: NUCLEO.replace(/\.js$/, '.wasm') }), limite]);
    return nueva;
  } catch (error) {
    nueva.terminate();
    // El worker de FFmpeg avisa los errores como texto, no como Error.
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(temporizador);
  }
}

async function obtener() {
  if (!instancia) {
    try {
      instancia = await cargar();
    } catch (error) {
      console.warn('FFmpeg no cargó, pruebo una vez más.', error);
      instancia = await cargar();
    }
  }
  return instancia;
}

/** Convierte cualquier audio a muestras mono de 16 kHz. */
export async function convertirConFFmpeg(datos, frecuencia) {
  const ffmpeg = await obtener();
  const entrada = 'entrada';
  const salida = 'salida.raw';
  // Se pasa una copia: FFmpeg se queda con los datos que recibe (los "transfiere" a su worker).
  await ffmpeg.writeFile(entrada, new Uint8Array(datos.slice(0)));
  try {
    const codigo = await ffmpeg.exec(['-i', entrada, '-vn', '-ac', '1', '-ar', String(frecuencia), '-f', 'f32le', salida]).catch((error) => {
      throw error instanceof Error ? error : new Error(String(error));
    });
    if (codigo !== 0) throw new Error(`FFmpeg no pudo convertir el archivo (código ${codigo}).`);
    const bytes = await ffmpeg.readFile(salida);
    return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4)).slice();
  } finally {
    await ffmpeg.deleteFile(entrada).catch(() => {});
    await ffmpeg.deleteFile(salida).catch(() => {});
  }
}
