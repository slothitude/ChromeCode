import { streamCompletion, type Message } from "./providers.js";
import { getActiveTabContent, editActiveTab } from "./tab-tools.js";
import { ToolRegistry } from "./tools/tool-registry.js";
import { parseToolCalls } from "./tools/tool-parser.js";
import { registerBuiltinTools } from "./tools/builtin-tools.js";
import { McpCoordinator } from "./mcp/mcp-coordinator.js";

let conversationHistory: Message[] = [];
let bridgeSocket: WebSocket | null = null;

// --- Tool Registry (for MCP tools) ---
const toolRegistry = new ToolRegistry();
registerBuiltinTools(toolRegistry);

// --- MCP Coordinator ---
const mcpCoordinator = new McpCoordinator(toolRegistry);
mcpCoordinator.initialize().catch(err => console.error("[MCP] Init failed:", err));

// --- Bridge Connection ---
let bridgeRetryDelay = 5000;
const BRIDGE_MIN_DELAY = 5000;
const BRIDGE_MAX_DELAY = 60000;

async function probeBridge(): Promise<boolean> {
  try {
    const res = await fetch("http://localhost:3001/health", { method: "GET", signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function connectToBridge() {
  const alive = await probeBridge();
  if (!alive) {
    setTimeout(connectToBridge, bridgeRetryDelay);
    bridgeRetryDelay = Math.min(bridgeRetryDelay * 1.5, BRIDGE_MAX_DELAY);
    return;
  }

  bridgeSocket = new WebSocket("ws://localhost:3000");

  bridgeSocket.onopen = () => {
    bridgeRetryDelay = BRIDGE_MIN_DELAY;
    console.log("Connected to ChromeCode Bridge");
    mcpCoordinator.onBridgeConnected(bridgeSocket!);
  };

  bridgeSocket.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "REMOTE_PROMPT") {
      console.log("Received remote prompt:", data.text);
      await handlePrompt(data.text, (agentEvent) => {
        if (bridgeSocket?.readyState === WebSocket.OPEN) {
          bridgeSocket.send(JSON.stringify({ type: "AGENT_EVENT", event: agentEvent }));
        }
      });
      return;
    }
    mcpCoordinator.onBridgeMessage(data);
  };

  bridgeSocket.onclose = () => {
    mcpCoordinator.onBridgeDisconnected();
    setTimeout(connectToBridge, bridgeRetryDelay);
    bridgeRetryDelay = Math.min(bridgeRetryDelay * 1.5, BRIDGE_MAX_DELAY);
  };
}

connectToBridge();

// --- Core Prompt Logic (preserved from original) ---
async function handlePrompt(text: string, onEvent: (event: any) => void) {
  try {
    const tabContent = await getActiveTabContent();
    const systemPrompt: Message = {
      role: "system",
      content: `You are ChromeCode, a browser automation agent. You execute JavaScript in the active tab.

When the user asks you to do something, you MUST respond with a JavaScript code block using EXACTLY this format:

\`\`\`javascript:cc_live_edit
// your code here
\`\`\`

For example, to navigate to a URL:
\`\`\`javascript:cc_live_edit
window.location.href = "https://en.wikipedia.org";
\`\`\`

To click a button:
\`\`\`javascript:cc_live_edit
document.querySelector("#myButton").click();
\`\`\`

To fill and submit a form:
\`\`\`javascript:cc_live_edit
document.querySelector("#search").value = "hello";
document.querySelector("form").submit();
\`\`\`

NEVER say you cannot browse the web. You CAN navigate and interact with pages by writing JavaScript.
ALWAYS respond with a \`\`\`javascript:cc_live_edit block.

Context:
${tabContent}`
    };

    const runLoop = async (input: string) => {
      conversationHistory.push({ role: "user", content: input });
      const messages = [systemPrompt, ...conversationHistory];

      let fullResponse = "";
      await streamCompletion(messages, (chunk) => {
        fullResponse += chunk;
        onEvent({ type: "text_delta", delta: chunk });
      });

      conversationHistory.push({ role: "assistant", content: fullResponse });

      // --- Original cc_live_edit handling (unchanged) ---
      const editMatch = fullResponse.match(/```javascript:cc_live_edit\s*([\s\S]*?)```/i);
      if (editMatch && editMatch[1]) {
        const result = await editActiveTab(editMatch[1].trim());
        if (result.success) {
          const successMsg = "\n\n✅ Success: Tab updated.";
          onEvent({ type: "text_delta", delta: successMsg });
        } else {
          onEvent({ type: "text_delta", delta: `\n\n❌ Error: ${result.error}\nFixing...` });
          await runLoop(`The edit failed: ${result.error}. Fix it.`);
          return;
        }
      }

      // --- MCP tool handling (new, only fires for ```tool:xxx``` blocks) ---
      const toolCalls = parseToolCalls(fullResponse).filter(c => c.name !== "cc_live_edit");
      for (const call of toolCalls) {
        const registered = toolRegistry.get(call.name);
        if (!registered) {
          onEvent({ type: "text_delta", delta: `\n\n⚠️ Unknown tool: ${call.name}` });
          continue;
        }
        const result = await registered.executor.execute(call.arguments);
        if (result.success) {
          onEvent({ type: "text_delta", delta: `\n\n✅ ${call.name}: ${result.output}` });
        } else {
          onEvent({ type: "text_delta", delta: `\n\n❌ ${call.name}: ${result.error}` });
        }
      }
    };

    await runLoop(text);
    onEvent({ type: "message_end" });

  } catch (err: any) {
    console.error(err);
    if (bridgeSocket?.readyState === WebSocket.OPEN) {
      bridgeSocket.send(JSON.stringify({ type: "ERROR", message: err.message }));
    }
  }
}

// --- Side Panel Connection ---
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "chromecode-panel") {
    port.onMessage.addListener(async (msg) => {
      if (msg.type === "PROMPT") {
        await handlePrompt(msg.text, (event) => port.postMessage({ type: "AGENT_EVENT", event }));
      } else if (msg.type === "CLEAR_HISTORY") {
        conversationHistory = [];
        port.postMessage({ type: "AGENT_EVENT", event: { type: "text_delta", delta: "\n\n🧹 History cleared." } });
      }
    });
  }
});

// --- Handle MCP config reload messages from options page ---
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "MCP_RELOAD") {
    mcpCoordinator.reload().catch(err => console.error("[MCP] Reload failed:", err));
  }
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
