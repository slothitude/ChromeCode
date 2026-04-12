/** Config for a remote MCP server connected directly from the service worker */
export interface RemoteMcpConfig {
  name: string;
  url: string;
  /** 'sse' | 'http' */
  transport: string;
  headers?: Record<string, string>;
}

/** Config for a bridge-managed MCP server (spawned locally by bridge) */
export interface BridgeMcpConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** Stored in chrome.storage.local under 'mcp_servers' */
export interface McpStorage {
  remote: RemoteMcpConfig[];
  bridge: BridgeMcpConfig[];
}

export function defaultMcpStorage(): McpStorage {
  return { remote: [], bridge: [] };
}
