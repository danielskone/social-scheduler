// Workflow builder: drafts vs published, ready-made library, "describe it", text step, safe test run, history.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let crm, auto, kit, server, base;
test.before(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-'));
  process.env.APP_PASSWORD = '';
  process.env.NTFY_BASE = 'http://127.0.0.1:9';
  crm = require('../server/crm');
  auto = require('../server/automations');
  kit = require('../server/workflow-kit');
  const app = require('../../src/server');
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/crm/automations`;
});
test.after(() => server.close());

const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

test('a draft can hold an unfinished step, but publishing is blocked with the step number', async () => {
  const draft = { name: 'Half done', active: false, trigger: { type: 'contact_added' }, steps: [{ type: 'alert', message: 'Hi {name}' }, { type: 'email' }] };
  const r = await call('POST', '/', draft);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.active, false);
  assert.strictEqual(r.body.problems.length, 1);
  const pub = await call('PUT', `/${r.body.id}`, { ...draft, active: true });
  assert.strictEqual(pub.status, 400);
  assert.match(pub.body.error, /Step 2/);
});

test('drafts never run', () => {
  const before = auto.list().find((a) => a.name === 'Half done').runs;
  crm.createContact({ name: 'Quiet Person', email: 'q@x.com' });
  assert.strictEqual(auto.list().find((a) => a.name === 'Half done').runs, before);
});

test('ready-made library lists workflows by category and adds them as drafts', async () => {
  const lib = await call('GET', '/library');
  assert.ok(lib.body.length >= 10);
  assert.ok(new Set(lib.body.map((w) => w.category)).size >= 4);
  const made = await call('POST', `/library/${lib.body[0].key}`);
  assert.strictEqual(made.status, 200);
  assert.strictEqual(made.body.active, false);
  assert.ok(made.body.steps.length > 0);
});

test('"describe it" turns a sentence into a draft workflow', async () => {
  const r = await call('POST', '/suggest', { text: 'When someone fills out the volunteer form, text them, wait 3 days, then remind me to call them' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.trigger.type, 'form_filled');
  assert.deepStrictEqual(r.body.steps.map((s) => s.type), ['text', 'wait', 'task']);
  assert.strictEqual(r.body.active, false);
  assert.match(r.body.steps[2].title, /\{name\}/);
});

test('a "send a text" step never sends: it makes a ready-to-send task, and skips Do not contact', () => {
  const tpl = crm.listTemplates ? crm.listTemplates().find((t) => t.channel === 'text') : null;
  const tplId = tpl ? tpl.id : require('../../src/db').prepare("INSERT INTO crm_templates (name, channel, body) VALUES ('T','text','Hi {name}')").run().lastInsertRowid;
  auto.save({ name: 'Text new people', active: true, trigger: { type: 'contact_added' }, steps: [{ type: 'text', template_id: tplId }] });
  const a = crm.createContact({ name: 'Tina Text', phone: '555-0100' });
  assert.ok(crm.getContact(a.id).tasks.some((t) => t.title === 'Text Tina Text' && t.template_id === tplId));
  const b = crm.createContact({ name: 'No Texts', phone: '555-0101', do_not_contact: 1 });
  assert.ok(!crm.getContact(b.id).tasks.some((t) => /^Text /.test(t.title)));
});

test('test run explains what would happen without doing anything', async () => {
  const c = crm.createContact({ name: 'Dry Run', email: 'dry@x.com' });
  const tasks = crm.getContact(c.id).tasks.length;
  const r = await call('POST', '/test', { contact_id: c.id, automation: { trigger: { type: 'contact_added' }, steps: [{ type: 'task', title: 'Call {name}' }, { type: 'wait', amount: 2, unit: 'days' }] } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.would_start, true);
  assert.match(r.body.steps.join('|'), /Call Dry Run/);
  assert.strictEqual(crm.getContact(c.id).tasks.length, tasks);
});

test('history shows who went through a workflow', async () => {
  const a = auto.list().find((x) => x.name === 'Text new people');
  const r = await call('GET', `/${a.id}/history`);
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.log.some((l) => l.contact_name === 'Tina Text'));
  assert.ok(Array.isArray(r.body.waiting));
});

test('every library workflow is valid once published', () => {
  for (const w of kit.library()) {
    const made = kit.fromLibrary(w.key);
    assert.doesNotThrow(() => auto.save({ ...made, name: `${made.name} (check)`, active: true }), w.key);
  }
});
