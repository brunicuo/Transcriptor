// Punto de entrada: conecta la interfaz con el motor, Drive y el almacenamiento.

import { registrarMotor, obtenerMotor, listarMotores } from './engines/engine.js';
import { motorLocal } from './engines/whisperLocal.js';
import { decodificarAudio } from './audio.js';
import * as drive from './drive.js';
import { tomarCompartidos } from './share.js';
import { iniciarActualizaciones, buscarActualizacion, versionActual } from './actualizaciones.js';
import {
  leerAjustes, guardarAjustes, agregarAlHistorial, actualizarEnHistorial,
  listarHistorial, borrarDelHistorial, borrarHistorial,
  guardarTrabajo, listarTrabajos, borrarTrabajo,
} from './storage.js';
import {
  extraerIdCarpeta, nombreTxt, formatearFecha, formatearTamano, formatearDuracion,
  descargarTexto, copiarTexto, escaparHtml,
} from './util.js';

// Para sumar otro motor (por ejemplo, en la nube) se registra acá.
registrarMotor(motorLocal);

const $ = (id) => document.getElementById(id);
let ajustes = leerAjustes();

const ORIGENES = { archivo: 'Archivo', compartido: 'Compartido', drive: 'Drive' };

/* === Navegación === */

const VISTAS = ['inicio', 'transcripcion', 'drive', 'historial', 'ajustes'];

function mostrarVista(nombre) {
  const vista = VISTAS.includes(nombre) ? nombre : 'inicio';
  for (const seccion of document.querySelectorAll('.vista')) seccion.hidden = seccion.dataset.vista !== vista;
  for (const enlace of document.querySelectorAll('.navegacion a')) {
    const activa = enlace.dataset.vista === vista || (vista === 'transcripcion' && enlace.dataset.vista === 'inicio');
    enlace.classList.toggle('activa', activa);
    if (activa) enlace.setAttribute('aria-current', 'page');
    else enlace.removeAttribute('aria-current');
  }
  if (vista === 'drive') pintarVistaDrive();
  if (vista === 'historial') pintarHistorial();
  if (vista === 'ajustes') pintarAjustes();
  if (vista === 'inicio') {
    pintarEstadoMotor();
    pintarRetomar();
  }
  pintarTrabajoGlobal();
  window.scrollTo(0, 0);
}

function ir(nombre) {
  if (location.hash === `#${nombre}`) mostrarVista(nombre);
  else location.hash = nombre;
}

window.addEventListener('hashchange', () => mostrarVista(location.hash.slice(1)));

/* === Avisos === */

let temporizadorAviso;
function avisar(texto, ms = 3500) {
  const aviso = $('aviso');
  aviso.textContent = texto;
  aviso.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => (aviso.hidden = true), ms);
}

/* === Transcripción === */

let trabajo = null; // transcripción en curso
let actual = null; // entrada del historial que se ve en pantalla

function progreso(etapa, fraccion, nota = '') {
  if (!trabajo) return;
  Object.assign(trabajo, { etapa, fraccion, nota });
  const porcentaje = fraccion == null ? '' : `${Math.round(fraccion * 100)}%`;
  for (const [barra, texto, valor] of [
    ['progreso-barra', 'progreso-etapa', etapa],
    ['drive-progreso-barra', 'drive-progreso-texto', trabajo.etiquetaCola ? `${trabajo.etiquetaCola}: ${etapa.toLowerCase()}` : etapa],
  ]) {
    $(texto).textContent = valor;
    $(barra).style.width = fraccion == null ? '' : `${Math.round(fraccion * 100)}%`;
    $(barra).parentElement.classList.toggle('indeterminada', fraccion == null);
  }
  $('progreso-porcentaje').textContent = porcentaje;
  $('drive-progreso-porcentaje').textContent = porcentaje;
  $('progreso-nota').textContent = nota;
  pintarTrabajoGlobal();
}

// Barra fija que muestra la transcripción en curso desde cualquier pantalla.
function pintarTrabajoGlobal() {
  const vista = location.hash.slice(1);
  const visible = Boolean(trabajo) && vista !== (trabajo.mostrar ? 'transcripcion' : 'drive');
  $('trabajo-global').hidden = !visible;
  if (!visible) return;
  const { etapa, fraccion, nombre, etiquetaCola } = trabajo;
  $('global-etapa').textContent = `${etapa}${fraccion == null ? '' : ` ${Math.round(fraccion * 100)}%`}`;
  $('global-nombre').textContent = etiquetaCola ? `${etiquetaCola}: ${nombre}` : nombre;
  $('global-barra').style.width = fraccion == null ? '' : `${Math.round(fraccion * 100)}%`;
  $('global-barra').parentElement.classList.toggle('indeterminada', fraccion == null);
}

$('global-ver').addEventListener('click', () => {
  if (trabajo) ir(trabajo.mostrar ? 'transcripcion' : 'drive');
});
$('global-cancelar').addEventListener('click', () => {
  if (!trabajo) return;
  if (!trabajo.mostrar) colaCancelada = true;
  trabajo.controlador.abort();
});

let pantallaEncendida = null;
async function mantenerPantallaEncendida() {
  try {
    pantallaEncendida = await navigator.wakeLock?.request('screen');
  } catch {
    pantallaEncendida = null;
  }
}
document.addEventListener('visibilitychange', () => {
  if (trabajo && document.visibilityState === 'visible') mantenerPantallaEncendida();
});

function formatearSegundos(segundos) {
  const s = Math.max(1, Math.round(segundos));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

/** Texto bajo la barra: duración del audio, tramo y tiempo que falta (estimado). */
function notaDeTranscripcion(duracion, { fraccion, pedazo, total }, inicio, fraccionInicial) {
  const partes = [`Audio de ${formatearDuracion(duracion)}`];
  if (total > 1) partes.push(`tramo ${Math.min(pedazo + 1, total)} de ${total}`);
  const transcurrido = (Date.now() - inicio) / 1000;
  const avance = fraccion - fraccionInicial;
  if (avance > 0.04 && transcurrido > 4 && fraccion < 1) {
    partes.push(`faltan unos ${formatearSegundos((transcurrido / avance) * (1 - fraccion))}`);
  }
  return partes.join(', ');
}

function mostrarParcial(texto) {
  const area = $('texto-resultado');
  area.value = texto;
  area.scrollTop = area.scrollHeight;
}

/**
 * Transcribe un audio de punta a punta y lo guarda en el historial.
 * El audio y el avance se guardan en el dispositivo mientras dura, para poder
 * retomar si el celular cierra la app a mitad de camino.
 * @param {{ fuente?: () => Promise<Blob>, nombre: string, origen: string,
 *           drive?: { archivoId: string, carpetaId: string }, mostrar?: boolean,
 *           etiquetaCola?: string, guardado?: object }} pedido
 *   guardado: un trabajo de la base (audio compartido que espera, o uno interrumpido).
 */
async function transcribir({ fuente, nombre, origen, drive: datosDrive = null, mostrar = true, etiquetaCola = '', guardado = null }) {
  if (trabajo) throw new Error('Ya hay una transcripción en curso. Mirá su avance en la barra de arriba o cancelala ahí.');
  const controlador = new AbortController();
  const { signal } = controlador;
  trabajo = { nombre, controlador, etiquetaCola, mostrar, etapa: 'Preparando', fraccion: null, registroId: guardado?.id ?? null };
  const cancelado = () => {
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError');
  };

  if (mostrar) {
    prepararVistaTrabajo(nombre, origen);
    ir('transcripcion');
  }
  $('panel-progreso').hidden = !mostrar;
  mantenerPantallaEncendida();
  navigator.storage?.persist?.().catch(() => {});

  const motor = obtenerMotor(ajustes.motor);
  const modelo = ajustes.modelo;
  const descargados = (await motor.modelosDescargados?.()) || {};
  const etapaModelo = descargados[modelo] ? 'Cargando el modelo' : 'Descargando el modelo (solo la primera vez)';
  // El modelo se carga mientras se lee el audio, para ganar tiempo.
  let fase = 'audio';
  let ultimoModelo = { fraccion: null, cargado: 0, total: 0 };
  const notaModelo = ({ cargado, total }) => (total ? `${formatearTamano(cargado)} de ${formatearTamano(total)}` : '');
  const preparado = motor.preparar({
    modelo,
    signal,
    onProgreso: (dato) => {
      ultimoModelo = dato;
      if (fase === 'modelo') progreso(etapaModelo, dato.fraccion, notaModelo(dato));
    },
  });
  preparado.catch(() => {}); // el error se atiende más abajo, al esperarla

  let registro = guardado;
  try {
    progreso(origen === 'drive' && !guardado ? 'Bajando el audio de Drive' : 'Leyendo el audio', null);
    const blob = guardado?.archivo || (await fuente());
    cancelado();
    try {
      registro = await guardarTrabajo({
        siguiente: 0,
        textos: [],
        creado: Date.now(),
        ...(registro || {}),
        nombre,
        origen,
        drive: datosDrive,
        archivo: blob,
        estado: 'en-curso',
      });
      trabajo.registroId = registro.id;
    } catch (error) {
      // Sin espacio para guardar el avance: se transcribe igual, pero no se podrá retomar.
      console.warn('No se pudo guardar el trabajo para retomarlo', error);
      registro = null;
    }

    progreso('Preparando el audio', null);
    const audio = await decodificarAudio(blob, {
      onRespaldo: () => progreso('Preparando el audio (formato especial, la primera vez tarda más)', null),
    });
    cancelado();

    fase = 'modelo';
    if (motor.info?.().modelo !== modelo) progreso(etapaModelo, ultimoModelo.fraccion, notaModelo(ultimoModelo));
    await preparado;
    cancelado();

    fase = 'transcripcion';
    const desde = registro?.siguiente || 0;
    const inicio = Date.now();
    let fraccionInicial = null;
    if (mostrar && registro?.textos?.length) mostrarParcial(registro.textos.join(' '));
    const resultado = await motor.transcribir(
      { ...audio, archivo: blob, nombre },
      {
        idioma: ajustes.idioma || null,
        signal,
        desde,
        textosPrevios: registro?.textos || [],
        onProgreso: (dato) => {
          fraccionInicial ??= dato.fraccion;
          progreso('Transcribiendo', dato.fraccion, notaDeTranscripcion(audio.duracion, dato, inicio, fraccionInicial));
        },
        onParcial: (texto) => {
          if (mostrar) mostrarParcial(texto);
        },
        onPedazo: async ({ siguiente, total, textos }) => {
          if (!registro) return;
          registro = { ...registro, siguiente, total, textos };
          await guardarTrabajo(registro).catch(() => {});
        },
      },
    );

    let entrada = await agregarAlHistorial({
      nombre,
      texto: resultado.texto,
      fecha: Date.now(),
      origen,
      duracion: audio.duracion,
      motor: motor.id,
      modelo,
      drive: datosDrive,
    });
    await borrarTrabajo(registro?.id).catch(() => {});

    if (datosDrive && ajustes.autoGuardarDrive) {
      try {
        progreso('Guardando el .txt en Drive', null);
        await drive.guardarTxt(datosDrive.carpetaId, nombreTxt(nombre), entrada.texto);
        entrada = { ...entrada, guardadoEnDrive: true };
        await actualizarEnHistorial(entrada);
      } catch (error) {
        avisar(`La transcripción quedó en el historial, pero no se pudo guardar en Drive: ${error.message}`, 6000);
      }
    }

    if (mostrar) mostrarResultado(entrada);
    return entrada;
  } catch (error) {
    // Un error (o cancelar) descarta el trabajo guardado: solo se retoma si la app se cerró de golpe.
    await borrarTrabajo(registro?.id ?? trabajo?.registroId).catch(() => {});
    throw error;
  } finally {
    trabajo = null;
    pantallaEncendida?.release().catch(() => {});
    pantallaEncendida = null;
    $('panel-progreso').hidden = true;
    pintarTrabajoGlobal();
    pintarRetomar();
  }
}

function prepararVistaTrabajo(nombre, origen) {
  actual = null;
  $('trabajo-nombre').textContent = nombre;
  $('trabajo-detalle').textContent = ORIGENES[origen] || '';
  $('texto-resultado').value = '';
  $('texto-resultado').readOnly = true;
  $('acciones-resultado').hidden = true;
  $('boton-otro').hidden = true;
}

function mostrarResultado(entrada) {
  actual = entrada;
  $('trabajo-nombre').textContent = entrada.nombre;
  const partes = [ORIGENES[entrada.origen], formatearFecha(entrada.fecha)];
  if (entrada.duracion) partes.push(`audio de ${formatearDuracion(entrada.duracion)}`);
  if (entrada.guardadoEnDrive) partes.push('guardado en Drive');
  $('trabajo-detalle').textContent = partes.filter(Boolean).join(', ');
  $('texto-resultado').value = entrada.texto || '';
  $('texto-resultado').scrollTop = 0;
  $('texto-resultado').readOnly = false;
  if (!entrada.texto) $('texto-resultado').placeholder = 'No se detectó voz en este audio.';
  $('acciones-resultado').hidden = false;
  $('boton-guardar-drive').hidden = !entrada.drive;
  $('boton-otro').hidden = false;
}

function mensajeAmigable(error) {
  const mensaje = error?.message || String(error);
  if (/memory|memoria|allocation|OOM/i.test(mensaje)) {
    return 'El dispositivo se quedó sin memoria. Cerrá otras apps y probá de nuevo, o usá el modelo Rápido (Ajustes).';
  }
  if (/OrtRun|onnxruntime|session/i.test(mensaje)) {
    return 'El motor de transcripción falló. Probá de nuevo; si se repite, en Ajustes tocá "Borrar modelos descargados".';
  }
  return mensaje.length > 260 ? `${mensaje.slice(0, 260)}…` : mensaje;
}

function mostrarError(error) {
  if (error?.name === 'AbortError') {
    avisar('Transcripción cancelada.');
  } else {
    console.error(error);
    avisar(mensajeAmigable(error), 6000);
  }
  if (!actual) {
    $('trabajo-detalle').textContent = error?.name === 'AbortError' ? 'Cancelada.' : `No se pudo transcribir. ${mensajeAmigable(error)}`;
    $('boton-otro').hidden = false;
  }
}

async function transcribirArchivo(archivo, origen) {
  try {
    await transcribir({ fuente: async () => archivo, nombre: archivo.name || 'audio', origen });
  } catch (error) {
    mostrarError(error);
  }
}

$('entrada-archivo').addEventListener('change', (evento) => {
  const archivo = evento.target.files[0];
  evento.target.value = '';
  if (archivo) transcribirArchivo(archivo, 'archivo');
});

$('boton-cancelar').addEventListener('click', () => trabajo?.controlador.abort());
$('boton-otro').addEventListener('click', () => ir('inicio'));

$('boton-copiar').addEventListener('click', async () => {
  avisar((await copiarTexto($('texto-resultado').value)) ? 'Texto copiado.' : 'No se pudo copiar.');
});

$('boton-descargar').addEventListener('click', () => {
  descargarTexto($('texto-resultado').value, nombreTxt(actual?.nombre));
});

$('boton-guardar-drive').addEventListener('click', async (evento) => {
  if (!actual?.drive) return;
  const boton = evento.currentTarget;
  boton.disabled = true;
  try {
    if (!asegurarConexion({ tipo: 'guardar', id: actual.id, texto: $('texto-resultado').value })) return;
    await drive.guardarTxt(actual.drive.carpetaId, nombreTxt(actual.nombre), $('texto-resultado').value);
    actual = { ...actual, texto: $('texto-resultado').value, guardadoEnDrive: true };
    await actualizarEnHistorial(actual);
    avisar(`Guardado en Drive como ${nombreTxt(actual.nombre)}.`);
  } catch (error) {
    avisar(error.message, 6000);
  } finally {
    boton.disabled = false;
  }
});

// Si se corrige el texto a mano, se guarda en el historial.
let temporizadorEdicion;
$('texto-resultado').addEventListener('input', () => {
  if (!actual) return;
  clearTimeout(temporizadorEdicion);
  temporizadorEdicion = setTimeout(() => {
    actual = { ...actual, texto: $('texto-resultado').value };
    actualizarEnHistorial(actual).catch(() => {});
  }, 600);
});

/* === Inicio === */

// Para recibir audios compartidos, el service worker tiene que estar controlando la app.
function pintarEstadoCompartir() {
  const estado = $('estado-compartir');
  if (!('serviceWorker' in navigator)) {
    estado.textContent = 'Este navegador no puede recibir audios compartidos.';
    estado.className = 'chico estado-texto-error';
  } else if (navigator.serviceWorker.controller) {
    estado.textContent = 'Recepción de audios compartidos: lista.';
    estado.className = 'chico estado-texto-ok';
  } else {
    estado.textContent = 'Preparando la recepción de audios compartidos… Si este mensaje no cambia, cerrá la app del todo y volvé a abrirla.';
    estado.className = 'chico estado-texto-error';
  }
}
navigator.serviceWorker?.addEventListener('controllerchange', pintarEstadoCompartir);

async function pintarEstadoMotor() {
  pintarEstadoCompartir();
  const motor = obtenerMotor(ajustes.motor);
  const modelo = motor.modelos?.[ajustes.modelo];
  if (!modelo) {
    $('estado-motor').textContent = '';
    return;
  }
  const descargados = (await motor.modelosDescargados?.()) || {};
  const info = motor.info?.() || {};
  let estado;
  if (!descargados[ajustes.modelo]) estado = `se descarga en la primera transcripción. ${modelo.descripcion}`;
  else if (info.modelo === ajustes.modelo) estado = 'listo para transcribir.';
  else if (info.cargando) estado = 'cargando en segundo plano…';
  else estado = 'descargado, funciona sin internet.';
  $('estado-motor').textContent = `Modelo ${modelo.nombre}: ${estado}`;
}

/** Deja el modelo cargado en memoria apenas se abre la app, así la transcripción arranca antes. */
async function precargarModelo() {
  const motor = obtenerMotor(ajustes.motor);
  if (!motor.precargar || trabajo) return;
  const espera = motor.precargar(ajustes.modelo);
  pintarEstadoMotor();
  await espera;
  if (location.hash.slice(1) === 'inicio' || !location.hash) pintarEstadoMotor();
}

/* === Transcripciones sin terminar === */

// Si el celular cerró la app a mitad de una transcripción, se ofrece seguir desde donde quedó.
async function pintarRetomar() {
  const tarjeta = $('tarjeta-retomar');
  if (trabajo) {
    tarjeta.hidden = true;
    return;
  }
  const enCurso = (await listarTrabajos().catch(() => [])).find((t) => t.estado === 'en-curso');
  tarjeta.hidden = !enCurso;
  if (!enCurso) return;
  tarjeta.dataset.id = enCurso.id;
  const avance = enCurso.total ? `, iba por el ${Math.round((enCurso.siguiente / enCurso.total) * 100)}%` : '';
  $('retomar-texto').textContent = `"${enCurso.nombre}" quedó sin terminar${avance}.`;
}

async function retomarTrabajo(id) {
  const guardado = (await listarTrabajos()).find((t) => t.id === id);
  if (!guardado) return;
  try {
    await transcribir({ guardado, nombre: guardado.nombre, origen: guardado.origen, drive: guardado.drive || null });
  } catch (error) {
    mostrarError(error);
  }
}

$('retomar-continuar').addEventListener('click', () => retomarTrabajo(Number($('tarjeta-retomar').dataset.id)));
$('retomar-descartar').addEventListener('click', async () => {
  await borrarTrabajo(Number($('tarjeta-retomar').dataset.id));
  pintarRetomar();
});

$('boton-leer-drive').addEventListener('click', () => {
  ir('drive');
  leerDrive();
});

/* === Drive === */

let archivosDrive = [];
let carpetaListada = null;
let colaActiva = false;
let colaCancelada = false;

function carpetaElegida() {
  return ajustes.carpetas.find((c) => c.id === ajustes.carpetaActiva) || ajustes.carpetas[0] || null;
}

function pintarVistaDrive() {
  const selector = $('selector-carpeta');
  selector.innerHTML = ajustes.carpetas
    .map((c) => `<option value="${escaparHtml(c.id)}">${escaparHtml(c.nombre)}</option>`)
    .join('');
  const elegida = carpetaElegida();
  if (elegida) selector.value = elegida.id;
  const sinCarpetas = ajustes.carpetas.length === 0;
  selector.hidden = sinCarpetas;
  $('drive-sin-carpetas').hidden = !sinCarpetas;
  $('boton-listar').disabled = sinCarpetas || colaActiva;
  $('auto-guardar').checked = ajustes.autoGuardarDrive;
  pintarConexion();
  if (elegida && carpetaListada !== elegida.carpetaId) {
    archivosDrive = [];
    carpetaListada = null;
  }
  pintarListaDrive();
}

function pintarConexion() {
  const conectado = drive.estaConectado();
  $('boton-conectar').textContent = conectado ? 'Conectado a Google' : 'Conectar con Google';
  $('boton-conectar').disabled = conectado;
}

const ESTADOS = {
  hecho: ['Transcripto', 'estado-hecho'],
  pendiente: ['Pendiente', 'estado-pendiente'],
  'en-cola': ['En cola', 'estado-trabajando'],
  trabajando: ['Transcribiendo', 'estado-trabajando'],
  error: ['Error', 'estado-error'],
};

function pintarListaDrive() {
  const lista = $('lista-drive');
  if (!carpetaListada) {
    lista.innerHTML = '';
    $('drive-resumen').hidden = true;
    return;
  }
  if (!archivosDrive.length) {
    lista.innerHTML = '<li class="suave">No hay audios en esta carpeta.</li>';
    $('drive-resumen').hidden = true;
    return;
  }
  lista.innerHTML = archivosDrive
    .map((a, i) => {
      const [texto, clase] = ESTADOS[a.estado];
      const ocupado = a.estado === 'trabajando' || a.estado === 'en-cola';
      return `<li class="item">
        <div class="item-cabecera">
          <div>
            <div class="item-nombre">${escaparHtml(a.nombre)}</div>
            <div class="item-meta">${escaparHtml(formatearFecha(a.fecha))}, ${escaparHtml(formatearTamano(a.tamano))}</div>
          </div>
          <span class="etiqueta-estado ${clase}">${texto}</span>
        </div>
        ${a.error ? `<p class="item-meta">${escaparHtml(a.error)}</p>` : ''}
        <div class="item-acciones">
          <button class="boton ${a.estado === 'hecho' ? 'boton-texto' : 'boton-secundario'} boton-chico" type="button"
            data-indice="${i}" ${ocupado || colaActiva ? 'disabled' : ''}>
            ${a.estado === 'hecho' ? 'Transcribir de nuevo' : 'Transcribir'}
          </button>
        </div>
      </li>`;
    })
    .join('');

  const pendientes = archivosDrive.filter((a) => a.estado === 'pendiente' || a.estado === 'error').length;
  const hechos = archivosDrive.filter((a) => a.estado === 'hecho').length;
  $('drive-resumen').hidden = false;
  const faltan = archivosDrive.length - hechos;
  $('drive-contador').textContent = `${archivosDrive.length} audios: ${hechos} transcriptos, ${faltan} pendientes`;
  $('boton-pendientes').textContent = colaActiva
    ? 'Transcribiendo pendientes…'
    : pendientes ? `Transcribir pendientes (${pendientes})` : 'No hay pendientes';
  $('boton-pendientes').disabled = !pendientes || colaActiva;
}

/**
 * Si no hay permiso de Google, lleva a la página de Google y vuelve; "accion" dice qué
 * hacer al volver. Devuelve true si ya hay permiso y se puede seguir.
 */
function asegurarConexion(accion) {
  if (drive.estaConectado()) return true;
  if (trabajo) throw new Error('Esperá a que termine la transcripción en curso para conectar con Google.');
  drive.conectar(ajustes.clientId, accion);
  return false;
}

async function leerDrive() {
  const carpeta = carpetaElegida();
  if (!carpeta) {
    avisar('Primero agregá una carpeta de Drive en Ajustes.');
    return;
  }
  if (!ajustes.clientId) {
    avisar('Falta el ID de cliente de Google. Cargalo en Ajustes.', 5000);
    return;
  }
  $('boton-listar').disabled = true;
  try {
    if (!asegurarConexion({ tipo: 'leer' })) return;
    $('lista-drive').innerHTML = '<li class="suave">Leyendo la carpeta…</li>';
    const [audios, historial] = await Promise.all([drive.listarAudios(carpeta.carpetaId), listarHistorial()]);
    const enHistorial = new Set(historial.filter((h) => h.drive).map((h) => h.drive.archivoId));
    archivosDrive = audios.map((a) => ({ ...a, estado: a.tieneTxt || enHistorial.has(a.id) ? 'hecho' : 'pendiente' }));
    carpetaListada = carpeta.carpetaId;
  } catch (error) {
    $('lista-drive').innerHTML = '';
    avisar(error.message, 6000);
  } finally {
    $('boton-listar').disabled = colaActiva;
    pintarConexion();
    pintarListaDrive();
  }
}

async function transcribirDeDrive(archivo, { mostrar, etiquetaCola = '' }) {
  archivo.estado = 'trabajando';
  archivo.error = '';
  pintarListaDrive();
  try {
    await transcribir({
      fuente: () => drive.descargarArchivo(archivo.id),
      nombre: archivo.nombre,
      origen: 'drive',
      drive: { archivoId: archivo.id, carpetaId: carpetaListada },
      mostrar,
      etiquetaCola,
    });
    archivo.estado = 'hecho';
  } catch (error) {
    archivo.estado = error.name === 'AbortError' ? 'pendiente' : 'error';
    if (error.name !== 'AbortError') archivo.error = error.message;
    throw error;
  } finally {
    pintarListaDrive();
  }
}

$('lista-drive').addEventListener('click', async (evento) => {
  const boton = evento.target.closest('button[data-indice]');
  if (!boton) return;
  const archivo = archivosDrive[Number(boton.dataset.indice)];
  try {
    if (!asegurarConexion({ tipo: 'leer' })) return;
    await transcribirDeDrive(archivo, { mostrar: true });
  } catch (error) {
    mostrarError(error);
  }
});

$('boton-pendientes').addEventListener('click', async () => {
  const pendientes = archivosDrive.filter((a) => a.estado === 'pendiente' || a.estado === 'error');
  if (!pendientes.length || colaActiva) return;
  try {
    if (!asegurarConexion({ tipo: 'leer' })) return;
  } catch (error) {
    avisar(error.message, 6000);
    return;
  }
  colaActiva = true;
  colaCancelada = false;
  pendientes.forEach((a) => (a.estado = 'en-cola'));
  $('drive-progreso').hidden = false;
  $('boton-listar').disabled = true;
  let hechos = 0;
  for (const [i, archivo] of pendientes.entries()) {
    if (colaCancelada) {
      archivo.estado = 'pendiente';
      continue;
    }
    try {
      await transcribirDeDrive(archivo, { mostrar: false, etiquetaCola: `${i + 1} de ${pendientes.length}` });
      hechos++;
    } catch (error) {
      if (error.name === 'AbortError' || error.sesionVencida) colaCancelada = true;
      if (error.sesionVencida) avisar(error.message, 6000);
    }
  }
  colaActiva = false;
  $('drive-progreso').hidden = true;
  $('boton-listar').disabled = false;
  pintarListaDrive();
  avisar(colaCancelada ? `Se detuvo la cola. Transcriptos: ${hechos}.` : `Listo: ${hechos} de ${pendientes.length} transcriptos.`, 5000);
});

$('drive-cancelar').addEventListener('click', () => {
  colaCancelada = true;
  trabajo?.controlador.abort();
});

$('boton-listar').addEventListener('click', leerDrive);

$('boton-conectar').addEventListener('click', () => {
  try {
    if (asegurarConexion({ tipo: 'leer' })) avisar('Ya estás conectado a Google.');
  } catch (error) {
    avisar(error.message, 6000);
  }
});

$('selector-carpeta').addEventListener('change', (evento) => {
  ajustes = guardarAjustes({ carpetaActiva: evento.target.value });
  archivosDrive = [];
  carpetaListada = null;
  pintarListaDrive();
});

$('auto-guardar').addEventListener('change', (evento) => {
  ajustes = guardarAjustes({ autoGuardarDrive: evento.target.checked });
});

/* === Historial === */

let historialCache = [];

async function pintarHistorial() {
  historialCache = await listarHistorial();
  const filtro = $('buscar-historial').value.trim().toLowerCase();
  const visibles = historialCache.filter(
    (h) => !filtro || h.nombre.toLowerCase().includes(filtro) || (h.texto || '').toLowerCase().includes(filtro),
  );
  $('historial-vacio').hidden = historialCache.length > 0;
  $('boton-borrar-historial').hidden = historialCache.length === 0;
  $('lista-historial').innerHTML = visibles
    .map(
      (h) => `<li class="item item-clicable" data-id="${h.id}" data-accion="abrir">
        <div class="item-cabecera">
          <div>
            <div class="item-nombre">${escaparHtml(h.nombre)}</div>
            <div class="item-meta">${escaparHtml(formatearFecha(h.fecha))}, ${escaparHtml(ORIGENES[h.origen] || '')}${h.duracion ? `, ${formatearDuracion(h.duracion)}` : ''}</div>
          </div>
        </div>
        <p class="item-texto">${escaparHtml(h.texto || '(sin texto)')}</p>
        <div class="item-acciones">
          <button class="boton boton-secundario boton-chico" type="button" data-accion="copiar">Copiar</button>
          <button class="boton boton-secundario boton-chico" type="button" data-accion="descargar">Descargar .txt</button>
          <button class="boton boton-texto peligro boton-chico" type="button" data-accion="borrar">Borrar</button>
        </div>
      </li>`,
    )
    .join('');
}

$('buscar-historial').addEventListener('input', pintarHistorial);

$('lista-historial').addEventListener('click', async (evento) => {
  const item = evento.target.closest('[data-id]');
  if (!item) return;
  const entrada = historialCache.find((h) => h.id === Number(item.dataset.id));
  if (!entrada) return;
  const accion = evento.target.closest('[data-accion]')?.dataset.accion;
  if (accion === 'copiar') {
    avisar((await copiarTexto(entrada.texto)) ? 'Texto copiado.' : 'No se pudo copiar.');
  } else if (accion === 'descargar') {
    descargarTexto(entrada.texto, nombreTxt(entrada.nombre));
  } else if (accion === 'borrar') {
    if (confirm(`¿Borrar la transcripción de "${entrada.nombre}"?`)) {
      await borrarDelHistorial(entrada.id);
      pintarHistorial();
    }
  } else if (!trabajo) {
    mostrarResultado(entrada);
    ir('transcripcion');
  } else {
    avisar('Esperá a que termine la transcripción en curso.');
  }
});

$('boton-borrar-historial').addEventListener('click', async () => {
  if (confirm('¿Borrar todo el historial de transcripciones de este dispositivo?')) {
    await borrarHistorial();
    pintarHistorial();
  }
});

/* === Ajustes === */

function pintarAjustes() {
  pintarCarpetas();

  const motores = listarMotores();
  $('ajuste-motor').innerHTML = motores
    .map((m) => `<option value="${escaparHtml(m.id)}">${escaparHtml(m.nombre)}</option>`)
    .join('');
  $('ajuste-motor').value = obtenerMotor(ajustes.motor).id;
  $('ajuste-idioma').value = ajustes.idioma;
  $('ajuste-client-id').value = ajustes.clientId;
  pintarModelos();
  pintarInfoDispositivo();
}

async function pintarModelos() {
  const motor = obtenerMotor(ajustes.motor);
  $('motor-descripcion').textContent = motor.descripcion || '';
  const descargados = (await motor.modelosDescargados?.()) || {};
  $('opciones-modelo').innerHTML = Object.entries(motor.modelos || {})
    .map(
      ([id, m]) => `<label class="opcion">
        <input type="radio" name="modelo" value="${escaparHtml(id)}" ${ajustes.modelo === id ? 'checked' : ''}>
        <span><strong>${escaparHtml(m.nombre)}</strong>${descargados[id] ? ' (descargado)' : ''}
          <small>${escaparHtml(m.descripcion)}</small></span>
      </label>`,
    )
    .join('');
}

async function pintarInfoDispositivo() {
  $('version-app').textContent = `Versión ${versionActual()}`;
  const partes = [];
  const nucleos = self.crossOriginIsolated ? Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)) : 1;
  partes.push(
    self.crossOriginIsolated
      ? `Transcribe usando ${nucleos} núcleos del procesador.`
      : 'Transcribe usando 1 núcleo (cerrá y volvé a abrir la app para que use más).',
  );
  try {
    const { usage, quota } = await navigator.storage.estimate();
    partes.push(`Espacio usado por la app: ${formatearTamano(usage)} de ${formatearTamano(quota)} disponibles.`);
  } catch {
    // sin datos de espacio
  }
  $('info-dispositivo').textContent = partes.join(' ');
}

function pintarCarpetas() {
  const activa = carpetaElegida();
  $('lista-carpetas').innerHTML = ajustes.carpetas
    .map(
      (c) => `<li class="item ${activa?.id === c.id ? 'activa' : ''}" data-id="${escaparHtml(c.id)}">
        <div class="item-cabecera">
          <div>
            <div class="item-nombre">${escaparHtml(c.nombre)}</div>
            <div class="item-meta">ID: ${escaparHtml(c.carpetaId)}</div>
          </div>
          ${activa?.id === c.id ? '<span class="etiqueta-estado estado-hecho">En uso</span>' : ''}
        </div>
        <div class="item-acciones">
          ${activa?.id === c.id ? '' : '<button class="boton boton-secundario boton-chico" type="button" data-accion="usar">Usar esta</button>'}
          <button class="boton boton-texto boton-chico" type="button" data-accion="editar">Editar</button>
          <button class="boton boton-texto peligro boton-chico" type="button" data-accion="borrar">Borrar</button>
        </div>
      </li>`,
    )
    .join('');
}

function limpiarFormularioCarpeta() {
  $('carpeta-editando').value = '';
  $('carpeta-nombre').value = '';
  $('carpeta-link').value = '';
  $('carpeta-id').textContent = '';
  $('carpeta-guardar').textContent = 'Agregar carpeta';
  $('carpeta-cancelar').hidden = true;
}

$('lista-carpetas').addEventListener('click', (evento) => {
  const accion = evento.target.closest('[data-accion]')?.dataset.accion;
  const id = evento.target.closest('[data-id]')?.dataset.id;
  const carpeta = ajustes.carpetas.find((c) => c.id === id);
  if (!accion || !carpeta) return;
  if (accion === 'usar') {
    ajustes = guardarAjustes({ carpetaActiva: id });
  } else if (accion === 'editar') {
    $('carpeta-editando').value = id;
    $('carpeta-nombre').value = carpeta.nombre;
    $('carpeta-link').value = carpeta.link;
    $('carpeta-id').textContent = `ID detectado: ${carpeta.carpetaId}`;
    $('carpeta-guardar').textContent = 'Guardar cambios';
    $('carpeta-cancelar').hidden = false;
    $('carpeta-nombre').focus();
  } else if (accion === 'borrar') {
    if (!confirm(`¿Borrar la carpeta "${carpeta.nombre}" de la lista? (No se borra nada de Drive).`)) return;
    const carpetas = ajustes.carpetas.filter((c) => c.id !== id);
    ajustes = guardarAjustes({ carpetas, carpetaActiva: ajustes.carpetaActiva === id ? carpetas[0]?.id || null : ajustes.carpetaActiva });
  }
  pintarCarpetas();
});

$('carpeta-link').addEventListener('input', () => {
  const valor = $('carpeta-link').value;
  const id = extraerIdCarpeta(valor);
  $('carpeta-id').textContent = !valor ? '' : id ? `ID detectado: ${id}` : 'No reconozco ese link. Tiene que ser el de una carpeta de Drive.';
});

$('carpeta-cancelar').addEventListener('click', limpiarFormularioCarpeta);

$('form-carpeta').addEventListener('submit', (evento) => {
  evento.preventDefault();
  const nombre = $('carpeta-nombre').value.trim();
  const link = $('carpeta-link').value.trim();
  const carpetaId = extraerIdCarpeta(link);
  if (!carpetaId) {
    avisar('No reconozco ese link. Copiá el link de la carpeta desde Drive.', 5000);
    return;
  }
  const editando = $('carpeta-editando').value;
  let carpetas;
  if (editando) {
    carpetas = ajustes.carpetas.map((c) => (c.id === editando ? { ...c, nombre, link, carpetaId } : c));
  } else {
    const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    carpetas = [...ajustes.carpetas, { id, nombre, link, carpetaId }];
  }
  ajustes = guardarAjustes({ carpetas, carpetaActiva: ajustes.carpetaActiva || carpetas[0].id });
  carpetaListada = null;
  avisar(editando ? 'Carpeta actualizada.' : 'Carpeta agregada.');
  limpiarFormularioCarpeta();
  pintarCarpetas();
});

$('ajuste-motor').addEventListener('change', (evento) => {
  ajustes = guardarAjustes({ motor: evento.target.value });
  pintarModelos();
});

$('opciones-modelo').addEventListener('change', (evento) => {
  if (evento.target.name !== 'modelo') return;
  ajustes = guardarAjustes({ modelo: evento.target.value });
  precargarModelo();
});

$('ajuste-idioma').addEventListener('change', (evento) => {
  ajustes = guardarAjustes({ idioma: evento.target.value });
});

$('ajuste-client-id').addEventListener('change', (evento) => {
  ajustes = guardarAjustes({ clientId: evento.target.value.trim() });
  avisar('ID de cliente guardado.');
});

$('boton-desconectar').addEventListener('click', () => {
  drive.desconectar();
  avisar('Sesión de Google cerrada en este dispositivo.');
});

$('boton-buscar-actualizacion').addEventListener('click', async (evento) => {
  const boton = evento.currentTarget;
  boton.disabled = true;
  try {
    const hay = await buscarActualizacion({ forzar: true });
    avisar(hay ? 'Hay una versión nueva: tocá "Actualizar" en el cartel de arriba.' : 'Ya tenés la última versión.');
  } finally {
    boton.disabled = false;
  }
});

$('boton-borrar-modelos').addEventListener('click', async () => {
  if (trabajo) {
    avisar('Esperá a que termine la transcripción en curso.');
    return;
  }
  if (!confirm('¿Borrar los modelos descargados? Se vuelven a descargar en la próxima transcripción.')) return;
  await obtenerMotor(ajustes.motor).borrarModelos?.();
  avisar('Modelos borrados.');
  pintarModelos();
  pintarInfoDispositivo();
});

/* === Arranque === */

// Audios compartidos desde WhatsApp: se guardan como trabajos pendientes (así no se
// pierden si la app se cierra) y se transcriben uno detrás de otro.
async function recibirCompartidos(llegoCompartido) {
  let compartidos = [];
  try {
    compartidos = await tomarCompartidos();
  } catch (error) {
    console.error(error);
  }
  if (llegoCompartido) history.replaceState(null, '', `${location.pathname}#inicio`);
  for (const c of compartidos) {
    try {
      await guardarTrabajo({ nombre: c.nombre, origen: 'compartido', archivo: c.archivo, estado: 'pendiente', siguiente: 0, textos: [], creado: c.fecha || Date.now() });
    } catch (error) {
      console.warn('No se pudo guardar el audio compartido, lo transcribo directo', error);
      await transcribirArchivo(new File([c.archivo], c.nombre, { type: c.tipo || c.archivo.type }), 'compartido');
    }
  }
  if (!compartidos.length && llegoCompartido) avisar('No llegó ningún audio. Probá compartirlo de nuevo.', 5000);
}

async function procesarPendientes() {
  while (!trabajo) {
    const siguiente = (await listarTrabajos().catch(() => [])).find((t) => t.estado === 'pendiente');
    if (!siguiente) break;
    try {
      await transcribir({ guardado: siguiente, nombre: siguiente.nombre, origen: siguiente.origen, drive: siguiente.drive || null });
    } catch (error) {
      mostrarError(error);
    }
  }
}

// Al volver de la página de Google: guardar el permiso y seguir con lo que se estaba haciendo.
async function procesarVueltaDeGoogle() {
  const retorno = drive.procesarRetornoDeGoogle();
  if (!retorno) return;
  if (retorno.error) {
    ir('drive');
    avisar(retorno.error, 8000);
    return;
  }
  const accion = retorno.accion || { tipo: 'leer' };
  if (accion.tipo === 'guardar') {
    const entrada = (await listarHistorial()).find((h) => h.id === accion.id);
    if (entrada) {
      mostrarResultado({ ...entrada, texto: accion.texto ?? entrada.texto });
      ir('transcripcion');
      $('boton-guardar-drive').click();
      return;
    }
  }
  ir('drive');
  leerDrive();
}

// El script de index.html lo consulta antes de recargar la página.
Object.defineProperty(window, 'transcriptorOcupado', { get: () => Boolean(trabajo) || colaActiva });

iniciarActualizaciones({ puedeActualizar: () => !trabajo && !colaActiva, avisar });

const compartido = location.search.includes('compartido');
const volvioDeGoogle = /(^|[#&])(access_token|error)=/.test(location.hash);
if (!volvioDeGoogle) mostrarVista(compartido ? 'inicio' : location.hash.slice(1));

(async () => {
  if (volvioDeGoogle) await procesarVueltaDeGoogle();
  await recibirCompartidos(compartido);
  await pintarRetomar();
  // Libera espacio de archivos de modelos que esta versión ya no usa.
  obtenerMotor(ajustes.motor).limpiarArchivosViejos?.().catch(() => {});
  const hayPendientes = (await listarTrabajos().catch(() => [])).some((t) => t.estado === 'pendiente');
  if (hayPendientes) await procesarPendientes();
  else setTimeout(precargarModelo, 600);
})();
