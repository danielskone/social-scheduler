// Google Calendar bookings (secret iCal address) -> Contacts + Appointments.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gcal-'));
process.env.GCAL_ICS_URL = 'https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc/basic.ics';
const gcal = require('../server/gcal');
const crm = require('../server/crm');
const db = require('../../src/db');

const ev = ({ uid, start = '20261110T150000Z', end = '20261110T153000Z', summary = 'Free intro call with Viral Attraction', attendee = 'ava@shop.com', cn = 'Ava Stone', extra = '' }) => [
  'BEGIN:VEVENT', `DTSTART:${start}`, `DTEND:${end}`, `UID:${uid}`,
  'ORGANIZER;CN=Daniel King:mailto:danielskone@gmail.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Daniel King;X-NUM-GUESTS=0:mailto:danielskone@gmail.com',
  `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=${cn};X-NUM-GUESTS=0:mailto:${attendee}`,
  'DESCRIPTION:Booked by\\nAva Stone\\nava@shop.com\\n\\nPhone number\\n(919) 555-0100\\n\\nBusiness name\\nStone Ba',
  ' kery\\n\\nWhat do you need?\\nBusiness interview',
  `SUMMARY:${summary}`, extra, 'END:VEVENT'].filter(Boolean).join('\r\n');
const cal = (...events) => ['BEGIN:VCALENDAR', 'X-WR-CALNAME:danielskone@gmail.com', 'X-WR-TIMEZONE:America/New_York', ...events,
  'BEGIN:VEVENT', 'DTSTART;TZID=America/New_York:20261111T080000', 'DTEND;TZID=America/New_York:20261111T090000', 'UID:film', 'SUMMARY:Every day film three products', 'END:VEVENT',
  'END:VCALENDAR'].join('\r\n');
const fakeFetch = (text) => async () => ({ ok: true, status: 200, text: async () => text });
const now = new Date('2026-11-06T17:00:00Z');

test('reads times in UTC and in a named timezone', () => {
  assert.strictEqual(gcal.toIso('20261110T150000Z'), '2026-11-10T15:00:00.000Z');
  assert.strictEqual(gcal.toIso('20261111T080000', 'America/New_York'), '2026-11-11T13:00:00.000Z');
  assert.strictEqual(gcal.toIso('20261111'), null);
});

test('a booking becomes a contact with phone and business, an appointment, and a history note', async () => {
  const r = await gcal.check({ fetchImpl: fakeFetch(cal(ev({ uid: 'b1' }))), now });
  assert.deepStrictEqual(r, { added: 1, cancelled: 0 });
  const c = crm.listContacts({ q: 'ava@shop.com' })[0];
  assert.strictEqual(c.name, 'Ava Stone');
  assert.strictEqual(c.phone, '(919) 555-0100');
  assert.strictEqual(c.company, 'Stone Bakery');
  assert.strictEqual(c.group_name, 'Viral Attraction lead');
  assert.strictEqual(c.email_ok, 0, 'booking a call is not permission to email');
  const a = db.prepare('SELECT * FROM crm_appointments WHERE contact_id=?').get(c.id);
  assert.strictEqual(a.starts_at, '2026-11-10T15:00:00.000Z');
  assert.match(crm.getContact(c.id).activities[0].note, /Google Calendar/);
  // Same feed again: nothing new. Own events (filming) are never imported.
  assert.deepStrictEqual(await gcal.check({ fetchImpl: fakeFetch(cal(ev({ uid: 'b1' }))), now }), { added: 0, cancelled: 0 });
  assert.strictEqual(crm.listContacts({ q: 'film' }).length, 0);
});

test('a moved booking updates the time; a removed one is cancelled', async () => {
  await gcal.check({ fetchImpl: fakeFetch(cal(ev({ uid: 'b1', start: '20261112T150000Z', end: '20261112T153000Z' }))), now });
  const a = db.prepare("SELECT a.* FROM crm_appointments a JOIN gcal_bookings g ON g.appointment_id=a.id WHERE g.uid='b1'").get();
  assert.strictEqual(a.starts_at, '2026-11-12T15:00:00.000Z');
  const r = await gcal.check({ fetchImpl: fakeFetch(cal()), now });
  assert.deepStrictEqual(r, { added: 0, cancelled: 1 });
  assert.strictEqual(db.prepare('SELECT status FROM crm_appointments WHERE id=?').get(a.id).status, 'cancelled');
});

test('ignores events without a guest and events with other titles; reports a bad address', async () => {
  const noGuest = ev({ uid: 'x1', attendee: 'danielskone@gmail.com' });
  const other = ev({ uid: 'x2', summary: 'Dentist', attendee: 'doc@x.com' });
  assert.deepStrictEqual(await gcal.check({ fetchImpl: fakeFetch(cal(noGuest, other)), now }), { added: 0, cancelled: 0 });
  const r = await gcal.check({ fetchImpl: async () => ({ ok: false, status: 404, text: async () => 'nope' }), now });
  assert.match(r.error, /npm run calendar/);
  assert.match(gcal.status().lastError, /secret address/);
});
