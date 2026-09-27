# NyxelRelay Phase 5 - Context Intelligence

Phase 5 makes NyxelRelay Web-first without turning the product into a browser-only toy.

## Core additions

- NCP/1 provider-agnostic context packet.
- Deterministic context selection based on task, active selection/file, imports and dependencies.
- Secret-aware context filtering.
- Persistent per-workspace project memory stored locally under `.nyxelrelay/memory`.
- Memory of project summary, technologies, important files, facts and recent tasks.
- Optional local Ollama semantic compression for large context. It is an optimization, never a dependency or source of truth.
- Exact target code is preserved when building context packets.
- Web providers receive the same NCP as API/local providers.
- Web-first routing remains provider-agnostic and keeps fallback behavior.

## Privacy / local-first behavior

No project memory is sent to a remote service by NyxelRelay itself. The memory is assembled locally and is only included in a provider request when the user chooses to send the request to that provider.

Ollama is contacted only when configured and when a context item is large enough to benefit from semantic compression. If Ollama is unavailable, deterministic context selection continues normally.

## Important limitation

Context compression improves information density. It does not remove a provider's actual context-window, rate-limit, account, authentication, or service restrictions.
