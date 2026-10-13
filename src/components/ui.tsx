// Componentes base de Material 3.

import {
  type ButtonHTMLAttributes,
  type ComponentPropsWithRef,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { ICONS, type IconName } from './icons';

export function Icon({
  name,
  filled = false,
  size = 24,
  className = '',
}: {
  name: IconName;
  filled?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 -960 960 960"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICONS[name][filled ? 1 : 0]} />
    </svg>
  );
}

type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated' | 'danger';

export function Button({
  variant = 'filled',
  icon,
  large = false,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon?: IconName;
  large?: boolean;
}) {
  return (
    <button
      type="button"
      className={`btn btn--${variant} ${large ? 'btn--large' : ''} state-layer ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={large ? 24 : 18} />}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  variant = 'standard',
  filled,
  size = 24,
  className = '',
  ...rest
}: ComponentPropsWithRef<'button'> & {
  icon: IconName;
  label: string;
  variant?: 'standard' | 'filled' | 'tonal' | 'outlined';
  filled?: boolean;
  size?: number;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`icon-btn ${variant !== 'standard' ? `icon-btn--${variant}` : ''} state-layer ${className}`}
      {...rest}
    >
      <Icon name={icon} filled={filled ?? variant !== 'standard'} size={size} />
    </button>
  );
}

export function Fab({
  icon,
  label,
  extended = false,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; extended?: boolean }) {
  return (
    <button
      type="button"
      aria-label={extended ? undefined : label}
      title={extended ? undefined : label}
      className={`fab ${extended ? 'fab--extended' : ''} state-layer ${className}`}
      {...rest}
    >
      <Icon name={icon} />
      {extended && <span>{label}</span>}
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  id?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => onChange(!checked)}
    >
      <span className="switch__handle">{checked && <Icon name="check" size={16} />}</span>
    </button>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  onCommit,
  label,
  valueText,
  small = false,
  className = '',
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Se llama al soltar el control. */
  onCommit?: (value: number) => void;
  label: string;
  valueText?: string;
  small?: boolean;
  className?: string;
}) {
  const p = max > min ? (value - min) / (max - min) : 0;
  const commit = (e: { currentTarget: HTMLInputElement }) => onCommit?.(Number(e.currentTarget.value));
  return (
    <input
      type="range"
      className={`slider ${small ? 'slider--small' : ''} ${className}`}
      style={{ '--p': Math.min(Math.max(p, 0), 1) } as CSSProperties}
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      aria-valuetext={valueText}
      onChange={(e) => onChange(Number(e.currentTarget.value))}
      onPointerUp={commit}
      onKeyUp={commit}
    />
  );
}

export function LinearProgress({ value, label }: { value: number; label?: string }) {
  const clamped = Math.min(Math.max(value, 0), 1);
  const state = clamped <= 0 ? 'progress--empty' : clamped >= 1 ? 'progress--full' : '';
  return (
    <div
      className={`progress ${state}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      style={{ '--value': clamped } as CSSProperties}
    >
      <span className="progress__active" />
      <span className="progress__track" />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className="segmented__item state-layer"
            onClick={() => onChange(option.value)}
          >
            {selected ? <Icon name="check" size={18} /> : option.icon && <Icon name={option.icon} size={18} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Diálogo modal o bitácora inferior sobre `<dialog>` nativo. */
export function Dialog({
  open,
  onClose,
  title,
  icon,
  children,
  actions,
  sheet = false,
  flush = false,
  labelledBy,
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  icon?: IconName;
  children: ReactNode;
  actions?: ReactNode;
  sheet?: boolean;
  flush?: boolean;
  labelledBy?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useRef(`dlg-${Math.random().toString(36).slice(2, 8)}`).current;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Enfoca el elemento marcado o el propio diálogo. Evita abrir el teclado sin pedirlo.
      const target = dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog;
      target.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!open) return null;

  return createPortal(
    <dialog
      ref={ref}
      tabIndex={-1}
      className={`dialog ${sheet ? 'dialog--sheet' : ''} ${className}`}
      aria-labelledby={title ? titleId : labelledBy}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Clic en el fondo: el destino es el propio <dialog>.
        if (e.target === e.currentTarget) {
          const rect = e.currentTarget.getBoundingClientRect();
          const inside =
            e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
          if (!inside) onClose();
        }
      }}
    >
      {sheet && <span className="sheet__handle" aria-hidden="true" />}
      {(title || icon) && (
        <div className={`dialog__header ${icon ? 'dialog__header--centered' : ''}`}>
          {icon && <Icon name={icon} className="dialog__icon" />}
          {title && (
            <h2 id={titleId} className="headline-small">
              {title}
            </h2>
          )}
        </div>
      )}
      <div className={`dialog__body ${flush ? 'dialog__body--flush' : ''}`}>{children}</div>
      {actions && <div className="dialog__actions">{actions}</div>}
    </dialog>,
    document.body,
  );
}

export interface MenuAction {
  label: string;
  icon: IconName;
  onSelect: () => void;
  danger?: boolean;
}

/** Menú desplegable anclado a un botón de icono. */
export function OverflowMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const menuHeight = actions.length * 48 + 16;
    const top = rect.bottom + menuHeight > window.innerHeight ? rect.top - menuHeight : rect.bottom;
    setPosition({ top: Math.max(8, top), right: Math.max(8, window.innerWidth - rect.right) });
  }, [open, actions.length]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof PointerEvent && menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      if (e instanceof KeyboardEvent) buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <IconButton
        ref={buttonRef}
        icon="more_vert"
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      />
      {open &&
        position &&
        createPortal(
          <div ref={menuRef} className="menu" role="menu" style={{ top: position.top, right: position.right }}>
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                className={`menu-item state-layer ${action.danger ? 'menu-item--danger' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  action.onSelect();
                }}
              >
                <Icon name={action.icon} />
                {action.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Añade la onda de Material a cualquier `.state-layer` al pulsar. */
export function installRipple(): () => void {
  const handler = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const host = (event.target as Element | null)?.closest?.('.state-layer') as HTMLElement | null;
    if (!host || (host as HTMLButtonElement).disabled) return;
    const rect = host.getBoundingClientRect();
    const size = Math.hypot(rect.width, rect.height) * 2;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
    host.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  };
  document.addEventListener('pointerdown', handler);
  return () => document.removeEventListener('pointerdown', handler);
}
