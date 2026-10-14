// Contrato común de los motores de lectura: voz del dispositivo y voz natural en la nube.

import type { Range, Segmented } from './text';

export type PlaybackStatus = 'idle' | 'playing' | 'paused';

export interface EngineSnapshot {
  status: PlaybackStatus;
  /** Índice de la frase actual. -1 sin documento cargado. */
  sentence: number;
  /** Palabra resaltada. */
  word: Range | null;
  /** Posición de lectura actual en caracteres. */
  offset: number;
  /** El audio de la frase actual aún se está generando. */
  buffering?: boolean;
}

export interface PlaybackEngine {
  subscribe(listener: (s: EngineSnapshot) => void): () => void;
  getSnapshot(): EngineSnapshot;
  getDocument(): Segmented | null;
  load(doc: Segmented, offset?: number): void;
  unload(): void;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(offset: number): void;
  seekSentence(index: number): void;
  next(): void;
  previous(): void;
  setRate(rate: number): void;
  getRate(): number;
  stop(): void;
  /** Prepara el audio dentro de un gesto del usuario. Necesario en Safari para iOS. */
  prime(): void;
  onSentenceDone: ((words: number) => void) | null;
  onEnded: (() => void) | null;
  onError: ((code: string) => void) | null;
}
