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
npm test
npm run build
```

## Phase 0 target

- PWA shell
- NIP-07 login showing npub
- IndexedDB namespace per pubkey
- Offline reload
- Core typed contracts and tests
