import type { ToolRegistry } from "../tools/tool-registry.js";
import type { ToolExecutor, ToolResult } from "../tools/tool-registry.js";
import type { BridgeMcpConfig } from "./types.js";

/**
 * Manages MCP tools that are proxied through the bridge server.
 * The bridge spawns local MCP servers via stdio and proxies tool calls over WebSocket.
 */
export class BridgeMcpClient {
  private registry: ToolRegistry;
  private ws: WebSocket | null = null;
  private pendingCalls = new Map<string, {
    resolve: (result: any) => void;
    reject: (err: Error) => void;
  }>();
  private callCounter = 0;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  /** Set/update the WebSocket connection to the bridge */
  setConnection(ws: WebSocket): void {
    this.ws = ws;
  }

  /** Clear the connection (bridge disconnected) */
  clearConnection(): void {
    this.ws = null;
    // Reject all pending calls
    for (const [id, pending] of this.pendingCalls) {
      pending.reject(new Error("Bridge disconnected"));
    }
    this.pendingCalls.clear();
    // Remove all bridge-sourced tools
    this.registry.unregisterBySource("bridge");
  }

  /** Handle incoming messages from the bridge */
  handleMessage(data: any): void {
    switch (data.type) {
      case "MCP_TOOLS_LIST":
        this.handleToolsList(data.servers);
        break;

      case "MCP_TOOL_RESULT":
        this.handleToolResult(data);
        break;

      case "MCP_SERVER_STATUS":
        if (data.status === "disconnected") {
          this.registry.unregisterByServer(data.name);
        }
        break;
    }
  }

  private handleToolsList(servers: Array<{ serverName: string; tools: Array<any> }>): void {
    // Remove existing bridge tools first
    this.registry.unregisterBySource("bridge");

    for (const server of servers) {
      for (const tool of server.tools) {
        this.registry.register(
          {
            name: tool.name,
            description: tool.description || `Tool from ${server.serverName}`,
            inputSchema: tool.inputSchema,
            source: "bridge",
            serverName: server.serverName,
          },
          this.createExecutor(tool.name, server.serverName),
        );
      }
    }
  }

  private createExecutor(toolName: string, serverName: string): ToolExecutor {
    return {
      execute: async (args: Record<string, any>): Promise<ToolResult> => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          return { success: false, output: "", error: "Bridge not connected" };
        }

        const callId = `bridge_${++this.callCounter}`;

        return new Promise<ToolResult>((resolve, reject) => {
          const timeout = setTimeout(() => {
            this.pendingCalls.delete(callId);
            resolve({ success: false, output: "", error: "Tool call timed out" });
          }, 30000);

          this.pendingCalls.set(callId, {
            resolve: (result) => {
              clearTimeout(timeout);
              this.pendingCalls.delete(callId);

              if (result.error) {
                resolve({ success: false, output: "", error: result.error });
              } else {
                // Extract text content from MCP result
                const content = result.content;
                let output = "";
                if (Array.isArray(content)) {
                  output = content
                    .filter((c: any) => c.type === "text")
                    .map((c: any) => c.text)
                    .join("\n");
                } else if (typeof content === "string") {
                  output = content;
                } else {
                  output = JSON.stringify(content);
                }
                resolve({ success: true, output });
              }
            },
            reject: (err) => {
              clearTimeout(timeout);
              this.pendingCalls.delete(callId);
              resolve({ success: false, output: "", error: err.message });
            },
          });

          this.ws!.send(JSON.stringify({
            type: "MCP_CALL_TOOL",
            callId,
            serverName,
            toolName,
            args,
          }));
        });
      },
    };
  }

  private handleToolResult(data: any): void {
    const pending = this.pendingCalls.get(data.callId);
    if (pending) {
      pending.resolve(data.result);
    }
  }

  /** Request the bridge to add a new MCP server */
  addServer(config: BridgeMcpConfig): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "MCP_ADD_SERVER", config }));
    }
  }

  /** Request the bridge to remove an MCP server */
  removeServer(name: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "MCP_REMOVE_SERVER", name }));
    }
  }

  /** Request current tool list from bridge */
  requestToolsList(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "MCP_LIST_TOOLS" }));
    }
  }
}
