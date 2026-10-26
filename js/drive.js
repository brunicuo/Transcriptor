// Conexión con Google Drive desde el navegador (Google Identity Services + Drive API v3).
// No hay servidor: el permiso vive en este dispositivo y vence a la hora.

import { esAudio, nombreBase } from './util.js';

const PERMISO = 'https://www.googleapis.com/auth/drive';
const API = 'https://www.googleapis.com/drive/v3';
const API_SUBIDA = 'https://www.googleapis.com/upload/drive/v3';
const CLAVE_SESION = 'transcriptor.tokenDrive';

let token = null;
let vence = 0;
let clienteToken = null;
let clientIdActual = null;
let gisPromesa = null;

try {
  const guardado = JSON.parse(sessionStorage.getItem(CLAVE_SESION) || 'null');
  if (guardado && guardado.vence > Date.now()) ({ token, vence } = guardado);
} catch {
  // sessionStorage no disponible: habrá que conectar de nuevo.
}

/** Carga la librería de Google por adelantado para que el botón responda al instante. */
export function cargarGoogle() {
  if (!gisPromesa) {
    gisPromesa = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        gisPromesa = null;
        reject(new Error('No se pudo cargar el inicio de sesión de Google. Revisá la conexión.'));
      };
      document.head.appendChild(script);
    });
  }
  return gisPromesa;
}

export function estaConectado() {
  return Boolean(token) && Date.now() < vence - 60_000;
}

/** Pide permiso a Google. Tiene que llamarse desde un toque del usuario (abre una ventana). */
export async function conectar(clientId) {
  if (!clientId) throw new Error('Falta el "ID de cliente de Google". Cargalo en Configuración.');
  await cargarGoogle();
  if (!clienteToken || clientIdActual !== clientId) {
    clienteToken = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: PERMISO, callback: () => {} });
    clientIdActual = clientId;
  }
  return new Promise((resolve, reject) => {
    clienteToken.callback = (respuesta) => {
      if (respuesta.error) {
        reject(new Error(`Google no dio permiso (${respuesta.error}).`));
        return;
      }
      token = respuesta.access_token;
      vence = Date.now() + Number(respuesta.expires_in || 3600) * 1000;
      try {
        sessionStorage.setItem(CLAVE_SESION, JSON.stringify({ token, vence }));
      } catch {
        // No pasa nada si no se puede recordar.
      }
      resolve();
    };
    clienteToken.error_callback = (error) => {
      const mensajes = {
        popup_closed: 'Se cerró la ventana de Google antes de terminar.',
        popup_failed_to_open: 'El navegador bloqueó la ventana de Google. Permití las ventanas emergentes.',
      };
      reject(new Error(mensajes[error?.type] || 'No se pudo iniciar sesión con Google.'));
    };
    clienteToken.requestAccessToken({ prompt: '' });
  });
}

export function desconectar() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  token = null;
  vence = 0;
  try {
    sessionStorage.removeItem(CLAVE_SESION);
  } catch {
    // nada
  }
}

async function llamar(url, opciones = {}) {
  if (!estaConectado()) {
    const error = new Error('La sesión de Google venció. Tocá "Conectar con Google".');
    error.sesionVencida = true;
    throw error;
  }
  const respuesta = await fetch(url, {
    ...opciones,
    headers: { ...(opciones.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (respuesta.status === 401) {
    token = null;
    const error = new Error('La sesión de Google venció. Tocá "Conectar con Google".');
    error.sesionVencida = true;
    throw error;
  }
  if (!respuesta.ok) {
    let detalle = '';
    try {
      detalle = (await respuesta.json()).error?.message || '';
    } catch {
      // sin detalle
    }
    if (respuesta.status === 404) throw new Error('No se encontró la carpeta o el archivo. Revisá el link y que tu cuenta tenga acceso.');
    if (respuesta.status === 403) throw new Error(`Google rechazó el pedido. ${detalle}`);
    throw new Error(`Error de Drive (${respuesta.status}). ${detalle}`);
  }
  return respuesta;
}

function comillas(texto) {
  return texto.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function nombreDeCarpeta(carpetaId) {
  const r = await llamar(`${API}/files/${carpetaId}?fields=name&supportsAllDrives=true`);
  return (await r.json()).name;
}

/**
 * Lista los audios de una carpeta y marca cuáles ya tienen un .txt con el mismo nombre.
 * @returns {Promise<Array<{ id, nombre, tamano, fecha, tipo, tieneTxt }>>}
 */
export async function listarAudios(carpetaId) {
  const archivos = [];
  let pagina = '';
  do {
    const parametros = new URLSearchParams({
      q: `'${comillas(carpetaId)}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime)',
      pageSize: '1000',
      orderBy: 'modifiedTime desc',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (pagina) parametros.set('pageToken', pagina);
    const r = await llamar(`${API}/files?${parametros}`);
    const datos = await r.json();
    archivos.push(...(datos.files || []));
    pagina = datos.nextPageToken || '';
  } while (pagina);

  const txts = new Set(
    archivos.filter((a) => a.name.toLowerCase().endsWith('.txt')).map((a) => nombreBase(a.name).toLowerCase()),
  );
  return archivos
    .filter((a) => esAudio(a.name, a.mimeType))
    .map((a) => ({
      id: a.id,
      nombre: a.name,
      tamano: Number(a.size || 0),
      fecha: a.modifiedTime,
      tipo: a.mimeType,
      tieneTxt: txts.has(nombreBase(a.name).toLowerCase()),
    }));
}

export async function descargarArchivo(archivoId) {
  const r = await llamar(`${API}/files/${archivoId}?alt=media&supportsAllDrives=true`);
  return r.blob();
}

/** Crea el .txt en la carpeta, o lo reemplaza si ya existe uno con el mismo nombre. */
export async function guardarTxt(carpetaId, nombre, texto) {
  const parametros = new URLSearchParams({
    q: `name = '${comillas(nombre)}' and '${comillas(carpetaId)}' in parents and trashed = false`,
    fields: 'files(id)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const existentes = (await (await llamar(`${API}/files?${parametros}`)).json()).files || [];

  if (existentes.length) {
    await llamar(`${API_SUBIDA}/files/${existentes[0].id}?uploadType=media&supportsAllDrives=true`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
      body: texto,
    });
    return existentes[0].id;
  }

  const limite = `transcriptor${Date.now()}`;
  const metadatos = { name: nombre, parents: [carpetaId], mimeType: 'text/plain' };
  const cuerpo = new Blob([
    `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadatos)}\r\n`,
    `--${limite}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${texto}\r\n`,
    `--${limite}--`,
  ]);
  const r = await llamar(`${API_SUBIDA}/files?uploadType=multipart&supportsAllDrives=true&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${limite}` },
    body: cuerpo,
  });
  return (await r.json()).id;
}
