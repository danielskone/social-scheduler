// Google Calendar bookings -> Viral Touch CRM.
//
// Your website's "Book a free call" buttons open a Google Calendar booking page. Google
// puts each booking on your calendar. This file reads your calendar's private iCal address
// (Google Calendar > Settings > your calendar > "Secret address in iCal format") every
// 5 minutes, and for each booking it adds or finds the person in Contacts, puts it in the
// CRM's Appointments list (so it's in the 8am phone summary), and buzzes your phone.
// Read-only: nothing is ever changed in your Google Calendar. No Google sign-in or app review needed.
const db = require('./db');
const crm = require('./crm');
const booking = require('./booking');
const notify = require('./notify');

db.exec(`
CREATE TABLE IF NOT EXISTS gcal_bookings (
  uid TEXT PRIMARY KEY,
  appointment_id INTEGER,
  contact_id INTEGER,
  starts_at TEXT
);
CREATE TABLE IF NOT EXISTS gcal_state (id INTEGER PRIMARY KEY CHECK (id = 1), last_check TEXT, last_error TEXT, imported INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO gcal_state (id) VALUES (1);
`);

const settings = () => ({
  url: (process.env.GCAL_ICS_URL || '').trim(),
  // Only events whose title contains this are bookings (your booking page's name).
  match: (process.env.GCAL_MATCH || 'Viral Attraction').trim().toLowerCase(),
  group: process.env.WEBSITE_GROUP || 'Viral Attraction lead',
});

// ---------- A small iCal (.ics) reader ----------
function unescapeText(v) {
  return String(v).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}
function parseIcs(text) {
  const lines = String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n'); // unfold
  const events = [];
  let ev = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = { attendees: [] }; continue; }
    if (line === 'END:VEVENT') { if (ev) events.push(ev); ev = null; continue; }
    if (!ev) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [name, ...paramList] = line.slice(0, i).split(';');
    const value = line.slice(i + 1);
    const params = Object.fromEntries(paramList.map((p) => { const j = p.indexOf('='); return [p.slice(0, j).toUpperCase(), p.slice(j + 1).replace(/^"|"$/g, '')]; }));
    const key = name.toUpperCase();
    if (key === 'ATTENDEE' || key === 'ORGANIZER') {
      const person = { email: value.replace(/^mailto:/i, '').trim().toLowerCase(), name: params.CN || '', status: params.PARTSTAT || '' };
      if (key === 'ATTENDEE') ev.attendees.push(person); else ev.organizer = person;
    } else if (key === 'DTSTART' || key === 'DTEND') {
      ev[key.toLowerCase()] = toIso(value, params.TZID);
    } else if (['UID', 'SUMMARY', 'DESCRIPTION', 'STATUS', 'LOCATION'].includes(key)) {
      ev[key.toLowerCase()] = unescapeText(value);
    }
  }
  return events;
}
// 20261110T140000Z, or 20261110T090000 with TZID=America/New_York. All-day dates return null.
function toIso(v, tz) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(String(v).trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)).toISOString();
  return booking.zoned(+y, +mo, +d, +h, +mi, tz || process.env.BOOKING_TIMEZONE || 'America/New_York').toISOString();
}

// Google writes the booking form answers into the event description.
function details(description) {
  const text = String(description || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
  const pick = (re) => { const m = re.exec(text); return m ? m[1].trim() : ''; };
  return {
    text: text.slice(0, 1500),
    phone: pick(/phone[^:\n]*[:\n]\s*([+()\d][\d\s().+-]{6,})/i) || pick(/(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/),
    company: pick(/business(?: name)?[^:\n]*[:\n]\s*([^\n]+)/i),
  };
}

// The booker: an attendee who isn't you (the calendar owner/organizer).
function bookerOf(ev, owner) {
  const me = new Set([owner, ev.organizer && ev.organizer.email].filter(Boolean));
  return ev.attendees.find((a) => a.email && !me.has(a.email) && !/calendar\.google\.com$|resource\.calendar/.test(a.email));
}

function importEvent(ev, owner, s = settings()) {
  const who = bookerOf(ev, owner);
  if (!who) return null;
  const info = details(ev.description);
  let c = db.prepare('SELECT * FROM contacts WHERE lower(email)=?').get(who.email);
  const name = who.name && who.name !== who.email ? who.name : who.email.split('@')[0];
  let isNew = false;
  if (c) {
    const patch = {};
    if (!c.phone && info.phone) patch.phone = info.phone;
    if (!c.company && info.company) patch.company = info.company;
    if (Object.keys(patch).length) c = crm.updateContact(c.id, patch);
  } else {
    c = crm.createContact({ name, email: who.email, phone: info.phone, company: info.company, group_name: s.group, stage: 'New' }, { source: 'booking', form: 'Google Calendar booking' });
    isNew = true;
  }
  const ends = ev.dtend || new Date(Date.parse(ev.dtstart) + 30 * 60e3).toISOString();
  const title = String(ev.summary || 'Google Calendar booking').slice(0, 200);
  const apptId = db.prepare('INSERT INTO crm_appointments (page_id, contact_id, title, starts_at, ends_at, note) VALUES (NULL,?,?,?,?,?)')
    .run(c.id, title, ev.dtstart, ends, info.text || null).lastInsertRowid;
  db.prepare('INSERT INTO gcal_bookings (uid, appointment_id, contact_id, starts_at) VALUES (?,?,?,?)').run(ev.uid, apptId, c.id, ev.dtstart);
  crm.logActivity(c.id, { kind: 'Meeting', note: `Booked "${title}" for ${booking.niceWhen(ev.dtstart)} (Google Calendar)${info.text ? `:\n${info.text}` : ''}` });
  crm.emit('appointment_booked', { contact: crm.getContact(c.id), form: title, when: booking.niceWhen(ev.dtstart) });
  return { contact: crm.getContact(c.id), isNew, when: ev.dtstart, title };
}

function cancelBooking(row) {
  const a = db.prepare('SELECT * FROM crm_appointments WHERE id=?').get(row.appointment_id);
  if (a && a.status === 'booked') booking.cancel(a.id);
  db.prepare('UPDATE gcal_bookings SET starts_at=NULL WHERE uid=?').run(row.uid);
  return a;
}

let running = false;
async function check({ fetchImpl = fetch, now = new Date() } = {}) {
  const s = settings();
  if (!s.url || running) return { skipped: true };
  running = true;
  let added = 0, cancelled = 0;
  try {
    const res = await fetchImpl(s.url, { signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    if (!res.ok || !text.includes('BEGIN:VCALENDAR')) throw new Error(`Google Calendar did not send your calendar (status ${res.status}). Check the secret address: npm run calendar`);
    const owner = (/X-WR-CALNAME:([^\r\n]+@[^\r\n]+)/.exec(text) || [])[1]?.trim().toLowerCase() || '';
    const events = parseIcs(text);
    const since = now.getTime() - 24 * 3600e3;
    const live = new Set();
    for (const ev of events) {
      if (!ev.uid || !ev.dtstart || !String(ev.summary || '').toLowerCase().includes(s.match)) continue;
      if (Date.parse(ev.dtstart) < since) continue;
      const known = db.prepare('SELECT * FROM gcal_bookings WHERE uid=?').get(ev.uid);
      if (String(ev.status || '').toUpperCase() === 'CANCELLED') { if (known && known.starts_at) { cancelBooking(known); cancelled++; } continue; }
      live.add(ev.uid);
      if (known && known.starts_at && known.starts_at !== ev.dtstart) { // moved to a new time
        const a = db.prepare('SELECT * FROM crm_appointments WHERE id=?').get(known.appointment_id);
        if (a) {
          db.prepare('UPDATE crm_appointments SET starts_at=?, ends_at=? WHERE id=?').run(ev.dtstart, ev.dtend || ev.dtstart, a.id);
          if (a.contact_id) crm.logActivity(a.contact_id, { kind: 'Meeting', note: `Moved "${a.title}" to ${booking.niceWhen(ev.dtstart)}` });
        }
        db.prepare('UPDATE gcal_bookings SET starts_at=? WHERE uid=?').run(ev.dtstart, ev.uid);
      }
      if (known) continue;
      const r = importEvent(ev, owner, s);
      if (!r) continue;
      added++;
      notify.send('New booking', `${r.contact.name}${r.contact.company ? ` (${r.contact.company})` : ''}\n${booking.niceWhen(r.when)}\n${r.title}`, { tags: 'calendar' }).catch(() => {});
    }
    // A future booking that vanished from the calendar was cancelled.
    for (const row of db.prepare('SELECT * FROM gcal_bookings WHERE starts_at IS NOT NULL AND starts_at > ?').all(now.toISOString())) {
      if (live.has(row.uid)) continue;
      const a = cancelBooking(row);
      cancelled++;
      const c = a && crm.getContact(a.contact_id);
      notify.send('Booking cancelled', `${c ? c.name : 'Someone'}\n${booking.niceWhen(row.starts_at)}`, { tags: 'x' }).catch(() => {});
    }
    db.prepare("UPDATE gcal_state SET last_check=datetime('now'), last_error=NULL, imported=imported+? WHERE id=1").run(added);
    return { added, cancelled };
  } catch (e) {
    db.prepare("UPDATE gcal_state SET last_check=datetime('now'), last_error=? WHERE id=1").run(String(e.message || e).slice(0, 300));
    return { error: e.message };
  } finally {
    running = false;
  }
}

function status() {
  const st = db.prepare('SELECT * FROM gcal_state WHERE id=1').get();
  return { connected: Boolean(settings().url), match: settings().match, lastCheck: st.last_check, lastError: st.last_error, imported: st.imported };
}

module.exports = { check, status, parseIcs, details, toIso };
