import { describe, expect, it, vi } from 'vitest';
import { discoverMediaServer, MediaUploadError, NIP98_KIND, uploadProfileImage } from '../src/nostr/media-upload';
import type { SignedNostrEvent, Signer, UnsignedNostrEvent } from '../src/signer/types';

const PUBKEY = 'a'.repeat(64);
const SECRET = 'nsec1thisneverleavesthesigner';

// A signer that holds a secret, so the test can prove the secret never reaches a request.
function signer(): Signer & { signEvent: ReturnType<typeof vi.fn> } {
  return {
    type: 'local',
    secret: SECRET,
    getPublicKey: async () => PUBKEY,
    signEvent: vi.fn(async (event: UnsignedNostrEvent) => ({ ...event, id: 'auth', pubkey: PUBKEY, sig: 'sig' }) as SignedNostrEvent),
    nip44Encrypt: vi.fn(),
    nip44Decrypt: vi.fn()
  } as unknown as Signer & { signEvent: ReturnType<typeof vi.fn> };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const DISCOVERY = {
  api_url: 'https://media.example/api/v2/nip96/upload',
  plans: { free: { is_nip98_required: true, max_byte_size: 5 * 1048576 } }
};

function uploaded(url = 'https://image.example/abc.jpg') {
  return { status: 'success', message: 'Upload successful.', nip94_event: { tags: [['url', url], ['m', 'image/jpeg']], content: '' } };
}

function image(size = 1024, type = 'image/jpeg'): File {
  return new File([new Uint8Array(size)], 'me.jpg', { type });
}

function server(...answers: Response[]) {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/.well-known/nostr/nip96.json')) return json(DISCOVERY);
    const next = answers.shift();
    if (!next) throw new Error(`unexpected request to ${url}`);
    return next;
  });
}

describe('NIP-96 profile photo upload', () => {
  it('reads the upload address and limits from the discovery document', async () => {
    const fetcher = server();
    const found = await discoverMediaServer('https://media.example', { fetch: fetcher as unknown as typeof fetch });
    expect(fetcher.mock.calls[0][0]).toBe('https://media.example/.well-known/nostr/nip96.json');
    expect(found).toEqual({ apiUrl: DISCOVERY.api_url, maxBytes: 5 * 1048576, contentTypes: undefined });
  });

  it('follows a delegated discovery document once', async () => {
    const fetcher = vi.fn(async (url: string) => url.startsWith('https://media.example')
      ? json({ delegated_to_url: 'https://cdn.example' })
      : json({ api_url: 'https://cdn.example/upload' }));
    const found = await discoverMediaServer('https://media.example', { fetch: fetcher as unknown as typeof fetch });
    expect(found.apiUrl).toBe('https://cdn.example/upload');
  });

  it('uploads to the advertised API with a NIP-98 authorization from the active signer', async () => {
    const sign = signer();
    const fetcher = server(json(uploaded()));
    const url = await uploadProfileImage(image(), sign, { server: 'https://media.example', fetch: fetcher as unknown as typeof fetch });

    expect(url).toBe('https://image.example/abc.jpg');
    const [target, init] = fetcher.mock.calls[1] as unknown as [string, RequestInit];
    expect(target).toBe(DISCOVERY.api_url);
    expect(init.method).toBe('POST');
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth.startsWith('Nostr ')).toBe(true);
    const event = JSON.parse(atob(auth.slice(6)));
    expect(event.kind).toBe(NIP98_KIND);
    expect(event.tags).toEqual([['u', DISCOVERY.api_url], ['method', 'POST']]);
    expect(sign.signEvent).toHaveBeenCalledTimes(1);
    // Nothing secret travels: not in the header, not in the form.
    expect(auth).not.toContain(SECRET);
    expect(atob(auth.slice(6))).not.toContain(SECRET);
    const form = init.body as FormData;
    for (const [, value] of form.entries()) if (typeof value === 'string') expect(value).not.toContain(SECRET);
    expect((form.get('file') as File).size).toBe(1024);
  });

  it('waits for a server that is still processing the image', async () => {
    const fetcher = server(
      json({ status: 'processing', processing_url: 'https://media.example/status/1' }),
      json({ status: 'processing', processing_url: 'https://media.example/status/1' }),
      json(uploaded('https://image.example/done.jpg'))
    );
    const url = await uploadProfileImage(image(), signer(), { server: 'https://media.example', fetch: fetcher as unknown as typeof fetch, wait: async () => undefined });
    expect(url).toBe('https://image.example/done.jpg');
  });

  it('rejects a file that is not an image before contacting anyone', async () => {
    const fetcher = server();
    await expect(uploadProfileImage(new File(['x'], 'a.txt', { type: 'text/plain' }), signer(), { fetch: fetcher as unknown as typeof fetch })).rejects.toThrow('Choose an image file');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses an image larger than the server says it accepts', async () => {
    const sign = signer();
    await expect(uploadProfileImage(image(6 * 1048576), sign, { server: 'https://media.example', fetch: server() as unknown as typeof fetch })).rejects.toThrow('too large');
    expect(sign.signEvent).not.toHaveBeenCalled();
  });

  it('reports a rejected upload with the server reason', async () => {
    const fetcher = server(json({ status: 'error', message: 'File type not allowed' }, 400));
    await expect(uploadProfileImage(image(), signer(), { server: 'https://media.example', fetch: fetcher as unknown as typeof fetch })).rejects.toThrow('File type not allowed');
  });

  it('never accepts an answer without a usable https URL', async () => {
    for (const body of [{ status: 'success', nip94_event: { tags: [] } }, uploaded('http://image.example/insecure.jpg'), uploaded('javascript:alert(1)')]) {
      const fetcher = server(json(body));
      await expect(uploadProfileImage(image(), signer(), { server: 'https://media.example', fetch: fetcher as unknown as typeof fetch })).rejects.toBeInstanceOf(MediaUploadError);
    }
  });

  it('reports an unreadable answer', async () => {
    const fetcher = server(new Response('<html>502</html>', { status: 502 }));
    await expect(uploadProfileImage(image(), signer(), { server: 'https://media.example', fetch: fetcher as unknown as typeof fetch })).rejects.toThrow('unreadable');
  });

  it('times out an upload that never answers', async () => {
    const fetcher = vi.fn(async (url: string) => url.endsWith('nip96.json') ? json(DISCOVERY) : new Promise<Response>(() => undefined));
    await expect(uploadProfileImage(image(), signer(), { server: 'https://media.example', fetch: fetcher as unknown as typeof fetch, timeoutMs: 10 })).rejects.toThrow('timed out');
  });
});
