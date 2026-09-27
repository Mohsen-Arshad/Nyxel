# Security model

- Provider credentials are never part of exported definitions.
- Community provider definitions are pure JSON and schema validated. No arbitrary JavaScript, shell commands, cookies, browser paths or network destinations are accepted.
- Web sessions live in an isolated browser profile outside the VS Code extension host.
- Repository content is untrusted input. Context selection and prompt injection defenses must treat it as data, never as instructions.
- Secret scanning happens before a request leaves the local machine.
- Production IPC must use an authenticated OS IPC primitive (Windows Named Pipe / Unix Domain Socket), not an unauthenticated public listener.
- Logs must contain routing metadata and diagnostics, not raw prompts, source files, credentials or session data.
