let port: chrome.runtime.Port;

function connect() {
  port = chrome.runtime.connect({ name: "chromecode-panel" });

  port.onMessage.addListener((msg) => {
    if (msg.type === "AGENT_EVENT") {
      const event = msg.event;
      if (event.type === "text_delta") {
        if (!currentAssistantMsg) {
          currentAssistantMsg = appendMessage("assistant", "");
        }
        currentAssistantMsg.textContent += event.delta;
      } else if (event.type === "message_end") {
        currentAssistantMsg = null;
      }
    } else if (msg.type === "ERROR") {
      appendStatus("Error: " + msg.message, "status-error");
    } else if (msg.type === "RECORDING_STATUS") {
      recordBtn.classList.toggle("recording", msg.recording);
      if (msg.recording) {
        appendStatus("Recording started...", "status-success");
      } else {
        appendStatus("Recording saved.", "status-success");
      }
    } else if (msg.type === "MACRO_STATUS") {
      const el = document.getElementById("macro-record-status")!;
      const countEl = document.getElementById("macro-step-count")!;
      if (msg.recording) {
        el.classList.remove("hidden");
        countEl.textContent = msg.steps + " steps";
        macroRecordBtn.classList.add("recording");
      } else {
        el.classList.add("hidden");
        macroRecordBtn.classList.remove("recording");
      }
    } else if (msg.type === "MACRO_RECORD_STARTED") {
      if (msg.result?.success) {
        const el = document.getElementById("macro-record-status")!;
        el.classList.remove("hidden");
        macroRecordBtn.classList.add("recording");
        appendStatus("Macro recording started", "status-success");
      } else {
        appendStatus("Macro record error: " + (msg.result?.error || "unknown"), "status-error");
      }
    } else if (msg.type === "MACRO_RECORD_RESULT") {
      const result = msg;
      const name = prompt("Name this macro:", "My Macro");
      if (name) {
        const macro = {
          id: "macro_" + Date.now(),
          name,
          url: result.url || "",
          createdAt: Date.now(),
          durationMs: result.durationMs,
          steps: result.steps,
        };
        port.postMessage({ type: "SAVE_MACRO", macro });
        appendStatus("Macro saved: " + name, "status-success");
      }
    } else if (msg.type === "MACRO_LIST") {
      renderMacroList(msg.macros);
    } else if (msg.type === "MACRO_PLAYBACK_PROGRESS") {
      appendStatus("Playback " + msg.current + "/" + msg.total, "status-success");
    } else if (msg.type === "MACRO_PLAYBACK_DONE") {
      appendStatus("Playback complete", "status-success");
    }
  });

  port.onDisconnect.addListener(() => {
    // Silently reconnect — don't spam chat
    setTimeout(connect, 1000);
  });
}

// Keepalive ping every 25s to prevent Chrome from killing the service worker
setInterval(() => {
  try { port.postMessage({ type: "PING" }); } catch { /* port dead, reconnect will handle it */ }
}, 25000);

const messagesDiv = document.getElementById("messages")!;
const promptInput = document.getElementById("prompt-input") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send-btn")!;
const clearBtn = document.getElementById("clear-btn")!;
const recordBtn = document.getElementById("record-btn")! as HTMLButtonElement;
const macroRecordBtn = document.getElementById("macro-record-btn")! as HTMLButtonElement;
const workflowToggle = document.getElementById("workflow-toggle")!;
const workflowSection = document.getElementById("workflow-section")!;
const macroListEl = document.getElementById("macro-list")!;

function appendMessage(role: "user" | "assistant", text: string) {
  const div = document.createElement("div");
  div.className = `message ${role}`;
  div.textContent = text;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  return div;
}

function appendStatus(text: string, className: string) {
  const div = document.createElement("div");
  div.className = `status-msg ${className}`;
  div.textContent = text;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

let currentAssistantMsg: HTMLDivElement | null = null;

connect();

sendBtn.addEventListener("click", () => {
  const text = promptInput.value.trim();
  if (text) {
    appendMessage("user", text);
    try {
      port.postMessage({ type: "PROMPT", text });
    } catch (e) {
      connect();
      setTimeout(() => port.postMessage({ type: "PROMPT", text }), 100);
    }
    promptInput.value = "";
  }
});

clearBtn.addEventListener("click", () => {
  messagesDiv.innerHTML = "";
  port.postMessage({ type: "CLEAR_HISTORY" });
});

recordBtn.addEventListener("click", () => {
  const recording = recordBtn.classList.contains("recording");
  if (recording) {
    port.postMessage({ type: "STOP_RECORDING" });
  } else {
    port.postMessage({ type: "START_RECORDING" });
  }
});

// --- Workflow section ---
workflowToggle.addEventListener("click", () => {
  workflowSection.classList.toggle("collapsed");
  if (!workflowSection.classList.contains("collapsed")) {
    port.postMessage({ type: "LIST_MACROS" });
  }
});

macroRecordBtn.addEventListener("click", () => {
  if (macroRecordBtn.classList.contains("recording")) {
    port.postMessage({ type: "STOP_MACRO_RECORD" });
  } else {
    port.postMessage({ type: "START_MACRO_RECORD" });
  }
});

function renderMacroList(macros: any[]) {
  macroListEl.innerHTML = "";
  for (const macro of macros) {
    macroListEl.appendChild(renderMacroItem(macro));
  }
}

function renderMacroItem(macro: any): HTMLElement {
  const div = document.createElement("div");
  div.className = "macro-item";

  const nameSpan = document.createElement("span");
  nameSpan.className = "macro-name";
  nameSpan.textContent = macro.name;

  const metaSpan = document.createElement("span");
  metaSpan.className = "macro-meta";
  const secs = Math.round(macro.durationMs / 1000);
  metaSpan.textContent = secs + "s / " + macro.steps.length + " steps";

  const playBtn = document.createElement("button");
  playBtn.textContent = "\u25B6";
  playBtn.title = "Play";
  playBtn.addEventListener("click", () => {
    port.postMessage({ type: "PLAY_MACRO", macro });
  });

  const demoBtn = document.createElement("button");
  demoBtn.textContent = "\uD83C\uDFA5";
  demoBtn.title = "Record demo video";
  demoBtn.addEventListener("click", () => {
    port.postMessage({ type: "PLAY_DEMO", macro });
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "\u2715";
  deleteBtn.title = "Delete";
  deleteBtn.addEventListener("click", () => {
    if (confirm("Delete macro \"" + macro.name + "\"?")) {
      port.postMessage({ type: "DELETE_MACRO", macroId: macro.id });
    }
  });

  div.appendChild(nameSpan);
  div.appendChild(metaSpan);
  div.appendChild(playBtn);
  div.appendChild(demoBtn);
  div.appendChild(deleteBtn);
  return div;
}

promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});
