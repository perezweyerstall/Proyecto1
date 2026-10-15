// Cliente del servidor de voz natural (Google Chirp 3 HD a través de Cloudflare).

/** Dirección del servidor de voz. Se fija al compilar con VITE_TTS_URL. Vacía: sin voz natural. */
export const TTS_URL = ((import.meta.env.VITE_TTS_URL as string | undefined) ?? '').trim().replace(/\/+$/, '');

export interface CloudVoice {
  id: string;
  name: string;
  description: string;
}

/** Voces Chirp 3 HD en español de Estados Unidos: español latino neutro. */
export const CLOUD_VOICES: CloudVoice[] = [
  { id: 'es-US-Chirp3-HD-Kore', name: 'Kore', description: 'Voz femenina' },
  { id: 'es-US-Chirp3-HD-Aoede', name: 'Aoede', description: 'Voz femenina' },
  { id: 'es-US-Chirp3-HD-Charon', name: 'Charon', description: 'Voz masculina' },
  { id: 'es-US-Chirp3-HD-Orus', name: 'Orus', description: 'Voz masculina' },
];

export const DEFAULT_CLOUD_VOICE = CLOUD_VOICES[0].id;

export function cloudVoiceName(id: string): string {
  return CLOUD_VOICES.find((v) => v.id === id)?.name ?? CLOUD_VOICES[0].name;
}

export type TtsErrorCode =
  | 'not-configured'
  | 'missing-code'
  | 'unauthorized'
  | 'monthly-limit'
  | 'rate-limit'
  | 'offline'
  | 'server';

export class TtsError extends Error {
  readonly code: TtsErrorCode;
  readonly resetsOn?: string;

  constructor(code: TtsErrorCode, resetsOn?: string) {
    super(code);
    this.code = code;
    this.resetsOn = resetsOn;
  }
}

export interface Usage {
  used: number;
  limit: number;
  /** Fecha de renovación, AAAA-MM-DD. */
  resetsOn: string;
}

export interface TtsClient {
  synthesize(text: string, voice: string, signal?: AbortSignal): Promise<Blob>;
  /** Uso del mes. `code` permite comprobar un código antes de guardarlo. */
  usage(code?: string): Promise<Usage>;
}

interface ClientOptions {
  baseUrl: string;
  /** Devuelve el código de acceso vigente. */
  getCode: () => string;
  /** Recibe el uso del mes tras cada respuesta del servidor. */
  onUsage?: (usage: Usage) => void;
  fetchImpl?: typeof fetch;
}

function usageFrom(headers: Headers): Usage | null {
  const used = Number(headers.get('X-Usage-Used'));
  const limit = Number(headers.get('X-Usage-Limit'));
  const resetsOn = headers.get('X-Usage-Reset') ?? '';
  return headers.has('X-Usage-Used') && Number.isFinite(used) && limit > 0 ? { used, limit, resetsOn } : null;
}

export function createTtsClient({ baseUrl, getCode, onUsage, fetchImpl }: ClientOptions): TtsClient {
  const doFetch = fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  async function request(path: string, init: RequestInit, codeOverride?: string): Promise<Response> {
    if (!baseUrl) throw new TtsError('not-configured');
    const code = (codeOverride ?? getCode()).trim();
    if (!code) throw new TtsError('missing-code');
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), 'X-App-Token': code },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new TtsError('offline');
    }
    const usage = usageFrom(response.headers);
    if (usage) onUsage?.(usage);
    if (response.ok) return response;
    let body: { error?: string; resetsOn?: string } = {};
    try {
      body = await response.json();
    } catch {
      // Respuesta sin JSON.
    }
    if (response.status === 401) throw new TtsError('unauthorized');
    if (body.error === 'rate-limit') throw new TtsError('rate-limit');
    if (response.status === 429 || body.error === 'monthly-limit') throw new TtsError('monthly-limit', body.resetsOn);
    if (response.status === 503 && body.error === 'not-configured') throw new TtsError('not-configured');
    throw new TtsError('server');
  }

  return {
    async synthesize(text, voice, signal) {
      const response = await request('/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice }),
        signal,
      });
      return response.blob();
    },
    async usage(code) {
      const response = await request('/usage', { method: 'GET' }, code);
      const { used, limit, resetsOn } = (await response.json()) as Usage;
      const usage = { used, limit, resetsOn };
      onUsage?.(usage);
      return usage;
    },
  };
}

/** Fecha de renovación legible, con artículo: «el 1 de noviembre» o «el próximo mes». */
export function formatResetDate(resetsOn: string | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(resetsOn ?? '');
  if (!match) return 'el próximo mes';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return `el ${date.toLocaleDateString('es', { day: 'numeric', month: 'long' })}`;
}
