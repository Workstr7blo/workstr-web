const APP_HOST = 'app.workstr.7blo.org';

function appHref(): string {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return `${window.location.origin}${window.location.pathname}?app=1`;
  }
  return `https://${APP_HOST}/`;
}

export function shouldRenderApp(): boolean {
  const params = new URLSearchParams(window.location.search);
  return window.location.hostname === APP_HOST || params.get('app') === '1';
}

export function renderLanding(root: HTMLElement): void {
  root.innerHTML = `
    <div class="landing-page">
      <div class="noise"></div>
      <div class="cyber-grid"></div>
      <header class="landing-topbar">
        <a class="landing-brand" href="./" aria-label="Workstr home">
          <div class="glyph">W</div>
          <div class="logo-text">
            <div class="logo-mark">Workstr <span>Web</span></div>
            <div class="logo-tagline">local-first nostr training</div>
          </div>
        </a>
        <nav class="landing-nav" aria-label="Primary">
          <a href="#why">Why</a>
          <a href="#privacy">Privacy</a>
          <a href="#nostr">Nostr</a>
          <a class="launch-pill" href="${appHref()}">Launch App</a>
        </nav>
      </header>

      <main class="landing-main">
        <section class="landing-hero">
          <div class="hero-copy">
            <p class="eyebrow">Nostr-native training</p>
            <h1>Own your workouts. Keep your keys.</h1>
            <p class="lede">Workstr Web is a local-first training app for building exercise libraries, programs, sessions, and progress logs that can publish to Nostr without ever asking for your private key.</p>
            <div class="action-row">
              <a class="button primary" href="${appHref()}">Launch App</a>
              <a class="button ghost" href="#why">See how it works</a>
            </div>
          </div>
          <div class="hero-orbit" aria-hidden="true">
            <div class="orbit-card main">
              <span>Local DB</span>
              <strong>IndexedDB</strong>
              <small>offline-first workout data</small>
            </div>
            <div class="orbit-card signer">
              <span>Signer</span>
              <strong>NIP-07 / NIP-46</strong>
              <small>no nsec paste flow</small>
            </div>
            <div class="orbit-card publish">
              <span>Publish</span>
              <strong>Nostr events</strong>
              <small>portable public routines</small>
            </div>
          </div>
        </section>

        <section id="why" class="landing-section card-grid">
          <article class="info-card">
            <span class="section-label">Local-first</span>
            <h2>Your training data starts on your device.</h2>
            <p>Exercise drafts, programs, and sessions live in browser storage first. The app remains useful without a server account or always-on backend.</p>
          </article>
          <article class="info-card">
            <span class="section-label">Programmable</span>
            <h2>Build a reusable exercise and program library.</h2>
            <p>Workstr is designed around structured movements, muscles, sets, reps, rest, and programs instead of plain notes.</p>
          </article>
          <article id="nostr" class="info-card">
            <span class="section-label">Nostr-native</span>
            <h2>Publish and discover open training content.</h2>
            <p>Public exercises and programs can become signed Nostr events, so useful routines can travel across clients and relays.</p>
          </article>
        </section>

        <section id="privacy" class="landing-section privacy-panel">
          <div>
            <span class="section-label">Privacy model</span>
            <h2>No password account. No pasted private key.</h2>
            <p>Workstr Web delegates signing to a signer you control. The app should never store an nsec, and Phase 1 stays static with no app backend.</p>
          </div>
          <a class="launch-pill large" href="${appHref()}">Launch App</a>
        </section>
      </main>
    </div>`;
}
