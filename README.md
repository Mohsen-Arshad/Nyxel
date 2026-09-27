# NyxelRelay

NyxelRelay is a local-first AI gateway for VS Code. It routes developer requests through a provider abstraction that can support API, web and local transports.

## Phase 3.1 Routing & Classification Hardening

The current MVP now combines prompt signals with editor context, exposes classification confidence/evidence, ranks providers using task fit/capabilities/reliability/privacy, and sanitizes context again at the Gateway boundary. See `docs/PHASE3-ROUTING.md`.

# Phase 4: real provider runtime

This phase adds a real VS Code development experience:

- NyxelRelay Activity Bar with a real chat UI.
- Gateway lifecycle manager with health checks, auto-start, and restart.
- Authenticated local Gateway requests using a per-session token.
- Streaming chat events rendered incrementally in the sidebar.
- Bounded active-editor context with basic secret/path protection.
- Routing metadata shown before the streamed answer.
- Standard and strict privacy request modes.
- Provider definition import/export commands.
- Persistent declarative provider definitions under VS Code global storage.
- `F5` launch configuration and build task.
- Mock local/API providers so the complete flow can be tested without API keys.

## Run in VS Code

1. Install Node.js 20+ and npm 10+.
2. Run `npm install` at the repository root.
3. Run `npm run build`.
4. Open the repository in VS Code.
5. Press `F5` and choose **Run NyxelRelay Extension** if prompted.
6. A new Extension Development Host opens.
7. Click the NyxelRelay icon in the Activity Bar.
8. Enter a prompt and press **Send**.

The extension starts the compiled local Gateway automatically. No API key is required for the demo providers.

## Test commands

```bash
npm run build
npm test
```

## Provider import/export

Use the Command Palette:

- `NyxelRelay: Import Provider Definition`
- `NyxelRelay: Export Provider Definition`

Provider definitions are JSON data only. They must not contain credentials, cookies, session tokens or executable code.

## Current boundary

The current chat flow uses demo providers. Web automation remains a separate transport and is not silently treated as a universal provider API. The next implementation slice is the isolated Browser Worker + visual provider setup/repair flow.

See [INSTALLATION.md](./INSTALLATION.md), [docs/PHASE3.md](./docs/PHASE3.md), and [docs/ROADMAP.md](./docs/ROADMAP.md).


## Installation

See [INSTALLATION.md](./INSTALLATION.md) for the complete npm-based setup and VS Code development workflow.


## Phase 4 provider runtime

NyxelRelay can now execute real providers while keeping credentials outside portable provider definitions. Configure providers through environment variables inherited by the VS Code process. See `docs/PHASE4.md` and `.env.example`.

Supported runtime adapters include OpenAI-compatible endpoints, DeepSeek, Anthropic, Gemini, Ollama, LM Studio, and declarative web providers. The Gateway performs health-aware routing, request cancellation, and ranked fallback.


## Phase 4.5
Provider Control Center is available in the VS Code sidebar. See `docs/PHASE4.5.md` for the manual test plan.

## Phase 5: Context Intelligence

NyxelRelay now builds a local **NCP/1 (Nyxel Context Packet)** before provider execution. The packet combines the user's task, exact target code, relevant dependencies, project memory, constraints and recent work. Web providers, local models and API providers consume the same provider-agnostic context representation.

Project memory is persisted locally under `.nyxelrelay/memory`. An optional local Ollama model can perform semantic compression of unusually large context, with deterministic context selection remaining the fallback. The goal is not to bypass provider limits, but to send the most useful project information with less noise.

## Phase 5.1 - Adaptive local intelligence

- Fast intelligence policy layer with optional local Laya integration.
- NCP is skipped for simple requests that do not need project context.
- Context and memory depth are selected per request.
- Optional semantic compression is requested only when policy says it is useful.
- Web Provider URL normalization, startup retries, readiness state, stronger response detection, and UI-prefix normalization.

Laya is optional and local. Configure `NYXELRELAY_LAYA_URL` only if a local Laya server is running.

## Phase 5.5: Browser Bridge

Web Providers can use an existing Chrome/Edge session through the local Manifest V3 Browser Bridge under `apps/browser-bridge/chromium`. Managed Playwright remains available as a fallback. Firefox is intentionally isolated behind a future browser-specific adapter.
