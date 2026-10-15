import { describe, expect, it, vi } from 'vitest';
import { TtsError, createTtsClient, formatResetDate } from '../src/lib/cloudVoice';

/** Respuesta simulada. Un texto se envía como audio; cualquier otro valor, como JSON. */
function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  const raw = typeof body === 'string';
  return new Response(raw ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': raw ? 'audio/mpeg' : 'application/json', ...headers },
  });
}

describe('createTtsClient', () => {
  it('envía el código y lee el uso del mes', async () => {
    const fetchImpl = vi.fn(async () =>
      respond(200, 'mp3', { 'X-Usage-Used': '120', 'X-Usage-Limit': '900000', 'X-Usage-Reset': '2026-11-01' }),
    );
    const onUsage = vi.fn();
    const client = createTtsClient({ baseUrl: 'https://voz.example', getCode: () => ' abc ', onUsage, fetchImpl });
    const blob = await client.synthesize('Hola.', 'es-US-Chirp3-HD-Kore');
    expect(await blob.text()).toBe('mp3');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://voz.example/tts');
    expect((init.headers as Record<string, string>)['X-App-Token']).toBe('abc');
    expect(JSON.parse(init.body as string)).toEqual({ text: 'Hola.', voice: 'es-US-Chirp3-HD-Kore' });
    expect(onUsage).toHaveBeenCalledWith({ used: 120, limit: 900000, resetsOn: '2026-11-01' });
  });

  it('traduce los errores del servidor', async () => {
    const make = (status: number, body: unknown) =>
      createTtsClient({ baseUrl: 'https://voz.example', getCode: () => 'abc', fetchImpl: async () => respond(status, body) });
    await expect(make(401, { error: 'unauthorized' }).synthesize('a', 'v')).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(make(429, { error: 'monthly-limit', resetsOn: '2026-11-01' }).synthesize('a', 'v')).rejects.toMatchObject({
      code: 'monthly-limit',
      resetsOn: '2026-11-01',
    });
    await expect(make(429, { error: 'rate-limit' }).synthesize('a', 'v')).rejects.toMatchObject({ code: 'rate-limit' });
    await expect(make(502, { error: 'upstream' }).synthesize('a', 'v')).rejects.toMatchObject({ code: 'server' });
    await expect(make(503, { error: 'not-configured' }).synthesize('a', 'v')).rejects.toMatchObject({ code: 'not-configured' });
  });

  it('distingue la falta de código, de servidor y de conexión', async () => {
    const offline = createTtsClient({
      baseUrl: 'https://voz.example',
      getCode: () => 'abc',
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(offline.synthesize('a', 'v')).rejects.toMatchObject({ code: 'offline' });
    const noCode = createTtsClient({ baseUrl: 'https://voz.example', getCode: () => '  ' });
    await expect(noCode.synthesize('a', 'v')).rejects.toBeInstanceOf(TtsError);
    await expect(noCode.synthesize('a', 'v')).rejects.toMatchObject({ code: 'missing-code' });
    const noServer = createTtsClient({ baseUrl: '', getCode: () => 'abc' });
    await expect(noServer.usage()).rejects.toMatchObject({ code: 'not-configured' });
  });

  it('formatea la fecha de renovación', () => {
    expect(formatResetDate('2026-11-01')).toBe('el 1 de noviembre');
    expect(formatResetDate(undefined)).toBe('el próximo mes');
  });
});
