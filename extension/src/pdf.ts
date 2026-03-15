/**
 * pdf.ts — create PDF from an ordered array of image data URLs.
 * Runs in the offscreen document context (has access to Canvas/Image).
 *
 * Hand-built PDF with raw JPEG streams (DCTDecode).
 * No jsPDF — it re-encodes images internally, bloating file size.
 * This approach embeds JPEG bytes directly: ~100-300 KB per page.
 */

// ── Compression settings ──────────────────────────────────────
/** JPEG quality (0.0 – 1.0). 0.7 = good balance of quality/size */
const JPEG_QUALITY = 0.7;

/** Max image width in pixels. Retina screenshots are ~1090 px; 800 is plenty. */
const MAX_WIDTH_PX = 800;

// ── Image helpers ─────────────────────────────────────────────

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for PDF'));
    img.src = dataUrl;
  });
}

/** Convert PNG screenshot → compressed JPEG bytes + dimensions. */
function compressToJpeg(
  img: HTMLImageElement,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  let w = img.width;
  let h = img.height;

  if (MAX_WIDTH_PX > 0 && w > MAX_WIDTH_PX) {
    const scale = MAX_WIDTH_PX / w;
    w = MAX_WIDTH_PX;
    h = Math.round(img.height * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) { reject(new Error('toBlob returned null')); return; }
        blob.arrayBuffer().then((buf) => {
          resolve({ bytes: new Uint8Array(buf), width: w, height: h });
        }).catch(reject);
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

// ── Minimal PDF builder ───────────────────────────────────────

/** Encode string to UTF-8 bytes */
function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Concatenate multiple Uint8Arrays */
function concat(...arrays: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const a of arrays) len += a.length;
  const result = new Uint8Array(len);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

/**
 * Build a valid PDF 1.4 file from JPEG images.
 * Each JPEG becomes one page sized to its pixel dimensions (1 px = 1 user unit = 1/72 inch at 72 dpi).
 * We use 72 dpi mapping so the page sizes are reasonable.
 */
function buildPdf(
  images: { bytes: Uint8Array; width: number; height: number }[],
): Uint8Array {
  // We'll collect objects and track their byte offsets for the xref table.
  const objects: Uint8Array[] = [];
  const offsets: number[] = [];
  let bytePos = 0;

  const header = enc('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  bytePos = header.length;

  function addObj(content: string | Uint8Array): number {
    const objNum = objects.length + 1; // 1-based
    const prefix = enc(`${objNum} 0 obj\n`);
    const suffix = enc('\nendobj\n');
    const body = typeof content === 'string' ? enc(content) : content;
    offsets.push(bytePos);
    const obj = concat(prefix, body, suffix);
    objects.push(obj);
    bytePos += obj.length;
    return objNum;
  }

  function addStreamObj(dict: string, streamBytes: Uint8Array): number {
    const objNum = objects.length + 1;
    const prefix = enc(`${objNum} 0 obj\n`);
    const dictBytes = enc(dict + '\n');
    const streamStart = enc('stream\n');
    const streamEnd = enc('\nendstream');
    const suffix = enc('\nendobj\n');

    offsets.push(bytePos);
    const obj = concat(prefix, dictBytes, streamStart, streamBytes, streamEnd, suffix);
    objects.push(obj);
    bytePos += obj.length;
    return objNum;
  }

  // Object 1: Catalog
  const catalogNum = addObj('<< /Type /Catalog /Pages 2 0 R >>');

  // Object 2: Pages (placeholder — we'll fix it after building pages)
  const pagesPlaceholderIndex = objects.length; // will be index 1 (0-based)
  const pagesNum = addObj('PLACEHOLDER'); // replaced below

  // Build pages
  const pageObjNums: number[] = [];

  for (const img of images) {
    // Image XObject
    const imgDict =
      `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
      `/Filter /DCTDecode /Length ${img.bytes.length} >>`;
    const imgObjNum = addStreamObj(imgDict, img.bytes);

    // Page content stream: draw the image scaled to page size
    // PDF coordinate: origin bottom-left, units = points
    // Scale image to fill page: width x height points
    const w = img.width;
    const h = img.height;
    const contentStr = `q ${w} 0 0 ${h} 0 0 cm /Img Do Q`;
    const contentBytes = enc(contentStr);
    const contentDict = `<< /Length ${contentBytes.length} >>`;
    const contentObjNum = addStreamObj(contentDict, contentBytes);

    // Resources dictionary for this page
    const resourcesObjNum = addObj(
      `<< /XObject << /Img ${imgObjNum} 0 R >> >>`,
    );

    // Page object
    const pageObjNum = addObj(
      `<< /Type /Page /Parent ${pagesNum} 0 R ` +
      `/MediaBox [0 0 ${w} ${h}] ` +
      `/Contents ${contentObjNum} 0 R ` +
      `/Resources ${resourcesObjNum} 0 R >>`,
    );
    pageObjNums.push(pageObjNum);
  }

  // Fix Pages object (replace placeholder)
  const kidsStr = pageObjNums.map((n) => `${n} 0 R`).join(' ');
  const pagesContent = enc(
    `<< /Type /Pages /Kids [${kidsStr}] /Count ${pageObjNums.length} >>`,
  );
  // Recalculate: rebuild this object in-place
  const pagesPrefix = enc(`${pagesNum} 0 obj\n`);
  const pagesSuffix = enc('\nendobj\n');
  const newPagesObj = concat(pagesPrefix, pagesContent, pagesSuffix);

  // Adjust byte offsets: the placeholder was a different size
  const oldSize = objects[pagesPlaceholderIndex].length;
  const sizeDiff = newPagesObj.length - oldSize;
  objects[pagesPlaceholderIndex] = newPagesObj;

  // Shift all offsets after the pages object
  for (let i = pagesPlaceholderIndex + 1; i < offsets.length; i++) {
    offsets[i] += sizeDiff;
  }
  bytePos += sizeDiff;

  // Build xref table
  const xrefOffset = bytePos;
  const totalObjs = objects.length + 1; // +1 for object 0

  let xref = `xref\n0 ${totalObjs}\n`;
  xref += '0000000000 65535 f \n';
  for (const off of offsets) {
    xref += off.toString().padStart(10, '0') + ' 00000 n \n';
  }

  // Trailer
  xref += `trailer\n<< /Size ${totalObjs} /Root ${catalogNum} 0 R >>\n`;
  xref += `startxref\n${xrefOffset}\n%%EOF\n`;

  // Assemble everything
  const parts = [header, ...objects, enc(xref)];
  return concat(...parts);
}

// ── Public API ────────────────────────────────────────────────

/**
 * Create a PDF from an ordered array of image data URLs.
 * Returns PDF as a data URL.
 */
export async function createPdfFromImages(imageDataUrls: string[]): Promise<string> {
  if (imageDataUrls.length === 0) {
    throw new Error('No images to create PDF');
  }

  // Compress all images to JPEG
  const images: { bytes: Uint8Array; width: number; height: number }[] = [];
  for (const src of imageDataUrls) {
    const img = await loadImage(src);
    images.push(await compressToJpeg(img));
  }

  // Build PDF with raw JPEG streams
  const pdfBytes = buildPdf(images);

  // Convert to data URL
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to convert PDF to data URL'));
    reader.readAsDataURL(blob);
  });
}
