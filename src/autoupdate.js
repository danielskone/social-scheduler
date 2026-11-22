// Automatic updates on the Mac, so nobody has to open Terminal.
// Viral Post checks GitHub every 30 minutes. When there is a new version it waits until no post
// is going out or due in the next 10 minutes, runs the same update as `npm run update`, writes
// the new version number, and buzzes the phone. Every app (Viral Post, Viral Touch CRM, Viral
// Clips) notices the new number within a minute, waits until it isn't busy, and stops; macOS
// (launchd, set up by `npm run background:on`) starts it again right away with the new code.
// Your posts and settings (data/ and .env) are never touched. Turn it off with AUTO_UPDATE=off in .env.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('./config');

const REPO = 'danielskone/social-scheduler';
const root = path.join(__dirname, '..');
const versionFile = () => path.join(config.dataDir, 'app-version.txt');
const logFile = () => path.join(config.dataDir, 'update.log');
const CHECK_EVERY = 30 * 60e3;
const RETRY_FAILED_AFTER = 6 * 3600e3;

const readVersion = () => { try { return fs.readFileSync(versionFile(), 'utf8').trim(); } catch { return ''; } };
const log = (msg) => { try { fs.appendFileSync(logFile(), `${new Date().toISOString()} ${msg}\n`); } catch { /* fine */ } };

// The newest version on GitHub (the id of the latest change on main).
async function latest() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
    headers: { Accept: 'application/vnd.github.sha', 'User-Agent': 'viral-post-updater' },
    signal: AbortSignal.timeout(20e3),
  });
  if (!res.ok) throw new Error(`GitHub said ${res.status}`);
  const sha = (await res.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('GitHub gave an unexpected answer');
  return sha;
}

// Not while a post is going out or about to.
function quietForPosts(db) {
  const busy = db.prepare(`SELECT 1 FROM post_targets t JOIN posts p ON p.id=t.post_id
    WHERE t.status='publishing' OR (t.status='scheduled' AND p.scheduled_at <= ?) LIMIT 1`).get(new Date(Date.now() + 10 * 60e3).toISOString());
  return !busy;
}

function runUpdate() {
  return new Promise((resolve) => {
    const out = fs.openSync(logFile(), 'a');
    const child = spawn('/bin/sh', [path.join(root, 'scripts', 'update.sh')], { cwd: root, stdio: ['ignore', out, out],
      env: { ...process.env, PATH: `${path.dirname(process.execPath)}:/usr/local/bin:/opt/homebrew/bin:${process.env.PATH || '/usr/bin:/bin'}` } });
    child.on('error', (err) => { log(`could not run the update: ${err.message}`); resolve(false); });
    child.on('close', (code) => { fs.closeSync(out); resolve(code === 0); });
  });
}

let failed = { sha: null, at: 0 };
let running = false;

// One check. Returns what happened (for tests and the log).
async function check({ db = require('./db'), notify = require('./notify'), update = runUpdate, getLatest = latest } = {}) {
  if (running) return 'busy';
  running = true;
  try {
    const sha = await getLatest();
    if (sha === readVersion()) return 'current';
    if (failed.sha === sha && Date.now() - failed.at < RETRY_FAILED_AFTER) return 'waiting-after-failure';
    if (!quietForPosts(db)) return 'posts-due';
    log(`updating to ${sha.slice(0, 7)}`);
    if (!(await update())) {
      failed = { sha, at: Date.now() };
      log('update failed, will try again in 6 hours');
      await notify.send('Viral Post update did not work', 'The apps keep running on the old version. It will try again in 6 hours.', { tags: 'warning' }).catch(() => {});
      return 'failed';
    }
    const first = !readVersion();
    fs.writeFileSync(versionFile(), sha + '\n');
    log(`updated to ${sha.slice(0, 7)}, restarting the apps`);
    if (!first) await notify.send('Viral Post updated', 'The newest version is installed. The apps restart by themselves in about a minute.', { tags: 'sparkles' }).catch(() => {});
    try { require('../scripts/beta').restartIfOn(); } catch { /* no sign-up site */ }
    return 'updated';
  } catch (err) {
    log(`check failed: ${err.message}`);
    return 'error';
  } finally {
    running = false;
  }
}

// Every app: restart (macOS starts it again) once a new version is installed and nothing is busy.
function watchVersion({ busy = () => false, every = 60e3, exit = () => process.kill(process.pid, 'SIGTERM') } = {}) {
  const started = readVersion();
  const timer = setInterval(() => {
    const now = readVersion();
    if (!now || now === started || busy()) return;
    clearInterval(timer);
    console.log(`[update] new version ${now.slice(0, 7)} installed, restarting`);
    setTimeout(exit, 2000);
  }, every);
  timer.unref();
  return timer;
}

function enabled(env = process.env) {
  return process.platform === 'darwin' && Boolean(env.APP) && env.NO_JOBS !== '1' && !/^(off|0|false|no)$/i.test(env.AUTO_UPDATE || '');
}

// appKey: the app this program runs. Viral Post does the checking; every app restarts itself.
function start(appKey, { busy } = {}) {
  if (!enabled()) return;
  watchVersion({ busy });
  if (appKey !== 'scheduler') return;
  setTimeout(() => check(), 3 * 60e3).unref(); // a few minutes after start, then every 30 minutes
  setInterval(() => check(), CHECK_EVERY).unref();
}

module.exports = { start, check, watchVersion, enabled, quietForPosts, versionFile };
