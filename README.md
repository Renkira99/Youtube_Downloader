# yt-dlp Web

A local web interface for downloading YouTube videos and audio using [yt-dlp](https://github.com/yt-dlp/yt-dlp). Double-click to launch — no command line needed.

![yt-dlp Web](public/favicon.png)

## Features

- Download YouTube videos in **MKV, MP4, or WebM** format
- Extract audio as **MP3, AAC, M4A, Opus, FLAC**, or best quality
- Quality selection: **4K (2160p), 1440p, 1080p, 720p, 480p, 360p**, or best available
- Real-time download progress with a terminal-style log view
- Download history panel with file sizes and timestamps
- Queue support for multiple downloads
- Downloads saved to a local `Youtube/` folder, which opens automatically on launch

## Requirements

- macOS (Apple Silicon)
- [Node.js](https://nodejs.org) via Homebrew: `brew install node`
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) via Homebrew: `brew install yt-dlp`
- [ffmpeg](https://ffmpeg.org) via Homebrew: `brew install ffmpeg`

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/Youtube_Downloader.git
cd Youtube_Downloader
npm install
```

## Usage

**Option A — Double-click launcher:**

Double-click `Launch YouTube Downloader.command` in Finder. It will:
1. Kill any existing server on port 3000
2. Start the Node.js server
3. Open the app in your browser
4. Open the `Youtube/` downloads folder in Finder

**Option B — Terminal:**

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

## How it works

- A Node.js/Express server runs locally on port 3000
- The frontend communicates with the server via a REST API
- Downloads are streamed in real time using **Server-Sent Events (SSE)**
- yt-dlp handles all downloading and format conversion

## Project Structure

```
.
├── Launch YouTube Downloader.command   # macOS double-click launcher
├── server.js                           # Express server + yt-dlp integration
├── public/
│   ├── app.html                        # Frontend UI
│   ├── app.js                          # Frontend logic
│   └── style.css                       # Styles
├── Youtube/                            # Downloaded files land here
└── package.json
```
