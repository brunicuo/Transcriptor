// Convierte cualquier audio (ogg, opus, mp3, m4a...) en lo que necesita Whisper:
// una sola pista (mono) a 16.000 muestras por segundo.

export const FRECUENCIA = 16000;

const DECODIFICADOR_OPUS = 'https://cdn.jsdelivr.net/npm/ogg-opus-decoder@1.7.5/+esm';

/** @returns {Promise<{ muestras: Float32Array, duracion: number }>} */
export async function decodificarAudio(blob) {
  const datos = await blob.arrayBuffer();
  let muestras;
  try {
    muestras = await decodificarNativo(datos.slice(0));
  } catch (errorNativo) {
    if (!esOgg(datos)) throw new Error('No se pudo leer el audio. Probá con otro formato (.ogg, .opus, .mp3 o .m4a).');
    // Algunos navegadores (por ejemplo Safari) no leen Ogg Opus: usamos un decodificador propio.
    muestras = await decodificarOpus(datos);
  }
  return { muestras, duracion: muestras.length / FRECUENCIA };
}

async function decodificarNativo(datos) {
  // OfflineAudioContext decodifica y convierte a 16 kHz sin necesitar permiso de reproducción.
  const contexto = new OfflineAudioContext(1, 1, FRECUENCIA);
  const buffer = await contexto.decodeAudioData(datos);
  return aMono(buffer);
}

function esOgg(datos) {
  const cabecera = new Uint8Array(datos, 0, 4);
  return String.fromCharCode(...cabecera) === 'OggS';
}

async function decodificarOpus(datos) {
  const { OggOpusDecoder } = await import(DECODIFICADOR_OPUS);
  const decodificador = new OggOpusDecoder();
  await decodificador.ready;
  try {
    const { channelData, sampleRate } = await decodificador.decodeFile(new Uint8Array(datos));
    if (!channelData.length || !channelData[0].length) throw new Error('El audio está vacío.');
    return remuestrear(mezclar(channelData), sampleRate);
  } finally {
    decodificador.free();
  }
}

function aMono(buffer) {
  const canales = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) canales.push(buffer.getChannelData(c));
  return mezclar(canales);
}

function mezclar(canales) {
  if (canales.length === 1) return canales[0];
  const salida = new Float32Array(canales[0].length);
  for (const canal of canales) {
    for (let i = 0; i < salida.length; i++) salida[i] += canal[i] / canales.length;
  }
  return salida;
}

async function remuestrear(muestras, frecuenciaOriginal) {
  if (frecuenciaOriginal === FRECUENCIA) return muestras;
  const largo = Math.ceil((muestras.length * FRECUENCIA) / frecuenciaOriginal);
  const contexto = new OfflineAudioContext(1, largo, FRECUENCIA);
  const buffer = contexto.createBuffer(1, muestras.length, frecuenciaOriginal);
  buffer.copyToChannel(muestras, 0);
  const fuente = contexto.createBufferSource();
  fuente.buffer = buffer;
  fuente.connect(contexto.destination);
  fuente.start();
  const resultado = await contexto.startRendering();
  return resultado.getChannelData(0);
}
