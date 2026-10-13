// Hoja de selección de voz con búsqueda y vista previa.

import { useMemo, useState } from 'react';
import { Button, Dialog, Icon, IconButton } from '../components/ui';

let languageNames: Intl.DisplayNames | null = null;

export function languageLabel(lang: string): string {
  try {
    languageNames ??= new Intl.DisplayNames(['es'], { type: 'language' });
    const name = languageNames.of(lang.replace('_', '-')) ?? lang;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return lang;
  }
}

/** Nombre corto de la voz y etiquetas de calidad. */
export function describeVoice(voice: SpeechSynthesisVoice): { name: string; tags: string[] } {
  const tags: string[] = [];
  if (/natural|neural|wavenet|premium|enhanced/i.test(voice.name)) tags.push('Natural');
  if (!voice.localService) tags.push('En línea');
  const name = voice.name
    .replace(/^(Microsoft|Google|Apple)\s+/i, (m) => (/google/i.test(m) ? m : ''))
    .replace(/\s*\((Natural|Enhanced|Premium)\)/gi, '')
    .replace(/\s+Online/i, '')
    .replace(/\s+-\s+.*$/, '')
    .trim();
  return { name: name || voice.name, tags };
}

const SAMPLE: Record<string, string> = {
  es: 'Hola, esta es mi voz. ¿Te gusta cómo sueno?',
  en: 'Hi, this is my voice. Do you like how I sound?',
  pt: 'Olá, esta é a minha voz. Gostas de como soo?',
  fr: 'Bonjour, voici ma voix. Elle vous plaît ?',
  de: 'Hallo, das ist meine Stimme. Gefällt sie dir?',
  it: 'Ciao, questa è la mia voce. Ti piace?',
};

function preview(voice: SpeechSynthesisVoice, rate: number): void {
  if (typeof speechSynthesis === 'undefined') return;
  const base = voice.lang.toLowerCase().slice(0, 2);
  const utterance = new SpeechSynthesisUtterance(SAMPLE[base] ?? SAMPLE.en);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = rate;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

export function VoiceSheet({
  open,
  voices,
  selectedURI,
  activeVoice,
  preferredLang,
  rate,
  onSelect,
  onClose,
  onBeforePreview,
}: {
  open: boolean;
  voices: SpeechSynthesisVoice[];
  /** `null` significa voz automática. */
  selectedURI: string | null;
  activeVoice: SpeechSynthesisVoice | null;
  preferredLang: string;
  rate: number;
  onSelect: (voiceURI: string | null) => void;
  onClose: () => void;
  onBeforePreview?: () => void;
}) {
  const [query, setQuery] = useState('');
  const base = preferredLang.toLowerCase().slice(0, 2);

  const { suggested, others } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = voices.filter(
      (v) => !q || v.name.toLowerCase().includes(q) || languageLabel(v.lang).toLowerCase().includes(q),
    );
    const sorted = [...matches].sort(
      (a, b) => languageLabel(a.lang).localeCompare(languageLabel(b.lang), 'es') || a.name.localeCompare(b.name),
    );
    return {
      suggested: sorted.filter((v) => v.lang.toLowerCase().startsWith(base)),
      others: sorted.filter((v) => !v.lang.toLowerCase().startsWith(base)),
    };
  }, [voices, query, base]);

  const renderVoice = (voice: SpeechSynthesisVoice) => {
    const { name, tags } = describeVoice(voice);
    const selected = selectedURI === voice.voiceURI;
    return (
      <li key={voice.voiceURI} className="voice-row">
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          className="list-item state-layer"
          onClick={() => onSelect(voice.voiceURI)}
        >
          <span className="list-item__leading">
            <Icon name={selected ? 'check' : 'record_voice_over'} />
          </span>
          <span className="list-item__text">
            <span className="list-item__headline">{name}</span>
            <span className="list-item__supporting">{languageLabel(voice.lang)}</span>
          </span>
          <span className="list-item__trailing">
            {tags.map((tag) => (
              <span key={tag} className="tag">
                {tag}
              </span>
            ))}
          </span>
        </button>
        <IconButton
          icon="volume_up"
          label={`Escuchar ${name}`}
          onClick={() => {
            onBeforePreview?.();
            preview(voice, rate);
          }}
        />
      </li>
    );
  };

  const autoName = activeVoice ? describeVoice(activeVoice).name : 'Sin voces';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      sheet
      title="Voz"
      flush
      className="voice-sheet"
      actions={
        <Button variant="filled" onClick={onClose}>
          Listo
        </Button>
      }
    >
      <div className="voice-sheet__search">
        <label className="search-bar">
          <Icon name="search" />
          <input
            type="search"
            placeholder="Buscar voz o idioma"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
        </label>
      </div>
      {voices.length === 0 ? (
        <p className="empty-note body-medium">
          Tu navegador no ofrece voces. Prueba con Chrome, Edge o Safari actualizados.
        </p>
      ) : (
        <ul className="list" role="radiogroup" aria-label="Voces disponibles">
          {!query && (
            <li className="voice-row">
              <button
                type="button"
                role="radio"
                aria-checked={selectedURI === null}
                className="list-item state-layer"
                onClick={() => onSelect(null)}
              >
                <span className="list-item__leading">
                  <Icon name={selectedURI === null ? 'check' : 'translate'} />
                </span>
                <span className="list-item__text">
                  <span className="list-item__headline">Automática</span>
                  <span className="list-item__supporting">Según el idioma del documento · {autoName}</span>
                </span>
              </button>
            </li>
          )}
          {suggested.length > 0 && <li className="list-subheader">{languageLabel(base)}</li>}
          {suggested.map(renderVoice)}
          {others.length > 0 && <li className="list-subheader">Otros idiomas</li>}
          {others.map(renderVoice)}
        </ul>
      )}
    </Dialog>
  );
}
