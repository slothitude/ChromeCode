let isRecording = false;
let captureInterval: ReturnType<typeof setInterval> | null = null;

async function ensureOffscreenDocument() {
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen/offscreen.html",
      reasons: ["USER_MEDIA" as chrome.offscreen.Reason],
      justification: "Tab recording via MediaRecorder",
    });
  } catch (e: any) {
    // "Only a single offscreen document may be created" — that's fine
    if (!e.message?.includes("single")) throw e;
  }
}

export async function startRecording() {
  if (isRecording) return;
  isRecording = true;

  await ensureOffscreenDocument();
  await chrome.runtime.sendMessage({ action: "start-recording" });

  captureInterval = setInterval(async () => {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab({
        format: "jpeg",
        quality: 85,
      });
      chrome.runtime.sendMessage({ action: "frame", dataUrl });
    } catch {
      // Tab may have been navigated or closed during capture — skip frame
    }
  }, 33); // ~30fps

  broadcastStatus(true);
}

export async function stopRecording() {
  if (!isRecording) return;
  isRecording = false;

  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
  }

  await chrome.runtime.sendMessage({ action: "stop-recording" });
  broadcastStatus(false);
}

export function getIsRecording() {
  return isRecording;
}

// Listen for the blob URL from offscreen doc after finalization
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "recording-complete") {
    chrome.downloads.download({
      url: msg.url,
      filename: "chromecode-recording.webm",
    });
    broadcastStatus(false);
  }
});

// Broadcast recording state to all connected panel ports
const panelPorts: chrome.runtime.Port[] = [];

export function registerPort(port: chrome.runtime.Port) {
  panelPorts.push(port);
  port.onDisconnect.addListener(() => {
    const idx = panelPorts.indexOf(port);
    if (idx >= 0) panelPorts.splice(idx, 1);
  });
}

export function sendToAllPorts(msg: object) {
  for (const port of panelPorts) {
    try {
      port.postMessage(msg);
    } catch { /* port may have disconnected */ }
  }
}

function broadcastStatus(recording: boolean) {
  for (const port of panelPorts) {
    try {
      port.postMessage({ type: "RECORDING_STATUS", recording });
    } catch { /* port may have disconnected */ }
  }
}
