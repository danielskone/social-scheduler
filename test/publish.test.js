// End-to-end test against a fake Graph API: schedule posts, run the publisher, check results.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const calls = [];
const fakeGraph = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
    const p = url.pathname.replace(/^\/v[\d.]+\//, '');
    let out = {};
    if (p === 'PAGE1/feed') out = { id: 'PAGE1_111' };
    else if (p === 'PAGE1/photos') out = { id: 'photo1', post_id: 'PAGE1_222' };
    else if (p === 'IG1/media') out = { id: 'container1' };
    else if (p === 'container1') out = { status_code: 'FINISHED' };
    else if (p === 'IG1/media_publish') out = { id: 'igmedia1' };
    else if (p.endsWith('PAGE1_111') || p.endsWith('PAGE1_222')) out = { permalink_url: 'https://facebook.com/p/1', reactions: { summary: { total_count: 5 } }, comments: { summary: { total_count: 2 } }, shares: { count: 1 } };
    else if (p === 'igmedia1') out = { permalink: 'https://instagram.com/p/1', like_count: 9, comments_count: 3 };
    else if (p === 'igmedia1/insights') out = { data: [{ values: [{ value: 120 }] }] };
    else if (p === 'PAGE1' || p === 'IG1') out = { followers_count: 1000 };
    else if (p === 'me/accounts') out = { data: [{ id: 'PAGE1', name: 'My Page', access_token: 'pt1' }] };
    else if (p === 'me/businesses') out = { data: [{ owned_pages: { data: [{ id: 'PAGE1', name: 'My Page', access_token: 'pt1' }, { id: 'BIZPAGE', name: 'Biz Page', access_token: 'pt2', instagram_business_account: { id: 'IG9', username: 'biz' } }] } }] };
    else if (p === 'BADPAGE/feed') { res.statusCode = 400; out = { error: { message: 'Invalid token', code: 190 } }; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(out));
  });
});

let server, base, db, scheduler;

test.before(async () => {
  await new Promise((r) => fakeGraph.listen(0, r));
  const graph = `http://127.0.0.1:${fakeGraph.address().port}`;
  Object.assign(process.env, {
    GRAPH_BASE: graph, GRAPH_VIDEO_BASE: graph,
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sched-')),
    PUBLIC_BASE_URL: 'https://scheduler.example.com', APP_PASSWORD: '',
  });
  const app = require('../src/server');
  db = require('../src/db');
  scheduler = require('../src/scheduler');
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const ins = db.prepare('INSERT INTO accounts (platform, external_id, name, access_token) VALUES (?,?,?,?)');
  ins.run('facebook', 'PAGE1', 'My Page', 'tok');
  ins.run('instagram', 'IG1', 'My IG', 'tok');
  ins.run('facebook', 'BADPAGE', 'Broken Page', 'bad');
});

test.after(() => { server.close(); fakeGraph.close(); });

async function createPost(fields, file) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (file) fd.set('media', new Blob([Buffer.from('fakeimage')], { type: 'image/jpeg' }), 'pic.jpg');
  const res = await fetch(`${base}/api/posts`, { method: 'POST', body: fd });
  return { status: res.status, body: await res.json() };
}

test('rejects an Instagram post without media', async () => {
  const r = await createPost({ caption: 'hi', scheduledAt: new Date().toISOString(), accountIds: '2' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Instagram/);
});

test('publishes a text post to Facebook and a photo to Facebook + Instagram', async () => {
  const past = new Date(Date.now() - 1000).toISOString();
  const future = new Date(Date.now() + 3600e3).toISOString();
  const text = await createPost({ caption: 'Hello world', scheduledAt: past, accountIds: '1' });
  const photo = await createPost({ caption: 'Photo!', scheduledAt: past, accountIds: '1,2' }, true);
  const later = await createPost({ caption: 'Later', scheduledAt: future, accountIds: '1' });
  assert.equal(text.status, 201);
  assert.equal(photo.status, 201);

  await scheduler.publishDue();

  const t = await (await fetch(`${base}/api/posts/${text.body.id}`)).json();
  assert.equal(t.targets[0].status, 'published');
  assert.equal(t.targets[0].external_post_id, 'PAGE1_111');

  const p = await (await fetch(`${base}/api/posts/${photo.body.id}`)).json();
  assert.deepEqual(p.targets.map((x) => x.status), ['published', 'published']);
  const igCreate = calls.find((c) => c.path.endsWith('IG1/media'));
  assert.match(decodeURIComponent(igCreate.body), /image_url=https:\/\/scheduler\.example\.com\/media\//);

  const l = await (await fetch(`${base}/api/posts/${later.body.id}`)).json();
  assert.equal(l.targets[0].status, 'scheduled', 'future post must not publish early');
});

test('records failures with the error message', async () => {
  const r = await createPost({ caption: 'x', scheduledAt: new Date(Date.now() - 1000).toISOString(), accountIds: '3' });
  await scheduler.publishDue();
  const p = await (await fetch(`${base}/api/posts/${r.body.id}`)).json();
  assert.equal(p.targets[0].status, 'failed');
  assert.match(p.targets[0].error, /Invalid token/);
});

test('refreshes stats and followers', async () => {
  await fetch(`${base}/api/analytics/refresh`, { method: 'POST' });
  const a = await (await fetch(`${base}/api/analytics?days=7`)).json();
  const ig = a.posts.find((p) => p.platform === 'instagram');
  assert.equal(ig.likes, 9);
  assert.equal(ig.views, 120);
  assert.ok(a.followers.some((f) => f.followers === 1000));
});

test('media is publicly served for Instagram', async () => {
  const file = fs.readdirSync(path.join(process.env.DATA_DIR, 'media'))[0];
  const res = await fetch(`${base}/media/${file}`);
  assert.equal(res.status, 200);
});

test('finds Pages that are only visible through a business portfolio', async () => {
  const meta = require('../src/meta');
  const accts = await meta.accountsForUserToken('usertoken');
  assert.deepEqual(accts.map((a) => `${a.platform}:${a.external_id}`), ['facebook:PAGE1', 'facebook:BIZPAGE', 'instagram:IG9']);
  assert.equal(accts[2].access_token, 'pt2');
});

test('imports a post bundle, skips duplicates, and rejects bad bundles whole', async () => {
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fakejpeg')]).toString('base64');
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('x')]).toString('base64');
  const when = new Date(Date.now() + 86400e3).toISOString();
  const send = async (bundle) => {
    const fd = new FormData();
    fd.set('bundle', new Blob([JSON.stringify(bundle)], { type: 'application/json' }), 'b.json');
    const res = await fetch(`${base}/api/import`, { method: 'POST', body: fd });
    return { status: res.status, body: await res.json() };
  };
  const good = { posts: [
    { caption: 'Bundle one', when, accounts: [{ platform: 'facebook', name: 'my page' }, { platform: 'instagram', name: 'My IG' }], media: { name: 'a.jpg', data: jpg } },
    { caption: 'Bundle two', when, accounts: [{ platform: 'facebook', name: 'My-Page' }] },
  ] };
  const r1 = await send(good);
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(r1.body.imported, 2);
  const r2 = await send(good);
  assert.equal(r2.body.imported, 0);
  assert.equal(r2.body.skipped, 2);

  const bad = await send({ posts: [
    { caption: 'ok', when, accounts: [{ platform: 'facebook', name: 'My Page' }] },
    { caption: 'png to ig', when, accounts: [{ platform: 'instagram', name: 'My IG' }], media: { data: png } },
    { caption: 'who', when, accounts: [{ platform: 'facebook', name: 'Nobody' }] },
  ] });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /JPG/);
  assert.match(bad.body.error, /Nobody/);
  const all = await (await fetch(`${base}/api/posts?from=2000-01-01&to=2100-01-01`)).json();
  assert.ok(!all.some((p) => p.caption === 'ok'), 'nothing from a bad bundle is imported');
  const one = all.find((p) => p.caption === 'Bundle one');
  assert.equal(one.media_type, 'image');
  assert.equal(one.targets.length, 2);
});

test('imports posts with media links and downloads the media before publishing', async () => {
  const when = new Date(Date.now() + 86400e3).toISOString();
  const fd = new FormData();
  fd.set('bundle', new Blob([JSON.stringify({ posts: [
    { caption: 'Linked reel', when, accounts: [{ platform: 'instagram', name: 'My IG' }], media: { url: 'https://cdn.example.com/a/clip.mp4' } },
  ] })]), 'b.json');
  const r = await (await fetch(`${base}/api/import`, { method: 'POST', body: fd })).json();
  assert.equal(r.imported, 1, JSON.stringify(r));
  const row = db.prepare("SELECT * FROM posts WHERE caption='Linked reel'").get();
  assert.equal(row.media_type, 'video');
  assert.equal(row.media_file, null);
  assert.equal(row.media_source_url, 'https://cdn.example.com/a/clip.mp4');

  // Point it at a local server and let the publisher download + post it.
  const mediaServer = http.createServer((req, res) => res.end('fakevideo'));
  await new Promise((ok) => mediaServer.listen(0, ok));
  const url = `http://127.0.0.1:${mediaServer.address().port}/clip.mp4`;
  db.prepare('UPDATE posts SET media_source_url=?, scheduled_at=? WHERE id=?').run(url, new Date(Date.now() - 1000).toISOString(), row.id);
  await scheduler.publishDue();
  mediaServer.close();
  const after = db.prepare('SELECT * FROM posts WHERE id=?').get(row.id);
  assert.match(after.media_file, /\.mp4$/);
  assert.equal(fs.readFileSync(path.join(process.env.DATA_DIR, 'media', after.media_file), 'utf8'), 'fakevideo');
  const t = db.prepare('SELECT status FROM post_targets WHERE post_id=?').get(row.id);
  assert.equal(t.status, 'published');
});
