// ==================== State ====================

export type ProcessStatus = 'idle' | 'running' | 'stopped' | 'completed' | 'error';

export interface ProcessState {
  status: ProcessStatus;
  currentPage: number;
  totalCaptured: number;
  logs: string[];
  errorMessage?: string;
}

// ==================== Page Info from Content Script ====================

export interface PageInfo {
  pageNumber: number;
  rect: DOMRectData | null;
  devicePixelRatio: number;
  isNextDisabled: boolean;
}

export interface DOMRectData {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ==================== Messages ====================

// Popup → Service Worker
export interface MsgStart {
  type: 'start';
  /** Which lesson to capture: 'all' or 1-based lesson number */
  lessonTarget?: 'all' | number;
}

export interface MsgStop {
  type: 'stop';
}

export interface MsgTestCapture {
  type: 'test-capture';
}

export interface MsgGetState {
  type: 'get-state';
}

// Service Worker → Content Script
export interface MsgGetPageInfo {
  type: 'get-page-info';
  lessonIndex?: number;
}

export interface MsgClickNext {
  type: 'click-next';
  lessonIndex?: number;
}

export interface MsgGoToFirst {
  type: 'go-to-first';
  lessonIndex?: number;
}

export interface MsgGetLessonCount {
  type: 'get-lesson-count';
}

export interface LessonCountResponse {
  success: boolean;
  count?: number;
  error?: string;
}

export interface GoToFirstResponse {
  success: boolean;
  pageNumber?: number;
  error?: string;
}

// Service Worker → Offscreen
export interface MsgCrop {
  type: 'crop';
  dataUrl: string;
  rect: DOMRectData;
  devicePixelRatio: number;
}

// Responses
export interface PageInfoResponse {
  success: boolean;
  data?: PageInfo;
  error?: string;
}

export interface ClickNextResponse {
  success: boolean;
  newPageNumber?: number;
  isLastPage?: boolean;
  error?: string;
}

export interface CropResponse {
  success: boolean;
  croppedDataUrl?: string;
  error?: string;
}

export interface StateResponse {
  state: ProcessState;
}

// Service Worker → Popup (broadcast)
export interface MsgStateUpdate {
  type: 'state-update';
  state: ProcessState;
}

export type PopupMessage = MsgStart | MsgStop | MsgTestCapture | MsgGetState;
export type ContentMessage = MsgGetPageInfo | MsgClickNext | MsgGoToFirst | MsgGetLessonCount;
export type OffscreenMessage = MsgCrop;
