/**
 * capture.ts — screenshot capture via chrome.tabs API.
 * Runs in the service worker context.
 */

/**
 * Capture the visible area of a tab as a PNG data URL.
 */
export async function captureVisibleTab(windowId?: number): Promise<string> {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId ?? chrome.windows.WINDOW_ID_CURRENT, {
    format: 'png',
  });
  return dataUrl;
}
