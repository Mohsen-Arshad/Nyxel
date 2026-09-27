# Phase 5.5 - Browser Bridge

NyxelRelay now supports two Web Provider transports:

- **Existing Browser**: use a normal Chrome or Chromium-based Edge session through the NyxelRelay Browser Bridge extension.
- **Managed Browser**: keep the existing Playwright-managed browser as a fallback/test transport.

The Chromium bridge is one Manifest V3 package and can be loaded in both Chrome and Edge. Firefox is intentionally not forced into the Chromium transport; it will get a separate WebExtension adapter later behind the same BrowserTransport contract.

## Why this architecture

The provider should not own the user's everyday browser profile. Existing Browser mode reuses the browser session that the user already opened and authenticated. NyxelRelay only sends local commands to the selected tab and receives DOM results. It does not collect or transmit cookies/passwords to a remote service.

The Gateway listens only on `127.0.0.1` and the bridge endpoints are local-only. The bridge protocol is intentionally browser-neutral so the provider layer does not need to change when Firefox support is added.

## Chrome / Edge setup

1. Start the Gateway through VS Code.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable Developer mode.
4. Load unpacked from `apps/browser-bridge/chromium`.
5. Open the Web AI site in a normal tab and stay logged in.
6. Configure the Web Provider with `Existing Browser` and the matching browser family.
7. Click Start.

A page that was already open before installing the bridge may need one refresh so its content script is present.

## Security boundary

The bridge is not a CAPTCHA bypass. If the provider presents a human verification challenge, the user handles it in the normal browser session. The architecture simply avoids launching a second automation browser profile.

## Diagnostics / Browser Debug Logging (Phase 5.5.9)

The Gateway writes structured NDJSON diagnostics to:

`.nyxelrelay/logs/gateway.ndjson`

It records request correlation IDs, routing, Browser Bridge commands, fill/send results, response detection progress, timeouts, and provider errors. User message contents and secrets are not logged; message/request payloads are represented by lengths and short SHA-256 fingerprints.

While the Gateway is running, the latest log can also be read from:

`http://127.0.0.1:4321/diagnostics/logs?lines=1000`

Status and active Bridge sessions:

`http://127.0.0.1:4321/diagnostics/status`

When reporting a browser-provider bug, reproduce it with a fresh Gateway session, then provide the `gateway.ndjson` file. The correlation `requestId` in the log is the key for tracing one request through routing, fill, send, snapshot, response detection, and fallback.
