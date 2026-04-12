import type { ToolRegistry } from "../tools/tool-registry.js";
import { RemoteMcpClient } from "./remote-mcp-client.js";
import { BridgeMcpClient } from "./bridge-mcp-client.js";
import type { McpStorage, RemoteMcpConfig, BridgeMcpConfig } from "./types.js";
import { defaultMcpStorage } from "./types.js";

/**
 * Orchestrates all MCP connections — both direct remote and bridge-proxied.
 * Reads config from chrome.storage.local and manages lifecycle.
 */
export class McpCoordinator {
  private registry: ToolRegistry;
  private remoteClient: RemoteMcpClient;
  private bridgeClient: BridgeMcpClient;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
    this.remoteClient = new RemoteMcpClient(registry);
    this.bridgeClient = new BridgeMcpClient(registry);
  }

  /** Initialize from stored config */
  async initialize(): Promise<void> {
    const storage = await this.loadConfig();

    // Connect remote servers
    for (const config of storage.remote) {
      try {
        await this.remoteClient.connect(config);
      } catch (err) {
        console.error(`[MCP Coordinator] Failed to connect remote server "${config.name}":`, err);
      }
    }
  }

  /** Called when bridge WebSocket connects */
  onBridgeConnected(ws: WebSocket): void {
    this.bridgeClient.setConnection(ws);
    this.bridgeClient.requestToolsList();

    // Also send bridge configs so the bridge can spawn servers
    this.loadConfig().then(storage => {
      for (const config of storage.bridge) {
        this.bridgeClient.addServer(config);
      }
    });
  }

  /** Called when a message arrives from bridge */
  onBridgeMessage(data: any): void {
    if (
      data.type === "MCP_TOOLS_LIST" ||
      data.type === "MCP_TOOL_RESULT" ||
      data.type === "MCP_SERVER_STATUS" ||
      data.type === "MCP_ERROR"
    ) {
      this.bridgeClient.handleMessage(data);
    }
  }

  /** Called when bridge disconnects */
  onBridgeDisconnected(): void {
    this.bridgeClient.clearConnection();
  }

  /** Add a remote MCP server */
  async addRemoteServer(config: RemoteMcpConfig): Promise<void> {
    const storage = await this.loadConfig();
    storage.remote = storage.remote.filter(s => s.name !== config.name);
    storage.remote.push(config);
    await this.saveConfig(storage);
    await this.remoteClient.connect(config);
  }

  /** Remove a remote MCP server */
  async removeRemoteServer(name: string): Promise<void> {
    const storage = await this.loadConfig();
    storage.remote = storage.remote.filter(s => s.name !== name);
    await this.saveConfig(storage);
    this.remoteClient.disconnect(name);
  }

  /** Add a bridge-managed MCP server */
  async addBridgeServer(config: BridgeMcpConfig): Promise<void> {
    const storage = await this.loadConfig();
    storage.bridge = storage.bridge.filter(s => s.name !== config.name);
    storage.bridge.push(config);
    await this.saveConfig(storage);
    this.bridgeClient.addServer(config);
  }

  /** Remove a bridge-managed MCP server */
  async removeBridgeServer(name: string): Promise<void> {
    const storage = await this.loadConfig();
    storage.bridge = storage.bridge.filter(s => s.name !== name);
    await this.saveConfig(storage);
    this.bridgeClient.removeServer(name);
  }

  /** Reload all MCP connections from config */
  async reload(): Promise<void> {
    this.remoteClient.disconnectAll();
    this.bridgeClient.clearConnection();
    await this.initialize();
  }

  private async loadConfig(): Promise<McpStorage> {
    const result = await chrome.storage.local.get("mcp_servers");
    return result.mcp_servers || defaultMcpStorage();
  }

  private async saveConfig(storage: McpStorage): Promise<void> {
    await chrome.storage.local.set({ mcp_servers: storage });
  }
}
