/**
 * dom-adapter.ts — runs inside the CONTENT SCRIPT context.
 * Provides functions for interacting with the document viewer DOM.
 * Supports multiple lessons on the same page via lessonIndex parameter.
 */

import { SELECTORS, TIMING } from './config';
import type { PageInfo, DOMRectData, ClickNextResponse } from './types';

// ==================== Lesson-aware element finders ====================

/**
 * Get the Nth page-number button (0-based lessonIndex).
 */
function getPageNumberButton(lessonIndex: number): HTMLButtonElement | null {
  const all = document.querySelectorAll(SELECTORS.pageNumberButton);
  return (all[lessonIndex] as HTMLButtonElement) || null;
}

/**
 * Count how many lesson pagination controls exist on the page.
 */
export function getLessonCount(): number {
  return document.querySelectorAll(SELECTORS.pageNumberButton).length;
}

// ==================== React Fiber Helpers ====================

function getReactProps(el: HTMLElement): Record<string, unknown> | null {
  const key = Object.keys(el).find(
    (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
  );
  if (!key) return null;
  const fiber = (el as any)[key];
  return fiber?.memoizedProps || fiber?.pendingProps || null;
}

function isReactDisabled(el: HTMLElement): boolean {
  const props = getReactProps(el);
  if (props) {
    return props.disabled === true;
  }
  return (el as HTMLButtonElement).disabled;
}

function reactClick(el: HTMLElement): boolean {
  const props = getReactProps(el);
  if (props && typeof props.onClick === 'function') {
    console.log('[screener] Calling React onClick directly');
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

function clickButton(el: HTMLButtonElement): void {
  if (reactClick(el)) {
    console.log('[screener] Click via React onClick — success');
    return;
  }

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

function readPageNumber(lessonIndex: number): number {
  const btn = getPageNumberButton(lessonIndex);
  if (!btn) return 0;
  const text = btn.textContent?.trim() ?? '';
  const num = parseInt(text, 10);
  return isNaN(num) ? 0 : num;
}

// ==================== Button Finders ====================

function findNextButton(lessonIndex: number): HTMLButtonElement | null {
  const pageNumBtn = getPageNumberButton(lessonIndex);
  if (pageNumBtn) {
    // Next button is the sibling after the page-number button
    const sibling = pageNumBtn.nextElementSibling;
    if (sibling && sibling.tagName === 'BUTTON') {
      console.log(`[screener] Next button found for lesson ${lessonIndex} via nextElementSibling`);
      return sibling as HTMLButtonElement;
    }
    // Fallback: last button in the parent container
    const parent = pageNumBtn.parentElement;
    if (parent) {
      const buttons = parent.querySelectorAll('button');
      const btn = buttons[buttons.length - 1] as HTMLButtonElement | null;
      if (btn && btn !== pageNumBtn) {
        console.log(`[screener] Next button found for lesson ${lessonIndex} via parent traversal`);
        return btn;
      }
    }
  }

  console.warn(`[screener] Next button NOT found for lesson ${lessonIndex}`);
  return null;
}

function findPrevButton(lessonIndex: number): HTMLButtonElement | null {
  const pageNumBtn = getPageNumberButton(lessonIndex);
  if (pageNumBtn) {
    const sibling = pageNumBtn.previousElementSibling;
    if (sibling && sibling.tagName === 'BUTTON') return sibling as HTMLButtonElement;
    const parent = pageNumBtn.parentElement;
    if (parent) {
      const firstBtn = parent.querySelector('button');
      if (firstBtn && firstBtn !== pageNumBtn) return firstBtn as HTMLButtonElement;
    }
  }
  return null;
}

// ==================== Page Rect ====================

function getPageRect(lessonIndex: number): DOMRectData | null {
  // Get the Nth PDF page element
  const allPages = document.querySelectorAll(SELECTORS.pdfPage);
  let el: HTMLElement | null = (allPages[lessonIndex] as HTMLElement) || null;
  if (!el) {
    const allCanvases = document.querySelectorAll(SELECTORS.pdfCanvas);
    el = (allCanvases[lessonIndex] as HTMLElement) || null;
  }
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

  console.log(`[screener] Page rect for lesson ${lessonIndex}:`, { x, y, width, height });
  return { x, y, width, height };
}

async function ensurePageVisible(lessonIndex: number): Promise<void> {
  const allPages = document.querySelectorAll(SELECTORS.pdfPage);
  let el: HTMLElement | null = (allPages[lessonIndex] as HTMLElement) || null;
  if (!el) {
    const allCanvases = document.querySelectorAll(SELECTORS.pdfCanvas);
    el = (allCanvases[lessonIndex] as HTMLElement) || null;
  }
  if (!el) return;

  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  if (r.top < -10 || r.bottom > vh + 10) {
    el.scrollIntoView({ behavior: 'instant', block: 'start' });
    await sleep(300);
  }
}

// ==================== Disabled Check ====================

function isNextDisabled(lessonIndex: number): boolean {
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

// ==================== Exports ====================

export async function getPageInfo(lessonIndex: number = 0): Promise<PageInfo> {
  await ensurePageVisible(lessonIndex);

  const pageNumber = readPageNumber(lessonIndex);
  const rect = getPageRect(lessonIndex);
  const dpr = window.devicePixelRatio || 1;
  const nextDisabled = isNextDisabled(lessonIndex);

  console.log(`[screener] getPageInfo (lesson ${lessonIndex}):`, { pageNumber, hasRect: !!rect, dpr, nextDisabled });

  return { pageNumber, rect, devicePixelRatio: dpr, isNextDisabled: nextDisabled };
}

export async function clickNextAndWait(lessonIndex: number = 0): Promise<ClickNextResponse> {
  const nextBtn = findNextButton(lessonIndex);
  if (!nextBtn) {
    return { success: false, error: 'Next button not found' };
  }

  if (isReactDisabled(nextBtn)) {
    return { success: false, isLastPage: true, error: 'Next button is disabled (React state)' };
  }

  const oldPageNumber = readPageNumber(lessonIndex);
  const allPages = document.querySelectorAll(SELECTORS.pdfPage);
  const pageEl = allPages[lessonIndex];
  const oldDataPageNumber = pageEl?.getAttribute('data-page-number');
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
    const newDataAttr = currentPageEl?.getAttribute('data-page-number');
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

  return { success: false, error: 'Timeout waiting for page change' };
}

export async function goToFirstPage(lessonIndex: number = 0): Promise<{ success: boolean; pageNumber?: number; error?: string }> {
  const MAX_CLICKS = 200;
  let clicks = 0;

  while (clicks < MAX_CLICKS) {
    const prevBtn = findPrevButton(lessonIndex);
    if (!prevBtn) return { success: false, error: 'Prev button not found' };

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
      if (newPage !== oldPage && newPage > 0) break;
    }
    await sleep(200);
  }

  return { success: true, pageNumber: readPageNumber(lessonIndex) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
