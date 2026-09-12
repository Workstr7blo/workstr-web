import { describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { deleteRetiredWalletDatabase, RETIRED_WALLET_DATABASE } from '../src/db/retire-lightning';

const databaseNames = async (): Promise<string[]> => (await indexedDB.databases()).map((info) => info.name || '');

describe('retiring the Lightning wallet connection', () => {
  it('deletes the encrypted wallet database a Lightning build left behind', async () => {
    const db = await openDB(RETIRED_WALLET_DATABASE, 1, {
      upgrade(database) { database.createObjectStore('connections', { keyPath: 'id' }); }
    });
    await db.put('connections', { id: 'ab:active', ciphertext: 'sealed' });
    db.close();
    expect(await databaseNames()).toContain(RETIRED_WALLET_DATABASE);

    await deleteRetiredWalletDatabase();

    expect(await databaseNames()).not.toContain(RETIRED_WALLET_DATABASE);
  });

  it('costs a device that never connected a wallet nothing', async () => {
    await expect(deleteRetiredWalletDatabase()).resolves.toBeUndefined();
  });

  // Boot awaits this, so it must settle on every path rather than hold the app up.
  it('settles where IndexedDB is missing or refuses', async () => {
    await expect(deleteRetiredWalletDatabase(null)).resolves.toBeUndefined();
    const refusing = { deleteDatabase() { throw new Error('denied'); } } as unknown as IDBFactory;
    await expect(deleteRetiredWalletDatabase(refusing)).resolves.toBeUndefined();
  });
});
