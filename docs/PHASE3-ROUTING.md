# Phase 3 Routing & Classification Hardening

This increment keeps NyxelRelay in the current Phase 3 MVP and hardens the request decision layer before any real provider is introduced.

## Classification pipeline

```text
Prompt
  +
Editor Context
  ↓
Prompt Signals
  +
Context Signals
  ↓
Task Scoring
  ↓
Confidence + Evidence
  ↓
Provider Capability / Reliability Scoring
  ↓
Routing Decision
```

### Supported task kinds

- `chat`
- `explain`
- `debug`
- `refactor`
- `test`
- `generate`
- `docs`
- `performance`
- `architecture`
- `security`

The classifier is deterministic in this phase. Context is supporting evidence rather than an unconditional task selector, so a greeting with an open code file remains `chat`.

## Context-aware examples

| Request | Context | Expected task | Source |
|---|---|---|---|
| `Hello` | TypeScript file open | `chat` | prompt |
| `when the array is empty?` | function using `reduce()` | `debug` | hybrid |
| `Why does this code fail?` | failing TypeScript code | `debug` | hybrid |
| `Explain the selected code.` | active selection | `explain` | hybrid |
| `Refactor this function...` | code file | `refactor` | prompt |
| `Write unit tests...` | code file | `test` | prompt |
| `Update the README...` | any | `docs` | prompt |
| `How should I structure this application?` | any | `architecture` | prompt |

## Routing

Provider ranking now considers:

1. Explicit model override.
2. Provider health.
3. Context capacity.
4. Task-specific provider strength.
5. Capability fit.
6. Reliability / latency.
7. Privacy preference.
8. Classification confidence.

The router exposes its reasons and candidate scores so routing is inspectable instead of being a black box.

## Security boundary

The Gateway sanitizes context independently of the VS Code extension. Sensitive files and detected credential-bearing context are excluded before classification or provider execution.

The mock provider reports context metadata such as path, character count, and selection reason, but never echoes context contents. This makes the MVP observable without turning diagnostics into a source-code leak.


## Classification precedence fix

Explicit refactoring language is no longer polluted by incidental debug signals such as an `empty array` phrase in the request. Generic `empty` wording is not itself a debug classification signal; code-context failure signals still classify genuine debugging questions as `debug`.

### Short developer requests

The classifier also handles terse requests that are common in an editor:

| Request | Context | Expected task |
|---|---|---|
| `Can you fix this?` | code file | `debug` |
| `What is wrong here?` | code file | `debug` |
| `How should I improve this?` | code file | `refactor` |
| `Can you clean this up?` | code file | `refactor` |

These are explicit action/diagnosis signals. Code context contributes supporting evidence and therefore produces a `hybrid` source rather than letting incidental code patterns decide the task.


## Classification conflict resolution

The classifier now distinguishes explicit intent from incidental code evidence. Context cannot turn a request into `debug` merely because the active file contains `.reduce()`, `undefined`, `catch`, or another debugging-shaped token. Context is applied only when the prompt already supports a compatible task or when a deliberately supported vague developer request is gated by an active code context.

Deterministic precedence handles common competing intents:

1. Security-specific intent
2. Test-generation/testing intent
3. Performance intent
4. Architecture intent
5. Documentation intent
6. Explanation intent
7. Code-generation intent
8. Refactoring intent when it is not a fix/error request
9. Otherwise the highest scored task

Examples now covered by regression tests include:

| Prompt | Code context | Expected |
|---|---|---|
| `This is ugly.` | TypeScript | `refactor` |
| `Can this be made cleaner?` | TypeScript | `refactor` |
| `I don't like how this is structured.` | TypeScript | `refactor` |
| `Make this easier to maintain.` | TypeScript | `refactor` |
| `Rewrite this function using a cleaner approach.` | TypeScript | `refactor` |
| `This works, but it is extremely slow. Can you fix it?` | TypeScript | `performance` |
| `Can you implement tests for this function?` | TypeScript | `test` |
| `Fix this function and make it cleaner.` | TypeScript | `debug` |

The distinction between the last two compound cases is intentional: the former names a performance problem, while the latter makes `fix` the primary requested action and `cleaner` a secondary quality constraint.

## Routing score

Provider ranking now incorporates task fit, capability fit, reliability, complexity fit, privacy preference, and classification confidence. The selected candidate exposes these components in its routing reasons, making provider selection inspectable instead of a single opaque number.

The classifier and router remain deterministic. No external model is used to decide the task during this phase.

## 0.3.6 classification hardening

This release closes the remaining routing regressions found during VS Code testing:

- vague quality language is treated as `chat` without code context;
- the same quality language becomes `refactor` only when actionable code context is present;
- `How should I improve this?` uses both prompt and code context and therefore reports `hybrid`;
- explicit `Rewrite ...` requests remain prompt-driven rather than being mislabeled as context-driven;
- provider-selection regression fixtures are type-safe under `noUncheckedIndexedAccess`;
- the VS Code Gateway child-process field is compatible with `exactOptionalPropertyTypes`.
