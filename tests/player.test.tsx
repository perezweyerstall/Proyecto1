import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as db from '../src/lib/db';
import { segment } from '../src/lib/text';
import { PlayerProvider, usePlayer } from '../src/player/PlayerContext';
import { LibraryProvider, SettingsProvider, SnackbarProvider } from '../src/state/AppState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeUtterance {
  text: string;
  rate = 1;
  lang = '';
  voice = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onboundary: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

const synth = { speak() {}, cancel() {}, getVoices: () => [], speaking: false, pending: false };

let player: ReturnType<typeof usePlayer>;
function Probe() {
  player = usePlayer();
  return null;
}

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

beforeAll(() => {
  Object.assign(window, { speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtterance });
  localStorage.setItem('escucha.onboarded', 'true');
});

afterAll(() => {
  Reflect.deleteProperty(window, 'speechSynthesis');
});

describe('PlayerProvider', () => {
  it('guarda la posición al pausar y al cerrar, sin pisar otros documentos', async () => {
    const textA = 'Uno. Dos. Tres. Cuatro.';
    const textB = 'Alfa. Beta. Gamma.';
    const a = await db.addDoc({ title: 'A', source: 'text', text: textA, wordCount: 4, lang: 'es' });
    const b = await db.addDoc({ title: 'B', source: 'text', text: textB, wordCount: 3, lang: 'es' });

    const root = createRoot(document.createElement('div'));
    await act(async () => {
      root.render(
        <SettingsProvider>
          <SnackbarProvider>
            <LibraryProvider>
              <PlayerProvider>
                <Probe />
              </PlayerProvider>
            </LibraryProvider>
          </SnackbarProvider>
        </SettingsProvider>,
      );
    });

    await act(async () => {
      await player.open(a.id);
    });
    const third = segment(textA).sentences[2].start;
    await act(async () => {
      player.engine!.seek(third);
      player.engine!.play();
      player.engine!.pause();
    });
    await flush();
    expect((await db.getDoc(a.id))?.position).toBe(third);

    // Abrir otro documento no modifica la posición del anterior.
    await act(async () => {
      await player.open(b.id);
    });
    await flush();
    expect((await db.getDoc(a.id))?.position).toBe(third);
    expect((await db.getDoc(b.id))?.position).toBe(0);

    // Cerrar el reproductor en pausa conserva la posición.
    const second = segment(textB).sentences[1].start;
    await act(async () => {
      player.engine!.seek(second);
      player.engine!.play();
      player.engine!.pause();
    });
    await flush();
    await act(async () => player.close());
    await flush();
    expect((await db.getDoc(b.id))?.position).toBe(second);

    act(() => root.unmount());
  });
});
