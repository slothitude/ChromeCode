import type { ToolRegistry } from "../tools/tool-registry.js";
import type { ToolExecutor, ToolResult } from "../tools/tool-registry.js";
import type { RemoteMcpConfig } from "./types.js";

/**
 * Connects directly to remote MCP servers from the service worker
 * using browser-native fetch/EventSource for SSE transport.
 *
 * We use a lightweight custom transport rather than the MCP SDK
 * because the SDK's SSEClientTransport depends on Node.js http module.
 */
export class RemoteMcpClient {
  private registry: ToolRegistry;
  private connections = new Map<string, {
    config: RemoteMcpConfig;
    connected: boolean;
    reconnectTimer?: ReturnType<typeof setTimeout>;
  }>();

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  async connect(config: RemoteMcpConfig): Promise<void> {
    // Disconnect existing if reconnecting
    if (this.connections.has(config.name)) {
      this.disconnect(config.name);
    }

    const conn = { config, connected: false };
    this.connections.set(config.name, conn);

    try {
      await this.initialize(config);
      conn.connected = true;
      console.log(`[RemoteMCP] Connected to "${config.name}" at ${config.url}`);
    } catch (err) {
      console.error(`[RemoteMCP] Failed to connect to "${config.name}":`, err);
      this.scheduleReconnect(config.name);
    }
  }

  disconnect(name: string): void {
    const conn = this.connections.get(name);
    if (!conn) return;

    if (conn.reconnectTimer) {
      clearTimeout(conn.reconnectTimer);
    }
    this.connections.delete(name);
    this.registry.unregisterByServer(name);
    console.log(`[RemoteMCP] Disconnected from "${name}"`);
  }

  disconnectAll(): void {
    for (const name of Array.from(this.connections.keys())) {
      this.disconnect(name);
    }
  }

  private async initialize(config: RemoteMcpConfig): Promise<void> {
    // Initialize the MCP session
    const initResponse = await this.sendJsonRpc(config, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "chromecode", version: "0.1.0" },
    });

    // Send initialized notification
    await this.sendNotification(config, "notifications/initialized");

    // List and register tools
    const toolsResponse = await this.sendJsonRpc(config, "tools/list", {});

    if (toolsResponse?.tools) {
      // Remove old tools from this server
      this.registry.unregisterByServer(config.name);

      for (const tool of toolsResponse.tools) {
        this.registry.register(
          {
            name: tool.name,
            description: tool.description || `Remote tool from ${config.name}`,
            inputSchema: tool.inputSchema,
            source: "remote",
            serverName: config.name,
          },
          this.createExecutor(tool.name, config.name, config),
        );
      }
    }
  }

  private createExecutor(toolName: string, serverName: string, config: RemoteMcpConfig): ToolExecutor {
    return {
      execute: async (args: Record<string, any>): Promise<ToolResult> => {
        try {
          const response = await this.sendJsonRpc(config, "tools/call", {
            name: toolName,
            arguments: args,
          });

          if (response?.isError) {
            return { success: false, output: "", error: response.content?.[0]?.text || "Tool error" };
          }

          let output = "";
          if (response?.content) {
            output = response.content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("\n");
          }

          return { success: true, output };
        } catch (err: any) {
          return { success: false, output: "", error: err.message };
        }
      },
    };
  }

  private async sendJsonRpc(config: RemoteMcpConfig, method: string, params: any): Promise<any> {
    const url = config.transport === "sse"
      ? config.url.replace(/\/sse$/, "") + "/message"
      : config.url + (config.url.endsWith("/") ? "message" : "/message");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...config.headers,
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`MCP HTTP ${response.status}: ${await response.text()}`);
    }

    const json = await response.json();
    if (json.error) {
      throw new Error(`MCP error: ${json.error.message || JSON.stringify(json.error)}`);
    }
    return json.result;
  }

  private async sendNotification(config: RemoteMcpConfig, method: string): Promise<void> {
    const url = config.transport === "sse"
      ? config.url.replace(/\/sse$/, "") + "/message"
      : config.url + (config.url.endsWith("/") ? "message" : "/message");

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...config.headers },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params: {},
      }),
    });
  }

  private scheduleReconnect(name: string): void {
    const conn = this.connections.get(name);
    if (!conn) return;

    conn.reconnectTimer = setTimeout(async () => {
      console.log(`[RemoteMCP] Reconnecting to "${name}"...`);
      try {
        await this.initialize(conn.config);
        conn.connected = true;
        console.log(`[RemoteMCP] Reconnected to "${name}"`);
      } catch {
        this.scheduleReconnect(name);
      }
    }, 5000);
  }
}
