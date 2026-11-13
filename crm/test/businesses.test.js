// Businesses (sub-accounts), Dashboard and Launchpad.
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
  req.on('end', () => { got.push(JSON.parse(body || '{}')); res.end('{}'); });
});

let server, base;
const j = async (p, opts = {}) => {
  if (opts.json) { opts.body = JSON.stringify(opts.json); opts.headers = { 'Content-Type': 'application/json' }; delete opts.json; }
  const r = await fetch(base + p, opts);
  return { status: r.status, body: await r.json() };
};
test.before(async () => {
  await new Promise((r) => fake.listen(0, r));
  process.env.NTFY_BASE = `http://127.0.0.1:${fake.address().port}`;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-'));
  process.env.APP_PASSWORD = '';
  const app = require('../../src/server');
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/crm`;
});
test.after(() => { fake.close(); server.close(); });

test('starts with businesses, and people land in the business that owns their group', async () => {
  const { body: list } = await j('/businesses');
  assert.ok(list.length >= 2);
  const parade = list.find((b) => b.groups.includes('Parade sponsor'));
  const va = list.find((b) => b.groups.includes('Viral Attraction lead'));
  await j('/contacts', { method: 'POST', json: { name: 'Sponsor Co', group_name: 'Parade sponsor', stage: 'Paid / Done', amount: 500 } });
  await j('/contacts', { method: 'POST', json: { name: 'Lead Person', group_name: 'Viral Attraction lead', stage: 'Committed', amount: 900 } });
  const p = (await j(`/contacts?biz=${parade.id}`)).body.map((c) => c.name);
  assert.deepStrictEqual(p, ['Sponsor Co']);
  const all = (await j('/contacts')).body.map((c) => c.name).sort();
  assert.deepStrictEqual(all, ['Lead Person', 'Sponsor Co']);
  const meta = (await j(`/meta?biz=${va.id}`)).body;
  assert.strictEqual(meta.summary.total, 1);
  assert.strictEqual(meta.summary.pledged, 900);
  assert.ok(!meta.groups.includes('Parade sponsor'), 'only this business\'s groups are offered');
});

test('a new group typed inside a business joins that business; removing a business keeps its people', async () => {
  const made = (await j('/businesses', { method: 'POST', json: { name: 'Car Wash', color: '#16a34a', website: 'carwash.example' } })).body;
  assert.strictEqual(made.website, 'https://carwash.example');
  await j(`/contacts?biz=${made.id}`, { method: 'POST', json: { name: 'Wash Fan', group_name: 'Wash member' } });
  assert.deepStrictEqual((await j(`/contacts?biz=${made.id}`)).body.map((c) => c.name), ['Wash Fan']);
  // A group can only belong to one business: giving it to Car Wash takes it away from the parade.
  const parade = (await j('/businesses')).body.find((b) => b.groups.includes('Donor'));
  await j(`/businesses/${made.id}`, { method: 'PUT', json: { groups: ['Wash member', 'Donor'] } });
  assert.ok(!(await j('/businesses')).body.find((b) => b.id === parade.id).groups.includes('Donor'));
  const del = await j(`/businesses/${made.id}`, { method: 'DELETE' });
  assert.strictEqual(del.status, 200);
  const names = (await j('/contacts')).body.map((c) => c.name);
  assert.ok(names.includes('Wash Fan'), 'nobody is deleted with a business');
  assert.strictEqual((await j('/businesses', { method: 'POST', json: { name: '' } })).status, 400);
});

test('dashboard adds up money, win rate and the funnel for the picked business', async () => {
  const d = (await j('/dashboard?days=30')).body;
  assert.strictEqual(d.totals.newPeople, 3);
  assert.strictEqual(d.totals.wonValue, 500);
  assert.strictEqual(d.totals.openValue, 900);
  assert.strictEqual(d.totals.winRate, 100);
  assert.strictEqual(d.funnel[0].count, 3);
  assert.strictEqual(d.overTime.length, 30);
  const parade = (await j('/businesses')).body.find((b) => b.groups.includes('Parade sponsor'));
  const p = (await j(`/dashboard?days=7&biz=${parade.id}`)).body;
  assert.strictEqual(p.totals.newPeople, 1);
  assert.strictEqual(p.totals.openValue, 0);
});

test('launchpad lists what is set up, and phone alerts can be turned on without Terminal', async () => {
  const before = (await j('/launchpad')).body.items;
  assert.strictEqual(before.find((x) => x.key === 'contact').done, true);
  assert.strictEqual(before.find((x) => x.key === 'phone').done, false);
  const r = (await j('/phone-alerts?test=1', { method: 'POST' })).body;
  assert.match(r.topic, /^sched-/);
  assert.strictEqual(r.sent, true);
  assert.strictEqual(got.at(-1).topic, r.topic);
  assert.strictEqual((await j('/launchpad')).body.items.find((x) => x.key === 'phone').done, true);
});
