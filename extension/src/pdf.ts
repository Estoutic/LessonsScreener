/**
 * pdf.ts — create PDF from an ordered array of PNG data URLs.
 * Runs in the offscreen document context (has access to Canvas/Image).
 * Uses jsPDF for PDF generation.
 */

import { jsPDF } from 'jspdf';

/**
 * Load an image data URL and return its natural dimensions.
 */
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for PDF'));
    img.src = dataUrl;
  });
}

/**
 * Create a PDF from an ordered array of PNG data URLs.
 * Each image becomes one page, sized to fit the image dimensions.
 * @returns PDF as a data URL (application/pdf;base64,...)
 */
export async function createPdfFromImages(imageDataUrls: string[]): Promise<string> {
  if (imageDataUrls.length === 0) {
    throw new Error('No images to create PDF');
  }

  // Load first image to determine initial page size
  const firstImg = await loadImage(imageDataUrls[0]);

  // Use image dimensions in points (1px ≈ 0.75pt at 96dpi)
  // jsPDF uses mm by default; convert px to mm (1px ≈ 0.2646mm at 96dpi)
  const pxToMm = 0.2646;

  const doc = new jsPDF({
    orientation: firstImg.width > firstImg.height ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [firstImg.width * pxToMm, firstImg.height * pxToMm],
  });

  for (let i = 0; i < imageDataUrls.length; i++) {
    const img = i === 0 ? firstImg : await loadImage(imageDataUrls[i]);
    const w = img.width * pxToMm;
    const h = img.height * pxToMm;

    if (i > 0) {
      doc.addPage([w, h], w > h ? 'landscape' : 'portrait');
    }

    doc.addImage(imageDataUrls[i], 'PNG', 0, 0, w, h);
  }

  // Output as data URL
  const pdfBlob = doc.output('blob');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to convert PDF blob to data URL'));
    reader.readAsDataURL(pdfBlob);
  });
}
