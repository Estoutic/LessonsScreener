import type { ContentMessage, PageInfoResponse, ClickNextResponse } from './types';

/**
 * Send a message to the content script running in the given tab.
 */
export async function sendToContentScript<T>(
  tabId: number,
  message: ContentMessage,
): Promise<T> {
  const [response] = await chrome.tabs.sendMessage(tabId, message)
    .then((r) => [r])
    .catch((err) => {
      throw new Error(`Content script communication failed: ${err.message}`);
    });
  return response as T;
}

/**
 * Broadcast state update to popup (if open).
 * Failures are silently ignored since popup may be closed.
 */
export function broadcastStateUpdate(state: import('./types').ProcessState): void {
  chrome.runtime.sendMessage({ type: 'state-update', state }).catch(() => {
    // popup not open — ignore
  });
}
