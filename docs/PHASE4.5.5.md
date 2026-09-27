# Phase 4.5.5 — Web Response Lifecycle

Phase 4.5.5 hardens Web Provider execution for real conversational web UIs.

## Changes

- Keeps a persistent provider page alive instead of navigating to the website for every request.
- Serializes Web Provider requests so two prompts cannot race the same browser conversation.
- Snapshots the conversation before sending a prompt.
- Waits for a new assistant message instead of treating the entire conversation container as the response.
- Avoids mistaking the newly-added user message for the assistant response.
- Reads only the newest direct child of the configured response container.
- Uses configurable completion signals plus a conservative response-stability window.
- Supports stop-button and send-button state as completion hints.
- Adds a 30-second initial-response timeout and 180-second generation timeout.
- Starts and stops cleanly with the persistent browser context.
- Keeps cancellation best-effort by clicking a visible Stop control before falling back to Escape.

## Recommended ChatGPT definition

The following selectors are valid as a starting point when they match the live DOM:

- Input: `textarea[placeholder="Ask ChatGPT"]`
- Send: `button[aria-label="Send message"]`
- Response: `ol[aria-label="Conversation"]`

The response selector is intentionally treated as a conversation container. NyxelRelay now extracts the newest child response from that container rather than returning the entire conversation history.
