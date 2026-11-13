// Appointment booking: time zones, open times, double-booking, public page flow.
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

let booking, crm, notify, db, server, root;
test.before(async () => {
  await new Promise((r) => fake.listen(0, r));
  process.env.NTFY_BASE = `http://127.0.0.1:${fake.address().port}`;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'book-'));
  process.env.APP_PASSWORD = '';
  delete process.env.BOOKING_TIMEZONE;
  booking = require('../server/booking');
  crm = require('../server/crm');
  notify = require('../../src/notify');
  db = require('../../src/db');
  notify.createTopic();
  server = require('../../src/server').listen(0);
  await new Promise((r) => server.once('listening', r));
  root = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { fake.close(); server.close(); });

test('wall-clock times convert to UTC for Eastern time, including daylight saving', () => {
  assert.strictEqual(booking.zoned(2026, 11, 10, 9, 0).toISOString(), '2026-11-10T14:00:00.000Z');
  assert.strictEqual(booking.zoned(2026, 7, 1, 9, 0).toISOString(), '2026-07-01T13:00:00.000Z');
});

test('starter car-lot booking page: Mon-Sat 9 to 5 Eastern, 30 minutes, with notice', () => {
  const pg = db.prepare('SELECT * FROM crm_booking_pages').get();
  assert.match(pg.title, /Daniel King Automotive/);
  const now = new Date('2026-11-09T13:00:00Z'); // Monday 8:00 Eastern
  const slots = booking.slotsFor(pg, now);
  assert.strictEqual(slots[0], '2026-11-09T15:00:00.000Z', 'first slot is 10:00 (2 hours notice)');
  const mon = slots.filter((s) => s.startsWith('2026-11-09'));
  assert.strictEqual(mon[mon.length - 1], '2026-11-09T21:30:00.000Z', 'last slot 4:30pm');
  assert.ok(!slots.some((s) => s.startsWith('2026-11-15T1')), 'closed Sunday');
  assert.ok(slots.some((s) => s.startsWith('2026-11-14T14:00')), 'open Saturday 9am');
});

test('booking takes the time, finds the same person by phone, and refuses double booking', () => {
  const pg = db.prepare('SELECT * FROM crm_booking_pages').get();
  const now = new Date('2026-11-09T13:00:00Z');
  const t = '2026-11-10T15:00:00.000Z';
  const a = booking.book(pg, { name: 'Dee Buyer', phone: '(919) 555-0123', t, note: 'Looking at the F-150' }, now);
  assert.strictEqual(a.contact.group_name, 'Auto customer');
  assert.ok(!booking.slotsFor(pg, now).includes(t));
  assert.throws(() => booking.book(pg, { name: 'Other', phone: '9195550999', t }, now), /just taken/);
  const b = booking.book(pg, { name: 'Dee B', phone: '919-555-0123', t: '2026-11-11T15:00:00.000Z' }, now);
  assert.strictEqual(b.contact.id, a.contact.id, 'same phone, same contact');
  assert.throws(() => booking.book(pg, { name: 'X', t: '2026-11-12T15:00:00.000Z' }, now), /phone number or email/);
  assert.throws(() => booking.book(pg, { name: 'X', phone: '1', t: '2026-11-15T15:00:00.000Z' }, now), /just taken/, 'closed day is never bookable');
  booking.cancel(a.appointment.id);
  assert.ok(booking.slotsFor(pg, now).includes(t), 'cancelling frees the time');
  assert.match(crm.getContact(a.contact.id).activities.map((x) => x.note).join('|'), /Cancelled/);
});

test('page settings are checked', () => {
  assert.throws(() => booking.savePage({ title: 'X', days: '' }), /at least one day/);
  assert.throws(() => booking.savePage({ title: 'X', start_time: '17:00', end_time: '09:00' }), /before closing/);
  const p = booking.savePage({ title: 'Calls', days: [1, 3], minutes: 15, start_time: '10:00', end_time: '11:00' });
  assert.strictEqual(p.days, '1,3');
  assert.strictEqual(booking.slotsFor(p, new Date('2026-11-08T12:00:00Z')).filter((s) => s.startsWith('2026-11-09')).length, 4);
});

test('public booking page works through the tunnel and alerts the phone; the API does not', async () => {
  const pg = db.prepare("SELECT * FROM crm_booking_pages WHERE title LIKE 'Book a visit%'").get();
  const tunnel = { headers: { 'cf-connecting-ip': '198.51.100.7' } };
  const pick = await fetch(`${root}/book/${pg.slug}`, tunnel);
  assert.strictEqual(pick.status, 200);
  const t = decodeURIComponent((await pick.text()).match(/href="\?t=([^"]+)"/)[1]);
  const details = await fetch(`${root}/book/${pg.slug}?t=${encodeURIComponent(t)}`, tunnel);
  assert.match(await details.text(), /Book this time/);
  const before = got.length;
  const r = await fetch(`${root}/book/${pg.slug}`, { method: 'POST', headers: { ...tunnel.headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ t, name: 'Web Booker', email: 'web@booker.com', note: 'Trade-in', email_ok: '1' }) });
  assert.match(await r.text(), /You're booked/);
  await new Promise((res) => setTimeout(res, 50));
  assert.ok(got.slice(before).some((g) => g.title === 'New appointment' && /Web Booker/.test(g.message)));
  const c = crm.listContacts({ q: 'web@booker.com' })[0];
  assert.strictEqual(c.email_ok, 1);
  assert.strictEqual((await fetch(`${root}/api/crm/booking/appointments`, tunnel)).status, 404);
  const list = await (await fetch(`${root}/api/crm/booking/appointments`)).json();
  assert.ok(list.some((a) => a.contact_name === 'Web Booker'));
});

test("morning alert lists today's appointments", () => {
  const pg = db.prepare('SELECT * FROM crm_booking_pages').get();
  const now = new Date('2026-11-09T13:00:00Z');
  booking.book(pg, { name: 'Morning Person', phone: '9195550777', t: '2026-11-09T16:00:00.000Z' }, now);
  const lines = booking.todaysLines(now);
  assert.ok(lines.some((l) => /11:00 AM appointment: Morning Person/.test(l)), lines.join('\n'));
});
