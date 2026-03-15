/**
 * popup.ts — popup UI logic.
 * Communicates with the service worker to start/stop capture
 * and display real-time status.
 */

import type { ProcessState, MsgStateUpdate, StateResponse } from './types';

// ==================== DOM Elements ====================

const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
const btnTest = document.getElementById('btn-test') as HTMLButtonElement;
const elStatus = document.getElementById('status') as HTMLSpanElement;
const elPage = document.getElementById('page-count') as HTMLSpanElement;
const elCaptured = document.getElementById('captured-count') as HTMLSpanElement;
const elLogs = document.getElementById('logs') as HTMLDivElement;

// ==================== State Rendering ====================

function render(state: ProcessState): void {
  elStatus.textContent = state.status;
  elStatus.className = `status-${state.status}`;
  elPage.textContent = String(state.currentPage);
  elCaptured.textContent = String(state.totalCaptured);

  // Buttons
  const isRunning = state.status === 'running';
  btnStart.disabled = isRunning;
  btnTest.disabled = isRunning;
  btnStop.disabled = !isRunning;

  // Logs (show last 15)
  const recentLogs = state.logs.slice(-15);
  elLogs.innerHTML = recentLogs
    .map((l) => `<div class="log-line">${escapeHtml(l)}</div>`)
    .join('');
  elLogs.scrollTop = elLogs.scrollHeight;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ==================== Message Handling ====================

chrome.runtime.onMessage.addListener((message: MsgStateUpdate) => {
  if (message.type === 'state-update') {
    render(message.state);
  }
});

// ==================== Button Handlers ====================

btnStart.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'start' });
});

btnStop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'stop' });
});

btnTest.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'test-capture' });
});

// ==================== Initial State ====================

chrome.runtime.sendMessage({ type: 'get-state' }, (response: StateResponse) => {
  if (response?.state) {
    render(response.state);
  }
});
