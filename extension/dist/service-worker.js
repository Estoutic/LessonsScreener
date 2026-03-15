// src/config.ts
var FALLBACK_CROP = {
  x: 470,
  y: 25,
  width: 545,
  height: 790
};
var DOWNLOAD_CONFIG = {
  /** Prefix for saved file names: prefix-001.png */
  filePrefix: "page",
  /** Number of digits for zero-padded page numbers */
  padDigits: 3,
  /** Subfolder inside Downloads (empty = root of Downloads) */
  subfolder: "screener"
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
var DEBUG = {
  /** Save full (uncropped) screenshots alongside cropped ones */
  saveFullScreenshot: true,
  /** Log verbose messages */
  verbose: true
};

// src/logger.ts
var MAX_LOGS = 50;
var logBuffer = [];
function timestamp() {
  return (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", { hour12: false });
}
function log(msg) {
  const entry = `[${timestamp()}] ${msg}`;
  console.log(`[screener] ${entry}`);
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.shift();
  }
}
function logError(msg, err) {
  const detail = err instanceof Error ? err.message : String(err ?? "");
  log(`ERROR: ${msg}${detail ? " \u2014 " + detail : ""}`);
}
function getLogs() {
  return [...logBuffer];
}
function clearLogs() {
  logBuffer.length = 0;
}

// src/state.ts
var state = {
  status: "idle",
  currentPage: 0,
  totalCaptured: 0,
  logs: [],
  errorMessage: void 0
};
var stopRequested = false;
function getState() {
  return { ...state, logs: getLogs() };
}
function setStatus(status, errorMessage) {
  state.status = status;
  state.errorMessage = errorMessage;
}
function setCurrentPage(page) {
  state.currentPage = page;
}
function incrementCaptured() {
  state.totalCaptured++;
}
function resetState() {
  state = {
    status: "idle",
    currentPage: 0,
    totalCaptured: 0,
    logs: [],
    errorMessage: void 0
  };
  stopRequested = false;
}
function requestStop() {
  stopRequested = true;
}
function isStopRequested() {
  return stopRequested;
}
function clearStopFlag() {
  stopRequested = false;
}

// src/capture.ts
async function captureVisibleTab(windowId) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId ?? chrome.windows.WINDOW_ID_CURRENT, {
    format: "png"
  });
  return dataUrl;
}

// src/downloads.ts
async function savePageImage(dataUrl, pageNumber) {
  const paddedNum = String(pageNumber).padStart(DOWNLOAD_CONFIG.padDigits, "0");
  const filename = DOWNLOAD_CONFIG.subfolder ? `${DOWNLOAD_CONFIG.subfolder}/${DOWNLOAD_CONFIG.filePrefix}-${paddedNum}.png` : `${DOWNLOAD_CONFIG.filePrefix}-${paddedNum}.png`;
  const downloadId = await chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: false,
    conflictAction: "uniquify"
  });
  return downloadId;
}
async function saveFullScreenshot(dataUrl, pageNumber) {
  const paddedNum = String(pageNumber).padStart(DOWNLOAD_CONFIG.padDigits, "0");
  const filename = DOWNLOAD_CONFIG.subfolder ? `${DOWNLOAD_CONFIG.subfolder}/full-${DOWNLOAD_CONFIG.filePrefix}-${paddedNum}.png` : `full-${DOWNLOAD_CONFIG.filePrefix}-${paddedNum}.png`;
  return chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: false,
    conflictAction: "uniquify"
  });
}

// src/messages.ts
function broadcastStateUpdate(state2) {
  chrome.runtime.sendMessage({ type: "state-update", state: state2 }).catch(() => {
  });
}

// src/service-worker.ts
var offscreenCreated = false;
async function ensureOffscreen() {
  if (offscreenCreated)
    return;
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]
  });
  if (existingContexts.length > 0) {
    offscreenCreated = true;
    return;
  }
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification: "Crop screenshots using Canvas API (unavailable in service worker)"
  });
  offscreenCreated = true;
}
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id)
    throw new Error("No active tab found");
  return tab.id;
}
async function getPageInfo(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: "get-page-info" });
}
async function clickNextInMainWorld(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (selectors) => {
      function findNextButton() {
        let btn2 = document.querySelector(selectors.nextButton);
        if (btn2)
          return btn2;
        const pageNumBtn = document.querySelector(selectors.pageNumberButton);
        if (pageNumBtn) {
          const parent = pageNumBtn.parentElement;
          if (parent) {
            const buttons = parent.querySelectorAll("button");
            btn2 = buttons[buttons.length - 1];
            if (btn2 && btn2 !== pageNumBtn)
              return btn2;
          }
          const sibling = pageNumBtn.nextElementSibling;
          if (sibling && sibling.tagName === "BUTTON")
            return sibling;
        }
        const toolbar = document.querySelector(selectors.toolbarContainer);
        if (toolbar) {
          const buttons = toolbar.querySelectorAll("button");
          if (buttons.length >= 3)
            return buttons[2];
        }
        return null;
      }
      function readPageNumber() {
        const btn2 = document.querySelector(selectors.pageNumberButton);
        if (!btn2)
          return 0;
        const num = parseInt(btn2.textContent?.trim() ?? "", 10);
        return isNaN(num) ? 0 : num;
      }
      const btn = findNextButton();
      if (!btn)
        return { clicked: false, pageNumber: 0, isLast: true, error: "Next button not found" };
      btn.click();
      const pageNumber = readPageNumber();
      const isLast = btn.disabled === true;
      return { clicked: true, pageNumber, isLast };
    },
    args: [{ pageNumberButton: 'button[data-testid="page-number"]', nextButton: 'button[data-testid="page-number"] + button', toolbarContainer: "div.MuiBox-root.css-5ax1kt" }]
  });
  return result.result;
}
async function goToFirstInMainWorld(tabId) {
  const MAX_CLICKS = 200;
  for (let i = 0; i < MAX_CLICKS; i++) {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (selectors) => {
        function readPageNumber() {
          const btn = document.querySelector(selectors.pageNumberButton);
          if (!btn)
            return 0;
          const num = parseInt(btn.textContent?.trim() ?? "", 10);
          return isNaN(num) ? 0 : num;
        }
        const pageNumBtn = document.querySelector(selectors.pageNumberButton);
        let prevBtn = null;
        if (pageNumBtn) {
          const sibling = pageNumBtn.previousElementSibling;
          if (sibling && sibling.tagName === "BUTTON")
            prevBtn = sibling;
          if (!prevBtn) {
            const parent = pageNumBtn.parentElement;
            if (parent) {
              const firstBtn = parent.querySelector("button");
              if (firstBtn && firstBtn !== pageNumBtn)
                prevBtn = firstBtn;
            }
          }
        }
        if (!prevBtn) {
          prevBtn = document.querySelector(selectors.prevButton);
        }
        if (!prevBtn)
          return { atFirst: true, pageNumber: readPageNumber(), noPrevBtn: true };
        if (prevBtn.disabled)
          return { atFirst: true, pageNumber: readPageNumber(), noPrevBtn: false };
        prevBtn.click();
        return { atFirst: false, pageNumber: readPageNumber(), noPrevBtn: false };
      },
      args: [{ pageNumberButton: 'button[data-testid="page-number"]', prevButton: "div.MuiBox-root.css-5ax1kt > button:nth-of-type(1)" }]
    });
    const res = result.result;
    if (res.atFirst) {
      return { success: true, pageNumber: res.pageNumber };
    }
    await sleep(TIMING.pageChangePoll * 2);
  }
  return { success: true, pageNumber: 1 };
}
async function cropViaOffscreen(dataUrl, rect, devicePixelRatio) {
  await ensureOffscreen();
  const message = {
    type: "crop",
    dataUrl,
    rect,
    devicePixelRatio
  };
  const response = await chrome.runtime.sendMessage(message);
  if (!response.success || !response.croppedDataUrl) {
    throw new Error(response.error || "Crop failed");
  }
  return response.croppedDataUrl;
}
function broadcast() {
  broadcastStateUpdate(getState());
}
async function isNextDisabledMainWorld(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (selectors) => {
        let btn = document.querySelector(selectors.nextButton);
        if (!btn) {
          const pageNumBtn = document.querySelector(selectors.pageNumberButton);
          if (pageNumBtn) {
            const sibling = pageNumBtn.nextElementSibling;
            if (sibling && sibling.tagName === "BUTTON")
              btn = sibling;
          }
        }
        if (!btn)
          return true;
        return btn.disabled === true;
      },
      args: [{ nextButton: 'button[data-testid="page-number"] + button', pageNumberButton: 'button[data-testid="page-number"]', toolbarContainer: "div.MuiBox-root.css-5ax1kt" }]
    });
    return result.result;
  } catch {
    return true;
  }
}
async function captureSinglePage(tabId) {
  const pageInfoRes = await getPageInfo(tabId);
  if (!pageInfoRes.success || !pageInfoRes.data) {
    throw new Error(pageInfoRes.error || "Failed to get page info");
  }
  const { pageNumber, rect, devicePixelRatio } = pageInfoRes.data;
  const isNextDisabled = await isNextDisabledMainWorld(tabId);
  const effectivePage = pageNumber || getState().currentPage + 1;
  setCurrentPage(effectivePage);
  broadcast();
  log(`Capturing page ${effectivePage} (dpr=${devicePixelRatio})`);
  const cropRect = rect || FALLBACK_CROP;
  if (!rect) {
    log("DOM rect not found, using fallback coordinates");
  }
  log(`Crop rect: x=${cropRect.x} y=${cropRect.y} w=${cropRect.width} h=${cropRect.height} (source: ${rect ? "DOM" : "fallback"})`);
  const fullScreenshot = await captureVisibleTab();
  if (DEBUG.saveFullScreenshot) {
    await saveFullScreenshot(fullScreenshot, effectivePage);
    log(`Saved full screenshot for page ${effectivePage}`);
  }
  const croppedDataUrl = await cropViaOffscreen(fullScreenshot, cropRect, devicePixelRatio);
  await savePageImage(croppedDataUrl, effectivePage);
  incrementCaptured();
  log(`Saved page-${String(effectivePage).padStart(3, "0")}.png`);
  broadcast();
  return isNextDisabled;
}
async function runCaptureLoop() {
  clearStopFlag();
  clearLogs();
  resetState();
  setStatus("running");
  broadcast();
  const tabId = await getActiveTabId();
  log(`Starting capture on tab ${tabId}`);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-script.js"]
    }).catch(() => {
    });
    await sleep(500);
    log("Navigating to first page (main world)...");
    const goRes = await goToFirstInMainWorld(tabId);
    if (goRes.success) {
      log(`On page ${goRes.pageNumber ?? 1}`);
    } else {
      log(`Warning: go-to-first failed: ${goRes.error}. Continuing from current page.`);
    }
    await sleep(TIMING.postChangeDelay);
    let isLast = false;
    while (!isStopRequested()) {
      isLast = await captureSinglePage(tabId);
      if (isLast) {
        log("Reached last page");
        break;
      }
      if (isStopRequested())
        break;
      log("Clicking Next (main world)...");
      const oldPage = getState().currentPage;
      const nextRes = await clickNextInMainWorld(tabId);
      if (!nextRes.clicked) {
        if (nextRes.isLast) {
          log("Next reports last page");
          break;
        }
        throw new Error(nextRes.error || "Failed to click next");
      }
      await sleep(TIMING.pageChangePoll);
      const deadline = Date.now() + TIMING.pageChangeTimeout;
      let newPage = oldPage;
      while (Date.now() < deadline) {
        try {
          const info = await getPageInfo(tabId);
          if (info.success && info.data) {
            if (info.data.pageNumber > 0 && info.data.pageNumber !== oldPage) {
              newPage = info.data.pageNumber;
              break;
            }
          }
        } catch {
        }
        await sleep(TIMING.pageChangePoll);
      }
      if (newPage === oldPage) {
        if (nextRes.isLast) {
          log("Next became disabled after click \u2014 last page");
          break;
        }
        log(`Warning: page number didn't change (still ${oldPage}), continuing anyway`);
      } else {
        log(`Page changed to ${newPage}`);
      }
      await sleep(TIMING.postChangeDelay);
      await sleep(TIMING.interCycleDelay);
    }
    if (isStopRequested()) {
      setStatus("stopped");
      log("Process stopped by user");
    } else {
      setStatus("completed");
      log(`Completed! Captured ${getState().totalCaptured} pages`);
    }
  } catch (err) {
    logError("Capture loop failed", err);
    setStatus("error", err instanceof Error ? err.message : String(err));
  }
  broadcast();
}
async function testCapture() {
  setStatus("running");
  broadcast();
  try {
    const tabId = await getActiveTabId();
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-script.js"]
    }).catch(() => {
    });
    await sleep(500);
    await captureSinglePage(tabId);
    setStatus("idle");
    log("Test capture completed");
  } catch (err) {
    logError("Test capture failed", err);
    setStatus("error", err instanceof Error ? err.message : String(err));
  }
  broadcast();
}
chrome.runtime.onMessage.addListener(
  (message, _sender, sendResponse) => {
    switch (message.type) {
      case "start":
        runCaptureLoop();
        sendResponse({ ok: true });
        return false;
      case "stop":
        requestStop();
        log("Stop requested");
        sendResponse({ ok: true });
        return false;
      case "test-capture":
        testCapture();
        sendResponse({ ok: true });
        return false;
      case "get-state":
        sendResponse({ state: getState() });
        return false;
      default:
        return false;
    }
  }
);
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
log("Service worker loaded");
