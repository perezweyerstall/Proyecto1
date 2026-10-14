// Ajustes: apariencia, voz, lectura y datos.

import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import { Button, Dialog, Icon, Segmented, Slider, Switch } from '../components/ui';
import type { IconName } from '../components/icons';
import { AccessCodeDialog, UsageMeter, VoicePicker, cloudVoiceLabel } from '../player/CloudVoiceSheet';
import { SpeedSheet, formatRate } from '../player/SpeedSheet';
import { describeVoice } from '../player/VoiceSheet';
import { usePlayer } from '../player/PlayerContext';
import { useLibrary, useNotify, useSettings } from '../state/AppState';
import type { ReaderFont, ThemeMode } from '../state/settings';
import { SEEDS } from '../theme/color';

function Row({
  icon,
  headline,
  supporting,
  trailing,
  onClick,
}: {
  icon: IconName;
  headline: string;
  supporting?: string;
  trailing?: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="list-item__leading">
        <Icon name={icon} />
      </span>
      <span className="list-item__text">
        <span className="list-item__headline">{headline}</span>
        {supporting && <span className="list-item__supporting">{supporting}</span>}
      </span>
      {trailing && <span className="list-item__trailing">{trailing}</span>}
    </>
  );
  return (
    <li>
      {onClick ? (
        <button type="button" className="list-item state-layer" onClick={onClick}>
          {content}
        </button>
      ) : (
        <div className="list-item">{content}</div>
      )}
    </li>
  );
}

export function Settings() {
  const { settings, update } = useSettings();
  const { voices, voice, close, cloud, cloudAvailable, usage, refreshUsage } = usePlayer();
  const { clear, docs } = useLibrary();
  const notify = useNotify();
  const [sheet, setSheet] = useState<'speed' | 'voice' | 'code' | 'clear' | null>(null);

  // Consulta el uso gratuito del mes al abrir Ajustes.
  useEffect(() => {
    if (cloud && settings.accessCode) void refreshUsage();
  }, [cloud, settings.accessCode, refreshUsage]);

  const chosen = settings.voiceURI ? voices.find((v) => v.voiceURI === settings.voiceURI) : undefined;
  const deviceVoiceLabel = settings.voiceURI
    ? chosen
      ? describeVoice(chosen).name
      : 'No disponible en este dispositivo'
    : `Automática${voice ? ` · ${describeVoice(voice).name}` : ''}`;
  const voiceLabel = cloud ? cloudVoiceLabel(settings.cloudVoice) : deviceVoiceLabel;

  return (
    <div className="page">
      <header className="page-header page-header--stacked">
        <h1 className="headline-medium">Ajustes</h1>
      </header>

      <section className="settings-group" aria-labelledby="s-appearance">
        <h2 id="s-appearance" className="list-subheader">
          Apariencia
        </h2>
        <div className="settings-card">
          <div className="settings-block">
            <span className="body-large">Tema</span>
            <Segmented<ThemeMode>
              label="Tema"
              value={settings.themeMode}
              onChange={(themeMode) => update({ themeMode })}
              options={[
                { value: 'system', label: 'Sistema', icon: 'brightness_auto' },
                { value: 'light', label: 'Claro', icon: 'light_mode' },
                { value: 'dark', label: 'Oscuro', icon: 'dark_mode' },
              ]}
            />
          </div>
          <div className="settings-block">
            <span className="body-large">Color</span>
            <div className="swatches" role="radiogroup" aria-label="Color de acento">
              {SEEDS.map((seed) => {
                const selected = seed.hex.toLowerCase() === settings.seedColor.toLowerCase();
                return (
                  <button
                    key={seed.hex}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={seed.name}
                    title={seed.name}
                    className="swatch"
                    style={{ '--swatch': seed.hex } as CSSProperties}
                    onClick={() => update({ seedColor: seed.hex })}
                  >
                    {selected && <Icon name="check" size={20} />}
                  </button>
                );
              })}
              <label className="swatch swatch--custom" title="Color personalizado">
                <Icon name="palette" size={20} />
                <input
                  type="color"
                  aria-label="Color personalizado"
                  value={settings.seedColor}
                  onChange={(e) => update({ seedColor: e.currentTarget.value })}
                />
              </label>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-group" aria-labelledby="s-voice">
        <h2 id="s-voice" className="list-subheader">
          Voz
        </h2>
        <div className="settings-card">
          <ul className="list">
            {cloudAvailable && (
              <Row
                icon="auto_stories"
                headline="Voz natural de Google"
                supporting={
                  cloud ? 'Español latino, igual en todos tus dispositivos' : 'Desactivada: suena la voz del dispositivo'
                }
                trailing={
                  <Switch
                    label="Voz natural de Google"
                    checked={settings.voiceSource === 'cloud'}
                    onChange={(on) => update({ voiceSource: on ? 'cloud' : 'device' })}
                  />
                }
              />
            )}
            <Row icon="record_voice_over" headline="Voz" supporting={voiceLabel} onClick={() => setSheet('voice')} />
            {cloud && (
              <Row
                icon="keyboard"
                headline="Código de acceso"
                supporting={
                  settings.accessCode ? 'Guardado en este dispositivo' : 'Falta: escríbelo para usar la voz natural'
                }
                onClick={() => setSheet('code')}
              />
            )}
            <Row
              icon="speed"
              headline="Velocidad"
              supporting={
                cloud ? `${formatRate(settings.rate)} · no cambia el uso gratuito` : formatRate(settings.rate)
              }
              onClick={() => setSheet('speed')}
            />
          </ul>
          {cloud && settings.accessCode && (
            <div className="settings-block settings-block--divided">
              <span className="body-large">Uso gratuito de este mes</span>
              <UsageMeter usage={usage} />
            </div>
          )}
        </div>
      </section>

      <section className="settings-group" aria-labelledby="s-reading">
        <h2 id="s-reading" className="list-subheader">
          Lectura
        </h2>
        <div className="settings-card">
          <div className="settings-block">
            <span className="body-large">Tamaño del texto</span>
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
            <p
              className={`settings-preview reader__text--${settings.readerFont}`}
              style={{ fontSize: `${20 * settings.fontScale}px` }}
            >
              Así se verá el texto mientras escuchas.
            </p>
          </div>
          <div className="settings-block">
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
          <ul className="list">
            <Row
              icon="auto_stories"
              headline="Resaltar palabra a palabra"
              supporting="Marca la palabra que suena"
              trailing={
                <Switch
                  label="Resaltar palabra a palabra"
                  checked={settings.highlightWords}
                  onChange={(highlightWords) => update({ highlightWords })}
                />
              }
            />
            <Row
              icon="my_location"
              headline="Seguir la lectura"
              supporting="Desplaza el texto de forma automática"
              trailing={
                <Switch
                  label="Seguir la lectura"
                  checked={settings.autoScroll}
                  onChange={(autoScroll) => update({ autoScroll })}
                />
              }
            />
          </ul>
        </div>
      </section>

      <section className="settings-group" aria-labelledby="s-data">
        <h2 id="s-data" className="list-subheader">
          Datos
        </h2>
        <ul className="list settings-card">
          <Row
            icon="delete_forever"
            headline="Borrar biblioteca"
            supporting={`${docs.length} ${docs.length === 1 ? 'documento' : 'documentos'} en este navegador`}
            onClick={() => setSheet('clear')}
          />
          <Row
            icon="info"
            headline="Escucha 0.2.0"
            supporting={
              cloudAvailable
                ? 'Tus documentos se guardan en este navegador. La voz natural envía a Google el texto de cada frase.'
                : 'Usa las voces de tu dispositivo. Tus documentos no salen de este navegador.'
            }
          />
          <Row
            icon="keyboard"
            headline="Atajos de teclado"
            supporting="Espacio: reproducir o pausar · ← →: frase anterior o siguiente · + −: velocidad"
          />
        </ul>
      </section>

      <SpeedSheet
        open={sheet === 'speed'}
        rate={settings.rate}
        onChange={(rate) => update({ rate })}
        onClose={() => setSheet(null)}
        note={cloud ? 'La velocidad no cambia el uso gratuito.' : undefined}
      />
      <VoicePicker open={sheet === 'voice'} onClose={() => setSheet(null)} />
      <AccessCodeDialog open={sheet === 'code'} onClose={() => setSheet(null)} />
      <Dialog
        open={sheet === 'clear'}
        onClose={() => setSheet(null)}
        icon="delete_forever"
        title="¿Borrar la biblioteca?"
        actions={
          <>
            <Button variant="text" onClick={() => setSheet(null)}>
              Cancelar
            </Button>
            <Button
              variant="text"
              onClick={async () => {
                close();
                await clear();
                setSheet(null);
                notify('Biblioteca borrada');
              }}
            >
              Borrar todo
            </Button>
          </>
        }
      >
        <p className="body-medium">
          Se eliminarán todos los documentos, el progreso y las estadísticas de este navegador. Tus
          preferencias se mantienen.
        </p>
      </Dialog>
    </div>
  );
}
