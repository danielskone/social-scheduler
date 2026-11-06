// Website sign-ups (Google Sheet inbox) -> Contacts.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let rows = [];
let lastAsked = null;
const inbox = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  lastAsked = u;
  res.setHeader('Content-Type', 'application/json');
  if (u.searchParams.get('key') !== 'k123') return res.end('{"ok":false,"error":"wrong key"}');
  const after = Number(u.searchParams.get('after'));
  res.end(JSON.stringify({ ok: true, rows: rows.filter((r) => r.row > after), last: rows.length + 1 }));
});
const pings = [];
const ntfy = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { pings.push(JSON.parse(b)); res.end('{}'); }); });

let website, crm, db;
test.before(async () => {
  await new Promise((r) => inbox.listen(0, r));
  await new Promise((r) => ntfy.listen(0, r));
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'web-'));
  fs.writeFileSync(path.join(process.env.DATA_DIR, 'phone-topic.txt'), 'sched-test\n');
  process.env.NTFY_BASE = `http://127.0.0.1:${ntfy.address().port}`;
  process.env.WEBSITE_INBOX_URL = `http://127.0.0.1:${inbox.address().port}/exec`;
  process.env.WEBSITE_INBOX_KEY = 'k123';
  website = require('../src/website');
  crm = require('../src/crm');
  db = require('../src/db');
});
test.after(() => { inbox.close(); ntfy.close(); });

test('does nothing until set up', async () => {
  const url = process.env.WEBSITE_INBOX_URL;
  delete process.env.WEBSITE_INBOX_URL;
  assert.deepStrictEqual(await website.check(), { skipped: true });
  assert.strictEqual(website.status().connected, false);
  process.env.WEBSITE_INBOX_URL = url;
});

test('contact form sign-up becomes a lead, NOT on the email list', async () => {
  rows = [{ row: 2, received: '2026-11-06T05:00:00Z', form: 'viralattraction.com: Contact', name: 'Ava Stone', email: 'Ava@Shop.com', phone: '',
    company: 'Stone Bakery', interest: 'Business interview', preferred_time: 'Mornings', message: 'We want more customers', newsletter: false, page: 'https://viralattraction.com/contact' }];
  const r = await website.check();
  assert.deepStrictEqual(r, { added: 1, updated: 0 });
  const c = crm.listContacts({ q: 'ava@shop.com' })[0];
  assert.strictEqual(c.group_name, 'Viral Attraction lead');
  assert.strictEqual(c.company, 'Stone Bakery');
  assert.strictEqual(c.email_ok, 0);
  const note = crm.getContact(c.id).activities[0].note;
  assert.match(note, /Filled out "viralattraction.com: Contact"/);
  assert.match(note, /Interested in: Business interview/);
  assert.match(note, /Best time to connect: Mornings/);
  await new Promise((res) => setTimeout(res, 100));
  assert.strictEqual(pings.at(-1).title, 'New website lead');
});

test('only new rows are read, and a newsletter sign-up adds email permission with how they agreed', async () => {
  rows.push({ row: 3, received: '2026-11-06T06:00:00Z', form: 'viralattraction.com: Stay in the loop.', name: 'Ava', email: 'ava@shop.com', newsletter: true });
  const r = await website.check();
  assert.strictEqual(lastAsked.searchParams.get('after'), '2');
  assert.deepStrictEqual(r, { added: 0, updated: 1 });
  const c = crm.listContacts({ q: 'ava@shop.com' })[0];
  assert.strictEqual(c.email_ok, 1);
  assert.match(c.email_ok_source, /Signed up for email updates on viralattraction.com/);
  assert.deepStrictEqual(await website.check(), { added: 0, updated: 0 });
});

test('a bad row is skipped without blocking the rest; wrong key is reported', async () => {
  rows.push({ row: 4, form: 'x: y', name: 'No Contact Info' }, { row: 5, form: 'x: y', name: 'Ben', phone: '919-555-0100' });
  assert.deepStrictEqual(await website.check(), { added: 1, updated: 0 });
  process.env.WEBSITE_INBOX_KEY = 'nope';
  const r = await website.check();
  assert.match(r.error, /secret key is wrong/);
  assert.match(website.status().lastError, /secret key/);
  process.env.WEBSITE_INBOX_KEY = 'k123';
  await website.check();
  assert.strictEqual(website.status().lastError, null);
});

test('a brand-new Sheet starts over from the top', async () => {
  rows = [{ row: 2, form: 'viralattraction.com: Contact', name: 'Cal', email: 'cal@x.com' }];
  assert.deepStrictEqual(await website.check(), { added: 1, updated: 0 });
});

test('website code has the inbox address filled in', () => {
  const s = website.snippet();
  assert.match(s, /^<script>/);
  assert.ok(s.includes(process.env.WEBSITE_INBOX_URL));
  assert.ok(!s.includes('__INBOX_URL__'));
});
