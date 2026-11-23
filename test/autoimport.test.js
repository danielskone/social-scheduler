// Bundles in imports/ go onto the calendar once by themselves, without past posts.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autoimport-'));
const db = require('../src/db');
const autoimport = require('../src/autoimport');

const ins = db.prepare('INSERT INTO accounts (platform, external_id, name, username, access_token) VALUES (?,?,?,?,?)');
ins.run('facebook', 'P1', 'NC Northpole', null, 't');
ins.run('instagram', 'I1', 'ncnorthpole', 'ncnorthpole', 't');
ins.run('tiktok', 'T1', 'Daniel King', null, 't');

const buzz = [];
const notify = { send: async (title, msg) => buzz.push({ title, msg }) };
const count = () => db.prepare('SELECT COUNT(*) n FROM posts').get().n;

test('imports a bundle once, skipping posts already in the past', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imports-'));
  const acct = [{ platform: 'facebook', name: 'NC Northpole' }];
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ posts: [
    { caption: 'past', when: '2026-11-01T10:00:00-05:00', accounts: acct },
    { caption: 'future 1', when: '2026-12-01T10:00:00-05:00', accounts: acct },
    { caption: 'future 2', when: '2026-12-02T10:00:00-05:00', accounts: acct },
  ] }));
  const now = Date.parse('2026-11-23T00:00:00Z');
  const r = await autoimport.run({ dir, notify, now });
  assert.deepStrictEqual(r, [{ name: 'a.json', added: 2 }]);
  assert.strictEqual(count(), 2);
  assert.match(buzz.pop().msg, /2 posts/);
  assert.deepStrictEqual(await autoimport.run({ dir, notify, now }), []);
  assert.strictEqual(count(), 2);
});

test('a bundle with a problem is not marked done and buzzes the phone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imports-'));
  fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ posts: [
    { caption: 'x', when: '2026-12-01T11:00:00-05:00', accounts: [{ platform: 'facebook', name: 'Missing Page' }] },
  ] }));
  const now = Date.parse('2026-11-23T00:00:00Z');
  const r = await autoimport.run({ dir, notify, now });
  assert.ok(r[0].error);
  assert.strictEqual(buzz.pop().title, 'Posts could not be added');
  assert.ok(!db.prepare("SELECT 1 FROM auto_imports WHERE name='b.json'").get());
});

test('the NC North Pole bundle in imports/ is valid for the Mac accounts', async () => {
  const before = count();
  const r = await autoimport.run({ dir: autoimport.folder(), notify, now: Date.parse('2026-11-23T05:00:00Z') });
  const nc = r.find((x) => x.name.includes('nc-north-pole'));
  assert.ok(nc && !nc.error, nc && nc.error);
  assert.strictEqual(nc.added, 192);
  assert.strictEqual(count() - before, 192);
  const tiktok = db.prepare(`SELECT COUNT(*) n FROM post_targets t JOIN accounts a ON a.id=t.account_id WHERE a.platform='tiktok'`).get().n;
  assert.strictEqual(tiktok, 32);
});
