/**
 * offscreen.ts — offscreen document for image cropping and PDF creation.
 * MV3 service workers cannot use Canvas/Image, so we offload
 * image manipulation to this offscreen document.
 */

import { cropImage } from './crop';
import { createPdfFromImages } from './pdf';
import type { OffscreenMessage, CropResponse, PdfResponse } from './types';

chrome.runtime.onMessage.addListener(
  (message: OffscreenMessage, _sender, sendResponse: (response: CropResponse | PdfResponse) => void) => {
    if (message.type === 'crop') {
      cropImage(message.dataUrl, message.rect, message.devicePixelRatio)
        .then((croppedDataUrl) => {
          sendResponse({ success: true, croppedDataUrl } as CropResponse);
        })
        .catch((err) => {
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          } as CropResponse);
        });
      return true;
    }

    if (message.type === 'create-pdf') {
      createPdfFromImages(message.imageDataUrls)
        .then((pdfDataUrl) => {
          sendResponse({ success: true, pdfDataUrl } as PdfResponse);
        })
        .catch((err) => {
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          } as PdfResponse);
        });
      return true;
    }

    return false;
  },
);
