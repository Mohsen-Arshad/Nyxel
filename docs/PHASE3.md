# NyxelRelay Phase 3

Phase 3 turns the developer MVP into a usable VS Code slice.

## Implemented

- Real sidebar chat Webview with message bubbles and streaming output.
- Gateway lifecycle manager with automatic startup, health checks, restart command, and graceful disposal.
- Gateway discovery from the installed extension layout, with workspace fallback for development.
- Per-extension-session Gateway authentication token.
- Bounded active-editor context with basic secret/path protection.
- Routing metadata shown in the chat UI.
- Standard/Privacy request mode selector.
- Better Gateway error handling instead of raw `fetch failed` errors.
- `/chat` now preserves the classifier task (`chat`, `debug`, etc.) instead of defaulting the demo provider to `auto`.
- Existing declarative provider import/export remains available.

## Development

```bash
npm install
npm run build
npm test
```

Open the repository in VS Code and press `F5`.

The extension should start its sibling Gateway automatically. If the Gateway cannot be found, the status bar reports the offline state rather than silently failing.

## Manual Gateway mode

```bash
npm run dev
```

If the Gateway is already listening on port 4321, do not start a second instance. An `EADDRINUSE` message simply means the port is occupied by another Gateway process.

## Current architecture

```text
VS Code
  │
  ├── Activity Bar
  │      └── Chat Webview
  │            └── Extension API client
  │
  └── GatewayManager
          ├── health
          ├── start
          ├── restart
          └── authenticated HTTP
                    │
                    ▼
              NyxelRelay Gateway
                    ├── classifier
                    ├── router
                    ├── provider registry
                    └── NDJSON streaming
```

## Not yet implemented

- Real API adapters with OS-native secret storage.
- Isolated Playwright browser worker.
- Visual DOM provider picker/repair wizard.
- Patch/diff application workflow.
- Full repository context indexer and secret scanner in the Gateway.
- Named Pipe/Unix Domain Socket IPC.
- E2E/chaos/security suites.
