// Form builder: questions, show-if logic, uploads, signatures, responses, contacts, website code.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pings = [];
const ntfy = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { pings.push(JSON.parse(b)); res.end('{}'); }); });

let forms, crm, db, server, root, api;
test.before(async () => {
  await new Promise((r) => ntfy.listen(0, r));
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forms-'));
  fs.writeFileSync(path.join(process.env.DATA_DIR, 'phone-topic.txt'), 'sched-test\n');
  process.env.NTFY_BASE = `http://127.0.0.1:${ntfy.address().port}`;
  process.env.APP_PASSWORD = '';
  delete process.env.WEBSITE_INBOX_URL;
  forms = require('../src/forms');
  crm = require('../src/crm');
  db = require('../src/db');
  const app = require('../src/server');
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  root = `http://127.0.0.1:${server.address().port}`;
  api = `${root}/api/crm/forms`;
});
test.after(() => { ntfy.close(); server.close(); });

const j = (url, method, body) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('every template makes a valid form, and show-if points at the right question', () => {
  for (const t of forms.TEMPLATES) {
    const f = forms.fromTemplate(t.key);
    assert.ok(f.title && f.fields.length, t.key);
    assert.doesNotThrow(() => forms.cleanFields(f.fields), t.key);
    for (const q of f.fields.filter((x) => x.show_if)) {
      const src = f.fields.find((x) => x.id === q.show_if.field);
      assert.ok(src && f.fields.indexOf(src) < f.fields.indexOf(q), `${t.key}: ${q.label}`);
      if (src.options) assert.ok(q.show_if.value.split('|').every((v) => src.options.includes(v)), `${t.key}: ${q.label} matches a choice`);
    }
  }
});

test('"describe your form" picks a sensible starting point and adds asked-for questions', () => {
  const r = forms.suggest('Create an RSVP form for our holiday party with a phone number and a photo upload');
  assert.strictEqual(r.template, 'rsvp');
  assert.match(r.title, /holiday party/i);
  assert.ok(r.fields.some((f) => f.type === 'phone'));
  assert.ok(r.fields.some((f) => f.type === 'file'));
  assert.strictEqual(forms.suggest('customer satisfaction survey').template, 'feedback');
  assert.strictEqual(forms.suggest('').template, 'blank');
});

test('builder form: answers saved, person becomes a contact, consent only when ticked, phone alert', async () => {
  const tpl = forms.fromTemplate('car');
  const { body: f, status } = await j(api, 'POST', { ...tpl, title: 'Find your next car', group_name: 'Auto customer' });
  assert.strictEqual(status, 200, JSON.stringify(f));
  assert.ok(f.url.endsWith(`/f/${f.slug}`));
  const id = (type, label) => f.fields.find((x) => x.type === type && (!label || x.label.startsWith(label))).id;
  const page = await (await fetch(`${root}/f/${f.slug}`)).text();
  assert.match(page, /Find your next car/);
  assert.match(page, /enctype="multipart\/form-data"/, 'has an upload, so the page can send files');
  assert.match(page, /data-show-field=/);

  const before = pings.length;
  const fd = new FormData();
  fd.append(id('name'), 'Tom Driver');
  fd.append(id('email'), 'Tom@Example.com');
  fd.append(id('radio', 'New or used'), 'Used');
  fd.append(id('radio', 'Do you have a trade-in'), 'Yes');
  fd.append(id('short', 'Trade-in'), '2015 Honda Civic, 90k miles');
  fd.append(id('dropdown'), '$15,000 to $25,000');
  fd.append(id('file'), new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: 'image/jpeg' }), 'civic.jpg');
  const r = await fetch(`${root}/f/${f.slug}`, { method: 'POST', body: fd });
  assert.strictEqual(r.status, 200);
  assert.match(await r.text(), /Thank you/);

  const tom = crm.listContacts({ q: 'tom@example.com' })[0];
  assert.ok(tom, 'became a contact');
  assert.strictEqual(tom.group_name, 'Auto customer');
  assert.strictEqual(tom.email_ok, 0);
  assert.match(crm.getContact(tom.id).activities.map((a) => a.note).join('|'), /Trade-in year, make, model and miles: 2015 Honda Civic/);

  const { body: list } = await j(`${api}/${f.id}/entries`, 'GET');
  assert.strictEqual(list.entries.length, 1);
  const e = list.entries[0];
  assert.strictEqual(e.contact_id, tom.id);
  assert.strictEqual(e.files.length, 1);
  assert.strictEqual(e.files[0].name, 'civic.jpg');
  const file = await fetch(`${api}/file/${e.files[0].file}`);
  assert.strictEqual(file.status, 200);
  assert.strictEqual(file.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(fs.readdirSync(path.join(process.env.DATA_DIR, 'form-files', '.incoming')).length, 0, 'no leftover uploads');

  await new Promise((res) => setTimeout(res, 50));
  assert.ok(pings.slice(before).some((p) => p.title === 'New lead' && /Find your next car/.test(p.message)));

  const csv = await (await fetch(`${api}/${f.id}/entries.csv`)).text();
  assert.match(csv, /Tom Driver/);
  assert.match(csv, /civic\.jpg/);
});

test('hidden show-if questions are ignored, required ones are enforced, bad choices are refused', async () => {
  const fields = [
    { id: 'nm', type: 'name', label: 'Name', required: true },
    { id: 'em', type: 'email', label: 'Email', required: true },
    { id: 'go', type: 'radio', label: 'Coming?', required: true, options: ['Yes', 'No'] },
    { id: 'ct', type: 'number', label: 'How many?', required: true, show_if: { field: 'go', value: 'Yes' } },
    { id: 'pk', type: 'checkboxes', label: 'Bring', options: ['Food', 'Drinks'] },
    { id: 'ok', type: 'consent', label: 'Email me party news. I can unsubscribe any time.' },
  ];
  const f = forms.saveForm({ title: 'Party', group_name: 'Other', fields });
  assert.strictEqual(f.email_checkbox, 'Email me party news. I can unsubscribe any time.', 'old switch kept in step');
  const post = (b) => fetch(`${root}/f/${f.slug}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b) });

  let r = await post({ nm: 'Ann', em: 'ann@x.com', go: 'Yes' });
  assert.strictEqual(r.status, 400);
  assert.match(await r.text(), /Please answer &quot;How many\?&quot;/);
  r = await post({ nm: 'Ann', em: 'ann@x.com', go: 'Maybe' });
  assert.strictEqual(r.status, 400);
  r = await post({ nm: 'Ann', em: 'ann@x.com', go: 'No', ct: '99', pk: 'Food', ok: '1' });
  assert.strictEqual(r.status, 200);
  const ann = crm.listContacts({ q: 'ann@x.com' })[0];
  assert.strictEqual(ann.email_ok, 1, 'ticked the box');
  assert.match(ann.email_ok_source, /party news/);
  const entry = db.prepare('SELECT * FROM crm_form_entries WHERE form_id=?').get(f.id);
  const answers = JSON.parse(entry.answers);
  assert.ok(!answers.some((a) => a.id === 'ct'), 'hidden question dropped');
  assert.deepStrictEqual(answers.find((a) => a.id === 'pk').value, 'Food');
});

test('anonymous survey: saved as a response without a contact; signature saved as a picture', async () => {
  const f = forms.saveForm({ title: 'Quick survey', fields: [
    { id: 'st', type: 'rating', label: 'Stars', required: true },
    { id: 'sg', type: 'signature', label: 'Sign', required: true },
  ] });
  const contactsBefore = crm.listContacts().length;
  const post = (b) => fetch(`${root}/f/${f.slug}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b) });
  assert.strictEqual((await post({ st: '4' })).status, 400, 'signature required');
  const png = 'data:image/png;base64,' + Buffer.alloc(200, 7).toString('base64');
  assert.strictEqual((await post({ st: '4', sg: png })).status, 200);
  assert.strictEqual(crm.listContacts().length, contactsBefore);
  const e = db.prepare('SELECT * FROM crm_form_entries WHERE form_id=?').get(f.id);
  assert.strictEqual(e.contact_id, null);
  assert.strictEqual(JSON.parse(e.files)[0].name, 'signature.png');
});

test('uploads of risky file types are refused', async () => {
  const f = forms.saveForm({ title: 'Upload test', fields: [{ id: 'nm', type: 'name', label: 'Name' }, { id: 'up', type: 'file', label: 'File' }] });
  const fd = new FormData();
  fd.append('nm', 'Eve');
  fd.append('up', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'evil.html');
  const r = await fetch(`${root}/f/${f.slug}`, { method: 'POST', body: fd });
  assert.strictEqual(r.status, 400);
  assert.match(await r.text(), /not a file type/);
});

test('website code: made only when the inbox is connected; its answers come back into the right form', async () => {
  const f = forms.saveForm({ ...forms.fromTemplate('video-quote'), title: 'Video quote' });
  let { body } = await j(`${api}/${f.id}/embed`, 'GET');
  assert.strictEqual(body.ready, false);
  process.env.WEBSITE_INBOX_URL = 'https://script.google.com/macros/s/abc/exec';
  process.env.WEBSITE_INBOX_KEY = 'k';
  ({ body } = await j(`${api}/${f.id}/embed`, 'GET'));
  assert.strictEqual(body.ready, true);
  assert.match(body.code, /vpform:/);
  assert.match(body.code, /data-viral-post="off"/, 'the website listener skips it, so nothing is sent twice');
  delete process.env.WEBSITE_INBOX_URL; delete process.env.WEBSITE_INBOX_KEY;

  const website = require('../src/website');
  const r = website.importRow({ row: 2, received: '2026-11-08T10:00:00Z', form: `vpform:${f.slug}`, name: 'Bea Shop', email: 'bea@shop.com', company: 'Bea Bakery',
    message: 'What do you need?: Ads, Commercial\nMonthly budget: $500 to $1,500', newsletter: true });
  assert.ok(r.viaForm);
  const bea = crm.getContact(r.contact.id);
  assert.strictEqual(bea.group_name, 'Viral Attraction lead');
  assert.strictEqual(bea.email_ok, 1);
  assert.match(bea.email_ok_source, /website/);
  const e = db.prepare("SELECT * FROM crm_form_entries WHERE form_id=? AND source='website'").get(f.id);
  assert.match(e.answers, /Ads, Commercial/);
});

test('old forms (made before the builder) still work and can be opened in the builder', async () => {
  const old = db.prepare("SELECT * FROM crm_forms WHERE title LIKE 'Volunteer%'").get();
  assert.strictEqual(old.fields, null);
  const v = forms.formView(old);
  assert.deepStrictEqual(v.fields.map((x) => x.type), ['name', 'email', 'phone', 'long', 'consent']);
  const { body } = await j(api, 'GET');
  assert.ok(body.some((x) => x.id === old.id && x.fields.length === 5));
  const qr = await fetch(`${api}/${old.id}/qr.svg`);
  assert.strictEqual(qr.status, 200);
  assert.match(await qr.text(), /<svg/);
});

test('form pages are reachable through the tunnel, responses and files are not', async () => {
  const f = forms.saveForm({ title: 'Tunnel check', fields: [{ type: 'name', label: 'Name' }] });
  const tunnel = { headers: { 'cf-connecting-ip': '203.0.113.9' } };
  assert.strictEqual((await fetch(`${root}/f/${f.slug}`, tunnel)).status, 200);
  assert.strictEqual((await fetch(`${api}/${f.id}/entries`, tunnel)).status, 404);
});
