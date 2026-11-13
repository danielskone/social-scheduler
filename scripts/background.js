// Makes Viral Post, Viral Touch CRM and Viral Clips start by themselves in the
// background on a Mac (no Terminal window), each as its own program on its own port.
//   npm run background:on    start them now and every time you log in
//   npm run background:off   stop them and don't start at login
//   npm run background:status
// It uses macOS launchd. The Mac is kept from idle-sleeping while the app runs, so
// scheduled posts go out on time; the screen can still turn off.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { APPS, RETIRED, enabledApps, portOf } = require('../src/apps');

// One background program per app. Viral Post keeps its old name, so updating replaces it.
const root = path.join(__dirname, '..');
const LABEL = (a) => (a.key === 'scheduler' ? 'com.socialscheduler.app' : `com.socialscheduler.${a.key}`);
const plistPath = (a) => path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL(a)}.plist`);
const logPath = (a) => path.join(root, 'data', a.key === 'scheduler' ? 'app.log' : `${a.key}.log`);
const uid = process.getuid ? process.getuid() : 0;
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function launchctl(...args) {
  try { return execFileSync('launchctl', args, { stdio: 'pipe' }).toString(); } catch (e) { return null; }
}

function startOne(a) {
  // Viral Post also runs the Instagram media tunnel and keeps the Mac from idle-sleeping.
  // The other apps start a few seconds later, so the first start-up isn't a scramble.
  const args = a.key === 'scheduler'
    ? ['/usr/bin/caffeinate', '-i', process.execPath, path.join(root, 'scripts', 'start-with-tunnel.js')]
    : ['/bin/sh', '-c', `sleep 6; exec '${process.execPath.replace(/'/g, `'\\''`)}' src/server.js`];
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL(a)}</string>
  <key>ProgramArguments</key>
  <array>${args.map((x) => `<string>${xml(x)}</string>`).join('')}</array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>APP</key><string>${a.key}</string>
    <key>PORT</key><string>${portOf(a)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(logPath(a))}</string>
  <key>StandardErrorPath</key><string>${xml(logPath(a))}</string>
</dict>
</plist>
`;
  launchctl('bootout', `gui/${uid}`, plistPath(a));
  fs.writeFileSync(plistPath(a), plist);
  if (launchctl('bootstrap', `gui/${uid}`, plistPath(a)) === null) launchctl('load', '-w', plistPath(a));
  return Boolean(launchctl('print', `gui/${uid}/${LABEL(a)}`));
}

function stopOne(a) {
  if (!fs.existsSync(plistPath(a))) return;
  launchctl('bootout', `gui/${uid}`, plistPath(a)) ?? launchctl('unload', '-w', plistPath(a));
  fs.rmSync(plistPath(a), { force: true });
}

function on() {
  if (process.platform !== 'darwin') throw new Error('Background mode is only for Macs.');
  fs.mkdirSync(path.join(os.homedir(), 'Library', 'LaunchAgents'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const want = enabledApps();
  for (const a of RETIRED) stopOne(a); // e.g. the old Viral Ads Studio program
  const failed = [];
  for (const a of APPS) {
    if (!want.includes(a)) { stopOne(a); continue; }
    if (!startOne(a)) failed.push(a.name);
  }
  if (failed.length) {
    console.log(`Could not start ${failed.join(', ')} in the background. Send a screenshot of this window for help.`);
    process.exitCode = 1;
    return;
  }
  console.log('BACKGROUND ON. Each app runs by itself, and starts again whenever you log in:');
  for (const a of want) console.log(`  ${a.name.padEnd(17)} http://localhost:${portOf(a)}`);
  require('./beta').restartIfOn(); // the beta tester site, if you turned it on (npm run beta)
  console.log('You can close this Terminal window.');
}

function off() {
  for (const a of [...APPS, ...RETIRED]) stopOne(a);
  console.log('BACKGROUND OFF. All the apps are stopped and will not start at login.');
}

function status() {
  for (const a of APPS) {
    const out = launchctl('print', `gui/${uid}/${LABEL(a)}`);
    if (!out) { console.log(`${a.name}: not running in the background.`); continue; }
    const pid = (out.match(/\bpid = (\d+)/) || [])[1];
    console.log(`${a.name}: ${pid ? `running (process ${pid}) at http://localhost:${portOf(a)}` : 'set up, but not running right now.'}`);
    try {
      const lines = fs.readFileSync(logPath(a), 'utf8').trim().split('\n').slice(-3);
      console.log(`  ${lines.join('\n  ')}`);
    } catch { /* no log yet */ }
  }
}

({ on, off, status }[process.argv[2]] || (() => console.log('Use: on | off | status')))();
