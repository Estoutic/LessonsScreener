/**
 * downloads.ts — save files via chrome.downloads API.
 * Runs in the service worker context.
 */

import { DOWNLOAD_CONFIG } from './config';

/**
 * Save a data URL as a PNG file via Chrome downloads.
 * @param dataUrl Image data URL
 * @param pageNumber Page number for file naming
 * @returns Download ID
 */
export async function savePageImage(dataUrl: string, pageNumber: number): Promise<number> {
  const paddedNum = String(pageNumber).padStart(DOWNLOAD_CONFIG.padDigits, '0');
  const filename = DOWNLOAD_CONFIG.subfolder
    ? `${DOWNLOAD_CONFIG.subfolder}/${DOWNLOAD_CONFIG.filePrefix}-${paddedNum}.png`
    : `${DOWNLOAD_CONFIG.filePrefix}-${paddedNum}.png`;

  const downloadId = await chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: false,
    conflictAction: 'uniquify',
  });

  return downloadId;
}

/**
 * Save a full (uncropped) screenshot for debugging.
 */
export async function saveFullScreenshot(dataUrl: string, pageNumber: number): Promise<number> {
  const paddedNum = String(pageNumber).padStart(DOWNLOAD_CONFIG.padDigits, '0');
  const filename = DOWNLOAD_CONFIG.subfolder
    ? `${DOWNLOAD_CONFIG.subfolder}/full-${DOWNLOAD_CONFIG.filePrefix}-${paddedNum}.png`
    : `full-${DOWNLOAD_CONFIG.filePrefix}-${paddedNum}.png`;

  return chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: false,
    conflictAction: 'uniquify',
  });
}
