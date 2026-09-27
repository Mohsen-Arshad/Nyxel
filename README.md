# Nyxel

Nyxel is a local-first AI gateway for developers who want to work
with multiple AI providers from a single workflow.

The project is built around a simple idea: the developer should not have
to decide which model to use for every request or manually assemble the
relevant project context. Nyxel prepares the request, evaluates
available providers, selects a suitable provider, executes the request,
and can fall back when necessary.

The primary interface is a Visual Studio Code extension. The gateway,
routing logic, context preparation, project memory, and provider
management run locally.

## Features

- Multi-provider AI routing
- Visual Studio Code integration
- Local gateway
- OpenAI-compatible, Anthropic, and Gemini provider adapters
- Local model support through Ollama and OpenAI-compatible servers
- Browser-based providers through a Browser Bridge
- Provider fallback
- Task classification and routing policies
- Project-aware context collection
- Local project memory
- Optional local semantic context compression
- Secret and credential filtering
- Prompt-injection-aware context handling
- Provider health and runtime status
- Request cancellation
- Structured diagnostics
- Declarative provider definitions
- Provider import/export
- Browser locator scanning and selection

## Architecture

``` text
VS Code Extension
       |
       v
 Local Gateway
       |
       +--------------------+
       |                    |
       v                    v
 Intelligence          Routing Engine
       |                    |
       |                    v
       |              Provider Selection
       |                    |
       +----------+---------+
                  |
          Provider Adapters
          /       |        \
         /        |         \
       API      Local        Web
       |         |            |
    OpenAI    Ollama      Browser Bridge
    Gemini    LM Studio        |
    Anthropic                  v
                           Chrome / Edge
```

### VS Code Extension

The extension provides the user interface and connects the editor to the
local gateway.

It handles chat, provider management, browser provider configuration,
provider status, request cancellation, and workspace context.

### Local Gateway

The gateway is the runtime core of Nyxel.

It is responsible for:

- Request validation
- Context preparation
- Task classification
- Routing
- Provider lifecycle management
- Provider execution
- Fallback
- Diagnostics
- Project memory
- Browser Bridge communication

The gateway is implemented in TypeScript and uses Fastify for its local
HTTP API.

### Intelligence and Routing

The request pipeline is:

``` text
Request
  -> Task Classification
  -> Context Analysis
  -> Capability Requirements
  -> Policy Filtering
  -> Candidate Generation
  -> Provider Scoring
  -> Provider Selection
  -> Execution
  -> Fallback
```

Nyxel uses Laya as a lightweight classification and policy signal.
It is not treated as the sole source of truth for provider execution.

Hard constraints are evaluated before soft ranking. Examples include
unavailable authentication, missing capabilities, context limits,
privacy restrictions, and unavailable transports.

Provider scoring can consider task fit, capability fit, context fit,
reliability, latency, historical success, and user preference.

## Context Engine

Nyxel does not send an entire repository to an AI model by default.

Context is selected according to relevance, including:

- Current selection
- Active file
- Referenced code
- Direct dependencies
- Recent Git changes
- Related tests
- Configuration
- Project memory

Sensitive files and common credential locations are excluded before
context is prepared.

The resulting information is represented as a Nyxel Context Packet
(NCP):

``` text
NYXEL CONTEXT PACKET / 1
TASK:
REQUEST:
WORKSPACE:
TARGET:
LANGUAGE:
PROJECT MEMORY:
CONSTRAINTS:
RELEVANT CONTEXT:
INSTRUCTIONS:
```

An optional local semantic compressor can further reduce large context
sets when a suitable local model is available. It is not a hard
dependency.

## Provider System

Providers implement a common interface so the routing layer does not
need to know how an individual service works.

A provider can represent:

- A hosted API
- A local model
- A browser-based AI service

Provider capabilities can describe streaming, vision, files, tools, and
context limits.

This separation makes it possible to add providers without changing the
routing engine.

## Browser Providers

Browser providers are an optional transport for AI services that expose
a usable web interface.

Nyxel supports:

- Existing Browser
- Managed Browser

Existing Browser mode uses the Nyxel Browser Bridge to communicate
with an already running Chromium browser session.

``` text
Nyxel Gateway
        |
        | Local Bridge Protocol
        v
Browser Bridge Extension
        |
        v
Chrome / Edge
        |
        v
AI Web Application
```

Browser automation is deliberately isolated from the core routing
architecture. It is a transport option, not the foundation of the
system.

Web interfaces can change their DOM structure without notice. Browser
providers therefore support locator scanning, picking, validation, and
runtime health reporting.

## Provider Fallback

Provider failure does not necessarily terminate a request.

When execution fails, the gateway can try another eligible candidate:

``` text
Request
   |
   v
Provider A
   |
   +---- success ----> Response
   |
   +---- failure ----> Provider B
                           |
                           +---- success ----> Response
                           |
                           +---- failure ----> Error
```

Fallback remains subject to provider capabilities and routing policies.

## Project Memory

Nyxel keeps project memory locally for information that is useful
across requests.

It can contain:

- Project summary
- Architecture
- Technologies
- Conventions
- Constraints
- Important files
- Project facts
- Recent tasks

Memory is local. Only context selected for a specific request is
prepared for transmission to a provider.

## Security

Security is part of the request pipeline.

Nyxel filters sensitive files and attempts to detect common
credentials before project context is sent to a provider.

Examples include:

``` text
.env
.env.*
*.pem
*.key
*.p12
*.pfx
id_rsa
credentials.*
secrets.*
```

Repository content is treated as untrusted input. System instructions,
user instructions, repository content, model output, and tool output are
kept conceptually separate so that project files cannot automatically
become trusted instructions.

Users should still review provider configuration and understand what
information is being sent to each external service.

## Diagnostics

The gateway produces structured NDJSON diagnostics during runtime.

Diagnostics can include:

- Request IDs
- Provider selection
- Provider attempts
- Routing information
- Browser Bridge commands
- Request stages
- Timing
- Errors and timeouts

Request content and credentials are not intended to be written directly
to the diagnostic log.

Typical project data is stored under:

``` text
.Nyxel/
├── logs/
│   └── gateway.ndjson
├── memory/
└── providers/
```

## Getting Started

### Requirements

- Node.js
- npm
- Visual Studio Code
- Chrome or Edge for browser providers
- A configured AI provider or a local model such as Ollama

### Installation

``` bash
git clone <repository-url>
cd Nyxel
npm install
```

Build all workspaces:

``` bash
npm run build
```

Run the test suite:

``` bash
npm test
```

The repository uses npm workspaces.

### Development

Start the local gateway:

``` bash
npm run dev
```

The VS Code extension can then be launched from the extension
development environment.

For browser providers, load the Chromium Browser Bridge from:

``` text
apps/browser-bridge/chromium
```

After changing the extension, reload it from the browser’s extension
management page.

## Configuring Providers

Provider configuration is managed from the Providers section of the
Nyxel VS Code extension.

API credentials can be stored using VS Code SecretStorage rather than
being placed directly in project files.

Local providers can point to services such as:

``` text
Ollama
LM Studio
OpenAI-compatible local servers
```

A browser provider requires:

1.  The target AI web application to be open in Chrome or Edge.
2.  The Nyxel Browser Bridge to be installed and active.
3.  A provider definition containing the target URL.
4.  Valid input, send, and response locators when automatic detection is
    not sufficient.

The browser scanner can inspect the active page and suggest candidate
locators.

## Repository Structure

``` text
Nyxel/
├── apps/
│   ├── browser-bridge/
│   │   └── chromium/
│   ├── gateway/
│   └── vscode-extension/
├── packages/
│   └── provider-schema/
├── package.json
└── README.md
```

### Gateway

The gateway contains routing, provider execution, context intelligence,
project memory, browser transport, diagnostics, and security-related
logic.

### Provider Schema

`packages/provider-schema` contains shared declarative provider
definitions and capability types.

Keeping the schema separate prevents the VS Code extension and gateway
from developing incompatible provider definitions.

## Testing

The project uses Vitest.

The test suite covers areas including:

- Provider schema validation
- Routing
- Golden routing cases
- Provider candidate generation
- Context intelligence
- Project memory
- Laya policies
- Secret detection
- Browser Bridge behavior
- Web provider behavior
- Streaming

Run all tests with:

``` bash
npm test
```

## Current Status

Nyxel is under active development.

The core routing, provider abstraction, local gateway, context
intelligence, project memory, and VS Code integration are functional
parts of the architecture.

Browser-based providers are more experimental because they depend on
third-party web applications and their changing interfaces. A provider
may require locator updates when the target website changes.

The project should currently be considered a development-stage tool
rather than a production-stable AI platform.

## Design Principles

### Local First

The gateway, routing logic, project memory, and context preparation run
locally.

### Provider Agnostic

The routing layer should not depend on one AI vendor.

### Context Before Scale

More context is not automatically better context. Nyxel attempts to
send the smallest relevant context needed for a task.

### Deterministic Where Possible

Routing, filtering, security checks, and context selection should remain
predictable wherever an LLM is not necessary.

### AI as a Component

A local or remote model can improve parts of the system, but the gateway
should remain functional without making an LLM a hard dependency.

### Browser Automation as a Transport

Web automation is useful for services without an accessible API, but it
remains isolated from the core architecture.

## Roadmap

- More provider adapters
- More robust browser-provider adapters
- Firefox support
- Improved browser session management
- Stronger browser transport authentication
- Native local IPC
- AST-based context extraction
- Semantic repository retrieval
- Improved context budgeting
- More advanced routing history
- Provider performance analytics
- Improved cancellation and streaming across browser providers
- Packaging and one-click installation

## License

This project is licensed under the Apache License 2.0.

See `LICENSE` for the full license text.

## Contributing

Contributions are welcome.

Before opening a pull request:

1.  Keep provider-specific behavior isolated from the routing layer.
2.  Add tests for new routing or provider behavior.
3.  Avoid logging credentials or complete user prompts.
4.  Keep browser-specific assumptions inside the browser transport.
5.  Run:

``` bash
npm run build
npm test
```

Include a short explanation of the problem, the approach taken, and any
provider-specific limitations in the pull request.
