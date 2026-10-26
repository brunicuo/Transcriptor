// Motor local: Whisper corriendo en el navegador con transformers.js.
// El trabajo pesado lo hace un Web Worker (whisperWorker.js) para no congelar la pantalla.

import { FRECUENCIA } from '../audio.js';

const MODELOS = {
  base: {
    nombre: 'Rápido (base)',
    descripcion: 'Descarga de unos 80 a 150 MB. Ideal para audios de WhatsApp.',
    repo: 'onnx-community/whisper-base',
  },
  small: {
    nombre: 'Preciso (small)',
    descripcion: 'Descarga de unos 250 a 450 MB. Más lento, se equivoca menos.',
    repo: 'onnx-community/whisper-small',
  },
};

// Whisper trabaja con ventanas de 30 segundos: cortamos el audio en pedazos
// de hasta 28 s, buscando un silencio para no partir palabras.
const MAX_SEGUNDOS = 28;
const MIN_SEGUNDOS = 18;

// Frases que Whisper "inventa" cuando escucha silencio o ruido.
const ALUCINACIONES = [
  /^subt[ií]tulos? (realizados|por|hechos).*$/i,
  /^.*amara\.org.*$/i,
  /^¡?suscr[ií]bete.*$/i,
  /^gracias por ver( el v[ií]deo)?\.?$/i,
];

let worker = null;
let contador = 0;
const pendientes = new Map();
let modeloCargado = null;
let cargando = null;
let dispositivo = null;
let ultimaPreparacion = null;

function obtenerWorker() {
  if (!worker) {
    worker = new Worker(new URL('./whisperWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const pedido = pendientes.get(data.id);
      if (!pedido) return;
      if (data.tipo === 'progreso') {
        pedido.onProgreso?.(data);
        return;
      }
      pendientes.delete(data.id);
      if (data.tipo === 'error') pedido.reject(new Error(data.mensaje));
      else pedido.resolve(data);
    };
    worker.onerror = (evento) => {
      for (const pedido of pendientes.values()) pedido.reject(new Error(evento.message || 'Falló el motor de transcripción.'));
      pendientes.clear();
      worker = null;
      modeloCargado = null;
    };
  }
  return worker;
}

function pedir(tipo, datos, { onProgreso, transferir = [] } = {}) {
  const id = ++contador;
  return new Promise((resolve, reject) => {
    pendientes.set(id, { resolve, reject, onProgreso });
    obtenerWorker().postMessage({ id, tipo, ...datos }, transferir);
  });
}

async function preparar({ modelo = 'base', aceleracion = 'auto', onProgreso } = {}) {
  const elegido = MODELOS[modelo] ? modelo : 'base';
  const clave = `${elegido}|${aceleracion}`;
  if (modeloCargado === clave) return;
  if (cargando) await cargando.catch(() => {});
  if (modeloCargado === clave) return;
  ultimaPreparacion = { modelo: elegido, aceleracion, onProgreso };

  // Sumamos el avance de todos los archivos del modelo para mostrar un solo porcentaje.
  const archivos = {};
  cargando = pedir('cargar', { modelo: elegido, repo: MODELOS[elegido].repo, aceleracion }, {
    onProgreso: (dato) => {
      archivos[dato.archivo] = { cargado: dato.cargado || 0, total: dato.total || 0 };
      const lista = Object.values(archivos);
      const total = lista.reduce((s, a) => s + a.total, 0);
      const cargado = lista.reduce((s, a) => s + a.cargado, 0);
      onProgreso?.({ etapa: 'descarga', fraccion: total ? cargado / total : 0, cargado, total });
    },
  });
  try {
    const respuesta = await cargando;
    dispositivo = respuesta.dispositivo;
    modeloCargado = clave;
  } catch (error) {
    if (/fetch|network|load failed/i.test(error.message)) {
      throw new Error('No se pudo descargar el modelo. Revisá la conexión a internet y probá de nuevo.');
    }
    throw error;
  } finally {
    cargando = null;
  }
}

/** Descarta el worker (por ejemplo, si la placa de video se colgó) para empezar de cero. */
function reiniciarWorker() {
  worker?.terminate();
  worker = null;
  modeloCargado = null;
  for (const pedido of pendientes.values()) pedido.reject(new Error('Se reinició el motor.'));
  pendientes.clear();
}

function dividirAudio(muestras) {
  const maximo = MAX_SEGUNDOS * FRECUENCIA;
  if (muestras.length <= 30 * FRECUENCIA) return [muestras];

  const pedazos = [];
  const ventana = Math.round(0.05 * FRECUENCIA);
  let inicio = 0;
  while (muestras.length - inicio > maximo) {
    // Buscamos el tramo de 50 ms más silencioso entre los 18 y los 28 segundos.
    let mejorCorte = inicio + maximo;
    let menorEnergia = Infinity;
    for (let p = inicio + MIN_SEGUNDOS * FRECUENCIA; p + ventana <= inicio + maximo; p += ventana) {
      let energia = 0;
      for (let i = p; i < p + ventana; i++) energia += muestras[i] * muestras[i];
      if (energia < menorEnergia) {
        menorEnergia = energia;
        mejorCorte = p + Math.floor(ventana / 2);
      }
    }
    pedazos.push(muestras.subarray(inicio, mejorCorte));
    inicio = mejorCorte;
  }
  pedazos.push(muestras.subarray(inicio));
  return pedazos;
}

function esSilencio(muestras) {
  let suma = 0;
  for (let i = 0; i < muestras.length; i++) suma += muestras[i] * muestras[i];
  return Math.sqrt(suma / muestras.length) < 0.002;
}

function limpiar(texto) {
  const t = texto.trim();
  return ALUCINACIONES.some((patron) => patron.test(t)) ? '' : t;
}

async function transcribir(audio, { idioma = 'spanish', onProgreso, onParcial, onFallaGPU, signal } = {}) {
  if (!modeloCargado) throw new Error('El modelo no está cargado.');
  const pedazos = dividirAudio(audio.muestras);
  const textos = [];
  const segmentos = [];
  let desde = 0;
  onProgreso?.({ etapa: 'transcripcion', fraccion: 0 });

  for (let i = 0; i < pedazos.length; i++) {
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    const pedazo = pedazos[i];
    const duracion = pedazo.length / FRECUENCIA;
    if (!esSilencio(pedazo)) {
      // Copiamos el pedazo porque se transfiere al worker.
      let texto;
      try {
        const copia = pedazo.slice();
        ({ texto } = await pedir('transcribir', { audio: copia, idioma }, { transferir: [copia.buffer] }));
      } catch (error) {
        if (dispositivo !== 'webgpu') throw error;
        // La placa de video de algunos celulares se cuelga ("device lost"): seguimos con el
        // procesador desde este mismo pedazo, sin perder lo ya transcripto.
        console.warn('Falló WebGPU, sigo con WebAssembly.', error);
        onFallaGPU?.();
        reiniciarWorker();
        await preparar({ ...ultimaPreparacion, aceleracion: 'wasm' });
        const copia = pedazo.slice();
        ({ texto } = await pedir('transcribir', { audio: copia, idioma }, { transferir: [copia.buffer] }));
      }
      const limpio = limpiar(texto || '');
      if (limpio) {
        textos.push(limpio);
        segmentos.push({ desde, hasta: desde + duracion, texto: limpio });
        onParcial?.(textos.join(' '));
      }
    }
    desde += duracion;
    onProgreso?.({ etapa: 'transcripcion', fraccion: (i + 1) / pedazos.length });
  }
  return { texto: textos.join(' '), segmentos };
}

async function disponible() {
  return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';
}

/** ¿Qué modelos ya están descargados en este dispositivo? */
async function modelosDescargados() {
  const resultado = {};
  try {
    const cache = await caches.open('transformers-cache');
    const claves = (await cache.keys()).map((r) => r.url);
    for (const [id, m] of Object.entries(MODELOS)) {
      resultado[id] = claves.some((url) => url.includes(`${m.repo}/`) && url.includes('.onnx'));
    }
  } catch {
    // Sin Cache Storage no podemos saberlo.
  }
  return resultado;
}

async function borrarModelos() {
  await caches.delete('transformers-cache');
  if (worker) worker.terminate();
  worker = null;
  modeloCargado = null;
}

export const motorLocal = {
  id: 'local',
  nombre: 'En este dispositivo (Whisper)',
  descripcion: 'Gratis, privado y funciona sin internet una vez descargado el modelo.',
  modelos: MODELOS,
  disponible,
  preparar,
  transcribir,
  modelosDescargados,
  borrarModelos,
  info: () => ({ dispositivo, modelo: modeloCargado?.split('|')[0] }),
};
