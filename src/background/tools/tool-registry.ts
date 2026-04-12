export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema?: Record<string, any>;
  /** 'builtin' | 'bridge' | 'remote' */
  source: string;
  /** Name of the MCP server that provided this tool (if applicable) */
  serverName?: string;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface ToolExecutor {
  execute(args: Record<string, any>): Promise<ToolResult>;
}

interface RegisteredTool {
  definition: ToolDefinition;
  executor: ToolExecutor;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(definition: ToolDefinition, executor: ToolExecutor): void {
    this.tools.set(definition.name, { definition, executor });
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  unregisterBySource(source: string): void {
    for (const [name, tool] of this.tools) {
      if (tool.definition.source === source) {
        this.tools.delete(name);
      }
    }
  }

  unregisterByServer(serverName: string): void {
    for (const [name, tool] of this.tools) {
      if (tool.definition.serverName === serverName) {
        this.tools.delete(name);
      }
    }
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  formatToolsForPrompt(): string {
    const tools = this.getAll();
    if (tools.length === 0) return "No tools available.";

    let prompt = "You have access to the following tools:\n\n";

    for (const tool of tools) {
      if (tool.name === "cc_live_edit") {
        prompt += `### cc_live_edit (Live Edit)\n${tool.description}\nUsage:\n\`\`\`javascript:cc_live_edit\n// JavaScript code to execute in the active tab\n\`\`\`\n\n`;
      } else {
        prompt += `### ${tool.name}\n${tool.description}\n`;
        if (tool.inputSchema?.properties) {
          const props = tool.inputSchema.properties;
          const example: Record<string, any> = {};
          for (const [key, schema] of Object.entries(props)) {
            if ((schema as any).example !== undefined) {
              example[key] = (schema as any).example;
            } else if ((schema as any).type === "string") {
              example[key] = "";
            } else if ((schema as any).type === "number") {
              example[key] = 0;
            } else if ((schema as any).type === "boolean") {
              example[key] = false;
            }
          }
          prompt += `Usage:\n\`\`\`tool:${tool.name}\n${JSON.stringify(example)}\n\`\`\`\n\n`;
        } else {
          prompt += `Usage:\n\`\`\`tool:${tool.name}\n{}\n\`\`\`\n\n`;
        }
      }
    }

    return prompt;
  }
}
