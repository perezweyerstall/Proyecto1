// Motor de lectura con voz natural en la nube.
// Pide el audio de cada frase al servidor, lo guarda en caché y lo reproduce en un único <audio>.
// El resaltado de palabras se estima con el tiempo de reproducción: Chirp 3 HD no da marcas de tiempo.

import type { ClipCache } from './audioCache';
import { clipKey } from './audioCache';
import { TtsError, type TtsClient } from './cloudVoice';
import type { EngineSnapshot, PlaybackEngine } from './engine';
import { type Range, type Segmented, sentenceAt, wordAt, wordsIn } from './text';

export interface AudioEngineDeps {
  client: TtsClient;
  cache: ClipCache;
  createAudio: () => HTMLAudioElement;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  /** Programa el avance del resaltado. Por defecto, requestAnimationFrame o un intervalo. */
  schedule?: (fn: () => void) => () => void;
  /**
   * Mantiene la sesión multimedia con un bucle de silencio largo.
   * Chrome para Android trata los clips de 5 s o menos como sonidos breves:
   * sin el bucle, los controles de la pantalla de bloqueo desaparecen entre frases.
   */
  keepSession?: boolean;
  /** Espera antes de pedir una frase nueva al servidor. Evita gastar cuota al saltar frases seguidas. */
  requestDelayMs?: number;
}

/** Bucle de silencio de 6 s en WAV, creado en el dispositivo para no engordar la app. */
function silentLoop(createObjectURL: (blob: Blob) => string, seconds = 6): string {
  const rate = 8000;
  const samples = rate * seconds;
  const buffer = new ArrayBuffer(44 + samples);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  ascii(36, 'data');
  view.setUint32(40, samples, true);
  new Uint8Array(buffer, 44).fill(128);
  return createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

/** Petición anulada porque el usuario ya pasó a otra frase. */
class Superseded extends Error {}

/** 50 ms de silencio en WAV. Reproducirlo dentro de un toque desbloquea el audio en Safari para iOS. */
export const SILENCE =
  'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';

/** Silencio aproximado al inicio y al final de cada frase generada, en segundos. */
const LEAD_IN = 0.08;
const TAIL = 0.3;

/** Frases que se generan por adelantado. */
const PREFETCH = 1;

/** Frases recientes en memoria, para no leer IndexedDB en cada salto. */
const MEMORY_CLIPS = 24;

interface Timing {
  word: Range;
  /** Inicio y fin relativos al tramo hablado, entre 0 y 1. */
  from: number;
  to: number;
}

/**
 * Reparte el tiempo de la frase entre sus palabras.
 * Cada palabra pesa su longitud más una pausa según la puntuación que la sigue.
 */
export function estimateTimings(text: string, words: Range[], sentenceEnd: number): Timing[] {
  const weights = words.map((word, i) => {
    const next = i + 1 < words.length ? words[i + 1].start : sentenceEnd;
    const gap = text.slice(word.end, next);
    let pause = 0;
    if (/[.!?…]/.test(gap)) pause = 6;
    else if (/[,;:—–()]/.test(gap)) pause = 3;
    return word.end - word.start + 1.5 + pause;
  });
  const total = weights.reduce((sum, w) => sum + w, 0) || 1;
  let acc = 0;
  return words.map((word, i) => {
    const from = acc / total;
    acc += weights[i];
    return { word, from, to: acc / total };
  });
}

/** Tramo hablado del audio: excluye el silencio inicial y final. */
function spokenSpan(duration: number): { start: number; length: number } {
  if (!Number.isFinite(duration) || duration <= 0) return { start: 0, length: 0 };
  const lead = Math.min(LEAD_IN, duration * 0.1);
  const tail = Math.min(TAIL, duration * 0.15);
  return { start: lead, length: Math.max(duration - lead - tail, 0.01) };
}

function defaultSchedule(fn: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    let id = 0;
    const loop = () => {
      fn();
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    // En segundo plano no hay fotogramas: un intervalo lento mantiene el estado al día.
    const backup = setInterval(fn, 250);
    return () => {
      cancelAnimationFrame(id);
      clearInterval(backup);
    };
  }
  const timer = setInterval(fn, 50);
  return () => clearInterval(timer);
}

interface Loaded {
  sentence: number;
  url: string;
  timings: Timing[];
}

export class AudioEngine implements PlaybackEngine {
  private deps: AudioEngineDeps;
  private doc: Segmented | null = null;
  private snapshot: EngineSnapshot = { status: 'idle', sentence: -1, word: null, offset: 0 };
  private listeners = new Set<(s: EngineSnapshot) => void>();
  private token = 0;
  private rate = 1;
  private voice: string;
  private audio: HTMLAudioElement | null = null;
  private unlocked = false;
  private loaded: Loaded | null = null;
  private stopTicker: (() => void) | null = null;
  /** Audio en camino o reciente, por clave de caché. */
  private clips = new Map<string, Promise<Blob>>();

  onSentenceDone: ((words: number) => void) | null = null;
  onEnded: (() => void) | null = null;
  onError: ((code: string, detail?: string) => void) | null = null;
  private keeper: HTMLAudioElement | null = null;

  constructor(deps: AudioEngineDeps, voice: string) {
    this.deps = deps;
    this.voice = voice;
  }

  subscribe(listener: (s: EngineSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): EngineSnapshot {
    return this.snapshot;
  }

  getDocument(): Segmented | null {
    return this.doc;
  }

  load(doc: Segmented, offset = 0): void {
    this.halt();
    this.release();
    this.doc = doc;
    const index = doc.sentences.length ? Math.max(0, sentenceAt(doc.sentences, offset)) : -1;
    const sentence = doc.sentences[index];
    this.set({ status: 'idle', sentence: index, word: null, offset: sentence ? Math.max(offset, sentence.start) : 0 });
  }

  unload(): void {
    this.halt();
    this.release();
    this.doc = null;
    this.set({ status: 'idle', sentence: -1, word: null, offset: 0 });
  }

  prime(): void {
    const audio = this.element();
    if (this.deps.keepSession && !this.keeper) {
      const keeper = this.deps.createAudio();
      keeper.loop = true;
      keeper.src = silentLoop(this.deps.createObjectURL);
      this.keeper = keeper;
    }
    if (this.unlocked) return;
    this.unlocked = true;
    audio.onended = null;
    audio.onerror = null;
    audio.src = SILENCE;
    audio.play().catch((error: unknown) => {
      // Sin gesto del usuario: se volverá a intentar en el siguiente toque.
      // Una pausa inmediata (AbortError) no anula el desbloqueo.
      if (error instanceof DOMException && error.name === 'NotAllowedError') this.unlocked = false;
    });
  }

  play(): void {
    const doc = this.doc;
    if (!doc || doc.sentences.length === 0) return;
    let { sentence, offset } = this.snapshot;
    if (sentence < 0 || sentence >= doc.sentences.length) {
      sentence = 0;
      offset = 0;
    }
    // Reanuda la frase cargada en el punto exacto de la pausa.
    // play() ocurre dentro del toque: también desbloquea el audio en iOS.
    const audio = this.audio;
    if (this.snapshot.status === 'paused' && this.loaded?.sentence === sentence && audio && !audio.ended) {
      const token = ++this.token;
      this.unlocked = true;
      this.attach(sentence, this.wordIndexAt(offset), token);
      this.set({ ...this.snapshot, status: 'playing' });
      this.startAudio(token);
      return;
    }
    this.prime();
    this.speakFrom(sentence, offset);
  }

  pause(): void {
    if (this.snapshot.status !== 'playing') return;
    this.halt();
    this.set({ ...this.snapshot, status: 'paused', buffering: false });
  }

  toggle(): void {
    if (this.snapshot.status === 'playing') this.pause();
    else this.play();
  }

  seek(offset: number): void {
    const doc = this.doc;
    if (!doc || doc.sentences.length === 0) return;
    const index = sentenceAt(doc.sentences, offset);
    const start = Math.max(offset, doc.sentences[index].start);
    if (this.snapshot.status === 'playing') {
      this.speakFrom(index, start);
    } else {
      this.halt();
      // Sin clip cargado, play() empieza en la palabra pedida. El audio sigue en la caché.
      this.dropLoaded();
      this.set({ ...this.snapshot, sentence: index, word: null, offset: start, buffering: false });
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

  previous(): void {
    const doc = this.doc;
    if (!doc || this.snapshot.sentence < 0) return;
    const current = doc.sentences[this.snapshot.sentence];
    const atStart = this.snapshot.offset <= current.start + 1;
    this.seekSentence(atStart ? this.snapshot.sentence - 1 : this.snapshot.sentence);
  }

  setRate(rate: number): void {
    this.rate = rate;
    if (this.audio) this.audio.playbackRate = rate;
  }

  getRate(): number {
    return this.rate;
  }

  setVoice(voice: string): void {
    if (voice === this.voice) return;
    this.voice = voice;
    if (this.snapshot.status === 'playing') this.speakFrom(this.snapshot.sentence, this.snapshot.offset);
    else {
      this.halt();
      this.dropLoaded();
    }
  }

  stop(): void {
    this.halt();
    this.set({ ...this.snapshot, status: 'idle', word: null, buffering: false });
  }

  private element(): HTMLAudioElement {
    if (!this.audio) {
      const audio = this.deps.createAudio();
      audio.preload = 'auto';
      // El sistema puede pausar el audio: auriculares desconectados, Bluetooth, llamadas.
      // Al final de cada frase también llega 'pause', pero con `ended` activo.
      audio.addEventListener('pause', () => {
        if (audio.ended || this.snapshot.status !== 'playing' || this.snapshot.buffering) return;
        if (!this.loaded || audio.src !== this.loaded.url) return;
        this.stopTicker?.();
        this.stopTicker = null;
        // Se conserva el token: si el sistema reanuda, la frase sigue y encadena la siguiente.
        this.set({ ...this.snapshot, status: 'paused' });
      });
      audio.addEventListener('play', () => {
        if (this.snapshot.status !== 'paused' || !this.loaded || audio.src !== this.loaded.url) return;
        this.set({ ...this.snapshot, status: 'playing', buffering: false });
        this.startTicker(this.token);
      });
      this.audio = audio;
    }
    return this.audio;
  }

  private textOf(index: number): string {
    const doc = this.doc!;
    const sentence = doc.sentences[index];
    return doc.text.slice(sentence.start, sentence.end);
  }

  /**
   * Audio de una frase: memoria, caché del dispositivo o servidor.
   * Con `token`, espera un momento antes de pedirla al servidor y la descarta si el usuario ya pasó a otra.
   */
  private async clip(index: number, token?: number): Promise<Blob> {
    const text = this.textOf(index);
    const voice = this.voice;
    const key = clipKey(voice, text);
    const known = this.clips.get(key);
    if (known) return known;
    const cached = await this.deps.cache.get(key);
    if (cached) return cached;
    const delay = this.deps.requestDelayMs ?? 0;
    if (token !== undefined && delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (token !== this.token) throw new Superseded();
    }
    const again = this.clips.get(key);
    if (again) return again;
    const promise = this.deps.client.synthesize(text, voice).then((blob) => {
      void this.deps.cache.put(key, blob);
      return blob;
    });
    this.clips.set(key, promise);
    promise.catch(() => this.clips.delete(key));
    while (this.clips.size > MEMORY_CLIPS) {
      const oldest = this.clips.keys().next().value as string;
      this.clips.delete(oldest);
    }
    return promise;
  }

  private prefetch(index: number): void {
    const doc = this.doc;
    if (!doc) return;
    for (let i = index + 1; i <= index + PREFETCH && i < doc.sentences.length; i++) {
      this.clip(i).catch(() => {
        // El error se informará al llegar a esa frase.
      });
    }
  }

  private wordIndexAt(offset: number): number {
    if (!this.loaded) return 0;
    const i = this.loaded.timings.findIndex((t) => offset < t.word.end);
    return i < 0 ? 0 : i;
  }

  private speakFrom(index: number, offset: number): void {
    const doc = this.doc;
    const sentence = doc?.sentences[index];
    if (!doc || !sentence) return;
    this.halt();
    const token = this.token;

    const words = wordsIn(doc.text, sentence.start, sentence.end);
    const startWord = offset > sentence.start ? wordAt(words, offset) : null;
    if (offset > sentence.start && !startWord) {
      this.advance(index, token);
      return;
    }
    this.set({
      status: 'playing',
      sentence: index,
      word: startWord ?? words[0] ?? null,
      offset: startWord?.start ?? sentence.start,
      buffering: true,
    });

    this.clip(index, token).then(
      (blob) => {
        if (token !== this.token) return;
        this.dropLoaded();
        const url = this.deps.createObjectURL(blob);
        const timings = estimateTimings(doc.text, words, sentence.end);
        this.loaded = { sentence: index, url, timings };
        const startIndex = startWord ? Math.max(0, timings.findIndex((t) => t.word.start === startWord.start)) : 0;
        const audio = this.element();
        this.attach(index, startIndex, token);
        audio.src = url;
        audio.playbackRate = this.rate;
        if (startIndex > 0) {
          audio.addEventListener(
            'loadedmetadata',
            () => {
              // Salta a la palabra pedida si este clip sigue cargado, aunque se haya pausado.
              if (this.loaded?.url !== url) return;
              const span = spokenSpan(audio.duration);
              audio.currentTime = span.start + span.length * timings[startIndex].from;
            },
            { once: true },
          );
        }
        this.startAudio(token);
        this.prefetch(index);
      },
      (error: unknown) => {
        if (token !== this.token || error instanceof Superseded) return;
        this.fail(error);
      },
    );
  }

  /** Conecta los eventos del audio a la frase actual. */
  private attach(index: number, startIndex: number, token: number): void {
    const audio = this.element();
    audio.onended = () => {
      if (token !== this.token) return;
      const words = this.loaded?.timings.length ?? 0;
      this.onSentenceDone?.(Math.max(0, words - startIndex));
      this.advance(index, token);
    };
    audio.onerror = () => {
      if (token !== this.token || !this.loaded) return;
      this.halt();
      this.set({ ...this.snapshot, status: 'paused', buffering: false });
      this.onError?.('playback');
    };
  }

  private startAudio(token: number): void {
    const audio = this.element();
    audio.playbackRate = this.rate;
    audio.play().then(
      () => {
        if (token !== this.token) return;
        this.set({ ...this.snapshot, buffering: false });
        this.startTicker(token);
      },
      (error: unknown) => {
        if (token !== this.token) return;
        this.halt();
        this.set({ ...this.snapshot, status: 'paused', buffering: false });
        const blocked = error instanceof DOMException && error.name === 'NotAllowedError';
        this.onError?.(blocked ? 'not-allowed' : 'playback');
      },
    );
  }

  /** Mueve el resaltado según el tiempo de reproducción. */
  private startTicker(token: number): void {
    this.stopTicker?.();
    const schedule = this.deps.schedule ?? defaultSchedule;
    this.stopTicker = schedule(() => {
      const audio = this.audio;
      const loaded = this.loaded;
      if (token !== this.token || !audio || !loaded || loaded.timings.length === 0) return;
      const span = spokenSpan(audio.duration);
      if (span.length === 0) return;
      const progress = (audio.currentTime - span.start) / span.length;
      const timing =
        loaded.timings.find((t) => progress < t.to) ?? loaded.timings[loaded.timings.length - 1];
      if (timing.word.start !== this.snapshot.word?.start) {
        this.set({ ...this.snapshot, word: timing.word, offset: timing.word.start });
      }
    });
  }

  private advance(index: number, token: number): void {
    if (token !== this.token || !this.doc) return;
    const nextIndex = index + 1;
    if (nextIndex < this.doc.sentences.length) {
      this.speakFrom(nextIndex, this.doc.sentences[nextIndex].start);
      return;
    }
    this.halt();
    this.dropLoaded();
    this.set({ status: 'idle', sentence: 0, word: null, offset: 0, buffering: false });
    this.onEnded?.();
  }

  private fail(error: unknown): void {
    this.halt();
    this.set({ ...this.snapshot, status: 'paused', buffering: false });
    if (error instanceof TtsError) this.onError?.(error.code, error.resetsOn);
    else this.onError?.('server');
  }

  /** Suelta el clip cargado y su dirección de memoria. */
  private dropLoaded(): void {
    if (this.loaded) this.deps.revokeObjectURL(this.loaded.url);
    this.loaded = null;
  }

  /** Invalida la reproducción en curso y detiene el audio. */
  private halt(): void {
    this.token++;
    this.stopTicker?.();
    this.stopTicker = null;
    this.audio?.pause();
  }

  /** Suelta el audio cargado y los fragmentos en memoria. */
  private release(): void {
    this.dropLoaded();
    this.clips.clear();
  }

  private set(next: EngineSnapshot): void {
    this.snapshot = next;
    // El bucle de silencio acompaña a la lectura: suena mientras se lee y para con ella.
    const keeper = this.keeper;
    if (keeper) {
      if (next.status === 'playing' && keeper.paused) keeper.play().catch(() => {});
      else if (next.status !== 'playing' && !keeper.paused) keeper.pause();
    }
    for (const listener of this.listeners) listener(next);
  }
}
