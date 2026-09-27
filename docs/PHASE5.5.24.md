# Phase 5.5.24

- Provider cards expose ON/OFF/ERROR state with green/blue/red styling.
- Provider status refreshes every 2 seconds while Providers is open.
- WebProvider distinguishes stopped, ready/busy, and error states; request failures mark it ERROR until restarted.
- Runtime providers retain an in-memory ON/OFF/ERROR state and request errors are surfaced on the provider card.
- Gateway execution logs each provider attempt, provider event error, exception, and exhaustion.
- Generic CSS send locators such as `button` are rejected by Browser Bridge `clickSend`; semantic send discovery is used instead.
