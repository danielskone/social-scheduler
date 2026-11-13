// Tags, smart lists and bulk actions on People.
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
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lists-'));
  process.env.APP_PASSWORD = '';
  const app = require('../../src/server');
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/crm`;
});
test.after(() => server.close());

const add = async (b) => (await j('/contacts', { method: 'POST', json: b })).body;

test('tags: cleaned, filterable, imported, exported', async () => {
  const a = await add({ name: 'Ann Lee', email: 'ann@x.com', tags: ' VIP , vip, 2026 sponsor,,' });
  assert.deepStrictEqual(a.tag_list, ['VIP', '2026 sponsor']);
  await add({ name: 'Bo Ray', phone: '919-555-0101', tags: ['Volunteer'] });
  await add({ name: 'Cy Day', email: 'cy@x.com', email_ok: true, email_ok_source: 'website', tags: 'vip' });
  assert.deepStrictEqual((await j('/contacts?tag=vip')).body.map((c) => c.name).sort(), ['Ann Lee', 'Cy Day']);
  assert.deepStrictEqual((await j('/contacts?tag=VIP%20x')).body, []);
  assert.deepStrictEqual((await j('/contacts?show=email_ok')).body.map((c) => c.name), ['Cy Day']);
  assert.deepStrictEqual((await j('/contacts?show=no_email')).body.map((c) => c.name), ['Bo Ray']);
  const tags = (await j('/lists')).body.tags;
  assert.deepStrictEqual(tags[0], { name: 'VIP', count: 2 });
  const imp = await fetch(`${base}/import`, { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: 'Name,Tags\nDee Fox,"Donor, VIP"\n' }).then((r) => r.json());
  assert.strictEqual(imp.imported, 1);
  assert.strictEqual((await j('/contacts?tag=donor')).body[0].name, 'Dee Fox');
});

test('smart lists save a search and count who matches now', async () => {
  assert.strictEqual((await j('/lists', { method: 'POST', json: { name: 'Empty', filters: {} } })).status, 400);
  const l = (await j('/lists', { method: 'POST', json: { name: 'VIPs', filters: { tag: 'VIP', show: 'bogus', due: false } } })).body;
  assert.deepStrictEqual(l.filters, { tag: 'VIP' });
  assert.strictEqual((await j('/lists')).body.lists.find((x) => x.id === l.id).count, 3);
  await add({ name: 'Eve New', tags: 'VIP' });
  assert.strictEqual((await j('/lists')).body.lists.find((x) => x.id === l.id).count, 4);
  await j(`/lists/${l.id}`, { method: 'PUT', json: { name: 'Top people' } });
  assert.strictEqual((await j('/lists')).body.lists.find((x) => x.id === l.id).name, 'Top people');
  await j(`/lists/${l.id}`, { method: 'DELETE' });
  assert.strictEqual((await j('/lists')).body.lists.length, 0);
});

test('bulk actions: tag, group, stage, follow-up, note, task, do not contact, export, delete', async () => {
  const all = (await j('/contacts')).body, ids = all.map((c) => c.id);
  const ann = all.find((c) => c.name === 'Ann Lee');
  let r = await j('/lists/bulk/tag_add', { method: 'POST', json: { ids, value: 'Gala 2026' } });
  assert.strictEqual(r.body.done, ids.length);
  assert.strictEqual((await j('/contacts?tag=gala%202026')).body.length, ids.length);
  r = await j('/lists/bulk/tag_remove', { method: 'POST', json: { ids: [ann.id], value: 'gala 2026' } });
  assert.deepStrictEqual((await j(`/contacts/${ann.id}`)).body.tag_list, ['VIP', '2026 sponsor']);
  await j('/lists/bulk/group', { method: 'POST', json: { ids, value: 'Volunteer' } });
  assert.ok((await j('/contacts')).body.every((c) => c.group_name === 'Volunteer'));
  assert.strictEqual((await j('/lists/bulk/stage', { method: 'POST', json: { ids, value: 'Nope' } })).status, 400);
  await j('/lists/bulk/stage', { method: 'POST', json: { ids, value: 'Contacted' } });
  assert.ok((await j('/contacts')).body.every((c) => c.stage === 'Contacted'));
  await j('/lists/bulk/follow_up', { method: 'POST', json: { ids: [ann.id], value: '2030-01-02' } });
  assert.strictEqual((await j(`/contacts/${ann.id}`)).body.next_follow_up, '2030-01-02');
  await j('/lists/bulk/note', { method: 'POST', json: { ids: [ann.id], value: 'Sent a gala invite' } });
  assert.ok((await j(`/contacts/${ann.id}`)).body.activities.some((a) => a.note === 'Sent a gala invite'));
  await j('/lists/bulk/task', { method: 'POST', json: { ids: [ann.id], value: 'Call Ann', due: '2030-01-03' } });
  assert.ok((await j(`/contacts/${ann.id}`)).body.tasks.some((t) => t.title === 'Call Ann' && t.due_on === '2030-01-03'));
  // "Everyone who matches" can be sent as filters.
  r = await j('/lists/bulk/dnc', { method: 'POST', json: { filters: { show: 'email_ok' } } });
  assert.strictEqual(r.body.done, 1);
  const cy = (await j('/contacts?show=dnc')).body[0];
  assert.strictEqual(cy.name, 'Cy Day');
  assert.strictEqual(cy.email_ok, 0);
  const csv = (await j('/lists/bulk/export', { method: 'POST', json: { ids: [ann.id] } })).body.csv;
  assert.match(csv, /Ann Lee/);
  assert.match(csv, /VIP, 2026 sponsor/);
  assert.doesNotMatch(csv, /Bo Ray/);
  assert.strictEqual((await j('/lists/bulk/delete', { method: 'POST', json: { ids: [ann.id] } })).status, 400);
  r = await j('/lists/bulk/delete', { method: 'POST', json: { ids: [ann.id, 99999], confirm: 'DELETE' } });
  assert.strictEqual((await j(`/contacts/${ann.id}`)).status, 404);
  assert.strictEqual((await j('/lists/bulk/nope', { method: 'POST', json: { ids } })).status, 400);
  assert.strictEqual((await j('/lists/bulk/tag_add', { method: 'POST', json: { ids: [] , value: 'x'} })).status, 400);
});

test('email segments can use a tag', async () => {
  const seg = (await j('/email/segments', { method: 'POST', json: { name: 'Tagged', tag: 'donor' } })).body;
  assert.strictEqual(seg.tag, 'donor');
});
