// Web Worker que ejecuta Whisper con transformers.js usando el procesador (WebAssembly).
//
// No usamos la placa de video (WebGPU): en celulares se colgaba ("device lost") y la
// versión del modelo que necesita (q4) transcribía peor. La versión q8 sobre el
// procesador es la que se probó y da buenos resultados.

import { pipeline, env, WhisperTextStreamer } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true; // el modelo se descarga una sola vez y queda guardado

let transcriptor = null;
let modeloActual = null;
let hilosConfigurados = false;

function configurarHilos(hilos) {
  if (hilosConfigurados) return;
  hilosConfigurados = true;
  // Varios núcleos solo funcionan con la página aislada (crossOriginIsolated),
  // algo que activa el service worker. Si no, se usa uno solo.
  const disponibles = navigator.hardwareConcurrency || 2;
  const elegidos = self.crossOriginIsolated ? Math.min(4, Math.max(1, disponibles - 1)) : 1;
  env.backends.onnx.wasm.numThreads = hilos || elegidos;
}

async function cargar({ id, modelo, repo, hilos }) {
  configurarHilos(hilos);
  if (transcriptor && modeloActual === modelo) {
    postMessage({ id, tipo: 'listo', hilos: env.backends.onnx.wasm.numThreads });
    return;
  }
  if (transcriptor) {
    await transcriptor.dispose?.();
    transcriptor = null;
    modeloActual = null;
  }
  transcriptor = await pipeline('automatic-speech-recognition', repo, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: (dato) => {
      if (dato.status === 'progress') {
        postMessage({ id, tipo: 'progreso', archivo: dato.file, cargado: dato.loaded, total: dato.total });
      }
    },
  });
  modeloActual = modelo;
  postMessage({ id, tipo: 'listo', hilos: env.backends.onnx.wasm.numThreads });
}

async function transcribir({ id, audio, idioma }) {
  // El streamer manda el texto palabra por palabra mientras se genera.
  const streamer = new WhisperTextStreamer(transcriptor.tokenizer, {
    skip_prompt: true,
    callback_function: (texto) => postMessage({ id, tipo: 'parcial', texto }),
  });
  const opciones = { task: 'transcribe', return_timestamps: false, streamer };
  if (idioma) opciones.language = idioma;
  const salida = await transcriptor(audio, opciones);
  postMessage({ id, tipo: 'resultado', texto: salida.text || '' });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.tipo === 'cargar') await cargar(data);
    else if (data.tipo === 'transcribir') await transcribir(data);
  } catch (error) {
    postMessage({ id: data.id, tipo: 'error', mensaje: error?.message || String(error) });
  }
};
