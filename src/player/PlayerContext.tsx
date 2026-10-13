// Reproductor global. Mantiene el documento cargado entre pantallas.

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import * as db from '../lib/db';
import { type EngineSnapshot, type PlaybackStatus, SpeechEngine, pickVoice } from '../lib/speech';
import { type Segmented, segment } from '../lib/text';
import { useLibrary, useNotify, useSettings } from '../state/AppState';

interface PlayerValue {
  supported: boolean;
  engine: SpeechEngine | null;
  doc: db.DocMeta | null;
  segmented: Segmented | null;
  voices: SpeechSynthesisVoice[];
  voice: SpeechSynthesisVoice | null;
  /** Carga un documento. Devuelve `false` si no existe. */
  open: (id: string) => Promise<boolean>;
  close: () => void;
}

const PlayerContext = createContext<PlayerValue | null>(null);

const IDLE: EngineSnapshot = { status: 'idle', sentence: -1, word: null, offset: 0 };
const SAVE_INTERVAL_MS = 2000;

const ERROR_MESSAGES: Record<string, string> = {
  'audio-busy': 'El audio del dispositivo está ocupado.',
  'audio-hardware': 'No se encontró salida de audio.',
  network: 'La voz necesita conexión a internet.',
  'synthesis-unavailable': 'No hay voces disponibles.',
  'synthesis-failed': 'La voz no pudo leer este fragmento.',
  'language-unavailable': 'La voz no admite este idioma.',
  'voice-unavailable': 'La voz elegida no está disponible.',
  'not-allowed': 'El navegador bloqueó la reproducción. Pulsa reproducir de nuevo.',
};

function createEngine(): SpeechEngine | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  return new SpeechEngine({
    synth: window.speechSynthesis,
    createUtterance: (text) => new SpeechSynthesisUtterance(text),
    userAgent: navigator.userAgent,
  });
}

/** Convierte un código de idioma corto en una etiqueta regional. */
function localeFor(lang: string | null): string {
  const browser = navigator.language || 'es-ES';
  if (!lang) return browser;
  if (browser.toLowerCase().startsWith(lang)) return browser;
  const defaults: Record<string, string> = {
    es: 'es-ES', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR', de: 'de-DE', it: 'it-IT',
  };
  return defaults[lang] ?? lang;
}

function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : [],
  );
  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return;
    const update = () => setVoices(speechSynthesis.getVoices());
    update();
    speechSynthesis.addEventListener?.('voiceschanged', update);
    // Algunos navegadores cargan las voces tarde y sin evento.
    const retry = setTimeout(update, 1000);
    return () => {
      clearTimeout(retry);
      speechSynthesis.removeEventListener?.('voiceschanged', update);
    };
  }, []);
  return voices;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [engine] = useState(createEngine);
  const voices = useVoices();
  const { settings } = useSettings();
  const { docs, patchLocal, recordListening } = useLibrary();
  const notify = useNotify();
  const [doc, setDoc] = useState<db.DocMeta | null>(null);
  const [segmented, setSegmented] = useState<Segmented | null>(null);
  const docRef = useRef<db.DocMeta | null>(null);
  docRef.current = doc;

  // Refleja cambios de la biblioteca, como un cambio de nombre.
  useEffect(() => {
    const current = docRef.current;
    const fresh = current && docs.find((d) => d.id === current.id);
    if (fresh && fresh !== current) {
      docRef.current = fresh;
      setDoc(fresh);
    }
  }, [docs]);

  const voice = useMemo(() => {
    if (voices.length === 0) return null;
    const chosen = settings.voiceURI ? voices.find((v) => v.voiceURI === settings.voiceURI) : undefined;
    return chosen ?? pickVoice(voices, localeFor(doc?.lang ?? null));
  }, [voices, settings.voiceURI, doc?.lang]);

  useEffect(() => engine?.setRate(settings.rate), [engine, settings.rate]);
  useEffect(() => engine?.setVoice(voice, localeFor(doc?.lang ?? null)), [engine, voice, doc?.lang]);

  // Guarda la posición de lectura de forma periódica y al pausar.
  const lastSaved = useRef({ at: 0, offset: -1 });
  const savePosition = useCallback(
    async (offset: number, force = false) => {
      const current = docRef.current;
      if (!current) return;
      const now = Date.now();
      if (!force && now - lastSaved.current.at < SAVE_INTERVAL_MS) return;
      if (offset === lastSaved.current.offset) return;
      lastSaved.current = { at: now, offset };
      const meta = await db.updateDoc(current.id, { position: offset });
      if (meta && docRef.current?.id === meta.id) {
        docRef.current = meta;
        patchLocal(meta);
      }
    },
    [patchLocal],
  );

  useEffect(() => {
    if (!engine) return;
    let previous = engine.getSnapshot();
    const unsubscribe = engine.subscribe((snapshot) => {
      const statusChanged = snapshot.status !== previous.status;
      if (snapshot.sentence !== previous.sentence || statusChanged) {
        void savePosition(snapshot.offset, statusChanged);
      }
      previous = snapshot;
    });
    engine.onSentenceDone = recordListening;
    engine.onEnded = () => {
      const current = docRef.current;
      if (current) void savePosition(current.length, true);
    };
    engine.onError = (code) => notify(ERROR_MESSAGES[code] ?? `Error de voz: ${code}`);
    const flush = () => void savePosition(engine.getSnapshot().offset, true);
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      unsubscribe();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [engine, savePosition, recordListening, notify]);

  const open = useCallback(
    async (id: string) => {
      if (docRef.current?.id === id) return true;
      const [meta, text] = await Promise.all([db.getDoc(id), db.getText(id)]);
      if (!meta || text === undefined) return false;
      if (docRef.current && engine) await savePosition(engine.getSnapshot().offset, true);
      const seg = segment(text);
      const finished = meta.position >= meta.length - 1;
      const updated = (await db.updateDoc(id, { lastOpenedAt: Date.now() })) ?? meta;
      // Sin documento activo, la carga no guarda posiciones en el documento anterior.
      docRef.current = null;
      engine?.load(seg, finished ? 0 : meta.position);
      lastSaved.current = { at: 0, offset: engine?.getSnapshot().offset ?? -1 };
      docRef.current = updated;
      setDoc(updated);
      setSegmented(seg);
      patchLocal(updated);
      return true;
    },
    [engine, patchLocal, savePosition],
  );

  const close = useCallback(() => {
    if (engine && docRef.current) void savePosition(engine.getSnapshot().offset, true);
    // Se suelta el documento antes de descargar: la descarga no debe guardar la posición 0.
    docRef.current = null;
    engine?.unload();
    setDoc(null);
    setSegmented(null);
  }, [engine, savePosition]);

  useMediaSession(engine, doc?.id ?? null, doc?.title ?? '');

  const value = useMemo(
    () => ({ supported: engine !== null, engine, doc, segmented, voices, voice, open, close }),
    [engine, doc, segmented, voices, voice, open, close],
  );
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerValue {
  const value = useContext(PlayerContext);
  if (!value) throw new Error('usePlayer fuera de PlayerProvider');
  return value;
}

/** Estado instantáneo del motor. Se actualiza en cada palabra. */
export function useSnapshot(): EngineSnapshot {
  const { engine } = usePlayer();
  const subscribe = useCallback(
    (fn: () => void) => (engine ? engine.subscribe(fn) : () => {}),
    [engine],
  );
  const getSnapshot = useCallback(() => (engine ? engine.getSnapshot() : IDLE), [engine]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Estado de reproducción. Solo cambia al reproducir, pausar o terminar. */
export function usePlaybackStatus(): PlaybackStatus {
  const { engine } = usePlayer();
  const subscribe = useCallback(
    (fn: () => void) => (engine ? engine.subscribe(fn) : () => {}),
    [engine],
  );
  const getStatus = useCallback(() => (engine ? engine.getSnapshot().status : 'idle'), [engine]);
  return useSyncExternalStore(subscribe, getStatus);
}

/** Controles del sistema operativo: pantalla de bloqueo, auriculares y teclas multimedia. */
function useMediaSession(engine: SpeechEngine | null, docId: string | null, title: string): void {
  useEffect(() => {
    if (!engine || !('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const doc = docId !== null;
    session.metadata = doc ? new MediaMetadata({ title, artist: 'Escucha' }) : null;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => engine.play()],
      ['pause', () => engine.pause()],
      ['stop', () => engine.stop()],
      ['previoustrack', () => engine.previous()],
      ['nexttrack', () => engine.next()],
      ['seekbackward', () => engine.previous()],
      ['seekforward', () => engine.next()],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, doc ? handler : null);
      } catch {
        // Acción no admitida en este navegador.
      }
    }
    const unsubscribe = engine.subscribe((s) => {
      session.playbackState = s.status === 'playing' ? 'playing' : s.status === 'paused' ? 'paused' : 'none';
    });
    return unsubscribe;
  }, [engine, docId, title]);
}
