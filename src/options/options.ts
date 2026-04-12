const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
const baseUrlInput = document.getElementById('base-url') as HTMLInputElement;
const modelIdInput = document.getElementById('model-id') as HTMLInputElement;
const saveBtn = document.getElementById('save')!;
const statusDiv = document.getElementById('status')!;
const remoteServersDiv = document.getElementById('remote-servers')!;
const bridgeServersDiv = document.getElementById('bridge-servers')!;
const addRemoteBtn = document.getElementById('add-remote-btn')!;
const addBridgeBtn = document.getElementById('add-bridge-btn')!;

// --- Load current settings ---
chrome.storage.local.get(['apiKey', 'baseUrl', 'modelId', 'mcp_servers'], (settings) => {
  if (settings.apiKey) apiKeyInput.value = settings.apiKey;
  if (settings.baseUrl) baseUrlInput.value = settings.baseUrl;
  if (settings.modelId) modelIdInput.value = settings.modelId;

  const mcp = settings.mcp_servers || { remote: [], bridge: [] };
  for (const config of mcp.remote) {
    addRemoteServerEntry(config);
  }
  for (const config of mcp.bridge) {
    addBridgeServerEntry(config);
  }
});

// --- Remote MCP server entries ---
addRemoteBtn.addEventListener('click', () => {
  addRemoteServerEntry({ name: '', url: '', transport: 'sse' });
});

function addRemoteServerEntry(config: { name: string; url: string; transport: string }) {
  const entry = document.createElement('div');
  entry.className = 'server-entry';
  entry.innerHTML = `
    <div class="row">
      <div class="field">
        <label>Name</label>
        <input type="text" class="rs-name" value="${config.name}" placeholder="my-server">
      </div>
      <div class="field">
        <label>Transport</label>
        <select class="rs-transport">
          <option value="sse" ${config.transport === 'sse' ? 'selected' : ''}>SSE</option>
          <option value="http" ${config.transport === 'http' ? 'selected' : ''}>HTTP</option>
        </select>
      </div>
    </div>
    <div class="field">
      <label>URL</label>
      <input type="text" class="rs-url" value="${config.url}" placeholder="https://my-mcp-server.example.com/sse">
    </div>
    <button class="small danger remove-btn">Remove</button>
  `;
  entry.querySelector('.remove-btn')!.addEventListener('click', () => entry.remove());
  remoteServersDiv.appendChild(entry);
}

// --- Bridge MCP server entries ---
addBridgeBtn.addEventListener('click', () => {
  addBridgeServerEntry({ name: '', command: '', args: [] });
});

function addBridgeServerEntry(config: { name: string; command: string; args: string[] }) {
  const entry = document.createElement('div');
  entry.className = 'server-entry';
  entry.innerHTML = `
    <div class="row">
      <div class="field">
        <label>Name</label>
        <input type="text" class="bs-name" value="${config.name}" placeholder="playwright">
      </div>
      <div class="field">
        <label>Command</label>
        <input type="text" class="bs-command" value="${config.command}" placeholder="npx">
      </div>
    </div>
    <div class="field">
      <label>Args (comma-separated)</label>
      <input type="text" class="bs-args" value="${config.args.join(', ')}" placeholder="@playwright/mcp@latest">
    </div>
    <button class="small danger remove-btn">Remove</button>
  `;
  entry.querySelector('.remove-btn')!.addEventListener('click', () => entry.remove());
  bridgeServersDiv.appendChild(entry);
}

// --- Save ---
saveBtn.addEventListener('click', () => {
  // Collect remote servers
  const remote: Array<{ name: string; url: string; transport: string }> = [];
  for (const entry of remoteServersDiv.querySelectorAll('.server-entry')) {
    const name = (entry.querySelector('.rs-name') as HTMLInputElement).value.trim();
    const url = (entry.querySelector('.rs-url') as HTMLInputElement).value.trim();
    const transport = (entry.querySelector('.rs-transport') as HTMLSelectElement).value;
    if (name && url) {
      remote.push({ name, url, transport });
    }
  }

  // Collect bridge servers
  const bridge: Array<{ name: string; command: string; args: string[] }> = [];
  for (const entry of bridgeServersDiv.querySelectorAll('.server-entry')) {
    const name = (entry.querySelector('.bs-name') as HTMLInputElement).value.trim();
    const command = (entry.querySelector('.bs-command') as HTMLInputElement).value.trim();
    const argsStr = (entry.querySelector('.bs-args') as HTMLInputElement).value.trim();
    const args = argsStr ? argsStr.split(',').map(a => a.trim()) : [];
    if (name && command) {
      bridge.push({ name, command, args });
    }
  }

  chrome.storage.local.set({
    apiKey: apiKeyInput.value,
    baseUrl: baseUrlInput.value,
    modelId: modelIdInput.value,
    mcp_servers: { remote, bridge },
  }, () => {
    statusDiv.textContent = 'Settings saved!';
    setTimeout(() => { statusDiv.textContent = ''; }, 2000);

    // Notify background to reload MCP connections
    chrome.runtime.sendMessage({ type: 'MCP_RELOAD' });
  });
});
