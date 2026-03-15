const MAX_LOGS = 50;
const logBuffer: string[] = [];

function timestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

export function log(msg: string): void {
  const entry = `[${timestamp()}] ${msg}`;
  console.log(`[screener] ${entry}`);
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.shift();
  }
}

export function logError(msg: string, err?: unknown): void {
  const detail = err instanceof Error ? err.message : String(err ?? '');
  log(`ERROR: ${msg}${detail ? ' — ' + detail : ''}`);
}

export function getLogs(): string[] {
  return [...logBuffer];
}

export function clearLogs(): void {
  logBuffer.length = 0;
}
