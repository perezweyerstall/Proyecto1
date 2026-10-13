import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpeechEngine, detectLanguage, pickVoice, type SynthLike } from '../src/lib/speech';
import { segment } from '../src/lib/text';

/** Utterance mínima con los manejadores que usa el motor. */
class FakeUtterance {
  text: string;
  rate = 1;
  lang = '';
  voice: SpeechSynthesisVoice | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onboundary: ((e: { name: string; charIndex: number }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

class FakeSynth implements SynthLike {
  spoken: FakeUtterance[] = [];
  speaking = false;
  pending = false;
  speak(u: SpeechSynthesisUtterance) {
    this.spoken.push(u as unknown as FakeUtterance);
    this.speaking = true;
  }
  cancel() {
    this.speaking = false;
  }
  getVoices() {
    return [];
  }
  get last() {
    return this.spoken[this.spoken.length - 1];
  }
}

const TEXT = 'Hola mundo. Adiós amigo.';

function setup() {
  const synth = new FakeSynth();
  const engine = new SpeechEngine({
    synth,
    createUtterance: (text) => new FakeUtterance(text) as unknown as SpeechSynthesisUtterance,
  });
  engine.load(segment(TEXT), 0);
  return { synth, engine };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('SpeechEngine', () => {
  it('lee frase a frase y termina el documento', () => {
    const { synth, engine } = setup();
    const ended = vi.fn();
    const words: number[] = [];
    engine.onEnded = ended;
    engine.onSentenceDone = (n) => words.push(n);

    engine.play();
    expect(synth.last.text).toBe('Hola mundo.');
    expect(engine.getSnapshot()).toMatchObject({ status: 'playing', sentence: 0 });

    synth.last.onend?.();
    vi.runAllTimers();
    expect(synth.last.text).toBe('Adiós amigo.');
    expect(engine.getSnapshot().sentence).toBe(1);

    synth.last.onend?.();
    vi.runAllTimers();
    expect(ended).toHaveBeenCalledOnce();
    expect(words).toEqual([2, 2]);
    expect(engine.getSnapshot()).toMatchObject({ status: 'idle', sentence: 0, offset: 0 });
  });

  it('resalta palabras con eventos boundary', () => {
    const { synth, engine } = setup();
    engine.play();
    synth.last.onstart?.();
    synth.last.onboundary?.({ name: 'word', charIndex: 5 });
    const { word } = engine.getSnapshot();
    expect(TEXT.slice(word!.start, word!.end)).toBe('mundo');
  });

  it('estima palabras por tiempo si no hay eventos boundary', () => {
    const { synth, engine } = setup();
    engine.play();
    synth.last.onstart?.();
    vi.advanceTimersByTime(2000);
    const { word } = engine.getSnapshot();
    expect(TEXT.slice(word!.start, word!.end)).toBe('mundo');
  });

  it('pausa y reanuda desde la palabra actual', () => {
    const { synth, engine } = setup();
    engine.play();
    synth.last.onboundary?.({ name: 'word', charIndex: 5 });
    engine.pause();
    expect(engine.getSnapshot().status).toBe('paused');
    const stale = synth.last;
    engine.play();
    vi.runAllTimers();
    expect(synth.last.text).toBe('mundo.');
    // Los eventos de la locución cancelada no afectan al estado.
    stale.onend?.();
    expect(engine.getSnapshot().sentence).toBe(0);
  });

  it('salta frases y aplica cambios de velocidad', () => {
    const { synth, engine } = setup();
    engine.play();
    engine.next();
    vi.runAllTimers();
    expect(synth.last.text).toBe('Adiós amigo.');
    engine.previous();
    vi.runAllTimers();
    expect(synth.last.text).toBe('Hola mundo.');
    engine.setRate(2);
    vi.runAllTimers();
    expect(synth.last.rate).toBe(2);
    expect(synth.last.text).toBe('Hola mundo.');
  });

  it('pausa sin aviso si el sistema interrumpe la voz', () => {
    const { synth, engine } = setup();
    const onError = vi.fn();
    engine.onError = onError;
    engine.play();
    synth.last.onboundary?.({ name: 'word', charIndex: 5 });
    synth.last.onerror?.({ error: 'interrupted' });
    expect(engine.getSnapshot()).toMatchObject({ status: 'paused', offset: 5 });
    expect(onError).not.toHaveBeenCalled();
    engine.play();
    vi.runAllTimers();
    expect(synth.last.text).toBe('mundo.');
  });

  it('pausa y avisa ante un error real del motor', () => {
    const { synth, engine } = setup();
    const onError = vi.fn();
    engine.onError = onError;
    engine.play();
    synth.last.onerror?.({ error: 'synthesis-failed' });
    expect(engine.getSnapshot().status).toBe('paused');
    expect(onError).toHaveBeenCalledWith('synthesis-failed');
  });
});

describe('voces e idioma', () => {
  const voice = (name: string, lang: string, extra: Partial<SpeechSynthesisVoice> = {}) =>
    ({ name, lang, voiceURI: name, localService: true, default: false, ...extra }) as SpeechSynthesisVoice;

  it('elige la mejor voz del idioma', () => {
    const voices = [
      voice('English', 'en-US', { default: true }),
      voice('Español básico', 'es-ES'),
      voice('Google español', 'es-ES', { localService: false }),
      voice('Español México', 'es-MX'),
    ];
    expect(pickVoice(voices, 'es-ES')?.name).toBe('Google español');
    expect(pickVoice(voices, 'fr-FR')?.name).toBe('English');
  });

  it('detecta el idioma del texto', () => {
    expect(detectLanguage('El perro de la casa come en el jardín con los niños')).toBe('es');
    expect(detectLanguage('The dog of the house is in the garden and it was happy')).toBe('en');
    expect(detectLanguage('xyz')).toBeNull();
  });
});

describe('prime', () => {
  it('lanza una locución silenciosa sin cambiar el estado', () => {
    const { synth, engine } = setup();
    engine.prime();
    expect(synth.last.text).toBe(' ');
    expect((synth.last as unknown as { volume: number }).volume).toBe(0);
    expect(engine.getSnapshot().status).toBe('idle');
  });
});
