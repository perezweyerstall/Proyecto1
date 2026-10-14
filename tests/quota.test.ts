import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMIT,
  GOOGLE_FREE_CHARS,
  HARD_MAX_LIMIT,
  QuotaLedger,
  billedChars,
  monthKeys,
  resetDate,
  resolveLimit,
} from '../worker/src/quota';

function ledger() {
  const data = new Map<string, number>();
  return new QuotaLedger({ get: (k) => data.get(k) ?? 0, set: (k, v) => void data.set(k, v) });
}

describe('límite mensual del servidor de voz', () => {
  it('nunca permite un límite igual o superior al uso gratuito de Google', () => {
    expect(HARD_MAX_LIMIT).toBeLessThan(GOOGLE_FREE_CHARS);
    expect(resolveLimit(undefined)).toBe(DEFAULT_LIMIT);
    expect(resolveLimit('abc')).toBe(DEFAULT_LIMIT);
    expect(resolveLimit('-5')).toBe(DEFAULT_LIMIT);
    expect(resolveLimit('5000000')).toBe(HARD_MAX_LIMIT);
    expect(resolveLimit('100')).toBe(100);
  });

  it('cuenta cada carácter, espacios incluidos', () => {
    expect(billedChars('Hola mundo.\n')).toBe(12);
    expect(billedChars('¿Qué?')).toBe(5);
  });

  it('usa el mes del Pacífico y el mes UTC', () => {
    // 1 de noviembre a las 03:00 UTC: en el Pacífico aún es 31 de octubre.
    expect(monthKeys(new Date(Date.UTC(2026, 10, 1, 3)))).toEqual(['pt:2026-10', 'utc:2026-11']);
    expect(monthKeys(new Date(Date.UTC(2026, 10, 15)))).toEqual(['pt:2026-11', 'utc:2026-11']);
    expect(resetDate(new Date(Date.UTC(2026, 11, 20)))).toBe('2027-01-01');
  });

  it('reserva en todos los meses o en ninguno', () => {
    const l = ledger();
    const october = ['pt:2026-10', 'utc:2026-10'];
    const boundary = ['pt:2026-10', 'utc:2026-11'];
    expect(l.reserve(october, 80, 100)).toEqual({ ok: true, used: 80 });
    // En el cambio de mes UTC, el mes del Pacífico sigue lleno: se rechaza.
    expect(l.reserve(boundary, 30, 100)).toEqual({ ok: false, used: 80 });
    expect(l.reserve(boundary, 20, 100)).toEqual({ ok: true, used: 100 });
    expect(l.reserve(boundary, 1, 100).ok).toBe(false);
    expect(l.usage(['pt:2026-11', 'utc:2026-11'])).toBe(20);
  });

  it('devuelve las reservas rechazadas por Google sin bajar de cero', () => {
    const l = ledger();
    const keys = ['pt:2026-10', 'utc:2026-10'];
    l.reserve(keys, 50, 100);
    expect(l.release(keys, 20)).toBe(30);
    expect(l.release(keys, 100)).toBe(0);
    expect(l.reserve(keys, 0, 100).ok).toBe(false);
  });
});
