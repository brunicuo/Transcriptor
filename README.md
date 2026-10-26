# Transcriptor

App para pasar audios a texto en español, gratis, que funciona en el celular y en la computadora con la misma dirección web.

* **Privada:** la transcripción se hace en tu propio dispositivo con Whisper (el modelo de reconocimiento de voz de OpenAI). Los audios no se suben a ningún servidor.
* **Desde WhatsApp:** compartís un audio y la app lo transcribe sola.
* **Desde Google Drive:** lista los audios de una carpeta, te muestra cuáles ya están transcriptos y guarda el .txt en la misma carpeta.
* **Sin conexión:** después de la primera vez, funciona sin internet (salvo lo de Drive).

Dirección de la app (cuando esté publicada): **https://brunicuo.github.io/Transcriptor/**

---

## Índice

1. [Publicar la app en GitHub Pages](#1-publicar-la-app-en-github-pages)
2. [Crear las credenciales de Google (para usar Drive)](#2-crear-las-credenciales-de-google-para-usar-drive)
3. [Instalar la app en Android](#3-instalar-la-app-en-android)
4. [Usarla en la computadora](#4-usarla-en-la-computadora)
5. [Cómo se usa](#5-cómo-se-usa)
6. [Problemas comunes](#6-problemas-comunes)
7. [Límites que conviene conocer](#7-límites-que-conviene-conocer)
8. [Para quien programe](#8-para-quien-programe)

---

## 1. Publicar la app en GitHub Pages

Esto se hace una sola vez.

1. Entrá al repositorio en GitHub: https://github.com/brunicuo/Transcriptor
2. Arriba, tocá **Settings** (Configuración).
3. En el menú de la izquierda, tocá **Pages**.
4. En **Build and deployment**, en el campo **Source**, elegí **GitHub Actions**.
5. Listo. Cada vez que haya cambios en la rama **main**, GitHub publica la app solo (tarda uno o dos minutos).
6. Para ver si se publicó: pestaña **Actions** del repositorio. Si el último trabajo "Publicar en GitHub Pages" tiene un tilde verde, ya está en línea.

> Si necesitás publicar a mano: pestaña **Actions**, elegí "Publicar en GitHub Pages" y tocá **Run workflow**.

---

## 2. Crear las credenciales de Google (para usar Drive)

Para que la app pueda leer tu carpeta de Drive, Google pide registrar la app y darle un "ID de cliente". Es gratis. Tarda unos 10 minutos y se hace una sola vez.

> Google cambia los nombres de los menús cada tanto. Si algo no coincide exactamente, buscá la opción más parecida.

### 2.1. Crear el proyecto

1. Entrá a https://console.cloud.google.com e iniciá sesión con tu cuenta de Google (la misma que tiene los audios en Drive).
2. Si es la primera vez, aceptá las condiciones.
3. Arriba a la izquierda, al lado del logo de Google Cloud, hay un selector de proyectos. Tocalo y después tocá **Proyecto nuevo**.
4. Nombre del proyecto: `Transcriptor`. Tocá **Crear**.
5. Esperá unos segundos y asegurate de que el proyecto **Transcriptor** quede seleccionado arriba.

### 2.2. Activar la API de Google Drive

1. En el buscador de arriba escribí **Google Drive API** y entrá al resultado.
2. Tocá **Habilitar** (Enable).

### 2.3. Configurar la pantalla de consentimiento (en modo prueba)

Es la pantalla que Google muestra cuando la app te pide permiso.

1. En el menú de la izquierda (las tres rayitas): **APIs y servicios** y después **Pantalla de consentimiento de OAuth**. (Puede aparecer como **Google Auth Platform**).
2. Tocá **Comenzar** (Get started).
3. **Información de la app:**
   * Nombre de la app: `Transcriptor`
   * Correo de asistencia: tu correo.
   * Tocá **Siguiente**.
4. **Público:** elegí **Externo** (External). Tocá **Siguiente**.
5. **Información de contacto:** tu correo. Tocá **Siguiente**.
6. Aceptá la política de datos de usuario y tocá **Crear**.

### 2.4. Agregar tu cuenta como usuario de prueba

Mientras la app está "en prueba", solo las cuentas que agregues acá pueden usarla. No hace falta que Google la revise.

1. En el menú de la izquierda, entrá a **Público** (Audience).
2. Fijate que el estado de publicación diga **Prueba** (Testing). No toques "Publicar app".
3. En **Usuarios de prueba**, tocá **Agregar usuarios** (Add users).
4. Escribí tu correo de Gmail (el de los audios) y tocá **Guardar**.

### 2.5. (Recomendado) Declarar el permiso de Drive

1. En el menú de la izquierda, entrá a **Acceso a los datos** (Data access).
2. Tocá **Agregar o quitar permisos** (Add or remove scopes).
3. En el cuadro "Agregar permisos manualmente" pegá: `https://www.googleapis.com/auth/drive`
4. Tocá **Agregar a la tabla**, después **Actualizar** y por último **Guardar**.

> La app pide acceso completo a Drive porque necesita leer audios que vos subiste (no los creó ella) y guardar el .txt en la misma carpeta. Ese permiso queda solo en tu dispositivo y solo lo usan tus cuentas de prueba.

### 2.6. Crear el cliente OAuth (el "ID de cliente")

1. En el menú de la izquierda, entrá a **Clientes** (Clients). También se llega desde **APIs y servicios** y luego **Credenciales**, con **Crear credenciales** y **ID de cliente de OAuth**.
2. Tocá **Crear cliente**.
3. Tipo de aplicación: **Aplicación web**.
4. Nombre: `Transcriptor web`.
5. En **Orígenes autorizados de JavaScript** tocá **Agregar URI** y pegá exactamente:

   ```
   https://brunicuo.github.io
   ```

   (Sin barra al final y sin `/Transcriptor`).
6. **URIs de redireccionamiento autorizados:** dejalo vacío.
7. Tocá **Crear**.
8. Aparece una ventana con el **ID de cliente**: algo como `123456789012-abcdefg.apps.googleusercontent.com`. Copialo.

> No hace falta el "secreto del cliente". La app no lo usa y no hay que pegarlo en ningún lado.

### 2.7. Pegar el ID en la app

1. Abrí la app y andá a **Ajustes**.
2. En **Cuenta de Google**, pegá el ID de cliente en el campo **ID de cliente de Google (OAuth)**.
3. Se guarda solo en ese dispositivo. Si usás la app en el celular y en la compu, pegalo en los dos.

### 2.8. La primera vez que te conectes

Cuando toques **Conectar con Google** o **Leer Drive**:

1. Elegí tu cuenta.
2. Google va a decir **"Google no verificó esta app"**. Es normal: la app es tuya y está en prueba. Tocá **Continuar**.
3. Marcá la casilla del permiso de Google Drive y tocá **Continuar**.

> En modo prueba, Google pide volver a dar permiso cada tanto (el acceso dura una hora por vez y la autorización puede vencer a los 7 días). Cuando pase, solo tocá **Conectar con Google** de nuevo.

---

## 3. Instalar la app en Android

1. Abrí **Chrome** en el celular.
2. Entrá a **https://brunicuo.github.io/Transcriptor/**
3. Tocá el menú de los tres puntitos (arriba a la derecha).
4. Tocá **Instalar app** (o **Agregar a la pantalla principal** y después **Instalar**).
5. Confirmá. Aparece el ícono de **Transcriptor** junto a tus otras apps.

### Compartir un audio desde WhatsApp

1. En un chat de WhatsApp, **mantené apretado** el audio.
2. Tocá el ícono de **Compartir** (arriba).
3. En la lista de apps, elegí **Transcriptor**.
4. La app se abre y empieza a transcribir sola.

> Si **Transcriptor** no aparece en la lista: abrí la app instalada una vez, cerrala y probá de nuevo. Si sigue sin aparecer, reiniciá el celular. Esta función solo existe en Android (con Chrome, Edge o Samsung Internet) y con la app instalada.

---

## 4. Usarla en la computadora

1. Abrí **https://brunicuo.github.io/Transcriptor/** en Chrome o Edge (los más rápidos, porque usan la placa de video).
2. Opcional: para tenerla como programa, tocá el ícono de **Instalar** que aparece a la derecha de la barra de direcciones.

---

## 5. Cómo se usa

### Primera vez

* La primera transcripción **descarga el modelo** de reconocimiento de voz. Conviene hacerla con wifi:
  * **Rápido (base):** entre 80 y 150 MB. Ideal para audios de WhatsApp.
  * **Preciso (small):** entre 250 y 450 MB. Más lento, se equivoca menos.
* Se descarga **una sola vez** y queda guardado. Después funciona sin internet.
* El modelo se elige en **Ajustes** y después **Modelo**.

### Transcribir

* **Elegir audio:** tocás el botón y elegís un archivo (.ogg, .opus, .mp3 o .m4a).
* **Compartir desde WhatsApp:** ver la sección 3.
* **Leer Drive:** ver más abajo.

Mientras transcribe vas a ver una barra de progreso, y el texto aparece de a poco. **No bloquees el celular ni cambies de app** mientras transcribe: Android puede frenar el proceso. (La app intenta mantener la pantalla encendida).

### El resultado

* Podés **corregir el texto** a mano. Los cambios se guardan en el historial.
* **Copiar:** copia todo el texto.
* **Descargar .txt:** baja un archivo con el mismo nombre del audio (por ejemplo `audio123.ogg` da `audio123.txt`).
* **Guardar en Drive:** aparece cuando el audio vino de Drive. Guarda el .txt en la misma carpeta (si ya existía, lo reemplaza).

### Carpetas de Drive

1. En Drive, abrí la carpeta con los audios y copiá el link (desde **Compartir** y luego **Copiar vínculo**, o desde la barra de direcciones).
2. En la app: **Ajustes**, sección **Carpetas de Drive**. Poné un nombre, pegá el link y tocá **Agregar carpeta**. La app muestra el ID que detectó.
3. Podés guardar varias, editarlas o borrarlas, y elegir cuál usar con **Usar esta**.

### Leer Drive

1. Tocá **Leer Drive**.
2. La app lista los audios de la carpeta elegida:
   * **Transcripto:** ya hay un .txt con el mismo nombre en la carpeta, o ya lo transcribiste en este dispositivo.
   * **Pendiente:** todavía no.
3. Tocá **Transcribir** en uno, o **Transcribir pendientes** para hacer todos, uno detrás de otro.
4. Con la opción **Guardar el .txt en la carpeta de Drive al terminar** activada, cada transcripción se guarda sola en Drive.

### Actualizaciones

No hace falta desinstalar ni volver a instalar. Cuando hay una versión nueva, la app la descarga sola y muestra arriba el cartel **"Hay una versión nueva"**. Tocá **Actualizar** y listo: la app se recarga con la versión nueva y conservás el historial, las carpetas, los ajustes y el modelo descargado.

* La app busca novedades al abrirla, al volver a ella y cada una hora. También podés tocar **Ajustes** y después **Buscar actualizaciones**.
* Si está transcribiendo, el cartel espera a que termine.
* La versión que tenés instalada aparece en **Ajustes**, en la sección **Este dispositivo**.
* Si cambia el ícono o el nombre de la app, Android lo actualiza solo (puede tardar hasta un día).

### Historial

Guarda las últimas 50 transcripciones **en este dispositivo** (solo el texto, no los audios). Se puede buscar, copiar, descargar y borrar.

---

## 6. Problemas comunes

| Problema | Qué hacer |
| --- | --- |
| "No se pudo descargar el modelo" | Revisá la conexión. La primera descarga es grande: usá wifi. |
| Tarda mucho | Usá el modelo **Rápido**. En celulares sin WebGPU, un audio de 1 minuto puede tardar un par de minutos. |
| "La sesión de Google venció" | Tocá **Conectar con Google** de nuevo. |
| "Error 400: redirect_uri_mismatch" o "origin_mismatch" | Revisá el paso 2.6: el origen tiene que ser exactamente `https://brunicuo.github.io`. |
| "Acceso bloqueado: la app no completó el proceso de verificación" | Tu correo no está como usuario de prueba. Revisá el paso 2.4. |
| "No se encontró la carpeta" | Revisá el link y que la carpeta sea de la misma cuenta con la que te conectaste (o que esté compartida con ella). |
| El celular se quedó sin espacio | **Ajustes** y después **Borrar modelos descargados**. Se vuelven a bajar cuando haga falta. |
| Transcriptor no aparece en "Compartir" | Ver la nota de la sección 3. |
| El texto inventa frases raras en silencios | Pasa a veces con Whisper. La app filtra las más comunes; si aparece otra, borrala a mano. |

---

## 7. Límites que conviene conocer

* **Español argentino:** Whisper reconoce "español" en general, no tiene una opción específica para el rioplatense. Igual entiende bien el voseo y los modismos; el modelo **Preciso** los maneja mejor.
* **iPhone:** la app funciona (subir archivo y Drive), pero iOS no permite que aparezca en el menú "Compartir".
* **Audios largos:** se pueden transcribir, pero en el celular llevan tiempo. Para audios de más de 10 o 15 minutos conviene la computadora. Más adelante se puede sumar un motor en la nube (ver abajo).
* Todo lo que guarda la app (ajustes, carpetas, historial y modelos) queda **solo en ese dispositivo y ese navegador**. Si borrás los datos del navegador, se pierde.

---

## 8. Para quien programe

Sin compilación ni dependencias: HTML, CSS y JavaScript con módulos ES. Las librerías se cargan desde jsDelivr con versión fija y el service worker las guarda.

```
index.html               interfaz (vistas: inicio, transcripción, drive, historial, ajustes)
manifest.webmanifest     instalación y share_target (recibe audios de otras apps)
sw.js                    caché por versión, actualizaciones y recepción de audios compartidos
version.js               número de versión de la app
css/app.css
js/app.js                conecta la interfaz con todo lo demás
js/audio.js              decodifica a 16 kHz mono (nativo; ogg-opus-decoder como respaldo)
js/drive.js              Google Identity Services + Drive API v3
js/share.js              toma los audios que dejó el service worker
js/actualizaciones.js    detecta versiones nuevas y muestra el cartel "Actualizar"
js/storage.js            ajustes (localStorage) e historial (IndexedDB)
js/util.js
js/engines/engine.js     contrato y registro de motores
js/engines/whisperLocal.js   motor local (divide el audio en tramos de hasta 28 s)
js/engines/whisperWorker.js  transformers.js en un Web Worker (WebGPU o WebAssembly)
.github/workflows/pages.yml  publicación en GitHub Pages
```

**Probar en la compu:** desde la carpeta del repo, `python3 -m http.server 8080` y abrir http://localhost:8080 (para Drive, agregá `http://localhost:8080` como origen autorizado en el cliente OAuth).

**Agregar un motor nuevo** (por ejemplo, en la nube con GitHub Actions y faster-whisper): crear un archivo en `js/engines/` que cumpla el contrato descripto en `js/engines/engine.js` y registrarlo en `js/app.js` con `registrarMotor(...)`. Aparece solo en **Ajustes** y después **Motor**.

**Publicar una versión nueva:**

1. Hacé los cambios.
2. Subí el número en `version.js` (por ejemplo `1.0.0` a `1.0.1` para arreglos, `1.1.0` para funciones nuevas). Es el número que se ve en Ajustes y en el cartel de actualización.
3. Llevá los cambios a `main`. GitHub publica solo.

Cada publicación lleva además el código del commit dentro de `sw.js` (lo agrega el workflow), así que aunque te olvides de subir el número, los dispositivos igual reciben la actualización.

Cómo funciona por dentro: el service worker guarda cada versión completa en su propia caché (`transcriptor-app-VERSION-COMMIT`). La versión nueva se descarga en segundo plano y espera; cuando el usuario toca **Actualizar**, toma el control, la página se recarga una vez y se borra la caché vieja. Los modelos de Whisper, el historial, las carpetas y los ajustes no se tocan. Si cambian datos guardados en una versión futura, los ajustes nuevos toman valores por defecto (`AJUSTES_INICIALES` en `js/storage.js`) y el historial se migra subiendo la versión de IndexedDB en `abrirDb()`.

**Privacidad del repo:** el `.gitignore` bloquea audios (.ogg, .opus, .mp3, .m4a, etc.) y transcripciones (.txt, .srt, .vtt) para que nunca se suban por error.
