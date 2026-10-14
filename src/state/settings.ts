// Preferencias y estadísticas de escucha en localStorage.

import { DEFAULT_CLOUD_VOICE } from '../lib/cloudVoice';
import { DEFAULT_SEED } from '../theme/color';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ReaderFont = 'sans' | 'serif';
/** Voz natural de Google en la nube, o voz del dispositivo. */
export type VoiceSource = 'cloud' | 'device';

export interface Settings {
  themeMode: ThemeMode;
  seedColor: string;
  voiceSource: VoiceSource;
  /** Voz natural elegida (Chirp 3 HD, español latino). */
  cloudVoice: string;
  /** Código de acceso al servidor de voz. Se guarda solo en este dispositivo. */
  accessCode: string;
  /** Voz del dispositivo. `null` elige la voz según el idioma del documento. */
  voiceURI: string | null;
  rate: number;
  fontScale: number;
  readerFont: ReaderFont;
  highlightWords: boolean;
  autoScroll: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  themeMode: 'system',
  seedColor: DEFAULT_SEED,
  voiceSource: 'cloud',
  cloudVoice: DEFAULT_CLOUD_VOICE,
  accessCode: '',
  voiceURI: null,
  rate: 1,
  fontScale: 1,
  readerFont: 'sans',
  highlightWords: true,
  autoScroll: true,
};

export const RATE_MIN = 0.5;
export const RATE_MAX = 3.5;
export const RATE_PRESETS = [0.75, 1, 1.25, 1.5, 2, 2.5, 3];

const SETTINGS_KEY = 'escucha.settings';
const STATS_KEY = 'escucha.stats';
const ONBOARDED_KEY = 'escucha.onboarded';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Almacenamiento no disponible: la preferencia vive solo en memoria.
  }
}

export function loadSettings(): Settings {
  const stored = read<Partial<Settings>>(SETTINGS_KEY) ?? {};
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function saveSettings(settings: Settings): void {
  write(SETTINGS_KEY, settings);
}

/** Palabras escuchadas por día, con clave AAAA-MM-DD. */
export type Stats = Record<string, number>;

export function dayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function loadStats(): Stats {
  return read<Stats>(STATS_KEY) ?? {};
}

export function addListenedWords(words: number, date = new Date()): Stats {
  const stats = loadStats();
  const key = dayKey(date);
  stats[key] = (stats[key] ?? 0) + words;
  write(STATS_KEY, stats);
  return stats;
}

/** Días consecutivos con escucha hasta hoy (o hasta ayer si hoy aún no hay escucha). */
export function streak(stats: Stats, today = new Date()): number {
  const cursor = new Date(today);
  if (!stats[dayKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
  let days = 0;
  while (stats[dayKey(cursor)]) {
    days++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return days;
}

export function totalWords(stats: Stats): number {
  return Object.values(stats).reduce((sum, n) => sum + n, 0);
}

export function isOnboarded(): boolean {
  return read<boolean>(ONBOARDED_KEY) === true;
}

export function markOnboarded(): void {
  write(ONBOARDED_KEY, true);
}

export function clearStats(): void {
  try {
    localStorage.removeItem(STATS_KEY);
  } catch {
    // Sin acceso al almacenamiento.
  }
}
