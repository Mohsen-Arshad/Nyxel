# Phase 4.5 - Provider Control Center

Phase 4.5 adds a usable Provider Control Center to the VS Code extension.

## What changed

- Provider tab inside the NyxelRelay sidebar.
- API/local provider configuration from the UI.
- API keys are stored in VS Code SecretStorage; non-secret provider settings use extension global state.
- Dynamic runtime registration without restarting the Gateway.
- Provider health check during Save & Test.
- Web Provider creation from the UI.
- Visible persistent Playwright browser profiles.
- Start/stop Web Provider controls.
- Visual DOM picker for Input, Send, and Response elements.
- Picked elements are converted to declarative locator strategies and saved into the provider definition.
- Provider import/export/remove from the Provider panel.

## Manual test plan

### A. Build and tests

```cmd
npm install
npx playwright install chromium
npm run build
npm test
```

### B. API provider

1. Open NyxelRelay in VS Code.
2. Open the **Providers** tab.
3. Select DeepSeek/OpenAI/Anthropic/Gemini.
4. Enter the model and API key.
5. Click **Save & Test**.
6. Confirm the provider appears in the list.
7. Return to Chat and send a request.
8. Confirm the routing metadata names the configured provider when it is the selected candidate.

### C. Local provider

For Ollama:

1. Start Ollama.
2. Open Providers.
3. Select `Ollama` and `Local`.
4. Enter a model already available locally.
5. Click Save & Test.

For LM Studio, use `lmstudio`, `Local`, and the local OpenAI-compatible base URL.

### D. Web provider

1. Open Providers.
2. Click **+ Web Provider**.
3. Enter provider ID, name, website URL, and temporary CSS locators.
4. Click **Save Web Provider**.
5. Click **Start** on the new provider.
6. A visible Chromium window should open with a persistent profile.
7. Log in manually.
8. Back in VS Code, click **Pick Input**.
9. Click the website's message input.
10. Repeat for **Pick Send** and **Pick Response**.
11. The captured locator is persisted into the provider definition.
12. Export the definition if desired.
13. Send a chat request and verify the Web Provider can execute it.

## Important test observations to report

- Exact build/test output.
- Whether Provider tab opens and refreshes.
- Whether Save & Test reports the correct health/error.
- Whether secrets survive VS Code restart.
- Whether Web Provider browser profile persists login state.
- Which provider website was tested.
- Whether each picker target resolves reliably.
- Exact error text if routing or execution fails.
- Whether fallback occurs after a provider failure.
