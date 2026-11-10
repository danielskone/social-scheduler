// Quick opening: app files are fingerprinted and kept by the browser; the post list is loaded in bulk.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let server, base, db;
test.before(() => {
  Object.assign(process.env, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'speed-')), APP_PASSWORD: '' });
  const app = require('../src/server');
  db = require('../src/db');
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('the page names app files with a fingerprint, and those files are kept for a year', async () => {
  const html = await (await fetch(`${base}/`)).text();
  const m = html.match(/src="\/app\.js\?v=([0-9a-f]{10})"/);
  assert.ok(m, 'app.js is fingerprinted');
  assert.match(html, /href="\/style\.css\?v=[0-9a-f]{10}"/);
  const page = await fetch(`${base}/`);
  assert.equal(page.headers.get('cache-control'), 'no-cache');
  const js = await fetch(`${base}/app.js?v=${m[1]}`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('cache-control'), /max-age=31536000.*immutable/);
  const plain = await fetch(`${base}/app.js`); // without a fingerprint: not kept forever
  assert.doesNotMatch(plain.headers.get('cache-control') || '', /immutable/);
});

test('the post list matches each post loaded on its own', async () => {
  const a = db.prepare("INSERT INTO accounts (platform, external_id, name, access_token) VALUES ('facebook','p1','Page','t')").run().lastInsertRowid;
  const b = db.prepare("INSERT INTO accounts (platform, external_id, name, access_token) VALUES ('instagram','i1','IG','t')").run().lastInsertRowid;
  const now = Date.now();
  for (let i = 0; i < 30; i++) {
    const id = db.prepare('INSERT INTO posts (caption, media_file, media_type, scheduled_at) VALUES (?,?,?,?)')
      .run(`Post ${i}`, i % 2 ? `f${i}.jpg` : null, i % 2 ? 'image' : null, new Date(now + i * 3600e3).toISOString()).lastInsertRowid;
    db.prepare('INSERT INTO post_targets (post_id, account_id) VALUES (?,?)').run(id, a);
    if (i % 3) db.prepare('INSERT INTO post_targets (post_id, account_id) VALUES (?,?)').run(id, b);
  }
  const from = new Date(now - 1000).toISOString(), to = new Date(now + 40 * 3600e3).toISOString();
  const list = await (await fetch(`${base}/api/posts?from=${from}&to=${to}`)).json();
  assert.equal(list.length, 30);
  for (const p of list) assert.deepEqual(p, await (await fetch(`${base}/api/posts/${p.id}`)).json());
  assert.equal(list[1].thumb_url, '/thumb/f1.jpg');
  assert.equal(list[0].targets.length, 1);
  assert.equal(list[1].targets.length, 2);
});

test('the calendar lookups use indexes', () => {
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM post_targets WHERE post_id=?").all(1).map((r) => r.detail).join(' ');
  assert.match(plan, /idx_targets_post/);
});
