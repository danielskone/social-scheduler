// Email marketing: segments, campaigns through (fake) Brevo, stats, unsubscribe sync, welcome series.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const calls = [];
let blacklisted = [];
const brevo = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c));
  req.on('end', () => {
    const body = b ? JSON.parse(b) : null;
    calls.push({ method: req.method, url: req.url, body });
    res.setHeader('Content-Type', 'application/json');
    const u = req.url;
    if (u === '/v3/contacts/folders') return res.end('{"id":7}');
    if (u === '/v3/contacts/lists') return res.end('{"id":42}');
    if (u.startsWith('/v3/contacts/attributes')) { res.statusCode = 201; return res.end(''); }
    if (u === '/v3/contacts' && req.method === 'POST') { res.statusCode = 201; return res.end('{"id":1}'); }
    if (u.startsWith('/v3/contacts?')) return res.end(JSON.stringify({ contacts: blacklisted.map((e) => ({ email: e, emailBlacklisted: true })) }));
    if (u === '/v3/emailCampaigns') return res.end('{"id":99}');
    if (u === '/v3/emailCampaigns/99/sendNow') { res.statusCode = 204; return res.end(); }
    if (u.startsWith('/v3/emailCampaigns/99?')) return res.end(JSON.stringify({ status: 'sent', statistics: { globalStats: { sent: 3, delivered: 3, uniqueViews: 2, uniqueClicks: 1, unsubscriptions: 1 } } }));
    if (u === '/v3/smtp/email') { res.statusCode = 201; return res.end('{"messageId":"m"}'); }
    res.statusCode = 404; res.end('{"message":"not found"}');
  });
});
const ntfy = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end('{}')); });

let crm, camp, auto, db, app, server, base;
const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));
test.before(async () => {
  await new Promise((r) => brevo.listen(0, r));
  await new Promise((r) => ntfy.listen(0, r));
  Object.assign(process.env, {
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'camp-')), NTFY_BASE: `http://127.0.0.1:${ntfy.address().port}`,
    BREVO_API_BASE: `http://127.0.0.1:${brevo.address().port}`, BREVO_API_KEY: 'xkeysib-test', EMAIL_FROM: 'daniel@viralattraction.com',
    EMAIL_FROM_NAME: 'Daniel King', EMAIL_MAILING_ADDRESS: 'PO Box 1, Fuquay-Varina, NC 27526', APP_PASSWORD: '',
  });
  crm = require('../server/crm');
  auto = require('../server/automations');
  camp = require('../server/campaigns');
  db = require('../../src/db');
  app = require('../../src/server');
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/crm/email`;
});
test.after(() => { brevo.close(); ntfy.close(); server.close(); });

const yes = (name, email, group, extra = {}) => crm.createContact({ name, email, group_name: group, email_ok: true, email_ok_source: 'signed up on website', ...extra }, { source: 'import' });

test('segments only ever include people who said yes and are not Do not contact', () => {
  yes('Ann Lee', 'ann@x.com', 'Viral Attraction lead');
  yes('Bo Ray', 'bo@x.com', 'Parade sponsor', { company: 'Ray Co' });
  yes('Cy Old', 'cy@x.com', 'Volunteer');
  crm.createContact({ name: 'No Consent', email: 'nc@x.com', group_name: 'Viral Attraction lead' });
  crm.createContact({ name: 'Left Alone', email: 'la@x.com', group_name: 'Viral Attraction lead', do_not_contact: true });
  const segs = camp.listSegments();
  const count = (n) => segs.find((s) => s.name === n).count;
  assert.strictEqual(count('Everyone who said yes to email'), 3);
  assert.strictEqual(count('Viral Attraction subscribers'), 1);
  assert.strictEqual(count('Parade community'), 2);
  const s = camp.saveSegment({ name: 'Sponsors', groups: 'Parade sponsor', stages: ['New'] });
  assert.deepStrictEqual(camp.members(s).map((c) => c.email), ['bo@x.com']);
});

test('campaign goes to Brevo as a real campaign with one-click unsubscribe and address', async () => {
  const tpl = crm.saveTemplate({ name: 'November news', channel: 'email', subject: 'Big news, {first_name}!', heading: 'Hello {first_name}',
    body: 'We have **news**.\n\nSee https://viralattraction.com', button_text: 'Read more', button_url: 'https://viralattraction.com', preheader: 'Short' });
  const seg = camp.listSegments().find((s) => s.name === 'Everyone who said yes to email');
  const c = camp.saveCampaign({ name: 'November newsletter', template_id: tpl.id, segment_id: seg.id });
  assert.strictEqual(c.status, 'draft');
  const sent = await camp.sendCampaign(c.id);
  assert.strictEqual(sent.status, 'sent');
  assert.strictEqual(sent.recipients, 3);
  const added = calls.filter((x) => x.url === '/v3/contacts' && x.method === 'POST').map((x) => x.body.email).sort();
  assert.deepStrictEqual(added, ['ann@x.com', 'bo@x.com', 'cy@x.com']);
  assert.deepStrictEqual(calls.find((x) => x.body?.email === 'bo@x.com').body.attributes, { FIRSTNAME: 'Bo', LASTNAME: 'Ray', COMPANY: 'Ray Co' });
  const cc = calls.find((x) => x.url === '/v3/emailCampaigns').body;
  assert.match(cc.subject, /Big news, \{\{ contact.FIRSTNAME/);
  assert.match(cc.htmlContent, /\{\{ unsubscribe \}\}/);
  assert.match(cc.htmlContent, /PO Box 1, Fuquay-Varina, NC 27526/);
  assert.match(cc.htmlContent, /<strong>news<\/strong>/);
  assert.match(cc.htmlContent, /Read more/);
  assert.deepStrictEqual(cc.recipients, { listIds: [42] });
  assert.ok(calls.some((x) => x.url === '/v3/emailCampaigns/99/sendNow'));
  assert.throws(() => camp.saveCampaign({ name: 'x' }, c.id), /already sent/);
});

test('stats come back from Brevo; unsubscribes become Do not contact', async () => {
  blacklisted = ['cy@x.com'];
  await camp.hourly();
  const row = camp.getCampaign(1);
  assert.deepStrictEqual({ opened: row.stats.opened, clicked: row.stats.clicked, unsubscribed: row.stats.unsubscribed }, { opened: 2, clicked: 1, unsubscribed: 1 });
  const cy = crm.listContacts({ q: 'cy@x.com' })[0];
  assert.strictEqual(cy.do_not_contact, 1);
  assert.strictEqual(cy.email_ok, 0);
  assert.strictEqual(camp.listSegments().find((s) => s.name === 'Everyone who said yes to email').count, 2);
  const o = camp.overview();
  assert.strictEqual(o.subscribers, 2);
  assert.ok(Math.abs(o.openRate - 2 / 3) < 1e-9);
});

test('refuses to send: no design, nobody in segment, over the free daily limit, time in the past', async () => {
  const seg = camp.saveSegment({ name: 'Empty', groups: ['Nobody here'] });
  const tpl = db.prepare("SELECT id FROM crm_templates WHERE name='November news'").get().id;
  await assert.rejects(camp.sendCampaign(camp.saveCampaign({ name: 'x', segment_id: seg.id }).id), /email design/);
  await assert.rejects(camp.sendCampaign(camp.saveCampaign({ name: 'x', template_id: tpl, segment_id: seg.id }).id), /Nobody/);
  process.env.BREVO_DAILY_CAP = '1';
  const all = camp.listSegments().find((s) => s.name === 'Everyone who said yes to email');
  await assert.rejects(camp.sendCampaign(camp.saveCampaign({ name: 'x', template_id: tpl, segment_id: all.id }).id), /300|up to 1 emails/);
  delete process.env.BREVO_DAILY_CAP;
  await assert.rejects(camp.sendCampaign(camp.saveCampaign({ name: 'x', template_id: tpl, segment_id: all.id, send_at: new Date(Date.now() - 60e3).toISOString() }).id), /few minutes/);
});

test('scheduled campaign hands Brevo the time instead of sending now', async () => {
  calls.length = 0;
  const tpl = db.prepare("SELECT id FROM crm_templates WHERE name='November news'").get().id;
  const all = camp.listSegments().find((s) => s.name === 'Everyone who said yes to email');
  const when = new Date(Date.now() + 86400e3).toISOString();
  const c = await camp.sendCampaign(camp.saveCampaign({ name: 'Later', template_id: tpl, segment_id: all.id, send_at: when }).id);
  assert.strictEqual(c.status, 'scheduled');
  assert.strictEqual(calls.find((x) => x.url === '/v3/emailCampaigns').body.scheduledAt, when);
  assert.ok(!calls.some((x) => x.url.endsWith('/sendNow')));
});

test('new Viral Attraction newsletter subscriber gets the 3-email welcome series, not the "reply fast" email', async () => {
  calls.length = 0;
  const { contact } = crm.submitForm({ title: 'viralattraction.com: Stay in the loop', group_name: 'Viral Attraction lead' },
    { name: 'Nina Sub', email: 'nina@x.com' }, { optIn: { source: 'newsletter' }, newsletterOnly: true });
  await wait();
  const subjects = () => calls.filter((x) => x.url === '/v3/smtp/email').map((x) => x.body.subject);
  assert.deepStrictEqual(subjects(), ['Welcome to Viral Attraction, Nina!']);
  const html = calls.find((x) => x.url === '/v3/smtp/email').body.htmlContent;
  assert.match(html, /See our work/);
  assert.match(html, /PO Box 1/);
  assert.match(html, /Unsubscribe/);
  assert.deepStrictEqual(crm.getContact(contact.id).tasks, [], 'no "reply to" task for a newsletter sign-up');
  auto.runWaiting(new Date(Date.now() + 2 * 86400e3 + 60e3));
  await wait();
  assert.deepStrictEqual(subjects(), ['Welcome to Viral Attraction, Nina!', '3 quick video ideas for your business']);
  auto.runWaiting(new Date(Date.now() + 6 * 86400e3));
  await wait();
  assert.strictEqual(subjects().length, 3);
});

test('API: overview, preview, and campaign editing', async () => {
  const j = await (await fetch(base)).json();
  assert.ok(j.overview.subscribers >= 2);
  assert.ok(j.segments.length >= 4);
  assert.ok(j.campaigns.length >= 2);
  const tpl = db.prepare("SELECT id FROM crm_templates WHERE name='Viral Attraction welcome 1: hello'").get().id;
  const html = await (await fetch(`${base}/preview/${tpl}`)).text();
  assert.match(html, /Welcome to Viral Attraction!/);
  assert.match(html, /Hi Alex,/);
  const r = await fetch(`${base}/campaigns`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '' }) });
  assert.strictEqual(r.status, 400);
});

test('design rules: button needs a web address, picture must be https', () => {
  assert.throws(() => crm.saveTemplate({ name: 'x', channel: 'email', body: 'x', button_text: 'Go' }), /button/);
  assert.throws(() => crm.saveTemplate({ name: 'x', channel: 'email', body: 'x', image_url: 'http://x.com/a.jpg' }), /https/);
});
