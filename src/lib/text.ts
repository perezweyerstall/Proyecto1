// Normalización y segmentación de texto para lectura en voz alta.
// Todas las posiciones son desplazamientos de caracteres sobre el texto normalizado.

export interface Range {
  start: number;
  end: number;
}

export interface Sentence extends Range {
  paragraph: number;
}

export interface Paragraph extends Range {
  /** Índice de la primera frase del párrafo dentro de `sentences`. */
  firstSentence: number;
  /** Índice siguiente a la última frase del párrafo. */
  endSentence: number;
}

export interface Segmented {
  text: string;
  paragraphs: Paragraph[];
  sentences: Sentence[];
}

/** Longitud máxima de un fragmento hablado. Evita cortes del motor de voz. */
export const MAX_CHUNK = 220;

/** Palabras por minuto estimadas a velocidad 1x. */
export const BASE_WPM = 160;

const PARAGRAPH_SEP = '\n\n';

/**
 * Normaliza saltos de línea y espacios.
 * Párrafos separados por línea en blanco. Sin líneas en blanco, cada línea es un párrafo.
 */
export function normalizeText(raw: string): string {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/[​﻿]/g, '');

  const hasBlankLines = /\n[ ]*\n/.test(text);
  const blocks = hasBlankLines ? text.split(/\n[ ]*\n+/) : text.split('\n');

  return blocks
    .map((block) =>
      block
        .split('\n')
        .map((line) => line.trim())
        .join(' ')
        .replace(/ {2,}/g, ' ')
        .trim(),
    )
    .filter((block) => block.length > 0)
    .join(PARAGRAPH_SEP);
}

let sentenceSegmenter: Intl.Segmenter | null | undefined;
let wordSegmenter: Intl.Segmenter | null | undefined;

function getSegmenter(granularity: 'sentence' | 'word'): Intl.Segmenter | null {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null;
  if (granularity === 'sentence') {
    sentenceSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'sentence' });
    return sentenceSegmenter;
  }
  wordSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'word' });
  return wordSegmenter;
}

/** Divide un párrafo en frases. Devuelve rangos relativos al párrafo, sin espacios en los bordes. */
function splitSentences(paragraph: string): Range[] {
  const ranges: Range[] = [];
  const segmenter = getSegmenter('sentence');
  if (segmenter) {
    for (const seg of segmenter.segment(paragraph)) {
      pushTrimmed(ranges, paragraph, seg.index, seg.index + seg.segment.length);
    }
  } else {
    const re = /[^.!?¡¿…]*(?:[.!?…]+["'”»)\]]*|$)\s*/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(paragraph)) && match[0].length > 0) {
      pushTrimmed(ranges, paragraph, match.index, match.index + match[0].length);
    }
  }
  return ranges.flatMap((range) => splitLong(paragraph, range));
}

function pushTrimmed(out: Range[], text: string, start: number, end: number): void {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (end > start) out.push({ start, end });
}

/** Parte frases largas en fragmentos de hasta MAX_CHUNK caracteres. */
function splitLong(text: string, range: Range): Range[] {
  if (range.end - range.start <= MAX_CHUNK) return [range];
  const out: Range[] = [];
  let start = range.start;
  while (range.end - start > MAX_CHUNK) {
    const window = text.slice(start, start + MAX_CHUNK);
    let cut = -1;
    for (const re of [/[,;:—–)]\s/g, /\s/g]) {
      let m: RegExpExecArray | null;
      let last = -1;
      while ((m = re.exec(window))) {
        if (m.index > MAX_CHUNK * 0.4) last = m.index + m[0].length;
      }
      if (last > 0) {
        cut = last;
        break;
      }
    }
    if (cut <= 0) cut = MAX_CHUNK;
    pushTrimmed(out, text, start, start + cut);
    start += cut;
  }
  pushTrimmed(out, text, start, range.end);
  return out;
}

/** Segmenta el texto normalizado en párrafos y frases. */
export function segment(text: string): Segmented {
  const paragraphs: Paragraph[] = [];
  const sentences: Sentence[] = [];
  let offset = 0;
  const blocks = text.length ? text.split(PARAGRAPH_SEP) : [];
  blocks.forEach((block, index) => {
    const firstSentence = sentences.length;
    for (const range of splitSentences(block)) {
      sentences.push({ start: offset + range.start, end: offset + range.end, paragraph: index });
    }
    paragraphs.push({
      start: offset,
      end: offset + block.length,
      firstSentence,
      endSentence: sentences.length,
    });
    offset += block.length + PARAGRAPH_SEP.length;
  });
  return { text, paragraphs, sentences };
}

/** Devuelve las palabras de un tramo del texto, con posiciones absolutas. */
export function wordsIn(text: string, start: number, end: number): Range[] {
  const slice = text.slice(start, end);
  const words: Range[] = [];
  const segmenter = getSegmenter('word');
  if (segmenter) {
    for (const seg of segmenter.segment(slice)) {
      if (seg.isWordLike) {
        words.push({ start: start + seg.index, end: start + seg.index + seg.segment.length });
      }
    }
  } else {
    const re = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(slice))) {
      words.push({ start: start + m.index, end: start + m.index + m[0].length });
    }
  }
  return words;
}

export function countWords(text: string): number {
  return wordsIn(text, 0, text.length).length;
}

/** Índice de la frase que contiene `offset`. Devuelve la siguiente si cae en un hueco. */
export function sentenceAt(sentences: Sentence[], offset: number): number {
  if (sentences.length === 0) return -1;
  let lo = 0;
  let hi = sentences.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sentences[mid].end <= offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Palabra que contiene `offset`, o la siguiente palabra. */
export function wordAt(words: Range[], offset: number): Range | null {
  for (const word of words) {
    if (offset < word.end) return word;
  }
  return null;
}

/** Minutos estimados para leer `words` palabras a la velocidad `rate`. */
export function estimateMinutes(words: number, rate: number): number {
  return words / (BASE_WPM * Math.max(rate, 0.1));
}

export function formatDuration(minutes: number): string {
  const totalSeconds = Math.max(0, Math.round(minutes * 60));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Título por defecto a partir del texto. */
export function deriveTitle(text: string, fallback = 'Documento sin título'): string {
  const first = text.split(PARAGRAPH_SEP)[0]?.trim() ?? '';
  if (!first) return fallback;
  // Sin lookbehind: Safari anterior a 16.4 no lo admite.
  const sentence = first.match(/^.*?[.!?…](?=\s|$)/)?.[0] ?? first;
  const words = sentence.split(/\s+/).slice(0, 10).join(' ');
  return words.length < sentence.length ? `${words.replace(/[,;:]$/, '')}…` : words;
}
