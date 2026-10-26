// Service worker: hace que la app funcione sin internet, recibe los audios que se
// comparten desde otras apps (Web Share Target) y habilita el uso de varios núcleos.

// La versión visible está en version.js. BUILD lo reemplaza el workflow de publicación
// por el código del commit, así cada publicación es una actualización aunque no se cambie
// el número de versión.
importScripts('./version.js');
const BUILD = 'dev';
const VERSION = `${self.VERSION_APP}-${BUILD}`;
const CACHE_APP = `transcriptor-app-${VERSION}`;
// Las librerías externas tienen versión fija en su dirección: su caché no depende de la app.
const CACHE_CDN = 'transcriptor-cdn';

const ARCHIVOS_APP = [
  './',
  './index.html',
  './manifest.webmanifest',
  './version.js',
  './css/app.css',
  './js/app.js',
  './js/util.js',
  './js/storage.js',
  './js/audio.js',
  './js/drive.js',
  './js/share.js',
  './js/actualizaciones.js',
  './js/ffmpeg.js',
  './js/vendor/ffmpeg/index.js',
  './js/vendor/ffmpeg/classes.js',
  './js/vendor/ffmpeg/worker.js',
  './js/vendor/ffmpeg/const.js',
  './js/vendor/ffmpeg/errors.js',
  './js/vendor/ffmpeg/types.js',
  './js/vendor/ffmpeg/utils.js',
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
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_APP);
      // Se guardan de a uno: si falla un archivo secundario, el service worker se instala
      // igual (sin él no se pueden recibir audios compartidos). cache: 'reload' evita
      // que el navegador use copias viejas guardadas por su cuenta.
      const resultados = await Promise.allSettled(
        ARCHIVOS_APP.map(async (url) => {
          const respuesta = await fetch(new Request(url, { cache: 'reload' }));
          if (!respuesta.ok) throw new Error(`${url}: ${respuesta.status}`);
          await cache.put(url, respuesta);
        }),
      );
      const fallidos = resultados.filter((r) => r.status === 'rejected').map((r) => r.reason?.message);
      if (fallidos.length) console.warn('No se guardaron para usar sin conexión:', fallidos);
      // Primera instalación: se activa enseguida. Si es una actualización, espera a que
      // el usuario toque "Actualizar" (así no se mezclan archivos de dos versiones).
      if (!self.registration.active) await self.skipWaiting();
    })(),
  );
});

self.addEventListener('message', (evento) => {
  if (evento.data?.tipo === 'activar') self.skipWaiting();
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
    evento.respondWith(desdeCacheDeLaVersion(request));
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    // Librerías con versión fija: si ya están guardadas, no cambian nunca.
    evento.respondWith(primeroCache(request));
  }
  // Google, Hugging Face y demás van directo a internet.
});

// Cada versión sirve sus propios archivos: la app nunca mezcla código viejo con nuevo.
async function desdeCacheDeLaVersion(request) {
  const cache = await caches.open(CACHE_APP);
  const guardada = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
  if (guardada) return conAislamiento(guardada);
  try {
    return conAislamiento(await fetch(request));
  } catch {
    if (request.mode === 'navigate') {
      const inicio = await cache.match('./');
      if (inicio) return conAislamiento(inicio);
    }
    return Response.error();
  }
}

// Cabeceras que "aíslan" la página (cross-origin isolation): con ellas el navegador deja
// transcribir usando varios núcleos del procesador. GitHub Pages no permite configurarlas,
// así que las agrega el service worker a todo lo que sirve del propio sitio.
function conAislamiento(respuesta) {
  if (!respuesta || respuesta.status === 0 || respuesta.type === 'opaqueredirect') return respuesta;
  const cabeceras = new Headers(respuesta.headers);
  cabeceras.set('Cross-Origin-Opener-Policy', 'same-origin');
  cabeceras.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return new Response(respuesta.body, { status: respuesta.status, statusText: respuesta.statusText, headers: cabeceras });
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
