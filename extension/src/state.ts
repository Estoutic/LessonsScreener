import type { ProcessState, ProcessStatus } from './types';
import { getLogs } from './logger';

let state: ProcessState = {
  status: 'idle',
  currentPage: 0,
  totalCaptured: 0,
  logs: [],
  errorMessage: undefined,
};

let stopRequested = false;

export function getState(): ProcessState {
  return { ...state, logs: getLogs() };
}

export function setStatus(status: ProcessStatus, errorMessage?: string): void {
  state.status = status;
  state.errorMessage = errorMessage;
}

export function setCurrentPage(page: number): void {
  state.currentPage = page;
}

export function incrementCaptured(): void {
  state.totalCaptured++;
}

export function resetState(): void {
  state = {
    status: 'idle',
    currentPage: 0,
    totalCaptured: 0,
    logs: [],
    errorMessage: undefined,
  };
  stopRequested = false;
}

export function requestStop(): void {
  stopRequested = true;
}

export function isStopRequested(): boolean {
  return stopRequested;
}

export function clearStopFlag(): void {
  stopRequested = false;
}
