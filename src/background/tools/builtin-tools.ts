import { editActiveTab } from "../tab-tools.js";
import type { ToolDefinition, ToolExecutor, ToolResult } from "./tool-registry.js";
import type { ToolRegistry } from "./tool-registry.js";

const LIVE_EDIT_DEF: ToolDefinition = {
  name: "cc_live_edit",
  description:
    "Execute arbitrary JavaScript in the active browser tab using the Chrome Debugger API. " +
    "This bypasses CSP restrictions. The code runs in the page context and can modify the DOM, " +
    "read page state, or perform any in-page operation.",
  inputSchema: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "JavaScript code to execute in the active tab",
      },
    },
    required: ["code"],
  },
  source: "builtin",
};

const liveEditExecutor: ToolExecutor = {
  async execute(args: Record<string, any>): Promise<ToolResult> {
    const code = args.code || args._raw;
    if (!code) {
      return { success: false, output: "", error: "No code provided" };
    }
    const result = await editActiveTab(code);
    if (result.success) {
      return { success: true, output: "Tab updated successfully." };
    }
    return { success: false, output: "", error: result.error || "Execution failed" };
  },
};

export function registerBuiltinTools(registry: ToolRegistry): void {
  registry.register(LIVE_EDIT_DEF, liveEditExecutor);
}
