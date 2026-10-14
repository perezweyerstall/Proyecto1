// Voz natural de Google: selección de voz, código de acceso y uso gratuito del mes.

import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Icon, IconButton, LinearProgress } from '../components/ui';
import { clipKey, createClipCache } from '../lib/audioCache';
import { SILENCE } from '../lib/audioEngine';
import { CLOUD_VOICES, TtsError, type Usage, cloudVoiceName, formatResetDate } from '../lib/cloudVoice';
import { useNotify, useSettings } from '../state/AppState';
import { usePlayer } from './PlayerContext';
import { VoiceSheet } from './VoiceSheet';

const SAMPLE = 'Hola. Así sonará cualquier texto que quieras escuchar, con una lectura tranquila y natural.';
const previewCache = createClipCache();
const numberFormat = new Intl.NumberFormat('es');

export function cloudVoiceLabel(id: string): string {
  return `${cloudVoiceName(id)} · español latino`;
}

/** Reproduce una muestra de la voz. Usa la caché para no gastar cuota dos veces. */
function usePreview() {
  const { client, engine } = usePlayer();
  const notify = useNotify();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => () => audioRef.current?.pause(), []);

  return {
    loading,
    async play(voice: string) {
      if (!client) return;
      engine?.pause();
      // El elemento se crea y se activa dentro del toque: Safari lo exige.
      audioRef.current?.pause();
      const audio = new Audio(SILENCE);
      audioRef.current = audio;
      audio.play().catch(() => {});
      setLoading(voice);
      try {
        const key = clipKey(voice, SAMPLE);
        let blob = await previewCache.get(key);
        if (!blob) {
          blob = await client.synthesize(SAMPLE, voice);
          void previewCache.put(key, blob);
        }
        if (audioRef.current !== audio) return;
        audio.src = URL.createObjectURL(blob);
        await audio.play();
      } catch (error) {
        const code = error instanceof TtsError ? error.code : 'server';
        notify(
          code === 'missing-code' || code === 'unauthorized'
            ? 'Escribe un código de acceso válido para escuchar las voces.'
            : code === 'monthly-limit'
              ? 'Se agotó el uso gratuito de este mes.'
              : 'No se pudo reproducir la muestra.',
        );
      } finally {
        setLoading((current) => (current === voice ? null : current));
      }
    },
  };
}

export function CloudVoiceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, update } = useSettings();
  const preview = usePreview();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      sheet
      flush
      title="Voz natural"
      actions={
        <Button variant="filled" onClick={onClose}>
          Listo
        </Button>
      }
    >
      <p className="sheet-note body-medium">
        Voces de Google (Chirp 3 HD) en español latino neutro. Escucha una muestra y elige la que prefieras.
      </p>
      <ul className="list" role="radiogroup" aria-label="Voces naturales">
        {CLOUD_VOICES.map((voice) => {
          const selected = settings.cloudVoice === voice.id;
          return (
            <li key={voice.id} className="voice-row">
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                className="list-item state-layer"
                onClick={() => update({ cloudVoice: voice.id })}
              >
                <span className="list-item__leading">
                  <Icon name={selected ? 'check' : 'record_voice_over'} />
                </span>
                <span className="list-item__text">
                  <span className="list-item__headline">{voice.name}</span>
                  <span className="list-item__supporting">{voice.description}</span>
                </span>
              </button>
              <IconButton
                icon={preview.loading === voice.id ? 'graphic_eq' : 'volume_up'}
                label={`Escuchar a ${voice.name}`}
                onClick={() => void preview.play(voice.id)}
              />
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

/** Selector de voz adecuado al motor activo. */
export function VoicePicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { cloud, voices, voice, doc, engine } = usePlayer();
  const { settings, update } = useSettings();
  if (cloud) return <CloudVoiceSheet open={open} onClose={onClose} />;
  return (
    <VoiceSheet
      open={open}
      voices={voices}
      selectedURI={settings.voiceURI}
      activeVoice={voice}
      preferredLang={doc?.lang ?? navigator.language}
      rate={settings.rate}
      onSelect={(voiceURI) => update({ voiceURI })}
      onBeforePreview={() => engine?.pause()}
      onClose={onClose}
    />
  );
}

export function AccessCodeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, update } = useSettings();
  const { refreshUsage, client } = usePlayer();
  const notify = useNotify();
  const [code, setCode] = useState(settings.accessCode);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode(settings.accessCode);
    setError('');
  }, [open, settings.accessCode]);

  const save = async () => {
    const value = code.trim();
    update({ accessCode: value });
    if (!client || !value) {
      onClose();
      return;
    }
    setChecking(true);
    try {
      await client.usage(value);
      notify('Código correcto. La voz natural está lista.');
      onClose();
    } catch (err) {
      const codeError = err instanceof TtsError ? err.code : 'server';
      if (codeError === 'unauthorized') setError('Código incorrecto. Revísalo e inténtalo de nuevo.');
      else {
        notify('Código guardado. No se pudo comprobar ahora.');
        onClose();
      }
    } finally {
      setChecking(false);
      void refreshUsage();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Código de acceso"
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="text" type="submit" form="access-code-form" disabled={checking}>
            Guardar
          </Button>
        </>
      }
    >
      <form
        id="access-code-form"
        className="paste-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="body-medium">
          Es el código que guardaste como APP_TOKEN en GitHub. Solo se guarda en este dispositivo.
        </p>
        <label className="field">
          <span className="field__label">Código</span>
          <input
            className="field__input"
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={code}
            data-autofocus
            onChange={(e) => {
              setCode(e.currentTarget.value);
              setError('');
            }}
          />
          {error && (
            <span className="field__support field__support--error" role="alert">
              {error}
            </span>
          )}
        </label>
      </form>
    </Dialog>
  );
}

export function UsageMeter({ usage }: { usage: Usage | null }) {
  if (!usage) {
    return <p className="body-medium usage__text">Consultando el uso gratuito del mes…</p>;
  }
  const ratio = usage.limit > 0 ? usage.used / usage.limit : 0;
  const remainingMinutes = Math.max(0, Math.floor((usage.limit - usage.used) / 900));
  return (
    <div className="usage">
      <LinearProgress value={ratio} label="Uso gratuito del mes" />
      <p className="body-medium usage__text">
        {numberFormat.format(usage.used)} de {numberFormat.format(usage.limit)} caracteres · quedan unos{' '}
        {numberFormat.format(remainingMinutes)} minutos de escucha
      </p>
      <p className="body-small usage__note">
        Se renueva el {formatResetDate(usage.resetsOn)}. Al llegar al límite, la voz natural se detiene hasta
        entonces. Nunca se cobra nada.
      </p>
    </div>
  );
}
