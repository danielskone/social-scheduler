// CRM automations: triggers, steps, waits, safety limits.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pings = [];
const ntfy = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { pings.push(JSON.parse(b)); res.end('{}'); }); });

let crm, auto, booking, db, app, server, base;
test.before(async () => {
  await new Promise((r) => ntfy.listen(0, r));
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-'));
  fs.writeFileSync(path.join(process.env.DATA_DIR, 'phone-topic.txt'), 'sched-test\n');
  process.env.NTFY_BASE = `http://127.0.0.1:${ntfy.address().port}`;
  process.env.APP_PASSWORD = '';
  crm = require('../src/crm');
  auto = require('../src/automations');
  booking = require('../src/booking');
  db = require('../src/db');
  app = require('../src/server');
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/crm/automations`;
});
test.after(() => { ntfy.close(); server.close(); });

const tasksFor = (id) => crm.getContact(id).tasks.map((t) => t.title);
const later = (days) => new Date(Date.now() + days * 86400e3 + 60e3);

test('ready-made automations are added once and are on', () => {
  const names = auto.list().map((a) => a.name);
  assert.ok(names.includes('New website lead: reply fast'));
  assert.ok(names.includes('Sponsor paid: say thank you'));
  assert.ok(auto.list().every((a) => a.active));
});

test('new website lead gets a task and follow-up; reminder only if still New after 3 days', () => {
  const { contact } = crm.submitForm({ title: 'viralattraction.com: Contact', group_name: 'Viral Attraction lead' }, { name: 'Ava Stone', email: 'ava@shop.com' });
  assert.deepStrictEqual(tasksFor(contact.id), ['Reply to Ava Stone (new Viral Attraction lead)']);
  assert.ok(crm.getContact(contact.id).next_follow_up);
  // The form note is still the newest history entry.
  assert.match(crm.getContact(contact.id).activities[0].note, /Filled out/);
  assert.match(crm.getContact(contact.id).activities.map((a) => a.note).join('|'), /"New website lead: reply fast": task/);

  const { contact: b } = crm.submitForm({ title: 'viralattraction.com: Contact', group_name: 'Viral Attraction lead' }, { name: 'Ben Ray', email: 'ben@shop.com' });
  crm.updateContact(b.id, { stage: 'Contacted' });

  pings.length = 0;
  auto.runWaiting(new Date());
  assert.strictEqual(tasksFor(contact.id).length, 1, 'nothing happens before the wait is over');
  auto.runWaiting(later(3));
  assert.ok(tasksFor(contact.id).includes('Follow up with Ava Stone: no reply yet'));
  assert.ok(!tasksFor(b.id).some((t) => /no reply yet/.test(t)), 'stopped because Ben was contacted');
});

test('sponsor lead gets a ready-to-open sponsor email task; paid sponsor gets thank-you tasks', async () => {
  const c = crm.createContact({ name: 'Joe Smith', company: 'Smith Hardware', email: 'joe@smith.com', group_name: 'Parade sponsor' });
  const t = crm.getContact(c.id).tasks[0];
  assert.strictEqual(t.title, 'Send sponsor levels to Smith Hardware');
  assert.strictEqual(t.template_name, 'Sponsor ask');
  pings.length = 0;
  crm.updateContact(c.id, { stage: 'Paid / Done' });
  assert.ok(tasksFor(c.id).includes('Send thank-you to Smith Hardware'));
  assert.ok(tasksFor(c.id).includes('Make a thank-you post for Smith Hardware'));
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(pings.some((p) => p.title === 'Sponsor paid'));
});

test('no message tasks for people marked Do not contact', () => {
  const c = crm.createContact({ name: 'No Thanks', email: 'no@x.com', group_name: 'Parade sponsor', do_not_contact: true });
  assert.deepStrictEqual(tasksFor(c.id), []);
});

test('imports never start automations', () => {
  crm.importCsv('Name,Email,Group\nImp One,imp1@x.com,Parade sponsor\n');
  const c = crm.listContacts({ q: 'imp1@x.com' })[0];
  assert.deepStrictEqual(tasksFor(c.id), []);
});

test('appointment booked moves a New contact to Interested and adds a prep task', () => {
  const pg = db.prepare('SELECT * FROM crm_booking_pages LIMIT 1').get();
  const slot = booking.slotsFor(pg)[0];
  const r = booking.book(pg, { name: 'Cara Lane', phone: '919-555-0101', t: slot });
  assert.strictEqual(r.contact.stage, 'Interested');
  assert.ok(tasksFor(r.contact.id).some((t) => /^Get ready for appointment with Cara Lane \(/.test(t)));
});

test('custom automation: group filter, stage, note, and turning it off cancels waits', () => {
  const a = auto.save({ name: 'Volunteer welcome', trigger: { type: 'form_filled', group: 'Volunteer', form: 'volunteer' }, steps: [
    { type: 'note', note: 'Welcome {first_name}! Form: {form}' },
    { type: 'stage', stage: 'Contacted' },
    { type: 'wait', amount: 2, unit: 'hours' },
    { type: 'group', group: 'Other' },
  ] });
  const form = db.prepare("SELECT * FROM crm_forms WHERE title LIKE 'Volunteer%'").get();
  const { contact } = crm.submitForm(form, { name: 'Dee Volunteer', email: 'dee@x.com' });
  const full = crm.getContact(contact.id);
  assert.strictEqual(full.stage, 'Contacted');
  assert.match(full.activities.map((x) => x.note).join('|'), /Welcome Dee! Form: Volunteer at the Christmas Parade/);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM crm_automation_waits WHERE automation_id=?').get(a.id).n, 1);
  auto.save({ active: false }, a.id);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM crm_automation_waits WHERE automation_id=?').get(a.id).n, 0);
  auto.runWaiting(later(1));
  assert.strictEqual(crm.getContact(contact.id).group_name, 'Volunteer');
});

test('automations that set off each other stop after a few levels', () => {
  const a = auto.save({ name: 'Loop A', trigger: { type: 'stage_changed', stage: 'Interested', group: 'Loopers' }, steps: [{ type: 'stage', stage: 'Contacted' }] });
  const b = auto.save({ name: 'Loop B', trigger: { type: 'stage_changed', stage: 'Contacted', group: 'Loopers' }, steps: [{ type: 'stage', stage: 'Interested' }] });
  const c = crm.createContact({ name: 'Loop Person', group_name: 'Loopers' });
  crm.updateContact(c.id, { stage: 'Interested' }); // must return, not loop forever
  assert.ok(crm.STAGES.includes(crm.getContact(c.id).stage));
  auto.remove(a.id); auto.remove(b.id);
});

test('settings are checked; API lists automations and recent runs', async () => {
  assert.throws(() => auto.save({ name: '', trigger: { type: 'contact_added' }, steps: [{ type: 'note', note: 'x' }] }), /name/);
  assert.throws(() => auto.save({ name: 'x', trigger: { type: 'nope' }, steps: [{ type: 'note', note: 'x' }] }), /starts/);
  assert.throws(() => auto.save({ name: 'x', trigger: { type: 'stage_changed' }, steps: [{ type: 'note', note: 'x' }] }), /stage/);
  assert.throws(() => auto.save({ name: 'x', trigger: { type: 'contact_added' }, steps: [] }), /at least one/);
  assert.throws(() => auto.save({ name: 'x', trigger: { type: 'contact_added' }, steps: [{ type: 'note', note: 'x' }, { type: 'wait', amount: 1 }] }), /after it/);
  assert.throws(() => auto.save({ name: 'x', trigger: { type: 'contact_added' }, steps: [{ type: 'fax' }] }), /type/);
  const res = await fetch(base);
  const body = await res.json();
  assert.ok(body.automations.length >= 5);
  assert.ok(body.log.length > 0);
  assert.ok(body.triggers.contact_added);
  const bad = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.strictEqual(bad.status, 400);
});

test('placeholders fill in, unknown ones are left alone', () => {
  assert.strictEqual(auto.fill('Hi {first_name} at {company} {zzz}', { name: 'Ann Lee', company: 'Lee Co' }), 'Hi Ann at Lee Co {zzz}');
});
