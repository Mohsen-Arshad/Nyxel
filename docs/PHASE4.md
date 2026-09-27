# Phase 4 - Real Provider Runtime

Phase 4 turns the Phase 3 routing shell into a real provider runtime while preserving the local-first boundary.

## Implemented

- OpenAI-compatible API provider (OpenAI, DeepSeek and LM Studio through runtime configuration)
- Anthropic Messages streaming adapter
- Google Gemini streaming adapter
- Ollama local streaming adapter
- declarative web provider runtime using the existing ProviderDefinition schema
- persistent browser profiles for web providers
- provider health checks and capability manifests
- automatic fallback across healthy ranked providers
- request cancellation through `/cancel`
- provider status and web-provider lifecycle commands in VS Code
- SSE and provider-candidate tests
- demo providers remain available unless `NYXELRELAY_ENABLE_DEMO=false`

## Runtime configuration

Secrets are deliberately not stored in provider definitions or VS Code settings. Configure API credentials in the environment of the VS Code process/Gateway:

- `OPENAI_API_KEY`, optional `OPENAI_MODEL`, optional `OPENAI_BASE_URL`
- `DEEPSEEK_API_KEY`, optional `DEEPSEEK_MODEL`, optional `DEEPSEEK_BASE_URL`
- `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL`, optional `ANTHROPIC_BASE_URL`
- `GOOGLE_API_KEY`, optional `GOOGLE_MODEL`, optional `GOOGLE_BASE_URL`
- `OLLAMA_MODEL`, optional `OLLAMA_BASE_URL`
- `LMSTUDIO_MODEL`, optional `LMSTUDIO_BASE_URL`, optional `LMSTUDIO_API_KEY`
- `NYXELRELAY_ENABLE_DEMO=false` to remove demo providers

## Web providers

Import a declarative JSON definition, then run **NyxelRelay: Start Web Provider**. NyxelRelay launches an isolated persistent browser profile in visible mode so the user can authenticate directly with the provider. Credentials/cookies are not exported.

## Fallback

Routing first filters unhealthy providers and context-incompatible providers. During execution, a provider that fails before producing output is skipped and the next ranked candidate is attempted. A provider that fails after partial output is not silently replaced because that would produce a corrupted answer.

## Explicit non-goals

- API keys in JSON definitions
- arbitrary JavaScript provider plugins
- cookie/session export
- headless login automation
- automatic CAPTCHA/MFA bypass
