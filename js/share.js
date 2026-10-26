// Audios que llegan desde el menú "Compartir" de Android (por ejemplo, desde WhatsApp).
// El service worker (sw.js) los guarda en esta base y la app los levanta al abrirse.

const BASE = 'transcriptor-compartidos';

function abrir() {
  return new Promise((resolve, reject) => {
    const pedido = indexedDB.open(BASE, 1);
    pedido.onupgradeneeded = () => pedido.result.createObjectStore('archivos', { keyPath: 'id', autoIncrement: true });
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error);
  });
}

/** Devuelve los audios compartidos pendientes y los saca de la base. */
export async function tomarCompartidos() {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('archivos', 'readwrite');
    const store = tx.objectStore('archivos');
    const pedido = store.getAll();
    pedido.onsuccess = () => store.clear();
    tx.oncomplete = () => {
      db.close();
      resolve(pedido.result || []);
    };
    tx.onerror = () => reject(tx.error);
  });
}
