import { streamCompletion, type Message } from "./providers.js";
import { getActiveTabContent } from "./tab-tools.js";
import { ToolRegistry } from "./tools/tool-registry.js";
import { parseToolCalls } from "./tools/tool-parser.js";
import { registerBuiltinTools } from "./tools/builtin-tools.js";
import { McpCoordinator } from "./mcp/mcp-coordinator.js";

let conversationHistory: Message[] = [];
let bridgeSocket: WebSocket | null = null;

// --- Tool Registry ---
const toolRegistry = new ToolRegistry();
registerBuiltinTools(toolRegistry);

// --- MCP Coordinator ---
const mcpCoordinator = new McpCoordinator(toolRegistry);
mcpCoordinator.initialize().catch(err => console.error("[MCP] Init failed:", err));

// --- Bridge Connection (optional, silent when bridge isn't running) ---
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
  // Probe HTTP health endpoint first — avoids browser-level WebSocket error logging
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
    // Route MCP messages to coordinator
    mcpCoordinator.onBridgeMessage(data);
  };

  bridgeSocket.onclose = () => {
    mcpCoordinator.onBridgeDisconnected();
    setTimeout(connectToBridge, bridgeRetryDelay);
    bridgeRetryDelay = Math.min(bridgeRetryDelay * 1.5, BRIDGE_MAX_DELAY);
  };
}

connectToBridge();

// --- Core Prompt Logic ---
async function handlePrompt(text: string, onEvent: (event: any) => void) {
  try {
    const tabContent = await getActiveTabContent();
    const toolPrompt = toolRegistry.formatToolsForPrompt();

    const systemPrompt: Message = {
      role: "system",
      content: `You are ChromeCode. You can see the active tab and perform Live Edits using:
\`\`\`javascript:cc_live_edit
// code
\`\`\`
${toolPrompt}
Context:
${tabContent}`,
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

      // Parse and execute tool calls
      const toolCalls = parseToolCalls(fullResponse);
      for (const call of toolCalls) {
        const registered = toolRegistry.get(call.name);
        if (!registered) {
          const errMsg = `\n\n⚠️ Unknown tool: ${call.name}`;
          onEvent({ type: "text_delta", delta: errMsg });
          continue;
        }

        const result = await registered.executor.execute(call.arguments);
        if (result.success) {
          const successMsg = `\n\n✅ ${call.name}: ${result.output}`;
          onEvent({ type: "text_delta", delta: successMsg });
        } else {
          const errText = result.error || "Unknown error";
          if (call.name === "cc_live_edit") {
            onEvent({ type: "text_delta", delta: `\n\n❌ ${call.name} Error: ${errText}\nFixing...` });
            await runLoop(`The ${call.name} failed: ${errText}. Fix it.`);
            return;
          }
          onEvent({ type: "text_delta", delta: `\n\n❌ ${call.name} Error: ${errText}` });
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

// Export for testing/debugging
export { toolRegistry, mcpCoordinator };
