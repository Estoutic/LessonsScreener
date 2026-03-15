/**
 * crop.ts — image cropping logic.
 * This module provides the pure cropping function used by the offscreen document.
 * In MV3, service workers have no access to Canvas/Image APIs,
 * so cropping is done in an offscreen document that has a full DOM.
 */

import type { DOMRectData } from './types';

/**
 * Crop a PNG data URL to the specified rectangle.
 * @param dataUrl Full screenshot as data URL
 * @param rect Crop area in CSS pixels
 * @param dpr Device pixel ratio for coordinate scaling
 * @returns Cropped image as data URL
 */
export function cropImage(
  dataUrl: string,
  rect: DOMRectData,
  dpr: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        // Scale CSS rect to device pixels
        const sx = Math.round(rect.x * dpr);
        const sy = Math.round(rect.y * dpr);
        const sw = Math.round(rect.width * dpr);
        const sh = Math.round(rect.height * dpr);

        // Clamp to image bounds
        const clampedX = Math.max(0, sx);
        const clampedY = Math.max(0, sy);
        const clampedW = Math.min(sw, img.width - clampedX);
        const clampedH = Math.min(sh, img.height - clampedY);

        if (clampedW <= 0 || clampedH <= 0) {
          reject(new Error(`Invalid crop dimensions: ${clampedW}x${clampedH} at (${clampedX},${clampedY})`));
          return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = clampedW;
        canvas.height = clampedH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas 2d context'));
          return;
        }

        ctx.drawImage(
          img,
          clampedX, clampedY, clampedW, clampedH,
          0, 0, clampedW, clampedH,
        );

        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Failed to load image for cropping'));
    img.src = dataUrl;
  });
}
