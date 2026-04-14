(function () {
  if ((window as any).__cc_macro_recording) return;
  (window as any).__cc_macro_recording = true;

  const startTime = Date.now();

  function getUniqueSelector(el: Element): string {
    if (el.id) return "#" + CSS.escape(el.id);
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.documentElement) {
      let seg = cur.tagName.toLowerCase();
      if (cur.id) {
        seg = "#" + CSS.escape(cur.id);
        parts.unshift(seg);
        break;
      }
      const parent = cur.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.tagName === cur!.tagName
        );
        if (siblings.length > 1) {
          const idx = siblings.indexOf(cur) + 1;
          seg += ":nth-of-type(" + idx + ")";
        }
      }
      parts.unshift(seg);
      cur = parent;
    }
    return parts.join(" > ");
  }

  function sendEvent(step: any) {
    try {
      chrome.runtime.sendMessage({ type: "MACRO_EVENT", step });
    } catch {}
  }

  function onClick(e: MouseEvent) {
    const t = e.target as Element;
    sendEvent({
      type: e.type === "dblclick" ? "dblclick" : "click",
      target: {
        selector: getUniqueSelector(t),
        tagName: t.tagName,
        boundingRect: t.getBoundingClientRect(),
      },
      timestamp: Date.now() - startTime,
      mouseX: e.pageX,
      mouseY: e.pageY,
      button: e.button,
    });
  }

  function onKeydown(e: KeyboardEvent) {
    const t = e.target as Element;
    sendEvent({
      type: "keydown",
      target: {
        selector: getUniqueSelector(t),
        tagName: t.tagName,
      },
      timestamp: Date.now() - startTime,
      key: e.key,
      code: e.code,
    });
  }

  function onInput(e: Event) {
    const t = e.target as HTMLInputElement | HTMLTextAreaElement;
    if (!t || typeof t.value === "undefined") return;
    sendEvent({
      type: "input",
      target: {
        selector: getUniqueSelector(t),
        tagName: t.tagName,
      },
      timestamp: Date.now() - startTime,
      inputValue: t.value,
    });
  }

  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  function onScroll() {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      sendEvent({
        type: "scroll",
        timestamp: Date.now() - startTime,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      });
    }, 100);
  }

  document.addEventListener("click", onClick, true);
  document.addEventListener("dblclick", onClick, true);
  document.addEventListener("keydown", onKeydown, true);
  document.addEventListener("input", onInput, true);
  window.addEventListener("scroll", onScroll, true);

  function cleanup() {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("dblclick", onClick, true);
    document.removeEventListener("keydown", onKeydown, true);
    document.removeEventListener("input", onInput, true);
    window.removeEventListener("scroll", onScroll, true);
    delete (window as any).__cc_macro_recording;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "STOP_MACRO_RECORD") {
      cleanup();
    }
  });
})();
