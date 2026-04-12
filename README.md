# ChromeCode

A Chrome Side Panel extension (Manifest V3) that acts as a browser-based AI coding agent. It can read active tab content, perform live edits via the Chrome Debugger API, and stream responses from an OpenAI-compatible LLM API. The extension connects to a local Node.js bridge server for remote/CLI control and supports MCP (Model Context Protocol) tool servers for extended capabilities like Playwright browser automation.

## Features

- **Live Editing** — Execute JavaScript directly in the active tab using the Chrome Debugger API, bypassing CSP restrictions
- **AI-Powered** — Streams responses from any OpenAI-compatible chat/completions endpoint
- **Side Panel UI** — Chat interface embedded in Chrome's side panel
- **Bridge Server** — Node.js bridge for CLI control and remote prompt submission via WebSocket/HTTP
- **MCP Support** — Connect to external MCP tool servers (Playwright, Selenium, etc.) via:
  - Bridge-managed local stdio servers
  - Direct remote SSE/HTTP connections from the service worker

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
- **MCP Servers** — Configure remote and bridge-managed MCP tool servers

### Bridge Server (Optional)

The bridge enables CLI and remote control of the extension:

```bash
node dist/bridge/server.js
```

- WebSocket: `ws://localhost:3000` (extension connects here)
- HTTP API: `http://localhost:3001/prompt` (POST `{ "prompt": "..." }`)
- Interactive CLI: Type prompts directly in the terminal

## Architecture

```
src/
├── background/
│   ├── background.ts     # Service worker: agent loop, prompt handling
│   ├── providers.ts      # Streaming fetch to OpenAI-compatible endpoint
│   ├── tab-tools.ts      # chrome.scripting + chrome.debugger tools
│   ├── storage.ts        # Chrome storage adapters
│   ├── tools/
│   │   ├── tool-registry.ts   # ToolDefinition/ToolExecutor + ToolRegistry
│   │   ├── tool-parser.ts     # Parse tool calls from LLM responses
│   │   └── builtin-tools.ts   # Built-in cc_live_edit tool
│   └── mcp/
│       ├── types.ts           # Shared MCP config interfaces
│       ├── mcp-coordinator.ts # Orchestrates all MCP connections
│       ├── remote-mcp-client.ts  # Direct SSE/HTTP MCP connections
│       └── bridge-mcp-client.ts  # Bridge-proxied MCP connections
├── panel/
│   ├── panel.html/css    # Side panel UI
│   └── panel.ts          # Panel ↔ background messaging
├── options/
│   ├── options.html      # Settings page
│   └── options.ts        # Load/save settings
├── bridge/
│   ├── server.ts         # WebSocket + HTTP bridge server
│   └── mcp-manager.ts    # Node.js MCP server manager (stdio transport)
└── polyfills/
    └── empty.js          # Node.js built-in stubs for browser
```

## Tool System

The agent uses fenced code blocks to invoke tools (model-agnostic, no function calling required):

```javascript:cc_live_edit
document.querySelector('h1').textContent = 'Hello';
```

```tool:playwright_navigate
{"url": "https://example.com"}
```

## MCP Server Configuration

MCP servers are configured via the options page and stored in `chrome.storage.local`.

### Remote MCP Servers (Direct from Service Worker)

Connect directly to MCP servers over HTTP/SSE:

```json
{
  "name": "my-server",
  "url": "https://my-mcp-server.example.com/sse",
  "transport": "sse"
}
```

### Bridge-Managed MCP Servers (Local stdio)

Spawn local MCP processes through the bridge server:

```json
{
  "name": "playwright",
  "command": "npx",
  "args": ["@playwright/mcp@latest"]
}
```

## Roadmap

Right now ChromeCode edits JS in the active tab. The same architecture enables:

- **Web scraping agent** — reads any page structure, extracts data, no brittle selectors
- **Form automation** — fills and submits anything, sees the result, retries
- **Visual regression** — screenshot before/after every edit
- **Network mocking** — intercept API calls, swap responses, test edge cases live
- **Multi-tab orchestration** — bridge server coordinates agents across tabs
- **JINN integration** — ChromeCode becomes a browser tool-use endpoint for your multi-agent system

## License

MIT
