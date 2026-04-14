# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ChromeCode is a Chrome Side Panel extension (Manifest V3) that acts as a browser-based AI coding agent. It can read active tab content, perform live edits via the Chrome Debugger API, and stream responses from an OpenAI-compatible LLM API. The extension connects to a local Node.js bridge server for remote/CLI control.

## Build & Development

```bash
npm run build          # Production build (minified, outputs to dist/)
npm run watch          # Dev build with sourcemaps, rebuilds on file change
node test_brain.mjs    # Test LLM API connectivity (requires network)
node test_live_edit.mjs # Test live-edit code generation (requires network)
```

**Loading the extension:** Open `chrome://extensions`, enable Developer Mode, click "Load unpacked", and select the `dist/` directory.

**No tsconfig.json at root** — TypeScript is compiled directly by esbuild via the `loader: { '.ts': 'ts' }` config in `build.js`.

## Architecture

```
src/
├── background/
│   ├── background.ts   # Service worker: agent loop, prompt handling, bridge + panel connections
│   ├── providers.ts    # Streaming fetch to OpenAI-compatible chat/completions endpoint
│   ├── tab-tools.ts    # chrome.scripting (read tab) and chrome.debugger (inject JS)
│   └── storage.ts      # pi-mono AuthStorageBackend/SettingsStorage adapters (partially used)
├── panel/
│   ├── panel.html/css  # Side panel UI: chat messages, prompt input
│   └── panel.ts        # Connects to background via chrome.runtime.Port, sends/receives messages
├── options/
│   ├── options.html    # Settings page: API key, base URL, model ID
│   └── options.ts      # Loads/saves settings from chrome.storage.local
├── bridge/
│   └── server.ts       # Standalone Node.js process: WebSocket (port 3000) + HTTP API (port 3001) + CLI REPL
└── polyfills/
    └── empty.js        # Stubs for Node.js built-ins (fs, path, etc.) needed by pi-mono deps in browser
```

### Data Flow

1. **Side Panel → Background:** `chrome.runtime.Port` with named connection `"chromecode-panel"`. Messages: `{ type: "PROMPT", text }` and `{ type: "CLEAR_HISTORY" }`.
2. **Background → Side Panel:** Port messages with `{ type: "AGENT_EVENT", event }` (events: `text_delta`, `message_end`) and `{ type: "ERROR", message }`.
3. **Bridge Server → Background:** WebSocket on `ws://localhost:3000`. Sends `{ type: "REMOTE_PROMPT", text }`. Receives agent events and errors.
4. **External agents → Bridge:** HTTP POST to `http://localhost:3001/prompt` with `{ prompt: "..." }`.

### Agent Loop (`background.ts`)

- Builds a system prompt with the active tab's content (URL, title, innerText truncated to 5000 chars)
- Streams the LLM response via SSE (`providers.ts`)
- Parses responses for fenced code blocks: `` ```javascript:cc_live_edit ``` ``, `` ```cc_macro:*``` ``, `` ```cc_record:*``` ``, `` ```cc_read``` ``, `` ```cc_ls``` ``
- Executes matched blocks via `chrome.debugger.attach` → `Runtime.evaluate` → `detach` (live edits) or via bridge WebSocket (folder reads)
- On execution failure, auto-retries with the error message appended to conversation history
- Conversation history is in-memory only (resets when service worker restarts)

### Live Edit Tool

`tab-tools.ts:editActiveTab()` uses the Chrome Debugger protocol (`chrome.debugger`) to execute arbitrary JavaScript in the active tab. This bypasses CSP restrictions. The debugger is attached/detached per-call with cleanup in a catch block.

### Folder Tools (`cc_read` / `cc_ls`)

When a folder is connected (via the "Connect Folder" button → native OS picker → bridge server), the LLM can read files from it. Since Chrome extensions have no filesystem access, this goes through the bridge server over WebSocket.

- **`cc_read`** — Read a file's contents. Path is relative to the connected folder.
  - LLM outputs: `` ```cc_read\nsrc/index.ts\n``` ``
  - Background sends `{ type: "FOLDER_READ_REQUEST", folderPath, filePath }` to bridge
  - Bridge reads the file via `fs.readFileSync`, returns content string
  - Security: path traversal check (`ensureInsideFolder`), 1MB max size, binary file rejection by extension and null-byte detection
- **`cc_ls`** — List directory contents recursively with file sizes. Path is relative to connected folder, empty path lists root.
  - LLM outputs: `` ```cc_ls\nsrc/\n``` ``
  - Background sends `{ type: "FOLDER_LIST_REQUEST", folderPath, dirPath }` to bridge
  - Bridge walks the directory via `fs.readdirSync`, skips `node_modules`/`.git`
  - Returns array of `{ name, path, size, type }` entries

Both tools use a pending-promise pattern (`sendFolderRequestAndAwait`) to correlate WebSocket request/response with a `requestId`. The bridge also exposes HTTP routes `POST /folder/read` and `POST /folder/list` for external use.

### Provider Configuration

`providers.ts` reads `apiKey`, `baseUrl`, `modelId` from `chrome.storage.local`. Falls back to defaults defined in that file. The options page UI writes these settings.

## Key Conventions

- `cc` prefix for extension-specific identifiers (e.g., `cc_live_edit`, `cc_read`, `cc_ls`, `chromecode-panel`)
- esbuild outputs ESM format targeting Chrome 100+
- Entry points in `build.js` map `src/{component}/{component}.ts` → `dist/{component}/{component}.js`
- Static assets (HTML, CSS, manifest, icons) are copied to `dist/` by `copyFiles()` in `build.js`
- The `bridge/server.ts` is a standalone Node script (not bundled into the extension) — it depends on the `ws` package
- `storage.ts` contains pi-mono adapter classes but the current agent loop in `background.ts` does not use them directly
