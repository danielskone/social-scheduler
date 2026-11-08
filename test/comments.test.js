// Analytics: who commented on a post (Facebook, Instagram, YouTube) and Facebook view counts,
// against fake Facebook and Google APIs.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fake = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/^\/v[\d.]+\//, '');
  const q = Object.fromEntries(url.searchParams);
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (url.pathname === '/token') return send(200, { access_token: 'at', expires_in: 3600 });
  if (p === 'PAGE1_1/comments') {
    return send(200, { data: [{ id: 'c1', message: 'Love this parade!', created_time: '2026-11-07T10:00:00+0000', like_count: 2, from: { id: 'u1', name: 'Jane Doe', picture: { data: { url: 'https://img/j.jpg' } } },
      comments: { data: [{ id: 'c1r', message: 'Thanks Jane!', created_time: '2026-11-07T11:00:00+0000', from: { id: 'PAGE1', name: 'My Page' } }] } }] });
  }
  if (p === 'PAGE1_2/comments' && q.fields.includes('from')) return send(400, { error: { message: 'Requires pages_read_user_content', code: 10 } });
  if (p === 'PAGE1_2/comments') return send(200, { data: [{ id: 'c2', message: 'Nice', created_time: '2026-11-07T10:00:00+0000' }] });
  if (p === 'PAGE1_1/insights' && q.metric === 'post_media_view') return send(200, { data: [{ values: [{ value: 432 }] }] });
  if (p.endsWith('/insights')) return send(400, { error: { message: 'Invalid metric', code: 100 } });
  if (p === 'PAGE1_1') return send(200, { reactions: { summary: { total_count: 5 } }, comments: { summary: { total_count: 1 } }, shares: { count: 0 } });
  if (p === 'igm1/comments') {
    return send(200, { data: [
      { id: 'i1', text: 'first!', username: 'early_bird', timestamp: '2026-11-07T09:00:00+0000', like_count: 0 },
      { id: 'i2', text: 'See you there', username: 'santa_fan', timestamp: '2026-11-07T12:00:00+0000', like_count: 3, replies: { data: [{ id: 'i2r', text: '🎄', username: 'king_daniel_st', timestamp: '2026-11-07T13:00:00+0000' }] } },
    ] });
  }
  if (p === 'igm2/comments') return send(403, { error: { message: '(#10) Application does not have permission for this action', code: 10 } });
  if (url.pathname === '/youtube/v3/commentThreads' && q.videoId === 'vid1') {
    return send(200, { items: [{ id: 't1', snippet: { topLevelComment: { id: 't1', snippet: { authorDisplayName: '@paradefan', authorProfileImageUrl: 'https://img/p.jpg', authorChannelUrl: 'https://youtube.com/@paradefan', textOriginal: 'Great video', publishedAt: '2026-11-07T08:00:00Z', likeCount: 4 } } } }] });
  }
  if (url.pathname === '/youtube/v3/commentThreads') return send(403, { error: { message: 'The video has disabled comments.', errors: [{ reason: 'commentsDisabled' }] } });
  send(404, { error: { message: 'not found' } });
});

let server, base, db, meta;

test.before(async () => {
  await new Promise((r) => fake.listen(0, r));
  const f = `http://127.0.0.1:${fake.address().port}`;
  Object.assign(process.env, {
    GRAPH_BASE: f, GRAPH_VIDEO_BASE: f, GOOGLE_API_BASE: f, GOOGLE_TOKEN_URL: `${f}/token`,
    GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec',
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'cmt-')), APP_PASSWORD: '', NTFY_BASE: f,
  });
  const app = require('../src/server');
  db = require('../src/db');
  meta = require('../src/meta');
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const acct = db.prepare('INSERT INTO accounts (platform, external_id, name, access_token) VALUES (?,?,?,?)');
  acct.run('facebook', 'PAGE1', 'My Page', 'tok');
  acct.run('instagram', 'IG1', 'My IG', 'tok');
  acct.run('youtube', 'UC1', 'My Channel', 'rt');
  acct.run('tiktok', 'TT1', 'My TikTok', '{}');
  const post = db.prepare("INSERT INTO posts (caption, scheduled_at) VALUES ('hi', '2026-11-07T00:00:00Z')").run().lastInsertRowid;
  const tgt = db.prepare("INSERT INTO post_targets (post_id, account_id, status, external_post_id, permalink, published_at) VALUES (?,?, 'published', ?, ?, '2026-11-07T00:00:00Z')");
  [[1, 'PAGE1_1'], [1, 'PAGE1_2'], [2, 'igm1'], [2, 'igm2'], [3, 'vid1'], [3, 'vid2'], [4, '777']].forEach(([a, id]) => tgt.run(post, a, id, `https://example.com/${id}`));
});
test.after(() => { server.close(); fake.close(); });

const comments = async (id) => (await fetch(`${base}/api/analytics/comments/${id}`)).json();

test('Facebook comments come with names, pictures and replies', async () => {
  const r = await comments(1);
  assert.equal(r.comments.length, 1);
  assert.equal(r.comments[0].name, 'Jane Doe');
  assert.equal(r.comments[0].picture, 'https://img/j.jpg');
  assert.equal(r.comments[0].replies[0].text, 'Thanks Jane!');
  assert.equal(r.note, undefined);
});

test('without the names permission, Facebook comments still show and say how to get names', async () => {
  const r = await comments(2);
  assert.equal(r.comments[0].text, 'Nice');
  assert.equal(r.comments[0].name, null);
  assert.match(r.note, /Reconnect/);
});

test('Instagram comments show usernames, newest first', async () => {
  const r = await comments(3);
  assert.deepEqual(r.comments.map((c) => c.name), ['@santa_fan', '@early_bird']);
  assert.equal(r.comments[0].replies[0].name, '@king_daniel_st');
});

test('Instagram without the comments permission asks for a reconnect', async () => {
  const r = await comments(4);
  assert.deepEqual(r.comments, []);
  assert.match(r.note, /Accounts/);
});

test('YouTube comments show the channel name; disabled comments explain why', async () => {
  const r = await comments(5);
  assert.equal(r.comments[0].name, '@paradefan');
  assert.equal(r.comments[0].profile, 'https://youtube.com/@paradefan');
  const off = await comments(6);
  assert.match(off.note, /turned off/);
});

test('TikTok explains comments must be seen in the app', async () => {
  const r = await comments(7);
  assert.deepEqual(r.comments, []);
  assert.match(r.note, /TikTok/);
  assert.equal(r.permalink, 'https://example.com/777');
});

test('unknown or unpublished posts are a 404', async () => {
  assert.equal((await fetch(`${base}/api/analytics/comments/999`)).status, 404);
});

test('Facebook stats include views when Facebook shares them', async () => {
  const s = await meta.facebookPostStats({ access_token: 'tok' }, 'PAGE1_1');
  assert.equal(s.views, 432);
  assert.equal(s.likes, 5);
});

test('new permissions are asked for at login', () => {
  assert.ok(meta.SCOPES.includes('pages_read_user_content'));
  assert.ok(meta.SCOPES.includes('instagram_manage_comments'));
});
