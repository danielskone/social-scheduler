// npm run mac-app : puts a "Viral Post" app on your Desktop. Double-click it to start
// Viral Post (if it isn't running) and open it in its own window.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

if (process.platform !== 'darwin') { console.log('This is only for Macs.'); process.exit(1); }
const root = path.join(__dirname, '..');
const port = process.env.PORT || 3000;
const appDir = path.join(os.homedir(), 'Desktop', 'Viral Post.app');
const contents = path.join(appDir, 'Contents');
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

fs.rmSync(appDir, { recursive: true, force: true });
fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
fs.mkdirSync(path.join(contents, 'Resources'), { recursive: true });

fs.writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Viral Post</string>
  <key>CFBundleDisplayName</key><string>Viral Post</string>
  <key>CFBundleIdentifier</key><string>com.viralpost.launcher</string>
  <key>CFBundleExecutable</key><string>viral-post</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
</dict></plist>
`);

const exe = path.join(contents, 'MacOS', 'viral-post');
fs.writeFileSync(exe, `#!/bin/bash
# Start Viral Post in the background if it isn't running, then open it.
URL="http://localhost:${port}"
up() { /usr/bin/curl -s -o /dev/null --max-time 2 "$URL/login.html"; }
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

// App icon from the Viral Post logo.
try {
  const set = path.join(os.tmpdir(), 'ViralPost.iconset');
  fs.rmSync(set, { recursive: true, force: true });
  fs.mkdirSync(set);
  const src = path.join(root, 'public', 'icons', 'icon-512.png');
  for (const s of [16, 32, 128, 256, 512]) {
    execFileSync('sips', ['-z', String(s), String(s), src, '--out', path.join(set, `icon_${s}x${s}.png`)], { stdio: 'ignore' });
    execFileSync('sips', ['-z', String(s * 2), String(s * 2), src, '--out', path.join(set, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' });
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(contents, 'Resources', 'AppIcon.icns')]);
  execFileSync('touch', [appDir]);
} catch { /* the app still works without the icon */ }

console.log('\nVIRAL POST APP CREATED on your Desktop.');
console.log('Double-click it to open Viral Post. Drag it to your Dock to keep it handy.\n');
