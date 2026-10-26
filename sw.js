// Service worker: hace que la app funcione sin internet y recibe los audios
// que se comparten desde otras apps (Web Share Target).

const VERSION = 'v1';
const CACHE_APP = `transcriptor-app-${VERSION}`;
const CACHE_CDN = `transcriptor-cdn-${VERSION}`;

const ARCHIVOS_APP = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/util.js',
  './js/storage.js',
  './js/audio.js',
  './js/drive.js',
  './js/share.js',
  './js/engines/engine.js',
  './js/engines/whisperLocal.js',
  './js/engines/whisperWorker.js',
  './icons/icono.svg',
  './icons/icono-192.png',
  './icons/icono-512.png',
  './icons/icono-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(CACHE_APP).then((cache) => cache.addAll(ARCHIVOS_APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      // Borra versiones viejas de la app. Nunca toca los modelos ("transformers-cache").
      for (const nombre of await caches.keys()) {
        if (nombre.startsWith('transcriptor-') && nombre !== CACHE_APP && nombre !== CACHE_CDN) await caches.delete(nombre);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (evento) => {
  const { request } = evento;
  const url = new URL(request.url);

  if (request.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/compartir')) {
    evento.respondWith(recibirCompartido(request));
    return;
  }
  if (request.method !== 'GET') return;

  if (url.origin === self.location.origin) {
    evento.respondWith(desdeCacheYActualizar(request));
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    // Librerías con versión fija: si ya están guardadas, no cambian nunca.
    evento.respondWith(primeroCache(request));
  }
  // Google, Hugging Face y demás van directo a internet.
});

async function desdeCacheYActualizar(request) {
  const cache = await caches.open(CACHE_APP);
  const guardada = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
  const deRed = fetch(request)
    .then((respuesta) => {
      if (respuesta.ok) cache.put(request, respuesta.clone());
      return respuesta;
    })
    .catch(() => null);
  if (guardada) {
    // Actualiza en segundo plano para la próxima vez.
    deRed.catch(() => {});
    return guardada;
  }
  const respuesta = await deRed;
  return respuesta || (await cache.match('./index.html')) || Response.error();
}

async function primeroCache(request) {
  const cache = await caches.open(CACHE_CDN);
  const guardada = await cache.match(request);
  if (guardada) return guardada;
  const respuesta = await fetch(request);
  if (respuesta.ok) cache.put(request, respuesta.clone());
  return respuesta;
}

async function recibirCompartido(request) {
  try {
    const datos = await request.formData();
    const archivos = datos.getAll('audio').filter((a) => a && typeof a !== 'string' && a.size > 0);
    await guardarCompartidos(archivos);
  } catch (error) {
    console.error('No se pudo recibir el audio compartido', error);
  }
  return Response.redirect(new URL('./?compartido=1', self.registration.scope).href, 303);
}

function guardarCompartidos(archivos) {
  return new Promise((resolve, reject) => {
    const pedido = indexedDB.open('transcriptor-compartidos', 1);
    pedido.onupgradeneeded = () => pedido.result.createObjectStore('archivos', { keyPath: 'id', autoIncrement: true });
    pedido.onerror = () => reject(pedido.error);
    pedido.onsuccess = () => {
      const db = pedido.result;
      const tx = db.transaction('archivos', 'readwrite');
      for (const archivo of archivos) {
        tx.objectStore('archivos').add({
          archivo: new Blob([archivo], { type: archivo.type }),
          nombre: archivo.name || 'audio-compartido.ogg',
          tipo: archivo.type,
          fecha: Date.now(),
        });
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}
