// Opens Viral Post to beta testers from this Mac, for free.
//   npm run beta          turn the beta on (asks for your email the first time)
//   npm run beta:status   is it running, and what is the address?
//   npm run beta:off      turn it off (your own Viral Post keeps running)
//
// What it does:
//   1. Tailscale Funnel gives this Mac one fixed https web address (https://<mac>.<name>.ts.net)
//      that only shows the tester site (port 3100), nothing else on the Mac.
//   2. Saves the beta settings in .env (invite only, testers free, YouTube and TikTok off).
//   3. Runs the tester site (src/saas/gateway.js) in the background with launchd, so it
//      keeps running with no Terminal window and starts again when you log in.
// Each tester gets their own login and their own private copy of the app in saas-data/.
// Your own posts, accounts and contacts in data/ are never touched.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFileSync, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
const PORT = 3100;
const LABEL = 'com.socialscheduler.beta';
const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const logFile = path.join(root, 'data', 'beta.log');
const uid = process.getuid ? process.getuid() : 0;
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function readEnv() {
  const out = {};
  try {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env yet */ }
  return out;
}

// Sets keys in .env, replacing old lines and keeping everything else.
function writeEnv(values) {
  let text = '';
  try { text = fs.readFileSync(envPath, 'utf8'); } catch { /* new file */ }
  const lines = text.split('\n').filter((l) => !Object.keys(values).some((k) => l.startsWith(`${k}=`)));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const [k, v] of Object.entries(values)) lines.push(`${k}=${v}`);
  fs.writeFileSync(envPath, `${lines.join('\n')}\n`, { mode: 0o600 });
}

function ask(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => { rl.close(); resolve(a.trim()); });
  });
}

function tailscaleCli() {
  const options = ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale'];
  return options.find((p) => fs.existsSync(p)) || null;
}

function macAddress(cli) {
  try {
    const s = JSON.parse(execFileSync(cli, ['status', '--json'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString());
    const name = String(s.Self?.DNSName || '').replace(/\.$/, '');
    return name ? `https://${name}` : null;
  } catch { return null; }
}

const launchctl = (...args) => { try { return execFileSync('launchctl', args, { stdio: 'pipe' }).toString(); } catch { return null; } };

function startBackground() {
  const args = ['/usr/bin/caffeinate', '-i', process.execPath, path.join(root, 'src', 'saas', 'gateway.js')];
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>${args.map((x) => `<string>${xml(x)}</string>`).join('')}</array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(logFile)}</string>
  <key>StandardErrorPath</key><string>${xml(logFile)}</string>
</dict>
</plist>
`);
  launchctl('bootout', `gui/${uid}`, plist);
  if (launchctl('bootstrap', `gui/${uid}`, plist) === null) launchctl('load', '-w', plist);
  return Boolean(launchctl('print', `gui/${uid}/${LABEL}`));
}

async function on() {
  if (process.platform !== 'darwin') throw new Error('The beta command is for your Mac.');
  const cli = tailscaleCli();
  if (!cli) {
    console.log('Tailscale is not installed on this Mac. Install it from tailscale.com/download, sign in, then run npm run beta again.');
    process.exitCode = 1;
    return;
  }
  const address = macAddress(cli);
  if (!address) {
    console.log('Tailscale is not signed in, or MagicDNS is off. Open the Tailscale app and sign in. Then open https://login.tailscale.com/admin/dns and turn on MagicDNS and HTTPS. Then run npm run beta again.');
    process.exitCode = 1;
    return;
  }

  const env = readEnv();
  let email = env.SAAS_ADMIN_EMAIL;
  while (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) email = await ask('Your email (you sign in to the tester site with it as the owner): ');
  writeEnv({
    SAAS_BETA: '1',
    SAAS_PUBLIC_URL: address,
    SAAS_ADMIN_EMAIL: email,
    SAAS_PORT: String(PORT),
    SAAS_SIGNUPS: env.SAAS_SIGNUPS || 'closed',
    SAAS_PRICE_LABEL: env.SAAS_PRICE_LABEL || '"Free during beta"',
  });

  console.log('\nTurning on Tailscale Funnel. If it shows a link, open it, click to allow Funnel, and come back here.\n');
  const r = spawnSync(cli, ['funnel', '--bg', String(PORT)], { stdio: 'inherit', timeout: 10 * 60e3 });
  if (r.status !== 0) {
    console.log('\nFunnel did not turn on. Open https://login.tailscale.com/admin/dns and click Enable HTTPS, then run npm run beta again. If it still fails, send a screenshot of this window.');
    process.exitCode = 1;
    return;
  }

  if (!startBackground()) {
    console.log('Could not start the tester site in the background. Send a screenshot of this window for help.');
    process.exitCode = 1;
    return;
  }

  console.log(`
BETA ON. Your tester site is: ${address}

It runs by itself in the background. Your own Viral Post is not changed.

Next steps (only the first time):
1. Make your owner account: open ${address}/signup?owner=1 and sign up with ${email}
2. In your Meta app (developers.facebook.com, My Scheduler), go to Facebook Login for Business, Settings.
   Under Valid OAuth Redirect URIs, add: ${address}/auth/facebook/callback
   Keep the old addresses that are already there. Click Save changes.
3. To add a tester: open ${address}/admin, type their name and email, and tap Make their login.
   Send them the message it shows. Then add them as a Tester in your Meta app (App roles, Roles).

You can close this Terminal window.`);
}

function off() {
  if (fs.existsSync(plist)) {
    launchctl('bootout', `gui/${uid}`, plist) ?? launchctl('unload', '-w', plist);
    fs.rmSync(plist, { force: true });
  }
  const cli = tailscaleCli();
  if (cli) spawnSync(cli, ['funnel', '--https=443', 'off'], { stdio: 'ignore' });
  console.log('BETA OFF. Testers can\'t open the site now. Their accounts and posts are kept, so npm run beta brings it all back.');
}

function status() {
  const env = readEnv();
  const out = launchctl('print', `gui/${uid}/${LABEL}`);
  const pid = out && (out.match(/\bpid = (\d+)/) || [])[1];
  if (!out) console.log('Beta: off.');
  else console.log(`Beta: ${pid ? 'running' : 'set up, but not running right now'}. Address: ${env.SAAS_PUBLIC_URL || '(not saved)'}`);
  const cli = tailscaleCli();
  if (cli) {
    const f = spawnSync(cli, ['funnel', 'status'], { encoding: 'utf8' });
    console.log(`Funnel: ${/Funnel on|proxy/i.test(f.stdout || '') ? 'on' : 'off'}`);
  }
  try { console.log(`  ${fs.readFileSync(logFile, 'utf8').trim().split('\n').slice(-3).join('\n  ')}`); } catch { /* no log yet */ }
}

// npm run update + background:on also restarts the tester site, so testers get the update.
function restartIfOn() {
  if (fs.existsSync(plist)) launchctl('kickstart', '-k', `gui/${uid}/${LABEL}`);
}

module.exports = { restartIfOn, writeEnv };

if (require.main === module) {
  const cmd = { on, off, status }[process.argv[2] || 'on'];
  if (!cmd) console.log('Use: on | off | status');
  else Promise.resolve(cmd()).catch((e) => { console.log(e.message); process.exitCode = 1; });
}
