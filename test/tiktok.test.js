// TikTok: connect, draft (inbox) and direct posting, token refresh, stats, against a fake TikTok API.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const calls = [];
let statusFor = 'SEND_TO_USER_INBOX';
const tk = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://x');
    calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body });
    const send = (obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const ok = { code: 'ok', message: '' };
    const p = url.pathname;
    if (p === '/v2/oauth/token/') {
      const f = new URLSearchParams(body.toString());
      if (f.get('grant_type') === 'authorization_code') return send({ access_token: 'act1', refresh_token: 'rft1', open_id: 'OPEN1', expires_in: 86400 });
      return send({ access_token: 'act2', refresh_token: 'rft2', open_id: 'OPEN1', expires_in: 86400 });
    }
    if (p === '/v2/user/info/') {
      const f = url.searchParams.get('fields');
      if (f === 'username') return send({ data: { user: { username: 'fvparade' } }, error: ok });
      if (f === 'follower_count') return send({ data: { user: { follower_count: 77 } }, error: ok });
      return send({ data: { user: { open_id: 'OPEN1', display_name: 'FV Parade', avatar_url: 'https://img/a.jpg' } }, error: ok });
    }
    if (p === '/v2/post/publish/creator_info/query/') return send({ data: { privacy_level_options: ['SELF_ONLY'] }, error: ok });
    if (p === '/v2/post/publish/inbox/video/init/' || p === '/v2/post/publish/video/init/') {
      return send({ data: { publish_id: 'pub1', upload_url: `http://127.0.0.1:${tk.address().port}/upload/1` }, error: ok });
    }
    if (p === '/upload/1') { res.writeHead(201); return res.end(); }
    if (p === '/v2/post/publish/status/fetch/') {
      if (statusFor === 'PUBLISH_COMPLETE') { // raw JSON: the id is bigger than a JS number can hold
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end('{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7300000000000000001]},"error":{"code":"ok"}}');
      }
      return send({ data: { status: statusFor }, error: ok });
    }
    if (p === '/v2/video/query/') return send({ data: { videos: [{ id: '7300000000000000001', like_count: 5, comment_count: 1, share_count: 2, view_count: 300 }] }, error: ok });
    send({ error: { code: 'not_found', message: 'nope' } }, 404);
  });
});

let server, base, db, scheduler, tiktok;
test.before(async () => {
  await new Promise((r) => tk.listen(0, r));
  Object.assign(process.env, {
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'tt-')),
    TIKTOK_API_BASE: `http://127.0.0.1:${tk.address().port}`,
    TIKTOK_CLIENT_KEY: 'awkey12345', TIKTOK_CLIENT_SECRET: 'secret12345', APP_PASSWORD: '',
  });
  const app = require('../src/server');
  db = require('../src/db');
  scheduler = require('../src/scheduler');
  tiktok = require('../src/tiktok');
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); tk.close(); });

test('connect goes through the https forwarding page and saves the account', async () => {
  const r = await fetch(`${base}/auth/tiktok`, { redirect: 'manual' });
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.host, 'www.tiktok.com');
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://danielskone.github.io/social-scheduler/tiktok-callback.html');
  assert.match(loc.searchParams.get('scope'), /video\.upload/);
  const cb = await fetch(`${base}/auth/tiktok/callback?code=c1&state=${loc.searchParams.get('state')}`, { redirect: 'manual' });
  assert.match(cb.headers.get('location'), /connected=1/);
  const a = db.prepare("SELECT * FROM accounts WHERE platform='tiktok'").get();
  assert.equal(a.external_id, 'OPEN1');
  assert.equal(a.username, 'fvparade');
  assert.equal(JSON.parse(a.access_token).refresh, 'rft1');
});

async function schedule(caption) {
  const id = db.prepare("SELECT id FROM accounts WHERE platform='tiktok'").get().id;
  const fd = new FormData();
  fd.set('caption', caption); fd.set('scheduledAt', new Date(Date.now() - 1000).toISOString()); fd.set('accountIds', String(id));
  fd.set('media', new Blob([Buffer.from('fakevideo')], { type: 'video/mp4' }), 'clip.mp4');
  const r = await fetch(`${base}/api/posts`, { method: 'POST', body: fd });
  assert.equal(r.status, 201, await r.clone().text());
  return (await r.json()).id;
}
const target = (postId) => db.prepare('SELECT * FROM post_targets WHERE post_id=?').get(postId);

test('draft mode sends the video to the TikTok inbox', async () => {
  const postId = await schedule('Draft one #FuquayVarina');
  await scheduler.publishDue();
  const t = target(postId);
  assert.equal(t.status, 'published', t.error);
  assert.ok(calls.some((c) => c.path === '/v2/post/publish/inbox/video/init/'));
  const put = calls.find((c) => c.path === '/upload/1');
  assert.equal(put.headers['content-range'], 'bytes 0-8/9');
  assert.equal(put.body.toString(), 'fakevideo');
});

test('direct mode posts with the allowed privacy and links the video', async () => {
  process.env.TIKTOK_MODE = 'direct';
  statusFor = 'PUBLISH_COMPLETE';
  const postId = await schedule('Direct one');
  await scheduler.publishDue();
  delete process.env.TIKTOK_MODE;
  const t = target(postId);
  assert.equal(t.status, 'published', t.error);
  const init = JSON.parse(calls.find((c) => c.path === '/v2/post/publish/video/init/').body.toString());
  assert.equal(init.post_info.privacy_level, 'SELF_ONLY');
  assert.equal(init.post_info.title, 'Direct one');
  assert.equal(t.permalink, 'https://www.tiktok.com/@fvparade/video/7300000000000000001');

  await scheduler.refreshStats();
  const s = db.prepare('SELECT likes, comments, shares, views FROM post_targets WHERE id=?').get(t.id);
  assert.deepEqual({ ...s }, { likes: 5, comments: 1, shares: 2, views: 300 });
});

test('expired access tokens are refreshed and the new refresh token is saved', async () => {
  const a = db.prepare("SELECT * FROM accounts WHERE platform='tiktok'").get();
  db.prepare('UPDATE accounts SET access_token=? WHERE id=?').run(JSON.stringify({ refresh: 'rft1', access: 'old', exp: 0 }), a.id);
  const n = await tiktok.followerCount(db.prepare('SELECT * FROM accounts WHERE id=?').get(a.id));
  assert.equal(n, 77);
  const saved = JSON.parse(db.prepare('SELECT access_token FROM accounts WHERE id=?').get(a.id).access_token);
  assert.equal(saved.refresh, 'rft2');
  assert.equal(saved.access, 'act2');
});

test('a failed TikTok post is reported', async () => {
  statusFor = 'FAILED';
  const postId = await schedule('Will fail');
  await scheduler.publishDue();
  assert.equal(target(postId).status, 'failed');
  statusFor = 'SEND_TO_USER_INBOX';
});

test('big files are split into allowed chunk sizes', () => {
  const MB = 1024 * 1024;
  assert.deepEqual(tiktok.chunking(3 * MB), { chunkSize: 3 * MB, count: 1 });
  const big = tiktok.chunking(205 * MB);
  assert.equal(big.chunkSize, 10 * MB);
  assert.equal(big.count, 20);
  assert.ok(205 * MB - (big.count - 1) * big.chunkSize <= 128 * MB);
});
