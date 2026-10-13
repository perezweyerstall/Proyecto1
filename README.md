# Escucha

Lector de texto a voz inspirado en Speechify. Sigue las líneas de diseño de Google: Material Design 3.

Escucha convierte cualquier texto en audio. Resalta la frase y la palabra que suenan. Recuerda dónde te quedaste en cada documento.

## Funciones

- **Lectura sincronizada.** La frase actual se resalta. La palabra que suena se marca con el color principal.
- **Control de reproducción.** Reproducir, pausar, frase anterior y frase siguiente. Toca una frase para saltar a ella.
- **Velocidad.** De 0,5× a 3,5×, con atajos frecuentes y estimación de palabras por minuto.
- **Voces.** Lista de voces del dispositivo con búsqueda, etiquetas de calidad y vista previa. Modo automático según el idioma del documento.
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

- Node.js 20 o superior.
- Un navegador con Web Speech API: Chrome, Edge, Safari o Firefox actualizados.

## Uso

```bash
npm install
npm run dev        # servidor de desarrollo
npm test           # pruebas unitarias
npm run build      # comprobación de tipos y compilación en dist/
npm run preview    # sirve la compilación
```

`dist/` es estático. Funciona en cualquier hosting estático, como GitHub Pages.

## Estructura

```
src/
  lib/
    text.ts         normalización y segmentación en párrafos, frases y palabras
    speech.ts       motor de voz: frase a frase, resaltado y elección de voz
    importers.ts    PDF, EPUB, DOCX, HTML, Markdown y TXT a texto
    db.ts           biblioteca en IndexedDB
  player/           contexto del reproductor y hojas de velocidad y voz
  screens/          Inicio, Biblioteca, Lector, Ajustes y diálogos
  components/       componentes Material 3 e iconos
  state/            preferencias, biblioteca, avisos y rutas
  theme/color.ts    color dinámico Material 3
  styles/           tokens, base, componentes y pantallas
tests/              pruebas con Vitest
scripts/gen-icons.mjs  genera src/components/icons.ts
```

## Decisiones técnicas

- **Lectura frase a frase.** Cada frase es una locución corta. Evita los cortes de Chrome en textos largos.
- **Resaltado de palabras.** Usa eventos `boundary` cuando la voz los emite. Si no, estima el tiempo de cada palabra.
- **Pausa robusta.** La pausa cancela la locución y la reanudación vuelve a la palabra actual. `speechSynthesis.pause()` falla en Android.
- **PDF.** Usa la compilación `legacy` de PDF.js 6. La estándar exige APIs que muchos navegadores aún no tienen.

## Diferencias con Speechify

- Las voces dependen del dispositivo y del navegador. No hay voces premium en la nube.
- No hay reconocimiento de texto en imágenes (OCR).
- No hay importación desde URL. Copia el texto de la página y pégalo.
- No hay sincronización entre dispositivos.

## Iconos

Para añadir un icono, edita la lista de `scripts/gen-icons.mjs` y ejecuta:

```bash
node scripts/gen-icons.mjs
```
