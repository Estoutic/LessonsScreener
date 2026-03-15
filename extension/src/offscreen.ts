/**
 * offscreen.ts — offscreen document for image cropping.
 * MV3 service workers cannot use Canvas/Image, so we offload
 * image manipulation to this offscreen document.
 */

import { cropImage } from './crop';
import type { MsgCrop, CropResponse } from './types';

chrome.runtime.onMessage.addListener(
  (message: MsgCrop, _sender, sendResponse: (response: CropResponse) => void) => {
    if (message.type !== 'crop') return false;

    cropImage(message.dataUrl, message.rect, message.devicePixelRatio)
      .then((croppedDataUrl) => {
        sendResponse({ success: true, croppedDataUrl });
      })
      .catch((err) => {
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return true; // async
  },
);
