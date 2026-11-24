// "Delete all" on the Calendar: removes every post not sent yet, keeps sent ones.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

Object.assign(process.env, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'delall-')), APP_PASSWORD: '' });
const app = require('../src/server');
const db = require('../src/db');
const config = require('../src/config');

let server, base;
test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('deletes waiting and failed posts and their files, keeps posts that went out', async () => {
  const fb = db.prepare("INSERT INTO accounts (platform, external_id, name, access_token) VALUES ('facebook','P','Page','t')").run().lastInsertRowid;
  const ig = db.prepare("INSERT INTO accounts (platform, external_id, name, access_token) VALUES ('instagram','I','IG','t')").run().lastInsertRowid;
  const add = (file, statuses) => {
    if (file) fs.writeFileSync(path.join(config.mediaDir, file), 'x');
    const id = db.prepare("INSERT INTO posts (caption, scheduled_at, media_file) VALUES ('c', '2026-12-01T15:00:00Z', ?)").run(file).lastInsertRowid;
    statuses.forEach((s, i) => db.prepare('INSERT INTO post_targets (post_id, account_id, status) VALUES (?,?,?)').run(id, [fb, ig][i], s));
    return id;
  };
  add('a.mp4', ['scheduled', 'scheduled']);
  add('b.jpg', ['failed']);
  const sent = add('c.mp4', ['published']);
  const partly = add('d.mp4', ['published', 'failed']);
  let r = await (await fetch(`${base}/api/posts/unsent/count`)).json();
  assert.strictEqual(r.count, 2);
  r = await (await fetch(`${base}/api/posts/unsent`, { method: 'DELETE' })).json();
  assert.strictEqual(r.deleted, 2);
  const left = db.prepare('SELECT id FROM posts ORDER BY id').all().map((x) => x.id);
  assert.deepStrictEqual(left, [sent, partly]);
  assert.ok(!fs.existsSync(path.join(config.mediaDir, 'a.mp4')));
  assert.ok(!fs.existsSync(path.join(config.mediaDir, 'b.jpg')));
  assert.ok(fs.existsSync(path.join(config.mediaDir, 'c.mp4')));
  r = await (await fetch(`${base}/api/posts/unsent/count`)).json();
  assert.strictEqual(r.count, 0);
  const page = await (await fetch(`${base}/`)).text();
  assert.match(page, /id="delete-all"/);
});
