# ChromeCode

A Chrome Side Panel extension (Manifest V3) that acts as a browser-based AI coding agent. It reads active tab content, performs live edits via the Chrome Debugger API, and streams responses from any OpenAI-compatible LLM API. A built-in Node.js bridge server provides full programmatic control over the browser via HTTP API — execute JS, read content, capture screenshots, manage macros, and record screen activity.

## Features

- **Live Editing** — Execute JavaScript directly in the active tab via Chrome Debugger API, bypassing CSP
- **AI-Powered** — Streams responses from any OpenAI-compatible chat/completions endpoint
- **Side Panel UI** — Chat interface embedded in Chrome's side panel
- **Bridge Server** — Full HTTP API for programmatic browser control from curl, scripts, or Claude Code
- **Macro System** — Record, play, list, and delete browser interaction macros (clicks, typing, scrolling)
- **Screen Recording** — Record the active tab as a downloadable WebM video
- **Direct Mode** — Bypass the LLM and execute browser operations immediately via the bridge API

## Setup

### Prerequisites

- Node.js 18+
- Chrome 100+

### Install

```bash
npm install
```

### Build

```bash
npm run build          # Production build (minified, outputs to dist/)
npm run watch          # Dev build with sourcemaps, rebuilds on file change
```

### Load the Extension

1. Open `chrome://extensions`
2. Enable **Developer Mode**
3. Click **Load unpacked**
4. Select the `dist/` directory

### Configure

Open the extension options page to set:

- **API Key** — Your LLM provider API key
- **Base URL** — OpenAI-compatible endpoint (default: NVIDIA API)
- **Model ID** — Model to use (default: minimaxai/minimax-m2.7)

## Bridge Server

The bridge server enables CLI and remote control of the extension with full HTTP request-response correlation.

### Start

```bash
npm run bridge
```

- **WebSocket** (`ws://localhost:3000`) — Extension connects here
- **HTTP API** (`http://localhost:3001`) — RESTful control plane for scripts and tools
- **Interactive CLI** — Type prompts directly in the terminal

### Two Modes

| Mode | Description | Timeout |
|------|-------------|---------|
| **Agent** | Prompt → LLM processes → full text response | 120s |
| **Direct** | Bypass LLM, execute browser operation immediately | 30s |

### HTTP API Reference

#### Health

```
GET /health
```
Returns `{ "status": "ok", "extensionConnected": true }`

#### Agent Mode

```
POST /prompt
Body: { "prompt": "..." }
```
Sends prompt to the LLM agent and returns the full response. Response:
```json
{ "requestId": "req_...", "response": "full LLM text here" }
```

#### Tab Operations

```
GET /tab/content
```
Returns active tab's URL, title, and text content.

```
GET /tab/screenshot
```
Returns a JPEG data URL of the visible tab.

```
POST /tab/execute
Body: { "code": "document.title" }
```
Executes JavaScript in the active tab (fire-and-forget, like the `cc_live_edit` tool).

```
POST /tab/evaluate
Body: { "expression": "document.title" }
```
Evaluates a JavaScript expression and returns the result value.

#### Macro Operations

```
GET /macro/list
```
Returns all saved macros.

```
POST /macro/play
Body: { "name": "MyMacro" }
```
Plays a recorded macro on the active tab.

```
POST /macro/record/start
```
Starts recording browser interactions (clicks, typing, scrolling).

```
POST /macro/record/stop
Body: { "name": "MyMacro" }
```
Stops recording and saves the macro with the given name.

```
DELETE /macro/:name
```
Deletes a macro by name.

```
POST /macro/demo
Body: { "name": "MyMacro" }
```
Plays a macro while simultaneously recording a video of the tab.

#### Recording Operations

```
GET /recording/status
```
Returns current recording state: `{ "recording", "macroRecording", "macroPlaying" }`.

```
POST /recording/start
```
Starts screen recording of the active tab.

```
POST /recording/stop
```
Stops screen recording. Video downloads as `chromecode-recording.webm`.

### Example: Full curl Workflow

```bash
# Check bridge is up and extension connected
curl http://localhost:3001/health

# Read active tab content
curl http://localhost:3001/tab/content

# Execute JS in the tab
curl -X POST http://localhost:3001/tab/execute \
  -H 'Content-Type: application/json' \
  -d '{"code":"document.querySelector(\"h1\").textContent = \"Hello from ChromeCode\""}'

# Evaluate an expression and get the result
curl -X POST http://localhost:3001/tab/evaluate \
  -h 'Content-Type: application/json' \
  -d '{"expression":"document.title"}'

# Take a screenshot
curl http://localhost:3001/tab/screenshot

# Record a macro, then play it back
curl -X POST http://localhost:3001/macro/record/start
# ... perform browser actions ...
curl -X POST http://localhost:3001/macro/record/stop \
  -H 'Content-Type: application/json' \
  -d '{"name":"login-flow"}'
curl -X POST http://localhost:3001/macro/play \
  -H 'Content-Type: application/json' \
  -d '{"name":"login-flow"}'
curl -X DELETE http://localhost:3001/macro/login-flow

# Ask the LLM agent a question
curl -X POST http://localhost:3001/prompt \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"What is on this page?"}'
```

## Architecture

```
src/
├── background/
│   ├── background.ts     # Service worker: agent loop, prompt handling, direct operations
│   ├── providers.ts      # Streaming fetch to OpenAI-compatible endpoint
│   ├── tab-tools.ts      # chrome.scripting (read), chrome.debugger (execute/evaluate/screenshot)
│   ├── macro-manager.ts  # Macro record, play, and demo logic
│   ├── recording-manager.ts  # Screen recording via offscreen document
│   └── storage.ts        # Chrome storage adapters
├── panel/
│   ├── panel.html/css    # Side panel UI: chat, macros, recording controls
│   └── panel.ts          # Panel <-> background messaging
├── options/
│   ├── options.html      # Settings page: API key, base URL, model ID
│   └── options.ts        # Load/save settings
├── bridge/
│   └── server.ts         # Node.js bridge: WebSocket + HTTP API + CLI REPL
├── content/
│   └── macro-recorder.ts # Content script: captures user interactions for macros
├── shared/
│   ├── bridge-protocol.ts  # TypeScript interfaces for bridge <-> extension messages
│   ├── macro-types.ts      # Macro and MacroStep type definitions
│   └── macro-storage.ts    # Macro persistence in chrome.storage.local
└── polyfills/
    └── empty.js           # Node.js built-in stubs for browser
```

### Data Flow

```
                         ┌──────────────┐
   curl / CLI ──────────►│ Bridge Server│◄─── WebSocket ──── Extension
   (HTTP :3001)          │ (Node.js)    │                    (Service
                         └──────────────┘                     Worker)
                              │                                  │
                              │ DIRECT_REQUEST / REMOTE_PROMPT   │
                              └──────────────────────────────────┘
                                                                 │
                              ┌──────────────────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │  Agent Loop        │
                    │  (background.ts)   │
                    │                    │
                    │  Agent mode:       │
                    │    prompt → LLM →  │
                    │    parse tool call │
                    │    → execute       │
                    │                    │
                    │  Direct mode:      │
                    │    operation →     │
                    │    dispatch →      │
                    │    immediate result│
                    └────────────────────┘
```

## Tool System

The agent uses fenced code blocks to invoke tools (model-agnostic, no function calling required):

### Live Edit

````markdown
```javascript:cc_live_edit
document.querySelector('h1').textContent = 'Hello';
```
````

### Macro Tools

````markdown
```cc_macro:list
```
```cc_macro:play
{"name":"MyMacro"}
```
```cc_macro:record_start
```
```cc_macro:record_stop
{"name":"MyMacro"}
```
````

### Screen Recording

````markdown
```cc_record:start
```
```cc_record:stop
```
````

## License

MIT
