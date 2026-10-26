// Actualizaciones de la app instalada: detecta una versión nueva publicada,
// avisa con un cartel y la aplica sin reinstalar (recarga la página una sola vez).

const CADA_CUANTO = 60 * 60 * 1000; // busca versiones nuevas cada una hora
const MINIMO_ENTRE_BUSQUEDAS = 5 * 60 * 1000;

let registro = null;
let ultimaBusqueda = 0;
let hayNueva = false;

/**
 * @param {{ puedeActualizar: () => boolean, avisar: (texto: string, ms?: number) => void }} opciones
 */
export async function iniciarActualizaciones({ puedeActualizar, avisar }) {
  if (!('serviceWorker' in navigator)) return;

  const banner = document.getElementById('banner-actualizacion');
  const texto = document.getElementById('texto-actualizacion');
  const boton = document.getElementById('boton-actualizar');
  let recargar = false;

  // Cuando la versión nueva toma el control, recargamos para usarla entera.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargar) location.reload();
  });

  const mostrar = async (trabajador) => {
    hayNueva = true;
    const version = await versionPublicada();
    texto.textContent = version ? `Hay una versión nueva (${version}).` : 'Hay una versión nueva.';
    banner.hidden = false;
    boton.onclick = () => {
      if (!puedeActualizar()) {
        avisar('Cuando termine la transcripción en curso, tocá "Actualizar".', 5000);
        return;
      }
      recargar = true;
      boton.disabled = true;
      boton.textContent = 'Actualizando…';
      trabajador.postMessage({ tipo: 'activar' });
    };
  };

  try {
    registro = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
  } catch (error) {
    console.warn('Sin service worker', error);
    return;
  }

  // Ya había una versión nueva esperando (por ejemplo, se descargó ayer).
  if (registro.waiting && navigator.serviceWorker.controller) mostrar(registro.waiting);

  registro.addEventListener('updatefound', () => {
    const nuevo = registro.installing;
    nuevo?.addEventListener('statechange', () => {
      // Si no había controlador es la primera instalación: no hay nada que actualizar.
      if (nuevo.state === 'installed' && navigator.serviceWorker.controller) mostrar(nuevo);
    });
  });

  // Una app instalada puede quedar abierta días: buscamos al volver a ella y cada tanto.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') buscarActualizacion();
  });
  setInterval(buscarActualizacion, CADA_CUANTO);
}

/** Pregunta al servidor si hay una versión nueva. Devuelve true si hay una lista para instalar. */
export async function buscarActualizacion({ forzar = false } = {}) {
  if (!registro) return false;
  if (!forzar && Date.now() - ultimaBusqueda < MINIMO_ENTRE_BUSQUEDAS) return hayNueva;
  ultimaBusqueda = Date.now();
  try {
    await registro.update();
  } catch {
    return hayNueva; // sin internet
  }
  if (registro.installing) {
    await new Promise((resolve) => {
      const nuevo = registro.installing;
      nuevo.addEventListener('statechange', () => {
        if (nuevo.state !== 'installing') resolve();
      });
    });
  }
  return hayNueva || Boolean(registro.waiting);
}

export function versionActual() {
  return self.VERSION_APP || '';
}

async function versionPublicada() {
  try {
    const respuesta = await fetch(`./version.js?consulta=${Date.now()}`, { cache: 'no-store' });
    return (await respuesta.text()).match(/VERSION_APP\s*=\s*['"]([^'"]+)['"]/)?.[1] || '';
  } catch {
    return '';
  }
}
