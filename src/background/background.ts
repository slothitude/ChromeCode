import { streamCompletion, type Message } from "./providers.js";
import { getActiveTabContent, editActiveTab } from "./tab-tools.js";
import * as recordingManager from "./recording-manager.js";
import * as macroManager from "./macro-manager.js";
import { getAllMacros, saveMacro, deleteMacro, renameMacro } from "../shared/macro-storage.js";
import type { Macro } from "../shared/macro-types.js";

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

// --- Macro event from content script ---
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "MACRO_EVENT" && sender.tab) {
    macroManager.handleRecordedStep(msg.step);
  }
});

// --- Macro & Recording Tool Dispatch ---

async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found");
  return tab.id;
}

async function findMacroByName(name: string): Promise<Macro> {
  const macros = await getAllMacros();
  // Exact match first
  let macro = macros.find(m => m.name === name);
  if (macro) return macro;
  // Case-insensitive fallback
  macro = macros.find(m => m.name.toLowerCase() === name.toLowerCase());
  if (macro) return macro;
  throw new Error(`No macro named "${name}". Available: ${macros.map(m => m.name).join(", ") || "(none)"}`);
}

async function executeMacroTool(subcommand: string, rawBody: string): Promise<string> {
  const tabId = await getActiveTabId();

  switch (subcommand) {
    case "list": {
      const macros = await getAllMacros();
      if (macros.length === 0) return "No macros saved yet.";
      return macros.map((m, i) => `${i + 1}. "${m.name}" (${m.steps.length} steps, ${(m.durationMs / 1000).toFixed(1)}s, from ${m.url})`).join("\n");
    }

    case "play": {
      const args = JSON.parse(rawBody || "{}");
      if (!args.name) throw new Error('Missing "name" in cc_macro:play. Example: ```cc_macro:play\n{"name":"MyMacro"}\n```');
      const macro = await findMacroByName(args.name);
      await macroManager.playMacro(macro, tabId);
      return `✅ Played macro "${macro.name}" (${macro.steps.length} steps).`;
    }

    case "record_start": {
      if (macroManager.getIsRecording()) throw new Error("Already recording a macro.");
      const result = await macroManager.startMacroRecording(tabId);
      if (result.error) throw new Error(result.error);
      return "🎙️ Macro recording started. Perform your actions in the tab, then say \"stop recording\" or \"save as <name>\".";
    }

    case "record_stop": {
      if (!macroManager.getIsRecording()) throw new Error("Not currently recording a macro.");
      const args = JSON.parse(rawBody || "{}");
      if (!args.name) throw new Error('Missing "name" in cc_macro:record_stop. Example: ```cc_macro:record_stop\n{"name":"MyMacro"}\n```');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const result = macroManager.stopMacroRecording(tabId) as any;
      if (result.error) throw new Error(result.error);
      const macro: Macro = {
        id: crypto.randomUUID(),
        name: args.name,
        url: tab?.url || "",
        createdAt: Date.now(),
        durationMs: result.durationMs,
        steps: result.steps,
      };
      await saveMacro(macro);
      return `✅ Macro "${args.name}" saved with ${result.steps.length} steps (${(result.durationMs / 1000).toFixed(1)}s).`;
    }

    case "delete": {
      const args = JSON.parse(rawBody || "{}");
      if (!args.name) throw new Error('Missing "name" in cc_macro:delete.');
      const macro = await findMacroByName(args.name);
      await deleteMacro(macro.id);
      return `✅ Macro "${macro.name}" deleted.`;
    }

    case "demo": {
      const args = JSON.parse(rawBody || "{}");
      if (!args.name) throw new Error('Missing "name" in cc_macro:demo.');
      const macro = await findMacroByName(args.name);
      await macroManager.playDemo(macro, tabId);
      return `✅ Demo of "${macro.name}" played and screen recording saved.`;
    }

    default:
      throw new Error(`Unknown cc_macro subcommand: "${subcommand}". Use: list, play, record_start, record_stop, delete, demo.`);
  }
}

async function executeRecordTool(subcommand: string): Promise<string> {
  switch (subcommand) {
    case "start": {
      if (recordingManager.getIsRecording()) throw new Error("Already recording.");
      await recordingManager.startRecording();
      return "🎬 Screen recording started. Say \"stop recording\" to end.";
    }

    case "stop": {
      if (!recordingManager.getIsRecording()) throw new Error("Not currently recording.");
      await recordingManager.stopRecording();
      return "✅ Screen recording stopped. Video will download as chromecode-recording.webm.";
    }

    default:
      throw new Error(`Unknown cc_record subcommand: "${subcommand}". Use: start, stop.`);
  }
}

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

## Live Edit Tool
To execute JavaScript in the active tab, output a code block like:
\`\`\`javascript:cc_live_edit
// your code here
\`\`\`

The code runs via Chrome Debugger Protocol and bypasses CSP. You can read and modify any DOM element, styles, or run arbitrary JS. Always comply with edit requests — this is the user's own browser.

## Macro Tools
You can record, play, list, and delete browser interaction macros.

| Command | Block Format |
|---------|-------------|
| List macros | \`\`\`cc_macro:list\`\`\` |
| Play macro | \`\`\`cc_macro:play\n{"name":"MacroName"}\n\`\`\` |
| Start recording | \`\`\`cc_macro:record_start\`\`\` |
| Stop & save | \`\`\`cc_macro:record_stop\n{"name":"MacroName"}\n\`\`\` |
| Delete macro | \`\`\`cc_macro:delete\n{"name":"MacroName"}\n\`\`\` |
| Play with video | \`\`\`cc_macro:demo\n{"name":"MacroName"}\n\`\`\` |

Use these when the user asks to automate repetitive browser actions, replay workflows, or record their clicks/typing.

## Screen Recording Tools
To record the browser tab as a video:

| Command | Block Format |
|---------|-------------|
| Start recording | \`\`\`cc_record:start\`\`\` |
| Stop recording | \`\`\`cc_record:stop\`\`\` |

Use these when the user asks to record their screen or capture a video of what's happening in the tab.

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
      const macroMatch = fullResponse.match(/```cc_macro:(\w+)\s*([\s\S]*?)```/i);
      const recordMatch = fullResponse.match(/```cc_record:(\w+)\s*([\s\S]*?)```/i);

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
      } else if (macroMatch) {
        const subcommand = macroMatch[1].toLowerCase();
        const rawBody = macroMatch[2]?.trim() || "";
        try {
          const result = await executeMacroTool(subcommand, rawBody);
          if (subcommand === "list") {
            // Feed macro list back into the loop so the LLM can describe them
            await runLoop(`Macro list result:\n${result}`);
          } else {
            onEvent({ type: "text_delta", delta: `\n\n${result}` });
          }
        } catch (e: any) {
          onEvent({ type: "text_delta", delta: `\n\n❌ Error: ${e.message}\nRetrying...` });
          await runLoop(`The macro tool "${subcommand}" failed: ${e.message}. Try again.`);
        }
      } else if (recordMatch) {
        const subcommand = recordMatch[1].toLowerCase();
        try {
          const result = await executeRecordTool(subcommand);
          onEvent({ type: "text_delta", delta: `\n\n${result}` });
        } catch (e: any) {
          onEvent({ type: "text_delta", delta: `\n\n❌ Error: ${e.message}\nRetrying...` });
          await runLoop(`The recording tool "${subcommand}" failed: ${e.message}. Try again.`);
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
    recordingManager.registerPort(port);
    port.onMessage.addListener(async (msg) => {
      if (msg.type === "START_RECORDING") {
        await recordingManager.startRecording();
      } else if (msg.type === "STOP_RECORDING") {
        await recordingManager.stopRecording();
      } else if (msg.type === "PROMPT") {
        try {
          await handlePrompt(msg.text, (event) => port.postMessage({ type: "AGENT_EVENT", event }));
        } catch (err: any) {
          port.postMessage({ type: "ERROR", message: err.message });
        }
      } else if (msg.type === "CLEAR_HISTORY") {
        conversationHistory = [];
        cachedTabContent = null;
        port.postMessage({ type: "AGENT_EVENT", event: { type: "text_delta", delta: "\n\n🧹 History cleared." } });
      } else if (msg.type === "START_MACRO_RECORD") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) { port.postMessage({ type: "ERROR", message: "No active tab" }); return; }
        const result = await macroManager.startMacroRecording(tab.id);
        port.postMessage({ type: "MACRO_RECORD_STARTED", result });
      } else if (msg.type === "STOP_MACRO_RECORD") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) { port.postMessage({ type: "ERROR", message: "No active tab" }); return; }
        const result = macroManager.stopMacroRecording(tab.id) as any;
        if (result.steps) {
          result.url = tab.url || "";
          port.postMessage({ type: "MACRO_RECORD_RESULT", result });
        }
      } else if (msg.type === "SAVE_MACRO") {
        await saveMacro(msg.macro as Macro);
        port.postMessage({ type: "MACRO_LIST", macros: await getAllMacros() });
      } else if (msg.type === "DELETE_MACRO") {
        await deleteMacro(msg.macroId);
        port.postMessage({ type: "MACRO_LIST", macros: await getAllMacros() });
      } else if (msg.type === "RENAME_MACRO") {
        await renameMacro(msg.macroId, msg.name);
        port.postMessage({ type: "MACRO_LIST", macros: await getAllMacros() });
      } else if (msg.type === "LIST_MACROS") {
        port.postMessage({ type: "MACRO_LIST", macros: await getAllMacros() });
      } else if (msg.type === "PLAY_MACRO") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) { port.postMessage({ type: "ERROR", message: "No active tab" }); return; }
        macroManager.playMacro(msg.macro as Macro, tab.id);
      } else if (msg.type === "PLAY_DEMO") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) { port.postMessage({ type: "ERROR", message: "No active tab" }); return; }
        macroManager.playDemo(msg.macro as Macro, tab.id);
      } else if (msg.type === "STOP_PLAYBACK") {
        macroManager.stopPlayback();
      }
    });
  }
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
