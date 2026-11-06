#!/bin/sh
# Downloads the latest version from GitHub and installs it, keeping your settings (.env)
# and your posts (data/). The GitHub repository must be public while this runs.
set -e
cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
TMP="$(mktemp -d)"
echo "Downloading the latest version..."
curl -fsSL -o "$TMP/app.zip" https://github.com/danielskone/social-scheduler/archive/refs/heads/main.zip \
  || { echo "Download failed. Is the GitHub repository set to public?"; exit 1; }
unzip -oq "$TMP/app.zip" -d "$TMP"
rsync -a --exclude .env --exclude data --exclude node_modules "$TMP/social-scheduler-main/" "$APP_DIR/"
rm -rf "$TMP"
npm install --no-fund --no-audit
npm install-scripts approve better-sqlite3 >/dev/null 2>&1 || true
node -e "require('better-sqlite3')" 2>/dev/null || npm rebuild better-sqlite3
# Clips tab: ffmpeg (video tool) is downloaded by its installer, which newer npm asks to approve.
npm install-scripts approve ffmpeg-static >/dev/null 2>&1 || true
node -e "process.exit(require('fs').existsSync(require('ffmpeg-static')) ? 0 : 1)" 2>/dev/null || npm rebuild ffmpeg-static
echo "UPDATED"
