// npm run mac-app : puts an app on your Desktop for each of your apps: Viral Post (the
// scheduler), Viral Touch CRM, Viral Clips and Viral Ads Studio. Double-click one to start them
// (if they aren't running) and open that app in its own window.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

if (process.platform !== 'darwin') { console.log('This is only for Macs.'); process.exit(1); }
const root = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });
const { APPS, enabledApps } = require('../src/apps');
const port = process.env.PORT || 3000;
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function makeApp(a) {
  const appDir = path.join(os.homedir(), 'Desktop', `${a.name}.app`);
  const contents = path.join(appDir, 'Contents');
  const id = a.key === 'scheduler' ? 'com.viralpost.launcher' : `com.viralpost.${a.key}`;
  const exeName = a.key === 'scheduler' ? 'viral-post' : `viral-${a.key}`;
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(contents, 'Resources'), { recursive: true });

  fs.writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0"><dict>
    <key>CFBundleName</key><string>${a.name}</string>
    <key>CFBundleDisplayName</key><string>${a.name}</string>
    <key>CFBundleIdentifier</key><string>${id}</string>
    <key>CFBundleExecutable</key><string>${exeName}</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleVersion</key><string>1</string>
    <key>LSUIElement</key><true/>
  </dict></plist>
  `);

  const exe = path.join(contents, 'MacOS', exeName);
  fs.writeFileSync(exe, `#!/bin/bash
  # Start Viral Post and its apps in the background if they aren't running, then open ${a.name}.
  BASE="http://localhost:${port}"
  URL="$BASE${a.path}"
  up() { /usr/bin/curl -s -o /dev/null --max-time 2 "$BASE/login.html"; }
  if ! up; then
    cd ${q(root)} && ${q(process.execPath)} scripts/background.js on >/dev/null 2>&1
    for i in $(seq 1 40); do up && break; sleep 0.5; done
  fi
  if [ -d "/Applications/Google Chrome.app" ]; then
    open -na "Google Chrome" --args --app="$URL"
  else
    open "$URL"
  fi
  `);
  fs.chmodSync(exe, 0o755);

  // App icon from this app's logo.
  try {
    const set = path.join(os.tmpdir(), `${exeName}.iconset`);
    fs.rmSync(set, { recursive: true, force: true });
    fs.mkdirSync(set);
    const src = path.join(root, 'public', 'icons', `${a.icon}-512.png`);
    for (const s of [16, 32, 128, 256, 512]) {
      execFileSync('sips', ['-z', String(s), String(s), src, '--out', path.join(set, `icon_${s}x${s}.png`)], { stdio: 'ignore' });
      execFileSync('sips', ['-z', String(s * 2), String(s * 2), src, '--out', path.join(set, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' });
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(contents, 'Resources', 'AppIcon.icns')]);
    execFileSync('touch', [appDir]);
  } catch { /* the app still works without the icon */ }
}

const on = enabledApps();
for (const a of APPS) {
  if (on.includes(a)) makeApp(a);
  else fs.rmSync(path.join(os.homedir(), 'Desktop', `${a.name}.app`), { recursive: true, force: true });
}
console.log('\nAPPS CREATED on your Desktop:');
for (const a of on) console.log(`  ${a.name}`);
console.log('Double-click one to open it. Drag them to your Dock to keep them handy.\n');
