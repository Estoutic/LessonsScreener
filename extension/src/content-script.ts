/**
 * content-script.ts — injected into pages matching kiber-one.pro.
 * Listens for messages from the service worker and delegates to dom-adapter.
 *
 * Guard: may be loaded twice (manifest content_scripts + chrome.scripting.executeScript).
 * The guard prevents duplicate message listeners.
 */

import { getPageInfo, clickNextAndWait, goToFirstPage, getLessonCount } from './dom-adapter';
import type { ContentMessage, PageInfoResponse, ClickNextResponse, GoToFirstResponse, LessonCountResponse } from './types';

declare global {
  interface Window {
    __screener_loaded?: boolean;
  }
}

if (!window.__screener_loaded) {
  window.__screener_loaded = true;

  chrome.runtime.onMessage.addListener(
    (message: ContentMessage, _sender, sendResponse: (response: unknown) => void) => {
      if (message.type === 'get-page-info') {
        const lessonIndex = message.lessonIndex ?? 0;
        getPageInfo(lessonIndex)
          .then((info) => sendResponse({ success: true, data: info } as PageInfoResponse))
          .catch((err) =>
            sendResponse({
              success: false,
              error: err instanceof Error ? err.message : String(err),
            } as PageInfoResponse),
          );
        return true;
      }

      if (message.type === 'click-next') {
        const lessonIndex = message.lessonIndex ?? 0;
        clickNextAndWait(lessonIndex)
          .then((result) => sendResponse(result))
          .catch((err) =>
            sendResponse({
              success: false,
              error: err instanceof Error ? err.message : String(err),
            } as ClickNextResponse),
          );
        return true;
      }

      if (message.type === 'go-to-first') {
        const lessonIndex = message.lessonIndex ?? 0;
        goToFirstPage(lessonIndex)
          .then((result) => sendResponse(result))
          .catch((err) =>
            sendResponse({
              success: false,
              error: err instanceof Error ? err.message : String(err),
            } as GoToFirstResponse),
          );
        return true;
      }

      if (message.type === 'get-lesson-count') {
        const count = getLessonCount();
        sendResponse({ success: true, count } as LessonCountResponse);
        return false;
      }

      return false;
    },
  );

  console.log('[screener] Content script loaded');
}
