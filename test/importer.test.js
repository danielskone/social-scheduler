// Post bundles: "clear" swaps out a day's posts in one import.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'import-'));
const db = require('../src/db');
const config = require('../src/config');
const { importBundle } = require('../src/importer');

const ins = db.prepare('INSERT INTO accounts (platform, external_id, name, username, access_token) VALUES (?,?,?,?,?)');
const fb = ins.run('facebook', 'P1', 'Parade Page', null, 't').lastInsertRowid;
const ig = ins.run('instagram', 'I1', 'Parade IG', 'parade', 't').lastInsertRowid;
const other = ins.run('facebook', 'P2', 'Other Page', null, 't').lastInsertRowid;

function addPost(when, accounts, status = 'scheduled', file = null) {
  const id = db.prepare('INSERT INTO posts (caption, scheduled_at, media_file, media_type) VALUES (?,?,?,?)')
    .run(`old ${when}`, new Date(when).toISOString(), file, file ? 'image' : null).lastInsertRowid;
  accounts.forEach((a) => db.prepare('INSERT INTO post_targets (post_id, account_id, status) VALUES (?,?,?)').run(id, a, status));
  return id;
}
const exists = (id) => !!db.prepare('SELECT 1 FROM posts WHERE id=?').get(id);

test('clear removes only that day\'s unsent posts for the bundle\'s accounts', () => {
  fs.writeFileSync(path.join(config.mediaDir, 'old.jpg'), 'x');
  const sunday = addPost('2026-11-08T10:00:00-05:00', [fb, ig], 'scheduled', 'old.jpg');
  const sundayIgOnly = addPost('2026-11-08T20:00:00-05:00', [ig]);
  const otherPage = addPost('2026-11-08T12:00:00-05:00', [other]);
  const mixed = addPost('2026-11-08T13:00:00-05:00', [fb, other]);
  const alreadyPosted = addPost('2026-11-08T09:00:00-05:00', [fb], 'published');
  const monday = addPost('2026-11-09T10:00:00-05:00', [fb, ig]);
  const lateSat = addPost('2026-11-07T23:30:00-05:00', [fb]);

  const r = importBundle({
    clear: { from: '2026-11-08T00:00:00-05:00', to: '2026-11-09T00:00:00-05:00' },
    posts: [
      { caption: 'New 1', when: '2026-11-08T10:00:00-05:00', accounts: [{ platform: 'facebook', name: 'Parade Page' }, { platform: 'instagram', username: 'parade' }], media: { url: 'https://example.com/a.mp4' } },
      { caption: 'New 2', when: '2026-11-08T20:00:00-05:00', accounts: [{ platform: 'facebook', name: 'Parade Page' }] },
    ],
  }, { now: Date.parse('2026-11-07T20:00:00-05:00') });

  assert.strictEqual(r.error, undefined);
  assert.deepStrictEqual([r.removed, r.imported], [2, 2]);
  assert.ok(!exists(sunday) && !exists(sundayIgOnly));
  assert.ok(exists(otherPage) && exists(mixed) && exists(alreadyPosted) && exists(monday) && exists(lateSat));
  assert.ok(!fs.existsSync(path.join(config.mediaDir, 'old.jpg')));
  const sun = db.prepare("SELECT caption FROM posts WHERE caption LIKE 'New%' ORDER BY scheduled_at").all().map((p) => p.caption);
  assert.deepStrictEqual(sun, ['New 1', 'New 2']);
});

test('nothing is removed when the bundle has a problem', () => {
  const keep = addPost('2026-11-10T10:00:00-05:00', [fb]);
  const r = importBundle({
    clear: { from: '2026-11-10T00:00:00-05:00', to: '2026-11-11T00:00:00-05:00' },
    posts: [{ caption: 'x', when: '2026-11-10T10:00:00-05:00', accounts: [{ platform: 'facebook', name: 'Nope' }] }],
  }, { now: Date.parse('2026-11-07T20:00:00-05:00') });
  assert.ok(r.error);
  assert.ok(exists(keep));
});
