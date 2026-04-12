import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import readline from 'readline';
import { McpManager } from './mcp-manager.js';

const WS_PORT = 3000;
const API_PORT = 3001;

let extensionSocket: WebSocket | null = null;
const mcpManager = new McpManager();

// --- 1. WebSocket Server (for Extension) ---
const wss = new WebSocketServer({ port: WS_PORT });

function sendToExtension(data: any) {
  if (extensionSocket?.readyState === WebSocket.OPEN) {
    extensionSocket.send(JSON.stringify(data));
  }
}

wss.on('connection', (ws) => {
  console.log('\n[Bridge] ChromeCode Extension connected.');
  extensionSocket = ws;

  // Send current MCP tools list on connect
  const toolsList = mcpManager.listTools();
  if (toolsList.length > 0) {
    sendToExtension({ type: 'MCP_TOOLS_LIST', servers: toolsList });
  }

  ws.on('message', async (data) => {
    const msg = JSON.parse(data.toString());

    switch (msg.type) {
      case 'AGENT_EVENT':
        if (msg.event.delta) {
          process.stdout.write(msg.event.delta);
        } else if (msg.event.type === 'message_end') {
          process.stdout.write('\n\nChromeCode> ');
        }
        break;

      case 'ERROR':
        console.error('\n[Bridge] Extension Error:', msg.message);
        break;

      case 'MCP_ADD_SERVER': {
        try {
          const tools = await mcpManager.addServer(msg.config);
          const toolsList = mcpManager.listTools();
          sendToExtension({ type: 'MCP_TOOLS_LIST', servers: toolsList });
          sendToExtension({ type: 'MCP_SERVER_STATUS', name: msg.config.name, status: 'connected' });
        } catch (err: any) {
          sendToExtension({ type: 'MCP_ERROR', message: `Failed to add server "${msg.config.name}": ${err.message}` });
        }
        break;
      }

      case 'MCP_REMOVE_SERVER': {
        try {
          await mcpManager.removeServer(msg.name);
          const toolsList = mcpManager.listTools();
          sendToExtension({ type: 'MCP_TOOLS_LIST', servers: toolsList });
          sendToExtension({ type: 'MCP_SERVER_STATUS', name: msg.name, status: 'disconnected' });
        } catch (err: any) {
          sendToExtension({ type: 'MCP_ERROR', message: `Failed to remove server "${msg.name}": ${err.message}` });
        }
        break;
      }

      case 'MCP_LIST_TOOLS': {
        const toolsList = mcpManager.listTools();
        sendToExtension({ type: 'MCP_TOOLS_LIST', servers: toolsList });
        break;
      }

      case 'MCP_CALL_TOOL': {
        try {
          const result = await mcpManager.callTool(msg.serverName, msg.toolName, msg.args);
          sendToExtension({
            type: 'MCP_TOOL_RESULT',
            serverName: msg.serverName,
            toolName: msg.toolName,
            result,
          });
        } catch (err: any) {
          sendToExtension({
            type: 'MCP_TOOL_RESULT',
            serverName: msg.serverName,
            toolName: msg.toolName,
            result: { error: err.message },
          });
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    console.log('\n[Bridge] Extension disconnected.');
    extensionSocket = null;
  });
});

console.log(`[Bridge] WebSocket server listening on ws://localhost:${WS_PORT}`);

// --- 2. HTTP API (for other agents) ---
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/prompt') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { prompt } = JSON.parse(body);
        if (!extensionSocket) {
          res.writeHead(503);
          return res.end(JSON.stringify({ error: "Extension not connected" }));
        }

        extensionSocket.send(JSON.stringify({ type: 'REMOTE_PROMPT', text: prompt }));
        res.writeHead(200);
        res.end(JSON.stringify({ status: "Prompt sent to ChromeCode" }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
  } else if (req.method === 'GET' && req.url === '/mcp/tools') {
    const toolsList = mcpManager.listTools();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(toolsList));
  } else if (req.method === 'POST' && req.url === '/mcp/add') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const config = JSON.parse(body);
        const tools = await mcpManager.addServer(config);
        const toolsList = mcpManager.listTools();
        sendToExtension({ type: 'MCP_TOOLS_LIST', servers: toolsList });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: "ok", tools }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(API_PORT, () => {
  console.log(`[Bridge] HTTP API listening on http://localhost:${API_PORT}/prompt`);
});

// --- 3. Interactive CLI ---
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'ChromeCode> '
});

console.log('[Bridge] Interactive CLI Started. Type a message to send to your browser tab.');
rl.prompt();

rl.on('line', (line) => {
  if (!extensionSocket) {
    console.log('[Bridge] Error: Extension not connected. Open the side panel in Chrome.');
  } else {
    extensionSocket.send(JSON.stringify({ type: 'REMOTE_PROMPT', text: line.trim() }));
  }
  rl.prompt();
});

// --- 4. Load saved MCP servers on startup ---
mcpManager.loadSavedServers().then(() => {
  const serverNames = mcpManager.getServerNames();
  if (serverNames.length > 0) {
    console.log(`[MCP] Loaded ${serverNames.length} saved server(s): ${serverNames.join(", ")}`);
  }
}).catch(err => {
  console.error('[MCP] Failed to load saved servers:', err);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Bridge] Shutting down...');
  await mcpManager.shutdown();
  process.exit(0);
});
