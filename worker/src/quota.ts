// Límite mensual de caracteres para no salir nunca del uso gratuito de Google.
// Sin dependencias de Cloudflare: se prueba con Vitest desde la raíz del proyecto.

/** Uso gratuito mensual de Chirp 3 HD según la página de precios de Google. */
export const GOOGLE_FREE_CHARS = 1_000_000;

/** Límite máximo permitido, aunque la configuración pida más. Deja un 5 % de margen. */
export const HARD_MAX_LIMIT = 950_000;

/** Límite por defecto: 10 % de margen bajo el uso gratuito. */
export const DEFAULT_LIMIT = 900_000;

/** Longitud máxima de un fragmento. Las frases de la app no pasan de 220 caracteres. */
export const MAX_TEXT = 600;

/**
 * Caracteres por minuto. La lectura a 3,5× usa unos 3200.
 * Frena un código filtrado o un fallo del cliente: vaciar el mes llevaría horas, no segundos.
 */
export const MINUTE_LIMIT = 6000;

/** Interpreta el límite configurado y lo recorta al máximo seguro. */
export function resolveLimit(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(value), HARD_MAX_LIMIT);
}

/**
 * Caracteres que Google factura por un texto.
 * Google cuenta todos los caracteres, espacios y saltos de línea incluidos.
 * `length` cuenta unidades UTF-16: nunca es menor que el recuento de Google.
 */
export function billedChars(text: string): number {
  return text.length;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Año y mes de una fecha en la hora del Pacífico, la zona de facturación de Google Cloud. */
function pacificMonth(date: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  return { year, month };
}

/**
 * Claves de los meses en curso.
 * Google no publica la zona horaria del mes gratuito. Se cuentan dos meses a la vez:
 * hora del Pacífico y UTC. Cada uno debe quedar bajo el límite.
 */
export function monthKeys(date: Date): string[] {
  const pt = pacificMonth(date);
  return [
    `pt:${pt.year}-${pad(pt.month)}`,
    `utc:${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`,
  ];
}

/** Clave del minuto en curso, en UTC. */
export function minuteKey(date: Date): string {
  return `min:${date.toISOString().slice(0, 16)}`;
}

/** Límite de cada contador: los meses usan el límite mensual; el minuto, MINUTE_LIMIT. */
export interface Bucket {
  key: string;
  limit: number;
}

export function buckets(date: Date, monthlyLimit: number): Bucket[] {
  return [
    ...monthKeys(date).map((key) => ({ key, limit: monthlyLimit })),
    { key: minuteKey(date), limit: MINUTE_LIMIT },
  ];
}

/**
 * Fecha en que se renueva el uso: el primer día del mes siguiente (calendario del Pacífico).
 * Devuelve AAAA-MM-DD para mostrarla al usuario.
 */
export function resetDate(date: Date): string {
  const { year, month } = pacificMonth(date);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${nextYear}-${pad(nextMonth)}-01`;
}

/** Almacenamiento mínimo para el contador. */
export interface CounterStore {
  get(key: string): number;
  set(key: string, value: number): void;
}

export type ReserveResult = Reservation & {
  /** Contador que impidió la reserva. */
  blockedBy?: 'month' | 'minute';
};

export interface Reservation {
  ok: boolean;
  /** Caracteres usados en el mes más cargado, tras la operación. */
  used: number;
}

/**
 * Contador mensual. Todas las operaciones son síncronas:
 * dentro de un Durable Object no se intercalan peticiones entre lectura y escritura.
 */
export class QuotaLedger {
  constructor(private store: CounterStore) {}

  usage(keys: string[]): number {
    return Math.max(0, ...keys.map((key) => this.store.get(key)));
  }

  /**
   * Reserva `chars` en todos los contadores o en ninguno.
   * `used` informa del mes más cargado.
   */
  reserve(entries: Bucket[], chars: number): ReserveResult {
    const months = entries.filter((e) => !e.key.startsWith('min:')).map((e) => e.key);
    const used = this.usage(months);
    if (chars <= 0) return { ok: false, used, blockedBy: 'month' };
    for (const entry of entries) {
      if (this.store.get(entry.key) + chars > entry.limit) {
        return { ok: false, used, blockedBy: entry.key.startsWith('min:') ? 'minute' : 'month' };
      }
    }
    for (const entry of entries) this.store.set(entry.key, this.store.get(entry.key) + chars);
    return { ok: true, used: this.usage(months) };
  }

  /** Devuelve una reserva que Google rechazó sin facturar. */
  release(entries: Bucket[], chars: number): number {
    for (const entry of entries) this.store.set(entry.key, Math.max(0, this.store.get(entry.key) - chars));
    return this.usage(entries.filter((e) => !e.key.startsWith('min:')).map((e) => e.key));
  }
}
