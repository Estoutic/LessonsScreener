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
  function readPageNumber() {
    const btn = document.querySelector(SELECTORS.pageNumberButton);
    if (!btn)
      return 0;
    const text = btn.textContent?.trim() ?? "";
    const num = parseInt(text, 10);
    return isNaN(num) ? 0 : num;
  }
  function findNextButton() {
    let btn = document.querySelector(SELECTORS.nextButton);
    if (btn) {
      console.log("[screener] Next button found via adjacent sibling");
      return btn;
    }
    const pageNumBtn = document.querySelector(SELECTORS.pageNumberButton);
    if (pageNumBtn) {
      const parent = pageNumBtn.parentElement;
      if (parent) {
        const buttons = parent.querySelectorAll("button");
        btn = buttons[buttons.length - 1];
        if (btn && btn !== pageNumBtn) {
          console.log("[screener] Next button found via parent traversal");
          return btn;
        }
      }
      const sibling = pageNumBtn.nextElementSibling;
      if (sibling && sibling.tagName === "BUTTON") {
        console.log("[screener] Next button found via nextElementSibling");
        return sibling;
      }
    }
    const toolbar = document.querySelector(SELECTORS.toolbarContainer);
    if (toolbar) {
      const buttons = toolbar.querySelectorAll("button");
      if (buttons.length >= 3) {
        console.log("[screener] Next button found via toolbar fallback");
        return buttons[2];
      }
    }
    console.warn("[screener] Next button NOT found");
    return null;
  }
  function findPrevButton() {
    const pageNumBtn = document.querySelector(SELECTORS.pageNumberButton);
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
    return document.querySelector(SELECTORS.prevButton);
  }
  function getPageRect() {
    let el = document.querySelector(SELECTORS.pdfPage);
    if (!el)
      el = document.querySelector(SELECTORS.pdfCanvas);
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
    console.log("[screener] Page rect:", { x, y, width, height });
    return { x, y, width, height };
  }
  async function ensurePageVisible() {
    const el = document.querySelector(SELECTORS.pdfPage) || document.querySelector(SELECTORS.pdfCanvas);
    if (!el)
      return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    if (r.top < -10 || r.bottom > vh + 10) {
      el.scrollIntoView({ behavior: "instant", block: "start" });
      await sleep(300);
    }
  }
  function isNextDisabled() {
    const btn = findNextButton();
    if (!btn) {
      console.warn("[screener] isNextDisabled: button not found");
      return true;
    }
    const reactDisabled = isReactDisabled(btn);
    const domDisabled = btn.disabled;
    console.log(`[screener] Next: reactDisabled=${reactDisabled}, domDisabled=${domDisabled}`);
    return reactDisabled;
  }
  async function getPageInfo() {
    await ensurePageVisible();
    const pageNumber = readPageNumber();
    const rect = getPageRect();
    const dpr = window.devicePixelRatio || 1;
    const nextDisabled = isNextDisabled();
    console.log("[screener] getPageInfo:", { pageNumber, hasRect: !!rect, dpr, nextDisabled });
    return { pageNumber, rect, devicePixelRatio: dpr, isNextDisabled: nextDisabled };
  }
  async function clickNextAndWait() {
    const nextBtn = findNextButton();
    if (!nextBtn) {
      return { success: false, error: "Next button not found" };
    }
    if (isReactDisabled(nextBtn)) {
      return { success: false, isLastPage: true, error: "Next button is disabled (React state)" };
    }
    const oldPageNumber = readPageNumber();
    const oldDataPageNumber = document.querySelector(SELECTORS.pdfPage)?.getAttribute("data-page-number");
    const oldRect = getPageRect();
    console.log(`[screener] Clicking Next (current page: ${oldPageNumber})`);
    clickButton(nextBtn);
    const deadline = Date.now() + TIMING.pageChangeTimeout;
    while (Date.now() < deadline) {
      await sleep(TIMING.pageChangePoll);
      const newPageNumber = readPageNumber();
      if (newPageNumber > 0 && newPageNumber !== oldPageNumber) {
        return { success: true, newPageNumber };
      }
      const newDataAttr = document.querySelector(SELECTORS.pdfPage)?.getAttribute("data-page-number");
      if (newDataAttr && newDataAttr !== oldDataPageNumber) {
        return { success: true, newPageNumber: parseInt(newDataAttr, 10) || newPageNumber };
      }
      const newRect = getPageRect();
      if (oldRect && newRect && Math.abs(newRect.y - oldRect.y) > 50) {
        return { success: true, newPageNumber: readPageNumber() };
      }
      if (isNextDisabled() && readPageNumber() !== oldPageNumber) {
        return { success: true, newPageNumber: readPageNumber(), isLastPage: true };
      }
    }
    const finalPage = readPageNumber();
    if (finalPage !== oldPageNumber && finalPage > 0) {
      return { success: true, newPageNumber: finalPage };
    }
    return { success: false, error: "Timeout waiting for page change" };
  }
  async function goToFirstPage() {
    const MAX_CLICKS = 200;
    let clicks = 0;
    while (clicks < MAX_CLICKS) {
      const prevBtn = findPrevButton();
      if (!prevBtn)
        return { success: false, error: "Prev button not found" };
      if (isReactDisabled(prevBtn)) {
        const page = readPageNumber();
        console.log(`[screener] On first page (${page})`);
        return { success: true, pageNumber: page };
      }
      const oldPage = readPageNumber();
      clickButton(prevBtn);
      clicks++;
      const deadline = Date.now() + TIMING.pageChangeTimeout;
      while (Date.now() < deadline) {
        await sleep(TIMING.pageChangePoll);
        const newPage = readPageNumber();
        if (newPage !== oldPage && newPage > 0)
          break;
      }
      await sleep(200);
    }
    return { success: true, pageNumber: readPageNumber() };
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
          getPageInfo().then((info) => sendResponse({ success: true, data: info })).catch(
            (err) => sendResponse({
              success: false,
              error: err instanceof Error ? err.message : String(err)
            })
          );
          return true;
        }
        if (message.type === "click-next") {
          clickNextAndWait().then((result) => sendResponse(result)).catch(
            (err) => sendResponse({
              success: false,
              error: err instanceof Error ? err.message : String(err)
            })
          );
          return true;
        }
        if (message.type === "go-to-first") {
          goToFirstPage().then((result) => sendResponse(result)).catch(
            (err) => sendResponse({
              success: false,
              error: err instanceof Error ? err.message : String(err)
            })
          );
          return true;
        }
        return false;
      }
    );
    console.log("[screener] Content script loaded");
  }
})();
