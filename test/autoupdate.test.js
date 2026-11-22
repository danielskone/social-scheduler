// Automatic updates on the Mac: only when something new is out, never while posts are going out.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autoupdate-'));
const db = require('../src/db');
const au = require('../src/autoupdate');

const A = 'a'.repeat(40), B = 'b'.repeat(40);
const sent = [];
const notify = { send: async (t) => { sent.push(t); return true; } };

test('updates when GitHub has a new version, and not again after', async () => {
  let runs = 0;
  const update = async () => { runs++; return true; };
  assert.equal(await au.check({ db, notify, update, getLatest: async () => A }), 'updated');
  assert.equal(fs.readFileSync(au.versionFile(), 'utf8').trim(), A);
  assert.equal(sent.length, 0, 'no buzz for the very first install of the updater');
  assert.equal(await au.check({ db, notify, update, getLatest: async () => A }), 'current');
  assert.equal(runs, 1);
  assert.equal(await au.check({ db, notify, update, getLatest: async () => B }), 'updated');
  assert.deepEqual(sent, ['Viral Post updated']);
});

test('waits while a post is due soon, and backs off after a failed update', async () => {
  const id = db.prepare(`INSERT INTO posts (caption, scheduled_at) VALUES ('x', ?)`).run(new Date(Date.now() + 5 * 60e3).toISOString()).lastInsertRowid;
  const acct = db.prepare(`INSERT INTO accounts (platform, external_id, name, access_token) VALUES ('facebook','P','Page','t')`).run().lastInsertRowid;
  db.prepare(`INSERT INTO post_targets (post_id, account_id) VALUES (?,?)`).run(id, acct);
  assert.equal(await au.check({ db, notify, update: async () => true, getLatest: async () => 'c'.repeat(40) }), 'posts-due');
  db.prepare(`UPDATE posts SET scheduled_at=? WHERE id=?`).run(new Date(Date.now() + 3600e3).toISOString(), id);
  assert.equal(await au.check({ db, notify, update: async () => false, getLatest: async () => 'c'.repeat(40) }), 'failed');
  assert.equal(await au.check({ db, notify, update: async () => true, getLatest: async () => 'c'.repeat(40) }), 'waiting-after-failure');
  assert.equal(fs.readFileSync(au.versionFile(), 'utf8').trim(), B, 'still on the old version');
  assert.equal(await au.check({ db, notify, getLatest: async () => { throw new Error('offline'); } }), 'error');
});

test('each app restarts once a new version is installed, but not while busy', async () => {
  let exits = 0, busy = true;
  const t = au.watchVersion({ every: 20, busy: () => busy, exit: () => { exits++; } });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(exits, 0, 'same version: keeps running');
  fs.writeFileSync(au.versionFile(), 'd'.repeat(40));
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(exits, 0, 'busy: waits');
  busy = false;
  await new Promise((r) => setTimeout(r, 2200));
  assert.equal(exits, 1);
  clearInterval(t);
});

test('only on the Mac apps started in the background, and can be turned off', () => {
  const mac = process.platform === 'darwin';
  assert.equal(au.enabled({ APP: 'scheduler' }), mac);
  assert.equal(au.enabled({}), false, 'customer copies and tests');
  assert.equal(au.enabled({ APP: 'scheduler', NO_JOBS: '1' }), false);
  assert.equal(au.enabled({ APP: 'scheduler', AUTO_UPDATE: 'off' }), false);
});
