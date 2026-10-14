// Servidor de voz de Escucha.
// Guarda la clave de Google en secreto y nunca supera el uso gratuito mensual.
//
// Rutas:
//   GET  /usage  → uso del mes: { used, limit, resetsOn }
//   POST /tts    → { text, voice? } → audio MP3
// Todas exigen la cabecera X-App-Token con el código de acceso.

import { DurableObject } from 'cloudflare:workers';
import {
  MAX_TEXT,
  QuotaLedger,
  type Reservation,
  billedChars,
  monthKeys,
  resetDate,
  resolveLimit,
} from './quota';

export interface Env {
  USAGE: DurableObjectNamespace<UsageCounter>;
  GOOGLE_TTS_KEY?: string;
  APP_TOKEN?: string;
  ALLOWED_ORIGINS?: string;
  MONTHLY_LIMIT?: string;
  /** Solo para pruebas locales: sustituye la dirección de Google. */
  GOOGLE_TTS_ENDPOINT?: string;
}

const GOOGLE_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';

/** Voces Chirp 3 HD en español de Estados Unidos (español latino neutro). */
export const VOICES = [
  'es-US-Chirp3-HD-Kore',
  'es-US-Chirp3-HD-Aoede',
  'es-US-Chirp3-HD-Charon',
  'es-US-Chirp3-HD-Orus',
] as const;

/** Contador global del mes. Un único objeto: todas las peticiones pasan en orden. */
export class UsageCounter extends DurableObject<Env> {
  private ledger: QuotaLedger;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS usage (month TEXT PRIMARY KEY, chars INTEGER NOT NULL)');
    this.ledger = new QuotaLedger({
      get: (key) => {
        const row = sql.exec<{ chars: number }>('SELECT chars FROM usage WHERE month = ?', key).toArray()[0];
        return row ? Number(row.chars) : 0;
      },
      set: (key, value) => {
        sql.exec(
          'INSERT INTO usage (month, chars) VALUES (?, ?) ON CONFLICT(month) DO UPDATE SET chars = excluded.chars',
          key,
          value,
        );
      },
    });
  }

  reserve(keys: string[], chars: number, limit: number): Reservation {
    return this.ledger.reserve(keys, chars, limit);
  }

  release(keys: string[], chars: number): number {
    return this.ledger.release(keys, chars);
  }

  usage(keys: string[]): number {
    return this.ledger.usage(keys);
  }
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim());
  if (!origin || !allowed.includes(origin)) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Token',
    'Access-Control-Expose-Headers': 'X-Usage-Used, X-Usage-Limit, X-Usage-Reset',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Comparación en tiempo constante del código de acceso. */
function sameToken(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: cors['Access-Control-Allow-Origin'] ? 204 : 403, headers: cors });
    }
    // Un navegador desde otra web no puede usar el servidor.
    if (origin && !cors['Access-Control-Allow-Origin']) {
      return json({ error: 'forbidden-origin' }, 403, cors);
    }
    if (!env.GOOGLE_TTS_KEY || !env.APP_TOKEN) {
      return json({ error: 'not-configured' }, 503, cors);
    }
    if (!sameToken(request.headers.get('X-App-Token') ?? '', env.APP_TOKEN)) {
      return json({ error: 'unauthorized' }, 401, cors);
    }

    const now = new Date();
    const keys = monthKeys(now);
    const limit = resolveLimit(env.MONTHLY_LIMIT);
    const resetsOn = resetDate(now);
    const counter = env.USAGE.get(env.USAGE.idFromName('global'));
    const usageHeaders = (used: number) => ({
      ...cors,
      'X-Usage-Used': String(used),
      'X-Usage-Limit': String(limit),
      'X-Usage-Reset': resetsOn,
    });

    if (request.method === 'GET' && url.pathname === '/usage') {
      const used = await counter.usage(keys);
      return json({ used, limit, resetsOn, voices: VOICES }, 200, usageHeaders(used));
    }

    if (request.method !== 'POST' || url.pathname !== '/tts') {
      return json({ error: 'not-found' }, 404, cors);
    }

    let text: unknown;
    let voice: unknown;
    try {
      ({ text, voice } = (await request.json()) as { text?: unknown; voice?: unknown });
    } catch {
      return json({ error: 'bad-request' }, 400, cors);
    }
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) {
      return json({ error: 'bad-request' }, 400, cors);
    }
    const voiceName = VOICES.includes(voice as (typeof VOICES)[number]) ? (voice as string) : VOICES[0];

    // Reserva antes de llamar a Google: así nunca se supera el límite, ni con peticiones simultáneas.
    const chars = billedChars(text);
    const reservation = await counter.reserve(keys, chars, limit);
    if (!reservation.ok) {
      return json({ error: 'monthly-limit', used: reservation.used, limit, resetsOn }, 429, usageHeaders(reservation.used));
    }

    let upstream: Response;
    try {
      upstream = await fetch(env.GOOGLE_TTS_ENDPOINT || GOOGLE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_TTS_KEY },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'es-US', name: voiceName },
          audioConfig: { audioEncoding: 'MP3' },
        }),
      });
    } catch (error) {
      // Resultado incierto: Google pudo procesar el texto. La reserva se mantiene.
      console.error('Google TTS sin respuesta', error);
      return json({ error: 'upstream' }, 502, usageHeaders(reservation.used));
    }

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error('Google TTS', upstream.status, detail.slice(0, 500));
      // Un 4xx es un rechazo sin coste: se devuelve la reserva. Un 5xx es incierto: se mantiene.
      const used = upstream.status < 500 ? await counter.release(keys, chars) : reservation.used;
      return json({ error: 'upstream', status: upstream.status }, 502, usageHeaders(used));
    }

    const data = (await upstream.json()) as { audioContent?: string };
    if (!data.audioContent) return json({ error: 'upstream' }, 502, usageHeaders(reservation.used));
    return new Response(decodeBase64(data.audioContent), {
      status: 200,
      headers: { ...usageHeaders(reservation.used), 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
    });
  },
} satisfies ExportedHandler<Env>;
