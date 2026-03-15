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
const btnScan = document.getElementById('btn-scan') as HTMLButtonElement;
const lessonSelect = document.getElementById('lesson-select') as HTMLSelectElement;
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
  btnScan.disabled = isRunning;
  lessonSelect.disabled = isRunning;

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

// ==================== Lesson Scanning ====================

function populateLessonSelect(count: number): void {
  // Keep "All lessons" option, remove the rest
  while (lessonSelect.options.length > 1) {
    lessonSelect.remove(1);
  }
  for (let i = 1; i <= count; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `Lesson ${i}`;
    lessonSelect.appendChild(opt);
  }
  // Update "All" label with count
  lessonSelect.options[0].textContent = `All lessons (${count})`;
}

btnScan.addEventListener('click', async () => {
  btnScan.disabled = true;
  btnScan.textContent = '...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');

    // Ensure content script is loaded
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content-script.js'],
    }).catch(() => {});

    // Small delay for content script init
    await new Promise((r) => setTimeout(r, 300));

    const res = await chrome.tabs.sendMessage(tab.id, { type: 'get-lesson-count' });
    if (res?.success && typeof res.count === 'number') {
      populateLessonSelect(res.count);
    }
  } catch (err) {
    console.error('[popup] Scan failed:', err);
  }

  btnScan.textContent = 'Scan';
  btnScan.disabled = false;
});

// ==================== Message Handling ====================

chrome.runtime.onMessage.addListener((message: MsgStateUpdate) => {
  if (message.type === 'state-update') {
    render(message.state);
  }
});

// ==================== Button Handlers ====================

btnStart.addEventListener('click', () => {
  const val = lessonSelect.value;
  const lessonTarget = val === 'all' ? 'all' : parseInt(val, 10);
  chrome.runtime.sendMessage({ type: 'start', lessonTarget });
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

// Auto-scan on popup open
btnScan.click();
