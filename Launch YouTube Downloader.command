#!/bin/bash

# YouTube Downloader Launcher
# Double-click this file to start the server and open the app.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Starting yt-dlp Web..."
echo "------------------------------------------"

# Ensure Homebrew binaries (yt-dlp, ffmpeg, node) are on PATH
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

# Kill any existing process on port 3000
EXISTING=$(lsof -ti tcp:3000)
if [ -n "$EXISTING" ]; then
  echo "Stopping existing server on port 3000..."
  kill $EXISTING 2>/dev/null
  sleep 1
fi

# Start the Node server in the background
cd "$DIR"
node "$DIR/server.js" &
SERVER_PID=$!

echo "Server started (PID $SERVER_PID)"
echo "Waiting for server to be ready..."

# Poll until server responds (up to 10 seconds)
for i in $(seq 1 20); do
  if curl -s http://localhost:3000 > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo "Server is ready at http://localhost:3000"
echo ""
echo "Opening app in browser..."

# Open the app
open "http://localhost:3000"

# Open the Youtube folder in Finder
mkdir -p "$DIR/Youtube"
open "$DIR/Youtube"

echo ""
echo "------------------------------------------"
echo "Keep this window open while downloading."
echo "Close it (or press Ctrl+C) to stop the server."
echo "------------------------------------------"

# Stay alive until server exits
wait $SERVER_PID
