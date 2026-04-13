import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import readline from 'readline';

const WS_PORT = 3000;
const API_PORT = 3001;

let extensionSocket: WebSocket | null = null;

// --- 1. WebSocket Server (for Extension) ---
const wss = new WebSocketServer({ port: WS_PORT });

wss.on('connection', (ws) => {
  console.log('\n[Bridge] ChromeCode Extension connected.');
  extensionSocket = ws;

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'AGENT_EVENT') {
      if (msg.event.delta) {
        process.stdout.write(msg.event.delta);
      } else if (msg.event.type === 'message_end') {
        process.stdout.write('\n\nChromeCode> ');
      }
    } else if (msg.type === 'ERROR') {
      console.error('\n[Bridge] Extension Error:', msg.message);
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
