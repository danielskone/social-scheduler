// YouTube: migration of older databases, connect, upload, stats, against a fake Google API.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const calls = [];
let refreshCount = 0;
const google = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://x');
    calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body });
    const send = (code, obj, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
    if (url.pathname === '/token') {
      const p = new URLSearchParams(body.toString());
      if (p.get('grant_type') === 'authorization_code') return send(200, { access_token: 'at1', refresh_token: 'rt1', expires_in: 3600 });
      refreshCount++;
      if (p.get('refresh_token') === 'revoked') return send(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      return send(200, { access_token: 'at2', expires_in: 3600 });
    }
    if (url.pathname === '/youtube/v3/channels' && url.searchParams.get('mine')) {
      return send(200, { items: [{ id: 'UC1', snippet: { title: 'FV Parade', customUrl: '@fvparade', thumbnails: { default: { url: 'https://img/x.jpg' } } } }] });
    }
    if (url.pathname === '/youtube/v3/channels') return send(200, { items: [{ statistics: { subscriberCount: '250', hiddenSubscriberCount: false } }] });
    if (url.pathname === '/upload/youtube/v3/videos') {
      return send(200, {}, { Location: `http://127.0.0.1:${google.address().port}/upload-session/1` });
    }
    if (url.pathname === '/upload-session/1') return send(200, { id: 'vid123' });
    if (url.pathname === '/youtube/v3/videos') return send(200, { items: [{ statistics: { viewCount: '900', likeCount: '40', commentCount: '3' } }] });
    send(404, { error: { message: 'not found' } });
  });
});

let server, base, db, scheduler, youtube;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-'));

test.before(async () => {
  await new Promise((r) => google.listen(0, r));
  const g = `http://127.0.0.1:${google.address().port}`;
  // An older database that only allowed facebook/instagram, with a scheduled post.
  const Database = require('better-sqlite3');
  fs.mkdirSync(path.join(dataDir, 'media'), { recursive: true });
  const old = new Database(path.join(dataDir, 'scheduler.db'));
  old.exec(`CREATE TABLE accounts (id INTEGER PRIMARY KEY, platform TEXT NOT NULL CHECK (platform IN ('facebook','instagram')), external_id TEXT NOT NULL, name TEXT NOT NULL, username TEXT, picture_url TEXT, access_token TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (platform, external_id));
    CREATE TABLE posts (id INTEGER PRIMARY KEY, caption TEXT NOT NULL DEFAULT '', media_file TEXT, media_type TEXT, scheduled_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE post_targets (id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'scheduled', external_post_id TEXT, permalink TEXT, error TEXT, published_at TEXT, likes INTEGER, comments INTEGER, shares INTEGER, views INTEGER, stats_updated_at TEXT);
    INSERT INTO accounts (platform, external_id, name, access_token) VALUES ('facebook','PAGE1','Old Page','tok');
    INSERT INTO posts (caption, scheduled_at) VALUES ('kept post', '2099-01-01T00:00:00.000Z');
    INSERT INTO post_targets (post_id, account_id) VALUES (1, 1);`);
  old.close();
  Object.assign(process.env, {
    DATA_DIR: dataDir, GOOGLE_API_BASE: g, GOOGLE_TOKEN_URL: `${g}/token`,
    GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'secret123',
    OAUTH_BASE_URL: 'http://localhost:3000', APP_PASSWORD: '', NTFY_BASE: g,
  });
  const app = require('../src/server');
  db = require('../src/db');
  scheduler = require('../src/scheduler');
  youtube = require('../src/youtube');
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); google.close(); });

test('older databases are upgraded without losing accounts or posts', () => {
  assert.equal(db.prepare('SELECT name FROM accounts WHERE id=1').get().name, 'Old Page');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM post_targets').get().n, 1);
  assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name='accounts'").get().sql, /'youtube'/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('connect redirects to Google and the callback saves the channel', async () => {
  const r = await fetch(`${base}/auth/youtube`, { redirect: 'manual' });
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.host, 'accounts.google.com');
  assert.equal(loc.searchParams.get('redirect_uri'), 'http://localhost:3000/auth/youtube/callback');
  assert.equal(loc.searchParams.get('access_type'), 'offline');
  const cb = await fetch(`${base}/auth/youtube/callback?code=abc&state=${loc.searchParams.get('state')}`, { redirect: 'manual' });
  assert.match(cb.headers.get('location'), /connected=1/);
  const a = db.prepare("SELECT * FROM accounts WHERE platform='youtube'").get();
  assert.equal(a.external_id, 'UC1');
  assert.equal(a.username, 'fvparade');
  assert.equal(a.access_token, 'rt1');
});

test('YouTube posts need a video', async () => {
  const id = db.prepare("SELECT id FROM accounts WHERE platform='youtube'").get().id;
  const fd = new FormData();
  fd.set('caption', 'no video'); fd.set('scheduledAt', new Date(Date.now() + 3600e3).toISOString()); fd.set('accountIds', String(id));
  const r = await fetch(`${base}/api/posts`, { method: 'POST', body: fd });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /YouTube posts need a video/);
});

test('uploads a scheduled video, then reads its stats and subscribers', async () => {
  const id = db.prepare("SELECT id FROM accounts WHERE platform='youtube'").get().id;
  const fd = new FormData();
  fd.set('caption', 'Parade highlights 🎄 <3\nSecond line #FuquayVarina');
  fd.set('title', '');
  fd.set('scheduledAt', new Date(Date.now() - 1000).toISOString());
  fd.set('accountIds', String(id));
  fd.set('media', new Blob([Buffer.from('fakevideo')], { type: 'video/mp4' }), 'clip.mp4');
  const created = await fetch(`${base}/api/posts`, { method: 'POST', body: fd });
  assert.equal(created.status, 201, await created.clone().text());
  await scheduler.publishDue();
  const t = db.prepare("SELECT t.* FROM post_targets t JOIN accounts a ON a.id=t.account_id WHERE a.platform='youtube'").get();
  assert.equal(t.status, 'published', t.error);
  assert.equal(t.permalink, 'https://www.youtube.com/watch?v=vid123');
  const init = calls.find((c) => c.path === '/upload/youtube/v3/videos');
  const meta = JSON.parse(init.body.toString());
  assert.equal(meta.snippet.title, 'Parade highlights 🎄 3');
  assert.ok(!meta.snippet.description.includes('<'));
  assert.equal(meta.status.privacyStatus, 'public');
  assert.equal(init.headers.authorization, 'Bearer at1');
  assert.equal(calls.find((c) => c.path === '/upload-session/1').body.toString(), 'fakevideo');

  await scheduler.refreshStats();
  const s = db.prepare('SELECT likes, comments, views FROM post_targets WHERE id=?').get(t.id);
  assert.deepEqual({ ...s }, { likes: 40, comments: 3, views: 900 });
  assert.equal(db.prepare('SELECT followers FROM follower_snapshots WHERE account_id=?').get(id).followers, 250);
});

test('titles: custom title wins, long ones are shortened, hashtags-only lines skipped', () => {
  assert.equal(youtube.titleFor({ title: 'My title', caption: 'x' }), 'My title');
  assert.equal(youtube.titleFor({ caption: '#a #b\nReal line' }), 'Real line');
  const long = youtube.titleFor({ caption: 'word '.repeat(40) });
  assert.ok(long.length <= 100 && long.endsWith('…'));
});

test('an expired Google sign-in gives a clear message', async () => {
  await assert.rejects(
    youtube.publishYouTube({ access_token: 'revoked' }, { media_type: 'video', media_file: 'x.mp4' }),
    /Connect YouTube" again/,
  );
});

test('import accepts YouTube posts with a title and rejects photos', async () => {
  const when = new Date(Date.now() + 86400e3).toISOString();
  const send = async (bundle) => {
    const fd = new FormData();
    fd.set('bundle', new Blob([JSON.stringify(bundle)]), 'b.json');
    const r = await fetch(`${base}/api/import`, { method: 'POST', body: fd });
    return r.json();
  };
  const ok = await send({ posts: [{ caption: 'yt', title: 'Big day', when, accounts: [{ platform: 'youtube', name: 'FV Parade' }], media: { url: 'https://cdn.example.com/v.mp4' } }] });
  assert.equal(ok.imported, 1, JSON.stringify(ok));
  assert.equal(db.prepare("SELECT title FROM posts WHERE caption='yt'").get().title, 'Big day');
  const bad = await send({ posts: [{ caption: 'yt2', when, accounts: [{ platform: 'youtube', username: 'fvparade' }], media: { url: 'https://cdn.example.com/p.jpg' } }] });
  assert.match(bad.error, /YouTube posts need a video/);
});
