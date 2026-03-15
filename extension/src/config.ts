import type { DOMRectData } from './types';

// ==================== DOM Selectors ====================

export const SELECTORS = {
  /** Button showing current page number — stable data-testid anchor */
  pageNumberButton: 'button[data-testid="page-number"]',

  /**
   * Next page button: sibling immediately after the page-number button.
   * Uses CSS adjacent sibling selector — independent of MUI class names.
   */
  nextButton: 'button[data-testid="page-number"] + button',

  /**
   * Toolbar container — MUI class, may change between deploys.
   * Used only as fallback for prev/next if sibling selectors fail.
   */
  toolbarContainer: 'div.MuiBox-root.css-5ax1kt',

  /** Previous page button — fallback via toolbar container */
  prevButton: 'div.MuiBox-root.css-5ax1kt > button:nth-of-type(1)',

  /** PDF page container (primary target for crop rect) */
  pdfPage: 'div.react-pdf__Page[data-page-number]',

  /** PDF page canvas (alternative target) */
  pdfCanvas: '.react-pdf__Page__canvas',
} as const;

// ==================== Fallback Crop Coordinates ====================
// Used when DOM element is not found. Values in CSS pixels for MacBook display.

export const FALLBACK_CROP: DOMRectData = {
  x: 470,
  y: 25,
  width: 545,
  height: 790,
};

// ==================== Download Config ====================

export const DOWNLOAD_CONFIG = {
  /** Prefix for saved file names: prefix-001.png */
  filePrefix: 'page',

  /** Number of digits for zero-padded page numbers */
  padDigits: 3,

  /** Subfolder inside Downloads (empty = root of Downloads) */
  subfolder: 'screener',
} as const;

// ==================== Timing Config ====================

export const TIMING = {
  /** Max time (ms) to wait for page change after clicking Next */
  pageChangeTimeout: 8000,

  /** Polling interval (ms) when waiting for page change */
  pageChangePoll: 200,

  /** Delay (ms) after page change confirmed before taking screenshot */
  postChangeDelay: 500,

  /** Delay (ms) between capture cycles for stability */
  interCycleDelay: 300,
} as const;

// ==================== Debug Config ====================

export const DEBUG = {
  /** Save full (uncropped) screenshots alongside cropped ones */
  saveFullScreenshot: false,

  /** Log verbose messages */
  verbose: true,
} as const;
