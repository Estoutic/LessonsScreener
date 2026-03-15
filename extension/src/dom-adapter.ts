/**
 * dom-adapter.ts — runs inside the CONTENT SCRIPT context.
 * Provides functions for interacting with the document viewer DOM.
 */

import { SELECTORS, TIMING } from './config';
import type { PageInfo, DOMRectData, ClickNextResponse } from './types';

// ==================== React Fiber Helpers ====================

/**
 * Get React fiber props from a DOM element.
 * React stores internal fiber on DOM nodes as __reactFiber$xxx or __reactInternalInstance$xxx.
 * The fiber's memoizedProps contains the actual React props including onClick.
 */
function getReactProps(el: HTMLElement): Record<string, unknown> | null {
  const key = Object.keys(el).find(
    (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
  );
  if (!key) return null;
  const fiber = (el as any)[key];
  return fiber?.memoizedProps || fiber?.pendingProps || null;
}

/**
 * Check if a button is disabled according to React (not DOM attribute).
 * The DOM may have disabled="" even when React's props say disabled: undefined.
 */
function isReactDisabled(el: HTMLElement): boolean {
  const props = getReactProps(el);
  if (props) {
    // React explicitly sets disabled: true when it means disabled
    // disabled: undefined or disabled: false means enabled
    return props.disabled === true;
  }
  // Fallback to DOM if no React fiber found
  return (el as HTMLButtonElement).disabled;
}

/**
 * Call React's onClick handler directly from fiber props.
 * This bypasses the DOM disabled attribute which may be out of sync.
 */
function reactClick(el: HTMLElement): boolean {
  const props = getReactProps(el);
  if (props && typeof props.onClick === 'function') {
    console.log('[screener] Calling React onClick directly');
    // Create a minimal synthetic-like event object
    const syntheticEvent = {
      type: 'click',
      target: el,
      currentTarget: el,
      preventDefault: () => {},
      stopPropagation: () => {},
      nativeEvent: new MouseEvent('click', { bubbles: true }),
    };
    try {
      (props.onClick as Function)(syntheticEvent);
      return true;
    } catch (err) {
      console.error('[screener] React onClick threw:', err);
    }
  }
  return false;
}

// ==================== Click Strategy ====================

/**
 * Click a button using the best available strategy:
 * 1. Call React onClick directly (bypasses DOM disabled)
 * 2. Remove disabled, dispatch events, restore disabled
 * 3. Standard simulateClick as last resort
 */
function clickButton(el: HTMLButtonElement): void {
  // Strategy 1: React onClick direct call
  if (reactClick(el)) {
    console.log('[screener] Click via React onClick — success');
    return;
  }

  // Strategy 2: temporarily remove disabled, simulate events
  const wasDisabled = el.disabled;
  if (wasDisabled) {
    el.removeAttribute('disabled');
    el.disabled = false;
    console.log('[screener] Temporarily removed disabled attribute');
  }

  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  const common: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: cx,
    clientY: cy,
  };

  el.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerId: 1 }));
  el.dispatchEvent(new MouseEvent('mousedown', common));
  el.dispatchEvent(new PointerEvent('pointerup', { ...common, pointerId: 1 }));
  el.dispatchEvent(new MouseEvent('mouseup', common));
  el.dispatchEvent(new MouseEvent('click', common));

  console.log(`[screener] simulateClick on <${el.tagName}> at (${cx.toFixed(0)}, ${cy.toFixed(0)})`);
}

// ==================== Page Number ====================

function readPageNumber(): number {
  const btn = document.querySelector(SELECTORS.pageNumberButton) as HTMLButtonElement | null;
  if (!btn) return 0;
  const text = btn.textContent?.trim() ?? '';
  const num = parseInt(text, 10);
  return isNaN(num) ? 0 : num;
}

// ==================== Button Finders ====================

function findNextButton(): HTMLButtonElement | null {
  // Strategy 1: CSS adjacent sibling
  let btn = document.querySelector(SELECTORS.nextButton) as HTMLButtonElement | null;
  if (btn) {
    console.log('[screener] Next button found via adjacent sibling');
    return btn;
  }

  // Strategy 2: via page-number button
  const pageNumBtn = document.querySelector(SELECTORS.pageNumberButton);
  if (pageNumBtn) {
    const parent = pageNumBtn.parentElement;
    if (parent) {
      const buttons = parent.querySelectorAll('button');
      btn = buttons[buttons.length - 1] as HTMLButtonElement | null;
      if (btn && btn !== pageNumBtn) {
        console.log('[screener] Next button found via parent traversal');
        return btn;
      }
    }
    const sibling = pageNumBtn.nextElementSibling;
    if (sibling && sibling.tagName === 'BUTTON') {
      console.log('[screener] Next button found via nextElementSibling');
      return sibling as HTMLButtonElement;
    }
  }

  // Strategy 3: toolbar container fallback
  const toolbar = document.querySelector(SELECTORS.toolbarContainer);
  if (toolbar) {
    const buttons = toolbar.querySelectorAll('button');
    if (buttons.length >= 3) {
      console.log('[screener] Next button found via toolbar fallback');
      return buttons[2] as HTMLButtonElement;
    }
  }

  console.warn('[screener] Next button NOT found');
  return null;
}

function findPrevButton(): HTMLButtonElement | null {
  const pageNumBtn = document.querySelector(SELECTORS.pageNumberButton);
  if (pageNumBtn) {
    const sibling = pageNumBtn.previousElementSibling;
    if (sibling && sibling.tagName === 'BUTTON') return sibling as HTMLButtonElement;
    const parent = pageNumBtn.parentElement;
    if (parent) {
      const firstBtn = parent.querySelector('button');
      if (firstBtn && firstBtn !== pageNumBtn) return firstBtn as HTMLButtonElement;
    }
  }
  return document.querySelector(SELECTORS.prevButton) as HTMLButtonElement | null;
}

// ==================== Page Rect ====================

function getPageRect(): DOMRectData | null {
  let el: HTMLElement | null = document.querySelector(SELECTORS.pdfPage);
  if (!el) el = document.querySelector(SELECTORS.pdfCanvas);
  if (!el) return null;

  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const x = Math.max(0, r.left);
  const y = Math.max(0, r.top);
  const right = Math.min(vw, r.right);
  const bottom = Math.min(vh, r.bottom);
  const width = right - x;
  const height = bottom - y;

  if (width <= 0 || height <= 0) return null;

  console.log('[screener] Page rect:', { x, y, width, height });
  return { x, y, width, height };
}

async function ensurePageVisible(): Promise<void> {
  const el: HTMLElement | null =
    document.querySelector(SELECTORS.pdfPage) ||
    document.querySelector(SELECTORS.pdfCanvas);
  if (!el) return;

  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  if (r.top < -10 || r.bottom > vh + 10) {
    el.scrollIntoView({ behavior: 'instant', block: 'start' });
    await sleep(300);
  }
}

// ==================== Disabled Check ====================

/**
 * Check if Next button is truly disabled.
 * Uses React fiber props, NOT DOM disabled attribute.
 */
function isNextDisabled(): boolean {
  const btn = findNextButton();
  if (!btn) {
    console.warn('[screener] isNextDisabled: button not found');
    return true;
  }

  const reactDisabled = isReactDisabled(btn);
  const domDisabled = btn.disabled;
  console.log(`[screener] Next: reactDisabled=${reactDisabled}, domDisabled=${domDisabled}`);

  // Trust React state over DOM attribute
  return reactDisabled;
}

// ==================== Exports ====================

export async function getPageInfo(): Promise<PageInfo> {
  await ensurePageVisible();

  const pageNumber = readPageNumber();
  const rect = getPageRect();
  const dpr = window.devicePixelRatio || 1;
  const nextDisabled = isNextDisabled();

  console.log('[screener] getPageInfo:', { pageNumber, hasRect: !!rect, dpr, nextDisabled });

  return { pageNumber, rect, devicePixelRatio: dpr, isNextDisabled: nextDisabled };
}

export async function clickNextAndWait(): Promise<ClickNextResponse> {
  const nextBtn = findNextButton();
  if (!nextBtn) {
    return { success: false, error: 'Next button not found' };
  }

  // Use React state for disabled check, not DOM
  if (isReactDisabled(nextBtn)) {
    return { success: false, isLastPage: true, error: 'Next button is disabled (React state)' };
  }

  const oldPageNumber = readPageNumber();
  const oldDataPageNumber = document.querySelector(SELECTORS.pdfPage)?.getAttribute('data-page-number');
  const oldRect = getPageRect();

  console.log(`[screener] Clicking Next (current page: ${oldPageNumber})`);
  clickButton(nextBtn);

  // Wait for change
  const deadline = Date.now() + TIMING.pageChangeTimeout;

  while (Date.now() < deadline) {
    await sleep(TIMING.pageChangePoll);

    const newPageNumber = readPageNumber();
    if (newPageNumber > 0 && newPageNumber !== oldPageNumber) {
      return { success: true, newPageNumber };
    }

    const newDataAttr = document.querySelector(SELECTORS.pdfPage)?.getAttribute('data-page-number');
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

  return { success: false, error: 'Timeout waiting for page change' };
}

export async function goToFirstPage(): Promise<{ success: boolean; pageNumber?: number; error?: string }> {
  const MAX_CLICKS = 200;
  let clicks = 0;

  while (clicks < MAX_CLICKS) {
    const prevBtn = findPrevButton();
    if (!prevBtn) return { success: false, error: 'Prev button not found' };

    // Check React disabled, not DOM
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
      if (newPage !== oldPage && newPage > 0) break;
    }
    await sleep(200);
  }

  return { success: true, pageNumber: readPageNumber() };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
