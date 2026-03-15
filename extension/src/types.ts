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
}

export interface MsgClickNext {
  type: 'click-next';
}

export interface MsgGoToFirst {
  type: 'go-to-first';
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
export type ContentMessage = MsgGetPageInfo | MsgClickNext | MsgGoToFirst;
export type OffscreenMessage = MsgCrop;
