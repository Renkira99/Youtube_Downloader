const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DOWNLOADS_DIR = path.join(__dirname, 'Youtube');
const MAX_CONCURRENT_DOWNLOADS = Math.max(parseInt(process.env.MAX_CONCURRENT_DOWNLOADS || '1', 10) || 1, 1);
const MAX_QUEUE_SIZE = Math.max(parseInt(process.env.MAX_QUEUE_SIZE || '10', 10) || 10, 1);

// Ensure downloads directory exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use(express.json());

// Enable CORS for frontend running from file://
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Helper to strip ANSI codes from yt-dlp output
function stripAnsi(text) {
  return text.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ''
  );
}

// Global active downloads map (naive way to manage SSE clients)
const activeDownloads = new Map();
const waitingQueue = [];
let runningDownloads = 0;

function removeFromQueue(downloadId) {
  const idx = waitingQueue.indexOf(downloadId);
  if (idx !== -1) waitingQueue.splice(idx, 1);
}

function enqueueDownload(downloadId) {
  if (!waitingQueue.includes(downloadId)) {
    waitingQueue.push(downloadId);
  }
}

function buildYtDlpArgs(download) {
  if (download.mode === 'audio') {
    const af = download.audioFormat;
    if (af === 'best') {
      return ['-x', '--newline', '-o', path.join(DOWNLOADS_DIR, '%(title)s.%(ext)s'), download.url];
    }

    return ['-x', '--audio-format', af, '--newline', '-o', path.join(DOWNLOADS_DIR, `%(title)s.${af}`), download.url];
  }

  const q = download.quality;
  const practicalVideo = 'bv*[protocol!=m3u8][protocol!=m3u8_native]';
  const practicalAudio = 'ba[protocol!=m3u8][protocol!=m3u8_native]';
  let formatFilter;

  if (q === 'best') {
    formatFilter = 'bv*+ba/b';
  } else if (q === '2160') {
    // Prefer practical 4K first, then 1440p, then 1080p; fallback to generic selectors.
    formatFilter = `${practicalVideo}[height=2160]+${practicalAudio}/${practicalVideo}[height=1440]+${practicalAudio}/${practicalVideo}[height=1080]+${practicalAudio}/bv*[height=2160]+ba/bv*[height=1440]+ba/bv*[height=1080]+ba/b`;
  } else if (q === '1440') {
    // Prefer practical 1440p first, then 1080p; fallback to generic selectors.
    formatFilter = `${practicalVideo}[height=1440]+${practicalAudio}/${practicalVideo}[height=1080]+${practicalAudio}/bv*[height=1440]+ba/bv*[height=1080]+ba/b`;
  } else if (q === '1080') {
    // Default 1080 behavior: highest practical bitrate at 1080 first.
    formatFilter = `${practicalVideo}[height=1080]+${practicalAudio}/${practicalVideo}[height<=1080]+${practicalAudio}/bv*[height=1080]+ba/bv*[height<=1080]+ba/b`;
  } else {
    formatFilter = `${practicalVideo}[height<=${q}]+${practicalAudio}/bv*[height<=${q}]+ba/b`;
  }

  const sortParts = ['res', 'vbr', 'br', 'fps'];
  if (download.format === 'mp4') {
    sortParts.push('vext:mp4', 'aext:m4a');
  } else if (download.format === 'webm') {
    sortParts.push('vext:webm', 'aext:webm');
  }

  return [
    '-f', formatFilter,
    '-S', sortParts.join(','),
    '--format-sort-force',
    '--merge-output-format', download.format,
    '--newline',
    '-o', path.join(DOWNLOADS_DIR, '%(title)s.%(ext)s'),
    download.url
  ];
}

function processQueue() {
  while (runningDownloads < MAX_CONCURRENT_DOWNLOADS && waitingQueue.length > 0) {
    const nextId = waitingQueue.shift();
    const download = activeDownloads.get(nextId);
    if (!download || download.clientDisconnected || download.process) {
      continue;
    }
    startDownload(nextId);
  }
}

function startDownload(downloadId) {
  const download = activeDownloads.get(downloadId);
  if (!download || !download.sendEvent || download.process || download.clientDisconnected) {
    return;
  }

  const args = buildYtDlpArgs(download);
  const ytdlp = spawn('yt-dlp', args);

  runningDownloads += 1;
  download.status = 'running';
  download.process = ytdlp;
  download.sendEvent('log', { message: 'Starting yt-dlp...' });
  let finalized = false;

  let stdoutBuffer = '';
  ytdlp.stdout.on('data', (data) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop(); // Keep the last incomplete line in the buffer

    lines.forEach(line => {
      line = stripAnsi(line).trim();
      if (!line) return;

      let isProgress = false;
      let percent = 0;
      const progressMatch = line.match(/\[download\]\s+([\d.]+)%/);

      if (progressMatch) {
        isProgress = true;
        percent = parseFloat(progressMatch[1]);
      }

      download.sendEvent(isProgress ? 'progress' : 'log', {
        message: line,
        percent: isProgress ? percent : null
      });
    });
  });

  let stderrBuffer = '';
  ytdlp.stderr.on('data', (data) => {
    stderrBuffer += data.toString();
    const lines = stderrBuffer.split('\n');
    stderrBuffer = lines.pop(); // keep partial line
    lines.forEach(line => {
      line = stripAnsi(line).trim();
      if (line) {
        download.sendEvent('log', { message: `ERROR: ${line}` });
      }
    });
  });

  const finalizeDownload = (code, errorMessage) => {
    if (finalized) return;
    finalized = true;

    // Flush remaining buffers
    if (stdoutBuffer.trim()) {
      download.sendEvent('log', { message: stripAnsi(stdoutBuffer).trim() });
    }
    if (stderrBuffer.trim()) {
      download.sendEvent('log', { message: `ERROR: ${stripAnsi(stderrBuffer).trim()}` });
    }

    runningDownloads = Math.max(0, runningDownloads - 1);
    const stillActive = activeDownloads.get(downloadId);
    if (!stillActive) {
      processQueue();
      return;
    }

    if (!stillActive.clientDisconnected) {
      if (errorMessage) {
        stillActive.sendEvent('download-error', { message: errorMessage });
      } else if (code === 0) {
        stillActive.sendEvent('complete', { message: 'Download completed successfully!' });
      } else {
        stillActive.sendEvent('download-error', { message: `Process exited with code ${code}` });
      }

      if (stillActive.response && !stillActive.response.writableEnded) {
        stillActive.response.end();
      }
    }

    activeDownloads.delete(downloadId);
    processQueue();
  };

  ytdlp.on('error', (err) => {
    download.sendEvent('log', { message: `ERROR: Failed to start yt-dlp: ${err.message}` });
    finalizeDownload(-1, 'Failed to start yt-dlp. Make sure yt-dlp is installed and accessible.');
  });

  ytdlp.on('close', (code) => {
    finalizeDownload(code, null);
  });
}

app.post('/api/download', (req, res) => {
  const { url, mode, quality, format, audioFormat } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  let normalizedUrl;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return res.status(400).json({ error: 'Only http(s) URLs are supported' });
    }
    normalizedUrl = parsed.toString();
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (activeDownloads.size >= MAX_CONCURRENT_DOWNLOADS + MAX_QUEUE_SIZE) {
    return res.status(429).json({ error: 'Server is busy. Please try again in a moment.' });
  }

  // Generate a unique ID for this download to link SSE
  const downloadId = randomUUID();
  
  // We don't start it immediately, we wait for the SSE client to connect
  activeDownloads.set(downloadId, {
    url: normalizedUrl,
    mode: mode || 'video',
    quality: quality || '1440',
    format: format || 'mkv',
    audioFormat: audioFormat || 'mp3',
    status: 'pending',
    logs: [],
    process: null,
    sendEvent: null,
    response: null,
    clientDisconnected: false
  });

  // Prevent memory leak if SSE client never connects
  setTimeout(() => {
    const download = activeDownloads.get(downloadId);
    if (download && download.status === 'pending') {
      activeDownloads.delete(downloadId);
    }
  }, 10000);

  res.json({ id: downloadId });
});

// SSE endpoint
app.get('/api/stream/:id', (req, res) => {
  const downloadId = req.params.id;
  const download = activeDownloads.get(downloadId);

  if (!download) {
    return res.status(404).json({ error: 'Download not found' });
  }

  if (download.sendEvent) {
    return res.status(409).json({ error: 'Stream already connected for this download' });
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Helper to send events
  const sendEvent = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  download.sendEvent = sendEvent;
  download.response = res;
  download.status = 'queued';

  const queuePosition = waitingQueue.length + 1;
  sendEvent('log', { message: `Queued. Position: ${queuePosition}` });
  enqueueDownload(downloadId);
  processQueue();

  req.on('close', () => {
    const latest = activeDownloads.get(downloadId);
    if (!latest) return;

    latest.clientDisconnected = true;
    removeFromQueue(downloadId);

    if (latest.process) {
      latest.process.kill();
    } else {
      activeDownloads.delete(downloadId);
    }
  });
});

app.get('/api/downloads', async (req, res) => {
  try {
    const entries = await fs.promises.readdir(DOWNLOADS_DIR, { withFileTypes: true });
    const visibleFiles = entries.filter(entry => entry.isFile() && !entry.name.startsWith('.'));

    const fileStats = await Promise.all(
      visibleFiles.map(async (entry) => {
        const filePath = path.join(DOWNLOADS_DIR, entry.name);
        const stats = await fs.promises.stat(filePath);
        return {
          filename: entry.name,
          size: stats.size,
          mtime: stats.mtime
        };
      })
    );

    fileStats.sort((a, b) => b.mtime - a.mtime);
    res.json(fileStats);
  } catch (err) {
    res.status(500).json({ error: 'Could not read directory' });
  }
});

app.get('/api/downloads/:filename', async (req, res) => {
  const requested = req.params.filename;
  const safeName = path.basename(requested);

  if (safeName !== requested) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const filePath = path.resolve(DOWNLOADS_DIR, safeName);
  if (!filePath.startsWith(DOWNLOADS_DIR + path.sep)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
    res.download(filePath, safeName);
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
