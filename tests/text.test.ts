import { describe, expect, it } from 'vitest';
import {
  MAX_CHUNK,
  countWords,
  deriveTitle,
  estimateMinutes,
  formatDuration,
  normalizeText,
  segment,
  sentenceAt,
  wordsIn,
} from '../src/lib/text';

describe('normalizeText', () => {
  it('une líneas de un párrafo y separa párrafos por línea en blanco', () => {
    const raw = 'Hola\r\nmundo.\n\n\n  Segundo   párrafo.  ';
    expect(normalizeText(raw)).toBe('Hola mundo.\n\nSegundo párrafo.');
  });

  it('trata cada línea como párrafo si no hay líneas en blanco', () => {
    expect(normalizeText('Uno.\nDos.\nTres.')).toBe('Uno.\n\nDos.\n\nTres.');
  });

  it('elimina caracteres invisibles', () => {
    expect(normalizeText('a​b c')).toBe('ab c');
  });
});

describe('segment', () => {
  it('divide en párrafos y frases con posiciones absolutas', () => {
    const text = normalizeText('Primera frase. ¿Segunda frase?\n\nTercera frase.');
    const { paragraphs, sentences } = segment(text);
    expect(paragraphs).toHaveLength(2);
    expect(sentences.map((s) => text.slice(s.start, s.end))).toEqual([
      'Primera frase.',
      '¿Segunda frase?',
      'Tercera frase.',
    ]);
    expect(sentences.map((s) => s.paragraph)).toEqual([0, 0, 1]);
    expect(paragraphs[1].firstSentence).toBe(2);
    expect(paragraphs[1].endSentence).toBe(3);
  });

  it('parte frases más largas que MAX_CHUNK', () => {
    const long = Array.from({ length: 80 }, (_, i) => `palabra${i}`).join(' ') + '.';
    const { sentences } = segment(long);
    expect(sentences.length).toBeGreaterThan(1);
    for (const s of sentences) expect(s.end - s.start).toBeLessThanOrEqual(MAX_CHUNK);
    expect(sentences.map((s) => long.slice(s.start, s.end)).join(' ')).toBe(long);
  });

  it('devuelve estructura vacía para texto vacío', () => {
    expect(segment('')).toEqual({ text: '', paragraphs: [], sentences: [] });
  });
});

describe('wordsIn y utilidades', () => {
  it('extrae palabras con posiciones', () => {
    const text = '¡Hola, mundo!';
    expect(wordsIn(text, 0, text.length).map((w) => text.slice(w.start, w.end))).toEqual(['Hola', 'mundo']);
    expect(countWords('uno dos  tres')).toBe(3);
  });

  it('localiza la frase de una posición', () => {
    const text = 'Uno. Dos. Tres.';
    const { sentences } = segment(text);
    expect(sentenceAt(sentences, 0)).toBe(0);
    expect(sentenceAt(sentences, 4)).toBe(1);
    expect(sentenceAt(sentences, 6)).toBe(1);
    expect(sentenceAt(sentences, 100)).toBe(2);
  });

  it('estima y formatea duraciones', () => {
    expect(estimateMinutes(160, 1)).toBe(1);
    expect(estimateMinutes(160, 2)).toBe(0.5);
    expect(formatDuration(1.5)).toBe('1:30');
    expect(formatDuration(61)).toBe('1:01:00');
  });

  it('deriva un título corto', () => {
    expect(deriveTitle('Una frase corta. Otra.')).toBe('Una frase corta.');
    expect(deriveTitle('a b c d e f g h i j k l m')).toBe('a b c d e f g h i j…');
    expect(deriveTitle('')).toBe('Documento sin título');
  });
});
