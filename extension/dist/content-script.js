"use strict";
(() => {
  // src/config.ts
  var SELECTORS = {
    /** Button showing current page number — stable data-testid anchor */
    pageNumberButton: 'button[data-testid="page-number"]',
    /**
     * Next page button: sibling immediately after the page-number button.
     * Uses CSS adjacent sibling selector — independent of MUI class names.
     */
    nextButton: 'button[data-testid="page-number"] + button',
    /**
     * Toolbar container — MUI class, may change between deploys.
     * Used only as fallback for prev/next if sibling selectors fail.
     */
    toolbarContainer: "div.MuiBox-root.css-5ax1kt",
    /** Previous page button — fallback via toolbar container */
    prevButton: "div.MuiBox-root.css-5ax1kt > button:nth-of-type(1)",
    /** PDF page container (primary target for crop rect) */
    pdfPage: "div.react-pdf__Page[data-page-number]",
    /** PDF page canvas (alternative target) */
    pdfCanvas: ".react-pdf__Page__canvas"
  };
  var TIMING = {
    /** Max time (ms) to wait for page change after clicking Next */
    pageChangeTimeout: 8e3,
    /** Polling interval (ms) when waiting for page change */
    pageChangePoll: 200,
    /** Delay (ms) after page change confirmed before taking screenshot */
    postChangeDelay: 500,
    /** Delay (ms) between capture cycles for stability */
    interCycleDelay: 300
  };

  // src/dom-adapter.ts
  function getPageNumberButton(lessonIndex) {
    const all = document.querySelectorAll(SELECTORS.pageNumberButton);
    return all[lessonIndex] || null;
  }
  function getLessonCount() {
    return document.querySelectorAll(SELECTORS.pageNumberButton).length;
  }
  function getReactProps(el) {
    const key = Object.keys(el).find(
      (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
    );
    if (!key)
      return null;
    const fiber = el[key];
    return fiber?.memoizedProps || fiber?.pendingProps || null;
  }
  function isReactDisabled(el) {
    const props = getReactProps(el);
    if (props) {
      return props.disabled === true;
    }
    return el.disabled;
  }
  function reactClick(el) {
    const props = getReactProps(el);
    if (props && typeof props.onClick === "function") {
      console.log("[screener] Calling React onClick directly");
      const syntheticEvent = {
        type: "click",
        target: el,
        currentTarget: el,
        preventDefault: () => {
        },
        stopPropagation: () => {
        },
        nativeEvent: new MouseEvent("click", { bubbles: true })
      };
      try {
        props.onClick(syntheticEvent);
        return true;
      } catch (err) {
        console.error("[screener] React onClick threw:", err);
      }
    }
    return false;
  }
  function clickButton(el) {
    if (reactClick(el)) {
      console.log("[screener] Click via React onClick \u2014 success");
      return;
    }
    const wasDisabled = el.disabled;
    if (wasDisabled) {
      el.removeAttribute("disabled");
      el.disabled = false;
      console.log("[screener] Temporarily removed disabled attribute");
    }
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const common = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: cx,
      clientY: cy
    };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...common, pointerId: 1 }));
    el.dispatchEvent(new MouseEvent("mousedown", common));
    el.dispatchEvent(new PointerEvent("pointerup", { ...common, pointerId: 1 }));
    el.dispatchEvent(new MouseEvent("mouseup", common));
    el.dispatchEvent(new MouseEvent("click", common));
    console.log(`[screener] simulateClick on <${el.tagName}> at (${cx.toFixed(0)}, ${cy.toFixed(0)})`);
  }
  function readPageNumber(lessonIndex) {
    const btn = getPageNumberButton(lessonIndex);
    if (!btn)
      return 0;
    const text = btn.textContent?.trim() ?? "";
    const num = parseInt(text, 10);
    return isNaN(num) ? 0 : num;
  }
  function findNextButton(lessonIndex) {
    const pageNumBtn = getPageNumberButton(lessonIndex);
    if (pageNumBtn) {
      const sibling = pageNumBtn.nextElementSibling;
      if (sibling && sibling.tagName === "BUTTON") {
        console.log(`[screener] Next button found for lesson ${lessonIndex} via nextElementSibling`);
        return sibling;
      }
      const parent = pageNumBtn.parentElement;
      if (parent) {
        const buttons = parent.querySelectorAll("button");
        const btn = buttons[buttons.length - 1];
        if (btn && btn !== pageNumBtn) {
          console.log(`[screener] Next button found for lesson ${lessonIndex} via parent traversal`);
          return btn;
        }
      }
    }
    console.warn(`[screener] Next button NOT found for lesson ${lessonIndex}`);
    return null;
  }
  function findPrevButton(lessonIndex) {
    const pageNumBtn = getPageNumberButton(lessonIndex);
    if (pageNumBtn) {
      const sibling = pageNumBtn.previousElementSibling;
      if (sibling && sibling.tagName === "BUTTON")
        return sibling;
      const parent = pageNumBtn.parentElement;
      if (parent) {
        const firstBtn = parent.querySelector("button");
        if (firstBtn && firstBtn !== pageNumBtn)
          return firstBtn;
      }
    }
    return null;
  }
  function getPageRect(lessonIndex) {
    const allPages = document.querySelectorAll(SELECTORS.pdfPage);
    let el = allPages[lessonIndex] || null;
    if (!el) {
      const allCanvases = document.querySelectorAll(SELECTORS.pdfCanvas);
      el = allCanvases[lessonIndex] || null;
    }
    if (!el)
      return null;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x = Math.max(0, r.left);
    const y = Math.max(0, r.top);
    const right = Math.min(vw, r.right);
    const bottom = Math.min(vh, r.bottom);
    const width = right - x;
    const height = bottom - y;
    if (width <= 0 || height <= 0)
      return null;
    console.log(`[screener] Page rect for lesson ${lessonIndex}:`, { x, y, width, height });
    return { x, y, width, height };
  }
  async function ensurePageVisible(lessonIndex) {
    const allPages = document.querySelectorAll(SELECTORS.pdfPage);
    let el = allPages[lessonIndex] || null;
    if (!el) {
      const allCanvases = document.querySelectorAll(SELECTORS.pdfCanvas);
      el = allCanvases[lessonIndex] || null;
    }
    if (!el)
      return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    if (r.top < -10 || r.bottom > vh + 10) {
      el.scrollIntoView({ behavior: "instant", block: "start" });
      await sleep(300);
    }
  }
  function isNextDisabled(lessonIndex) {
    const btn = findNextButton(lessonIndex);
    if (!btn) {
      console.warn(`[screener] isNextDisabled: button not found for lesson ${lessonIndex}`);
      return true;
    }
    const reactDisabled = isReactDisabled(btn);
    const domDisabled = btn.disabled;
    console.log(`[screener] Lesson ${lessonIndex} Next: reactDisabled=${reactDisabled}, domDisabled=${domDisabled}`);
    return reactDisabled;
  }
  async function getPageInfo(lessonIndex = 0) {
    await ensurePageVisible(lessonIndex);
    const pageNumber = readPageNumber(lessonIndex);
    const rect = getPageRect(lessonIndex);
    const dpr = window.devicePixelRatio || 1;
    const nextDisabled = isNextDisabled(lessonIndex);
    console.log(`[screener] getPageInfo (lesson ${lessonIndex}):`, { pageNumber, hasRect: !!rect, dpr, nextDisabled });
    return { pageNumber, rect, devicePixelRatio: dpr, isNextDisabled: nextDisabled };
  }
  async function clickNextAndWait(lessonIndex = 0) {
    const nextBtn = findNextButton(lessonIndex);
    if (!nextBtn) {
      return { success: false, error: "Next button not found" };
    }
    if (isReactDisabled(nextBtn)) {
      return { success: false, isLastPage: true, error: "Next button is disabled (React state)" };
    }
    const oldPageNumber = readPageNumber(lessonIndex);
    const allPages = document.querySelectorAll(SELECTORS.pdfPage);
    const pageEl = allPages[lessonIndex];
    const oldDataPageNumber = pageEl?.getAttribute("data-page-number");
    const oldRect = getPageRect(lessonIndex);
    console.log(`[screener] Clicking Next for lesson ${lessonIndex} (current page: ${oldPageNumber})`);
    clickButton(nextBtn);
    const deadline = Date.now() + TIMING.pageChangeTimeout;
    while (Date.now() < deadline) {
      await sleep(TIMING.pageChangePoll);
      const newPageNumber = readPageNumber(lessonIndex);
      if (newPageNumber > 0 && newPageNumber !== oldPageNumber) {
        return { success: true, newPageNumber };
      }
      const currentPageEl = document.querySelectorAll(SELECTORS.pdfPage)[lessonIndex];
      const newDataAttr = currentPageEl?.getAttribute("data-page-number");
      if (newDataAttr && newDataAttr !== oldDataPageNumber) {
        return { success: true, newPageNumber: parseInt(newDataAttr, 10) || newPageNumber };
      }
      const newRect = getPageRect(lessonIndex);
      if (oldRect && newRect && Math.abs(newRect.y - oldRect.y) > 50) {
        return { success: true, newPageNumber: readPageNumber(lessonIndex) };
      }
      if (isNextDisabled(lessonIndex) && readPageNumber(lessonIndex) !== oldPageNumber) {
        return { success: true, newPageNumber: readPageNumber(lessonIndex), isLastPage: true };
      }
    }
    const finalPage = readPageNumber(lessonIndex);
    if (finalPage !== oldPageNumber && finalPage > 0) {
      return { success: true, newPageNumber: finalPage };
    }
    return { success: false, error: "Timeout waiting for page change" };
  }
  async function goToFirstPage(lessonIndex = 0) {
    const MAX_CLICKS = 200;
    let clicks = 0;
    while (clicks < MAX_CLICKS) {
      const prevBtn = findPrevButton(lessonIndex);
      if (!prevBtn)
        return { success: false, error: "Prev button not found" };
      if (isReactDisabled(prevBtn)) {
        const page = readPageNumber(lessonIndex);
        console.log(`[screener] Lesson ${lessonIndex} on first page (${page})`);
        return { success: true, pageNumber: page };
      }
      const oldPage = readPageNumber(lessonIndex);
      clickButton(prevBtn);
      clicks++;
      const deadline = Date.now() + TIMING.pageChangeTimeout;
      while (Date.now() < deadline) {
        await sleep(TIMING.pageChangePoll);
        const newPage = readPageNumber(lessonIndex);
        if (newPage !== oldPage && newPage > 0)
          break;
      }
      await sleep(200);
    }
    return { success: true, pageNumber: readPageNumber(lessonIndex) };
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // src/content-script.ts
  if (!window.__screener_loaded) {
    window.__screener_loaded = true;
    chrome.runtime.onMessage.addListener(
      (message, _sender, sendResponse) => {
        if (message.type === "get-page-info") {
          const lessonIndex = message.lessonIndex ?? 0;
          getPageInfo(lessonIndex).then((info) => sendResponse({ success: true, data: info })).catch(
            (err) => sendResponse({
              success: false,
              error: err instanceof Error ? err.message : String(err)
            })
          );
          return true;
        }
        if (message.type === "click-next") {
          const lessonIndex = message.lessonIndex ?? 0;
          clickNextAndWait(lessonIndex).then((result) => sendResponse(result)).catch(
            (err) => sendResponse({
              success: false,
              error: err instanceof Error ? err.message : String(err)
            })
          );
          return true;
        }
        if (message.type === "go-to-first") {
          const lessonIndex = message.lessonIndex ?? 0;
          goToFirstPage(lessonIndex).then((result) => sendResponse(result)).catch(
            (err) => sendResponse({
              success: false,
              error: err instanceof Error ? err.message : String(err)
            })
          );
          return true;
        }
        if (message.type === "get-lesson-count") {
          const count = getLessonCount();
          sendResponse({ success: true, count });
          return false;
        }
        return false;
      }
    );
    console.log("[screener] Content script loaded");
  }
})();
