// Motor de lectura en voz alta sobre la Web Speech API.
// Lee frase a frase. Resalta palabra a palabra con eventos `boundary` o con estimación temporal.

import type { EngineSnapshot, PlaybackEngine } from './engine';
import { BASE_WPM, type Range, type Segmented, sentenceAt, wordAt, wordsIn } from './text';

export type { EngineSnapshot, PlaybackStatus } from './engine';

/** Subconjunto de `SpeechSynthesis` que usa el motor. Permite pruebas con dobles. */
export interface SynthLike {
  speak(utterance: SpeechSynthesisUtterance): void;
  cancel(): void;
  pause?(): void;
  resume?(): void;
  getVoices(): SpeechSynthesisVoice[];
  readonly speaking?: boolean;
  readonly pending?: boolean;
}

export interface EngineDeps {
  synth: SynthLike;
  createUtterance(text: string): SpeechSynthesisUtterance;
  userAgent?: string;
}

/** Caracteres medios por palabra, espacio incluido. Ajusta la estimación de tiempo. */
const CHARS_PER_WORD = 6;
const FALLBACK_TICK_MS = 50;
const RESTART_DEBOUNCE_MS = 200;
const KEEPALIVE_MS = 10_000;

export class SpeechEngine implements PlaybackEngine {
  private deps: EngineDeps;
  private doc: Segmented | null = null;
  private words: Range[] = [];
  private snapshot: EngineSnapshot = { status: 'idle', sentence: -1, word: null, offset: 0 };
  private listeners = new Set<(s: EngineSnapshot) => void>();
  private token = 0;
  private rate = 1;
  private voice: SpeechSynthesisVoice | null = null;
  private lang = 'es-ES';
  private current: SpeechSynthesisUtterance | null = null;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  /** Se llama al terminar cada frase con su número de palabras. */
  onSentenceDone: ((words: number) => void) | null = null;
  /** Se llama al terminar el documento. */
  onEnded: (() => void) | null = null;
  /** Se llama ante un error del motor de voz. */
  onError: ((message: string) => void) | null = null;

  constructor(deps: EngineDeps) {
    this.deps = deps;
  }

  subscribe(listener: (s: EngineSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): EngineSnapshot {
    return this.snapshot;
  }

  getDocument(): Segmented | null {
    return this.doc;
  }

  /** Carga un documento y sitúa la lectura en `offset`. Detiene la reproducción. */
  load(doc: Segmented, offset = 0): void {
    this.halt();
    this.doc = doc;
    const index = doc.sentences.length ? Math.max(0, sentenceAt(doc.sentences, offset)) : -1;
    const sentence = doc.sentences[index];
    const clamped = sentence ? Math.max(offset, sentence.start) : 0;
    this.words = sentence ? wordsIn(doc.text, sentence.start, sentence.end) : [];
    this.set({ status: 'idle', sentence: index, word: null, offset: clamped });
  }

  /**
   * Desbloquea la voz en Safari para iOS.
   * Safari exige la primera locución dentro de un gesto del usuario.
   * Llamar de forma síncrona en un clic que inicia la lectura tras una espera.
   */
  prime(): void {
    const utterance = this.deps.createUtterance(' ');
    utterance.volume = 0;
    this.deps.synth.speak(utterance);
  }

  /** Descarga el documento y detiene la voz. */
  unload(): void {
    this.halt();
    this.doc = null;
    this.words = [];
    this.set({ status: 'idle', sentence: -1, word: null, offset: 0 });
  }

  play(): void {
    const doc = this.doc;
    if (!doc || doc.sentences.length === 0) return;
    let { sentence, offset } = this.snapshot;
    if (sentence < 0 || sentence >= doc.sentences.length) {
      sentence = 0;
      offset = 0;
    }
    this.speakFrom(sentence, offset);
  }

  pause(): void {
    if (this.snapshot.status !== 'playing') return;
    this.halt();
    this.set({ ...this.snapshot, status: 'paused' });
  }

  toggle(): void {
    if (this.snapshot.status === 'playing') this.pause();
    else this.play();
  }

  /** Mueve la lectura a `offset`. Mantiene el estado de reproducción. */
  seek(offset: number): void {
    const doc = this.doc;
    if (!doc || doc.sentences.length === 0) return;
    const index = sentenceAt(doc.sentences, offset);
    const start = Math.max(offset, doc.sentences[index].start);
    if (this.snapshot.status === 'playing') {
      this.speakFrom(index, start);
    } else {
      this.words = wordsIn(doc.text, doc.sentences[index].start, doc.sentences[index].end);
      this.set({ ...this.snapshot, sentence: index, word: null, offset: start });
    }
  }

  seekSentence(index: number): void {
    const doc = this.doc;
    if (!doc || doc.sentences.length === 0) return;
    const clamped = Math.min(Math.max(index, 0), doc.sentences.length - 1);
    this.seek(doc.sentences[clamped].start);
  }

  next(): void {
    this.seekSentence(this.snapshot.sentence + 1);
  }

  /** Vuelve al inicio de la frase. Si ya está al inicio, va a la frase anterior. */
  previous(): void {
    const doc = this.doc;
    if (!doc || this.snapshot.sentence < 0) return;
    const current = doc.sentences[this.snapshot.sentence];
    const atStart = this.snapshot.offset <= current.start + 1;
    this.seekSentence(atStart ? this.snapshot.sentence - 1 : this.snapshot.sentence);
  }

  setRate(rate: number): void {
    this.rate = rate;
    this.scheduleRestart();
  }

  getRate(): number {
    return this.rate;
  }

  setVoice(voice: SpeechSynthesisVoice | null, lang?: string): void {
    const changed = voice?.voiceURI !== this.voice?.voiceURI || (lang && lang !== this.lang);
    this.voice = voice;
    if (lang) this.lang = lang;
    if (changed) this.scheduleRestart();
  }

  /** Detiene la voz y deja la posición actual. */
  stop(): void {
    this.halt();
    this.set({ ...this.snapshot, status: 'idle', word: null });
  }

  private scheduleRestart(): void {
    if (this.snapshot.status !== 'playing') return;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.snapshot.status === 'playing') {
        this.speakFrom(this.snapshot.sentence, this.snapshot.offset);
      }
    }, RESTART_DEBOUNCE_MS);
  }

  private speakFrom(index: number, offset: number): void {
    const doc = this.doc;
    if (!doc) return;
    const sentence = doc.sentences[index];
    if (!sentence) return;

    const wasActive = this.deps.synth.speaking || this.deps.synth.pending;
    this.halt();
    const token = this.token;

    this.words = wordsIn(doc.text, sentence.start, sentence.end);
    const startWord = offset > sentence.start ? wordAt(this.words, offset) : this.words[0] ?? null;
    if (offset > sentence.start && !startWord) {
      // La posición está tras la última palabra: pasa a la siguiente frase.
      this.advance(index, token);
      return;
    }
    // Desde el inicio de frase se conserva la puntuación inicial («¿», comillas).
    const speakStart = offset > sentence.start && startWord ? startWord.start : sentence.start;
    const utterance = this.deps.createUtterance(doc.text.slice(speakStart, sentence.end));
    utterance.rate = this.rate;
    utterance.lang = this.voice?.lang ?? this.lang;
    if (this.voice) utterance.voice = this.voice;

    let sawBoundary = false;
    utterance.onstart = () => {
      if (token !== this.token) return;
      if (!sawBoundary) this.startFallback(speakStart, token);
    };
    utterance.onboundary = (event) => {
      if (token !== this.token) return;
      if (event.name && event.name !== 'word') return;
      sawBoundary = true;
      this.stopFallback();
      const word = wordAt(this.words, speakStart + event.charIndex);
      if (word) this.set({ ...this.snapshot, word, offset: word.start });
    };
    utterance.onend = () => {
      if (token !== this.token) return;
      this.stopFallback();
      const spoken = this.words.filter((w) => w.start >= speakStart).length;
      this.onSentenceDone?.(spoken);
      this.advance(index, token);
    };
    utterance.onerror = (event) => {
      if (token !== this.token) return;
      // halt() suelta los manejadores antes de cancelar: estos códigos llegan de fuera.
      // Chrome para Android corta la voz al apagar la pantalla o pasar a segundo plano.
      const external = event.error === 'interrupted' || event.error === 'canceled';
      this.halt();
      this.set({ ...this.snapshot, status: 'paused' });
      if (!external) this.onError?.(event.error);
    };

    this.current = utterance;
    this.set({ status: 'playing', sentence: index, word: startWord, offset: speakStart });

    const speak = () => {
      if (token !== this.token) return;
      this.deps.synth.speak(utterance);
      this.startKeepAlive(token);
    };
    // Chrome descarta a veces un `speak` inmediato tras `cancel`.
    if (wasActive) setTimeout(speak, 0);
    else speak();
  }

  private advance(index: number, token: number): void {
    if (token !== this.token || !this.doc) return;
    const nextIndex = index + 1;
    if (nextIndex < this.doc.sentences.length) {
      this.speakFrom(nextIndex, this.doc.sentences[nextIndex].start);
      return;
    }
    this.halt();
    this.set({ status: 'idle', sentence: 0, word: null, offset: 0 });
    this.onEnded?.();
  }

  /** Avanza el resaltado por tiempo cuando la voz no emite eventos `boundary`. */
  private startFallback(speakStart: number, token: number): void {
    this.stopFallback();
    const msPerChar = 60_000 / (BASE_WPM * CHARS_PER_WORD) / Math.max(this.rate, 0.1);
    const startedAt = Date.now();
    const last = this.words[this.words.length - 1];
    this.fallbackTimer = setInterval(() => {
      if (token !== this.token || !last) return this.stopFallback();
      const position = Math.min(speakStart + (Date.now() - startedAt) / msPerChar, last.start);
      const word = wordAt(this.words, position);
      if (word && word.start !== this.snapshot.word?.start) {
        this.set({ ...this.snapshot, word, offset: word.start });
      }
    }, FALLBACK_TICK_MS);
  }

  private stopFallback(): void {
    if (this.fallbackTimer) clearInterval(this.fallbackTimer);
    this.fallbackTimer = null;
  }

  /**
   * Chrome de escritorio corta las voces remotas tras unos 15 segundos.
   * Pausar y reanudar periódicamente evita el corte.
   */
  private startKeepAlive(token: number): void {
    this.stopKeepAlive();
    const ua = this.deps.userAgent ?? '';
    const needsKeepAlive =
      this.voice !== null && !this.voice.localService && /Chrome/.test(ua) && !/Android|Edg\//.test(ua);
    const { pause, resume } = this.deps.synth;
    if (!needsKeepAlive || !pause || !resume) return;
    this.keepAliveTimer = setInterval(() => {
      if (token !== this.token) return this.stopKeepAlive();
      pause.call(this.deps.synth);
      resume.call(this.deps.synth);
    }, KEEPALIVE_MS);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
  }

  /** Invalida la locución en curso y cancela temporizadores. */
  private halt(): void {
    this.token++;
    this.stopFallback();
    this.stopKeepAlive();
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    if (this.current) {
      this.current.onstart = null;
      this.current.onboundary = null;
      this.current.onend = null;
      this.current.onerror = null;
      this.current = null;
    }
    this.deps.synth.cancel();
  }

  private set(next: EngineSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener(next);
  }
}

/** Puntuación de calidad de una voz. Prefiere voces neuronales y remotas. */
function voiceScore(voice: SpeechSynthesisVoice): number {
  let score = 0;
  if (/natural|neural|online|premium|enhanced|wavenet/i.test(voice.name)) score += 4;
  if (/google/i.test(voice.name)) score += 3;
  if (!voice.localService) score += 1;
  if (voice.default) score += 1;
  return score;
}

/** Elige la mejor voz para un idioma. Prioriza coincidencia exacta de región. */
export function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  const base = lang.toLowerCase().split('-')[0];
  const sameLang = voices.filter((v) => v.lang.toLowerCase().replace('_', '-').split('-')[0] === base);
  if (sameLang.length === 0) return voices.find((v) => v.default) ?? voices[0] ?? null;
  const exact = lang.toLowerCase();
  return [...sameLang].sort((a, b) => {
    const regionA = a.lang.toLowerCase().replace('_', '-') === exact ? 2 : 0;
    const regionB = b.lang.toLowerCase().replace('_', '-') === exact ? 2 : 0;
    return regionB + voiceScore(b) - (regionA + voiceScore(a));
  })[0];
}

const STOPWORDS: Record<string, string[]> = {
  es: ['el', 'la', 'de', 'que', 'y', 'en', 'los', 'del', 'se', 'las', 'por', 'un', 'para', 'con', 'una', 'es'],
  en: ['the', 'of', 'and', 'to', 'in', 'is', 'that', 'it', 'for', 'was', 'on', 'with', 'as', 'are', 'this'],
  pt: ['o', 'a', 'de', 'que', 'e', 'do', 'da', 'em', 'um', 'para', 'não', 'uma', 'os', 'no', 'com'],
  fr: ['le', 'la', 'de', 'et', 'les', 'des', 'en', 'un', 'une', 'du', 'est', 'que', 'pour', 'dans', 'pas'],
  de: ['der', 'die', 'und', 'in', 'den', 'von', 'zu', 'das', 'mit', 'sich', 'des', 'auf', 'für', 'ist', 'nicht'],
  it: ['il', 'di', 'che', 'e', 'la', 'per', 'un', 'in', 'del', 'non', 'una', 'sono', 'gli', 'con', 'della'],
};

/** Detecta el idioma por frecuencia de palabras vacías. Devuelve `null` si no hay señal clara. */
export function detectLanguage(text: string): string | null {
  const sample = text.slice(0, 4000).toLowerCase().match(/\p{L}+/gu) ?? [];
  if (sample.length < 5) return null;
  const counts = new Map<string, number>();
  for (const word of sample) counts.set(word, (counts.get(word) ?? 0) + 1);
  let best: string | null = null;
  let bestScore = 0;
  for (const [lang, words] of Object.entries(STOPWORDS)) {
    const score = words.reduce((sum, w) => sum + (counts.get(w) ?? 0), 0);
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? best : null;
}
