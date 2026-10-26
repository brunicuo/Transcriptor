// Motor local: Whisper corriendo en el navegador con transformers.js.
// El trabajo pesado lo hace un Web Worker (whisperWorker.js) para no congelar la pantalla.

import { FRECUENCIA } from '../audio.js';

// Versión q8 de los modelos: es la que se probó (ver README) y anda bien en el procesador.
const MODELOS = {
  base: {
    nombre: 'Rápido (base)',
    descripcion: 'Descarga de 77 MB. Rápido; puede equivocarse en palabras poco comunes.',
    repo: 'Xenova/whisper-base',
  },
  small: {
    nombre: 'Preciso (small)',
    descripcion: 'Descarga de 250 MB. Se equivoca mucho menos, pero tarda unas tres veces más.',
    repo: 'Xenova/whisper-small',
  },
};
const ARCHIVOS_ONNX = ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
const CACHE_MODELOS = 'transformers-cache';

// Whisper trabaja con ventanas de 30 segundos: cortamos el audio en pedazos
// de hasta 28 s, buscando un silencio para no partir palabras.
const MAX_SEGUNDOS = 28;
const MIN_SEGUNDOS = 18;
// Para estimar el avance dentro de un pedazo: en el habla hay unos 14 caracteres por segundo.
const CARACTERES_POR_SEGUNDO = 14;

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
let hilos = null;
let forzarUnHilo = false;

function obtenerWorker() {
  if (!worker) {
    worker = new Worker(new URL('./whisperWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const pedido = pendientes.get(data.id);
      if (!pedido) return;
      if (data.tipo === 'progreso' || data.tipo === 'parcial') {
        pedido.onEvento?.(data);
        return;
      }
      pendientes.delete(data.id);
      if (data.tipo === 'error') pedido.reject(new Error(data.mensaje));
      else pedido.resolve(data);
    };
    worker.onerror = (evento) => {
      evento.preventDefault?.();
      reiniciarWorker(new Error(evento.message || 'El motor de transcripción se detuvo de golpe.'));
    };
  }
  return worker;
}

function pedir(tipo, datos, { onEvento, transferir = [] } = {}) {
  const id = ++contador;
  return new Promise((resolve, reject) => {
    pendientes.set(id, { resolve, reject, onEvento });
    obtenerWorker().postMessage({ id, tipo, ...datos }, transferir);
  });
}

/** Descarta el worker para empezar de cero (al cancelar, o si se trabó). */
function reiniciarWorker(motivo = new Error('Se reinició el motor.')) {
  worker?.terminate();
  worker = null;
  modeloCargado = null;
  cargando = null;
  for (const pedido of pendientes.values()) pedido.reject(motivo);
  pendientes.clear();
}

/** Cancelar corta en el acto, aunque el motor esté en medio de un cálculo largo. */
function cortarAlCancelar(signal) {
  if (!signal) return () => {};
  if (signal.aborted) throw new DOMException('Cancelado', 'AbortError');
  const cortar = () => reiniciarWorker(new DOMException('Cancelado', 'AbortError'));
  signal.addEventListener('abort', cortar, { once: true });
  return () => signal.removeEventListener('abort', cortar);
}

function esErrorDeRed(error) {
  return /fetch|network|load failed|Failed to download/i.test(error?.message || '');
}

async function cargarModelo(modelo, onProgreso) {
  if (modeloCargado === modelo) return;
  // Si ya se está cargando (por ejemplo, la precarga al abrir la app), esperamos esa misma carga.
  if (cargando) {
    if (cargando.modelo === modelo) {
      const enCurso = cargando;
      enCurso.oyentes.add(onProgreso);
      try {
        await enCurso.promesa;
        return;
      } finally {
        enCurso.oyentes.delete(onProgreso);
      }
    }
    await cargando.promesa.catch(() => {});
    if (modeloCargado === modelo) return;
  }

  // Sumamos el avance de todos los archivos del modelo para mostrar un solo porcentaje.
  const archivos = {};
  const oyentes = new Set([onProgreso]);
  const promesa = pedir('cargar', { modelo, repo: MODELOS[modelo].repo, hilos: forzarUnHilo ? 1 : undefined }, {
    onEvento: (dato) => {
      archivos[dato.archivo] = { cargado: dato.cargado || 0, total: dato.total || 0 };
      const lista = Object.values(archivos);
      const total = lista.reduce((s, a) => s + a.total, 0);
      const cargado = lista.reduce((s, a) => s + a.cargado, 0);
      for (const oyente of oyentes) oyente?.({ etapa: 'descarga', fraccion: total ? cargado / total : 0, cargado, total });
    },
  });
  const actual = { modelo, promesa, oyentes };
  cargando = actual;
  try {
    const respuesta = await promesa;
    hilos = respuesta.hilos;
    modeloCargado = modelo;
  } finally {
    if (cargando === actual) cargando = null;
  }
}

async function preparar({ modelo = 'base', onProgreso, signal } = {}) {
  const elegido = MODELOS[modelo] ? modelo : 'base';
  const soltar = cortarAlCancelar(signal);
  try {
    try {
      await cargarModelo(elegido, onProgreso);
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      if (esErrorDeRed(error)) {
        throw new Error('No se pudo descargar el modelo. Revisá la conexión a internet y probá de nuevo.');
      }
      if (forzarUnHilo) throw error;
      // Con varios núcleos el celular necesita más memoria: probamos de nuevo con uno solo.
      console.warn('Falló la carga del modelo, pruebo con un solo núcleo.', error);
      forzarUnHilo = true;
      reiniciarWorker();
      await cargarModelo(elegido, onProgreso);
    }
  } finally {
    soltar();
  }
}

/** Carga el modelo en segundo plano (si ya está descargado) para que la primera transcripción arranque antes. */
async function precargar(modelo = 'base') {
  const elegido = MODELOS[modelo] ? modelo : 'base';
  if (modeloCargado === elegido || cargando) return;
  const descargados = await modelosDescargados();
  if (!descargados[elegido] || modeloCargado === elegido || cargando) return;
  await cargarModelo(elegido).catch((error) => console.warn('No se pudo precargar el modelo', error));
}

export function dividirAudio(muestras) {
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

export function limpiarTexto(texto) {
  let t = texto.replace(/\s+/g, ' ').trim();
  if (ALUCINACIONES.some((patron) => patron.test(t))) return '';
  // Cuando se traba, Whisper repite la misma frase muchas veces seguidas: dejamos una.
  t = t.replace(/(\S.{5,80}?)(?:[\s,.]+\1){3,}/g, '$1');
  return t;
}

/**
 * @param {{ muestras: Float32Array }} audio
 * @param {{ idioma?: string, onProgreso?: Function, onParcial?: Function, onPedazo?: Function,
 *           signal?: AbortSignal, desde?: number, textosPrevios?: string[] }} opciones
 *   desde / textosPrevios: para retomar una transcripción interrumpida.
 *   onPedazo({ siguiente, total, textos }): se llama al terminar cada pedazo (para guardar el avance).
 */
async function transcribir(audio, opciones = {}) {
  if (!modeloCargado) throw new Error('El modelo no está cargado.');
  const soltar = cortarAlCancelar(opciones.signal);
  try {
    return await transcribirPedazos(audio, opciones);
  } finally {
    soltar();
  }
}

async function transcribirPedazos(audio, { idioma = 'spanish', onProgreso, onParcial, onPedazo, signal, desde = 0, textosPrevios = [] }) {
  const pedazos = dividirAudio(audio.muestras);
  const textos = [...textosPrevios];
  const total = pedazos.length;
  onParcial?.(textos.join(' '));
  onProgreso?.({ etapa: 'transcripcion', fraccion: desde / total, pedazo: desde, total });

  for (let i = desde; i < total; i++) {
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    const pedazo = pedazos[i];
    const duracion = pedazo.length / FRECUENCIA;
    if (!esSilencio(pedazo)) {
      let enCurso = '';
      const copia = pedazo.slice(); // se transfiere al worker
      const { texto } = await pedir('transcribir', { audio: copia, idioma }, {
        transferir: [copia.buffer],
        onEvento: (dato) => {
          enCurso += dato.texto;
          onParcial?.([...textos, enCurso.trim()].join(' ').trim());
          const dentro = Math.min(0.95, enCurso.length / (duracion * CARACTERES_POR_SEGUNDO));
          onProgreso?.({ etapa: 'transcripcion', fraccion: (i + dentro) / total, pedazo: i, total });
        },
      });
      const limpio = limpiarTexto(texto || '');
      if (limpio) textos.push(limpio);
    }
    onParcial?.(textos.join(' '));
    onProgreso?.({ etapa: 'transcripcion', fraccion: (i + 1) / total, pedazo: i + 1, total });
    await onPedazo?.({ siguiente: i + 1, total, textos: [...textos] });
  }
  return { texto: textos.join(' '), segmentos: [] };
}

async function disponible() {
  return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';
}

async function clavesDelCache() {
  try {
    const cache = await caches.open(CACHE_MODELOS);
    return { cache, claves: await cache.keys() };
  } catch {
    return { cache: null, claves: [] };
  }
}

/** ¿Qué modelos ya están descargados completos en este dispositivo? */
async function modelosDescargados() {
  const { claves } = await clavesDelCache();
  const urls = claves.map((r) => r.url);
  const resultado = {};
  for (const [id, m] of Object.entries(MODELOS)) {
    resultado[id] = ARCHIVOS_ONNX.every((archivo) => urls.some((url) => url.includes(`/${m.repo}/`) && url.endsWith(archivo)));
  }
  return resultado;
}

/**
 * Borra archivos de modelos que esta versión ya no usa (por ejemplo, los de la
 * placa de video de versiones anteriores), que pueden ocupar cientos de MB.
 */
async function limpiarArchivosViejos() {
  const { cache, claves } = await clavesDelCache();
  if (!cache) return 0;
  const enUso = Object.values(MODELOS).map((m) => `/${m.repo}/`);
  let borrados = 0;
  for (const pedido of claves) {
    const ajeno = !enUso.some((ruta) => pedido.url.includes(ruta));
    const onnxViejo = pedido.url.includes('/onnx/') && !ARCHIVOS_ONNX.some((a) => pedido.url.endsWith(a));
    if (ajeno || onnxViejo) {
      await cache.delete(pedido);
      borrados++;
    }
  }
  return borrados;
}

async function borrarModelos() {
  reiniciarWorker();
  await caches.delete(CACHE_MODELOS);
}

export const motorLocal = {
  id: 'local',
  nombre: 'En este dispositivo (Whisper)',
  descripcion: 'Gratis, privado y funciona sin internet una vez descargado el modelo.',
  modelos: MODELOS,
  disponible,
  preparar,
  precargar,
  transcribir,
  modelosDescargados,
  limpiarArchivosViejos,
  borrarModelos,
  info: () => ({ modelo: modeloCargado, hilos, cargando: Boolean(cargando) }),
};
