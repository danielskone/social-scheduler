// Makes the scheduler start by itself in the background on a Mac (no Terminal window).
//   npm run background:on    start now and every time you log in
//   npm run background:off   stop it and don't start at login
//   npm run background:status
// It uses macOS launchd. The Mac is kept from idle-sleeping while the app runs, so
// scheduled posts go out on time; the screen can still turn off.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const LABEL = 'com.socialscheduler.app';
const root = path.join(__dirname, '..');
const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const logPath = path.join(root, 'data', 'app.log');
const uid = process.getuid ? process.getuid() : 0;
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function launchctl(...args) {
  try { return execFileSync('launchctl', args, { stdio: 'pipe' }).toString(); } catch (e) { return null; }
}

function on() {
  if (process.platform !== 'darwin') throw new Error('Background mode is only for Macs.');
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const args = ['/usr/bin/caffeinate', '-i', process.execPath, path.join(root, 'scripts', 'start-with-tunnel.js')];
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>${args.map((a) => `<string>${xml(a)}</string>`).join('')}</array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(logPath)}</string>
  <key>StandardErrorPath</key><string>${xml(logPath)}</string>
</dict>
</plist>
`;
  launchctl('bootout', `gui/${uid}`, plistPath);
  fs.writeFileSync(plistPath, plist);
  if (launchctl('bootstrap', `gui/${uid}`, plistPath) === null) launchctl('load', '-w', plistPath);
  if (!launchctl('print', `gui/${uid}/${LABEL}`)) {
    console.log('Could not start it in the background. Send a screenshot of this window for help.');
    process.exitCode = 1;
    return;
  }
  console.log('BACKGROUND ON. The scheduler now runs by itself, and starts again whenever you log in.');
  console.log('Open http://localhost:3000 in your browser. You can close this Terminal window.');
}

function off() {
  launchctl('bootout', `gui/${uid}`, plistPath) ?? launchctl('unload', '-w', plistPath);
  fs.rmSync(plistPath, { force: true });
  console.log('BACKGROUND OFF. The scheduler is stopped and will not start at login.');
}

function status() {
  const out = launchctl('print', `gui/${uid}/${LABEL}`);
  if (!out) return console.log('Not running in the background.');
  const pid = (out.match(/\bpid = (\d+)/) || [])[1];
  console.log(pid ? `Running in the background (process ${pid}).` : 'Set up, but not running right now.');
  try {
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').slice(-5);
    console.log(`Latest log lines (${logPath}):\n  ${lines.join('\n  ')}`);
  } catch { /* no log yet */ }
}

({ on, off, status }[process.argv[2]] || (() => console.log('Use: on | off | status')))();
