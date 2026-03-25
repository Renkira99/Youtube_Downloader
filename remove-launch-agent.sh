#!/bin/bash
set -euo pipefail

LABEL="local.youtube-downloader.web"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

launchctl stop "${LABEL}" >/dev/null 2>&1 || true
launchctl unload "$PLIST" >/dev/null 2>&1 || true

if [ -f "$PLIST" ]; then
  rm -f "$PLIST"
fi

echo "LaunchAgent removed: ${LABEL}"
