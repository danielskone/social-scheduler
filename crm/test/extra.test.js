// Booking upgrades (reminders, change/cancel links, time off), quotes with a signature,
// simple website pages and monthly reports.
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mails = [];
const smtp = net.createServer((sock) => {
  let data = false, buf = '', cur = { rcpt: [], body: '' };
  const say = (l) => sock.write(l + '\r\n');
  say('220 fake ESMTP');
  sock.on('data', (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (data) { if (line === '.') { data = false; mails.push(cur); cur = { rcpt: [], body: '' }; say('250 OK'); } else cur.body += line + '\n'; continue; }
      const cmd = line.toUpperCase();
      if (cmd.startsWith('EHLO')) sock.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (cmd.startsWith('RCPT TO')) { cur.rcpt.push(line.match(/<(.+)>/)[1].toLowerCase()); say('250 OK'); }
      else if (cmd === 'DATA') { data = true; say('354 go'); }
      else if (cmd === 'QUIT') { say('221 bye'); sock.end(); }
      else say(cmd.startsWith('AUTH') ? '235 OK' : '250 OK');
    }
  });
});
const pings = [];
const ntfy = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { pings.push({ title: req.headers.title || req.headers['x-title'], body: b }); res.end('{}'); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const flatMail = (m) => m.body.replace(/=\r?\n/g, '').replace(/=3D/g, '=');

let root, server;
const OWNER = { Authorization: `Basic ${Buffer.from(':owner-pass-123').toString('base64')}` };
const j = async (p, opts = {}) => {
  const pub = /^\/(book|quote|s|invoice)\//.test(p);
  if (!pub) opts.headers = { ...OWNER, ...(opts.headers || {}) };
  if (opts.json) { opts.body = JSON.stringify(opts.json); opts.headers = { ...(opts.headers || {}), 'Content-Type': 'application/json' }; delete opts.json; }
  if (opts.form) { opts.body = new URLSearchParams(opts.form).toString(); opts.headers = { ...(opts.headers || {}), 'Content-Type': 'application/x-www-form-urlencoded' }; delete opts.form; opts.method = 'POST'; }
  const r = await fetch(root + (pub ? p : `/api/crm${p}`), { redirect: 'manual', ...opts });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body, headers: r.headers };
};
test.before(async () => {
  for (const s of [smtp, ntfy]) await new Promise((r) => s.listen(0, '127.0.0.1', r));
  Object.assign(process.env, {
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'extra-')), NTFY_BASE: `http://127.0.0.1:${ntfy.address().port}`, APP_PASSWORD: 'owner-pass-123',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port), SMTP_PASS: 'x',
    EMAIL_FROM: 'daniel@viralattraction.com', EMAIL_FROM_NAME: 'Daniel King', EMAIL_MAILING_ADDRESS: 'PO Box 1, Fuquay-Varina, NC 27526', PUBLIC_BASE_URL: 'https://example.test',
  });
  server = require('../../src/server').listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  root = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { for (const s of [smtp, ntfy, server]) s.close(); });

const person = async (name, email, group = 'Auto customer') => (await j('/contacts', { method: 'POST', json: { name, email, phone: '919-555-0100', group_name: group } })).body;

test('booking: break between, daily limit, time off, confirmation, change and cancel links, reminder', async () => {
  const booking = require('../../crm/server/booking');
  const pg = (await j('/booking/pages', { method: 'POST', json: { title: 'Test drive', minutes: 30, days: '0,1,2,3,4,5,6', start_time: '09:00', end_time: '12:00', days_ahead: 14, notice_hours: 0,
    buffer_minutes: 15, max_per_day: 2, remind_hours: 24, group_name: 'Auto customer' } })).body;
  assert.strictEqual(pg.buffer_minutes, 15);
  // With a 15 minute break, slots are 9:00, 9:45, 10:30, 11:15.
  const now = new Date('2026-12-01T05:00:00Z'); // midnight Eastern, Dec 1
  const slots = booking.slotsFor(pg, now).filter((t) => t.startsWith('2026-12-02'));
  assert.deepStrictEqual(slots.map((t) => t.slice(11, 16)), ['14:00', '14:45', '15:30', '16:15']);

  // Book through the public page.
  const t = booking.slotsFor(pg).find((x) => Date.parse(x) > Date.now() + 2 * 864e5);
  const r = await j(`/book/${pg.slug}`, { form: { t, name: 'Rita Ross', email: 'rita@example.com', phone: '919-555-0111' } });
  assert.strictEqual(r.status, 200);
  assert.match(r.body, /Change or cancel/);
  const token = r.body.match(/a\/([\w-]+)\/invite\.ics/)[1];
  await wait(300);
  const conf = mails.find((m) => m.rcpt.includes('rita@example.com'));
  assert.ok(conf, 'confirmation email sent');
  assert.match(flatMail(conf), /book\/a\//);
  // Calendar file.
  const ics = await j(`/book/a/${token}/invite.ics`);
  assert.match(ics.body, /BEGIN:VEVENT/);
  assert.match(ics.body, /SUMMARY:Test drive/);
  // The day limit: book a second time that day, then the day is full.
  const sameDay = booking.slotsFor(pg).filter((x) => x.slice(0, 10) === t.slice(0, 10) && x !== t);
  await j(`/book/${pg.slug}`, { form: { t: sameDay[0], name: 'Sam Smith', email: 'sam@example.com' } });
  assert.strictEqual(booking.slotsFor(pg).filter((x) => x.slice(0, 10) === t.slice(0, 10)).length, 0);

  // They move it with their own link.
  const manage = await j(`/book/a/${token}?move=1`);
  assert.match(manage.body, /Pick a new time/);
  const other = booking.slotsFor(pg, new Date(), { ignore: 0 }).find((x) => x.slice(0, 10) !== t.slice(0, 10));
  const moved = await j(`/book/a/${token}`, { form: { action: 'move', t: other } });
  assert.match(moved.body, /was moved/);
  const db = require('../../src/db');
  assert.strictEqual(db.prepare('SELECT starts_at FROM crm_appointments WHERE token=?').get(token).starts_at, other);

  // Time off blocks a whole day for every page.
  const day = other.slice(0, 10);
  const local = new Date(other).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  await j('/booking/time-off', { method: 'POST', json: { from_date: local, to_date: local, all_day: '1', note: 'Vacation' } });
  assert.strictEqual(booking.slotsFor(pg).filter((x) => x.slice(0, 10) === day).length, 0);

  // Reminder: 20 hours before, once.
  db.prepare("UPDATE crm_appointments SET created_at=datetime('now','-5 days') WHERE token=?").run(token);
  const before = new Date(Date.parse(other) - 20 * 3600e3);
  mails.length = 0;
  assert.strictEqual(await booking.sendReminders(before), 1);
  assert.strictEqual(await booking.sendReminders(before), 0);
  await wait(100);
  assert.ok(mails.some((m) => m.rcpt.includes('rita@example.com') && /Reminder/.test(m.body)));

  // They cancel.
  const c = await j(`/book/a/${token}`, { form: { action: 'cancel' } });
  assert.match(c.body, /was cancelled/);

  // You add one yourself; a clash is caught.
  const p = await person('Walk In', 'walk@example.com');
  const add = await j('/booking/appointments', { method: 'POST', json: { contact_id: p.id, title: 'Visit', date: '2027-01-05', time: '10:00', minutes: 60 } });
  assert.strictEqual(add.status, 200);
  const clash = await j('/booking/appointments', { method: 'POST', json: { contact_id: p.id, title: 'Visit', date: '2027-01-05', time: '10:30', minutes: 30 } });
  assert.strictEqual(clash.status, 400);
  assert.ok(clash.body.clash);
  const cal = (await j('/booking/calendar?from=2027-01-04T00:00:00Z&to=2027-01-11T00:00:00Z')).body;
  assert.strictEqual(cal.appointments.length, 1);
});

test('quotes: send, open, sign with a drawn signature, invoice made and emailed; decline', async () => {
  const p = await person('Quinn Quote', 'quinn@example.com', 'Parade sponsor');
  const q = (await j('/quotes', { method: 'POST', json: { contact_id: p.id, title: 'Gold sponsorship', items: [{ what: 'Gold', qty: 1, price: 500 }], tax_rate: 0 } })).body;
  assert.strictEqual(q.status, 'draft');
  assert.strictEqual(q.total, 500);
  assert.strictEqual((await j(`/quote/${q.token}`)).status, 404, 'a draft is not public');
  mails.length = 0;
  const sent = (await j(`/quotes/${q.id}/send`, { method: 'POST', json: { by: 'email' } })).body;
  assert.strictEqual(sent.status, 'sent');
  assert.ok(mails.some((m) => m.rcpt.includes('quinn@example.com')));
  const page = await j(`/quote/${q.token}`);
  assert.match(page.body, /Sign and accept/);
  assert.ok((await j(`/quotes/${q.id}`)).body.viewed_at);
  // No signature drawn: refused.
  let r = await j(`/quote/${q.token}/accept`, { form: { name: 'Quinn Quote', agree: '1', signature: '' } });
  assert.match(decodeURIComponent(r.headers.get('location')), /Sign in the box/);
  const sig = `data:image/png;base64,${Buffer.alloc(600, 7).toString('base64')}`;
  mails.length = 0;
  r = await j(`/quote/${q.token}/accept`, { form: { name: 'Quinn Quote', agree: '1', signature: sig } });
  assert.match(r.headers.get('location'), /signed=1/);
  const done = (await j(`/quotes/${q.id}`)).body;
  assert.strictEqual(done.status, 'accepted');
  assert.strictEqual(done.signed_name, 'Quinn Quote');
  assert.ok(done.invoice, 'invoice made');
  assert.strictEqual(done.invoice.status, 'sent', 'invoice emailed');
  await wait(200);
  assert.ok(mails.filter((m) => m.rcpt.includes('quinn@example.com')).length >= 2, 'invoice + signed copy');
  const signedPage = await j(`/quote/${q.token}`);
  assert.match(signedPage.body, /Signed by Quinn Quote/);
  assert.match(signedPage.body, /\.\.\/invoice\//);
  // Can't change a signed quote.
  assert.strictEqual((await j(`/quotes/${q.id}`, { method: 'PUT', json: { title: 'x' } })).status, 400);

  const q2 = (await j('/quotes', { method: 'POST', json: { contact_id: p.id, items: [{ what: 'Silver', qty: 1, price: 250 }] } })).body;
  await j(`/quotes/${q2.id}/send`, { method: 'POST', json: { by: 'link' } });
  r = await j(`/quote/${q2.token}/decline`, { form: { reason: 'Too much this year' } });
  assert.match(r.headers.get('location'), /declined=1/);
  const d = (await j(`/quotes/${q2.id}`)).body;
  assert.strictEqual(d.status, 'declined');
  assert.strictEqual(d.declined_reason, 'Too much this year');
  const list = (await j('/quotes')).body;
  assert.strictEqual(list.totals.winRate, 50);
});

test('sites: make from a design, edit blocks, upload a photo, publish, public page', async () => {
  const s = (await j('/sites', { method: 'POST', json: { template: 'business' } })).body;
  assert.ok(s.slug);
  assert.ok(s.sections.length >= 4);
  assert.strictEqual((await j(`/s/${s.slug}`)).status, 404, 'a draft is not public');
  const up = await fetch(`${root}/api/crm/sites/upload`, { method: 'POST', headers: { ...OWNER, 'Content-Type': 'image/png' }, body: Buffer.from('89504e470d0a1a0a', 'hex') });
  const img = await up.json();
  assert.match(img.url, /^media\/\w+\.png$/);
  const sections = s.sections;
  sections[0].heading = 'Daniel King Automotive';
  sections[0].image = img.url;
  sections.push({ type: 'faq', heading: 'Questions', items: [{ q: 'Do you finance?', a: 'Yes.' }] });
  sections.push({ type: 'nope' });
  const saved = (await j(`/sites/${s.id}`, { method: 'PUT', json: { sections, published: true, slug: 'Daniel King Auto', font: 'classic' } })).body;
  assert.strictEqual(saved.slug, 'daniel-king-auto');
  assert.strictEqual(saved.sections.length, s.sections.length - 1, 'unknown blocks dropped');
  const pub = await j('/s/daniel-king-auto');
  assert.strictEqual(pub.status, 200);
  assert.match(pub.body, /Daniel King Automotive/);
  assert.match(pub.body, /Do you finance\?/);
  assert.match(pub.body, /href="\.\.\/book\//, 'booking button goes to the booking page');
  assert.strictEqual((await fetch(`${root}/s/${img.url}`)).status, 200);
  const prev = await fetch(`${root}/api/crm/sites/${s.id}/preview`, { method: 'POST', headers: { ...OWNER, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Draft title', base: '/w/9/' }) });
  const html = await prev.text();
  assert.match(html, /<title>Draft title<\/title>/);
  assert.match(html, /\/w\/9\/s\/media\//);
  assert.strictEqual((await j('/sites')).body.sites[0].views, 1);
});

test('reports: wins, payments and appointments in the month; email it; monthly send once', async () => {
  const reports = require('../../crm/server/reports');
  const p = await person('Wendy Win', 'wendy@example.com', 'Parade sponsor');
  await j(`/contacts/${p.id}`, { method: 'PUT', json: { stage: 'Paid / Done', amount: 750 } });
  const inv = (await j('/invoices', { method: 'POST', json: { contact_id: p.id, items: [{ what: 'Gold', qty: 1, price: 750 }] } })).body;
  await j(`/invoices/${inv.id}/send`, { method: 'POST', json: { by: 'link' } });
  await j(`/invoices/${inv.id}/paid`, { method: 'POST', json: { how: 'Check' } });
  const bizes = (await j('/businesses')).body;
  const parade = bizes.find((b) => b.groups.includes('Parade sponsor'));
  const r = (await j(`/reports?biz=${parade.id}`)).body;
  assert.ok(r.numbers.won >= 1);
  assert.ok(r.numbers.paid >= 750);
  assert.ok(r.numbers.people >= 1);
  assert.strictEqual(r.series.length, 6);
  mails.length = 0;
  const sent = await j(`/reports/email?biz=${parade.id}`, { method: 'POST', json: { to: 'board@example.com' } });
  assert.strictEqual(sent.status, 200);
  assert.ok(mails.some((m) => m.rcpt.includes('board@example.com') && /Money paid/.test(flatMail(m))));
  assert.strictEqual((await j(`/reports/settings?biz=${parade.id}`, { method: 'PUT', json: { report_email: 'board@example.com' } })).status, 200);
  const next = new Date(Date.now() + 40 * 864e5);
  assert.strictEqual(await reports.sendMonthly(next), 1);
  assert.strictEqual(await reports.sendMonthly(next), 0, 'only once a month');
});
