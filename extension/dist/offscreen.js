"use strict";
(() => {
  // src/crop.ts
  function cropImage(dataUrl, rect, dpr) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const sx = Math.round(rect.x * dpr);
          const sy = Math.round(rect.y * dpr);
          const sw = Math.round(rect.width * dpr);
          const sh = Math.round(rect.height * dpr);
          const clampedX = Math.max(0, sx);
          const clampedY = Math.max(0, sy);
          const clampedW = Math.min(sw, img.width - clampedX);
          const clampedH = Math.min(sh, img.height - clampedY);
          if (clampedW <= 0 || clampedH <= 0) {
            reject(new Error(`Invalid crop dimensions: ${clampedW}x${clampedH} at (${clampedX},${clampedY})`));
            return;
          }
          const canvas = document.createElement("canvas");
          canvas.width = clampedW;
          canvas.height = clampedH;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Failed to get canvas 2d context"));
            return;
          }
          ctx.drawImage(
            img,
            clampedX,
            clampedY,
            clampedW,
            clampedH,
            0,
            0,
            clampedW,
            clampedH
          );
          resolve(canvas.toDataURL("image/png"));
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error("Failed to load image for cropping"));
      img.src = dataUrl;
    });
  }

  // src/offscreen.ts
  chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {
      if (message.type !== "crop")
        return false;
      cropImage(message.dataUrl, message.rect, message.devicePixelRatio).then((croppedDataUrl) => {
        sendResponse({ success: true, croppedDataUrl });
      }).catch((err) => {
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : String(err)
        });
      });
      return true;
    }
  );
})();
