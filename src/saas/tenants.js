// Runs one private copy of Viral Post for each customer.
//
// Every customer gets their own folder (tenants/<id>/) with their own database, pictures,
// clips and settings, and their own copy of the app running in the background on this
// server (so their posts publish on time even when nobody is signed in). The copies only
// listen on 127.0.0.1, and each one only answers requests that carry its own secret key,
// so customers can never reach each other's data.
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const SERVER = path.join(__dirname, '..', 'server.js');

// Settings from the owner's .env that every customer copy shares: the platform apps
// (Meta, Google, TikTok) that customers connect their own accounts through. Nothing else
// from the owner's .env (passwords, Stripe, the owner's email login) is passed on.
const SHARED_ENV = [
  'PATH', 'HOME', 'LANG', 'TZ', 'NODE_ENV', 'FFMPEG_PATH', 'NTFY_BASE',
  'META_APP_ID', 'META_APP_SECRET', 'META_LOGIN_CONFIG_ID', 'GRAPH_VERSION', 'GRAPH_BASE', 'GRAPH_VIDEO_BASE', 'IG_UPLOAD_BASE',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_API_BASE', 'GOOGLE_TOKEN_URL', 'YOUTUBE_PRIVACY',
  'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_MODE', 'TIKTOK_PRIVACY', 'TIKTOK_API_BASE',
];

// What a customer may set for their own copy (Account page > Email sending).
const TENANT_SETTINGS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'IMAP_HOST', 'IMAP_PORT', 'EMAIL_FROM', 'EMAIL_FROM_NAME', 'EMAIL_MAILING_ADDRESS', 'BOOKING_TIMEZONE'];

// Headers a browser must never be able to set itself.
const PRIVATE_HEADERS = ['x-vp-tenant-key', 'x-vp-user', 'cf-connecting-ip', 'x-forwarded-for', 'x-real-ip'];
const HOP_HEADERS = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer'];

function readSettings(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function writeSettings(file, values) {
  const lines = [];
  for (const k of TENANT_SETTINGS) {
    const v = values[k];
    if (v === undefined || v === null || v === '') continue;
    const s = String(v);
    if (/[\r\n]/.test(s)) throw new Error(`${k} can't contain line breaks.`);
    const q = !s.includes('"') ? '"' : !s.includes("'") ? "'" : null;
    if (!q) throw new Error(`${k} can't contain both ' and " characters.`);
    lines.push(`${k}=${q}${s}${q}`);
  }
  fs.writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 });
}

function createTenants({ dir, basePort = 4100, publicBaseUrl, env = process.env, log = console.log } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const running = new Map(); // userId -> { child, port, key, ready, stopping, restarts }

  const folder = (id) => path.join(dir, String(Number(id)));
  const portFor = (id) => basePort + Number(id);

  function childEnv(id, key) {
    const e = {};
    for (const k of SHARED_ENV) if (env[k] !== undefined) e[k] = env[k];
    return {
      ...e,
      TENANT_KEY: key,
      DATA_DIR: folder(id),
      PORT: String(portFor(id)),
      HOST: '127.0.0.1',
      // Public links (pictures for Instagram, sign-up forms, booking pages) live under /w/<id>.
      PUBLIC_BASE_URL: `${publicBaseUrl}/w/${id}`,
      // Facebook, Google and TikTok send people back to one shared address on the main site.
      OAUTH_BASE_URL: publicBaseUrl,
      TIKTOK_REDIRECT_URI: `${publicBaseUrl}/auth/tiktok/callback`,
      // Which apps customers get (SAAS_APPS=scheduler sells Viral Post on its own; default all).
      APPS: env.SAAS_APPS || 'all',
    };
  }

  function waitForPort(port, ms = 15000) {
    const until = Date.now() + ms;
    return new Promise((resolve, reject) => {
      const tryOnce = () => {
        const s = net.connect(port, '127.0.0.1');
        s.once('connect', () => { s.destroy(); resolve(); });
        s.once('error', () => { s.destroy(); if (Date.now() > until) reject(new Error('Your Viral Post did not start. Please try again in a minute.')); else setTimeout(tryOnce, 150); });
      };
      tryOnce();
    });
  }

  function start(id, restarts = 0) {
    id = Number(id);
    const have = running.get(id);
    if (have) return have.ready;
    fs.mkdirSync(folder(id), { recursive: true });
    const key = crypto.randomBytes(24).toString('hex');
    const t = { port: portFor(id), key, stopping: false, restarts };
    t.child = spawn(process.execPath, [SERVER], { env: childEnv(id, key), cwd: path.join(__dirname, '..', '..'), stdio: ['ignore', 'pipe', 'pipe'] });
    const tag = `[customer ${id}]`;
    t.child.stdout.on('data', (d) => log(`${tag} ${String(d).trimEnd()}`));
    t.child.stderr.on('data', (d) => log(`${tag} ${String(d).trimEnd()}`));
    t.child.on('exit', (code) => {
      t.exited = true;
      if (t.onExit) t.onExit();
      if (running.get(id) !== t) return;
      running.delete(id);
      if (t.stopping) return;
      // Crashed: start again, waiting a little longer each time (up to 1 minute).
      const wait = Math.min(60000, 1000 * 2 ** Math.min(t.restarts, 6));
      log(`${tag} stopped (code ${code}); restarting in ${wait / 1000}s`);
      setTimeout(() => { if (!running.has(id)) start(id, t.restarts + 1).catch(() => {}); }, wait).unref();
    });
    t.ready = waitForPort(t.port);
    t.ready.catch(() => {});
    running.set(id, t);
    return t.ready;
  }

  // Stops a customer's copy; the promise settles once it has fully exited.
  function stop(id) {
    const t = running.get(Number(id));
    if (!t) return Promise.resolve();
    t.stopping = true;
    running.delete(Number(id));
    const done = new Promise((resolve) => { if (t.exited) resolve(); else t.onExit = resolve; });
    t.child.kill('SIGTERM');
    const force = setTimeout(() => t.child.kill('SIGKILL'), 5000);
    return done.finally(() => clearTimeout(force));
  }

  function stopAll() { [...running.keys()].forEach(stop); }

  // Passes one request on to a customer's copy and streams the answer back.
  async function proxy(id, req, res, { signedIn, pathOverride, publicIp } = {}) {
    await start(id);
    const t = running.get(Number(id));
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (PRIVATE_HEADERS.includes(k) || HOP_HEADERS.includes(k)) continue;
      headers[k] = v;
    }
    if (headers.cookie) headers.cookie = headers.cookie.split(/;\s*/).filter((c) => !c.startsWith('vps=')).join('; ') || undefined;
    if (!headers.cookie) delete headers.cookie;
    headers['x-vp-tenant-key'] = t.key;
    if (signedIn) headers['x-vp-user'] = '1';
    // Public pages are marked as an outside visitor (like the Mac's tunnel does), so the copy
    // only answers its public pages and its "too many tries" guard sees the real visitor.
    else if (publicIp) headers['cf-connecting-ip'] = publicIp;
    await new Promise((resolve) => {
      const up = http.request({ host: '127.0.0.1', port: t.port, method: req.method, path: pathOverride || req.url, headers }, (r) => {
        const out = { ...r.headers };
        HOP_HEADERS.forEach((h) => delete out[h]);
        res.writeHead(r.statusCode, out);
        r.pipe(res);
        r.on('end', resolve);
        r.on('error', resolve);
      });
      up.on('error', (e) => {
        if (!res.headersSent) res.status(502).send(`Viral Post is restarting. Please refresh in a moment. (${e.code || e.message})`);
        else res.destroy();
        resolve();
      });
      req.on('aborted', () => up.destroy());
      req.pipe(up);
    });
  }

  return {
    start, stop, stopAll, proxy, folder,
    isRunning: (id) => running.has(Number(id)),
    settingsFile: (id) => path.join(folder(id), 'settings.env'),
    readSettings: (id) => readSettings(path.join(folder(id), 'settings.env')),
    saveSettings(id, values) {
      fs.mkdirSync(folder(id), { recursive: true });
      writeSettings(path.join(folder(id), 'settings.env'), values);
      if (!running.has(Number(id))) return Promise.resolve();
      return stop(id).then(() => start(id)); // reload with the new settings
    },
  };
}

module.exports = { createTenants, TENANT_SETTINGS, SHARED_ENV, readSettings, writeSettings };
