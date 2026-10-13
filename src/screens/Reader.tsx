// Pantalla de lectura: texto con resaltado sincronizado y controles de reproducción.

import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Button, Dialog, Icon, IconButton, OverflowMenu, Segmented, Slider, Switch } from '../components/ui';
import type { Paragraph, Range, Sentence } from '../lib/text';
import { estimateMinutes, formatDuration } from '../lib/text';
import { formatRate, SpeedSheet } from '../player/SpeedSheet';
import { VoiceSheet, describeVoice } from '../player/VoiceSheet';
import { usePlayer, useSnapshot } from '../player/PlayerContext';
import { useLibrary, useNotify, useSettings } from '../state/AppState';
import { goBack, navigate } from '../state/router';
import { RATE_MAX, RATE_MIN, type ReaderFont } from '../state/settings';
import { RenameDialog, ConfirmDeleteDialog } from './dialogs';

const ParagraphView = memo(function ParagraphView({
  text,
  paragraph,
  sentences,
  activeSentence,
  word,
}: {
  text: string;
  paragraph: Paragraph;
  sentences: Sentence[];
  activeSentence: number;
  word: Range | null;
}) {
  const parts: ReactNode[] = [];
  let cursor = paragraph.start;
  for (let i = paragraph.firstSentence; i < paragraph.endSentence; i++) {
    const s = sentences[i];
    if (s.start > cursor) parts.push(text.slice(cursor, s.start));
    const active = i === activeSentence;
    if (active && word && word.start >= s.start && word.end <= s.end) {
      parts.push(
        <span key={i} data-s={i} className="sentence sentence--active">
          {text.slice(s.start, word.start)}
          <mark className="word">{text.slice(word.start, word.end)}</mark>
          {text.slice(word.end, s.end)}
        </span>,
      );
    } else {
      parts.push(
        <span key={i} data-s={i} className={active ? 'sentence sentence--active' : 'sentence'}>
          {text.slice(s.start, s.end)}
        </span>,
      );
    }
    cursor = s.end;
  }
  if (cursor < paragraph.end) parts.push(text.slice(cursor, paragraph.end));
  return <p className="reader__paragraph">{parts}</p>;
});

function ReaderSettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, update } = useSettings();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      sheet
      title="Texto"
      actions={
        <Button variant="filled" onClick={onClose}>
          Listo
        </Button>
      }
    >
      <div className="sheet-form">
        <div className="sheet-form__row">
          <span className="body-large">Tamaño</span>
          <div className="font-size-row">
            <Icon name="text_fields" size={18} />
            <Slider
              value={settings.fontScale}
              min={0.8}
              max={1.6}
              step={0.05}
              label="Tamaño del texto"
              valueText={`${Math.round(settings.fontScale * 100)} %`}
              onChange={(fontScale) => update({ fontScale })}
            />
            <Icon name="text_fields" size={28} />
          </div>
        </div>
        <div className="sheet-form__row">
          <span className="body-large">Tipo de letra</span>
          <Segmented<ReaderFont>
            label="Tipo de letra"
            value={settings.readerFont}
            onChange={(readerFont) => update({ readerFont })}
            options={[
              { value: 'sans', label: 'Sans' },
              { value: 'serif', label: 'Serif' },
            ]}
          />
        </div>
        <label className="sheet-form__switch">
          <span className="body-large">Resaltar palabra a palabra</span>
          <Switch
            label="Resaltar palabra a palabra"
            checked={settings.highlightWords}
            onChange={(highlightWords) => update({ highlightWords })}
          />
        </label>
        <label className="sheet-form__switch">
          <span className="body-large">Seguir la lectura al desplazar</span>
          <Switch
            label="Seguir la lectura al desplazar"
            checked={settings.autoScroll}
            onChange={(autoScroll) => update({ autoScroll })}
          />
        </label>
      </div>
    </Dialog>
  );
}

function PlayerPanel({
  onSpeed,
  onVoice,
  onControl,
}: {
  onSpeed: () => void;
  onVoice: () => void;
  /** Se llama al usar un control de reproducción. */
  onControl: () => void;
}) {
  const { engine, doc, segmented, voice } = usePlayer();
  const { settings } = useSettings();
  const snapshot = useSnapshot();
  const [scrub, setScrub] = useState<number | null>(null);
  const length = segmented?.text.length ?? 0;
  const offset = scrub ?? snapshot.offset;
  const progress = length ? offset / length : 0;
  const total = estimateMinutes(doc?.wordCount ?? 0, settings.rate);
  const playing = snapshot.status === 'playing';

  return (
    <footer className="player">
      <div className="player__progress">
        <Slider
          small
          value={offset}
          min={0}
          max={Math.max(length, 1)}
          step={1}
          label="Posición de lectura"
          valueText={`${Math.round(progress * 100)} %`}
          onChange={setScrub}
          onCommit={(value) => {
            setScrub(null);
            engine?.seek(value);
            onControl();
          }}
        />
        <div className="player__times label-medium">
          <span>{formatDuration(total * progress)}</span>
          <span>−{formatDuration(total * (1 - progress))}</span>
        </div>
      </div>
      <div className="player__controls">
        <button type="button" className="player__pill state-layer" onClick={onSpeed} aria-label="Velocidad">
          <span className="label-large">{formatRate(settings.rate)}</span>
        </button>
        <IconButton
          icon="fast_rewind"
          label="Frase anterior"
          className="icon-btn--large"
          size={32}
          filled
          onClick={() => {
            engine?.previous();
            onControl();
          }}
        />
        <button
          type="button"
          className={`play-btn state-layer ${playing ? 'play-btn--playing' : ''}`}
          aria-label={playing ? 'Pausar' : 'Reproducir'}
          onClick={() => {
            engine?.toggle();
            onControl();
          }}
        >
          <Icon name={playing ? 'pause' : 'play_arrow'} filled size={36} />
        </button>
        <IconButton
          icon="fast_forward"
          label="Frase siguiente"
          className="icon-btn--large"
          size={32}
          filled
          onClick={() => {
            engine?.next();
            onControl();
          }}
        />
        <button
          type="button"
          className="player__pill state-layer"
          onClick={onVoice}
          aria-label={`Voz: ${voice ? describeVoice(voice).name : 'ninguna'}`}
        >
          <Icon name="record_voice_over" size={20} />
        </button>
      </div>
    </footer>
  );
}

export function Reader({ id }: { id: string }) {
  const player = usePlayer();
  const { engine, segmented, doc, voices, voice, open } = player;
  const { settings, update } = useSettings();
  const { remove, rename } = useLibrary();
  const notify = useNotify();
  const snapshot = useSnapshot();
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>(
    doc?.id === id && segmented ? 'ready' : 'loading',
  );
  const [sheet, setSheet] = useState<'speed' | 'voice' | 'text' | 'rename' | 'delete' | null>(null);
  const [following, setFollowing] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    open(id).then(
      (found) => !cancelled && setState(found ? 'ready' : 'missing'),
      () => !cancelled && setState('missing'),
    );
    return () => {
      cancelled = true;
    };
  }, [id, open]);

  const ready = state === 'ready' && doc?.id === id && segmented;

  // Desplaza para mantener visible la frase o palabra actual.
  useLayoutEffect(() => {
    if (!ready || !following || !settings.autoScroll || snapshot.sentence < 0) return;
    const scroller = scrollRef.current;
    const article = articleRef.current;
    if (!scroller || !article) return;
    const target =
      article.querySelector<HTMLElement>('mark.word') ??
      article.querySelector<HTMLElement>(`[data-s="${snapshot.sentence}"]`);
    if (!target) return;
    const box = scroller.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const top = rect.top - box.top;
    if (top < box.height * 0.12 || rect.bottom - box.top > box.height * 0.7) {
      scroller.scrollTo({
        top: scroller.scrollTop + top - box.height * 0.3,
        behavior: snapshot.status === 'playing' ? 'smooth' : 'auto',
      });
    }
  }, [ready, following, settings.autoScroll, snapshot.sentence, snapshot.word, snapshot.status]);

  // El desplazamiento manual detiene el seguimiento automático.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const stopFollowing = () => setFollowing(false);
    const onKey = (e: KeyboardEvent) => {
      if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(e.key)) stopFollowing();
    };
    const onScroll = () => setScrolled(scroller.scrollTop > 4);
    scroller.addEventListener('wheel', stopFollowing, { passive: true });
    scroller.addEventListener('touchmove', stopFollowing, { passive: true });
    scroller.addEventListener('keydown', onKey);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('wheel', stopFollowing);
      scroller.removeEventListener('touchmove', stopFollowing);
      scroller.removeEventListener('keydown', onKey);
      scroller.removeEventListener('scroll', onScroll);
    };
  }, [ready]);

  // Atajos de teclado.
  useEffect(() => {
    if (!engine) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (sheet || e.metaKey || e.ctrlKey || e.altKey) return;
      // Los campos de texto y deslizadores usan sus propias teclas.
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      // La barra espaciadora sobre un botón lo activa.
      if (e.key === ' ' && target.closest('button')) return;
      const step = (delta: number) => {
        const rate = Math.min(RATE_MAX, Math.max(RATE_MIN, Math.round((settings.rate + delta) * 20) / 20));
        update({ rate });
        notify(`Velocidad ${formatRate(rate)}`);
      };
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          engine.toggle();
          setFollowing(true);
          break;
        case 'ArrowRight':
        case 'l':
          e.preventDefault();
          engine.next();
          setFollowing(true);
          break;
        case 'ArrowLeft':
        case 'j':
          e.preventDefault();
          engine.previous();
          setFollowing(true);
          break;
        case '+':
        case '=':
          step(0.1);
          break;
        case '-':
          step(-0.1);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, sheet, settings.rate, update, notify]);

  const onTextClick = useCallback(
    (e: MouseEvent) => {
      if (!engine || !segmented) return;
      if (window.getSelection()?.isCollapsed === false) return;
      const span = (e.target as HTMLElement).closest<HTMLElement>('[data-s]');
      if (!span) return;
      const index = Number(span.dataset.s);
      engine.seek(segmented.sentences[index].start);
      if (engine.getSnapshot().status !== 'playing') engine.play();
      setFollowing(true);
    },
    [engine, segmented],
  );

  const back = () => goBack({ name: 'library' });

  if (state === 'missing') {
    return (
      <div className="reader reader--empty">
        <header className="top-bar">
          <IconButton icon="arrow_back" label="Volver" onClick={back} />
        </header>
        <div className="empty-state">
          <span className="empty-state__art">
            <Icon name="error" size={48} />
          </span>
          <h1 className="headline-small">No encontramos este documento</h1>
          <p className="body-medium">Puede que se haya eliminado.</p>
          <Button variant="filled" icon="library_books" onClick={() => navigate({ name: 'library' }, true)}>
            Ir a la biblioteca
          </Button>
        </div>
      </div>
    );
  }

  const activeParagraph = ready && snapshot.sentence >= 0 ? segmented.sentences[snapshot.sentence]?.paragraph : -1;
  const word = settings.highlightWords ? snapshot.word : null;
  const showJump = ready && !following && settings.autoScroll && snapshot.sentence >= 0;
  const textStyle = {
    '--reader-scale': settings.fontScale,
  } as CSSProperties;

  return (
    <div className="reader">
      <header className={`top-bar ${scrolled ? 'top-bar--scrolled' : ''}`}>
        <IconButton icon="arrow_back" label="Volver" onClick={back} />
        <h1 className="top-bar__title title-large">{ready ? doc.title : ''}</h1>
        <IconButton icon="format_size" label="Ajustes de texto" onClick={() => setSheet('text')} />
        {ready && (
          <OverflowMenu
            label="Más opciones"
            actions={[
              { label: 'Cambiar nombre', icon: 'edit', onSelect: () => setSheet('rename') },
              { label: 'Eliminar', icon: 'delete', danger: true, onSelect: () => setSheet('delete') },
            ]}
          />
        )}
      </header>

      <div className="reader__scroll" ref={scrollRef} tabIndex={-1}>
        {!player.supported && (
          <div className="banner body-medium" role="alert">
            <Icon name="error" />
            Este navegador no admite síntesis de voz. Usa Chrome, Edge, Safari o Firefox actualizados.
          </div>
        )}
        {ready ? (
          <article
            ref={articleRef}
            className={`reader__text reader__text--${settings.readerFont}`}
            style={textStyle}
            onClick={onTextClick}
            lang={doc.lang ?? undefined}
          >
            {segmented.paragraphs.map((p, index) => (
              <ParagraphView
                key={index}
                text={segmented.text}
                paragraph={p}
                sentences={segmented.sentences}
                activeSentence={index === activeParagraph ? snapshot.sentence : -1}
                word={index === activeParagraph ? word : null}
              />
            ))}
          </article>
        ) : (
          <div className="reader__loading" role="progressbar" aria-label="Cargando documento">
            <span className="loading-indicator" />
          </div>
        )}
      </div>

      {showJump && (
        <button type="button" className="jump-btn state-layer label-large" onClick={() => setFollowing(true)}>
          <Icon name="my_location" size={18} />
          Volver a la lectura
        </button>
      )}

      {ready && (
        <PlayerPanel
          onSpeed={() => setSheet('speed')}
          onVoice={() => setSheet('voice')}
          onControl={() => setFollowing(true)}
        />
      )}

      <SpeedSheet
        open={sheet === 'speed'}
        rate={settings.rate}
        onChange={(rate) => update({ rate })}
        onClose={() => setSheet(null)}
      />
      <VoiceSheet
        open={sheet === 'voice'}
        voices={voices}
        selectedURI={settings.voiceURI}
        activeVoice={voice}
        preferredLang={doc?.lang ?? navigator.language}
        rate={settings.rate}
        onSelect={(voiceURI) => update({ voiceURI })}
        onBeforePreview={() => engine?.pause()}
        onClose={() => setSheet(null)}
      />
      <ReaderSettingsSheet open={sheet === 'text'} onClose={() => setSheet(null)} />
      {doc && (
        <>
          <RenameDialog
            open={sheet === 'rename'}
            initial={doc.title}
            onClose={() => setSheet(null)}
            onSave={async (title) => {
              await rename(doc.id, title);
              setSheet(null);
            }}
          />
          <ConfirmDeleteDialog
            open={sheet === 'delete'}
            title={doc.title}
            onClose={() => setSheet(null)}
            onConfirm={async () => {
              player.close();
              await remove(doc.id);
              setSheet(null);
              notify('Documento eliminado');
              navigate({ name: 'library' }, true);
            }}
          />
        </>
      )}
    </div>
  );
}
