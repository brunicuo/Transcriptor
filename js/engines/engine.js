// Registro de motores de transcripción.
//
// La interfaz nunca habla directo con Whisper: le pide un motor a este registro.
// Para sumar un motor nuevo (por ejemplo uno en la nube con GitHub Actions y
// faster-whisper) alcanza con crear un archivo en esta carpeta que cumpla el
// contrato de abajo y registrarlo en js/app.js.
//
// Contrato de un motor:
//
//   id: string                 identificador corto ('local', 'nube', ...)
//   nombre: string             lo que se muestra en Configuración
//   descripcion: string
//   modelos: { [id]: { nombre, descripcion } }   modelos que ofrece (puede estar vacío)
//
//   disponible(): Promise<boolean>
//     ¿Se puede usar en este dispositivo / con esta configuración?
//
//   preparar({ modelo, onProgreso }): Promise<void>
//     Deja el motor listo (descarga y carga el modelo, se conecta, etc.).
//     onProgreso({ etapa: 'descarga', fraccion: 0..1, detalle }) es opcional.
//
//   transcribir(audio, { idioma, onProgreso, onParcial, signal }): Promise<{ texto, segmentos }>
//     audio: { muestras: Float32Array (16 kHz mono), duracion: segundos, archivo: Blob, nombre }
//     idioma: nombre en inglés que entiende Whisper ('spanish') o null para detectar solo.
//     onProgreso({ etapa: 'transcripcion', fraccion: 0..1 })
//     onParcial(textoHastaAhora) para ir mostrando el resultado.
//     signal: AbortSignal para cancelar.
//
//   info(): object (opcional) datos para mostrar, por ejemplo la aceleración usada.

const motores = new Map();

export function registrarMotor(motor) {
  for (const clave of ['id', 'nombre', 'preparar', 'transcribir']) {
    if (!motor[clave]) throw new Error(`El motor no tiene "${clave}".`);
  }
  motores.set(motor.id, motor);
}

export function obtenerMotor(id) {
  return motores.get(id) || motores.values().next().value;
}

export function listarMotores() {
  return [...motores.values()];
}
