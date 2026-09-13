import { describe, expect, it, vi } from 'vitest';
import type { Event } from 'nostr-tools';
import { canonCacheSnapshot, primeCanonCache } from '../src/nostr/canon';
import { buildProgramDeletionEvent, deleteCreatorProgram, forgetCanonProgram } from '../src/nostr/program-delete';
import type { ProgramPublishPool } from '../src/nostr/program-publish';
import type { Signer, UnsignedNostrEvent } from '../src/signer/types';

const ME = 'a'.repeat(64);
const address = `33402:${ME}:workstr:beastmode:program:cardio-carnage-2`;
const target = { address, eventId: 'e'.repeat(64) };

function signer(signsAs = ME) {
  const signEvent = vi.fn(async (event: UnsignedNostrEvent) => ({ ...event, id: 'd'.repeat(64), pubkey: signsAs, sig: 's'.repeat(128) }));
  return { signer: { type: 'local', getPublicKey: async () => ME, signEvent } as unknown as Signer, signEvent };
}

function pool(answers: Array<'ok' | 'fail'>) {
  const published: string[][] = [];
  const factory = (): ProgramPublishPool => ({
    publish: (relays) => {
      published.push(relays);
      return relays.map((_, index) => answers[index] === 'ok' ? Promise.resolve('') : Promise.reject(new Error('blocked')));
    },
    close: () => {}
  });
  return { published, factory };
}

describe('buildProgramDeletionEvent', () => {
  it('retracts the program address and its exact version', () => {
    expect(buildProgramDeletionEvent(target, ME)).toMatchObject({
      kind: 5,
      content: '',
      tags: [['a', address], ['e', 'e'.repeat(64)], ['k', '33402']]
    });
    expect(buildProgramDeletionEvent({ address }, ME).tags).toEqual([['a', address], ['k', '33402']]);
  });

  it('refuses anything that is not a program the key authored', () => {
    expect(() => buildProgramDeletionEvent(target, 'b'.repeat(64))).toThrow(/own programs/);
    expect(() => buildProgramDeletionEvent({ address: `33401:${ME}:workstr:exercise:burpee` }, ME)).toThrow(/own programs/);
  });
});

describe('deleteCreatorProgram', () => {
  it('signs once, sends to public relays only, and succeeds on one acknowledgement', async () => {
    const { signer: key, signEvent } = signer();
    const relays = pool(['ok', 'fail']);
    const result = await deleteCreatorProgram(key, target, ['wss://nos.lol', 'wss://relay.damus.io', 'wss://relay.workstr.fit'], { poolFactory: relays.factory });
    expect(relays.published).toEqual([['wss://nos.lol', 'wss://relay.damus.io']]);
    expect(result.okRelays).toEqual(['wss://nos.lol']);
    expect(result.failedRelays).toEqual(['wss://relay.damus.io']);
    expect(signEvent).toHaveBeenCalledTimes(1);
    expect(result.event.kind).toBe(5);
  });

  it('fails when no relay accepts the deletion', async () => {
    const { signer: key } = signer();
    await expect(deleteCreatorProgram(key, target, ['wss://nos.lol'], { poolFactory: pool(['fail']).factory })).rejects.toThrow(/no public relay accepted the deletion/);
  });

  it('refuses before signing when no public relay is configured', async () => {
    const { signer: key, signEvent } = signer();
    await expect(deleteCreatorProgram(key, target, [])).rejects.toThrow(/no public program relays/);
    expect(signEvent).not.toHaveBeenCalled();
  });

  it('sends nothing when the signer signs with a different key', async () => {
    const { signer: key } = signer('b'.repeat(64));
    const relays = pool(['ok']);
    await expect(deleteCreatorProgram(key, target, ['wss://nos.lol'], { poolFactory: relays.factory })).rejects.toThrow(/different key/);
    expect(relays.published).toEqual([]);
  });
});

describe('forgetCanonProgram', () => {
  it('drops the deleted program from the offline catalog snapshot and nothing else', () => {
    const event = (kind: number, d: string) => ({ kind, pubkey: ME, created_at: 1, id: d, sig: '', content: '', tags: [['d', d], ['title', d]] }) as Event;
    primeCanonCache({ fetchedAt: Date.now() + 60000, events: [
      event(33402, 'workstr:beastmode:program:cardio-carnage-2'),
      event(33402, 'workstr:beastmode:program:cardio-carnage-2-3'),
      event(33401, 'workstr:exercise:burpee')
    ] });
    forgetCanonProgram(address);
    expect(canonCacheSnapshot()?.events.map((item) => (item as Event).id)).toEqual(['workstr:beastmode:program:cardio-carnage-2-3', 'workstr:exercise:burpee']);
  });
});
