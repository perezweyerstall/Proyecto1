// Color dinámico de Material 3 a partir de un color semilla.

import {
  type DynamicColor,
  Hct,
  MaterialDynamicColors,
  SchemeVibrant,
  argbFromHex,
  hexFromArgb,
} from '@material/material-color-utilities';

export interface SeedOption {
  name: string;
  hex: string;
}

/** Semillas basadas en los colores de la marca Google y la línea base de Material. */
export const SEEDS: SeedOption[] = [
  { name: 'Azul', hex: '#1a73e8' },
  { name: 'Verde', hex: '#1e8e3e' },
  { name: 'Rojo', hex: '#d93025' },
  { name: 'Amarillo', hex: '#f9ab00' },
  { name: 'Violeta', hex: '#6750a4' },
  { name: 'Turquesa', hex: '#12827a' },
];

export const DEFAULT_SEED = SEEDS[0].hex;

const ROLES: Record<string, DynamicColor> = {
  primary: MaterialDynamicColors.primary,
  'on-primary': MaterialDynamicColors.onPrimary,
  'primary-container': MaterialDynamicColors.primaryContainer,
  'on-primary-container': MaterialDynamicColors.onPrimaryContainer,
  'inverse-primary': MaterialDynamicColors.inversePrimary,
  secondary: MaterialDynamicColors.secondary,
  'on-secondary': MaterialDynamicColors.onSecondary,
  'secondary-container': MaterialDynamicColors.secondaryContainer,
  'on-secondary-container': MaterialDynamicColors.onSecondaryContainer,
  tertiary: MaterialDynamicColors.tertiary,
  'on-tertiary': MaterialDynamicColors.onTertiary,
  'tertiary-container': MaterialDynamicColors.tertiaryContainer,
  'on-tertiary-container': MaterialDynamicColors.onTertiaryContainer,
  error: MaterialDynamicColors.error,
  'on-error': MaterialDynamicColors.onError,
  'error-container': MaterialDynamicColors.errorContainer,
  'on-error-container': MaterialDynamicColors.onErrorContainer,
  surface: MaterialDynamicColors.surface,
  'on-surface': MaterialDynamicColors.onSurface,
  'surface-variant': MaterialDynamicColors.surfaceVariant,
  'on-surface-variant': MaterialDynamicColors.onSurfaceVariant,
  'surface-dim': MaterialDynamicColors.surfaceDim,
  'surface-bright': MaterialDynamicColors.surfaceBright,
  'surface-container-lowest': MaterialDynamicColors.surfaceContainerLowest,
  'surface-container-low': MaterialDynamicColors.surfaceContainerLow,
  'surface-container': MaterialDynamicColors.surfaceContainer,
  'surface-container-high': MaterialDynamicColors.surfaceContainerHigh,
  'surface-container-highest': MaterialDynamicColors.surfaceContainerHighest,
  'inverse-surface': MaterialDynamicColors.inverseSurface,
  'inverse-on-surface': MaterialDynamicColors.inverseOnSurface,
  outline: MaterialDynamicColors.outline,
  'outline-variant': MaterialDynamicColors.outlineVariant,
  shadow: MaterialDynamicColors.shadow,
  scrim: MaterialDynamicColors.scrim,
};

/**
 * Calcula los roles de color del esquema Vibrant.
 * Con la semilla azul se aproxima a la paleta de las apps de Google (primario #0b57d0).
 */
export function schemeTokens(seedHex: string, dark: boolean): Record<string, string> {
  const scheme = new SchemeVibrant(Hct.fromInt(argbFromHex(seedHex)), dark, 0);
  const tokens: Record<string, string> = {};
  for (const [role, color] of Object.entries(ROLES)) {
    tokens[role] = hexFromArgb(color.getArgb(scheme));
  }
  return tokens;
}

/** Aplica el esquema como variables CSS `--md-sys-color-*` en la raíz. */
export function applyScheme(seedHex: string, dark: boolean): void {
  const root = document.documentElement;
  const tokens = schemeTokens(seedHex, dark);
  for (const [role, value] of Object.entries(tokens)) {
    root.style.setProperty(`--md-sys-color-${role}`, value);
  }
  root.style.colorScheme = dark ? 'dark' : 'light';
  root.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens.surface);
}
