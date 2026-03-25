# YouTube Downloader (yt-dlp Web UI)

Local web app for downloading YouTube video/audio with `yt-dlp`, optimized for low CPU/RAM and always-ready startup.

## What you get

- Video downloads: `mkv`, `mp4`, `webm`
- Audio extraction: `mp3`, `aac`, `m4a`, `opus`, `flac`, or best
- Quality options from `360p` up to `4K`
- Real-time progress + logs via SSE
- Queue support (default single active download for lower resource usage)
- Download history panel
- Downloads saved to project-local `Youtube/`
- Optional macOS login auto-start (best for pinned browser tabs)

## Requirements

- macOS
- `node` (Homebrew: `brew install node`)
- `yt-dlp` (`brew install yt-dlp`)
- `ffmpeg` (`brew install ffmpeg`)

## Install

```bash
git clone https://github.com/YOUR_USERNAME/Youtube_Downloader.git
cd Youtube_Downloader
npm install
```

## Quick start

Run normally:

```bash
npm start
```

Open:

`http://localhost:3000`

## Best setup for pinned Zen tab (recommended)

Install login auto-start once:

```bash
npm run autostart:install
```

This creates a user LaunchAgent that:

- starts server on login/restart
- keeps it alive (`KeepAlive`)
- runs low-impact mode by default (`LOW_IMPACT_MODE=1`)
- writes logs to `~/Library/Logs/YoutubeDownloader/`

Remove auto-start:

```bash
npm run autostart:remove
```

## Other ways to launch

Double-click `Launch YouTube Downloader.command` to:

1. stop anything already on port `3000`
2. start the server
3. open the app URL
4. open `/Users/overwatch/Downloads` in Finder

## Low-impact mode (default)

Low-impact mode is enabled by default to keep background resource usage low.

Force normal mode:

```bash
LOW_IMPACT_MODE=0 npm start
```

Explicit low-impact mode:

```bash
LOW_IMPACT_MODE=1 npm start
```

Default low-impact tuning:

- `DEFAULT_VIDEO_QUALITY=720`
- `DEFAULT_VIDEO_FORMAT=mp4`
- `DEFAULT_AUDIO_FORMAT=best`
- `PROGRESS_EMIT_INTERVAL_MS=700`
- `PROGRESS_EMIT_STEP_PERCENT=3`
- `DOWNLOADS_CACHE_TTL_MS=10000`
- `MAX_HISTORY_ITEMS=200`

## Useful environment variables

- `PORT` (default `3000`)
- `DOWNLOADS_DIR` (default `./Youtube`)
- `MAX_CONCURRENT_DOWNLOADS` (default `1`)
- `MAX_QUEUE_SIZE` (default `10`)
- `LOW_IMPACT_MODE` (`1` default)
- `DEFAULT_VIDEO_QUALITY`
- `DEFAULT_VIDEO_FORMAT`
- `DEFAULT_AUDIO_FORMAT`
- `PROGRESS_EMIT_INTERVAL_MS`
- `PROGRESS_EMIT_STEP_PERCENT`
- `DOWNLOADS_CACHE_TTL_MS`
- `MAX_HISTORY_ITEMS`

## Health and config endpoints

- `GET /api/health` -> lightweight readiness check
- `GET /api/config` -> active low-impact/default tuning values

## Troubleshooting

- `Cannot connect to server`:
  - verify with `curl http://localhost:3000/api/health`
  - if needed: `npm start`
  - for always-ready behavior: `npm run autostart:install`

- Port already in use:
  - stop existing process on `3000`, then restart

- `yt-dlp`/`ffmpeg` errors:
  - ensure both are installed and available in PATH

## Project layout

```text
.
├── server.js
├── public/
│   ├── app.html
│   ├── app.js
│   └── style.css
├── Youtube/
├── Launch YouTube Downloader.command
├── setup-launch-agent.sh
├── remove-launch-agent.sh
└── package.json
```
