# Phase 5.1 - Intelligence Policy + Web Reliability

Phase 5.1 turns the Phase 5 context system into an adaptive pipeline and hardens the Web Provider lifecycle.

## Intelligence Policy

NyxelRelay now has a fast `Intelligence Policy` decision layer. It can use an optional local Laya HTTP service through `NYXELRELAY_LAYA_URL` and falls back automatically to deterministic rules when Laya is unavailable.

The policy decides:

- whether a request needs an NCP at all;
- context depth: none, selection, file, or related;
- memory depth: none, recent, or relevant;
- whether local semantic compression is worth attempting.

Laya is a policy accelerator, not a required dependency and not the final provider router. A request such as `hello` can bypass context, memory, NCP, and Ollama completely. A focused debugging request can keep the active selection as the primary context.

The Laya integration uses the documented local `POST /v1/systemone` interface. No cloud Laya service is required. See the upstream project for the current server and typed-decision contract: https://github.com/NandhaKishorM/laya

## Web Provider reliability

Web Provider startup now has explicit lifecycle states and validates/normalizes its configured URL before navigation. Startup navigation retries transient failures up to three times with backoff. A browser context existing is no longer treated as equivalent to a ready provider.

Response detection now compares message text/signatures instead of relying only on child count. This handles DOM reuse where a web application updates an existing message node instead of appending a new child.

UI prefixes such as `ChatGPT said:` are normalized out of the returned AI response.

## Local-first rule

Laya and Ollama are optional. The gateway remains useful without either service. If a local intelligence component fails or times out, NyxelRelay continues with deterministic policy and provider routing.
