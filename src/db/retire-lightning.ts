// Lightning zaps were removed in favour of Monero tips (#218). A device that ever connected a
// zap wallet still holds that connection, encrypted in a database of its own. Nothing in the
// app can read it or disconnect it any more, and a spending credential nobody can see is the
// worst kind to leave behind, so the whole database is deleted rather than ignored.
//
// The settings row's half of the cleanup - the local zap history and a stored 'lightning'
// rail - is `WorkstrStore.retireLightningSettings`, because it is per namespace.
export const RETIRED_WALLET_DATABASE = 'workstr-secure-nwc-v1';

export function deleteRetiredWalletDatabase(factory: IDBFactory | null = globalThis.indexedDB ?? null): Promise<void> {
  return new Promise((resolve) => {
    if (!factory) { resolve(); return; }
    try {
      const request = factory.deleteDatabase(RETIRED_WALLET_DATABASE);
      // Deleting a database that does not exist succeeds, so this costs a fresh install
      // nothing. Blocked still completes once the last connection closes, and nothing in
      // this build opens one.
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
