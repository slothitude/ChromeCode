export interface ParsedToolCall {
  name: string;
  arguments: Record<string, any>;
  raw: string;
}

/**
 * Parse an LLM response for tool call blocks.
 *
 * Pattern 1 (backward compat): ```javascript:cc_live_edit ... ```
 * Pattern 2 (generic tools):   ```tool:tool_name {...} ```
 */
export function parseToolCalls(response: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];

  // Pattern 1: cc_live_edit
  const liveEditRe = /```javascript:cc_live_edit\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = liveEditRe.exec(response)) !== null) {
    calls.push({
      name: "cc_live_edit",
      arguments: { code: match[1].trim() },
      raw: match[0],
    });
  }

  // Pattern 2: generic tool blocks
  const toolRe = /```tool:(\w+)\s*([\s\S]*?)```/gi;
  while ((match = toolRe.exec(response)) !== null) {
    const toolName = match[1];
    // Skip if already captured as cc_live_edit
    if (toolName === "cc_live_edit") continue;

    const body = match[2].trim();
    let args: Record<string, any> = {};
    try {
      if (body) args = JSON.parse(body);
    } catch {
      args = { _raw: body };
    }

    calls.push({
      name: toolName,
      arguments: args,
      raw: match[0],
    });
  }

  return calls;
}
