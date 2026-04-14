import type { Macro, MacroStep } from "../shared/macro-types.js";
import * as recordingManager from "./recording-manager.js";

let isRecordingMacro = false;
let isPlayingMacro = false;
let recordedSteps: MacroStep[] = [];
let recordStartTime = 0;
let playbackAbort: AbortController | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

export function getIsRecording() {
  return isRecordingMacro;
}

export function getIsPlaying() {
  return isPlayingMacro;
}

function broadcast(msg: object) {
  recordingManager.sendToAllPorts(msg);
}

// --- Recording ---

export async function startMacroRecording(tabId: number) {
  if (isRecordingMacro) return { error: "Already recording" };
  isRecordingMacro = true;
  recordedSteps = [];
  recordStartTime = Date.now();

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/macro-recorder.js"],
  });

  broadcast({ type: "MACRO_STATUS", recording: true, steps: 0 });
  return { success: true };
}

export function stopMacroRecording(tabId: number) {
  if (!isRecordingMacro) return { error: "Not recording" };
  isRecordingMacro = false;

  chrome.tabs.sendMessage(tabId, { type: "STOP_MACRO_RECORD" }).catch(() => {});

  const durationMs = Date.now() - recordStartTime;
  const result = { steps: recordedSteps, url: "", durationMs };
  recordedSteps = [];

  broadcast({ type: "MACRO_STATUS", recording: false });
  return result;
}

export function handleRecordedStep(step: MacroStep) {
  if (!isRecordingMacro) return;
  recordedSteps.push(step);
  broadcast({ type: "MACRO_STATUS", recording: true, steps: recordedSteps.length });
}

// --- Playback helpers ---

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Aborted"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    }, { once: true });
  });
}

async function sendCDP(tabId: number, method: string, params: object = {}) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

async function getElementCenter(tabId: number, selector: string) {
  const res: any = await sendCDP(tabId, "Runtime.evaluate", {
    expression: `JSON.stringify((() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width/2 + window.scrollX, y: r.top + r.height/2 + window.scrollY, found: true }; })())`,
    returnByValue: true,
  });
  if (res?.result?.value) {
    const v = JSON.parse(res.result.value);
    if (v?.found) return v;
  }
  return null;
}

async function replayStep(tabId: number, step: MacroStep, signal: AbortSignal) {
  if (signal.aborted) throw new Error("Aborted");

  switch (step.type) {
    case "click":
    case "dblclick": {
      const selector = step.target?.selector;
      if (!selector) break;
      const center = await getElementCenter(tabId, selector);
      if (!center) break;
      const x = center.x;
      const y = center.y;

      await sendCDP(tabId, "Input.dispatchMouseEvent", {
        type: "mousePressed", x, y, button: "left", clickCount: 1,
      });
      await sendCDP(tabId, "Input.dispatchMouseEvent", {
        type: "mouseReleased", x, y, button: "left", clickCount: step.type === "dblclick" ? 2 : 1,
      });
      break;
    }
    case "keydown": {
      const selector = step.target?.selector;
      if (selector) {
        await sendCDP(tabId, "Runtime.evaluate", {
          expression: `document.querySelector(${JSON.stringify(selector)})?.focus()`,
        });
      }
      await sendCDP(tabId, "Input.dispatchKeyEvent", {
        type: "keyDown", key: step.key || "", code: step.code || "",
      });
      await sendCDP(tabId, "Input.dispatchKeyEvent", {
        type: "keyUp", key: step.key || "", code: step.code || "",
      });
      break;
    }
    case "input": {
      const selector = step.target?.selector;
      if (!selector || step.inputValue == null) break;
      await sendCDP(tabId, "Runtime.evaluate", {
        expression: `document.querySelector(${JSON.stringify(selector)})?.focus()`,
      });
      await sendCDP(tabId, "Input.insertText", { text: step.inputValue });
      break;
    }
    case "scroll": {
      await sendCDP(tabId, "Runtime.evaluate", {
        expression: `window.scrollTo(${step.scrollX || 0}, ${step.scrollY || 0})`,
      });
      break;
    }
  }
}

// --- Playback ---

export async function playMacro(macro: Macro, tabId: number) {
  if (isPlayingMacro) return { error: "Already playing" };
  isPlayingMacro = true;
  playbackAbort = new AbortController();
  const signal = playbackAbort.signal;

  // Heartbeat to keep service worker alive
  heartbeatInterval = setInterval(() => {}, 25000);

  broadcast({ type: "MACRO_PLAYBACK_PROGRESS", status: "playing", current: 0, total: macro.steps.length });

  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch {
    // May already be attached
  }

  try {
    let lastTime = 0;
    for (let i = 0; i < macro.steps.length; i++) {
      if (signal.aborted) break;
      const step = macro.steps[i];
      const delay = Math.min(step.timestamp - lastTime, 2000); // cap delay at 2s
      if (delay > 30) await sleep(delay, signal);
      lastTime = step.timestamp;

      await replayStep(tabId, step, signal);
      broadcast({ type: "MACRO_PLAYBACK_PROGRESS", status: "playing", current: i + 1, total: macro.steps.length });
    }
  } catch (e: any) {
    if (e.message !== "Aborted") console.error("Playback error:", e);
  } finally {
    try { await chrome.debugger.detach({ tabId }); } catch {}
    isPlayingMacro = false;
    playbackAbort = null;
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    broadcast({ type: "MACRO_PLAYBACK_DONE" });
  }

  return { success: true };
}

export function stopPlayback() {
  if (playbackAbort) playbackAbort.abort();
}

// --- Demo mode ---

export async function playDemo(macro: Macro, tabId: number) {
  broadcast({ type: "MACRO_PLAYBACK_PROGRESS", status: "demo", current: 0, total: macro.steps.length });

  await recordingManager.startRecording();
  await sleep(1000);
  await playMacro(macro, tabId);
  await sleep(1000);
  await recordingManager.stopRecording();

  broadcast({ type: "MACRO_PLAYBACK_DONE" });
}
