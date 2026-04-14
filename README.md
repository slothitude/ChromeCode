# ChromeCode

A Chrome Side Panel extension that turns your browser into an AI-powered coding agent. Read any tab, execute JavaScript live, automate workflows with macros, record your screen, and control everything programmatically via a full HTTP API. Works with any OpenAI-compatible LLM.

## What It Does

- **AI Agent** — Ask questions about any page, get edits made in real-time via the Chrome Debugger API (bypasses CSP)
- **HTTP Control Plane** — Full REST API for programmatic browser control from curl, scripts, or other agents
- **Macro System** — Record clicks, typing, and scrolling into replayable macros with named save/delete
- **Screen Recording** — Capture the active tab as a downloadable WebM video
- **Two Modes** — Agent mode (LLM processes your prompt) and Direct mode (bypass LLM, execute immediately)

## Quick Start

### Install & Build

```bash
npm install
npm run build          # Production build → dist/
npm run watch          # Dev build with sourcemaps + auto-rebuild
```

### Load the Extension

1. Open `chrome://extensions`
2. Enable **Developer Mode**
3. Click **Load unpacked**, select the `dist/` directory
4. Click the ChromeCode icon to open the side panel

### Configure

Open the extension options page (right-click icon → Options) to set:

| Setting | Default | Description |
|---------|---------|-------------|
| API Key | — | Your LLM provider key |
| Base URL | NVIDIA API | Any OpenAI-compatible endpoint |
| Model ID | minimaxai/minimax-m2.7 | Model to use |

### Start the Bridge

```bash
npm run bridge
```

The bridge starts three services:

| Service | Port | Purpose |
|---------|------|---------|
| WebSocket | 3000 | Extension connects here |
| HTTP API | 3001 | RESTful control plane |
| CLI REPL | stdin/stdout | Interactive terminal prompt |

---

## HTTP API Reference

All routes on `http://localhost:3001`. Two modes of operation:

| Mode | How | Timeout | Use When |
|------|-----|---------|----------|
| **Agent** | `POST /prompt` | 120s | You want the LLM to think and respond |
| **Direct** | All other routes | 30s | You know exactly what to do, skip the LLM |

### Health Check

```bash
curl http://localhost:3001/health
# → {"status":"ok","extensionConnected":true}
```

Returns 503-style errors if the extension isn't connected.

### Agent Mode

```bash
curl -X POST http://localhost:3001/prompt \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"What is on this page?"}'
# → {"requestId":"req_...","response":"The page shows..."}
```

The prompt goes through the full agent loop — tab context injection, LLM streaming, tool parsing, auto-retry on failures. The HTTP response blocks until the agent finishes (or 120s timeout).

### Tab Operations

#### Read tab content

```bash
curl http://localhost:3001/tab/content
# → {"url":"https://...","title":"...","text":"...","readyState":"complete"}
```

#### Take a screenshot

```bash
curl http://localhost:3001/tab/screenshot
# → {"dataUrl":"data:image/jpeg;base64,..."}
```

#### Execute JavaScript (fire-and-forget)

```bash
curl -X POST http://localhost:3001/tab/execute \
  -H 'Content-Type: application/json' \
  -d '{"code":"document.querySelector(\"h1\").textContent = \"Hello\""}'
# → {"success":true}
```

Runs via Chrome Debugger Protocol. Bypasses CSP. Returns success/error status.

#### Evaluate JavaScript (returns result)

```bash
curl -X POST http://localhost:3001/tab/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"expression":"document.querySelectorAll(\"a\").length"}'
# → {"success":true,"value":42}
```

Same as execute but uses `returnByValue: true` so you get the JS return value back.

### Macro Operations

Macros record real browser interactions (clicks, key presses, text input, scrolling) with accurate timing and replay them via CDP input events.

#### List macros

```bash
curl http://localhost:3001/macro/list
# → {"macros":[{"id":"...","name":"login","steps":12,"durationMs":4500,...}]}
```

#### Record a macro

```bash
# Start recording
curl -X POST http://localhost:3001/macro/record/start
# → {"success":true}

# ... perform actions in the browser ...

# Stop and save
curl -X POST http://localhost:3001/macro/record/stop \
  -H 'Content-Type: application/json' \
  -d '{"name":"login-flow"}'
# → {"success":true,"steps":12}
```

#### Play a macro

```bash
curl -X POST http://localhost:3001/macro/play \
  -H 'Content-Type: application/json' \
  -d '{"name":"login-flow"}'
# → {"success":true}
```

#### Delete a macro

```bash
curl -X DELETE http://localhost:3001/macro/login-flow
# → {"success":true}
```

#### Demo mode (play + record video)

```bash
curl -X POST http://localhost:3001/macro/demo \
  -H 'Content-Type: application/json' \
  -d '{"name":"login-flow"}'
# → {"success":true}
```

Plays the macro while simultaneously recording the tab. Video downloads as `chromecode-recording.webm`.

### Screen Recording

```bash
# Check recording status
curl http://localhost:3001/recording/status
# → {"recording":false,"macroRecording":false,"macroPlaying":false}

# Start recording
curl -X POST http://localhost:3001/recording/start
# → {"success":true}

# Stop recording (video auto-downloads)
curl -X POST http://localhost:3001/recording/stop
# → {"success":true}
```

### Error Responses

| HTTP Status | Meaning |
|-------------|---------|
| `400` | Missing required parameter |
| `404` | Unknown route |
| `500` | Operation failed (see `error` field) |
| `503` | Extension not connected |
| `504` | Request timed out (agent=120s, direct=30s) |

If the extension disconnects mid-request, all pending requests are rejected with 504.

---

## Agent Tool System

The LLM agent uses fenced code blocks to invoke tools. This is model-agnostic — no function calling API required. The agent loop parses responses for these patterns and auto-executes them.

### Live Edit — run JS in the active tab

````markdown
```javascript:cc_live_edit
document.querySelector('h1').textContent = 'Hello';
```
````

On execution failure, the error is fed back into the conversation and the agent auto-retries.

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
```cc_macro:delete
{"name":"MyMacro"}
```
```cc_macro:demo
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

---

## Architecture

```
src/
├── background/
│   ├── background.ts         # Service worker: agent loop, prompt handling, direct operations
│   ├── providers.ts          # Streaming fetch to OpenAI-compatible chat/completions endpoint
│   ├── tab-tools.ts          # Tab read, JS execute, JS evaluate, screenshot capture
│   ├── macro-manager.ts      # Macro record, play, demo via CDP input events
│   ├── recording-manager.ts  # Screen recording via offscreen document + MediaRecorder
│   └── storage.ts            # Chrome storage adapters
├── panel/
│   ├── panel.html/css        # Side panel UI: chat, macros, recording controls
│   └── panel.ts              # Panel ↔ background messaging via chrome.runtime.Port
├── options/
│   ├── options.html          # Settings page: API key, base URL, model ID
│   └── options.ts            # Load/save settings from chrome.storage.local
├── bridge/
│   └── server.ts             # Node.js bridge: WebSocket + HTTP API + CLI REPL
├── content/
│   └── macro-recorder.ts     # Content script: captures user interactions for macros
├── shared/
│   ├── bridge-protocol.ts    # TypeScript interfaces for bridge ↔ extension messages
│   ├── macro-types.ts        # Macro and MacroStep type definitions
│   └── macro-storage.ts      # Macro persistence in chrome.storage.local
└── polyfills/
    └── empty.js              # Node.js built-in stubs for browser
```

### How It Works

```
  You (curl/CLI/panel)
         │
         ▼
  ┌──────────────────────────────────────────────────────┐
  │                  Bridge Server (Node.js)              │
  │                                                      │
  │  HTTP :3001 ──► pendingRequests Map ──► WebSocket    │
  │  CLI stdin  ───────────────────────────► WebSocket    │
  │                                                      │
  │  Routes:                                             │
  │    /prompt        → agent mode (120s)                │
  │    /tab/*         → direct mode (30s)                │
  │    /macro/*       → direct mode (30s)                │
  │    /recording/*   → direct mode (30s)                │
  └──────────────────────┬───────────────────────────────┘
                         │ WebSocket :3000
                         ▼
  ┌──────────────────────────────────────────────────────┐
  │              Extension Service Worker                 │
  │                                                      │
  │  REMOTE_PROMPT → handlePrompt() → LLM stream         │
  │    → parse cc_live_edit / cc_macro / cc_record        │
  │    → execute via chrome.debugger                      │
  │    → auto-retry on failure                            │
  │                                                      │
  │  DIRECT_REQUEST → handleDirectOperation()             │
  │    → dispatch to tab-tools / macro-manager / etc      │
  │    → return result immediately                        │
  └──────────────────────────────────────────────────────┘
```

### Data Flow

1. **Panel → Background** — `chrome.runtime.Port` named `"chromecode-panel"`. Messages: `PROMPT`, `CLEAR_HISTORY`, macro/recording controls.
2. **Background → Panel** — Port messages with `AGENT_EVENT` (text_delta, message_end) and `ERROR`.
3. **Bridge → Background** — WebSocket on `ws://localhost:3000`. Sends `REMOTE_PROMPT` (agent mode) or `DIRECT_REQUEST` (direct mode).
4. **Background → Bridge** — `AGENT_EVENT` (with requestId), `DIRECT_RESPONSE`, or `ERROR`. The bridge correlates these back to the pending HTTP request.
5. **External → Bridge** — HTTP POST to `http://localhost:3001/prompt` or any other route.

---

## Demos

### Asteroids (`demos/asteroids.html`)

A self-contained browser game. Open directly in Chrome or inject onto any page via the bridge:

```bash
# Inject the game onto the active tab
curl -X POST http://localhost:3001/tab/execute \
  -H 'Content-Type: application/json' \
  -d '{"code":"..."}'
```

**Controls:** WASD/Arrows to move, Space/E to shoot, R to restart, backtick (`) to toggle.

### YouTube Effects (`demos/youtube-effects/`)

![YouTube Effects Demo](demos/youtube-effects/slothtube.png)

Inject audio/video effects into any YouTube page via the bridge API:

- **pitch-variation.js** — Sweeps playbackRate between 0.5x and 2.0x
- **audio-distortion.js** — Waveshaper distortion on audio
- **vhs-shader.js** — VHS style: chromatic aberration, scanlines, vignette
- **toon-shader.js** — Toon/cel shader: posterized colors + Sobel edge outlines

```bash
# Inject VHS effect onto active tab
curl -X POST http://localhost:3001/tab/execute \
  -H 'Content-Type: application/json' \
  -d "{\"code\":\"$(cat demos/youtube-effects/vhs-shader.js)\"}"
```

See `demos/youtube-effects/README.md` for stop instructions and DevTools usage.

---

## License

MIT
