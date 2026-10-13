// Pantalla de inicio: continuar escuchando, acciones rápidas y estadísticas.

import { DocCard, DocTile, docMetaLine, progressOf } from '../components/docs';
import { Button, Icon, LinearProgress } from '../components/ui';
import { BASE_WPM, formatDuration } from '../lib/text';
import { usePlaybackStatus, usePlayer } from '../player/PlayerContext';
import { useLibrary, useSettings } from '../state/AppState';
import { useAddContent } from '../state/addContent';
import { navigate } from '../state/router';
import { dayKey, streak, totalWords } from '../state/settings';
import { useDocActions } from './Library';

function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 6) return 'Buenas noches';
  if (h < 13) return 'Buenos días';
  if (h < 21) return 'Buenas tardes';
  return 'Buenas noches';
}

const numberFormat = new Intl.NumberFormat('es');

export function Home() {
  const { docs, loading, stats } = useLibrary();
  const { settings } = useSettings();
  const { engine, doc: loaded, open } = usePlayer();
  const status = usePlaybackStatus();
  const { openPaste, pickFile } = useAddContent();
  const { actionsFor, dialogs } = useDocActions();

  const current = docs.find((d) => progressOf(d) < 0.995 && d.lastOpenedAt !== null) ?? null;
  const recent = docs.filter((d) => d.id !== current?.id).slice(0, 3);
  const today = stats[dayKey()] ?? 0;
  const days = streak(stats);
  const minutes = totalWords(stats) / BASE_WPM;
  const isLoaded = current && loaded?.id === current.id;
  const playing = isLoaded && status === 'playing';

  return (
    <div className="page">
      <header className="page-header">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <Icon name="graphic_eq" size={22} />
          </span>
          <span className="title-large">Escucha</span>
        </div>
      </header>

      <section className="hero">
        <h1 className="display-small">{greeting()}</h1>
        <p className="body-large hero__sub">¿Qué quieres escuchar hoy?</p>
      </section>

      {current && (
        <section className="continue" aria-label="Continuar escuchando">
          <button
            type="button"
            className="continue__main state-layer"
            onClick={() => navigate({ name: 'reader', id: current.id })}
          >
            <span className="label-large continue__eyebrow">Continuar escuchando</span>
            <span className="continue__row">
              <DocTile source={current.source} size="large" />
              <span className="continue__text">
                <span className="headline-small continue__title">{current.title}</span>
                <span className="body-medium">{docMetaLine(current, settings.rate)}</span>
              </span>
            </span>
            <LinearProgress value={progressOf(current)} label="Progreso" />
          </button>
          <button
            type="button"
            className={`play-btn play-btn--hero state-layer ${playing ? 'play-btn--playing' : ''}`}
            aria-label={playing ? 'Pausar' : `Reproducir ${current.title}`}
            onClick={async () => {
              if (!engine) return navigate({ name: 'reader', id: current.id });
              if (!isLoaded && !(await open(current.id))) return;
              engine.toggle();
            }}
          >
            <Icon name={playing ? 'pause' : 'play_arrow'} filled size={32} />
          </button>
        </section>
      )}

      <section className="quick-actions" aria-label="Añadir contenido">
        <button type="button" className="quick-card quick-card--primary state-layer" onClick={openPaste}>
          <Icon name="content_paste" size={28} />
          <span className="title-medium">Pegar texto</span>
          <span className="body-small">Escucha cualquier texto al instante</span>
        </button>
        <button type="button" className="quick-card quick-card--tertiary state-layer" onClick={pickFile}>
          <Icon name="upload_file" size={28} />
          <span className="title-medium">Subir archivo</span>
          <span className="body-small">PDF, EPUB, Word y más</span>
        </button>
      </section>

      <section className="stats" aria-label="Estadísticas">
        <div className="stat">
          <Icon name="headphones" className="stat__icon" />
          <span className="headline-medium">{numberFormat.format(today)}</span>
          <span className="label-medium">palabras hoy</span>
        </div>
        <div className="stat">
          <Icon name="local_fire_department" filled className="stat__icon stat__icon--fire" />
          <span className="headline-medium">{days}</span>
          <span className="label-medium">{days === 1 ? 'día seguido' : 'días seguidos'}</span>
        </div>
        <div className="stat">
          <Icon name="schedule" className="stat__icon" />
          <span className="headline-medium">{formatDuration(minutes).replace(/:\d\d$/, '')}</span>
          <span className="label-medium">{minutes >= 60 ? 'horas escuchadas' : 'minutos escuchados'}</span>
        </div>
      </section>

      {recent.length > 0 && (
        <section className="section">
          <div className="section__header">
            <h2 className="title-large">Recientes</h2>
            <Button variant="text" onClick={() => navigate({ name: 'library' })}>
              Ver todo
            </Button>
          </div>
          <ul className="doc-list">
            {recent.map((doc) => (
              <DocCard
                key={doc.id}
                doc={doc}
                rate={settings.rate}
                onOpen={() => navigate({ name: 'reader', id: doc.id })}
                actions={actionsFor(doc)}
              />
            ))}
          </ul>
        </section>
      )}

      {!loading && docs.length === 0 && (
        <p className="body-medium empty-note">Tu biblioteca está vacía. Añade un texto para empezar.</p>
      )}
      {dialogs}
    </div>
  );
}
