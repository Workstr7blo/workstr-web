// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  assertBackupPassword,
  decryptTipJarBackup,
  encryptTipJarBackup,
  TIP_JAR_BACKUP_MIN_PASSWORD,
  parseTipJarBackupFile,
  tipJarBackupFilename,
  tipJarBackupPayload,
  TipJarBackupError,
  type TipJarBackupPayload
} from '../src/features/monero/wallet-backup';
import { tipJarBackupBody, tipJarBackupSection, updateTipJarBackupSection } from '../src/features/monero/wallet-backup-view';
import { createTipJarBackupController } from '../src/app/tip-jar-backup-controller';
import { backupCardBody, backupPanelState } from '../src/features/backup/views';
import type { AppState } from '../src/app/state';
import type { MoneroWalletSecretBundle, MoneroWalletUiState } from '../src/features/monero/types';

const PUBKEY = 'ab'.repeat(32);
const ADDRESS = `8${'A'.repeat(94)}`;
const PASSWORD = 'a long enough password';
const SEED = 'jaded aztec inbound karate gambit avatar tuxedo hydrogen jubilee molten spout fossil';

function bundle(): MoneroWalletSecretBundle {
  return {
    version: 1,
    metadata: {
      version: 1, id: 'wallet-1', scope: `monero.hot-wallet.${PUBKEY}`, network: 'mainnet',
      node: { mode: 'workstr', host: 'xmr.workstr.fit', port: 43736, ssl: true, network: 'mainnet' },
      restoreHeight: 3_763_633, primaryAddress: '4Primary', creatorSubaddress: ADDRESS, creatorSubaddressIndex: 1,
      createdAt: '2026-09-15T00:00:00.000Z', updatedAt: '2026-09-15T00:00:00.000Z', source: 'created'
    },
    seed: SEED,
    privateSpendKey: 'spend-key-never-exported',
    privateViewKey: 'view-key-never-exported'
  };
}

function state(overrides: Partial<AppState> = {}, wallet: MoneroWalletUiState = { status: 'stored', stored: true }): AppState {
  return {
    pubkey: PUBKEY, npub: null, profileName: null, profilePicture: null, profileNames: {}, store: null, view: 'settings',
    settings: { unit: 'kg', paymentMode: 'monero', publicRelays: [] },
    monero: { status: 'ready', address: '' },
    moneroWallet: wallet,
    deviceVault: 'unlocked',
    library: [], discoverExercises: [], finishedSessions: [], sheets: [],
    backup: { state: 'off', pending: 0 }, signInStatus: null,
    ...overrides
  } as unknown as AppState;
}

describe('the Tip Jar backup file', () => {
  it('carries what a restore needs and nothing that is only true of this device', async () => {
    const payload = tipJarBackupPayload(bundle());
    expect(payload).toEqual({
      network: 'mainnet', seed: SEED, restoreHeight: 3_763_633, creatorSubaddressIndex: 1,
      creatorSubaddress: ADDRESS, primaryAddress: '4Primary', createdAt: '2026-09-15T00:00:00.000Z'
    });
    // The spend and view keys, the node and the vault scope belong to this device, not to the
    // wallet: a file that carried them would restore someone else's node configuration too.
    const text = JSON.stringify(payload);
    expect(text).not.toContain('spend-key-never-exported');
    expect(text).not.toContain('view-key-never-exported');
    expect(text).not.toContain('monero.hot-wallet');
  });

  // The whole point of the file: the restore height comes back automatically, so nobody has to
  // remember a block number to avoid a full-chain rescan.
  it('round-trips through a password and preserves the restore height', async () => {
    const file = await encryptTipJarBackup(tipJarBackupPayload(bundle()), PASSWORD, new Date('2026-09-17T08:00:00.000Z'));
    expect(file).toMatchObject({ type: 'workstr-tipjar-backup', version: 1, network: 'mainnet', cipher: 'AES-GCM' });
    expect(file.kdf.name).toBe('argon2id');
    expect(file.kdf.salt).toBeTruthy();
    const text = JSON.stringify(file);
    expect(text).not.toContain(SEED);
    expect(text).not.toContain('jaded');
    const restored = await decryptTipJarBackup(text, PASSWORD);
    expect(restored.seed).toBe(SEED);
    expect(restored.restoreHeight).toBe(3_763_633);
  });

  it('will not export under a password too short to be worth an Argon2id pass', async () => {
    await expect(encryptTipJarBackup(tipJarBackupPayload(bundle()), 'short')).rejects.toBeInstanceOf(TipJarBackupError);
  });

  // The file travels - email, cloud drives, USB sticks - and anyone holding it can guess
  // offline, so the floor is twelve characters. Length is the only rule: no character classes.
  it('asks for at least twelve characters and nothing else', () => {
    expect(TIP_JAR_BACKUP_MIN_PASSWORD).toBe(12);
    expect(() => assertBackupPassword('8charsxx')).toThrow('at least 12 characters');
    expect(() => assertBackupPassword('elevenchars')).toThrow('at least 12 characters');
    expect(() => assertBackupPassword('twelve chars')).not.toThrow();
    expect(() => assertBackupPassword('all lowercase words with spaces and no digits')).not.toThrow();
    expect(() => assertBackupPassword('twelve chars', 'twelve charz')).toThrow('do not match');
  });

  it('turns away the few long passwords that would be guessed first', () => {
    for (const weak of ['password1234', '123456789012', 'QWERTY123456', 'aaaaaaaaaaaaaaa']) expect(() => assertBackupPassword(weak), weak).toThrow('too easy to guess');
  });

  // Restoring is not export: a file made under the old eight-character floor must still open, so
  // a wrong short password fails as a wrong password rather than as a length rule.
  it('applies no length rule when restoring', async () => {
    const file = await encryptTipJarBackup(tipJarBackupPayload(bundle()), PASSWORD);
    await expect(decryptTipJarBackup(JSON.stringify(file), 'short')).rejects.toThrow(/password is not right/);
  });

  it('overwrites the decrypted bytes once they are decoded', async () => {
    const file = await encryptTipJarBackup(tipJarBackupPayload(bundle()), PASSWORD);
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    let plaintext: ArrayBuffer | null = null;
    const spy = vi.spyOn(crypto.subtle, 'decrypt').mockImplementation(async (...args: Parameters<SubtleCrypto['decrypt']>) => (plaintext = await decrypt(...args)));
    try {
      await decryptTipJarBackup(JSON.stringify(file), PASSWORD);
    } finally {
      spy.mockRestore();
    }
    expect(plaintext).not.toBeNull();
    expect(new Uint8Array(plaintext!).every((byte) => byte === 0)).toBe(true);
  });

  it('tells the reader the rule and that the password cannot be recovered', () => {
    const host = document.createElement('div');
    host.innerHTML = tipJarBackupBody(state({ tipJarBackup: { panel: 'export' } } as Partial<AppState>));
    expect(host.querySelector('#tip-jar-backup-password-help')?.textContent).toBe('Use at least 12 characters. A passphrase of several words works well. This password cannot be recovered.');
    expect(host.querySelector('#tip-jar-backup-password')?.getAttribute('minlength')).toBe('12');
  });

  it('names the file for the day and its own extension', () => {
    expect(tipJarBackupFilename(new Date('2026-09-17T08:00:00.000Z'))).toBe('workstr-tipjar-backup-2026-09-17.wstrwallet');
  });

  it('fails safely on a wrong password, a foreign file, a newer version and a damaged payload', async () => {
    const file = await encryptTipJarBackup(tipJarBackupPayload(bundle()), PASSWORD);
    await expect(decryptTipJarBackup(JSON.stringify(file), 'a different password')).rejects.toThrow(/password is not right/);
    expect(() => parseTipJarBackupFile('{"hello":"world"}')).toThrow(/not a Workstr Tip Jar backup/);
    expect(() => parseTipJarBackupFile('not json at all')).toThrow(/not a Workstr Tip Jar backup/);
    expect(() => parseTipJarBackupFile(JSON.stringify({ ...file, version: 2 }))).toThrow(/newer version/);
    expect(() => parseTipJarBackupFile(JSON.stringify({ ...file, kdf: { ...file.kdf, name: 'pbkdf2' } }))).toThrow(/unsupported format/);
    expect(() => parseTipJarBackupFile(JSON.stringify({ ...file, network: 'regtest' }))).toThrow(/unsupported Monero network/);
  });

  // The network is outside the ciphertext so a restore can refuse before asking for a password,
  // and inside the authenticated data so nobody can edit it to mean something else.
  it('refuses a file whose stated network has been edited', async () => {
    const file = await encryptTipJarBackup(tipJarBackupPayload(bundle()), PASSWORD);
    await expect(decryptTipJarBackup(JSON.stringify({ ...file, network: 'stagenet' }), PASSWORD)).rejects.toThrow(/password is not right/);
  });
});

describe('the Tip Jar backup section in Data & Sync', () => {
  it('keeps Tip Jar backups separate from training data, and never joins the training JSON', () => {
    const body = backupCardBody(backupPanelState(state(), tipJarBackupSection(state())));
    expect(body.indexOf('sync-control-group')).toBeLessThan(body.indexOf('data-sync-backups'));
    expect(body.indexOf('data-sync-backups')).toBeLessThan(body.indexOf('tip-jar-backup-group'));
    // Two files, two destinations. The JSON export is training and the Tip Jar backup is spend
    // authority, and nothing here offers to put them in one artifact.
    expect(body).toContain('id="export-data"');
    expect(body).toContain('id="tip-jar-backup-export"');
    expect(body).toContain('Tip Jar data');
  });

  it('offers nothing while the device vault is locked, and only Restore with no wallet', () => {
    expect(tipJarBackupBody(state({ deviceVault: 'locked' }))).toContain('Unlock Workstr');
    const empty = state({}, { status: 'missing', stored: false });
    expect(tipJarBackupBody(empty)).toContain('Restore one from a backup file or a recovery phrase.');
    expect(tipJarBackupBody(empty)).not.toContain('id="tip-jar-backup-export"');
    expect(tipJarBackupBody(empty)).toContain('id="tip-jar-backup-restore"');
    // Storage has not answered yet: nothing that reads or writes a wallet is offered.
    const unchecked = tipJarBackupBody(state({}, { status: 'unknown' }));
    expect(unchecked).not.toContain('id="tip-jar-backup-restore"');
  });

  it('keeps the recovery phrase out of the document until it is revealed', () => {
    document.body.innerHTML = tipJarBackupSection(state());
    const advanced = document.querySelector<HTMLDetailsElement>('.tip-jar-recovery')!;
    expect(advanced.open).toBe(false);
    expect(document.body.textContent).not.toContain(SEED);
    // Not merely hidden - not present. Opening the disclosure is not consent to show it.
    expect(document.querySelector('.tip-jar-recovery-phrase')).toBeNull();
    expect(document.querySelector('#tip-jar-reveal-phrase')?.textContent).toBe('Reveal');

    const revealed = state({}, { status: 'ready', stored: true, backup: { seed: SEED, restoreHeight: 3_763_633 } });
    revealed.tipJarBackup = { panel: 'idle', advanced: true, busy: false };
    updateTipJarBackupSection(document, revealed);
    expect(document.querySelector('.tip-jar-recovery-phrase code')?.textContent).toBe(SEED);
    expect(document.body.textContent).toContain('Anyone with these words can spend this Tip Jar.');
  });

  it('shows the restore height only inside Advanced recovery', () => {
    document.body.innerHTML = tipJarBackupSection(state({}, { status: 'ready', stored: true, backup: { seed: SEED, restoreHeight: 3_763_633 } }));
    const height = [...document.querySelectorAll('.settings-subtle-row')].find((row) => row.textContent?.includes('3763633'));
    expect(height).toBeTruthy();
    expect(height?.closest('.tip-jar-recovery')).toBeTruthy();
    expect(document.querySelector('#tip-jar-backup-body')?.textContent).toContain('Restore height');
  });

  it('reports when this device last wrote a file, never that the file is safe', () => {
    const s = state();
    s.tipJarBackup = { panel: 'idle', advanced: false, busy: false, exportedAt: '2026-09-16T10:00:00.000Z' };
    const body = tipJarBackupBody(s);
    expect(body).toContain('Last backup:');
    expect(body).not.toMatch(/protected|secure|safe/i);
    expect(tipJarBackupBody(state())).toContain('Not backed up yet');
  });
});

describe('the Tip Jar backup controller', () => {
  function mount(wallet: MoneroWalletUiState = { status: 'stored', stored: true }, confirmReplace = () => true) {
    const s = state({}, wallet);
    document.body.innerHTML = `<div id="app">${tipJarBackupSection(s)}</div>`;
    const root = document.getElementById('app') as HTMLElement;
    const saved: { filename: string; contents: string }[] = [];
    const walletApi = {
      restore: vi.fn(async () => true),
      toggleRecoveryPhrase: vi.fn(async () => undefined),
      hideRecoveryPhrase: vi.fn(),
      backupPayload: vi.fn(async (): Promise<TipJarBackupPayload> => tipJarBackupPayload(bundle()))
    };
    const toast = vi.fn();
    const ctrl = createTipJarBackupController({
      root, state: s, toast, wallet: walletApi, confirmReplace,
      save: (filename, contents) => { saved.push({ filename, contents }); },
      now: () => new Date('2026-09-17T08:00:00.000Z')
    });
    return { s, root, ctrl, walletApi, toast, saved };
  }

  function click(root: HTMLElement, id: string): void {
    root.querySelector<HTMLButtonElement>(`#${id}`)?.click();
  }

  function submit(root: HTMLElement, id: string): void {
    root.querySelector<HTMLFormElement>(`#${id}`)?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }

  it('encrypts the export under a confirmed password and remembers the day', async () => {
    const { root, saved, s, toast } = mount();
    click(root, 'tip-jar-backup-export');
    root.querySelector<HTMLInputElement>('#tip-jar-backup-password')!.value = PASSWORD;
    root.querySelector<HTMLInputElement>('#tip-jar-backup-password-confirm')!.value = PASSWORD;
    submit(root, 'tip-jar-backup-export-form');
    await vi.waitFor(() => expect(saved.length).toBe(1));
    expect(saved[0].filename).toBe('workstr-tipjar-backup-2026-09-17.wstrwallet');
    expect(saved[0].contents).not.toContain(SEED);
    expect(await decryptTipJarBackup(saved[0].contents, PASSWORD)).toMatchObject({ seed: SEED, restoreHeight: 3_763_633 });
    expect(s.tipJarBackup?.exportedAt).toBe('2026-09-17T08:00:00.000Z');
    expect(toast).toHaveBeenCalledWith('Tip Jar backup exported');
  });

  it('writes no file when the two passwords disagree', async () => {
    const { root, saved } = mount();
    click(root, 'tip-jar-backup-export');
    root.querySelector<HTMLInputElement>('#tip-jar-backup-password')!.value = PASSWORD;
    root.querySelector<HTMLInputElement>('#tip-jar-backup-password-confirm')!.value = `${PASSWORD}x`;
    submit(root, 'tip-jar-backup-export-form');
    await vi.waitFor(() => expect(root.querySelector('#tip-jar-backup-message')?.textContent).toContain('do not match'));
    expect(saved).toEqual([]);
  });

  // A wrong password must leave the stored wallet exactly as it was. It is the one failure that
  // would otherwise be indistinguishable from a successful replace.
  it('does not touch the stored wallet when the backup password is wrong', async () => {
    const { root, walletApi } = mount();
    const file = JSON.stringify(await encryptTipJarBackup(tipJarBackupPayload(bundle()), PASSWORD));
    click(root, 'tip-jar-backup-restore');
    await chooseFile(root, file);
    root.querySelector<HTMLInputElement>('#tip-jar-backup-restore-password')!.value = 'not the password';
    submit(root, 'tip-jar-backup-restore-form');
    await vi.waitFor(() => expect(root.querySelector('#tip-jar-backup-message')?.textContent).toContain('password is not right'));
    expect(walletApi.restore).not.toHaveBeenCalled();
  });

  it('asks before replacing a Tip Jar that is already on this device, and stops on no', async () => {
    const file = JSON.stringify(await encryptTipJarBackup(tipJarBackupPayload(bundle()), PASSWORD));
    const refused = mount({ status: 'stored', stored: true }, () => false);
    click(refused.root, 'tip-jar-backup-restore');
    await chooseFile(refused.root, file);
    refused.root.querySelector<HTMLInputElement>('#tip-jar-backup-restore-password')!.value = PASSWORD;
    submit(refused.root, 'tip-jar-backup-restore-form');
    await vi.waitFor(() => expect(refused.root.querySelector('#tip-jar-backup-message')?.textContent).toContain('cancelled'));
    expect(refused.walletApi.restore).not.toHaveBeenCalled();

    const accepted = mount({ status: 'stored', stored: true }, () => true);
    click(accepted.root, 'tip-jar-backup-restore');
    await chooseFile(accepted.root, file);
    accepted.root.querySelector<HTMLInputElement>('#tip-jar-backup-restore-password')!.value = PASSWORD;
    submit(accepted.root, 'tip-jar-backup-restore-form');
    await vi.waitFor(() => expect(accepted.walletApi.restore).toHaveBeenCalledWith({ seed: SEED, restoreHeight: 3_763_633, replace: true }));
  });

  it('restores into an empty device without asking to replace anything', async () => {
    const file = JSON.stringify(await encryptTipJarBackup(tipJarBackupPayload(bundle()), PASSWORD));
    const confirmReplace = vi.fn(() => true);
    const { root, walletApi } = mount({ status: 'missing', stored: false }, confirmReplace);
    click(root, 'tip-jar-backup-restore');
    await chooseFile(root, file);
    root.querySelector<HTMLInputElement>('#tip-jar-backup-restore-password')!.value = PASSWORD;
    submit(root, 'tip-jar-backup-restore-form');
    await vi.waitFor(() => expect(walletApi.restore).toHaveBeenCalledWith({ seed: SEED, restoreHeight: 3_763_633, replace: false }));
    expect(confirmReplace).not.toHaveBeenCalled();
  });

  it('restores from a recovery phrase in Advanced recovery, and rejects a malformed height', async () => {
    const { root, walletApi, toast } = mount({ status: 'missing', stored: false });
    root.querySelector<HTMLTextAreaElement>('#tip-jar-seed')!.value = SEED;
    root.querySelector<HTMLInputElement>('#tip-jar-seed-height')!.value = '-5';
    submit(root, 'tip-jar-seed-restore-form');
    expect(walletApi.restore).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Restore height'), 'bad');
    // The phrase the user just pasted survives the refusal.
    expect(root.querySelector<HTMLTextAreaElement>('#tip-jar-seed')?.value).toBe(SEED);

    root.querySelector<HTMLInputElement>('#tip-jar-seed-height')!.value = '3763633';
    submit(root, 'tip-jar-seed-restore-form');
    await vi.waitFor(() => expect(walletApi.restore).toHaveBeenCalledWith({ seed: SEED, restoreHeight: 3_763_633, replace: false }));
  });

  it('reveals the recovery phrase only on its own button', () => {
    const { root, walletApi } = mount();
    expect(walletApi.toggleRecoveryPhrase).not.toHaveBeenCalled();
    click(root, 'tip-jar-reveal-phrase');
    expect(walletApi.toggleRecoveryPhrase).toHaveBeenCalledTimes(1);
  });

  it('hides the recovery phrase when Advanced recovery is closed', () => {
    const { root, walletApi } = mount();
    const details = root.querySelector<HTMLDetailsElement>('.tip-jar-recovery')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(walletApi.hideRecoveryPhrase).not.toHaveBeenCalled();
    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    expect(walletApi.hideRecoveryPhrase).toHaveBeenCalledTimes(1);
  });

  async function chooseFile(root: HTMLElement, contents: string): Promise<void> {
    const input = root.querySelector<HTMLInputElement>('#tip-jar-backup-file')!;
    const file = { name: 'workstr-tipjar-backup-2026-09-17.wstrwallet', text: async () => contents } as File;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(root.querySelector('.tip-jar-backup-file')?.textContent).toContain('.wstrwallet'));
  }
});

// The hard boundary: training data and wallet secrets are different artifacts. The JSON export
// reads the IndexedDB store, and the seed is not in it - it is in the device vault. This keeps
// the module that writes the JSON honest about that.
describe('the training export boundary', () => {
  it('has no reach into the wallet, the vault or a seed', () => {
    const source = readFileSync(resolve(__dirname, '../src/db/export.ts'), 'utf8');
    for (const forbidden of ['monero', 'wallet', 'seed', 'device-vault', 'tipjar', 'tip-jar']) {
      expect(source.toLowerCase()).not.toContain(forbidden);
    }
  });
});
