import { nip19 } from 'nostr-tools';
import { hasNip07, createNip07Signer } from '../signer/nip07';
import { WorkstrStore } from '../db/store';

function shortNpub(pubkey: string): string {
  const npub = nip19.npubEncode(pubkey);
  return `${npub.slice(0, 12)}...${npub.slice(-8)}`;
}

export function renderShell(root: HTMLElement): void {
  root.innerHTML = `
    <div class="noise"></div>
    <div class="cyber-grid"></div>
    <header class="topbar">
      <div class="logo-zone">
        <div class="glyph">W</div>
        <div class="logo-text">
          <div class="logo-mark">Workstr <span>Web</span></div>
          <div class="logo-tagline">local-first nostr training</div>
        </div>
      </div>
      <div class="topbar-actions"><span id="live-status">offline ready</span></div>
    </header>
    <aside class="sidebar">
      <nav class="nav-items">
        <button class="nav-item active"><span>Home</span></button>
        <button class="nav-item"><span>Library</span></button>
        <button class="nav-item"><span>Train</span></button>
        <button class="nav-item"><span>Progress</span></button>
      </nav>
    </aside>
    <main class="content">
      <section class="page" style="display:block">
        <div class="hero-card">
          <p class="eyebrow">Phase 0 foundation</p>
          <h1>Static, keyless Workstr starts here.</h1>
          <p class="lede">This PWA stores data in IndexedDB and delegates all Nostr signing to user-owned signers. No nsec paste flow exists.</p>
          <div class="action-row">
            <button id="connect-nip07" class="button primary">Connect NIP-07 signer</button>
            <button id="open-db" class="button ghost">Open demo local DB</button>
          </div>
          <pre id="status-panel" class="terminal-mini">$ workstr-web boot\nsecure context: ${window.isSecureContext}\nnip07 signer: ${hasNip07() ? 'available' : 'not detected'}\n</pre>
        </div>
      </section>
    </main>`;

  root.querySelector('#connect-nip07')?.addEventListener('click', async () => {
    const panel = root.querySelector('#status-panel');
    try {
      const signer = createNip07Signer();
      const pubkey = await signer.getPublicKey();
      panel!.textContent += `$ signer connected ${shortNpub(pubkey)}\n`;
      await WorkstrStore.open(pubkey);
      panel!.textContent += '$ indexeddb namespace opened\n';
    } catch (error) {
      panel!.textContent += `$ signer error ${(error as Error).message}\n`;
    }
  });

  root.querySelector('#open-db')?.addEventListener('click', async () => {
    const panel = root.querySelector('#status-panel');
    await WorkstrStore.open('demo-local-pubkey');
    panel!.textContent += '$ demo indexeddb namespace opened\n';
  });
}
