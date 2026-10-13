// Armazón de la app: navegación adaptable, minirreproductor y flujos de añadir contenido.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { DocTile, progressOf } from './components/docs';
import type { IconName } from './components/icons';
import { Fab, Icon, IconButton, LinearProgress } from './components/ui';
import { estimateMinutes, formatDuration } from './lib/text';
import { PlayerProvider, usePlayer, useSnapshot } from './player/PlayerContext';
import { Home } from './screens/Home';
import { Library } from './screens/Library';
import { Reader } from './screens/Reader';
import { Settings } from './screens/Settings';
import { AddSheet, PasteDialog, useFileImport, useFilePicker } from './screens/dialogs';
import { LibraryProvider, SettingsProvider, SnackbarProvider, useSettings } from './state/AppState';
import { AddContentContext } from './state/addContent';
import { type Route, navigate, parseRoute, routeHref, useHash } from './state/router';

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (fn: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', fn);
      return () => mql.removeEventListener('change', fn);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

const DESTINATIONS: { route: Route; label: string; icon: IconName }[] = [
  { route: { name: 'home' }, label: 'Inicio', icon: 'home' },
  { route: { name: 'library' }, label: 'Biblioteca', icon: 'library_books' },
  { route: { name: 'settings' }, label: 'Ajustes', icon: 'settings' },
];

function NavItems({ current }: { current: Route['name'] }) {
  return (
    <>
      {DESTINATIONS.map(({ route, label, icon }) => {
        const active = route.name === current;
        return (
          <a
            key={route.name}
            href={routeHref(route)}
            className="nav-item"
            aria-current={active ? 'page' : undefined}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              navigate(route);
            }}
          >
            <span className="nav-item__indicator state-layer">
              <Icon name={icon} filled={active} />
            </span>
            <span>{label}</span>
          </a>
        );
      })}
    </>
  );
}

function MiniPlayer() {
  const { engine, doc, close } = usePlayer();
  const { settings } = useSettings();
  const snapshot = useSnapshot();
  if (!doc || !engine) return null;
  const playing = snapshot.status === 'playing';
  const progress = snapshot.sentence >= 0 && doc.length ? snapshot.offset / doc.length : progressOf(doc);
  const remaining = estimateMinutes(doc.wordCount, settings.rate) * (1 - progress);
  return (
    <div className="mini-player" role="region" aria-label="Reproduciendo">
      <button
        type="button"
        className="mini-player__main state-layer"
        onClick={() => navigate({ name: 'reader', id: doc.id })}
      >
        <DocTile source={doc.source} />
        <span className="mini-player__text">
          <span className="title-small mini-player__title">{doc.title}</span>
          <span className="body-small">
            {playing ? 'Reproduciendo' : 'En pausa'} · quedan {formatDuration(remaining)}
          </span>
        </span>
      </button>
      <IconButton
        icon={playing ? 'pause' : 'play_arrow'}
        label={playing ? 'Pausar' : 'Reproducir'}
        variant="filled"
        onClick={() => engine.toggle()}
      />
      <IconButton icon="close" label="Cerrar reproductor" onClick={close} />
      <div className="mini-player__progress">
        <LinearProgress value={progress} label="Progreso" />
      </div>
    </div>
  );
}

function Shell() {
  const hash = useHash();
  const route = useMemo(() => parseRoute(hash), [hash]);
  const expanded = useMediaQuery('(min-width: 600px)');
  const { doc } = usePlayer();
  const [dialog, setDialog] = useState<'add' | 'paste' | null>(null);
  const [dragging, setDragging] = useState(false);
  const { importFiles, busy } = useFileImport();
  const { input, pick } = useFilePicker(importFiles);

  const addContent = useMemo(
    () => ({
      openAdd: () => setDialog('add'),
      openPaste: () => setDialog('paste'),
      pickFile: pick,
    }),
    [pick],
  );

  // Arrastrar y soltar archivos en cualquier parte de la ventana.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void importFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [importFiles]);

  // Lleva el foco al inicio de cada pantalla para lectores de pantalla.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.name]);

  const isReader = route.name === 'reader';
  const showFab = !isReader && route.name !== 'settings';
  const showMini = !isReader && doc !== null;

  return (
    <AddContentContext.Provider value={addContent}>
      <div
        className="app"
        data-layout={expanded ? 'expanded' : 'compact'}
        data-reader={isReader || undefined}
        data-mini={showMini || undefined}
      >
        {expanded && !isReader && (
          <nav className="nav-rail" aria-label="Principal">
            <Fab icon="add" label="Nuevo" className="nav-rail__fab" onClick={addContent.openAdd} />
            <NavItems current={route.name} />
          </nav>
        )}

        <main className="app__content">
          {route.name === 'home' && <Home />}
          {route.name === 'library' && <Library />}
          {route.name === 'settings' && <Settings />}
          {route.name === 'reader' && <Reader key={route.id} id={route.id} />}
        </main>

        {!isReader && (
          <div className="app__bottom">
            {showFab && !expanded && (
              <Fab icon="add" label="Nuevo" extended className="app__fab" onClick={addContent.openAdd} />
            )}
            {showMini && <MiniPlayer />}
            {!expanded && (
              <nav className="nav-bar" aria-label="Principal">
                <NavItems current={route.name} />
              </nav>
            )}
          </div>
        )}
      </div>

      {input}
      <AddSheet
        open={dialog === 'add'}
        onClose={() => setDialog(null)}
        onPaste={() => setDialog('paste')}
        onPickFile={() => {
          setDialog(null);
          pick();
        }}
      />
      <PasteDialog open={dialog === 'paste'} onClose={() => setDialog(null)} />

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay__card">
            <Icon name="upload_file" size={48} />
            <p className="headline-small">Suelta para añadir</p>
            <p className="body-medium">PDF, EPUB, Word, TXT, Markdown o HTML</p>
          </div>
        </div>
      )}
      {busy && (
        <div className="busy" role="status" aria-live="polite">
          <span className="loading-indicator loading-indicator--small" />
          <span className="body-medium">Importando…</span>
        </div>
      )}
    </AddContentContext.Provider>
  );
}

export function App() {
  return (
    <SettingsProvider>
      <SnackbarProvider>
        <LibraryProvider>
          <PlayerProvider>
            <Shell />
          </PlayerProvider>
        </LibraryProvider>
      </SnackbarProvider>
    </SettingsProvider>
  );
}
