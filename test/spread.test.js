// Posts on one account are kept at least an hour apart.
process.env.TZ = 'America/New_York';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'spread-'));
const db = require('../src/db');
const spread = require('../src/spread');

const ins = db.prepare('INSERT INTO accounts (platform, external_id, name, username, access_token) VALUES (?,?,?,?,?)');
const fb = ins.run('facebook', 'P1', 'Parade', null, 't').lastInsertRowid;
const ig = ins.run('instagram', 'I1', 'parade', 'parade', 't').lastInsertRowid;
const tt = ins.run('tiktok', 'T1', 'Daniel King', null, 't').lastInsertRowid;
const nc = ins.run('facebook', 'P2', 'NC Northpole', null, 't').lastInsertRowid;

function add(when, accounts, status = 'scheduled') {
  const id = db.prepare('INSERT INTO posts (caption, scheduled_at) VALUES (?,?)').run(`p ${when}`, new Date(when).toISOString()).lastInsertRowid;
  accounts.forEach((a) => db.prepare('INSERT INTO post_targets (post_id, account_id, status) VALUES (?,?,?)').run(id, a, status));
  return id;
}
const at = (id) => new Date(db.prepare('SELECT scheduled_at s FROM posts WHERE id=?').get(id).s);
const hm = (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
const now = Date.parse('2026-11-23T12:00:00Z'); // 7 AM ET

test('stacked clip posts are spread an hour apart; the first one keeps its time', async () => {
  const day = '2026-11-25';
  const a = add(`${day}T14:00:00-05:00`, [fb, ig, tt]);
  const b = add(`${day}T14:00:00-05:00`, [fb, ig, tt]);
  const c = add(`${day}T14:00:00-05:00`, [fb, ig, tt]);
  const d = add(`${day}T15:00:00-05:00`, [fb, ig, tt]);
  const e = add(`${day}T15:00:00-05:00`, [fb, ig, tt]);
  const other = add(`${day}T14:00:00-05:00`, [nc]); // another Page: no clash
  const late = add(`${day}T21:00:00-05:00`, [fb]);
  const late2 = add(`${day}T21:00:00-05:00`, [fb]);
  const moves = spread.run({ now });
  assert.strictEqual(hm(at(a)), '14:00');
  assert.strictEqual(hm(at(other)), '14:00');
  const times = [a, b, c, d, e].map((id) => at(id).getTime()).sort();
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= spread.GAP);
  assert.strictEqual(hm(at(late)), '21:00');
  assert.strictEqual(at(late2).getDate(), 26, 'a full evening moves to the next morning');
  assert.strictEqual(hm(at(late2)), '8:00');
  assert.ok(moves.length >= 4);
  assert.deepStrictEqual(spread.run({ now }), [], 'nothing left to move');
});

test('posts that went out or are due now never move', () => {
  const sent = add('2026-11-23T07:05:00-05:00', [fb], 'published');
  const soon = add('2026-11-23T07:10:00-05:00', [fb]);
  spread.run({ now });
  assert.strictEqual(hm(at(sent)), '7:05');
  assert.strictEqual(hm(at(soon)), '7:10');
});

test('runOnce moves once and buzzes the phone', async () => {
  add('2026-11-28T10:00:00-05:00', [tt]);
  add('2026-11-28T10:00:00-05:00', [tt]);
  const buzz = [];
  const notify = { send: async (t, m) => buzz.push(m) };
  const first = await spread.runOnce('t1', { notify, now });
  assert.strictEqual(first.length, 1);
  assert.match(buzz[0], /1 post was moved/);
  assert.strictEqual(await spread.runOnce('t1', { notify, now }), null);
});
