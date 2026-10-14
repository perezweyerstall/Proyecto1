// Hoja de velocidad de lectura.

import { useEffect, useState } from 'react';
import { Button, Dialog, Icon, IconButton, Slider } from '../components/ui';
import { BASE_WPM } from '../lib/text';
import { RATE_MAX, RATE_MIN, RATE_PRESETS } from '../state/settings';

export function formatRate(rate: number): string {
  return `${rate.toLocaleString('es', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}×`;
}

const round = (n: number) => Math.round(n * 20) / 20;
const clamp = (n: number) => Math.min(RATE_MAX, Math.max(RATE_MIN, round(n)));

export function SpeedSheet({
  open,
  rate,
  onChange,
  onClose,
  note = 'Algunas voces limitan la velocidad máxima.',
}: {
  open: boolean;
  rate: number;
  onChange: (rate: number) => void;
  onClose: () => void;
  note?: string;
}) {
  const [draft, setDraft] = useState(rate);
  useEffect(() => setDraft(rate), [rate, open]);

  const commit = (value: number) => {
    const next = clamp(value);
    setDraft(next);
    onChange(next);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      sheet
      title="Velocidad de lectura"
      actions={
        <>
          <Button variant="text" onClick={() => commit(1)}>
            Restablecer
          </Button>
          <Button variant="filled" onClick={onClose}>
            Listo
          </Button>
        </>
      }
    >
      <div className="speed">
        <p className="speed__value display-medium" aria-live="polite">
          {formatRate(draft)}
        </p>
        <p className="speed__wpm body-medium">≈ {Math.round(BASE_WPM * draft)} palabras por minuto</p>
        <div className="speed__slider">
          <IconButton icon="remove" label="Más lento" variant="tonal" onClick={() => commit(draft - 0.1)} />
          <Slider
            value={draft}
            min={RATE_MIN}
            max={RATE_MAX}
            step={0.05}
            label="Velocidad"
            valueText={formatRate(draft)}
            onChange={setDraft}
            onCommit={commit}
          />
          <IconButton icon="add" label="Más rápido" variant="tonal" onClick={() => commit(draft + 0.1)} />
        </div>
        <div className="speed__presets" role="radiogroup" aria-label="Velocidades frecuentes">
          {RATE_PRESETS.map((preset) => {
            const selected = Math.abs(preset - draft) < 0.01;
            return (
              <button
                key={preset}
                type="button"
                role="radio"
                aria-checked={selected}
                className="chip state-layer"
                onClick={() => commit(preset)}
              >
                {selected && <Icon name="check" size={18} />}
                {formatRate(preset)}
              </button>
            );
          })}
        </div>
        <p className="speed__note body-small">{note}</p>
      </div>
    </Dialog>
  );
}
