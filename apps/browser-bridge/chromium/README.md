# NyxelRelay Browser Bridge (Chromium)

This Manifest V3 extension lets NyxelRelay use an **already-running Chrome or Edge session** instead of launching a separate Playwright browser.

The same package works in Chrome and Chromium-based Edge. Firefox will use a separate adapter/package later because browser APIs and packaging are not identical.

## Install for local development

1. Start the NyxelRelay Gateway.
2. Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select this `chromium` directory.
6. Open the target Web AI site in a normal tab and stay signed in.
7. In NyxelRelay, configure the Web Provider as **Existing Browser** and choose Chrome or Edge.

The extension only talks to the local Gateway at `127.0.0.1:4321`. It does not send credentials or cookies to NyxelRelay's servers because there are none in this architecture.

## Important

This is not a CAPTCHA bypass. The user's real browser session remains in control. If a provider shows a challenge, the user handles it in the browser.
