// Estado global: preferencias, biblioteca y avisos.

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { IconButton, Button } from '../components/ui';
import * as db from '../lib/db';
import { detectLanguage } from '../lib/speech';
import { countWords, normalizeText } from '../lib/text';
import { applyScheme } from '../theme/color';
import { WELCOME_TEXT, WELCOME_TITLE } from './welcome';
import {
  type Settings,
  type Stats,
  addListenedWords,
  clearStats,
  isOnboarded,
  loadSettings,
  loadStats,
  markOnboarded,
  saveSettings,
} from './settings';

/* ---------- Preferencias ---------- */

interface SettingsValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  dark: boolean;
}

const SettingsContext = createContext<SettingsValue | null>(null);

function useSystemDark(): boolean {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mql = window.matchMedia?.(query);
    if (!mql) return;
    const onChange = () => setDark(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return dark;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(loadSettings);
  const systemDark = useSystemDark();
  const dark = settings.themeMode === 'dark' || (settings.themeMode === 'system' && systemDark);

  useEffect(() => applyScheme(settings.seedColor, dark), [settings.seedColor, dark]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ settings, update, dark }), [settings, update, dark]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings fuera de SettingsProvider');
  return value;
}

/* ---------- Avisos (snackbar) ---------- */

interface SnackbarMessage {
  id: number;
  text: string;
  action?: { label: string; onClick: () => void };
}

type Notify = (text: string, action?: SnackbarMessage['action']) => void;

const SnackbarContext = createContext<Notify>(() => {});

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<SnackbarMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback<Notify>((text, action) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage({ id: Date.now(), text, action });
    timer.current = setTimeout(() => setMessage(null), action ? 6000 : 4000);
  }, []);

  return (
    <SnackbarContext.Provider value={notify}>
      {children}
      {message && (
        <div key={message.id} className="snackbar" role="status" aria-live="polite">
          <span className="snackbar__text">{message.text}</span>
          {message.action && (
            <Button
              variant="text"
              onClick={() => {
                message.action?.onClick();
                setMessage(null);
              }}
            >
              {message.action.label}
            </Button>
          )}
          <IconButton icon="close" label="Cerrar aviso" size={20} onClick={() => setMessage(null)} />
        </div>
      )}
    </SnackbarContext.Provider>
  );
}

export function useNotify(): Notify {
  return useContext(SnackbarContext);
}

/* ---------- Biblioteca ---------- */

interface LibraryValue {
  docs: db.DocMeta[];
  loading: boolean;
  stats: Stats;
  addText: (input: { title: string; text: string; source: db.DocSource }) => Promise<db.DocMeta>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  /** Refleja en memoria un cambio ya guardado. */
  patchLocal: (meta: db.DocMeta) => void;
  recordListening: (words: number) => void;
  clear: () => Promise<void>;
}

const LibraryContext = createContext<LibraryValue | null>(null);

let initPromise: Promise<db.DocMeta[]> | null = null;

/** Abre la biblioteca una sola vez. Crea el documento de bienvenida en el primer uso. */
function initLibrary(): Promise<db.DocMeta[]> {
  initPromise ??= (async () => {
    let list = await db.listDocs();
    if (list.length === 0 && !isOnboarded()) {
      const normalized = normalizeText(WELCOME_TEXT);
      await db.addDoc({
        title: WELCOME_TITLE,
        source: 'text',
        text: normalized,
        wordCount: countWords(normalized),
        lang: 'es',
      });
      list = await db.listDocs();
    }
    markOnboarded();
    return list;
  })();
  return initPromise;
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [docs, setDocs] = useState<db.DocMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>(loadStats);

  const addText = useCallback<LibraryValue['addText']>(async ({ title, text, source }) => {
    const normalized = normalizeText(text);
    if (!normalized) throw new Error('El documento no contiene texto.');
    const meta = await db.addDoc({
      title: title.trim() || 'Documento sin título',
      source,
      text: normalized,
      wordCount: countWords(normalized),
      lang: detectLanguage(normalized),
    });
    setDocs((current) => [meta, ...current]);
    return meta;
  }, []);

  useEffect(() => {
    let cancelled = false;
    initLibrary()
      .then((list) => {
        if (!cancelled) setDocs(list);
      })
      .catch((error) => console.error('No se pudo abrir la biblioteca', error))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const remove = useCallback(async (id: string) => {
    await db.deleteDoc(id);
    setDocs((current) => current.filter((d) => d.id !== id));
  }, []);

  const patchLocal = useCallback((meta: db.DocMeta) => {
    setDocs((current) => current.map((d) => (d.id === meta.id ? meta : d)));
  }, []);

  const rename = useCallback(
    async (id: string, title: string) => {
      const meta = await db.updateDoc(id, { title: title.trim() || 'Documento sin título' });
      if (meta) patchLocal(meta);
    },
    [patchLocal],
  );

  const recordListening = useCallback((words: number) => {
    if (words > 0) setStats(addListenedWords(words));
  }, []);

  const clear = useCallback(async () => {
    await db.clearAll();
    clearStats();
    setDocs([]);
    setStats({});
  }, []);

  const value = useMemo(
    () => ({ docs, loading, stats, addText, remove, rename, patchLocal, recordListening, clear }),
    [docs, loading, stats, addText, remove, rename, patchLocal, recordListening, clear],
  );
  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryValue {
  const value = useContext(LibraryContext);
  if (!value) throw new Error('useLibrary fuera de LibraryProvider');
  return value;
}
