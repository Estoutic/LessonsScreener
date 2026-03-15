"use strict";
(() => {
  // src/popup.ts
  var btnStart = document.getElementById("btn-start");
  var btnStop = document.getElementById("btn-stop");
  var btnTest = document.getElementById("btn-test");
  var elStatus = document.getElementById("status");
  var elPage = document.getElementById("page-count");
  var elCaptured = document.getElementById("captured-count");
  var elLogs = document.getElementById("logs");
  function render(state) {
    elStatus.textContent = state.status;
    elStatus.className = `status-${state.status}`;
    elPage.textContent = String(state.currentPage);
    elCaptured.textContent = String(state.totalCaptured);
    const isRunning = state.status === "running";
    btnStart.disabled = isRunning;
    btnTest.disabled = isRunning;
    btnStop.disabled = !isRunning;
    const recentLogs = state.logs.slice(-15);
    elLogs.innerHTML = recentLogs.map((l) => `<div class="log-line">${escapeHtml(l)}</div>`).join("");
    elLogs.scrollTop = elLogs.scrollHeight;
  }
  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "state-update") {
      render(message.state);
    }
  });
  btnStart.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "start" });
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
})();
