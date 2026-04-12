import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface ManagedServer {
  config: McpServerConfig;
  client: Client;
  transport: StdioClientTransport;
  tools: Tool[];
}

export class McpManager {
  private servers = new Map<string, ManagedServer>();
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(process.cwd(), "mcp-servers.json");
  }

  async addServer(config: McpServerConfig): Promise<Tool[]> {
    if (this.servers.has(config.name)) {
      await this.removeServer(config.name);
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env ? { ...process.env, ...config.env } : undefined,
    });

    const client = new Client(
      { name: "chromecode-bridge", version: "0.1.0" },
      { capabilities: {} }
    );

    await client.connect(transport);

    const toolsResult = await client.listTools();
    const tools = toolsResult.tools;

    this.servers.set(config.name, { config, client, transport, tools });
    await this.saveConfig();

    console.log(`[MCP] Server "${config.name}" connected with ${tools.length} tools: ${tools.map(t => t.name).join(", ")}`);
    return tools;
  }

  async removeServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) return;

    try {
      await server.client.close();
    } catch {
      // ignore close errors
    }

    this.servers.delete(name);
    await this.saveConfig();
    console.log(`[MCP] Server "${name}" removed`);
  }

  async callTool(serverName: string, toolName: string, args: Record<string, any>): Promise<any> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`MCP server "${serverName}" not found`);
    }

    const result = await server.client.callTool({ name: toolName, arguments: args });
    return result;
  }

  listTools(): Array<{ serverName: string; tools: Tool[] }> {
    const result: Array<{ serverName: string; tools: Tool[] }> = [];
    for (const [name, server] of this.servers) {
      result.push({ serverName: name, tools: server.tools });
    }
    return result;
  }

  getServerNames(): string[] {
    return Array.from(this.servers.keys());
  }

  async shutdown(): Promise<void> {
    for (const [name] of this.servers) {
      await this.removeServer(name);
    }
  }

  async loadSavedServers(): Promise<void> {
    if (!fs.existsSync(this.configPath)) return;

    try {
      const configs: McpServerConfig[] = JSON.parse(fs.readFileSync(this.configPath, "utf-8"));
      for (const config of configs) {
        try {
          await this.addServer(config);
        } catch (err) {
          console.error(`[MCP] Failed to connect to "${config.name}":`, err);
        }
      }
    } catch (err) {
      console.error("[MCP] Failed to load config:", err);
    }
  }

  private async saveConfig(): Promise<void> {
    const configs = Array.from(this.servers.values()).map(s => s.config);
    fs.writeFileSync(this.configPath, JSON.stringify(configs, null, 2));
  }
}
