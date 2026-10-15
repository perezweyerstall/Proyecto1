# Escucha

Lector de texto a voz inspirado en Speechify. Sigue las líneas de diseño de Google: Material Design 3.

Escucha convierte cualquier texto en audio. Resalta la frase y la palabra que suenan. Recuerda dónde te quedaste en cada documento.

## Funciones

- **Lectura sincronizada.** La frase actual se resalta. La palabra que suena se marca con el color principal.
- **Control de reproducción.** Reproducir, pausar, frase anterior y frase siguiente. Toca una frase para saltar a ella.
- **Velocidad.** De 0,5× a 3,5×, con atajos frecuentes y estimación de palabras por minuto.
- **Voz natural de Google.** Una voz Chirp 3 HD en español latino, igual en todos los dispositivos. Nunca supera el uso gratuito mensual.
- **Voces del dispositivo.** Alternativa sin servidor: voces del sistema con búsqueda y vista previa.
- **Importación.** Texto pegado, PDF, EPUB, Word (DOCX), TXT, Markdown y HTML. También arrastrar y soltar.
- **Biblioteca.** Búsqueda, filtros por tipo, progreso por documento, cambio de nombre y borrado.
- **Inicio.** Continuar escuchando, acciones rápidas y estadísticas: palabras de hoy, racha y tiempo escuchado.
- **Minirreproductor.** La lectura continúa al cambiar de pantalla.
- **Atajos de teclado.** Espacio o K: reproducir y pausar. ← → o J L: cambiar de frase. + −: velocidad.
- **Controles del sistema.** Media Session para auriculares, teclas multimedia y pantalla de bloqueo.
- **Uso sin conexión.** Service worker y manifiesto de aplicación web instalable.
- **Privacidad.** Los documentos se guardan solo en el navegador (IndexedDB).

## Diseño Material 3

- **Color dinámico.** Esquema `SchemeVibrant` de `@material/material-color-utilities`. Con la semilla azul se aproxima a la paleta de las apps de Google.
- **Temas.** Claro, oscuro o del sistema. Seis colores de acento y un selector libre.
- **Tipografía.** Google Sans Flex con la escala tipográfica de M3.
- **Iconos.** Material Symbols Rounded, incrustados como SVG.
- **Componentes.** Barra y riel de navegación, FAB, tarjetas, chips, deslizador M3, interruptor, botones segmentados, diálogos, hojas inferiores, menús y avisos.
- **Movimiento.** Curvas enfatizadas, capas de estado, ondas y formas que cambian al pulsar (M3 Expressive).
- **Diseño adaptable.** Barra de navegación en móvil. Riel de navegación desde 600 px.

## Requisitos

- Node.js 22 o superior.
- Un navegador con Web Speech API: Chrome, Edge, Safari o Firefox actualizados.

## Uso

```bash
npm install
npm run dev        # servidor de desarrollo
npm test           # pruebas unitarias
npm run build      # comprobación de tipos y compilación en dist/
npm run preview    # sirve la compilación
```

`dist/` es estático. Funciona en cualquier hosting estático.

## Publicación

La app se publica en GitHub Pages: https://perezweyerstall.github.io/Proyecto1/

- `.github/workflows/deploy.yml` compila, prueba y publica la app.
- Cada cambio en la rama `main` publica una versión nueva.
- Para publicar a mano, abre la pestaña Actions y ejecuta «Publicar en GitHub Pages».
- Configuración necesaria: Settings → Pages → Source: GitHub Actions.

Cada dispositivo guarda su propia biblioteca. Los documentos no se sincronizan entre dispositivos.

## Voz natural de Google

La app lee con una voz de Google Cloud Text-to-Speech (Chirp 3 HD, español de Estados Unidos: español latino neutro).

### Cómo funciona

```
App (GitHub Pages) → servidor de voz (Cloudflare Workers) → Google Text-to-Speech
```

- La clave de Google vive solo en Cloudflare, como secreto. Nunca aparece en el código público.
- El servidor exige un código de acceso. Cada dispositivo lo guarda una vez en Ajustes.
- La app genera una frase cada vez y guarda el audio en el dispositivo. Volver a escuchar no gasta cuota.
- La velocidad se cambia en el dispositivo. No gasta cuota.

### Límite gratuito garantizado

Google regala 1 000 000 de caracteres al mes con Chirp 3 HD. Escucha nunca llega a esa cifra:

- El servidor cuenta cada carácter enviado, espacios incluidos.
- Reserva los caracteres **antes** de llamar a Google. Si no caben, rechaza la frase.
- El límite es 900 000 caracteres al mes. El código impide pasar de 950 000 aunque se cambie la configuración.
- Cuenta a la vez el mes de la hora del Pacífico y el mes UTC. Cada uno debe quedar bajo el límite.
- Un único contador (Durable Object) atiende las peticiones en orden. Las peticiones simultáneas no lo saltan.
- El servidor admite como máximo 6000 caracteres por minuto. Un código filtrado no puede vaciar el mes de golpe.
- Solo el servidor publicado en `workers.dev` llama a Google. Un servidor local nunca usa la clave real.
- Al llegar al límite, la voz natural se detiene hasta el mes siguiente. Ajustes muestra el uso del mes.

900 000 caracteres son unas 16 horas de escucha al mes.

Condiciones para que la garantía se cumpla:

- No uses Text-to-Speech de Google con otra app o proyecto en la misma cuenta de facturación.
- No borres el servidor `escucha-voz` en Cloudflare a mitad de mes: el contador se borraría con él.
- No uses la clave de Google fuera de este servidor. Guárdala solo como secreto en GitHub.

### Configuración

1. **Google Cloud.** Crea un proyecto y activa la facturación. Activa la API «Cloud Text-to-Speech». Crea una clave de API y restríngela a esa API.
2. **Cloudflare.** Crea una cuenta gratuita. Abre «Workers y Pages» una vez para elegir el subdominio `workers.dev`. Crea un token de API con la plantilla «Edit Cloudflare Workers» y copia el ID de la cuenta.
3. **GitHub.** En Settings → Secrets and variables → Actions, crea cuatro secretos:
   - `CLOUDFLARE_API_TOKEN`: el token de Cloudflare.
   - `CLOUDFLARE_ACCOUNT_ID`: el ID de la cuenta de Cloudflare.
   - `GOOGLE_TTS_KEY`: la clave de Google.
   - `APP_TOKEN`: un código de acceso largo y aleatorio, de 16 caracteres o más. Usa un generador de contraseñas. No uses palabras como «escucha», «voz» ni tu nombre.
4. **Publicación.** Ejecuta el flujo «Publicar en GitHub Pages» en la pestaña Actions. El flujo publica el servidor, prueba la voz y publica la app.
5. **Dispositivos.** En Ajustes → Código de acceso, escribe el valor de `APP_TOKEN`.

Sin estos secretos, o sin el código en un dispositivo, la app usa la voz del dispositivo.

### Privacidad

Con la voz natural, el texto de cada frase viaja a Google a través de Cloudflare para generar el audio. Los documentos completos se guardan solo en el navegador.

### Desarrollo local

Para trabajar en la app con la voz natural, usa el servidor publicado. `localhost:5173` ya está autorizado:

```bash
VITE_TTS_URL=https://escucha-voz.<tu-subdominio>.workers.dev npm run dev
```

Para trabajar en el servidor, usa una clave falsa y un Google simulado. Nunca pongas la clave real en `worker/.dev.vars`:

```bash
cd worker
npm install
printf 'GOOGLE_TTS_KEY=clave-falsa\nAPP_TOKEN=prueba\n' > .dev.vars
npx wrangler dev --var GOOGLE_TTS_ENDPOINT:http://localhost:5099/synthesize
```

El servidor local rechaza las llamadas a Google si no tiene `GOOGLE_TTS_ENDPOINT`.

## Estructura

```
src/
  lib/
    text.ts         normalización y segmentación en párrafos, frases y palabras
    speech.ts       motor de voz: frase a frase, resaltado y elección de voz
    importers.ts    PDF, EPUB, DOCX, HTML, Markdown y TXT a texto
    db.ts           biblioteca en IndexedDB
    audioEngine.ts  motor de voz natural: audio por frase, caché y resaltado estimado
    cloudVoice.ts   cliente del servidor de voz
    audioCache.ts   caché del audio en IndexedDB
  player/           contexto del reproductor y hojas de velocidad y voz
  screens/          Inicio, Biblioteca, Lector, Ajustes y diálogos
  components/       componentes Material 3 e iconos
  state/            preferencias, biblioteca, avisos y rutas
  theme/color.ts    color dinámico Material 3
  styles/           tokens, base, componentes y pantallas
worker/             servidor de voz en Cloudflare Workers con límite mensual
tests/              pruebas con Vitest
scripts/gen-icons.mjs  genera src/components/icons.ts
```

## Decisiones técnicas

- **Lectura frase a frase.** Cada frase es una locución corta. Evita los cortes de Chrome en textos largos.
- **Resaltado de palabras.** Usa eventos `boundary` cuando la voz los emite. Si no, estima el tiempo de cada palabra.
- **Pausa robusta.** La pausa cancela la locución y la reanudación vuelve a la palabra actual. `speechSynthesis.pause()` falla en Android.
- **PDF.** Usa la compilación `legacy` de PDF.js 6. La estándar exige APIs que muchos navegadores aún no tienen.

## Diferencias con Speechify

- La voz natural tiene un límite gratuito de unas 16 horas al mes.
- No hay reconocimiento de texto en imágenes (OCR).
- No hay importación desde URL. Copia el texto de la página y pégalo.
- No hay sincronización entre dispositivos.

## Iconos

Para añadir un icono, edita la lista de `scripts/gen-icons.mjs` y ejecuta:

```bash
node scripts/gen-icons.mjs
```
