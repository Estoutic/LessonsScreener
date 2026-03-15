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
  saveFullScreenshot: false,
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
async function getPageInfo(tabId, lessonIndex = 0) {
  return chrome.tabs.sendMessage(tabId, { type: "get-page-info", lessonIndex });
}
async function getLessonCount(tabId) {
  const res = await chrome.tabs.sendMessage(tabId, { type: "get-lesson-count" });
  if (res.success && typeof res.count === "number")
    return res.count;
  return 1;
}
var MAIN_WORLD_SELECTORS = {
  pageNumberButton: 'button[data-testid="page-number"]',
  nextButton: 'button[data-testid="page-number"] + button',
  toolbarContainer: "div.MuiBox-root.css-5ax1kt",
  prevButton: "div.MuiBox-root.css-5ax1kt > button:nth-of-type(1)"
};
async function clickNextInMainWorld(tabId, lessonIndex = 0) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (selectors, lessonIdx) => {
      function getPageNumBtn() {
        const all = document.querySelectorAll(selectors.pageNumberButton);
        return all[lessonIdx] || null;
      }
      function findNextButton() {
        const pageNumBtn = getPageNumBtn();
        if (!pageNumBtn)
          return null;
        const sibling = pageNumBtn.nextElementSibling;
        if (sibling && sibling.tagName === "BUTTON")
          return sibling;
        const parent = pageNumBtn.parentElement;
        if (parent) {
          const buttons = parent.querySelectorAll("button");
          const btn2 = buttons[buttons.length - 1];
          if (btn2 && btn2 !== pageNumBtn)
            return btn2;
        }
        return null;
      }
      function readPageNumber() {
        const btn2 = getPageNumBtn();
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
    args: [{ pageNumberButton: MAIN_WORLD_SELECTORS.pageNumberButton }, lessonIndex]
  });
  return result.result;
}
async function goToFirstInMainWorld(tabId, lessonIndex = 0) {
  const MAX_CLICKS = 200;
  for (let i = 0; i < MAX_CLICKS; i++) {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (selectors, lessonIdx) => {
        function getPageNumBtn() {
          const all = document.querySelectorAll(selectors.pageNumberButton);
          return all[lessonIdx] || null;
        }
        function readPageNumber() {
          const btn = getPageNumBtn();
          if (!btn)
            return 0;
          const num = parseInt(btn.textContent?.trim() ?? "", 10);
          return isNaN(num) ? 0 : num;
        }
        const pageNumBtn = getPageNumBtn();
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
        if (!prevBtn)
          return { atFirst: true, pageNumber: readPageNumber(), noPrevBtn: true };
        if (prevBtn.disabled)
          return { atFirst: true, pageNumber: readPageNumber(), noPrevBtn: false };
        prevBtn.click();
        return { atFirst: false, pageNumber: readPageNumber(), noPrevBtn: false };
      },
      args: [{ pageNumberButton: MAIN_WORLD_SELECTORS.pageNumberButton }, lessonIndex]
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
async function isNextDisabledMainWorld(tabId, lessonIndex = 0) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (selectors, lessonIdx) => {
        const all = document.querySelectorAll(selectors.pageNumberButton);
        const pageNumBtn = all[lessonIdx];
        if (!pageNumBtn)
          return true;
        const sibling = pageNumBtn.nextElementSibling;
        if (sibling && sibling.tagName === "BUTTON") {
          return sibling.disabled === true;
        }
        return true;
      },
      args: [{ pageNumberButton: MAIN_WORLD_SELECTORS.pageNumberButton }, lessonIndex]
    });
    return result.result;
  } catch {
    return true;
  }
}
async function captureSinglePage(tabId, lessonIndex, globalPageCounter) {
  const pageInfoRes = await getPageInfo(tabId, lessonIndex);
  if (!pageInfoRes.success || !pageInfoRes.data) {
    throw new Error(pageInfoRes.error || "Failed to get page info");
  }
  const { pageNumber, rect, devicePixelRatio } = pageInfoRes.data;
  const isNextDisabled = await isNextDisabledMainWorld(tabId, lessonIndex);
  const effectivePage = pageNumber || getState().currentPage + 1;
  setCurrentPage(effectivePage);
  broadcast();
  log(`Lesson ${lessonIndex + 1}, capturing page ${effectivePage} (dpr=${devicePixelRatio})`);
  const cropRect = rect || FALLBACK_CROP;
  if (!rect) {
    log("DOM rect not found, using fallback coordinates");
  }
  log(`Crop rect: x=${cropRect.x} y=${cropRect.y} w=${cropRect.width} h=${cropRect.height} (source: ${rect ? "DOM" : "fallback"})`);
  const fullScreenshot = await captureVisibleTab();
  if (DEBUG.saveFullScreenshot) {
    await saveFullScreenshot(fullScreenshot, globalPageCounter);
    log(`Saved full screenshot for global page ${globalPageCounter}`);
  }
  const croppedDataUrl = await cropViaOffscreen(fullScreenshot, cropRect, devicePixelRatio);
  await savePageImage(croppedDataUrl, globalPageCounter);
  incrementCaptured();
  log(`Saved page-${String(globalPageCounter).padStart(3, "0")}.png`);
  broadcast();
  return isNextDisabled;
}
async function runCaptureLoop(lessonTarget = "all") {
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
    const totalLessons = await getLessonCount(tabId);
    log(`Found ${totalLessons} lesson(s) on the page`);
    let startLesson;
    let endLesson;
    if (lessonTarget === "all") {
      startLesson = 0;
      endLesson = totalLessons;
    } else {
      startLesson = lessonTarget - 1;
      endLesson = lessonTarget;
      if (startLesson < 0 || startLesson >= totalLessons) {
        throw new Error(`Lesson ${lessonTarget} not found (total: ${totalLessons})`);
      }
      log(`Capturing only lesson ${lessonTarget}`);
    }
    let globalPageCounter = 1;
    for (let lessonIdx = startLesson; lessonIdx < endLesson; lessonIdx++) {
      if (isStopRequested())
        break;
      log(`--- Processing lesson ${lessonIdx + 1} of ${totalLessons} ---`);
      log(`Navigating to first page of lesson ${lessonIdx + 1} (main world)...`);
      const goRes = await goToFirstInMainWorld(tabId, lessonIdx);
      if (goRes.success) {
        log(`Lesson ${lessonIdx + 1}: on page ${goRes.pageNumber ?? 1}`);
      } else {
        log(`Warning: go-to-first failed for lesson ${lessonIdx + 1}: ${goRes.error}. Continuing from current page.`);
      }
      await sleep(TIMING.postChangeDelay);
      let isLast = false;
      while (!isStopRequested()) {
        isLast = await captureSinglePage(tabId, lessonIdx, globalPageCounter);
        globalPageCounter++;
        if (isLast) {
          log(`Lesson ${lessonIdx + 1}: reached last page`);
          break;
        }
        if (isStopRequested())
          break;
        log(`Lesson ${lessonIdx + 1}: clicking Next (main world)...`);
        const oldPage = getState().currentPage;
        const nextRes = await clickNextInMainWorld(tabId, lessonIdx);
        if (!nextRes.clicked) {
          if (nextRes.isLast) {
            log(`Lesson ${lessonIdx + 1}: Next reports last page`);
            break;
          }
          throw new Error(nextRes.error || "Failed to click next");
        }
        await sleep(TIMING.pageChangePoll);
        const deadline = Date.now() + TIMING.pageChangeTimeout;
        let newPage = oldPage;
        while (Date.now() < deadline) {
          try {
            const info = await getPageInfo(tabId, lessonIdx);
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
            log(`Lesson ${lessonIdx + 1}: Next became disabled after click \u2014 last page`);
            break;
          }
          log(`Warning: page number didn't change (still ${oldPage}), continuing anyway`);
        } else {
          log(`Lesson ${lessonIdx + 1}: page changed to ${newPage}`);
        }
        await sleep(TIMING.postChangeDelay);
        await sleep(TIMING.interCycleDelay);
      }
    }
    if (isStopRequested()) {
      setStatus("stopped");
      log("Process stopped by user");
    } else {
      setStatus("completed");
      const lessonLabel = lessonTarget === "all" ? `${totalLessons} lesson(s)` : `lesson ${lessonTarget}`;
      log(`Completed! Captured ${getState().totalCaptured} pages from ${lessonLabel}`);
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
    await captureSinglePage(tabId, 0, 1);
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
        runCaptureLoop(message.lessonTarget ?? "all");
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
