import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import readline from 'readline';

const WS_PORT = 3000;
const API_PORT = 3001;

let extensionSocket: WebSocket | null = null;

// --- Pending request map for HTTP request-response correlation ---
interface PendingRequest {
  resolve: (data: any) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  mode: 'agent' | 'direct';
  buffer: string; // agent mode accumulates text here
}

const pendingRequests = new Map<string, PendingRequest>();

function generateId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function resolveRequest(requestId: string, data: any) {
  const pending = pendingRequests.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingRequests.delete(requestId);
  pending.resolve(data);
}

function rejectRequest(requestId: string, err: Error) {
  const pending = pendingRequests.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingRequests.delete(requestId);
  pending.reject(err);
}

function rejectAllPending(err: Error) {
  for (const [id, pending] of pendingRequests) {
    clearTimeout(pending.timeout);
    pending.reject(err);
  }
  pendingRequests.clear();
}

function sendToExtension(msg: object): boolean {
  if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) return false;
  extensionSocket.send(JSON.stringify(msg));
  return true;
}

// --- 1. WebSocket Server (for Extension) ---
const wss = new WebSocketServer({ port: WS_PORT });

wss.on('connection', (ws) => {
  console.log('\n[Bridge] ChromeCode Extension connected.');
  extensionSocket = ws;

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.type === 'AGENT_EVENT') {
      const requestId = msg.requestId;

      if (requestId && pendingRequests.has(requestId)) {
        // Route to the pending HTTP request
        const pending = pendingRequests.get(requestId)!;
        if (msg.event.type === 'text_delta' && msg.event.delta) {
          pending.buffer += msg.event.delta;
          process.stdout.write(msg.event.delta);
        } else if (msg.event.type === 'message_end') {
          process.stdout.write('\n\nChromeCode> ');
          resolveRequest(requestId, { requestId, response: pending.buffer });
        }
      } else {
        // CLI-only display
        if (msg.event.delta) {
          process.stdout.write(msg.event.delta);
        } else if (msg.event.type === 'message_end') {
          process.stdout.write('\n\nChromeCode> ');
        }
      }
    } else if (msg.type === 'DIRECT_RESPONSE') {
      const requestId = msg.requestId;
      if (requestId && pendingRequests.has(requestId)) {
        if (msg.success) {
          resolveRequest(requestId, msg.data);
        } else {
          rejectRequest(requestId, new Error(msg.error || 'Unknown error'));
        }
      }
    } else if (msg.type === 'ERROR') {
      const requestId = msg.requestId;
      console.error('\n[Bridge] Extension Error:', msg.message);
      if (requestId && pendingRequests.has(requestId)) {
        rejectRequest(requestId, new Error(msg.message));
      }
    }
  });

  ws.on('close', () => {
    console.log('\n[Bridge] Extension disconnected.');
    extensionSocket = null;
    rejectAllPending(new Error('Extension disconnected'));
  });
});

console.log(`[Bridge] WebSocket server listening on ws://localhost:${WS_PORT}`);

// --- 2. HTTP API Router ---

function sendJSON(res: http.ServerResponse, status: number, body: any) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.ServerRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendDirectAndAwait(operation: string, params?: Record<string, any>, timeoutMs = 30000): Promise<any> {
  const requestId = generateId();

  return new Promise((resolve, reject) => {
    if (!sendToExtension({ type: 'DIRECT_REQUEST', requestId, operation, params })) {
      return reject(new Error('Extension not connected'));
    }

    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('Request timed out'));
    }, timeoutMs);

    pendingRequests.set(requestId, { resolve, reject, timeout, mode: 'direct', buffer: '' });
  });
}

function sendPromptAndAwait(prompt: string, timeoutMs = 120000): Promise<any> {
  const requestId = generateId();

  return new Promise((resolve, reject) => {
    if (!sendToExtension({ type: 'REMOTE_PROMPT', text: prompt, requestId })) {
      return reject(new Error('Extension not connected'));
    }

    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('Request timed out'));
    }, timeoutMs);

    pendingRequests.set(requestId, { resolve, reject, timeout, mode: 'agent', buffer: '' });
  });
}

function matchRoute(method: string, url: string): { handler: (req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>) => void; params: Record<string, string> } | null {
  // Exact matches first
  const routes: { method: string; path: string; handler: (req: any, res: any, params: any) => void }[] = [
    { method: 'GET',  path: '/health',              handler: handleHealth },
    { method: 'POST', path: '/prompt',              handler: handlePrompt },
    { method: 'GET',  path: '/tab/content',         handler: handleTabContent },
    { method: 'GET',  path: '/tab/screenshot',      handler: handleTabScreenshot },
    { method: 'POST', path: '/tab/execute',         handler: handleTabExecute },
    { method: 'POST', path: '/tab/evaluate',        handler: handleTabEvaluate },
    { method: 'GET',  path: '/macro/list',          handler: handleMacroList },
    { method: 'POST', path: '/macro/play',          handler: handleMacroPlay },
    { method: 'POST', path: '/macro/record/start',  handler: handleMacroRecordStart },
    { method: 'POST', path: '/macro/record/stop',   handler: handleMacroRecordStop },
    { method: 'POST', path: '/macro/demo',          handler: handleMacroDemo },
    { method: 'GET',  path: '/recording/status',    handler: handleRecordingStatus },
    { method: 'POST', path: '/recording/start',     handler: handleRecordingStart },
    { method: 'POST', path: '/recording/stop',      handler: handleRecordingStop },
  ];

  for (const route of routes) {
    if (route.method === method && route.path === url) {
      return { handler: route.handler, params: {} };
    }
  }

  // Pattern: DELETE /macro/:name
  if (method === 'DELETE' && url.startsWith('/macro/')) {
    const name = decodeURIComponent(url.slice('/macro/'.length));
    if (name) return { handler: handleMacroDelete, params: { name } };
  }

  return null;
}

// --- Route handlers ---

async function handleHealth(_req: http.IncomingMessage, res: http.ServerResponse) {
  sendJSON(res, 200, { status: 'ok', extensionConnected: !!extensionSocket && extensionSocket.readyState === WebSocket.OPEN });
}

async function handlePrompt(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const body = JSON.parse(await readBody(req));
    if (!body.prompt) { sendJSON(res, 400, { error: 'Missing "prompt"' }); return; }

    const result = await sendPromptAndAwait(body.prompt);
    sendJSON(res, 200, result);
  } catch (e: any) {
    if (e.message === 'Extension not connected') { sendJSON(res, 503, { error: e.message }); return; }
    if (e.message === 'Request timed out') { sendJSON(res, 504, { error: e.message }); return; }
    sendJSON(res, 500, { error: e.message });
  }
}

async function handleTabContent(_req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const data = await sendDirectAndAwait('tab.content');
    sendJSON(res, 200, data);
  } catch (e: any) {
    mapError(res, e);
  }
}

async function handleTabScreenshot(_req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const data = await sendDirectAndAwait('tab.screenshot');
    sendJSON(res, 200, data);
  } catch (e: any) {
    mapError(res, e);
  }
}

async function handleTabExecute(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const body = JSON.parse(await readBody(req));
    if (!body.code) { sendJSON(res, 400, { error: 'Missing "code"' }); return; }
    const data = await sendDirectAndAwait('tab.execute', { code: body.code });
    sendJSON(res, 200, data);
  } catch (e: any) {
    mapError(res, e);
  }
}

async function handleTabEvaluate(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const body = JSON.parse(await readBody(req));
    if (!body.expression) { sendJSON(res, 400, { error: 'Missing "expression"' }); return; }
    const data = await sendDirectAndAwait('tab.evaluate', { expression: body.expression });
    sendJSON(res, 200, data);
  } catch (e: any) {
    mapError(res, e);
  }
}

async function handleMacroList(_req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const data = await sendDirectAndAwait('macro.list');
    sendJSON(res, 200, data);
  } catch (e: any) {
    mapError(res, e);
  }
}

async function handleMacroPlay(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const body = JSON.parse(await readBody(req));
    if (!body.name) { sendJSON(res, 400, { error: 'Missing "name"' }); return; }
    const data = await sendDirectAndAwait('macro.play', { name: body.name });
    sendJSON(res, 200, data);
  } catch (e: any) {
    mapError(res, e);
  }
}

async function handleMacroRecordStart(_req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const data = await sendDirectAndAwait('macro.record_start');
    sendJSON(res, 200, data);
  } catch (e: any) {
    mapError(res, e);
  }
}

async function handleMacroRecordStop(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const body = JSON.parse(await readBody(req));
    if (!body.name) { sendJSON(res, 400, { error: 'Missing "name"' }); return; }
    const data = await sendDirectAndAwait('macro.record_stop', { name: body.name });
    sendJSON(res, 200, data);
  } catch (e: any) {
    mapError(res, e);
  }
}

async function handleMacroDelete(_req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>) {
  try {
    const data = await sendDirectAndAwait('macro.delete', { name: params.name });
    sendJSON(res, 200, data);
  } catch (e: any) {
    mapError(res, e);
  }
}

async function handleMacroDemo(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const body = JSON.parse(await readBody(req));
    if (!body.name) { sendJSON(res, 400, { error: 'Missing "name"' }); return; }
    const data = await sendDirectAndAwait('macro.demo', { name: body.name });
    sendJSON(res, 200, data);
  } catch (e: any) {
    mapError(res, e);
  }
}

async function handleRecordingStatus(_req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const data = await sendDirectAndAwait('recording.status');
    sendJSON(res, 200, data);
  } catch (e: any) {
    mapError(res, e);
  }
}

async function handleRecordingStart(_req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const data = await sendDirectAndAwait('recording.start');
    sendJSON(res, 200, data);
  } catch (e: any) {
    mapError(res, e);
  }
}

async function handleRecordingStop(_req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const data = await sendDirectAndAwait('recording.stop');
    sendJSON(res, 200, data);
  } catch (e: any) {
    mapError(res, e);
  }
}

function mapError(res: http.ServerResponse, e: Error) {
  if (e.message === 'Extension not connected') { sendJSON(res, 503, { error: e.message }); return; }
  if (e.message === 'Request timed out') { sendJSON(res, 504, { error: e.message }); return; }
  sendJSON(res, 500, { error: e.message });
}

const server = http.createServer((req, res) => {
  const route = matchRoute(req.method || 'GET', req.url?.split('?')[0] || '/');
  if (!route) {
    sendJSON(res, 404, { error: 'Not found' });
    return;
  }
  route.handler(req, res, route.params);
});

server.listen(API_PORT, () => {
  console.log(`[Bridge] HTTP API listening on http://localhost:${API_PORT}`);
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
    // CLI sends without requestId — backward compatible, output goes to stdout
    extensionSocket.send(JSON.stringify({ type: 'REMOTE_PROMPT', text: line.trim() }));
  }
  rl.prompt();
});
