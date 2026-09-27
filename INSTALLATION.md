# NyxelRelay Installation / Development

## Requirements

- Node.js 20+
- npm
- VS Code 1.95+
- Playwright Chromium for web providers

## Install

```bat
npm install
npx playwright install chromium
```

## Build and test

```bat
npm run build
npm test
```

## Run the VS Code extension

Open `C:\nyxel` in VS Code and press `F5`.

The extension starts the local Gateway automatically on `127.0.0.1:4321` unless `nyxelrelay.gateway.autoStart` is disabled.

## Real API providers

API credentials are not stored in provider JSON definitions. Set environment variables before starting VS Code, then reload the Extension Development Host.

```powershell
$env:OPENAI_API_KEY="..."
$env:OPENAI_MODEL="gpt-5-mini"

$env:DEEPSEEK_API_KEY="..."
$env:DEEPSEEK_MODEL="deepseek-flash"

$env:ANTHROPIC_API_KEY="..."
$env:ANTHROPIC_MODEL="claude-sonnet-4-6"

$env:GOOGLE_API_KEY="..."
$env:GOOGLE_MODEL="gemini-3.8-flash"
```

Local:

```powershell
$env:OLLAMA_MODEL="your-local-model"
$env:OLLAMA_BASE_URL="http://127.0.0.1:11434"

$env:LMSTUDIO_MODEL="your-loaded-model"
$env:LMSTUDIO_BASE_URL="http://127.0.0.1:1234/v1"
```

Set `NYXELRELAY_ENABLE_DEMO=false` to remove the demo providers.

Use **NyxelRelay: Provider Status** to inspect configured runtime providers.

## Web providers

Import a declarative provider JSON with **NyxelRelay: Import Provider Definition**. Then run **NyxelRelay: Start Web Provider**. NyxelRelay opens a visible persistent browser profile. Authenticate directly in that browser. Credentials and cookies are never exported into the provider definition.

## Provider fallback

The Gateway removes unhealthy or context-incompatible candidates before routing. If the selected provider fails before producing output, the next ranked healthy candidate is attempted. A provider that fails after emitting partial output is not silently replaced.

## Gateway troubleshooting

Check:

```text
NyxelRelay: Restart Gateway
NyxelRelay: Provider Status
```

Port conflicts can be inspected with:

```powershell
netstat -ano | findstr :4321
```

The Gateway is bound to `127.0.0.1`, not a public network interface.
