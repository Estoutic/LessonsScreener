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

  // src/pdf.ts
  var JPEG_QUALITY = 0.7;
  var MAX_WIDTH_PX = 800;
  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load image for PDF"));
      img.src = dataUrl;
    });
  }
  function compressToJpeg(img) {
    let w = img.width;
    let h = img.height;
    if (MAX_WIDTH_PX > 0 && w > MAX_WIDTH_PX) {
      const scale = MAX_WIDTH_PX / w;
      w = MAX_WIDTH_PX;
      h = Math.round(img.height * scale);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("toBlob returned null"));
            return;
          }
          blob.arrayBuffer().then((buf) => {
            resolve({ bytes: new Uint8Array(buf), width: w, height: h });
          }).catch(reject);
        },
        "image/jpeg",
        JPEG_QUALITY
      );
    });
  }
  function enc(s) {
    return new TextEncoder().encode(s);
  }
  function concat(...arrays) {
    let len = 0;
    for (const a of arrays)
      len += a.length;
    const result = new Uint8Array(len);
    let offset = 0;
    for (const a of arrays) {
      result.set(a, offset);
      offset += a.length;
    }
    return result;
  }
  function buildPdf(images) {
    const objects = [];
    const offsets = [];
    let bytePos = 0;
    const header = enc("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    bytePos = header.length;
    function addObj(content) {
      const objNum = objects.length + 1;
      const prefix = enc(`${objNum} 0 obj
`);
      const suffix = enc("\nendobj\n");
      const body = typeof content === "string" ? enc(content) : content;
      offsets.push(bytePos);
      const obj = concat(prefix, body, suffix);
      objects.push(obj);
      bytePos += obj.length;
      return objNum;
    }
    function addStreamObj(dict, streamBytes) {
      const objNum = objects.length + 1;
      const prefix = enc(`${objNum} 0 obj
`);
      const dictBytes = enc(dict + "\n");
      const streamStart = enc("stream\n");
      const streamEnd = enc("\nendstream");
      const suffix = enc("\nendobj\n");
      offsets.push(bytePos);
      const obj = concat(prefix, dictBytes, streamStart, streamBytes, streamEnd, suffix);
      objects.push(obj);
      bytePos += obj.length;
      return objNum;
    }
    const catalogNum = addObj("<< /Type /Catalog /Pages 2 0 R >>");
    const pagesPlaceholderIndex = objects.length;
    const pagesNum = addObj("PLACEHOLDER");
    const pageObjNums = [];
    for (const img of images) {
      const imgDict = `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>`;
      const imgObjNum = addStreamObj(imgDict, img.bytes);
      const w = img.width;
      const h = img.height;
      const contentStr = `q ${w} 0 0 ${h} 0 0 cm /Img Do Q`;
      const contentBytes = enc(contentStr);
      const contentDict = `<< /Length ${contentBytes.length} >>`;
      const contentObjNum = addStreamObj(contentDict, contentBytes);
      const resourcesObjNum = addObj(
        `<< /XObject << /Img ${imgObjNum} 0 R >> >>`
      );
      const pageObjNum = addObj(
        `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${contentObjNum} 0 R /Resources ${resourcesObjNum} 0 R >>`
      );
      pageObjNums.push(pageObjNum);
    }
    const kidsStr = pageObjNums.map((n) => `${n} 0 R`).join(" ");
    const pagesContent = enc(
      `<< /Type /Pages /Kids [${kidsStr}] /Count ${pageObjNums.length} >>`
    );
    const pagesPrefix = enc(`${pagesNum} 0 obj
`);
    const pagesSuffix = enc("\nendobj\n");
    const newPagesObj = concat(pagesPrefix, pagesContent, pagesSuffix);
    const oldSize = objects[pagesPlaceholderIndex].length;
    const sizeDiff = newPagesObj.length - oldSize;
    objects[pagesPlaceholderIndex] = newPagesObj;
    for (let i = pagesPlaceholderIndex + 1; i < offsets.length; i++) {
      offsets[i] += sizeDiff;
    }
    bytePos += sizeDiff;
    const xrefOffset = bytePos;
    const totalObjs = objects.length + 1;
    let xref = `xref
0 ${totalObjs}
`;
    xref += "0000000000 65535 f \n";
    for (const off of offsets) {
      xref += off.toString().padStart(10, "0") + " 00000 n \n";
    }
    xref += `trailer
<< /Size ${totalObjs} /Root ${catalogNum} 0 R >>
`;
    xref += `startxref
${xrefOffset}
%%EOF
`;
    const parts = [header, ...objects, enc(xref)];
    return concat(...parts);
  }
  async function createPdfFromImages(imageDataUrls) {
    if (imageDataUrls.length === 0) {
      throw new Error("No images to create PDF");
    }
    const images = [];
    for (const src of imageDataUrls) {
      const img = await loadImage(src);
      images.push(await compressToJpeg(img));
    }
    const pdfBytes = buildPdf(images);
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Failed to convert PDF to data URL"));
      reader.readAsDataURL(blob);
    });
  }

  // src/offscreen.ts
  chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {
      if (message.type === "crop") {
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
      if (message.type === "create-pdf") {
        createPdfFromImages(message.imageDataUrls).then((pdfDataUrl) => {
          sendResponse({ success: true, pdfDataUrl });
        }).catch((err) => {
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err)
          });
        });
        return true;
      }
      return false;
    }
  );
})();
