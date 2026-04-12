# CHROMECODE.md

This file provides guidance to the ChromeCode agent when working with code in this repository.

## Project Goal
A Chrome Side Panel extension that ports the `pi-mono` architecture to the browser, allowing an AI agent to assist with coding directly alongside web-based IDEs and documentation.

## Architecture (cc-prefix)
- **Engine:** `AgentSession` running in the Background Service Worker.
- **UI:** Persistent Side Panel with a streaming chat interface and tool confirmations.
- **Storage:** `IndexedDB` via the `idb` library for session history and file handles.
- **Tools:**
  - `cc_read`: Reads from File System Access API handles.
  - `cc_write`: Writes to File System Access API handles (requires UI confirmation).
  - `cc_exec`: Runs JavaScript in the active tab via `chrome.scripting`.

## Conventions
- Use `cc` prefix for extension-specific modules and properties.
- Follow the `pi-mono` event-based agent loop.
- All destructive tool calls MUST trigger a confirmation in the side panel.
- API keys are stored encrypted in `chrome.storage.local`.
