import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { decrypt as nip44DecryptPayload, encrypt as nip44EncryptPayload, getConversationKey } from 'nostr-tools/nip44';
import { hexToBytes } from '@noble/hashes/utils.js';
import type { Event as NostrEvent } from 'nostr-tools';
import type { UnsignedNostrEvent, Signer } from '../src/signer/types';
import { validateNwcConnection, NWC_REQUEST_KIND, NWC_RESPONSE_KIND } from '../src/nostr/nwc-client';
import { parseNwcConnectionString } from '../src/nostr/nwc';
import { executeWorkoutProgramZap } from '../src/nostr/program-zap';
import type { WorkoutProgramZapSource } from '../src/nostr/zaps';
import { encodeLnurl } from '../src/nostr/lnurl';

const CLIENT_SECRET = '1'.repeat(64);
const WALLET_SECRET = '2'.repeat(64);
const SENDER_PUBKEY = '3'.repeat(64);
const BOLT11_21_SATS = `lnbc210n1${'q'.repeat(60)}`;

type WalletMode = 'success' | 'payment-failure';

interface MockWalletRelay {
  url: string;
  walletPubkey: string;
  setMode(mode: WalletMode): void;
  receivedMethods(): string[];
  close(): Promise<void>;
}

interface MockLnurlServer {
  lnurl: string;
  callbackRequests(): URL[];
  close(): Promise<void>;
}

function websocketUrl(server: Server): string {
  const address = server.address() as AddressInfo;
  return `ws://127.0.0.1:${address.port}`;
}

function httpUrl(server: Server, path: string): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}${path}`;
}

function matchesFilter(event: NostrEvent, filter: Record<string, unknown>): boolean {
  const kinds = Array.isArray(filter.kinds) ? filter.kinds : undefined;
  if (kinds && !kinds.includes(event.kind)) return false;
  const authors = Array.isArray(filter.authors) ? filter.authors : undefined;
  if (authors && !authors.includes(event.pubkey)) return false;
  const pTags = Array.isArray(filter['#p']) ? filter['#p'] : undefined;
  if (pTags && !event.tags.some((tag) => tag[0] === 'p' && pTags.includes(tag[1]))) return false;
  return true;
}

async function startMockWalletRelay(): Promise<MockWalletRelay> {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  const walletPubkey = getPublicKey(hexToBytes(WALLET_SECRET));
  let mode: WalletMode = 'success';
  const methods: string[] = [];
  const subscriptions = new Map<WebSocket, Array<{ id: string; filters: Record<string, unknown>[] }>>();

  function publish(event: NostrEvent): void {
    for (const [socket, subs] of subscriptions) {
      if (socket.readyState !== socket.OPEN) continue;
      for (const sub of subs) {
        if (sub.filters.some((filter) => matchesFilter(event, filter))) {
          socket.send(JSON.stringify(['EVENT', sub.id, event]));
        }
      }
    }
  }

  wss.on('connection', (socket) => {
    subscriptions.set(socket, []);
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw)) as unknown[];
      const kind = message[0];
      if (kind === 'REQ') {
        const id = String(message[1]);
        const filters = message.slice(2) as Record<string, unknown>[];
        subscriptions.get(socket)?.push({ id, filters });
        socket.send(JSON.stringify(['EOSE', id]));
        return;
      }
      if (kind === 'CLOSE') {
        const id = String(message[1]);
        subscriptions.set(socket, (subscriptions.get(socket) || []).filter((sub) => sub.id !== id));
        return;
      }
      if (kind !== 'EVENT') return;
      const event = message[1] as NostrEvent;
      socket.send(JSON.stringify(['OK', event.id, true, '']));
      if (event.kind !== NWC_REQUEST_KIND) return;

      const key = getConversationKey(hexToBytes(WALLET_SECRET), event.pubkey);
      const request = JSON.parse(nip44DecryptPayload(event.content, key)) as { method: string; params?: Record<string, unknown> };
      methods.push(request.method);
      const response = request.method === 'get_info'
        ? { result_type: 'get_info', result: { alias: 'Local Mock Wallet', methods: ['get_info', 'pay_invoice'], notifications: [] } }
        : mode === 'payment-failure'
          ? { result_type: 'pay_invoice', error: { code: 'PAYMENT_FAILED', message: 'mock route failed' } }
          : { result_type: 'pay_invoice', result: { preimage: 'p'.repeat(64), fees_paid: 0, payment_hash: 'h'.repeat(64) } };
      const responseEvent = finalizeEvent({
        kind: NWC_RESPONSE_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', event.pubkey], ['e', event.id]],
        content: nip44EncryptPayload(JSON.stringify(response), key)
      }, hexToBytes(WALLET_SECRET));
      publish(responseEvent);
    });
    socket.on('close', () => subscriptions.delete(socket));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: websocketUrl(server),
    walletPubkey,
    setMode(next) { mode = next; },
    receivedMethods() { return [...methods]; },
    close: () => new Promise((resolve) => wss.close(() => server.close(() => resolve())))
  };
}

async function startMockLnurlServer(): Promise<MockLnurlServer> {
  const requests: URL[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/lnurlp/coach') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ callback: httpUrl(server, '/zap/callback'), allowsNostr: true, minSendable: 1_000, maxSendable: 100_000 }));
      return;
    }
    if (url.pathname === '/zap/callback') {
      requests.push(url);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ pr: BOLT11_21_SATS }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    lnurl: encodeLnurl(httpUrl(server, '/lnurlp/coach')),
    callbackRequests: () => [...requests],
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}

function connectionString(wallet: MockWalletRelay): string {
  const relay = encodeURIComponent(wallet.url);
  return `nostr+walletconnect://${wallet.walletPubkey}?relay=${relay}&secret=${CLIENT_SECRET}&lud16=mock-wallet@example.test`;
}

function signer(): Signer {
  return {
    type: 'local',
    getPublicKey: async () => SENDER_PUBKEY,
    signEvent: async (event: UnsignedNostrEvent) => ({ ...event, pubkey: SENDER_PUBKEY, id: '1'.repeat(64), sig: '2'.repeat(128) }),
    nip44Encrypt: async () => '',
    nip44Decrypt: async () => ''
  };
}

function program(lnurl: string, overrides: Partial<WorkoutProgramZapSource> = {}): WorkoutProgramZapSource {
  const pubkey = '4'.repeat(64);
  return {
    slug: 'mock-program',
    name: 'Mock Strength Program',
    description: '',
    tags: [],
    exercises: [],
    sourceLabel: 'Mock coach',
    eventId: '5'.repeat(64),
    pubkey,
    address: `33402:${pubkey}:mock-program`,
    createdAt: 1_800_000_000,
    lud06: lnurl,
    ...overrides
  };
}

describe('NWC workout zap mock-wallet integration', () => {
  let wallet: MockWalletRelay;
  let lnurl: MockLnurlServer;

  beforeEach(async () => {
    wallet = await startMockWalletRelay();
    lnurl = await startMockLnurlServer();
  });

  afterEach(async () => {
    await wallet.close();
    await lnurl.close();
  });

  it('validates setup, creates a zap request, asks LNURL for an invoice, and pays through an NWC relay', async () => {
    const connection = parseNwcConnectionString(connectionString(wallet));
    const info = await validateNwcConnection(connection, { timeoutMs: 2_000 });
    expect(info).toMatchObject({ ok: true, value: { alias: 'Local Mock Wallet', methods: ['get_info', 'pay_invoice'] } });

    const result = await executeWorkoutProgramZap({
      program: program(lnurl.lnurl),
      amountSats: 21,
      comment: 'manual mock-wallet zap',
      signer: signer(),
      nwcConnection: connection,
      createdAt: 1_800_000_123
    }, { nwc: { timeoutMs: 2_000 } });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.payment).toEqual({ preimage: 'p'.repeat(64), feesPaidMsat: 0, paymentHash: 'h'.repeat(64) });
    expect(result.value.zapRequest.tags).toContainEqual(['p', '4'.repeat(64)]);
    expect(result.value.zapRequest.tags).toContainEqual(['a', `33402:${'4'.repeat(64)}:mock-program`]);
    expect(lnurl.callbackRequests()).toHaveLength(1);
    expect(lnurl.callbackRequests()[0].searchParams.get('amount')).toBe('21000');
    expect(wallet.receivedMethods()).toEqual(['get_info', 'pay_invoice']);
  });

  it('reports missing recipient metadata before invoice or wallet payment work starts', async () => {
    const connection = parseNwcConnectionString(connectionString(wallet));
    const result = await executeWorkoutProgramZap({
      program: program(lnurl.lnurl, { lud06: undefined }),
      amountSats: 21,
      signer: signer(),
      nwcConnection: connection
    }, { nwc: { timeoutMs: 2_000 } });

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-recipient', recipientError: { code: 'missing-lnurl' } } });
    expect(lnurl.callbackRequests()).toHaveLength(0);
    expect(wallet.receivedMethods()).toEqual([]);
  });

  it('surfaces NWC payment failures as structured failed zap results', async () => {
    wallet.setMode('payment-failure');
    const connection = parseNwcConnectionString(connectionString(wallet));
    const result = await executeWorkoutProgramZap({
      program: program(lnurl.lnurl),
      amountSats: 21,
      signer: signer(),
      nwcConnection: connection
    }, { nwc: { timeoutMs: 2_000 } });

    expect(result).toMatchObject({ ok: false, error: { code: 'payment-failed', nwcCode: 'payment_failure', nwcKind: 'payment_failure' } });
    expect(wallet.receivedMethods()).toEqual(['pay_invoice']);
  });
});
