# Optimization Implementation Report (LLM Handoff)

This document explains exactly how optimization was implemented in this repository, including what worked, what did not work initially, and how issues were resolved.

It is written as a handoff artifact for another LLM or engineer.

## 1) Objective and constraints

Primary objective:
- Minimize RAM/CPU usage for always-on use.

Secondary objective:
- Make startup hassle-free after macOS restart/login so a pinned Zen browser tab can be used directly.

User-confirmed decisions:
- Startup mode: `launchagent-login-autostart`
- Default mode: `low-impact-defaults-enabled`

(These were also stored in SQL `session_state`.)

## 2) Baseline and initial observations

### Baseline measurement performed
- Method: run server, sample process `%cpu` and `rss` once per second for 12 seconds.
- Result:
  - `node_cpu_avg=0.00%`
  - `node_cpu_max=0.00%`
  - `node_ram_avg=40.48MB`
  - `node_ram_max=41.62MB`

Notes:
- This was idle-only baseline (no active download load test in this session).
- Baseline was enough to validate low idle overhead target and proceed with implementation.

### Architectural hotspots identified
- SSE progress/log volume can cause backend event churn and frontend DOM churn.
- Download history listing can become expensive with many files (readdir + stat + sorting).
- Browser readiness was dependent on manual server startup.
- Existing startup path did not guarantee "always ready after restart".

## 3) Implemented optimizations (what changed)

## 3.1 Backend: `server.js`

### A) Low-impact defaults made the standard behavior
- `LOW_IMPACT_MODE` now defaults to `true`:
  - `const LOW_IMPACT_MODE = envFlag('LOW_IMPACT_MODE', true);`

### B) Download path made local and self-contained
- Default downloads dir changed to repo-local folder:
  - `DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || path.join(__dirname, 'Youtube')`
- Benefit: no external folder dependency for normal operation.

### C) Tuned low-impact defaults
- `PROGRESS_EMIT_INTERVAL_MS`: `700` (low-impact default)
- `PROGRESS_EMIT_STEP_PERCENT`: `3` (low-impact default)
- `DOWNLOADS_CACHE_TTL_MS`: `10000` (low-impact default)
- Added `MAX_HISTORY_ITEMS`:
  - `200` in low-impact mode
  - `1000` otherwise

### D) Added lightweight health endpoint
- New route: `GET /api/health` -> `{ "ok": true }`
- Purpose:
  - quick readiness checks
  - launch/startup verification
  - useful for pinned-tab/server-availability workflows

### E) History endpoint bounded and cached
- `/api/downloads` now:
  - caches for configurable TTL
  - sorts by modification time descending
  - slices to `MAX_HISTORY_ITEMS`
- Benefit:
  - reduced memory and CPU for large download folders
  - lower repeated filesystem overhead

### F) Startup error handling hardened
- Switched to:
  - `const server = app.listen(...)`
  - `server.on('error', ...)`
- Explicit handling for `EADDRINUSE`:
  - logs clear message and exits cleanly
- Benefit:
  - no silent crash loops with unclear startup failures

## 3.2 Frontend: `public/app.js`

### A) Kept and extended low-churn rendering behavior
- Log batching via queue + timed flush retained/used.
- Runtime config now includes `maxHistoryItems`.
- Frontend applies server tuning and default format/quality/audio defaults.

### B) Added startup resilience for pinned tab
- Added reconnect state:
  - `reconnectTimer`
  - `reconnectAttempts`
- Added exponential backoff reconnect scheduler:
  - starts at 1s
  - doubles with cap (30s)
- Reconnect triggers when:
  - initial history fetch fails
  - SSE stream errors unexpectedly

### C) Reduced unbounded UI work
- History UI applies `maxHistoryItems` cap client-side too.
- On successful history load:
  - clears reconnect timer and attempts
- Benefit:
  - prevents aggressive retries
  - lowers CPU wakeups when server is unavailable
  - better long-running pinned tab behavior

### D) User messaging updated for auto-start model
- Offline banner now says app will retry automatically.
- Network error text changed from "launch script manually" to auto-start expectation.

## 3.3 UI visuals: `public/style.css`

### A) Lower GPU/visual overhead in low-impact mode
- `body.low-impact-mode .background-animation`:
  - `animation: none`
  - `display: none`
- `body.low-impact-mode .card`:
  - disables blur/backdrop-filter

### B) Motion reductions still supported
- `prefers-reduced-motion` block retained/used for accessibility and reduced rendering activity.

## 3.4 Startup automation: LaunchAgent scripts

### Added: `setup-launch-agent.sh`
- Installs per-user LaunchAgent:
  - Label: `local.youtube-downloader.web`
  - plist path: `~/Library/LaunchAgents/local.youtube-downloader.web.plist`
- Sets env:
  - `PORT=3000`
  - `LOW_IMPACT_MODE=1`
  - `DOWNLOADS_DIR=<repo>/Youtube`
- Uses:
  - `RunAtLoad=true`
  - `KeepAlive=true`
- Logs to:
  - `~/Library/Logs/YoutubeDownloader/server.out.log`
  - `~/Library/Logs/YoutubeDownloader/server.err.log`

### Added: `remove-launch-agent.sh`
- Stops, unloads, and deletes LaunchAgent plist for clean rollback.

### `package.json` scripts added
- `autostart:install` -> `bash ./setup-launch-agent.sh`
- `autostart:remove` -> `bash ./remove-launch-agent.sh`

### Launcher script update
- `Launch YouTube Downloader.command` now ensures autostart scripts are executable:
  - `chmod +x setup-launch-agent.sh remove-launch-agent.sh`

## 3.5 Documentation updates

`README.md` was updated to:
- describe LaunchAgent-based one-time setup
- include remove command
- state low-impact mode is default
- list updated tuning vars and defaults
- include new startup scripts in project structure

## 4) Validation performed

### Syntax checks
- `node --check server.js` -> pass
- `node --check public/app.js` -> pass

### Runtime checks
- `curl http://localhost:3000/api/health` -> `{"ok":true}`
- `curl http://localhost:3000/api/config` -> confirms:
  - `lowImpactMode: true`
  - defaults:
    - `quality: 720`
    - `format: mp4`
    - `audioFormat: best`
  - tuning:
    - `progressEmitIntervalMs: 700`
    - `progressEmitStepPercent: 3`
    - `downloadsCacheTtlMs: 10000`
    - `maxHistoryItems: 200`

### LaunchAgent lifecycle verification
- `npm run autostart:remove` -> success
- `npm run autostart:install` -> success
- post-install health check -> success

## 5) What worked

1. LaunchAgent auto-start approach worked and matched user requirement:
   - server starts after install and is suitable for restart/login autostart.

2. Default low-impact mode worked:
   - config endpoint confirms low-impact defaults active by default.

3. Startup/readiness UX improvements worked:
   - frontend reconnect strategy now handles temporary server unavailability.

4. Resource-oriented controls worked:
   - history cap + cache + reduced visual effects + progress throttling are in place.

5. Validation pipeline worked:
   - syntax and runtime checks all passed after implementation.

## 6) What did NOT work initially (and fixes)

### Issue A: Initial baseline sampling command failed noisily
Symptoms:
- repeated `bash: : No such file or directory`
- command hung and had to be stopped.

Likely cause:
- brittle chained one-liner with temporary file handling.

Fix:
- switched to a simpler, explicit approach:
  - start server in separate session
  - sample PID directly with a clear output file
  - compute stats via `awk`

### Issue B: First auto-start verify attempt failed (`curl` exit 22)
Symptoms:
- health/config probe failed during first autostart validation.
- LaunchAgent stderr showed `EADDRINUSE` (port 3000 already in use).

Cause:
- an existing server process was already listening on port 3000 when LaunchAgent started.

Fix:
- kill current listener, rerun install, recheck endpoint.
- added explicit server startup error handling to make this state obvious.

### Issue C: `kill` command safety check blocked one chained command
Symptoms:
- tool refused command because `kill` might not have resolved to numeric PID in-chain.

Fix:
- resolved PID in a separate command first, then executed `kill <numeric_pid>`.

## 7) Known caveats / follow-up notes for next LLM

1. README and launcher behavior consistency should be rechecked.
   - README says launcher opens `Youtube/`.
   - launcher currently opens `/Users/overwatch/Downloads`.
   - Decide one canonical behavior and align both.

2. This session validated idle/resource readiness and startup flow, not a full large-file active download benchmark.
   - If needed, run a repeatable active benchmark against representative URLs.

3. LaunchAgent currently enforces `LOW_IMPACT_MODE=1`.
   - If user wants per-machine default toggles, consider generating plist from a template with optional flags.

## 8) Final file-level summary

Modified:
- `server.js`
- `public/app.js`
- `public/style.css`
- `README.md`
- `package.json`
- `Launch YouTube Downloader.command`

Added:
- `setup-launch-agent.sh`
- `remove-launch-agent.sh`

Session progress tracking:
- SQL todos: all 7 marked `done`
- session decisions preserved in `session_state`

## 9) Repro steps (quick)

1. Install/start autostart service:
```bash
npm run autostart:install
```

2. Verify ready:
```bash
curl -sS http://localhost:3000/api/health
curl -sS http://localhost:3000/api/config
```

3. Remove autostart if needed:
```bash
npm run autostart:remove
```

