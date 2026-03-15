/**
 * service-worker.ts — orchestration hub.
 * Manages the capture loop, state, and communication between
 * popup, content script, and offscreen document.
 */

import { FALLBACK_CROP, TIMING, DEBUG } from './config';
import { log, logError, clearLogs } from './logger';
import {
  getState, setStatus, setCurrentPage, incrementCaptured,
  resetState, requestStop, isStopRequested, clearStopFlag,
} from './state';
import { captureVisibleTab } from './capture';
import { savePageImage, saveFullScreenshot } from './downloads';
import { broadcastStateUpdate } from './messages';
import type {
  PopupMessage, PageInfoResponse, ClickNextResponse, CropResponse,
  DOMRectData, MsgCrop, LessonCountResponse,
} from './types';

// ==================== Offscreen Document Management ====================

let offscreenCreated = false;

async function ensureOffscreen(): Promise<void> {
  if (offscreenCreated) return;

  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existingContexts.length > 0) {
    offscreenCreated = true;
    return;
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification: 'Crop screenshots using Canvas API (unavailable in service worker)',
  });
  offscreenCreated = true;
}

// ==================== Content Script Communication ====================

async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found');
  return tab.id;
}

async function getPageInfo(tabId: number, lessonIndex: number = 0): Promise<PageInfoResponse> {
  return chrome.tabs.sendMessage(tabId, { type: 'get-page-info', lessonIndex });
}

async function getLessonCount(tabId: number): Promise<number> {
  const res: LessonCountResponse = await chrome.tabs.sendMessage(tabId, { type: 'get-lesson-count' });
  if (res.success && typeof res.count === 'number') return res.count;
  return 1;
}

// ==================== Main World Execution ====================

const MAIN_WORLD_SELECTORS = {
  pageNumberButton: 'button[data-testid="page-number"]',
  nextButton: 'button[data-testid="page-number"] + button',
  toolbarContainer: 'div.MuiBox-root.css-5ax1kt',
  prevButton: 'div.MuiBox-root.css-5ax1kt > button:nth-of-type(1)',
};

/**
 * Click the Next button for a specific lesson in the page's main world context.
 */
async function clickNextInMainWorld(tabId: number, lessonIndex: number = 0): Promise<{ clicked: boolean; pageNumber: number; isLast: boolean; error?: string }> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (selectors: { pageNumberButton: string }, lessonIdx: number) => {
      function getPageNumBtn(): HTMLButtonElement | null {
        const all = document.querySelectorAll(selectors.pageNumberButton);
        return (all[lessonIdx] as HTMLButtonElement) || null;
      }

      function findNextButton(): HTMLButtonElement | null {
        const pageNumBtn = getPageNumBtn();
        if (!pageNumBtn) return null;
        const sibling = pageNumBtn.nextElementSibling;
        if (sibling && sibling.tagName === 'BUTTON') return sibling as HTMLButtonElement;
        const parent = pageNumBtn.parentElement;
        if (parent) {
          const buttons = parent.querySelectorAll('button');
          const btn = buttons[buttons.length - 1] as HTMLButtonElement | null;
          if (btn && btn !== pageNumBtn) return btn;
        }
        return null;
      }

      function readPageNumber(): number {
        const btn = getPageNumBtn();
        if (!btn) return 0;
        const num = parseInt(btn.textContent?.trim() ?? '', 10);
        return isNaN(num) ? 0 : num;
      }

      const btn = findNextButton();
      if (!btn) return { clicked: false, pageNumber: 0, isLast: true, error: 'Next button not found' };

      btn.click();

      const pageNumber = readPageNumber();
      const isLast = btn.disabled === true;
      return { clicked: true, pageNumber, isLast };
    },
    args: [{ pageNumberButton: MAIN_WORLD_SELECTORS.pageNumberButton }, lessonIndex],
  });

  return result.result as { clicked: boolean; pageNumber: number; isLast: boolean; error?: string };
}

/**
 * Navigate to the first page for a specific lesson by repeatedly clicking Prev in the main world.
 */
async function goToFirstInMainWorld(tabId: number, lessonIndex: number = 0): Promise<{ success: boolean; pageNumber?: number; error?: string }> {
  const MAX_CLICKS = 200;

  for (let i = 0; i < MAX_CLICKS; i++) {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (selectors: { pageNumberButton: string }, lessonIdx: number) => {
        function getPageNumBtn(): HTMLButtonElement | null {
          const all = document.querySelectorAll(selectors.pageNumberButton);
          return (all[lessonIdx] as HTMLButtonElement) || null;
        }

        function readPageNumber(): number {
          const btn = getPageNumBtn();
          if (!btn) return 0;
          const num = parseInt(btn.textContent?.trim() ?? '', 10);
          return isNaN(num) ? 0 : num;
        }

        const pageNumBtn = getPageNumBtn();
        let prevBtn: HTMLButtonElement | null = null;
        if (pageNumBtn) {
          const sibling = pageNumBtn.previousElementSibling;
          if (sibling && sibling.tagName === 'BUTTON') prevBtn = sibling as HTMLButtonElement;
          if (!prevBtn) {
            const parent = pageNumBtn.parentElement;
            if (parent) {
              const firstBtn = parent.querySelector('button');
              if (firstBtn && firstBtn !== pageNumBtn) prevBtn = firstBtn;
            }
          }
        }

        if (!prevBtn) return { atFirst: true, pageNumber: readPageNumber(), noPrevBtn: true };
        if (prevBtn.disabled) return { atFirst: true, pageNumber: readPageNumber(), noPrevBtn: false };

        prevBtn.click();
        return { atFirst: false, pageNumber: readPageNumber(), noPrevBtn: false };
      },
      args: [{ pageNumberButton: MAIN_WORLD_SELECTORS.pageNumberButton }, lessonIndex],
    });

    const res = result.result as { atFirst: boolean; pageNumber: number; noPrevBtn: boolean };

    if (res.atFirst) {
      return { success: true, pageNumber: res.pageNumber };
    }

    await sleep(TIMING.pageChangePoll * 2);
  }

  return { success: true, pageNumber: 1 };
}

// ==================== Crop via Offscreen ====================

async function cropViaOffscreen(
  dataUrl: string,
  rect: DOMRectData,
  devicePixelRatio: number,
): Promise<string> {
  await ensureOffscreen();

  const message: MsgCrop = {
    type: 'crop',
    dataUrl,
    rect,
    devicePixelRatio,
  };

  const response: CropResponse = await chrome.runtime.sendMessage(message);
  if (!response.success || !response.croppedDataUrl) {
    throw new Error(response.error || 'Crop failed');
  }
  return response.croppedDataUrl;
}

// ==================== Broadcast Helper ====================

function broadcast(): void {
  broadcastStateUpdate(getState());
}

// ==================== Check Next Disabled ====================

async function isNextDisabledMainWorld(tabId: number, lessonIndex: number = 0): Promise<boolean> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (selectors: { pageNumberButton: string }, lessonIdx: number) => {
        const all = document.querySelectorAll(selectors.pageNumberButton);
        const pageNumBtn = all[lessonIdx] as HTMLElement | null;
        if (!pageNumBtn) return true;
        const sibling = pageNumBtn.nextElementSibling;
        if (sibling && sibling.tagName === 'BUTTON') {
          return (sibling as HTMLButtonElement).disabled === true;
        }
        return true;
      },
      args: [{ pageNumberButton: MAIN_WORLD_SELECTORS.pageNumberButton }, lessonIndex],
    });
    return result.result as boolean;
  } catch {
    return true;
  }
}

// ==================== Capture Single Page ====================

async function captureSinglePage(tabId: number, lessonIndex: number, globalPageCounter: number): Promise<boolean> {
  // 1. Get page info from content script
  const pageInfoRes = await getPageInfo(tabId, lessonIndex);
  if (!pageInfoRes.success || !pageInfoRes.data) {
    throw new Error(pageInfoRes.error || 'Failed to get page info');
  }

  const { pageNumber, rect, devicePixelRatio } = pageInfoRes.data;
  const isNextDisabled = await isNextDisabledMainWorld(tabId, lessonIndex);
  const effectivePage = pageNumber || getState().currentPage + 1;
  setCurrentPage(effectivePage);
  broadcast();

  log(`Lesson ${lessonIndex + 1}, capturing page ${effectivePage} (dpr=${devicePixelRatio})`);

  // 2. Determine crop rect
  const cropRect = rect || FALLBACK_CROP;
  if (!rect) {
    log('DOM rect not found, using fallback coordinates');
  }
  log(`Crop rect: x=${cropRect.x} y=${cropRect.y} w=${cropRect.width} h=${cropRect.height} (source: ${rect ? 'DOM' : 'fallback'})`);

  // 3. Take screenshot
  const fullScreenshot = await captureVisibleTab();

  // 4. Debug: save full screenshot if enabled
  if (DEBUG.saveFullScreenshot) {
    await saveFullScreenshot(fullScreenshot, globalPageCounter);
    log(`Saved full screenshot for global page ${globalPageCounter}`);
  }

  // 5. Crop
  const croppedDataUrl = await cropViaOffscreen(fullScreenshot, cropRect, devicePixelRatio);

  // 6. Save cropped image with global page counter
  await savePageImage(croppedDataUrl, globalPageCounter);
  incrementCaptured();
  log(`Saved page-${String(globalPageCounter).padStart(3, '0')}.png`);
  broadcast();

  return isNextDisabled;
}

// ==================== Main Loop ====================

async function runCaptureLoop(lessonTarget: 'all' | number = 'all'): Promise<void> {
  clearStopFlag();
  clearLogs();
  resetState();
  setStatus('running');
  broadcast();

  const tabId = await getActiveTabId();
  log(`Starting capture on tab ${tabId}`);

  try {
    // Ensure content script is injected
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-script.js'],
    }).catch(() => {});

    await sleep(500);

    // Get total number of lessons on the page
    const totalLessons = await getLessonCount(tabId);
    log(`Found ${totalLessons} lesson(s) on the page`);

    // Determine which lessons to process
    let startLesson: number;
    let endLesson: number;
    if (lessonTarget === 'all') {
      startLesson = 0;
      endLesson = totalLessons;
    } else {
      // lessonTarget is 1-based
      startLesson = lessonTarget - 1;
      endLesson = lessonTarget;
      if (startLesson < 0 || startLesson >= totalLessons) {
        throw new Error(`Lesson ${lessonTarget} not found (total: ${totalLessons})`);
      }
      log(`Capturing only lesson ${lessonTarget}`);
    }

    let globalPageCounter = 1;

    // Process selected lessons sequentially
    for (let lessonIdx = startLesson; lessonIdx < endLesson; lessonIdx++) {
      if (isStopRequested()) break;

      log(`--- Processing lesson ${lessonIdx + 1} of ${totalLessons} ---`);

      // Navigate to first page for this lesson
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
        // Capture current page
        isLast = await captureSinglePage(tabId, lessonIdx, globalPageCounter);
        globalPageCounter++;

        if (isLast) {
          log(`Lesson ${lessonIdx + 1}: reached last page`);
          break;
        }

        if (isStopRequested()) break;

        // Click next in main world
        log(`Lesson ${lessonIdx + 1}: clicking Next (main world)...`);
        const oldPage = getState().currentPage;
        const nextRes = await clickNextInMainWorld(tabId, lessonIdx);

        if (!nextRes.clicked) {
          if (nextRes.isLast) {
            log(`Lesson ${lessonIdx + 1}: Next reports last page`);
            break;
          }
          throw new Error(nextRes.error || 'Failed to click next');
        }

        // Wait for page change to propagate
        await sleep(TIMING.pageChangePoll);

        // Poll for actual page number change
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
          } catch { /* ignore */ }
          await sleep(TIMING.pageChangePoll);
        }

        if (newPage === oldPage) {
          if (nextRes.isLast) {
            log(`Lesson ${lessonIdx + 1}: Next became disabled after click — last page`);
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
      setStatus('stopped');
      log('Process stopped by user');
    } else {
      setStatus('completed');
      const lessonLabel = lessonTarget === 'all' ? `${totalLessons} lesson(s)` : `lesson ${lessonTarget}`;
      log(`Completed! Captured ${getState().totalCaptured} pages from ${lessonLabel}`);
    }
  } catch (err) {
    logError('Capture loop failed', err);
    setStatus('error', err instanceof Error ? err.message : String(err));
  }

  broadcast();
}

// ==================== Test Capture ====================

async function testCapture(): Promise<void> {
  setStatus('running');
  broadcast();

  try {
    const tabId = await getActiveTabId();

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-script.js'],
    }).catch(() => {});

    await sleep(500);

    await captureSinglePage(tabId, 0, 1);
    setStatus('idle');
    log('Test capture completed');
  } catch (err) {
    logError('Test capture failed', err);
    setStatus('error', err instanceof Error ? err.message : String(err));
  }

  broadcast();
}

// ==================== Message Listener ====================

chrome.runtime.onMessage.addListener(
  (message: PopupMessage, _sender, sendResponse) => {
    switch (message.type) {
      case 'start':
        runCaptureLoop(message.lessonTarget ?? 'all');
        sendResponse({ ok: true });
        return false;

      case 'stop':
        requestStop();
        log('Stop requested');
        sendResponse({ ok: true });
        return false;

      case 'test-capture':
        testCapture();
        sendResponse({ ok: true });
        return false;

      case 'get-state':
        sendResponse({ state: getState() });
        return false;

      default:
        return false;
    }
  },
);

// ==================== Utility ====================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

log('Service worker loaded');
