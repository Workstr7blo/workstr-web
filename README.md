# Workstr Web

Static, local-first Nostr workout tracker PWA.

The source of truth for this project is [`docs/instruction.md`](docs/instruction.md).

This is a separate product from the self-hosted Workstr server app. It uses Vite, TypeScript, IndexedDB, NIP-07/NIP-46 signers, and GitHub Pages/static hosting.

For repository work, use [`MODULES.md`](MODULES.md) to locate the code and tests that own
a behavior.

## Development

```bash
npm install
npm run dev
npm run modules
npm test
npm run build
npm run check
```

`npm run modules` performs the fast architecture check configured in
`scripts/module-policy.json`: documented paths, module-size growth, generic filenames,
and cross-feature imports are enforced; documentation/test matching and broad imports
are reported as non-blocking warnings. Existing oversized modules may shrink or stay
stable but cannot grow past their recorded baseline.

Run `npm run check` before handoff or review. It runs the module check, the test suite,
and the production TypeScript/Vite build. `.github/workflows/check.yml` runs the same
command for pull requests and pushes to `main`, `feature/**`, and `fix/**` branches.

## Maintainer docs

- [NWC workout-program zaps](docs/nwc-workout-zaps.md) — setup, secure wallet
  configuration, mock-wallet testing, payload flow, failure handling, and manual QA for
  creator zaps through Nostr Wallet Connect.

## Phase 0 target

- PWA shell
- NIP-07 login showing npub
- IndexedDB namespace per pubkey
- Offline reload
- Core typed contracts and tests
