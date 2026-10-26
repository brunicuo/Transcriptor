// Todo lo que la app guarda en el dispositivo.
// Ajustes: localStorage (son pocos datos). Historial y trabajos en curso: IndexedDB.

const CLAVE_AJUSTES = 'transcriptor.ajustes';
const MAX_HISTORIAL = 50;

const AJUSTES_INICIALES = {
  motor: 'local',
  modelo: 'base',
  idioma: 'spanish',
  clientId: '',
  carpetas: [], // [{ id, nombre, link, carpetaId }]
  carpetaActiva: null,
  autoGuardarDrive: true,
};

export function leerAjustes() {
  try {
    const guardados = JSON.parse(localStorage.getItem(CLAVE_AJUSTES) || '{}');
    return { ...AJUSTES_INICIALES, ...guardados };
  } catch {
    return { ...AJUSTES_INICIALES };
  }
}

export function guardarAjustes(cambios) {
  const ajustes = { ...leerAjustes(), ...cambios };
  try {
    localStorage.setItem(CLAVE_AJUSTES, JSON.stringify(ajustes));
  } catch {
    // Sin almacenamiento disponible (modo incógnito estricto): la app sigue andando.
  }
  return ajustes;
}

let dbPromesa = null;

function abrirDb() {
  if (!dbPromesa) {
    dbPromesa = new Promise((resolve, reject) => {
      // Versión 2: se agregó "trabajos" (transcripciones en curso, para poder retomarlas).
      const pedido = indexedDB.open('transcriptor', 2);
      pedido.onupgradeneeded = () => {
        const db = pedido.result;
        if (!db.objectStoreNames.contains('historial')) {
          const store = db.createObjectStore('historial', { keyPath: 'id', autoIncrement: true });
          store.createIndex('fecha', 'fecha');
        }
        if (!db.objectStoreNames.contains('trabajos')) {
          db.createObjectStore('trabajos', { keyPath: 'id', autoIncrement: true });
        }
      };
      pedido.onsuccess = () => resolve(pedido.result);
      pedido.onerror = () => reject(pedido.error);
      pedido.onblocked = () => reject(new Error('Cerrá las otras pestañas de Transcriptor y volvé a abrir la app.'));
    });
  }
  return dbPromesa;
}

async function operar(modo, accion, almacen = 'historial') {
  const db = await abrirDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(almacen, modo);
    const resultado = accion(tx.objectStore(almacen));
    tx.oncomplete = () => resolve(resultado?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('No se pudo guardar en el dispositivo.'));
  });
}

/*
 * Trabajos: cada transcripción se guarda acá (con su audio) mientras dura, y se
 * actualiza al terminar cada pedazo. Si el celular cierra la app a mitad de camino,
 * al volver se puede retomar desde el último pedazo.
 * { id, nombre, origen, drive, archivo: Blob, estado: 'pendiente' | 'en-curso',
 *   siguiente, total, textos: string[], creado }
 */
export async function guardarTrabajo(trabajo) {
  const datos = { ...trabajo };
  if (datos.id == null) delete datos.id;
  const id = await operar('readwrite', (store) => store.put(datos), 'trabajos');
  return { ...datos, id };
}

export async function listarTrabajos() {
  const todos = await operar('readonly', (store) => store.getAll(), 'trabajos');
  return (todos || []).sort((a, b) => a.creado - b.creado);
}

export async function borrarTrabajo(id) {
  if (id == null) return;
  await operar('readwrite', (store) => store.delete(id), 'trabajos');
}

/** Guarda una transcripción y devuelve la entrada con su id. */
export async function agregarAlHistorial(entrada) {
  const id = await operar('readwrite', (store) => store.add(entrada));
  await recortarHistorial();
  return { ...entrada, id };
}

export async function actualizarEnHistorial(entrada) {
  await operar('readwrite', (store) => store.put(entrada));
}

export async function listarHistorial() {
  const todas = await operar('readonly', (store) => store.getAll());
  return (todas || []).sort((a, b) => b.fecha - a.fecha);
}

export async function borrarDelHistorial(id) {
  await operar('readwrite', (store) => store.delete(id));
}

export async function borrarHistorial() {
  await operar('readwrite', (store) => store.clear());
}

async function recortarHistorial() {
  const todas = await listarHistorial();
  for (const vieja of todas.slice(MAX_HISTORIAL)) {
    await borrarDelHistorial(vieja.id);
  }
}
