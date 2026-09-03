// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { SimplePool } from 'nostr-tools';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { encrypt as nip44EncryptPayload, getConversationKey } from 'nostr-tools/nip44';
import { BunkerSigner } from 'nostr-tools/nip46';
import { SIGNER_PERMS, createCachedNip46Signer, createNostrConnectSignerRequest } from '../src/signer/nip46';

const CLIENT_SECRET = '11'.repeat(32);
const BUNKER_PUBKEY = '22'.repeat(32);
const USER_PUBKEY = '33'.repeat(32);

beforeEach(() => {
  localStorage.setItem('workstr.nip46.connection', JSON.stringify({
    clientSecret: CLIENT_SECRET,
    bunker: { pubkey: BUNKER_PUBKEY, relays: ['wss://stalled.test', 'wss://relay.test'], secret: null }
  }));
  // A connection whose grant is already current, so these cases are about the request they
  // make and not about the permission upgrade that a stale grant sends first.
  localStorage.setItem('workstr.nip46.grantedPerms', SIGNER_PERMS.join(','));
});

describe('a reconnected bunker signer', () => {
  // Reading the public key was a full round trip out to a signer app and back, and it is
  // the first call of every sync pass — so on a connection that had gone quiet it was also
  // the call that failed, reporting a stalled signer as a problem reading a public key.
  // The key is already known here: it names the database the session is reading.
  it('answers with the signed-in key without asking the bunker', async () => {
    const signer = createCachedNip46Signer(USER_PUBKEY);
    // No relay is reachable in a test, so anything that asks the bunker never resolves.
    await expect(signer!.getPublicKey()).resolves.toBe(USER_PUBKEY);
  });

  it('is null when this device has no bunker to reconnect to', () => {
    localStorage.removeItem('workstr.nip46.connection');
    expect(createCachedNip46Signer(USER_PUBKEY)).toBeNull();
  });

  // The bug behind "your signer did not respond" while the signer app showed the request
  // handled: a BunkerSigner opens the subscription its answers arrive on and publishes the
  // request on sockets that are still being dialled, so a permissioned signer's instant
  // answer can reach the relay before the subscription does, and is then lost for good.
  it('does not send a request until the relay sockets are open', async () => {
    let openTheRelay = (): void => {};
    const opened = new Promise<void>((resolve) => { openTheRelay = resolve; });
    const publish = vi.fn(async () => 'ok');
    const relay = { subscribe: () => ({ close: () => {} }), publish };
    const ensure = vi.spyOn(SimplePool.prototype, 'ensureRelay')
      .mockImplementation((() => opened.then(() => relay)) as never);

    const signer = createCachedNip46Signer(USER_PUBKEY)!;
    void signer.nip44Encrypt(USER_PUBKEY, 'a workout').catch(() => {});

    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    expect(ensure).toHaveBeenCalledWith('wss://relay.test', expect.anything());
    // Nothing has gone out while the socket is still being dialled, so no answer can
    // arrive before the subscription that has to catch it.
    expect(publish).not.toHaveBeenCalled();

    openTheRelay();
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    expect(publish).toHaveBeenCalled();
    ensure.mockRestore();
  });

  // The wait above must never become the reason nothing is sent. Waiting for every relay
  // meant one that stalls mid-handshake — routine on a phone, and unbounded because
  // nostr-tools only arms a timer when it is handed one — held back a request that the
  // other relay was perfectly able to carry. Nothing reached the signer at all.
  it('sends the request over a relay that is up while another never connects', async () => {
    const publish = vi.fn(async () => 'ok');
    const live = { subscribe: () => ({ close: () => {} }), publish };
    const ensure = vi.spyOn(SimplePool.prototype, 'ensureRelay').mockImplementation(((url: string) => (
      url.includes('stalled') ? new Promise(() => {}) : Promise.resolve(live)
    )) as never);

    const signer = createCachedNip46Signer(USER_PUBKEY)!;
    void signer.nip44Encrypt(USER_PUBKEY, 'a workout').catch(() => {});

    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
    expect(publish).toHaveBeenCalled();
    // And every socket is dialled with a timeout, so none of them can hang for good.
    expect(ensure).toHaveBeenCalledWith('wss://stalled.test', expect.objectContaining({ connectionTimeout: expect.any(Number) }));

    ensure.mockRestore();
  });

  // One record went through and the next timed out, over and over. A relay that closes a
  // socket after carrying one record is ordinary, and nostr-tools then re-opens the
  // subscription inside the next request and publishes immediately after it — the cold
  // start race again, one record in. So the connection is re-established before every
  // request, not only the first.
  it('re-opens the connection before every request, not just the first', async () => {
    const publish = vi.fn(async () => 'ok');
    const live = { subscribe: () => ({ close: () => {} }), publish };
    const ensure = vi.spyOn(SimplePool.prototype, 'ensureRelay').mockImplementation(((url: string) => (
      url.includes('stalled') ? new Promise(() => {}) : Promise.resolve(live)
    )) as never);

    const signer = createCachedNip46Signer(USER_PUBKEY)!;
    void signer.nip44Encrypt(USER_PUBKEY, 'first').catch(() => {});
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
    const afterFirst = ensure.mock.calls.length;

    void signer.signEvent({ kind: 30078, created_at: 1, tags: [], content: 'second' }).catch(() => {});
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();

    expect(ensure.mock.calls.length).toBeGreaterThan(afterFirst);
    expect(publish).toHaveBeenCalledTimes(2);
    ensure.mockRestore();
  });
});

// A signer that was not told up front what the app needs asks the user about every
// request, and a backup is one request per record — several per month of training, twice
// over, because each record is encrypted and then signed. Permission has to be granted
// once, at connection, or the flow is unusable.
// A grant is fixed when the connection is made, so a release that starts signing a new kind
// leaves every existing connection unable to sign it. Re-sending connect is the only way to
// widen it without making the user disconnect and reconnect.
describe('widening the grant of a connection that already exists', () => {
  function fakeRelay() {
    return { subscribe: () => ({ close: () => {} }), publish: async () => 'ok' };
  }

  it('asks for the current permissions before the first request goes out', async () => {
    localStorage.setItem('workstr.nip46.grantedPerms', 'get_public_key,nip44_encrypt');
    const methods: string[] = [];
    const ensure = vi.spyOn(SimplePool.prototype, 'ensureRelay').mockImplementation((async () => fakeRelay()) as never);
    const sendRequest = vi.spyOn(BunkerSigner.prototype, 'sendRequest')
      .mockImplementation((async (method: string) => { methods.push(method); return 'ack'; }) as never);

    const signer = createCachedNip46Signer(USER_PUBKEY)!;
    await signer.nip44Encrypt(USER_PUBKEY, 'a workout').catch(() => {});

    expect(methods[0]).toBe('connect');
    expect(sendRequest).toHaveBeenCalledWith('connect', [BUNKER_PUBKEY, '', SIGNER_PERMS.join(','), expect.any(String)]);
    // Remembered only once the signer answered, so a grant that was never approved is asked
    // for again rather than assumed.
    expect(localStorage.getItem('workstr.nip46.grantedPerms')).toBe(SIGNER_PERMS.join(','));
    sendRequest.mockRestore();
    ensure.mockRestore();
  });

  it('does not ask again once the signer has granted them', async () => {
    const methods: string[] = [];
    const ensure = vi.spyOn(SimplePool.prototype, 'ensureRelay').mockImplementation((async () => fakeRelay()) as never);
    const sendRequest = vi.spyOn(BunkerSigner.prototype, 'sendRequest')
      .mockImplementation((async (method: string) => { methods.push(method); return 'ack'; }) as never);

    const signer = createCachedNip46Signer(USER_PUBKEY)!;
    await signer.nip44Encrypt(USER_PUBKEY, 'a workout').catch(() => {});

    expect(methods).not.toContain('connect');
    sendRequest.mockRestore();
    ensure.mockRestore();
  });
});

describe('what the app asks a signer for', () => {
  it('names each event kind rather than asking to sign anything', () => {
    expect(SIGNER_PERMS).toContain('sign_event:30078');
    // The workout summary a user chooses to share is the only other thing it signs.
    expect(SIGNER_PERMS).toContain('sign_event:1');
    // A program zap is a user-approved NIP-57 request that must be signed before the
    // recipient can issue a Nostr zap invoice.
    expect(SIGNER_PERMS).toContain('sign_event:9734');
    // Blanket signing would let Workstr sign anything at all in the user's name.
    expect(SIGNER_PERMS).not.toContain('sign_event');
  });

  // The failure this list exists to prevent, seen in the wild: publishing a public Monero
  // address hung until it timed out, because kind 10133 was not in the grant and the bunker
  // was waiting on an approval the user was never shown.
  it('names every kind the app signs, not only the ones it started with', () => {
    expect(SIGNER_PERMS).toContain('sign_event:33402');
    expect(SIGNER_PERMS).toContain('sign_event:10133');
  });

  it('asks for NIP-44 both ways, since a backup is written and read', () => {
    expect(SIGNER_PERMS).toContain('nip44_encrypt');
    expect(SIGNER_PERMS).toContain('nip44_decrypt');
  });

  it('puts them in the connection URI the signer scans', () => {
    const request = createNostrConnectSignerRequest(['wss://relay.test']);
    const perms = new URL(request.uri).searchParams.get('perms') || '';
    expect(perms.split(',')).toEqual(SIGNER_PERMS);
    request.signer.catch(() => {});
  });

  it('exposes relay readiness so mobile does not launch the signer before the subscription is listening', async () => {
    let openTheRelay = (): void => {};
    const opened = new Promise<void>((resolve) => { openTheRelay = resolve; });
    const ensure = vi.spyOn(SimplePool.prototype, 'ensureRelay')
      .mockImplementation((() => opened.then(() => ({ subscribe: () => ({ close: () => {} }), publish: async () => 'ok' }))) as never);

    const request = createNostrConnectSignerRequest(['wss://relay.test']);
    request.signer.catch(() => {});
    let ready = false;
    void request.ready.then(() => { ready = true; });
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    expect(ready).toBe(false);

    openTheRelay();
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    expect(ready).toBe(true);
    ensure.mockRestore();
  });

  it('recovers a connect response that arrived while the live subscription was closed', async () => {
    const bunkerSecret = generateSecretKey();
    const fromURI = vi.spyOn(BunkerSigner, 'fromURI').mockRejectedValue(new Error('subscription closed before connection was established.'));
    const fromBunker = vi.spyOn(BunkerSigner, 'fromBunker').mockImplementation(((_secret: Uint8Array, bp: { pubkey: string }) => ({ bp, switchRelays: async () => false })) as never);
    let request!: ReturnType<typeof createNostrConnectSignerRequest>;
    const query = vi.spyOn(SimplePool.prototype, 'querySync').mockImplementation((async (_relays: string[], filter: Record<string, unknown>) => {
      const clientPubkey = (filter['#p'] as string[])[0];
      const secret = new URL(request.uri).searchParams.get('secret') || '';
      const content = nip44EncryptPayload(JSON.stringify({ result: secret }), getConversationKey(bunkerSecret, clientPubkey));
      return [finalizeEvent({ kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', clientPubkey]], content }, bunkerSecret)];
    }) as never);

    request = createNostrConnectSignerRequest(['wss://relay.test']);
    await expect(request.signer).resolves.toMatchObject({ pubkey: getPublicKey(bunkerSecret) });
    expect(fromBunker).toHaveBeenCalled();
    fromURI.mockRestore();
    fromBunker.mockRestore();
    query.mockRestore();
  });
});
