import { describe, expect, it, beforeEach } from 'vitest';
import { createCachedNip46Signer } from '../src/signer/nip46';

const CLIENT_SECRET = '11'.repeat(32);
const BUNKER_PUBKEY = '22'.repeat(32);
const USER_PUBKEY = '33'.repeat(32);

beforeEach(() => {
  localStorage.setItem('workstr.nip46.connection', JSON.stringify({
    clientSecret: CLIENT_SECRET,
    bunker: { pubkey: BUNKER_PUBKEY, relays: ['wss://relay.test'], secret: null }
  }));
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
});
