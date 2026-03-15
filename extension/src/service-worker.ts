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
  DOMRectData, MsgCrop,
} from './types';

// ==================== Offscreen Document Management ====================

let offscreenCreated = false;

async function ensureOffscreen(): Promise<void> {
  if (offscreenCreated) return;

  // Check if already exists
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

async function getPageInfo(tabId: number): Promise<PageInfoResponse> {
  return chrome.tabs.sendMessage(tabId, { type: 'get-page-info' });
}

async function clickNext(tabId: number): Promise<ClickNextResponse> {
  return chrome.tabs.sendMessage(tabId, { type: 'click-next' });
}

// ==================== Main World Execution ====================
// Content script runs in Chrome's isolated world. React's event handlers
// live in the page's main world. Clicks dispatched from isolated world
// don't trigger React 18's event pipeline. We must execute clicks in
// the MAIN world using chrome.scripting.executeScript.

/**
 * Click the Next button in the page's main world context.
 * Returns { clicked, pageNumber, isLast }.
 */
async function clickNextInMainWorld(tabId: number): Promise<{ clicked: boolean; pageNumber: number; isLast: boolean; error?: string }> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (selectors: { pageNumberButton: string; nextButton: string; toolbarContainer: string }) => {
      // Find Next button using same strategies as dom-adapter
      function findNextButton(): HTMLButtonElement | null {
        let btn = document.querySelector(selectors.nextButton) as HTMLButtonElement | null;
        if (btn) return btn;

        const pageNumBtn = document.querySelector(selectors.pageNumberButton);
        if (pageNumBtn) {
          const parent = pageNumBtn.parentElement;
          if (parent) {
            const buttons = parent.querySelectorAll('button');
            btn = buttons[buttons.length - 1] as HTMLButtonElement | null;
            if (btn && btn !== pageNumBtn) return btn;
          }
          const sibling = pageNumBtn.nextElementSibling;
          if (sibling && sibling.tagName === 'BUTTON') return sibling as HTMLButtonElement;
        }

        const toolbar = document.querySelector(selectors.toolbarContainer);
        if (toolbar) {
          const buttons = toolbar.querySelectorAll('button');
          if (buttons.length >= 3) return buttons[2] as HTMLButtonElement;
        }
        return null;
      }

      function readPageNumber(): number {
        const btn = document.querySelector(selectors.pageNumberButton) as HTMLButtonElement | null;
        if (!btn) return 0;
        const num = parseInt(btn.textContent?.trim() ?? '', 10);
        return isNaN(num) ? 0 : num;
      }

      const btn = findNextButton();
      if (!btn) return { clicked: false, pageNumber: 0, isLast: true, error: 'Next button not found' };

      // In main world, .click() triggers React's event pipeline properly
      btn.click();

      const pageNumber = readPageNumber();
      // Check if button becomes disabled after click
      const isLast = btn.disabled === true;
      return { clicked: true, pageNumber, isLast };
    },
    args: [{ pageNumberButton: 'button[data-testid="page-number"]', nextButton: 'button[data-testid="page-number"] + button', toolbarContainer: 'div.MuiBox-root.css-5ax1kt' }],
  });

  return result.result as { clicked: boolean; pageNumber: number; isLast: boolean; error?: string };
}

/**
 * Navigate to the first page by repeatedly clicking Prev in the main world.
 */
async function goToFirstInMainWorld(tabId: number): Promise<{ success: boolean; pageNumber?: number; error?: string }> {
  const MAX_CLICKS = 200;

  for (let i = 0; i < MAX_CLICKS; i++) {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (selectors: { pageNumberButton: string; prevButton: string }) => {
        function readPageNumber(): number {
          const btn = document.querySelector(selectors.pageNumberButton) as HTMLButtonElement | null;
          if (!btn) return 0;
          const num = parseInt(btn.textContent?.trim() ?? '', 10);
          return isNaN(num) ? 0 : num;
        }

        // Find prev button
        const pageNumBtn = document.querySelector(selectors.pageNumberButton);
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
        if (!prevBtn) {
          prevBtn = document.querySelector(selectors.prevButton) as HTMLButtonElement | null;
        }

        if (!prevBtn) return { atFirst: true, pageNumber: readPageNumber(), noPrevBtn: true };
        if (prevBtn.disabled) return { atFirst: true, pageNumber: readPageNumber(), noPrevBtn: false };

        prevBtn.click();
        return { atFirst: false, pageNumber: readPageNumber(), noPrevBtn: false };
      },
      args: [{ pageNumberButton: 'button[data-testid="page-number"]', prevButton: 'div.MuiBox-root.css-5ax1kt > button:nth-of-type(1)' }],
    });

    const res = result.result as { atFirst: boolean; pageNumber: number; noPrevBtn: boolean };

    if (res.atFirst) {
      return { success: true, pageNumber: res.pageNumber };
    }

    // Wait for page change
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

// ==================== Capture Single Page ====================

async function isNextDisabledMainWorld(tabId: number): Promise<boolean> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (selectors: { nextButton: string; pageNumberButton: string; toolbarContainer: string }) => {
        let btn: HTMLButtonElement | null = document.querySelector(selectors.nextButton);
        if (!btn) {
          const pageNumBtn = document.querySelector(selectors.pageNumberButton);
          if (pageNumBtn) {
            const sibling = pageNumBtn.nextElementSibling;
            if (sibling && sibling.tagName === 'BUTTON') btn = sibling as HTMLButtonElement;
          }
        }
        if (!btn) return true;
        return btn.disabled === true;
      },
      args: [{ nextButton: 'button[data-testid="page-number"] + button', pageNumberButton: 'button[data-testid="page-number"]', toolbarContainer: 'div.MuiBox-root.css-5ax1kt' }],
    });
    return result.result as boolean;
  } catch {
    return true;
  }
}

async function captureSinglePage(tabId: number): Promise<boolean> {
  // 1. Get page info from content script (rect, page number — works from isolated world)
  const pageInfoRes = await getPageInfo(tabId);
  if (!pageInfoRes.success || !pageInfoRes.data) {
    throw new Error(pageInfoRes.error || 'Failed to get page info');
  }

  const { pageNumber, rect, devicePixelRatio } = pageInfoRes.data;
  // Check Next disabled state from main world (React-aware)
  const isNextDisabled = await isNextDisabledMainWorld(tabId);
  const effectivePage = pageNumber || getState().currentPage + 1;
  setCurrentPage(effectivePage);
  broadcast();

  log(`Capturing page ${effectivePage} (dpr=${devicePixelRatio})`);

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
    await saveFullScreenshot(fullScreenshot, effectivePage);
    log(`Saved full screenshot for page ${effectivePage}`);
  }

  // 5. Crop
  const croppedDataUrl = await cropViaOffscreen(fullScreenshot, cropRect, devicePixelRatio);

  // 6. Save cropped image
  await savePageImage(croppedDataUrl, effectivePage);
  incrementCaptured();
  log(`Saved page-${String(effectivePage).padStart(3, '0')}.png`);
  broadcast();

  return isNextDisabled;
}

// ==================== Main Loop ====================

async function runCaptureLoop(): Promise<void> {
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
    }).catch(() => {
      // May already be injected via manifest — ignore error
    });

    // Small delay to let content script initialize
    await sleep(500);

    // Navigate to first page before starting (main world for React compatibility)
    log('Navigating to first page (main world)...');
    const goRes = await goToFirstInMainWorld(tabId);
    if (goRes.success) {
      log(`On page ${goRes.pageNumber ?? 1}`);
    } else {
      log(`Warning: go-to-first failed: ${goRes.error}. Continuing from current page.`);
    }
    await sleep(TIMING.postChangeDelay);

    let isLast = false;

    while (!isStopRequested()) {
      // Capture current page
      isLast = await captureSinglePage(tabId);

      if (isLast) {
        log('Reached last page');
        break;
      }

      if (isStopRequested()) break;

      // Click next in main world (React event system)
      log('Clicking Next (main world)...');
      const oldPage = getState().currentPage;
      const nextRes = await clickNextInMainWorld(tabId);

      if (!nextRes.clicked) {
        if (nextRes.isLast) {
          log('Next reports last page');
          break;
        }
        throw new Error(nextRes.error || 'Failed to click next');
      }

      // Wait for page change to propagate
      await sleep(TIMING.pageChangePoll);

      // Poll for actual page number change via content script (isolated world reads DOM fine)
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
        } catch { /* ignore */ }
        await sleep(TIMING.pageChangePoll);
      }

      if (newPage === oldPage) {
        // Check if next became disabled (we're on last page)
        if (nextRes.isLast) {
          log('Next became disabled after click — last page');
          break;
        }
        log(`Warning: page number didn't change (still ${oldPage}), continuing anyway`);
      } else {
        log(`Page changed to ${newPage}`);
      }

      // Post-change stabilization delay
      await sleep(TIMING.postChangeDelay);

      // Inter-cycle delay
      await sleep(TIMING.interCycleDelay);
    }

    if (isStopRequested()) {
      setStatus('stopped');
      log('Process stopped by user');
    } else {
      setStatus('completed');
      log(`Completed! Captured ${getState().totalCaptured} pages`);
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

    // Ensure content script
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-script.js'],
    }).catch(() => {});

    await sleep(500);

    await captureSinglePage(tabId);
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
        runCaptureLoop();
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
