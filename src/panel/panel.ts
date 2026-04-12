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
    }
  });

  port.onDisconnect.addListener(() => {
    appendStatus("Disconnected. Reconnecting...", "status-error");
    setTimeout(connect, 1000);
  });
}

const messagesDiv = document.getElementById("messages")!;
const promptInput = document.getElementById("prompt-input") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send-btn")!;
const clearBtn = document.getElementById("clear-btn")!;

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

promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});
