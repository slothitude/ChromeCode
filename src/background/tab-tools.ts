export async function getActiveTabContent(): Promise<string> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found");
  if (tab.url?.startsWith("chrome://")) return "(chrome:// page — no access)";

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      return {
        innerText: document.body.innerText,
        title: document.title,
        url: window.location.href,
        readyState: document.readyState
      };
    }
  });

  const data = results[0].result;
  return `URL: ${data.url}\nTitle: ${data.title}\nStatus: ${data.readyState}\n\nContent:\n${data.innerText.slice(0, 5000)}`;
}

export async function getActiveTabContentStructured(): Promise<{url: string, title: string, text: string, readyState: string}> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found");
  if (tab.url?.startsWith("chrome://")) return { url: tab.url, title: tab.title || "", text: "(chrome:// page — no access)", readyState: "complete" };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      innerText: document.body.innerText,
      title: document.title,
      url: window.location.href,
      readyState: document.readyState,
    }),
  });

  const data = results[0].result;
  return { url: data.url, title: data.title, text: data.innerText.slice(0, 5000), readyState: data.readyState };
}

export async function captureTabScreenshot(): Promise<string> {
  return chrome.tabs.captureVisibleTab({ format: "jpeg", quality: 85 });
}

export async function evaluateOnTab(expression: string): Promise<{success: boolean, value?: any, error?: string}> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { success: false, error: "No active tab" };

  const target = { tabId: tab.id };

  try {
    await chrome.debugger.attach(target, "1.3");

    const result: any = await new Promise((resolve, reject) => {
      chrome.debugger.sendCommand(target, "Runtime.evaluate", {
        expression,
        returnByValue: true,
        userGesture: true,
        awaitPromise: true,
      }, (res) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(res);
      });
    });

    await chrome.debugger.detach(target);

    if (result.exceptionDetails) {
      return { success: false, error: result.exceptionDetails.exception?.description || "Evaluation failed" };
    }

    return { success: true, value: result.result?.value };
  } catch (e: any) {
    try { await chrome.debugger.detach(target); } catch {}
    return { success: false, error: e.message };
  }
}

export async function editActiveTab(code: string): Promise<{success: boolean, error?: string}> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { success: false, error: "No active tab" };

  const target = { tabId: tab.id };

  try {
    // 1. Attach debugger
    await chrome.debugger.attach(target, "1.3");

    // 2. Execute code using Runtime.evaluate (bypasses ALL CSP/eval limits)
    const result: any = await new Promise((resolve, reject) => {
      chrome.debugger.sendCommand(target, "Runtime.evaluate", {
        expression: code,
        userGesture: true,
        awaitPromise: true
      }, (res) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(res);
      });
    });

    // 3. Detach debugger
    await chrome.debugger.detach(target);

    if (result.exceptionDetails) {
      return {
        success: false,
        error: result.exceptionDetails.exception.description || "Execution failed"
      };
    }

    return { success: true };
  } catch (e: any) {
    // Ensure we detach even on error
    try { await chrome.debugger.detach(target); } catch(de) {}
    return { success: false, error: e.message };
  }
}
