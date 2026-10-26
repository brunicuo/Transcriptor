// Convierte cualquier audio (ogg, opus, mp3, m4a, amr...) en lo que necesita Whisper:
// una sola pista (mono) a 16.000 muestras por segundo.

export const FRECUENCIA = 16000;

/** @returns {Promise<{ muestras: Float32Array, duracion: number }>} */
export async function decodificarAudio(blob, { onRespaldo } = {}) {
  if (!blob || !blob.size) throw new Error('El archivo llegó vacío (0 bytes). Probá compartirlo o elegirlo de nuevo.');
  const datos = await blob.arrayBuffer();
  let muestras;
  try {
    muestras = await decodificarNativo(datos.slice(0));
  } catch (errorNativo) {
    // El navegador no lo pudo leer: probamos con FFmpeg, que entiende casi cualquier formato.
    console.warn('El navegador no pudo decodificar el audio, uso FFmpeg.', errorNativo);
    onRespaldo?.();
    try {
      const { convertirConFFmpeg } = await import('./ffmpeg.js');
      muestras = await convertirConFFmpeg(datos, FRECUENCIA);
    } catch (errorFFmpeg) {
      console.error('FFmpeg tampoco pudo leer el audio.', errorFFmpeg);
      const detalle = errorFFmpeg?.message || String(errorFFmpeg || '');
      throw new Error(`No se pudo leer el audio (${describirFormato(datos, blob)}). ${detalle}`.trim());
    }
  }
  if (!muestras.length || muestras.length < FRECUENCIA * 0.2) throw new Error('El audio está vacío o dura menos de un segundo.');
  return { muestras, duracion: muestras.length / FRECUENCIA };
}

async function decodificarNativo(datos) {
  // OfflineAudioContext decodifica y convierte a 16 kHz sin necesitar permiso de reproducción.
  const Contexto = self.OfflineAudioContext || self.webkitOfflineAudioContext;
  const contexto = new Contexto(1, 1, FRECUENCIA);
  const buffer = await new Promise((resolve, reject) => {
    // La forma con callbacks también funciona en Safari viejo.
    const promesa = contexto.decodeAudioData(datos, resolve, reject);
    promesa?.then?.(resolve, reject);
  });
  if (buffer.sampleRate !== FRECUENCIA) throw new Error(`Frecuencia inesperada: ${buffer.sampleRate}`);
  return aMono(buffer);
}

function aMono(buffer) {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const salida = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const canal = buffer.getChannelData(c);
    for (let i = 0; i < salida.length; i++) salida[i] += canal[i] / buffer.numberOfChannels;
  }
  return salida;
}

/** Describe el formato real del archivo mirando sus primeros bytes (para mensajes de error). */
function describirFormato(datos, blob) {
  const b = new Uint8Array(datos.slice(0, 16));
  const texto = String.fromCharCode(...b);
  let formato = 'formato desconocido';
  if (texto.startsWith('OggS')) formato = 'Ogg';
  else if (texto.startsWith('#!AMR')) formato = 'AMR';
  else if (texto.startsWith('ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) formato = 'MP3/AAC';
  else if (texto.slice(4, 8) === 'ftyp') formato = `MP4/M4A (${texto.slice(8, 12).trim()})`;
  else if (texto.startsWith('RIFF')) formato = 'WAV';
  else if (texto.startsWith('fLaC')) formato = 'FLAC';
  else if (texto.startsWith('caff')) formato = 'CAF';
  else if (b[0] === 0x1a && b[1] === 0x45) formato = 'WebM/MKV';
  else if (texto.startsWith('<') || texto.startsWith('{')) formato = 'no es un audio (parece texto o una página web)';
  const tipo = blob.type ? `, tipo ${blob.type}` : '';
  return `${formato}${tipo}, ${Math.round(blob.size / 1024)} KB`;
}
