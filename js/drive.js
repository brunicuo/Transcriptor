// Conexión con Google Drive desde el navegador (OAuth de Google + Drive API v3).
// No hay servidor: el permiso vive en este dispositivo y vence a la hora.
//
// El inicio de sesión se hace yendo a la página de Google y volviendo (redirección),
// sin ventana emergente: las ventanas emergentes de Google no funcionan con el
// aislamiento que necesita la app para transcribir con varios núcleos.

import { esAudio, nombreBase } from './util.js';

const PERMISO = 'https://www.googleapis.com/auth/drive';
const API = 'https://www.googleapis.com/drive/v3';
const API_SUBIDA = 'https://www.googleapis.com/upload/drive/v3';
const CLAVE_TOKEN = 'transcriptor.tokenDrive';
const CLAVE_PEDIDO = 'transcriptor.pedidoGoogle';

let token = null;
let vence = 0;

try {
  const guardado = JSON.parse(localStorage.getItem(CLAVE_TOKEN) || 'null');
  if (guardado && guardado.vence > Date.now()) ({ token, vence } = guardado);
} catch {
  // Sin almacenamiento: habrá que conectar de nuevo.
}

/** Dirección a la que Google devuelve al usuario. Hay que cargarla tal cual en Google Cloud. */
export function direccionDeRetorno() {
  return new URL('./', location.href).href.split('#')[0].split('?')[0];
}

export function estaConectado() {
  return Boolean(token) && Date.now() < vence - 60_000;
}

/**
 * Lleva al usuario a Google para dar permiso. Al volver, procesarRetornoDeGoogle()
 * guarda el permiso y devuelve "accion" para seguir con lo que estaba haciendo.
 */
export function conectar(clientId, accion = null) {
  if (!clientId) throw new Error('Falta el "ID de cliente de Google". Cargalo en Ajustes.');
  const estado = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(CLAVE_PEDIDO, JSON.stringify({ estado, accion, creado: Date.now() }));
  const parametros = new URLSearchParams({
    client_id: clientId,
    redirect_uri: direccionDeRetorno(),
    response_type: 'token',
    scope: PERMISO,
    include_granted_scopes: 'true',
    state: estado,
  });
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${parametros}`);
}

/**
 * Si la página se abrió volviendo de Google, guarda el permiso y limpia la dirección.
 * @returns {null | { accion: object | null } | { error: string }}
 */
export function procesarRetornoDeGoogle() {
  const fragmento = location.hash.slice(1);
  if (!/(^|&)(access_token|error)=/.test(fragmento)) return null;
  const datos = new URLSearchParams(fragmento);
  let pedido = null;
  try {
    pedido = JSON.parse(localStorage.getItem(CLAVE_PEDIDO) || 'null');
    localStorage.removeItem(CLAVE_PEDIDO);
  } catch {
    // sin datos del pedido
  }
  history.replaceState(null, '', `${location.pathname}${location.search}#drive`);

  if (!pedido || datos.get('state') !== pedido.estado) {
    return { error: 'La respuesta de Google no coincide con el pedido. Tocá "Conectar con Google" de nuevo.' };
  }
  const error = datos.get('error');
  if (error) {
    const mensajes = {
      access_denied: 'No diste permiso en Google (o tu cuenta no está como usuario de prueba).',
      invalid_request: 'Google rechazó el pedido. Revisá el ID de cliente y la dirección de retorno en Google Cloud.',
    };
    return { error: mensajes[error] || `Google respondió con un error: ${error}.` };
  }
  token = datos.get('access_token');
  vence = Date.now() + Number(datos.get('expires_in') || 3600) * 1000;
  try {
    localStorage.setItem(CLAVE_TOKEN, JSON.stringify({ token, vence }));
  } catch {
    // Si no se puede recordar, vale igual para esta sesión.
  }
  return { accion: pedido.accion || null };
}

export function desconectar() {
  if (token) {
    fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST', mode: 'no-cors' }).catch(() => {});
  }
  token = null;
  vence = 0;
  try {
    localStorage.removeItem(CLAVE_TOKEN);
  } catch {
    // nada
  }
}

function sesionVencida() {
  token = null;
  try {
    localStorage.removeItem(CLAVE_TOKEN);
  } catch {
    // nada
  }
  const error = new Error('La sesión de Google venció. Tocá "Conectar con Google".');
  error.sesionVencida = true;
  return error;
}

async function llamar(url, opciones = {}) {
  if (!estaConectado()) throw sesionVencida();
  const respuesta = await fetch(url, {
    ...opciones,
    headers: { ...(opciones.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (respuesta.status === 401) throw sesionVencida();
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
