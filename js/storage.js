// Todo lo que la app guarda en el dispositivo.
// Ajustes: localStorage (son pocos datos). Historial: IndexedDB.

const CLAVE_AJUSTES = 'transcriptor.ajustes';
const MAX_HISTORIAL = 50;

const AJUSTES_INICIALES = {
  motor: 'local',
  modelo: 'base',
  aceleracion: 'auto', // 'auto' usa la placa de video si funciona; 'wasm' solo el procesador
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
      const pedido = indexedDB.open('transcriptor', 1);
      pedido.onupgradeneeded = () => {
        const db = pedido.result;
        if (!db.objectStoreNames.contains('historial')) {
          const store = db.createObjectStore('historial', { keyPath: 'id', autoIncrement: true });
          store.createIndex('fecha', 'fecha');
        }
      };
      pedido.onsuccess = () => resolve(pedido.result);
      pedido.onerror = () => reject(pedido.error);
    });
  }
  return dbPromesa;
}

async function operar(modo, accion) {
  const db = await abrirDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('historial', modo);
    const resultado = accion(tx.objectStore('historial'));
    tx.oncomplete = () => resolve(resultado?.result);
    tx.onerror = () => reject(tx.error);
  });
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
