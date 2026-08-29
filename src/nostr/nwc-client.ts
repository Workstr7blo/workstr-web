// Nostr Wallet Connect (NIP-47) client operations.
//
// Uses the client secret from the NWC connection as an isolated NIP-47 keypair;
// it never touches the user's identity signer. Requests are kind:23194 and
// responses kind:23195. NIP-47/NWC wallets use NIP-04 content encryption;
// NIP-44 is accepted as a compatibility fallback for older local test builds.
import { SimplePool, verifyEvent, type Event } from 'nostr-tools';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { decrypt as nip04DecryptPayload, encrypt as nip04EncryptPayload } from 'nostr-tools/nip04';
import { decrypt as nip44DecryptPayload, getConversationKey } from 'nostr-tools/nip44';
import { hexToBytes } from '@noble/hashes/utils.js';
import { NwcError, toNwcError, type NwcConnection, type NwcResult } from './nwc';

export const NWC_REQUEST_KIND = 23194;
export const NWC_RESPONSE_KIND = 23195;
export const NWC_INFO_KIND = 13194;
export const DEFAULT_NWC_TIMEOUT_MS = 30_000;
export const RELAY_CONNECT_TIMEOUT_MS = 10_000;
export const RELAY_PUBLISH_TIMEOUT_MS = 10_000;

export type NwcMethod = 'get_info' | 'pay_invoice';

export interface NwcRequestPayload {
  method: NwcMethod;
  params: Record<string, unknown>;
}

export interface NwcResponsePayload {
  result_type?: string;
  result?: Record<string, unknown> | null;
  error?: { code?: string; message?: string };
}

export interface NwcClientOptions {
  transport?: NwcClientTransport;
  timeoutMs?: number;
}

export interface NwcClientTransport {
  request(connection: NwcConnection, payload: NwcRequestPayload, options?: { timeoutMs?: number }): Promise<NwcResponsePayload>;
}

export interface NwcInfo {
  alias?: string;
  methods: NwcMethod[];
  notifications: string[];
}

export interface NwcPaymentResult {
  preimage: string;
  feesPaidMsat?: number;
  paymentHash?: string;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, error: NwcError): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(error), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (reason) => { clearTimeout(timer); reject(reason); }
    );
  });
}

function conversationKey(connection: NwcConnection): Uint8Array {
  return getConversationKey(hexToBytes(connection.secret), connection.walletPubkey);
}

async function encryptNwcPayload(connection: NwcConnection, payload: NwcRequestPayload): Promise<string> {
  return Promise.resolve(nip04EncryptPayload(hexToBytes(connection.secret), connection.walletPubkey, JSON.stringify(payload)));
}

async function decryptNwcResponse(connection: NwcConnection, event: Event, key: Uint8Array): Promise<NwcResponsePayload> {
  try {
    const plaintext = await Promise.resolve(nip04DecryptPayload(hexToBytes(connection.secret), event.pubkey, event.content));
    return JSON.parse(plaintext) as NwcResponsePayload;
  } catch {
    // Old local pre-release test builds briefly used NIP-44; keep a read-only
    // fallback so those responses fail soft, while normal NWC wallets use NIP-04.
  }

  try {
    return JSON.parse(nip44DecryptPayload(event.content, key)) as NwcResponsePayload;
  } catch {
    throw new NwcError('unknown_failure', 'Could not read the wallet reply.');
  }
}

function normalizedMethods(value: unknown): NwcMethod[] {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(/\s+/);
  return raw.filter((item): item is NwcMethod => item === 'get_info' || item === 'pay_invoice');
}

function normalizedNotifications(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && Boolean(item));
  return String(value ?? '').split(/\s+/).filter(Boolean);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

async function ensureAnyRelay(pool: SimplePool, relays: string[]): Promise<void> {
  const results = await Promise.allSettled(
    relays.map((relay) => withTimeout(
      pool.ensureRelay(relay),
      RELAY_CONNECT_TIMEOUT_MS,
      new NwcError('timeout', 'Wallet relay connection timed out.')
    ))
  );
  if (results.every((result) => result.status === 'rejected')) {
    throw new NwcError('unreachable_service', 'Could not reach the wallet relay. Check your connection and try again.');
  }
}

function acceptedPublish(result: PromiseSettledResult<string>): boolean {
  return result.status === 'fulfilled' && !result.value.toLowerCase().startsWith('connection failure:');
}

class RelayNwcTransport implements NwcClientTransport {
  async request(connection: NwcConnection, payload: NwcRequestPayload, options: { timeoutMs?: number } = {}): Promise<NwcResponsePayload> {
    const pool = new SimplePool();
    const relays = connection.relays;
    try {
      await ensureAnyRelay(pool, relays);
      const key = conversationKey(connection);
      const secretBytes = hexToBytes(connection.secret);
      const clientPubkey = getPublicKey(secretBytes);
      const encryptedContent = await encryptNwcPayload(connection, payload);
      const requestEvent = finalizeEvent({
        kind: NWC_REQUEST_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', connection.walletPubkey]],
        content: encryptedContent
      }, secretBytes);

      const responsePromise = new Promise<Event>((resolve, reject) => {
        const sub = pool.subscribeMany(relays, { kinds: [NWC_RESPONSE_KIND], authors: [connection.walletPubkey], '#p': [clientPubkey] }, {
          onevent(event) {
            if (!event.tags.some((tag) => tag[0] === 'e' && tag[1] === requestEvent.id)) return;
            sub.close();
            resolve(event);
          },
          onclose(reasons) {
            reject(new NwcError('unreachable_service', `Wallet relay closed before replying (${reasons.join('; ')}).`));
          }
        });
      });

      const publishResults = await Promise.allSettled(
        pool.publish(relays, requestEvent).map((publish) => withTimeout(
          publish,
          RELAY_PUBLISH_TIMEOUT_MS,
          new NwcError('timeout', 'Wallet relay publish timed out.')
        ))
      );
      if (publishResults.every((result) => !acceptedPublish(result))) {
        throw new NwcError('unreachable_service', 'Could not publish the request to the wallet relay.');
      }

      const responseEvent = await withTimeout(
        responsePromise,
        options.timeoutMs ?? DEFAULT_NWC_TIMEOUT_MS,
        new NwcError('timeout', 'Wallet did not respond in time. Check your wallet before retrying.')
      );
      if (responseEvent.pubkey !== connection.walletPubkey || !verifyEvent(responseEvent)) {
        throw new NwcError('unknown_failure', 'Wallet reply failed verification.');
      }
      return await decryptNwcResponse(connection, responseEvent, key);
    } finally {
      pool.close(relays);
    }
  }
}

const defaultTransport = new RelayNwcTransport();

function walletErrorToNwcError(response: NwcResponsePayload, method: NwcMethod): NwcError | null {
  if (!response.error) return null;
  const code = String(response.error.code ?? '').toUpperCase();
  const message = response.error.message || 'The wallet rejected the request.';
  if (code === 'NOT_IMPLEMENTED') return new NwcError('unsupported_method', `This wallet does not support ${method}.`, { causeCode: code });
  if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN' || code === 'RESTRICTED') return new NwcError('rejected_unauthorized', message, { causeCode: code });
  if (code === 'EXPIRED' || code === 'EXPIRED_CONNECTION') return new NwcError('expired_connection', message, { causeCode: code });
  if (code === 'INVALID_REQUEST') return new NwcError('invalid_request', message, { causeCode: code });
  if (code === 'PAYMENT_FAILED' || code === 'INSUFFICIENT_BALANCE' || code === 'QUOTA_EXCEEDED') return new NwcError('payment_failure', message, { causeCode: code });
  if (code === 'RATE_LIMITED' || code === 'TEMPORARY_ERROR' || code === 'INTERNAL' || code === 'OTHER') return new NwcError('unknown_failure', message, { causeCode: code });
  return new NwcError(method === 'pay_invoice' ? 'payment_failure' : 'unknown_failure', message, { causeCode: code || undefined });
}

function responseResult(response: NwcResponsePayload, method: NwcMethod): Record<string, unknown> {
  const walletError = walletErrorToNwcError(response, method);
  if (walletError) throw walletError;
  if (response.result_type && response.result_type !== method) {
    throw new NwcError('unknown_failure', 'Wallet reply did not match the request.');
  }
  return response.result ?? {};
}

export async function verifyNwcConnection(connection: NwcConnection, options: NwcClientOptions = {}): Promise<NwcInfo> {
  const transport = options.transport ?? defaultTransport;
  const response = await transport.request(connection, { method: 'get_info', params: {} }, { timeoutMs: options.timeoutMs });
  const result = responseResult(response, 'get_info');
  const methods = normalizedMethods(result.methods);
  if (!methods.includes('pay_invoice')) {
    throw new NwcError('unsupported_method', 'This wallet connection does not allow payments (pay_invoice).');
  }
  return {
    alias: readString(result.alias),
    methods,
    notifications: normalizedNotifications(result.notifications)
  };
}

export async function validateNwcConnection(connection: NwcConnection, options: NwcClientOptions = {}): Promise<NwcResult<NwcInfo>> {
  try {
    return { ok: true, value: await verifyNwcConnection(connection, options) };
  } catch (error) {
    return { ok: false, error: toNwcError(error) };
  }
}

export async function payInvoice(connection: NwcConnection, bolt11: string, options: NwcClientOptions = {}): Promise<NwcPaymentResult> {
  const invoice = bolt11.trim();
  if (!/^ln[a-z0-9]+$/i.test(invoice)) {
    throw new NwcError('invalid_request', 'That does not look like a Lightning invoice.');
  }
  const transport = options.transport ?? defaultTransport;
  const response = await transport.request(connection, { method: 'pay_invoice', params: { invoice } }, { timeoutMs: options.timeoutMs });
  const result = responseResult(response, 'pay_invoice');
  const preimage = readString(result.preimage);
  if (!preimage) throw new NwcError('payment_failure', 'Wallet replied without a payment preimage.');
  return {
    preimage,
    feesPaidMsat: readNumber(result.fees_paid),
    paymentHash: readString(result.payment_hash)
  };
}

export async function payInvoiceResult(connection: NwcConnection, bolt11: string, options: NwcClientOptions = {}): Promise<NwcResult<NwcPaymentResult>> {
  try {
    return { ok: true, value: await payInvoice(connection, bolt11, options) };
  } catch (error) {
    return { ok: false, error: toNwcError(error) };
  }
}
