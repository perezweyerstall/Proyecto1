import { describe, expect, it, vi } from 'vitest';
import type { ClipCache } from '../src/lib/audioCache';
import { AudioEngine, estimateTimings } from '../src/lib/audioEngine';
import { TtsError, type TtsClient } from '../src/lib/cloudVoice';
import { segment, wordsIn } from '../src/lib/text';

/** Elemento <audio> mínimo controlado por la prueba. */
class FakeAudio {
  private source = '';
  preload = '';
  currentTime = 0;
  /** Como en el navegador: cambiar la fuente vuelve al inicio. */
  get src() {
    return this.source;
  }
  set src(value: string) {
    this.source = value;
    this.currentTime = 0;
    this.duration = NaN;
  }
  duration = NaN;
  playbackRate = 1;
  paused = true;
  ended = false;
  loop = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners: Record<string, Array<{ fn: () => void; once: boolean }>> = {};
  playResult: () => Promise<void> = () => Promise.resolve();
  play() {
    this.paused = false;
    return this.playResult();
  }
  pause() {
    this.paused = true;
  }
  addEventListener(type: string, fn: () => void, options?: { once?: boolean }) {
    (this.listeners[type] ??= []).push({ fn, once: !!options?.once });
  }
  emit(type: string) {
    const entries = this.listeners[type] ?? [];
    this.listeners[type] = entries.filter((e) => !e.once);
    entries.forEach((e) => e.fn());
  }
  /** El sistema pausa o reanuda el audio por su cuenta. */
  systemPause() {
    this.paused = true;
    this.emit('pause');
  }
  systemPlay() {
    this.paused = false;
    this.emit('play');
  }
  /** Simula la carga de metadatos y el inicio del clip. */
  loadMetadata(duration: number) {
    this.duration = duration;
    this.emit('loadedmetadata');
  }
  finish() {
    this.ended = true;
    this.onended?.();
    this.ended = false;
  }
}

const TEXT = 'Hola mundo. Adiós amigo.';

function setup(options: { failWith?: TtsError; keepSession?: boolean; requestDelayMs?: number } = {}) {
  const audio = new FakeAudio();
  const created: FakeAudio[] = [];
  const synthesized: string[] = [];
  const client: TtsClient = {
    synthesize: vi.fn(async (text: string) => {
      synthesized.push(text);
      if (options.failWith) throw options.failWith;
      return new Blob([text], { type: 'audio/mpeg' });
    }),
    usage: vi.fn(),
  };
  const store = new Map<string, Blob>();
  const cache: ClipCache = {
    get: async (key) => store.get(key),
    put: async (key, blob) => void store.set(key, blob),
    clear: async () => store.clear(),
  };
  let tick: () => void = () => {};
  let urls = 0;
  const revoked: string[] = [];
  const engine = new AudioEngine(
    {
      client,
      cache,
      createAudio: () => {
        const element = created.length === 0 ? audio : new FakeAudio();
        created.push(element);
        return element as unknown as HTMLAudioElement;
      },
      keepSession: options.keepSession,
      requestDelayMs: options.requestDelayMs,
      createObjectURL: () => `blob:${++urls}`,
      revokeObjectURL: (url) => revoked.push(url),
      schedule: (fn) => {
        tick = fn;
        return () => {
          tick = () => {};
        };
      },
    },
    'es-US-Chirp3-HD-Kore',
  );
  engine.load(segment(TEXT), 0);
  return { engine, audio, created, synthesized, store, revoked, tick: () => tick() };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('estimateTimings', () => {
  it('reparte el tiempo por longitud y pausas', () => {
    const text = 'Uno, dos tres.';
    const timings = estimateTimings(text, wordsIn(text, 0, text.length), text.length);
    expect(timings.map((t) => text.slice(t.word.start, t.word.end))).toEqual(['Uno', 'dos', 'tres']);
    expect(timings[0].from).toBe(0);
    expect(timings[2].to).toBeCloseTo(1);
    // La coma alarga el tramo de «Uno» frente a «dos», de igual longitud.
    expect(timings[0].to - timings[0].from).toBeGreaterThan(timings[1].to - timings[1].from);
  });
});

describe('AudioEngine', () => {
  it('desbloquea el audio, pide la frase y la reproduce', async () => {
    const { engine, audio, synthesized } = setup();
    engine.play();
    expect(audio.src.startsWith('data:audio/wav')).toBe(true);
    expect(engine.getSnapshot()).toMatchObject({ status: 'playing', sentence: 0, buffering: true });
    await flush();
    expect(synthesized).toEqual(['Hola mundo.', 'Adiós amigo.']);
    expect(audio.src).toBe('blob:1');
    expect(engine.getSnapshot().buffering).toBe(false);
  });

  it('resalta palabras según el tiempo de reproducción', async () => {
    const { engine, audio, tick } = setup();
    engine.play();
    await flush();
    audio.duration = 2;
    audio.currentTime = 1.5;
    tick();
    const { word } = engine.getSnapshot();
    expect(TEXT.slice(word!.start, word!.end)).toBe('mundo');
  });

  it('encadena frases, cuenta palabras y termina', async () => {
    const { engine, audio } = setup();
    const done: number[] = [];
    const ended = vi.fn();
    engine.onSentenceDone = (n) => done.push(n);
    engine.onEnded = ended;
    engine.play();
    await flush();
    audio.finish();
    await flush();
    expect(engine.getSnapshot().sentence).toBe(1);
    expect(audio.src).toBe('blob:2');
    audio.finish();
    expect(done).toEqual([2, 2]);
    expect(ended).toHaveBeenCalledOnce();
    expect(engine.getSnapshot()).toMatchObject({ status: 'idle', sentence: 0, offset: 0 });
  });

  it('reanuda tras la pausa sin volver a pedir audio', async () => {
    const { engine, audio, synthesized } = setup();
    engine.play();
    await flush();
    audio.currentTime = 0.7;
    engine.pause();
    expect(audio.paused).toBe(true);
    expect(engine.getSnapshot().status).toBe('paused');
    engine.play();
    expect(audio.paused).toBe(false);
    expect(audio.currentTime).toBe(0.7);
    expect(synthesized).toHaveLength(2);
    audio.finish();
    expect(engine.getSnapshot().sentence).toBe(1);
  });

  it('usa la caché del dispositivo al volver a escuchar', async () => {
    const { engine, synthesized } = setup();
    engine.play();
    await flush();
    engine.load(segment(TEXT), 0);
    engine.play();
    await flush();
    expect(synthesized).toEqual(['Hola mundo.', 'Adiós amigo.']);
  });

  it('empieza a mitad de frase en la palabra pedida', async () => {
    const { engine, audio } = setup();
    engine.seek(5);
    engine.play();
    await flush();
    expect(engine.getSnapshot().offset).toBe(5);
    audio.loadMetadata(2);
    expect(audio.currentTime).toBeGreaterThan(0.5);
  });

  it('cambia la velocidad sin regenerar el audio', async () => {
    const { engine, audio, synthesized } = setup();
    engine.play();
    await flush();
    engine.setRate(1.5);
    expect(audio.playbackRate).toBe(1.5);
    expect(synthesized).toHaveLength(2);
  });

  it('pausa e informa si se agota el límite mensual', async () => {
    const { engine } = setup({ failWith: new TtsError('monthly-limit', '2026-11-01') });
    const onError = vi.fn();
    engine.onError = onError;
    engine.play();
    await flush();
    expect(engine.getSnapshot()).toMatchObject({ status: 'paused', buffering: false });
    expect(onError).toHaveBeenCalledWith('monthly-limit', '2026-11-01');
  });

  it('informa si el navegador bloquea la reproducción', async () => {
    const { engine, audio } = setup();
    const onError = vi.fn();
    engine.onError = onError;
    audio.playResult = () => Promise.reject(new DOMException('bloqueado', 'NotAllowedError'));
    engine.play();
    await flush();
    await flush();
    expect(engine.getSnapshot().status).toBe('paused');
    expect(onError).toHaveBeenCalledWith('not-allowed');
  });

  it('ignora el audio de una petición anterior tras saltar de frase', async () => {
    const { engine, audio } = setup();
    engine.play();
    engine.next();
    await flush();
    expect(engine.getSnapshot().sentence).toBe(1);
    expect(audio.src).toBe('blob:1');
    audio.finish();
    expect(engine.getSnapshot()).toMatchObject({ status: 'idle', sentence: 0 });
  });

  it('al reanudar tras un salto en pausa, empieza en el punto pedido', async () => {
    const { engine, audio } = setup();
    engine.play();
    await flush();
    audio.loadMetadata(2);
    audio.currentTime = 1.4;
    engine.pause();
    // «Frase anterior» en pausa vuelve al inicio de la frase.
    engine.previous();
    engine.play();
    await flush();
    expect(audio.src).toBe('blob:2');
    expect(audio.currentTime).toBe(0);
    expect(engine.getSnapshot()).toMatchObject({ status: 'playing', sentence: 0 });
  });

  it('refleja las pausas y reanudaciones del sistema', async () => {
    const { engine, audio } = setup();
    engine.play();
    await flush();
    audio.systemPause();
    expect(engine.getSnapshot().status).toBe('paused');
    audio.systemPlay();
    expect(engine.getSnapshot().status).toBe('playing');
    // El token se conserva: la frase termina y encadena la siguiente.
    audio.finish();
    expect(engine.getSnapshot().sentence).toBe(1);
  });

  it('no pide audio de las frases que se saltan seguidas', async () => {
    vi.useFakeTimers();
    try {
      const { engine, synthesized } = setup({ requestDelayMs: 150 });
      engine.load(segment('Uno. Dos. Tres. Cuatro.'), 0);
      engine.play();
      engine.next();
      engine.next();
      await vi.advanceTimersByTimeAsync(400);
      expect(synthesized[0]).toBe('Tres.');
      expect(synthesized).not.toContain('Uno.');
      expect(synthesized).not.toContain('Dos.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('en Android mantiene la sesión con un bucle de silencio', async () => {
    const { engine, created } = setup({ keepSession: true });
    engine.play();
    const keeper = created[1];
    expect(keeper.loop).toBe(true);
    expect(keeper.paused).toBe(false);
    await flush();
    engine.pause();
    expect(keeper.paused).toBe(true);
  });

  it('libera las direcciones de audio al cambiar de frase', async () => {
    const { engine, audio, revoked } = setup();
    engine.play();
    await flush();
    audio.finish();
    await flush();
    expect(revoked).toEqual(['blob:1']);
  });
});
