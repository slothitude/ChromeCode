import { streamCompletion, type Message } from "./providers.js";
import { getActiveTabContent, editActiveTab } from "./tab-tools.js";
import { ToolRegistry } from "./tools/tool-registry.js";
import { parseToolCalls } from "./tools/tool-parser.js";
import { registerBuiltinTools } from "./tools/builtin-tools.js";
import { McpCoordinator } from "./mcp/mcp-coordinator.js";

let conversationHistory: Message[] = [];
let bridgeSocket: WebSocket | null = null;

// --- MCP (additive, doesn't affect existing logic) ---
const toolRegistry = new ToolRegistry();
registerBuiltinTools(toolRegistry);
const mcpCoordinator = new McpCoordinator(toolRegistry);
mcpCoordinator.initialize().catch(err => console.error("[MCP] Init failed:", err));

// --- Bridge Connection ---
let bridgeRetryDelay = 5000;
const BRIDGE_MAX_DELAY = 60000;

async function probeBridge(): Promise<boolean> {
  try {
    const res = await fetch("http://localhost:3001/health", { method: "GET", signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch { return false; }
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
    bridgeRetryDelay = 5000;
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

// --- Core Prompt Logic (ORIGINAL, UNCHANGED) ---
async function handlePrompt(text: string, onEvent: (event: any) => void) {
  try {
    const tabContent = await getActiveTabContent();
    const systemPrompt: Message = {
      role: "system",
      content: `You are ChromeCode. You can see the active tab and perform Live Edits using:
\`\`\`javascript:cc_live_edit
// code
\`\`\`

For example, to navigate to a URL:
\`\`\`javascript:cc_live_edit
window.location.href = "https://example.com";
\`\`\`

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

      const editMatch = fullResponse.match(/```javascript:cc_live_edit\s*([\s\S]*?)```/i);
      if (editMatch && editMatch[1]) {
        const result = await editActiveTab(editMatch[1].trim());
        if (result.success) {
          const successMsg = "\n\n✅ Success: Tab updated.";
          onEvent({ type: "text_delta", delta: successMsg });
        } else {
          onEvent({ type: "text_delta", delta: `\n\n❌ Error: ${result.error}\nFixing...` });
          await runLoop(`The edit failed: ${result.error}. Fix it.`);
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
        try {
          await handlePrompt(msg.text, (event) => port.postMessage({ type: "AGENT_EVENT", event }));
        } catch (err: any) {
          port.postMessage({ type: "ERROR", message: err.message });
        }
      } else if (msg.type === "CLEAR_HISTORY") {
        conversationHistory = [];
        port.postMessage({ type: "AGENT_EVENT", event: { type: "text_delta", delta: "\n\n🧹 History cleared." } });
      }
    });
  }
});

// --- MCP reload from options page ---
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "MCP_RELOAD") {
    mcpCoordinator.reload().catch(err => console.error("[MCP] Reload failed:", err));
  }
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
