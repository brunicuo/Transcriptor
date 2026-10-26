// Funciones chicas que usan varias partes de la app.

export const EXTENSIONES_AUDIO = ['.ogg', '.opus', '.oga', '.mp3', '.m4a', '.aac', '.wav', '.webm'];

/** Saca el ID de carpeta de un link de Google Drive (o acepta el ID pelado). */
export function extraerIdCarpeta(texto) {
  const limpio = (texto || '').trim();
  const patrones = [
    /\/folders\/([a-zA-Z0-9_-]{10,})/,
    /[?&]id=([a-zA-Z0-9_-]{10,})/,
    /^([a-zA-Z0-9_-]{10,})$/,
  ];
  for (const patron of patrones) {
    const m = limpio.match(patron);
    if (m) return m[1];
  }
  return null;
}

export function nombreBase(nombre) {
  const i = nombre.lastIndexOf('.');
  return i > 0 ? nombre.slice(0, i) : nombre;
}

export function nombreTxt(nombre) {
  return `${nombreBase(nombre || 'transcripcion')}.txt`;
}

export function esAudio(nombre, tipo = '') {
  const n = (nombre || '').toLowerCase();
  return tipo.startsWith('audio/') || tipo === 'application/ogg' || EXTENSIONES_AUDIO.some((ext) => n.endsWith(ext));
}

export function formatearFecha(valor) {
  const fecha = new Date(valor);
  return fecha.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatearTamano(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatearDuracion(segundos) {
  const s = Math.round(segundos || 0);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function descargarTexto(texto, nombre) {
  const blob = new Blob([texto], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Respaldo para navegadores sin permiso de portapapeles.
    const area = document.createElement('textarea');
    area.value = texto;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export function escaparHtml(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
