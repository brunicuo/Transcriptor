// Web Worker que ejecuta Whisper con transformers.js.
// Intenta usar la placa de video (WebGPU) y si no puede, usa el procesador (WebAssembly).

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true; // el modelo se descarga una sola vez y queda guardado

let transcriptor = null;
let modeloActual = null;
let dispositivoActual = null;

async function adaptadorWebGPU() {
  try {
    if (!navigator.gpu) return null;
    return await navigator.gpu.requestAdapter();
  } catch {
    return null;
  }
}

async function cargar({ id, modelo, repo, aceleracion = 'auto' }) {
  const clave = `${modelo}|${aceleracion}`;
  if (transcriptor && modeloActual === clave) {
    postMessage({ id, tipo: 'listo', dispositivo: dispositivoActual });
    return;
  }
  if (transcriptor) {
    await transcriptor.dispose?.();
    transcriptor = null;
  }

  const progress_callback = (dato) => {
    if (dato.status === 'progress') {
      postMessage({ id, tipo: 'progreso', archivo: dato.file, cargado: dato.loaded, total: dato.total });
    }
  };

  const adaptador = aceleracion === 'wasm' ? null : await adaptadorWebGPU();
  if (adaptador) {
    try {
      // En WebGPU el codificador necesita buena precisión; el decodificador va comprimido (q4).
      const precisionCodificador = modelo === 'small' && adaptador.features.has('shader-f16') ? 'fp16' : 'fp32';
      transcriptor = await pipeline('automatic-speech-recognition', repo, {
        device: 'webgpu',
        dtype: { encoder_model: precisionCodificador, decoder_model_merged: 'q4' },
        progress_callback,
      });
      // Prueba corta: si la placa de video no aguanta, mejor enterarse ahora.
      await transcriptor(new Float32Array(16000), { task: 'transcribe', language: 'spanish' });
      dispositivoActual = 'webgpu';
    } catch (error) {
      // No llamamos a dispose(): con la placa colgada puede quedarse esperando para siempre.
      console.warn('WebGPU no funcionó, sigo con WebAssembly.', error);
      transcriptor = null;
    }
  }
  if (!transcriptor) {
    transcriptor = await pipeline('automatic-speech-recognition', repo, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback,
    });
    dispositivoActual = 'wasm';
  }
  modeloActual = clave;
  postMessage({ id, tipo: 'listo', dispositivo: dispositivoActual });
}

async function transcribir({ id, audio, idioma }) {
  const opciones = { task: 'transcribe', return_timestamps: false };
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
