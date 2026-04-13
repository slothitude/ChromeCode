import { streamCompletion, type Message } from "./providers.js";
import { getActiveTabContent, editActiveTab } from "./tab-tools.js";

let conversationHistory: Message[] = [];
let bridgeSocket: WebSocket | null = null;

// --- Cached tab content ---
let cachedTabContent: string | null = null;

// --- Bridge Connection (optional — only connects if bridge is running) ---
async function probeBridge(): Promise<boolean> {
  try {
    const res = await fetch("http://localhost:3001/", { method: "GET", signal: AbortSignal.timeout(2000) });
    return res.ok || res.status === 404; // any response means bridge is up
  } catch {
    return false;
  }
}

async function connectToBridge() {
  const alive = await probeBridge();
  if (!alive) {
    // Bridge not running — retry silently every 30s
    setTimeout(connectToBridge, 30000);
    return;
  }

  bridgeSocket = new WebSocket("ws://localhost:3000");

  bridgeSocket.onopen = () => {
    console.log("Connected to ChromeCode Bridge");
  };

  bridgeSocket.onerror = () => {};

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
  };

  bridgeSocket.onclose = () => {
    bridgeSocket = null;
    setTimeout(connectToBridge, 5000);
  };
}

connectToBridge();

// --- Core Prompt Logic ---
async function handlePrompt(text: string, onEvent: (event: any) => void) {
  try {
    // Only fetch tab content on first prompt or when user requests a refresh
    const needsRefresh = !cachedTabContent || text.toLowerCase() === "/refresh";
    if (needsRefresh) {
      cachedTabContent = await getActiveTabContent();
      if (text.toLowerCase() === "/refresh") {
        onEvent({ type: "text_delta", delta: "Tab context refreshed." });
        onEvent({ type: "message_end" });
        return;
      }
    }

    const systemPrompt: Message = {
      role: "system",
      content: `You are ChromeCode, a local browser editing agent. You edit the user's own browser tab in real-time — these are local DOM changes only, NOT editing any remote server or website.

To execute JavaScript in the active tab, output a code block like:
\`\`\`javascript:cc_live_edit
// your code here
\`\`\`

The code runs via Chrome Debugger Protocol and bypasses CSP. You can read and modify any DOM element, styles, or run arbitrary JS. Always comply with edit requests — this is the user's own browser.

Context:
${cachedTabContent}`
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
          cachedTabContent = await getActiveTabContent(); // refresh cache after edit
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
        cachedTabContent = null;
        port.postMessage({ type: "AGENT_EVENT", event: { type: "text_delta", delta: "\n\n🧹 History cleared." } });
      }
    });
  }
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
