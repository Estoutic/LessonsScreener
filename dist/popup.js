"use strict";
(() => {
  // src/popup.ts
  var btnStart = document.getElementById("btn-start");
  var btnStop = document.getElementById("btn-stop");
  var btnTest = document.getElementById("btn-test");
  var btnScan = document.getElementById("btn-scan");
  var lessonSelect = document.getElementById("lesson-select");
  var elStatus = document.getElementById("status");
  var elPage = document.getElementById("page-count");
  var elCaptured = document.getElementById("captured-count");
  var elLogs = document.getElementById("logs");
  function render(state) {
    elStatus.textContent = state.status;
    elStatus.className = `info-value status-${state.status}`;
    elPage.textContent = String(state.currentPage);
    elCaptured.textContent = String(state.totalCaptured);
    const isRunning = state.status === "running";
    btnStart.disabled = isRunning;
    btnTest.disabled = isRunning;
    btnStop.disabled = !isRunning;
    btnScan.disabled = isRunning;
    lessonSelect.disabled = isRunning;
    const recentLogs = state.logs.slice(-15);
    elLogs.innerHTML = recentLogs.map((l) => `<div class="log-line">${escapeHtml(l)}</div>`).join("");
    elLogs.scrollTop = elLogs.scrollHeight;
  }
  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function populateLessonSelect(count, titles = []) {
    while (lessonSelect.options.length > 1) {
      lessonSelect.remove(1);
    }
    for (let i = 1; i <= count; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      const title = titles[i - 1]?.replace(/\.pdf$/i, "").trim();
      opt.textContent = title || `Lesson ${i}`;
      lessonSelect.appendChild(opt);
    }
    lessonSelect.options[0].textContent = `All lessons (${count})`;
  }
  var btnScanLabel = btnScan.querySelector(".button_top");
  btnScan.addEventListener("click", async () => {
    btnScan.disabled = true;
    btnScanLabel.textContent = "...";
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id)
        throw new Error("No active tab");
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content-script.js"]
      }).catch(() => {
      });
      await new Promise((r) => setTimeout(r, 300));
      const res = await chrome.tabs.sendMessage(tab.id, { type: "get-lesson-count" });
      if (res?.success && typeof res.count === "number") {
        let titles = [];
        try {
          const [titleResult] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const pageNumButtons = document.querySelectorAll('button[data-testid="page-number"]');
              return Array.from(pageNumButtons).map((btn) => {
                let el = btn;
                while (el) {
                  el = el.parentElement;
                  if (!el)
                    break;
                  const h5 = el.querySelector("h5.Title-module__title__tyFfb");
                  if (h5)
                    return h5.textContent?.trim() || "";
                }
                return "";
              });
            }
          });
          titles = titleResult.result || [];
        } catch {
        }
        populateLessonSelect(res.count, titles);
      }
    } catch (err) {
      console.error("[popup] Scan failed:", err);
    }
    btnScanLabel.textContent = "Scan";
    btnScan.disabled = false;
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "state-update") {
      render(message.state);
    }
  });
  btnStart.addEventListener("click", () => {
    const val = lessonSelect.value;
    const lessonTarget = val === "all" ? "all" : parseInt(val, 10);
    chrome.runtime.sendMessage({ type: "start", lessonTarget });
  });
  btnStop.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "stop" });
  });
  btnTest.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "test-capture" });
  });
  chrome.runtime.sendMessage({ type: "get-state" }, (response) => {
    if (response?.state) {
      render(response.state);
    }
  });
  btnScan.click();
})();
