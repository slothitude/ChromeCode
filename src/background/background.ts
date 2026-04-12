import { streamCompletion, type Message } from "./providers.js";
import { getActiveTabContent } from "./tab-tools.js";
import { ToolRegistry } from "./tools/tool-registry.js";
import { parseToolCalls } from "./tools/tool-parser.js";
import { registerBuiltinTools } from "./tools/builtin-tools.js";

let conversationHistory: Message[] = [];
let bridgeSocket: WebSocket | null = null;

// --- Tool Registry ---
const toolRegistry = new ToolRegistry();
registerBuiltinTools(toolRegistry);

// --- Bridge Connection ---
function connectToBridge() {
  bridgeSocket = new WebSocket("ws://localhost:3000");

  bridgeSocket.onopen = () => {
    console.log("Connected to ChromeCode Bridge");
    // Notify coordinator that bridge is connected (will be wired in phase 3)
    if (typeof window !== "undefined" && (window as any).__mcpCoordinator) {
      (window as any).__mcpCoordinator.onBridgeConnected(bridgeSocket!);
    }
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
    }
    // MCP messages will be handled by bridge-mcp-client (phase 3)
    if (typeof window !== "undefined" && (window as any).__mcpCoordinator) {
      (window as any).__mcpCoordinator.onBridgeMessage(data);
    }
  };

  bridgeSocket.onclose = () => {
    console.log("Bridge disconnected. Retrying in 5s...");
    if (typeof window !== "undefined" && (window as any).__mcpCoordinator) {
      (window as any).__mcpCoordinator.onBridgeDisconnected();
    }
    setTimeout(connectToBridge, 5000);
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
      content: `You are ChromeCode. You can see the active tab and use tools to interact with it.

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
            // Auto-retry for live edit failures (backward compat behavior)
            onEvent({ type: "text_delta", delta: `\n\n❌ ${call.name} Error: ${errText}\nFixing...` });
            await runLoop(`The ${call.name} failed: ${errText}. Fix it.`);
            return; // runLoop was called recursively, stop processing further calls
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

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Export registry for MCP coordinator access (phase 3/4)
export { toolRegistry, bridgeSocket };
