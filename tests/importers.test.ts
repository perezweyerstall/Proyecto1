import { describe, expect, it } from 'vitest';
import { htmlToText, importFile, joinPdfLines, stripMarkdown } from '../src/lib/importers';
import { normalizeText } from '../src/lib/text';

describe('importers', () => {
  it('quita sintaxis de Markdown', () => {
    const md = '# Título\n\nTexto con **negrita**, _cursiva_ y [enlace](http://x).\n\n- elemento';
    expect(normalizeText(stripMarkdown(md))).toBe('Título\n\nTexto con negrita, cursiva y enlace.\n\nelemento');
  });

  it('extrae bloques de HTML y omite navegación y scripts', () => {
    const doc = new DOMParser().parseFromString(
      '<body><nav>Menú</nav><article><h1>Título</h1><p>Uno <b>dos</b>.</p><script>x()</script><p>Tres.</p></article></body>',
      'text/html',
    );
    expect(normalizeText(htmlToText(doc))).toBe('Título\n\nUno dos.\n\nTres.');
  });

  it('une líneas de PDF y respeta guiones y párrafos', () => {
    const lines = [
      'Esta es una línea larga de un párrafo que conti-',
      'núa en la siguiente línea con más texto aquí.',
      'Fin corto.',
      'Nuevo párrafo con una línea bastante larga también',
      'que termina aquí con un punto final normal.',
      '',
    ];
    expect(joinPdfLines(lines)).toBe(
      'Esta es una línea larga de un párrafo que continúa en la siguiente línea con más texto aquí. Fin corto.\n\n' +
        'Nuevo párrafo con una línea bastante larga también que termina aquí con un punto final normal.',
    );
  });

  it('importa archivos de texto y rechaza formatos desconocidos', async () => {
    const txt = await importFile(new File(['Hola.'], 'mi_nota.txt', { type: 'text/plain' }));
    expect(txt).toEqual({ title: 'mi nota', text: 'Hola.', source: 'txt' });
    await expect(importFile(new File(['x'], 'imagen.png', { type: 'image/png' }))).rejects.toThrow(
      'Formato no compatible',
    );
  });
});
