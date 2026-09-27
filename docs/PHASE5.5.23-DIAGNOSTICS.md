# Phase 5.5.23 Diagnostics

Gateway NDJSON diagnostics now include a monotonically increasing sequence, gateway instance ID, request correlation IDs on Browser Bridge commands, session/client fingerprints, command queue depth, phase markers, snapshot counters, and submit timeout evidence.

Sensitive values are still redacted and prompts are represented by lengths/fingerprints rather than raw content.
