import { describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';
import { MAX_BUNDLE_BYTES, NIP46_REQUEST_CEILING_BYTES, sessionsBundleRecords } from '../src/sync/records';
import { buildPrivateRecordEvent } from '../src/nostr/codecs30078';
import type { Session, SessionSet } from '../src/core/types';

// A backup record is never carried on its own. Under NIP-46 it makes two trips inside
// other events — once as the plaintext of an encrypt request, once as a whole unsigned
// event inside a signing request — and each trip is NIP-44 encrypted again. A budget
// picked against the backup relay's own limit missed that entirely and shipped a bundle
// no remote signer could sign, so the arithmetic is measured here rather than reasoned
// about: real NIP-44, real event envelopes, the sizes a signer's relay actually sees.
const secret = generateSecretKey();
const self = getPublicKey(secret);
const conversation = nip44.getConversationKey(secret, self);

function heavyMonth(sessions: number, setsEach: number): { session: Session; sets: SessionSet[] }[] {
  return Array.from({ length: sessions }, (_, day) => {
    const date = `2026-08-${String(day + 1).padStart(2, '0')}`;
    return {
      session: {
        id: day + 1, uid: `uid-${day}`, started_at: `${date}T10:00:00.000Z`, finished_at: `${date}T11:30:00.000Z`,
        sheet_name: 'Upper Body Hypertrophy Block A'
      } as Session,
      sets: Array.from({ length: setsEach }, (_, n) => ({
        id: n, session_id: day + 1, exercise_slug: 'barbell-bench-press-medium-grip', set_number: n + 1,
        reps: 8, weight_kg: 82.5, completed_at: `${date}T10:${String(n).padStart(2, '0')}:00.000Z`
      })) as SessionSet[]
    };
  });
}

// The kind:24133 event a NIP-46 request is delivered in.
function nip46RequestBytes(method: string, params: string[]): number {
  const body = JSON.stringify({ id: 'e'.repeat(16), method, params });
  const request = finalizeEvent({
    kind: 24133, created_at: Math.floor(Date.now() / 1000),
    tags: [['p', self]], content: nip44.encrypt(body, conversation)
  }, secret);
  return JSON.stringify(request).length;
}

describe('a bundle a remote signer can actually sign', () => {
  it('keeps both NIP-46 round trips inside the ceiling', () => {
    const parts = sessionsBundleRecords('2026-08', heavyMonth(26, 30));
    expect(parts.length).toBeGreaterThan(1);

    for (const part of parts) {
      const envelope = JSON.stringify({ v: 1, updatedAt: part.updatedAt, payload: part.payload });
      // Asking the signer to encrypt the record: the record travels as a parameter.
      expect(nip46RequestBytes('nip44_encrypt', [self, envelope])).toBeLessThan(NIP46_REQUEST_CEILING_BYTES);

      // Asking it to sign the result: now the whole event, ciphertext and all, is the
      // parameter. This is the larger of the two and the one that broke at 40 KB.
      const event = buildPrivateRecordEvent(part.address, nip44.encrypt(envelope, conversation));
      expect(nip46RequestBytes('sign_event', [JSON.stringify(event)])).toBeLessThan(NIP46_REQUEST_CEILING_BYTES);
    }
  });

  it('splits a month rather than letting one session grow past the budget', () => {
    const parts = sessionsBundleRecords('2026-08', heavyMonth(26, 30));
    for (const part of parts) {
      const items = JSON.stringify(part.payload.items).length;
      // One session may exceed the budget on its own and still gets its own part; what
      // must not happen is two sessions being packed past it.
      if (part.payload.items.length > 1) expect(items).toBeLessThanOrEqual(MAX_BUNDLE_BYTES * 1.1);
    }
  });
});
