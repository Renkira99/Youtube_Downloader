document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('download-form');
  const urlInput = document.getElementById('url-input');
  const downloadBtn = document.getElementById('download-btn');
  const statusCard = document.getElementById('status-card');
  const terminalLogs = document.getElementById('terminal-logs');
  const progressFill = document.getElementById('progress-fill');
  const progressPercent = document.getElementById('progress-percent');
  const historyList = document.getElementById('history-list');
  const refreshHistoryBtn = document.getElementById('refresh-history');
  const qualitySelect = document.getElementById('quality-select');
  const formatSelect = document.getElementById('format-select');
  const audioFormatSelect = document.getElementById('audio-format-select');

  // Dropdown elements
  const modeSelect = document.getElementById('mode-select');
  const qualityGroup = document.getElementById('quality-group');
  const formatGroup = document.getElementById('format-group');
  const audioFormatGroup = document.getElementById('audio-format-group');

  // Toggle video vs audio options
  modeSelect.addEventListener('change', () => {
    const isAudio = modeSelect.value === 'audio';
    qualityGroup.classList.toggle('hidden', isAudio);
    formatGroup.classList.toggle('hidden', isAudio);
    audioFormatGroup.classList.toggle('hidden', !isAudio);
  });

  let eventSource = null;
  const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
  const DEFAULT_MAX_LOG_LINES = 250;
  const DEFAULT_PROGRESS_UPDATE_INTERVAL_MS = 200;
  let maxLogLines = DEFAULT_MAX_LOG_LINES;
  let progressUpdateIntervalMs = DEFAULT_PROGRESS_UPDATE_INTERVAL_MS;
  let progressLogStepPercent = 5;
  let logFlushIntervalMs = 100;
  let lowImpactMode = false;
  let logQueue = [];
  let flushLogsTimer = null;
  let lastProgressRender = 0;
  let lastProgressLogBucket = -1;
  let maxHistoryItems = 1000;
  let reconnectTimer = null;
  let reconnectAttempts = 0;

  // Format bytes to human readable
  function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  }

  // Format date
  function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function clearQueuedLogs() {
    logQueue = [];
    if (flushLogsTimer) {
      clearTimeout(flushLogsTimer);
      flushLogsTimer = null;
    }
  }

  function flushQueuedLogs() {
    flushLogsTimer = null;
    if (logQueue.length === 0) return;

    const fragment = document.createDocumentFragment();
    const linesToRender = logQueue;
    logQueue = [];

    linesToRender.forEach(({ message, type }) => {
      const line = document.createElement('div');
      line.className = `terminal-line ${type}`;
      line.textContent = message;
      fragment.appendChild(line);
    });

    terminalLogs.appendChild(fragment);

    const excess = terminalLogs.childElementCount - maxLogLines;
    for (let i = 0; i < excess; i++) {
      terminalLogs.firstChild.remove();
    }

    terminalLogs.scrollTop = terminalLogs.scrollHeight;
  }

  function scheduleLogFlush() {
    if (flushLogsTimer) return;
    flushLogsTimer = setTimeout(flushQueuedLogs, logFlushIntervalMs);
  }

  // Add log to terminal
  function appendLog(message, type = '') {
    logQueue.push({ message, type });
    scheduleLogFlush();
  }

  function applyServerConfig(config) {
    if (!config || typeof config !== 'object') return;

    lowImpactMode = Boolean(config.lowImpactMode);
    document.body.classList.toggle('low-impact-mode', lowImpactMode);

    if (lowImpactMode) {
      maxLogLines = 120;
      progressUpdateIntervalMs = 400;
      progressLogStepPercent = 10;
      logFlushIntervalMs = 160;
    }

    const defaults = config.defaults || {};
    if (defaults.quality && Array.from(qualitySelect.options).some((o) => o.value === defaults.quality)) {
      qualitySelect.value = defaults.quality;
    }
    if (defaults.format && Array.from(formatSelect.options).some((o) => o.value === defaults.format)) {
      formatSelect.value = defaults.format;
    }
    if (defaults.audioFormat && Array.from(audioFormatSelect.options).some((o) => o.value === defaults.audioFormat)) {
      audioFormatSelect.value = defaults.audioFormat;
    }

    const tuning = config.tuning || {};
    if (Number.isFinite(tuning.progressEmitIntervalMs) && tuning.progressEmitIntervalMs > 0) {
      progressUpdateIntervalMs = Math.max(progressUpdateIntervalMs, Math.min(tuning.progressEmitIntervalMs, 1000));
    }
    if (Number.isFinite(tuning.maxHistoryItems) && tuning.maxHistoryItems > 0) {
      maxHistoryItems = tuning.maxHistoryItems;
    }
  }

  async function loadServerConfig() {
    try {
      const res = await fetch(`${API_BASE}/api/config`);
      if (!res.ok) return;
      const config = await res.json();
      applyServerConfig(config);
    } catch (err) {
      console.warn('Could not load server config', err);
    }
  }

  // Handle form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;

    // Reset UI
    downloadBtn.disabled = true;
    urlInput.disabled = true;
    statusCard.classList.remove('hidden');
    clearQueuedLogs();
    terminalLogs.innerHTML = '';
    progressFill.style.width = '0%';
    progressPercent.textContent = '0%';
    lastProgressRender = 0;
    lastProgressLogBucket = -1;
    
    appendLog(`Requesting download for: ${url}...`, 'system');

    try {
      const response = await fetch(`${API_BASE}/api/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          mode: modeSelect.value,
          quality: qualitySelect.value,
          format: formatSelect.value,
          audioFormat: audioFormatSelect.value
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Server error');
      }

      const { id } = await response.json();
      startSSE(id);

    } catch (err) {
      const isNetworkError = err instanceof TypeError;
      appendLog(
        isNetworkError
          ? 'Cannot reach server. It should auto-start at login; retrying when available.'
          : `Error: ${err.message}`,
        'error'
      );
      resetForm();
    }
  });

  function startSSE(downloadId) {
    const closeStreamSilently = (source) => {
      if (!source) return;
      source.__closedByApp = true;
      source.close();
    };

    if (eventSource) {
      closeStreamSilently(eventSource);
    }

    eventSource = new EventSource(`${API_BASE}/api/stream/${downloadId}`);

    eventSource.addEventListener('log', (e) => {
      const data = JSON.parse(e.data);
      appendLog(data.message);
    });

    eventSource.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data);

      if (typeof data.percent === 'number') {
        const now = Date.now();
        if (now - lastProgressRender >= progressUpdateIntervalMs || data.percent >= 100) {
          progressFill.style.width = `${data.percent}%`;
          progressPercent.textContent = `${data.percent}%`;
          lastProgressRender = now;
        }

        const progressBucket = Math.floor(data.percent / progressLogStepPercent);
        // Detect new download phase (e.g. audio after video) — percent resets to ~0
        if (data.percent < 2 && lastProgressLogBucket > 5) {
          lastProgressLogBucket = -1;
        }
        if (progressBucket > lastProgressLogBucket || data.percent >= 100) {
          appendLog(data.message, 'progress');
          lastProgressLogBucket = progressBucket;
        }
      } else {
        appendLog(data.message, 'progress');
      }
    });

    eventSource.addEventListener('download-error', (e) => {
      const data = JSON.parse(e.data);
      appendLog(data.message, 'error');
      closeStreamSilently(eventSource);
      resetForm();
    });

    eventSource.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data);
      appendLog(data.message, 'success');
      progressFill.style.width = '100%';
      progressPercent.textContent = '100%';
      flushQueuedLogs();
      closeStreamSilently(eventSource);
      resetForm();
      void loadHistory(); // Refresh history
    });

    eventSource.onerror = (err) => {
      if (err.currentTarget && err.currentTarget.__closedByApp) {
        return;
      }

      console.error("SSE Error:", err);
      appendLog('Connection interrupted. Trying to reconnect…', 'error');
      eventSource.close();
      resetForm();
      scheduleReconnect();
    };
  }

  function resetForm() {
    downloadBtn.disabled = false;
    urlInput.disabled = false;
    urlInput.value = '';
  }

  // Load download history
  async function loadHistory() {
    try {
      refreshHistoryBtn.classList.add('fa-spin');
      const res = await fetch(`${API_BASE}/api/downloads`);
      const files = await res.json();
      document.getElementById('server-offline-banner')?.remove();
      clearReconnect();
      
      historyList.innerHTML = '';
      const trimmedFiles = Array.isArray(files) ? files.slice(0, maxHistoryItems) : [];
      
      if (trimmedFiles.length === 0) {
        historyList.innerHTML = '<div class="history-empty">No downloads yet.</div>';
        return true;
      }

      const fragment = document.createDocumentFragment();
      trimmedFiles.forEach(file => {
        const item = document.createElement('div');
        item.className = 'history-item';

        const fileInfo = document.createElement('div');
        fileInfo.className = 'file-info';

        const fileName = document.createElement('div');
        fileName.className = 'file-name';
        fileName.title = file.filename;
        fileName.textContent = file.filename;

        const fileMeta = document.createElement('div');
        fileMeta.className = 'file-meta';

        const sizeSpan = document.createElement('span');
        sizeSpan.innerHTML = `<i class="fa-solid fa-hard-drive"></i> ${formatBytes(file.size)}`;

        const timeSpan = document.createElement('span');
        timeSpan.innerHTML = `<i class="fa-regular fa-clock"></i> ${formatDate(file.mtime)}`;

        fileMeta.appendChild(sizeSpan);
        fileMeta.appendChild(timeSpan);
        fileInfo.appendChild(fileName);
        fileInfo.appendChild(fileMeta);

        const link = document.createElement('a');
        link.className = 'download-link';
        link.title = 'Download File';
        link.href = `${API_BASE}/api/downloads/${encodeURIComponent(file.filename)}`;

        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-download';
        link.appendChild(icon);

        item.appendChild(fileInfo);
        item.appendChild(link);
        fragment.appendChild(item);
      });

      historyList.appendChild(fragment);
      return true;
    } catch (err) {
      console.error('Failed to load history', err);
      return false;
    } finally {
      setTimeout(() => refreshHistoryBtn.classList.remove('fa-spin'), 500);
    }
  }

  refreshHistoryBtn.addEventListener('click', loadHistory);

  function clearReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectAttempts = 0;
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    const backoffMs = Math.min(30000, 1000 * Math.pow(2, Math.min(reconnectAttempts, 5)));
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      reconnectAttempts += 1;
      const ok = await loadHistory();
      if (ok !== true) {
        scheduleReconnect();
      }
    }, backoffMs);
  }

  loadServerConfig();

  // Initial load — show banner if server is unreachable
  loadHistory().then(ok => {
    if (ok === false && !document.getElementById('server-offline-banner')) {
      const banner = document.createElement('div');
      banner.id = 'server-offline-banner';
      banner.className = 'server-offline-banner';
      banner.innerHTML = '⚠️ Cannot connect to server yet. It should auto-start; this page will retry automatically.';
      document.querySelector('.container main').prepend(banner);
      scheduleReconnect();
    }
  });
});
