let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let mediaRecorder: MediaRecorder;
let chunks: Blob[] = [];

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "start-recording") {
    canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    ctx = canvas.getContext("2d")!;
    chunks = [];

    const stream = canvas.captureStream(60);
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp9",
      videoBitsPerSecond: 8_000_000,
    });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    mediaRecorder.start();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === "frame") {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = msg.dataUrl;
    return false;
  }

  if (msg.action === "stop-recording") {
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      chrome.runtime.sendMessage({ action: "recording-complete", url });
      // Revoke after 60s to give download time
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };
    mediaRecorder.stop();
    sendResponse({ ok: true });
    return true;
  }
});
