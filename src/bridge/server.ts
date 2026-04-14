import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import readline from 'readline';
import { execFile } from 'child_process';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, relative, extname, sep } from 'path';

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

// --- Native folder picker ---
function pickFolder(): Promise<{ path: string } | { cancelled: true }> {
  return new Promise((resolve) => {
    const platform = process.platform;
    let cmd: string;
    let args: string[];

    if (platform === 'win32') {
      cmd = 'powershell';
      args = [
        '-NoProfile', '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; $fb = New-Object System.Windows.Forms.FolderBrowserDialog; if ($fb.ShowDialog() -eq \'OK\') { $fb.SelectedPath } else { \'\' }'
      ];
    } else if (platform === 'darwin') {
      cmd = 'osascript';
      args = ['-e', 'POSIX path of (choose folder with prompt "Select folder")'];
    } else {
      // Linux — try zenity first
      cmd = 'zenity';
      args = ['--file-selection', '--directory'];
    }

    execFile(cmd, args, { timeout: 300000 }, (err, stdout) => {
      if (err || !stdout || !stdout.trim()) {
        resolve({ cancelled: true });
        return;
      }
      // osascript returns path with trailing newline and sometimes alias coercion text
      const path = stdout.trim();
      resolve({ path });
    });
  });
}

// --- File system helpers for connected folder ---
const MAX_FILE_SIZE = 1024 * 1024; // 1MB

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.flv',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.sqlite', '.db', '.class', '.jar',
]);

function ensureInsideFolder(folderPath: string, targetPath: string): string {
  const resolved = resolve(folderPath, targetPath);
  const folder = resolve(folderPath);
  if (resolved === folder) return resolved;
  const prefix = folder.endsWith(sep) ? folder : folder + sep;
  if (!resolved.startsWith(prefix)) {
    throw new Error('Path traversal detected: path escapes the connected folder');
  }
  return resolved;
}

function readFileFromFolder(folderPath: string, filePath: string): string {
  const resolved = ensureInsideFolder(folderPath, filePath);
  const stat = statSync(resolved);
  if (!stat.isFile()) throw new Error(`Not a file: ${filePath}`);
  if (stat.size > MAX_FILE_SIZE) throw new Error(`File too large (${(stat.size / 1024).toFixed(0)}KB, max 1MB)`);

  const ext = extname(resolved).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) throw new Error(`Binary file type (${ext}) cannot be read as text`);

  const content = readFileSync(resolved, 'utf-8');
  if (content.indexOf('\0') !== -1) throw new Error('File appears to be binary (contains null bytes)');

  return content;
}

interface FileEntry {
  name: string;
  path: string;
  size: number;
  type: 'file' | 'directory';
}

function listFolderRecursive(folderPath: string, dirPath: string): FileEntry[] {
  const resolved = ensureInsideFolder(folderPath, dirPath);
  const entries: FileEntry[] = [];

  let items;
  try {
    items = readdirSync(resolved, { withFileTypes: true });
  } catch (e: any) {
    throw new Error(`Cannot read directory: ${e.message}`);
  }

  for (const item of items) {
    if (item.name === 'node_modules' || item.name === '.git') continue;

    const fullPath = join(resolved, item.name);
    const relativePath = relative(resolve(folderPath), fullPath).replace(/\\/g, '/');

    if (item.isDirectory()) {
      entries.push({ name: item.name, path: relativePath, size: 0, type: 'directory' });
      entries.push(...listFolderRecursive(folderPath, relativePath));
    } else if (item.isFile()) {
      const stat = statSync(fullPath);
      entries.push({ name: item.name, path: relativePath, size: stat.size, type: 'file' });
    }
  }

  return entries;
}

function listFolder(folderPath: string, dirPath: string): FileEntry[] {
  return listFolderRecursive(folderPath, dirPath || '.');
}

// --- 1. WebSocket Server (for Extension) ---
const wss = new WebSocketServer({ port: WS_PORT });

wss.on('connection', (ws) => {
  console.log('\n[Bridge] ChromeCode Extension connected.');
  extensionSocket = ws;

  ws.on('message', async (data) => {
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
    } else if (msg.type === 'FOLDER_PICK_REQUEST') {
      console.log('[Bridge] Folder pick requested by extension');
      const result = await pickFolder();
      if (extensionSocket?.readyState === WebSocket.OPEN) {
        extensionSocket.send(JSON.stringify({ type: 'FOLDER_PICK_RESULT', ...result }));
      }
    } else if (msg.type === 'FOLDER_READ_REQUEST') {
      const { folderPath, filePath, requestId } = msg;
      console.log(`[Bridge] Folder read request: ${filePath}`);
      try {
        const content = readFileFromFolder(folderPath, filePath);
        ws.send(JSON.stringify({ type: 'FOLDER_READ_RESPONSE', requestId, success: true, content }));
      } catch (e: any) {
        ws.send(JSON.stringify({ type: 'FOLDER_READ_RESPONSE', requestId, success: false, error: e.message }));
      }
    } else if (msg.type === 'FOLDER_LIST_REQUEST') {
      const { folderPath, dirPath, requestId } = msg;
      console.log(`[Bridge] Folder list request: ${dirPath || '(root)'}`);
      try {
        const entries = listFolder(folderPath, dirPath || '');
        ws.send(JSON.stringify({ type: 'FOLDER_LIST_RESPONSE', requestId, success: true, entries }));
      } catch (e: any) {
        ws.send(JSON.stringify({ type: 'FOLDER_LIST_RESPONSE', requestId, success: false, error: e.message }));
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
    { method: 'POST', path: '/folder/pick',           handler: handleFolderPick },
    { method: 'POST', path: '/folder/read',           handler: handleFolderRead },
    { method: 'POST', path: '/folder/list',           handler: handleFolderList },
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

async function handleFolderPick(_req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const result = await pickFolder();
    sendJSON(res, 200, result);
  } catch (e: any) {
    sendJSON(res, 500, { error: e.message });
  }
}

async function handleFolderRead(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const body = JSON.parse(await readBody(req));
    if (!body.folderPath) { sendJSON(res, 400, { error: 'Missing "folderPath"' }); return; }
    if (!body.filePath) { sendJSON(res, 400, { error: 'Missing "filePath"' }); return; }
    const content = readFileFromFolder(body.folderPath, body.filePath);
    sendJSON(res, 200, { content });
  } catch (e: any) {
    sendJSON(res, 400, { error: e.message });
  }
}

async function handleFolderList(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const body = JSON.parse(await readBody(req));
    if (!body.folderPath) { sendJSON(res, 400, { error: 'Missing "folderPath"' }); return; }
    const entries = listFolder(body.folderPath, body.dirPath || '');
    sendJSON(res, 200, { entries });
  } catch (e: any) {
    sendJSON(res, 400, { error: e.message });
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
