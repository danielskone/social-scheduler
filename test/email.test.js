// Automatic emails from automations (through a fake Brevo): who gets one, and what it says.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sent = [];
let fail = false;
const brevo = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c));
  req.on('end', () => {
    if (fail) { res.statusCode = 400; return res.end('{"message":"Sender is not valid"}'); }
    sent.push({ key: req.headers['api-key'], url: req.url, body: JSON.parse(b) }); res.statusCode = 201; res.end('{"messageId":"x"}');
  });
});
const ntfy = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end('{}')); });

let crm, auto, email, db;
const wait = () => new Promise((r) => setTimeout(r, 150));
test.before(async () => {
  await new Promise((r) => brevo.listen(0, r));
  await new Promise((r) => ntfy.listen(0, r));
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'email-'));
  process.env.NTFY_BASE = `http://127.0.0.1:${ntfy.address().port}`;
  process.env.BREVO_API_BASE = `http://127.0.0.1:${brevo.address().port}`;
  crm = require('../src/crm');
  auto = require('../src/automations');
  email = require('../src/email');
  db = require('../src/db');
});
test.after(() => { brevo.close(); ntfy.close(); });

const site = { title: 'viralattraction.com: Contact', group_name: 'Viral Attraction lead' };

test('not set up: email steps are skipped and everything else still runs', async () => {
  const { contact } = crm.submitForm(site, { name: 'Early Bird', email: 'early@x.com' });
  await wait();
  assert.strictEqual(sent.length, 0);
  assert.ok(crm.getContact(contact.id).tasks.length === 1);
  assert.match(db.prepare('SELECT summary FROM crm_automation_log ORDER BY id DESC LIMIT 1').get().summary, /email skipped \(not set up yet\)/);
});

test('needs a mailing address before anything is sent', () => {
  process.env.BREVO_API_KEY = 'xkeysib-test'; process.env.EMAIL_FROM = 'daniel@viralattraction.com';
  assert.strictEqual(email.ready(), false);
  process.env.EMAIL_MAILING_ADDRESS = 'PO Box 1, Fuquay-Varina, NC 27526';
  process.env.EMAIL_FROM_NAME = 'Daniel King';
  assert.strictEqual(email.ready(), true);
});

test('a new website lead gets the welcome email with address and unsubscribe, once', async () => {
  const { contact } = crm.submitForm(site, { name: 'Ava Stone', email: 'ava@shop.com', message: 'Hi' });
  await wait();
  assert.strictEqual(sent.length, 1);
  const m = sent[0];
  assert.strictEqual(m.key, 'xkeysib-test');
  assert.strictEqual(m.url, '/v3/smtp/email');
  assert.deepStrictEqual(m.body.to, [{ email: 'ava@shop.com', name: 'Ava Stone' }]);
  assert.strictEqual(m.body.sender.email, 'daniel@viralattraction.com');
  assert.strictEqual(m.body.subject, 'Thanks for reaching out to Viral Attraction!');
  assert.match(m.body.textContent, /^Hi Ava,/);
  assert.match(m.body.textContent, /PO Box 1, Fuquay-Varina, NC 27526/);
  assert.match(m.body.textContent, /reply with "unsubscribe"/);
  assert.match(m.body.textContent, /because you contacted us \("viralattraction.com: Contact"\)/);
  assert.strictEqual(m.body.headers['List-Unsubscribe'], '<mailto:daniel@viralattraction.com?subject=unsubscribe>');
  assert.match(crm.getContact(contact.id).activities.map((a) => a.note).join('|'), /Sent "Website lead welcome" automatically/);

  // Same automation never emails the same person twice.
  const a = auto.list().find((x) => x.name === 'New website lead: reply fast');
  auto.handle('contact_added', { contact: crm.getContact(contact.id), source: 'form' });
  await wait();
  assert.strictEqual(sent.length, 1);
  assert.ok(a);
});

test('no email for people added by hand (unless OK to email) or marked Do not contact', async () => {
  sent.length = 0;
  crm.createContact({ name: 'Hand Added', email: 'hand@x.com', group_name: 'Parade sponsor' });
  crm.submitForm({ title: 'Sponsor form', group_name: 'Parade sponsor' }, { name: 'Pat', email: 'pat@x.com' });
  const dnc = crm.createContact({ name: 'Leave Me', email: 'leave@x.com', do_not_contact: true });
  crm.submitForm({ title: 'Sponsor form', group_name: 'Parade sponsor' }, { name: 'Leave Me', email: 'leave@x.com' });
  crm.createContact({ name: 'Said Yes', email: 'yes@x.com', group_name: 'Parade sponsor', email_ok: true, email_ok_source: 'asked at the parade' });
  await wait();
  const to = sent.map((s) => s.body.to[0].email).sort();
  assert.deepStrictEqual(to, ['pat@x.com', 'yes@x.com']);
  assert.match(sent.find((s) => s.body.to[0].email === 'pat@x.com').body.textContent, /fuquayvarinachristmasparade\.org\/parade\/sponsorship/);
  assert.match(sent.find((s) => s.body.to[0].email === 'yes@x.com').body.textContent, /because you signed up to get email from us/);
  assert.ok(dnc);
});

test('a failed send is recorded and can be retried by a later run', async () => {
  fail = true; sent.length = 0;
  const { contact } = crm.submitForm(site, { name: 'Fay Fail', email: 'fay@x.com' });
  await wait();
  const row = db.prepare('SELECT * FROM crm_emails_sent WHERE to_email=?').get('fay@x.com');
  assert.strictEqual(row.status, 'failed');
  assert.match(row.error, /Sender is not valid/);
  fail = false;
  auto.handle('contact_added', { contact: crm.getContact(contact.id), source: 'form' });
  await wait();
  assert.strictEqual(sent.length, 1);
});

test('daily limit', () => {
  process.env.EMAIL_DAILY_LIMIT = '1';
  const c = crm.createContact({ name: 'Limit', email: 'limit@x.com', email_ok: true, email_ok_source: 'test' });
  assert.throws(() => email.claim({ contact: c, automationId: 999, templateId: 1, subject: 'x' }), /daily email limit/);
  delete process.env.EMAIL_DAILY_LIMIT;
});

test('email step must use an email template', () => {
  const text = db.prepare("SELECT id FROM crm_templates WHERE channel='text' LIMIT 1").get().id;
  assert.throws(() => auto.save({ name: 'x', trigger: { type: 'contact_added' }, steps: [{ type: 'email', template_id: text }] }), /email templates/);
});
