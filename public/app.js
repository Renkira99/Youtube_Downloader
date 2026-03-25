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
  const MAX_LOG_LINES = 250;
  const PROGRESS_UPDATE_INTERVAL_MS = 200;
  let lastProgressRender = 0;
  let lastProgressLogBucket = -1;

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

  // Add log to terminal
  function appendLog(message, type = '') {
    const line = document.createElement('div');
    line.className = `terminal-line ${type}`;
    line.textContent = message;
    terminalLogs.appendChild(line);

    while (terminalLogs.childElementCount > MAX_LOG_LINES) {
      terminalLogs.removeChild(terminalLogs.firstChild);
    }

    // Auto scroll
    terminalLogs.scrollTop = terminalLogs.scrollHeight;
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
          quality: document.getElementById('quality-select').value,
          format: document.getElementById('format-select').value,
          audioFormat: document.getElementById('audio-format-select').value
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
          ? 'Cannot reach server. Make sure it\'s running — launch "Launch YouTube Downloader.command".'
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
        if (now - lastProgressRender >= PROGRESS_UPDATE_INTERVAL_MS || data.percent >= 100) {
          progressFill.style.width = `${data.percent}%`;
          progressPercent.textContent = `${data.percent}%`;
          lastProgressRender = now;
        }

        const progressBucket = Math.floor(data.percent / 5);
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
      closeStreamSilently(eventSource);
      resetForm();
      loadHistory(); // Refresh history
    });

    eventSource.onerror = (err) => {
      if (err.currentTarget && err.currentTarget.__closedByApp) {
        return;
      }

      console.error("SSE Error:", err);
      appendLog('Connection interrupted. Please try again.', 'error');
      eventSource.close();
      resetForm();
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
      
      historyList.innerHTML = '';
      
      if (files.length === 0) {
        historyList.innerHTML = '<div class="history-empty">No downloads yet.</div>';
        return;
      }

      const fragment = document.createDocumentFragment();
      files.forEach(file => {
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
    } catch (err) {
      console.error('Failed to load history', err);
      return false;
    } finally {
      setTimeout(() => refreshHistoryBtn.classList.remove('fa-spin'), 500);
    }
  }

  refreshHistoryBtn.addEventListener('click', loadHistory);

  // Initial load — show banner if server is unreachable
  loadHistory().then(ok => {
    if (ok === false && !document.getElementById('server-offline-banner')) {
      const banner = document.createElement('div');
      banner.id = 'server-offline-banner';
      banner.style.cssText = 'background:#3d1a1a;color:#f87171;border:1px solid #7f1d1d;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:0.875rem;';
      banner.innerHTML = '⚠️ Cannot connect to server. Launch <strong>Launch YouTube Downloader.command</strong> to start it.';
      document.querySelector('.container main').prepend(banner);
    }
  });
});
