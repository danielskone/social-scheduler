// Pipelines: your own steps, more than one pipeline, renaming and removing steps safely.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let server, base;
const j = async (p, opts = {}) => {
  if (opts.json) { opts.body = JSON.stringify(opts.json); opts.headers = { 'Content-Type': 'application/json' }; delete opts.json; }
  const r = await fetch(base + p, opts);
  return { status: r.status, body: await r.json() };
};
test.before(async () => {
  process.env.NTFY_BASE = 'http://127.0.0.1:9';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pipes-'));
  process.env.APP_PASSWORD = '';
  const app = require('../../src/server');
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/crm`;
});
test.after(() => server.close());

test('starts with one pipeline; unknown steps fall back to its first step', async () => {
  const list = (await j('/pipelines')).body;
  assert.strictEqual(list.length, 1);
  assert.deepStrictEqual(list[0].stages.map((s) => s.name), ['New', 'Contacted', 'Interested', 'Committed', 'Paid / Done', 'Not this year']);
  const c = (await j('/contacts', { method: 'POST', json: { name: 'Ann', stage: 'Banana' } })).body;
  assert.strictEqual(c.stage, 'New');
});

test('a business can have its own pipeline with its own steps, and money follows won steps', async () => {
  const biz = (await j('/businesses')).body.find((b) => b.groups.includes('Auto customer'));
  const made = await j(`/pipelines?biz=${biz.id}`, { method: 'POST', json: { name: 'Car sales', stages: [
    { name: 'Walk-in', kind: 'open' }, { name: 'Test drive', kind: 'open' }, { name: 'Sold', kind: 'won' }, { name: 'Walked away', kind: 'lost' }] } });
  assert.strictEqual(made.status, 200);
  assert.strictEqual(made.body.business_id, biz.id);
  // Other businesses don't see it.
  const other = (await j('/businesses')).body.find((b) => b.groups.includes('Parade sponsor'));
  assert.ok(!(await j(`/pipelines?biz=${other.id}`)).body.some((p) => p.id === made.body.id));
  const car = (await j('/contacts', { method: 'POST', json: { name: 'Buyer', group_name: 'Auto customer', pipeline_id: made.body.id, stage: 'Sold', amount: 12000 } })).body;
  assert.strictEqual(car.stage, 'Sold');
  const meta = (await j(`/meta?biz=${biz.id}`)).body;
  assert.strictEqual(meta.summary.paid, 12000);
  assert.ok(meta.pipelines.some((p) => p.name === 'Car sales'));
  const board = (await j(`/contacts?pipeline=${made.body.id}`)).body;
  assert.deepStrictEqual(board.map((c) => [c.name, c.stage_kind]), [['Buyer', 'won']]);
  const dash = (await j(`/dashboard?biz=${biz.id}&pipeline=${made.body.id}`)).body;
  assert.deepStrictEqual(dash.byStage.map((s) => s.stage), ['Walk-in', 'Test drive', 'Sold', 'Walked away']);
  assert.strictEqual(dash.totals.wonValue, 12000);
});

test('renaming a step keeps people in it; removing a step moves them to the first step', async () => {
  const pl = (await j('/pipelines')).body.find((p) => p.name === 'Car sales');
  await j('/contacts', { method: 'POST', json: { name: 'Driver', group_name: 'Auto customer', pipeline_id: pl.id, stage: 'Test drive' } });
  const r = await j(`/pipelines/${pl.id}`, { method: 'PUT', json: { name: 'Car sales', stages: [
    { name: 'Walk-in', kind: 'open', from: 'Walk-in' }, { name: 'Bought', kind: 'won', from: 'Sold' }, { name: 'Walked away', kind: 'lost', from: 'Walked away' }] } });
  assert.strictEqual(r.status, 200);
  const people = Object.fromEntries((await j(`/contacts?pipeline=${pl.id}`)).body.map((c) => [c.name, c.stage]));
  assert.deepStrictEqual(people, { Buyer: 'Bought', Driver: 'Walk-in' });
  assert.strictEqual((await j(`/pipelines/${pl.id}`, { method: 'PUT', json: { stages: [{ name: 'Only', kind: 'won' }] } })).status, 400);
  // Deleting the pipeline keeps the people, in another pipeline.
  assert.strictEqual((await j(`/pipelines/${pl.id}`, { method: 'DELETE' })).status, 200);
  const names = (await j('/contacts')).body.filter((c) => ['Buyer', 'Driver'].includes(c.name));
  assert.strictEqual(names.length, 2);
  assert.ok(names.every((c) => c.stage === 'New'));
});
