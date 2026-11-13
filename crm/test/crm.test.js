// Contacts (CRM): consent rules, CSV import/export, follow-up reminders.
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
  req.on('end', () => { got.push(JSON.parse(body)); res.end('{}'); });
});

let crm, notify, app, server, base;
test.before(async () => {
  await new Promise((r) => fake.listen(0, r));
  process.env.NTFY_BASE = `http://127.0.0.1:${fake.address().port}`;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-'));
  process.env.APP_PASSWORD = '';
  crm = require('../server/crm');
  notify = require('../../src/notify');
  app = require('../../src/server');
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/crm`;
});
test.after(() => { fake.close(); server.close(); });

test('needs a name, and never marks email OK without an address and a reason', () => {
  assert.throws(() => crm.createContact({}), /name or a company/);
  assert.throws(() => crm.createContact({ name: 'A', email_ok: true }), /email address/);
  assert.throws(() => crm.createContact({ name: 'A', email: 'a@x.com', email_ok: true }), /how they agreed/);
  const c = crm.createContact({ name: 'Ann Lee', email: 'ann@x.com', email_ok: true, email_ok_source: 'signed up on website', amount: '$1,500' });
  assert.strictEqual(c.email_ok, 1);
  assert.ok(c.email_ok_at);
  assert.strictEqual(c.amount, 1500);
  assert.match(crm.getContact(c.id).activities.length === 0 ? 'ok' : '', /ok/);
});

test('do not contact removes them from the email list and logs it', () => {
  const c = crm.createContact({ name: 'Bob Ray', email: 'bob@x.com', email_ok: true, email_ok_source: 'asked in person' });
  assert.match(crm.exportCsv({ emailList: true }), /bob@x\.com/);
  const u = crm.updateContact(c.id, { do_not_contact: true });
  assert.strictEqual(u.email_ok, 0);
  assert.strictEqual(u.email_ok_at, null);
  assert.doesNotMatch(crm.exportCsv({ emailList: true }), /bob@x\.com/);
  assert.match(u.activities[0].note, /Removed from email list/);
});

test('CSV import maps common headers, skips duplicates, never assumes consent', () => {
  const csv = 'Full Name,Business,Email Address,Phone,Type,OK to email,Notes\r\n'
    + '"Smith, Jo",Jo\'s Diner,jo@diner.com,555-1111,Parade sponsor,yes,"Gold level, ""maybe"""\r\n'
    + 'Dup,,ann@x.com,,,,\r\n';
  const r = crm.importCsv(csv);
  assert.deepStrictEqual([r.imported, r.skipped], [1, 1]);
  const jo = crm.listContacts({ q: 'diner' })[0];
  assert.strictEqual(jo.name, 'Smith, Jo');
  assert.strictEqual(jo.group_name, 'Parade sponsor');
  assert.strictEqual(jo.notes, 'Gold level, "maybe"');
  assert.strictEqual(jo.email_ok, 0, 'no consent source in the file, so not opted in');
});

test('export guards against spreadsheet formulas and round-trips', () => {
  crm.createContact({ name: '=HYPERLINK("x")', company: 'Evil' });
  const out = crm.exportCsv();
  assert.match(out, /"'=HYPERLINK\(""x""\)"/);
  const rows = crm.parseCsv(out);
  assert.strictEqual(rows[0][0], 'Name');
});

test('follow-up reminder goes to the phone once a day', async () => {
  const day = new Date();
  const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  notify.createTopic();
  const past = new Date(day); past.setDate(day.getDate() - 3);
  const late = crm.createContact({ name: 'Late One', next_follow_up: ymd(past) });
  crm.saveTask({ title: 'Send invoice', due_on: ymd(past), contact_id: late.id });
  crm.saveTask({ title: 'Later thing', due_on: '2999-01-01' });
  const done = crm.saveTask({ title: 'Already done', due_on: ymd(past) });
  crm.saveTask({ done: true }, done.id);
  crm.createContact({ name: 'Left Alone', next_follow_up: ymd(past), do_not_contact: true });
  assert.strictEqual(await crm.sendFollowUpReminder(day), true);
  assert.strictEqual(got.length, 1);
  assert.match(got[0].title, /2 things today/);
  assert.match(got[0].message, /Send invoice \(Late One\)/);
  assert.match(got[0].message, /Late One \(overdue\)/);
  assert.doesNotMatch(got[0].message, /Left Alone/);
  assert.strictEqual(await crm.sendFollowUpReminder(day), false, 'only once per day');
  assert.strictEqual(got.length, 1);
});

test('HTTP routes: create, log activity, filter, export', async () => {
  const j = (p, o = {}) => fetch(base + p, { ...o, headers: { 'Content-Type': 'application/json' }, body: o.body && JSON.stringify(o.body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const bad = await j('/contacts', { method: 'POST', body: {} });
  assert.strictEqual(bad.status, 400);
  const c = (await j('/contacts', { method: 'POST', body: { name: 'Route Test', group_name: 'Volunteer', stage: 'Committed', amount: 250 } })).body;
  const withNote = (await j(`/contacts/${c.id}/activities`, { method: 'POST', body: { kind: 'Call', note: 'Said yes' } })).body;
  assert.strictEqual(withNote.activities[0].note, 'Said yes');
  const vols = (await j('/contacts?group=Volunteer')).body;
  assert.deepStrictEqual(vols.map((x) => x.name), ['Route Test']);
  const m = (await j('/meta')).body;
  assert.ok(m.groups.includes('Auto customer'));
  assert.ok(m.summary.pledged >= 250);
  const imp = await fetch(base + '/import', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: 'Name\nFrom Http\n' }).then((r) => r.json());
  assert.strictEqual(imp.imported, 1);
  const csv = await fetch(base + '/export.csv?list=email');
  assert.match(csv.headers.get('content-disposition'), /email-list-opted-in/);
  assert.match(await csv.text(), /ann@x\.com/);
});

test('tasks: done is logged on the contact', () => {
  const c = crm.createContact({ name: 'Task Person' });
  const t = crm.saveTask({ title: 'Call back', due_on: '2026-12-01', contact_id: c.id });
  assert.throws(() => crm.saveTask({ title: ' ' }), /what the task is/);
  crm.saveTask({ done: true }, t.id);
  const full = crm.getContact(c.id);
  assert.ok(full.tasks[0].done_at);
  assert.match(full.activities[0].note, /Done: Call back/);
  assert.strictEqual(crm.listTasks({ open: true }).some((x) => x.id === t.id), false);
});

test('templates fill in names, open one message, and refuse do-not-contact', () => {
  const c = crm.createContact({ name: 'Mia Stone', company: 'Stone Cafe', email: 'mia@cafe.com', phone: '(919) 555-0199' });
  const email = crm.saveTemplate({ name: 'Ask', channel: 'email', subject: 'Hi {first_name}', body: 'Would {company} sponsor?' });
  const text = crm.saveTemplate({ name: 'Ping', channel: 'text', body: 'Hey {first_name}' });
  const m = crm.prepareMessage(c.id, email.id);
  assert.strictEqual(m.subject, 'Hi Mia');
  assert.match(m.link, /^mailto:mia%40cafe\.com\?subject=Hi%20Mia&body=Would%20Stone%20Cafe%20sponsor%3F$/);
  assert.match(crm.prepareMessage(c.id, text.id).link, /^sms:9195550199&body=Hey%20Mia$/);
  assert.match(crm.getContact(c.id).activities[0].note, /Opened "Ping"/);
  crm.updateContact(c.id, { do_not_contact: true });
  assert.throws(() => crm.prepareMessage(c.id, email.id), /Do not contact/);
});

test('public sign-up form: no password, opt-in only when ticked, bots ignored, no duplicates', async () => {
  const form = crm.saveForm({ title: 'Sponsor us', group_name: 'Parade sponsor', email_checkbox: 'Email me updates' });
  const url = base.replace('/api/crm', '') + '/f/' + form.slug;
  const page = await fetch(url);
  assert.strictEqual(page.status, 200);
  assert.match(await page.text(), /Sponsor us/);
  const post = (fields) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
  const before = got.length;
  let r = await post({ name: 'Zed Bot', email: 'bot@spam.com', website: 'http://spam' });
  assert.match(await r.text(), /Thank you/);
  assert.strictEqual(crm.listContacts({ q: 'bot@spam.com' }).length, 0);
  r = await post({ name: 'Nora Fields', email: 'Nora@Shop.com', company: 'Nora Shop', message: 'Gold level please' });
  assert.match(await r.text(), /Thank you/);
  let nora = crm.listContacts({ q: 'nora@shop.com' });
  assert.strictEqual(nora.length, 1);
  assert.strictEqual(nora[0].group_name, 'Parade sponsor');
  assert.strictEqual(nora[0].email_ok, 0, 'did not tick the box');
  await post({ name: 'Nora Fields', email: 'nora@shop.com', email_ok: '1' });
  nora = crm.listContacts({ q: 'nora@shop.com' });
  assert.strictEqual(nora.length, 1, 'same email is not added twice');
  assert.strictEqual(nora[0].email_ok, 1);
  assert.match(nora[0].email_ok_source, /Email me updates/);
  assert.match(crm.getContact(nora[0].id).activities.map((a) => a.note).join('|'), /Gold level please/);
  r = await post({ name: '', email: 'x@y.com' });
  assert.strictEqual(r.status, 400);
  await new Promise((res) => setTimeout(res, 50));
  assert.ok(got.slice(before).some((g) => g.title === 'New lead'));
  crm.saveForm({ active: false }, form.id);
  assert.strictEqual((await fetch(url)).status, 404);
});

test('through the public tunnel only sign-up forms are reachable, not the CRM data', async () => {
  const form = crm.saveForm({ title: 'Tunnel form' });
  const root = base.replace('/api/crm', '');
  const tunnel = { headers: { 'cf-connecting-ip': '203.0.113.5' } };
  assert.strictEqual((await fetch(`${root}/f/${form.slug}`, tunnel)).status, 200);
  assert.strictEqual((await fetch(`${base}/contacts`, tunnel)).status, 404);
});

test('starter parade forms exist once, with the email box unticked by default', () => {
  const forms = require('../../src/db').prepare("SELECT * FROM crm_forms WHERE title LIKE '%parade%' OR title LIKE '%Parade%'").all();
  assert.deepStrictEqual(forms.map((f) => f.group_name).sort(), ['Parade entry', 'Parade sponsor', 'Volunteer']);
  assert.ok(forms.every((f) => f.active && /unsubscribe/.test(f.email_checkbox)));
});
