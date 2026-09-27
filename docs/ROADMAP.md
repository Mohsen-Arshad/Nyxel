# NyxelRelay Roadmap

## Phase 1 - architecture foundation

- Provider abstraction
- Declarative provider schema
- Routing pipeline
- Context and secret-scanning boundaries
- Browser picker prototype
- Import/export model

## Phase 2 - first usable VS Code MVP

- VS Code Activity Bar
- Sidebar Chat UI
- Gateway auto-start
- Local session authentication
- Streaming demo responses
- Active editor context
- Provider import/export commands
- Persistent provider definitions
- F5 build/debug workflow

## Phase 3 - browser provider runtime

- Separate Browser Worker process
- Persistent isolated profile per provider
- Visual element picker
- Locator candidate generation
- iframe/shadow-root aware resolution
- Provider test wizard
- Repair Provider flow
- Streaming completion state machine

## Phase 4 - real providers - COMPLETE

- OpenAI-compatible API adapter
- Anthropic API adapter
- Gemini API adapter
- DeepSeek through OpenAI-compatible API
- Ollama and LM Studio local adapters
- Web adapter using declarative definitions and persistent browser profiles
- health checks
- cancellation
- ranked fallback
- capability manifests
- VS Code provider status and web-provider lifecycle commands

## Phase 5 - developer workflow

Next active phase

- context ranking with ripgrep/tree-sitter/Git
- secret redaction and policy controls
- Explain/Fix/Refactor/Test code actions
- patch generation
- diff preview
- apply/reject workflow

## Phase 6 - Laya integration

- Python sidecar adapter for the existing Laya implementation
- golden routing dataset
- routing evaluation
- provider reliability history
- user overrides and feedback signals

## Production hardening

- authenticated OS-native IPC
- OS-native secret storage
- contract tests
- security tests
- chaos tests
- E2E browser tests
- provider compatibility/versioning
- signed community provider definitions/registry
