export interface SyncQueueItem {
  address: string;
  updated_at: string;
}

export function shouldReplaceLocal(localUpdatedAt: string | undefined, remoteUpdatedAt: string): boolean {
  if (!localUpdatedAt) return true;
  return Date.parse(remoteUpdatedAt) > Date.parse(localUpdatedAt);
}
