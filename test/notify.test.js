// Phone notifications: off until a topic exists, then one message per post.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const got = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => { const j = JSON.parse(body); got.push({ path: `/${j.topic}`, title: j.title, priority: j.priority, body: j.message }); res.end('{}'); });
});

let notify;
test.before(async () => {
  await new Promise((r) => fake.listen(0, r));
  process.env.NTFY_BASE = `http://127.0.0.1:${fake.address().port}`;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-'));
  notify = require('../src/notify');
});
test.after(() => fake.close());

test('sends nothing until set up', async () => {
  await notify.postResults([{ postId: 1, caption: 'Hi', platform: 'facebook', account: 'Page', ok: true }]);
  assert.strictEqual(got.length, 0);
});

test('groups results per post and flags failures', async () => {
  const t = notify.createTopic();
  assert.strictEqual(notify.createTopic(), t, 'topic is kept');
  await notify.postResults([
    { postId: 1, caption: 'Parade day!', platform: 'facebook', account: 'FV Parade', ok: true },
    { postId: 1, caption: 'Parade day!', platform: 'instagram', account: 'FV Parade', ok: true },
    { postId: 2, caption: 'Second', platform: 'instagram', account: 'fvparade', ok: false, error: 'Bad video' },
  ]);
  assert.strictEqual(got.length, 2);
  assert.strictEqual(got[0].path, `/${t}`);
  assert.strictEqual(got[0].title, 'Posted');
  assert.match(got[0].body, /Facebook \(FV Parade\), Instagram \(FV Parade\)/);
  assert.strictEqual(got[1].title, 'Post FAILED');
  assert.strictEqual(got[1].priority, 4);
  assert.match(got[1].body, /Bad video/);
});
