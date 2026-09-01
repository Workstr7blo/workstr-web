import type { WorkstrStore } from '../db/store';
import type { SignedNostrEvent, Signer } from '../signer/types';
import { republishBackupKey } from '../nostr/backup-key';
import { fetchKeyEvent, publishKeyEvent } from './relay';

export async function repairCachedKeyIfOlderBackupWasSeen({
  store, signer, relayUrl, cachedKeyRaw, relayKeyRaw, relayKeyEvent, readableBeforeKey = false
}: {
  store: WorkstrStore;
  signer: Signer;
  relayUrl: string;
  cachedKeyRaw?: string;
  relayKeyRaw?: string;
  relayKeyEvent: SignedNostrEvent | null;
  readableBeforeKey?: boolean;
}): Promise<boolean> {
  if (!cachedKeyRaw || !relayKeyRaw || relayKeyRaw === cachedKeyRaw || !relayKeyEvent?.created_at) return false;
  const seenOlderBackup = readableBeforeKey || (await store.listSeen()).some((entry) => entry.created_at < (relayKeyEvent?.created_at || 0));
  if (!seenOlderBackup) return false;
  const pubkey = await signer.getPublicKey();
  return republishBackupKey(signer, {
    fetchKeyEvent: () => fetchKeyEvent(relayUrl, pubkey),
    publishKeyEvent: (content: string, fingerprint?: string) => publishKeyEvent(signer, relayUrl, content, fingerprint)
  }, cachedKeyRaw);
}
