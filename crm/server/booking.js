// Appointment booking for Viral Touch CRM: public pages at /book/<random id> where people pick
// an open time. Each booking adds (or finds) the contact, logs it in their history and pings
// your iPhone. Times use BOOKING_TIMEZONE (default America/New_York), whatever the Mac's
// own timezone setting is.
const crypto = require('crypto');
const express = require('express');
const db = require('../../src/db');
const notify = require('../../src/notify');
const config = require('../../src/config');
const crm = require('./crm');

const TZ = () => process.env.BOOKING_TIMEZONE || 'America/New_York';
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

db.exec(`
CREATE TABLE IF NOT EXISTS crm_booking_pages (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  intro TEXT,
  location TEXT,
  group_name TEXT NOT NULL DEFAULT 'Other',
  minutes INTEGER NOT NULL DEFAULT 30,      -- length of each appointment
  days TEXT NOT NULL DEFAULT '1,2,3,4,5',   -- open weekdays, 0 = Sunday
  start_time TEXT NOT NULL DEFAULT '09:00',
  end_time TEXT NOT NULL DEFAULT '17:00',
  days_ahead INTEGER NOT NULL DEFAULT 30,   -- how far ahead people can book
  notice_hours INTEGER NOT NULL DEFAULT 2,  -- earliest booking from now
  email_checkbox TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_appointments (
  id INTEGER PRIMARY KEY,
  page_id INTEGER REFERENCES crm_booking_pages(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,                  -- ISO UTC
  ends_at TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_flags (name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS crm_time_off (
  id INTEGER PRIMARY KEY,
  starts_at TEXT NOT NULL,                  -- ISO UTC
  ends_at TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
// Newer settings: a break between appointments, a daily limit, and the reminder email.
const addCol = (t, c, def) => { if (!db.prepare(`SELECT 1 FROM pragma_table_info('${t}') WHERE name=?`).get(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); };
addCol('crm_booking_pages', 'buffer_minutes', 'INTEGER NOT NULL DEFAULT 0');
addCol('crm_booking_pages', 'max_per_day', 'INTEGER NOT NULL DEFAULT 0');
addCol('crm_booking_pages', 'remind_hours', 'INTEGER NOT NULL DEFAULT 24');
addCol('crm_appointments', 'token', 'TEXT');
addCol('crm_appointments', 'reminded_at', 'TEXT');
addCol('crm_appointments', 'location', 'TEXT');
// Team booking: a page can take turns between people on the team (0 = you, the owner).
addCol('crm_booking_pages', 'team', 'TEXT');
addCol('crm_appointments', 'staff_id', 'INTEGER');
require('./team'); // makes crm_team
addCol('crm_team', 'hours_days', 'TEXT');
addCol('crm_team', 'hours_start', 'TEXT');
addCol('crm_team', 'hours_end', 'TEXT');
const teamOf = (pg) => { try { const t = JSON.parse(pg.team || '[]'); return Array.isArray(t) ? t.map(Number).filter((n) => Number.isInteger(n) && n >= 0) : []; } catch { return []; } };
const member = (id) => (id ? db.prepare('SELECT id, name, email, hours_days, hours_start, hours_end FROM crm_team WHERE id=?').get(Number(id)) : null);
const staffName = (id) => (id ? (member(id) || {}).name || null : null);

// ---------- Time helpers (wall-clock time in TZ <-> UTC) ----------
function parts(date, tz = TZ()) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
  const o = Object.fromEntries(f.formatToParts(date).map((p) => [p.type, p.value]));
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, min: +o.minute, wd: DAY_NAMES.indexOf(o.weekday) };
}
// UTC Date for a wall-clock time (y-m-d hh:mm) in tz.
function zoned(y, m, d, h, min, tz = TZ()) {
  let t = Date.UTC(y, m - 1, d, h, min);
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(t), tz);
    t -= Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Date.UTC(y, m - 1, d, h, min);
  }
  return new Date(t);
}
const fmt = (iso, opts) => new Date(iso).toLocaleString('en-US', { timeZone: TZ(), ...opts });
const tzLabel = () => new Intl.DateTimeFormat('en-US', { timeZone: TZ(), timeZoneName: 'longGeneric' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName').value;
const niceWhen = (iso) => fmt(iso, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const hm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m && +m[1] < 24 && +m[2] < 60 ? [+m[1], +m[2]] : null; };

// ---------- Pages ----------
const err400 = (m) => Object.assign(new Error(m), { status: 400 });
function savePage(body, id) {
  const old = id ? db.prepare('SELECT * FROM crm_booking_pages WHERE id=?').get(id) : null;
  if (id && !old) throw Object.assign(new Error('Booking page not found'), { status: 404 });
  const pick = (k, d) => (body[k] !== undefined ? body[k] : old ? old[k] : d);
  const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? 1 : 0);
  const days = (Array.isArray(pick('days', '1,2,3,4,5')) ? pick('days') : String(pick('days', '1,2,3,4,5')).split(','))
    .filter((x) => String(x).trim() !== '').map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  const p = {
    title: String(pick('title', '')).trim(),
    intro: String(pick('intro', '') || '').trim() || null,
    location: String(pick('location', '') || '').trim() || null,
    group_name: String(pick('group_name', 'Other') || '').trim() || 'Other',
    minutes: Math.round(Number(pick('minutes', 30))),
    days: [...new Set(days)].sort().join(','),
    start_time: String(pick('start_time', '09:00')),
    end_time: String(pick('end_time', '17:00')),
    days_ahead: Math.round(Number(pick('days_ahead', 30))),
    notice_hours: Math.round(Number(pick('notice_hours', 2))),
    email_checkbox: String(pick('email_checkbox', '') || '').trim() || null,
    active: body.active !== undefined ? bool(body.active) : old ? old.active : 1,
    buffer_minutes: Math.round(Number(pick('buffer_minutes', 0)) || 0),
    max_per_day: Math.round(Number(pick('max_per_day', 0)) || 0),
    remind_hours: Math.round(Number(pick('remind_hours', 24))),
    team: (() => {
      const t = body.team !== undefined ? body.team : old ? teamOf(old) : [];
      const ids = [...new Set((Array.isArray(t) ? t : String(t || '').split(',')).filter((x) => String(x).trim() !== '').map(Number))].filter((n) => n === 0 || member(n));
      return ids.length > 1 || (ids.length === 1 && ids[0] !== 0) ? JSON.stringify(ids) : null;
    })(),
  };
  if (!p.title) throw err400('Give the booking page a title.');
  if (!(p.minutes >= 5 && p.minutes <= 480)) throw err400('Appointment length must be between 5 and 480 minutes.');
  if (!p.days) throw err400('Pick at least one day you are open.');
  const s = hm(p.start_time), e = hm(p.end_time);
  if (!s || !e || s[0] * 60 + s[1] + p.minutes > e[0] * 60 + e[1]) throw err400('Opening time must be before closing time, with room for one appointment.');
  if (!(p.days_ahead >= 1 && p.days_ahead <= 365)) throw err400('"How far ahead" must be 1 to 365 days.');
  if (!(p.notice_hours >= 0 && p.notice_hours <= 720)) throw err400('Notice must be 0 to 720 hours.');
  if (!(p.buffer_minutes >= 0 && p.buffer_minutes <= 240)) throw err400('The break between appointments must be 0 to 240 minutes.');
  if (!(p.max_per_day >= 0 && p.max_per_day <= 100)) throw err400('The daily limit must be 0 (no limit) to 100.');
  if (![0, 1, 2, 3, 6, 12, 24, 48, 72].includes(p.remind_hours)) p.remind_hours = 24;
  if (old) {
    db.prepare(`UPDATE crm_booking_pages SET title=@title, intro=@intro, location=@location, group_name=@group_name, minutes=@minutes, days=@days,
      start_time=@start_time, end_time=@end_time, days_ahead=@days_ahead, notice_hours=@notice_hours, email_checkbox=@email_checkbox, active=@active,
      buffer_minutes=@buffer_minutes, max_per_day=@max_per_day, remind_hours=@remind_hours, team=@team WHERE id=@id`).run({ ...p, id });
  } else {
    id = db.prepare(`INSERT INTO crm_booking_pages (slug, title, intro, location, group_name, minutes, days, start_time, end_time, days_ahead, notice_hours, email_checkbox, active, buffer_minutes, max_per_day, remind_hours, team)
      VALUES (@slug,@title,@intro,@location,@group_name,@minutes,@days,@start_time,@end_time,@days_ahead,@notice_hours,@email_checkbox,@active,@buffer_minutes,@max_per_day,@remind_hours,@team)`)
      .run({ ...p, slug: crypto.randomBytes(6).toString('hex') }).lastInsertRowid;
  }
  return db.prepare('SELECT * FROM crm_booking_pages WHERE id=?').get(id);
}

// A ready-made page for the car business, added once (stays deleted if you delete it).
if (config.ownerStarters && !db.prepare("SELECT 1 FROM crm_flags WHERE name='starter_booking'").get()) {
  db.transaction(() => {
    savePage({ title: 'Book a visit with Daniel King Automotive', group_name: 'Auto customer', minutes: 30, days: '1,2,3,4,5,6', start_time: '09:00', end_time: '17:00',
      intro: 'Pick a time to come see a vehicle, take a test drive or talk about financing. Tell us what you are looking for and we will have it ready.',
      email_checkbox: 'Yes, email me about new arrivals and specials. I can unsubscribe any time.' });
    db.prepare("INSERT INTO crm_flags (name) VALUES ('starter_booking')").run();
  })();
}

// ---------- Open times ----------
// ignore: an appointment id to leave out (when someone moves their own appointment).
// A team page shows a time when anyone on its team is free; staff: only that person's times.
function slotsFor(pg, now = new Date(), { ignore, staff } = {}) {
  const team = teamOf(pg);
  if (!team.length) return staffSlots(pg, null, now, ignore);
  let who = staff != null ? [Number(staff)] : team;
  if (staff == null && ignore) { const a = getAppt(ignore); if (a) who = [Number(a.staff_id || 0)]; }
  return [...new Set(who.flatMap((s) => staffSlots(pg, s, now, ignore)))].sort();
}
// One person's open times. staff null = the owner on a normal page (busy with every appointment that has no team member).
function staffSlots(pg, staff, now = new Date(), ignore) {
  const m = staff ? member(staff) : null;
  if (staff && !m) return [];
  let [sh, sm] = hm(pg.start_time), [eh, em] = hm(pg.end_time);
  let open = pg.days.split(',').map(Number);
  // A team member's own hours narrow the page's hours.
  if (m && m.hours_days) open = open.filter((d) => m.hours_days.split(',').map(Number).includes(d));
  if (m && hm(m.hours_start)) { const [h2, m2] = hm(m.hours_start); if (h2 * 60 + m2 > sh * 60 + sm) [sh, sm] = [h2, m2]; }
  if (m && hm(m.hours_end)) { const [h2, m2] = hm(m.hours_end); if (h2 * 60 + m2 < eh * 60 + em) [eh, em] = [h2, m2]; }
  const gap = (pg.buffer_minutes || 0) * 60e3;
  const earliest = now.getTime() + pg.notice_hours * 3600e3;
  const until = now.getTime() + (pg.days_ahead + 1) * 864e5;
  const appts = db.prepare("SELECT id, page_id, starts_at, ends_at, staff_id FROM crm_appointments WHERE status='booked' AND ends_at > ? AND starts_at < ? AND id != ?")
    .all(new Date(earliest - 864e5).toISOString(), new Date(until + 864e5).toISOString(), Number(ignore) || 0);
  const mine = appts.filter((a) => Number(a.staff_id || 0) === Number(staff || 0));
  const busy = mine.map((a) => [Date.parse(a.starts_at) - gap, Date.parse(a.ends_at) + gap])
    // Your time off is yours; team members have their own hours.
    .concat(staff ? [] : db.prepare('SELECT starts_at, ends_at FROM crm_time_off WHERE ends_at > ? AND starts_at < ?').all(new Date(earliest).toISOString(), new Date(until).toISOString())
      .map((t) => [Date.parse(t.starts_at), Date.parse(t.ends_at)]));
  // Daily limit: count this page's bookings per local day (for the whole page).
  const perDay = new Map();
  const dayKey = (ms) => { const p = parts(new Date(ms)); return `${p.y}-${p.m}-${p.d}`; };
  if (pg.max_per_day) for (const a of appts) if (a.page_id === pg.id) { const k = dayKey(Date.parse(a.starts_at)); perDay.set(k, (perDay.get(k) || 0) + 1); }
  const start = parts(now);
  const out = [];
  for (let i = 0; i <= pg.days_ahead; i++) {
    const noon = zoned(start.y, start.m, start.d, 12, 0);
    const day = parts(new Date(noon.getTime() + i * 864e5));
    if (!open.includes(day.wd)) continue;
    if (pg.max_per_day && (perDay.get(`${day.y}-${day.m}-${day.d}`) || 0) >= pg.max_per_day) continue;
    for (let mins = sh * 60 + sm; mins + pg.minutes <= eh * 60 + em; mins += pg.minutes + (pg.buffer_minutes || 0)) {
      const s = zoned(day.y, day.m, day.d, Math.floor(mins / 60), mins % 60).getTime();
      const e = s + pg.minutes * 60e3;
      if (s < earliest) continue;
      if (busy.some(([bs, be]) => s < be && e > bs)) continue;
      out.push(new Date(s).toISOString());
    }
  }
  return out;
}
// Taking turns: of the people free at that time, the one with the fewest bookings from this page
// in the last 30 days (then the one who had one longest ago).
function pickStaff(pg, when, now = new Date()) {
  const team = teamOf(pg);
  if (!team.length) return null;
  const free = team.filter((s) => staffSlots(pg, s, now).includes(when));
  if (!free.length) return undefined;
  const since = new Date(now.getTime() - 30 * 864e5).toISOString();
  const score = (s) => {
    const r = db.prepare("SELECT COUNT(*) AS n, MAX(created_at) AS last FROM crm_appointments WHERE page_id=? AND status='booked' AND COALESCE(staff_id,0)=? AND created_at >= ?").get(pg.id, s, since.replace('T', ' ').slice(0, 19));
    return [r.n, r.last || ''];
  };
  return free.map((s) => ({ s, sc: score(s) })).sort((a, b) => a.sc[0] - b.sc[0] || a.sc[1].localeCompare(b.sc[1]) || team.indexOf(a.s) - team.indexOf(b.s))[0].s;
}

// ---------- Booking ----------
const newToken = () => crypto.randomBytes(15).toString('base64url');
function book(pg, body, now = new Date()) {
  const s = (k, n) => String(body[k] || '').trim().slice(0, n);
  const name = s('name', 120), email = s('email', 200).toLowerCase(), phone = s('phone', 40), note = s('note', 1000), when = s('t', 40);
  if (!name) throw err400('Please enter your name.');
  if (!phone && !email) throw err400('Please enter a phone number or email so we can confirm.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err400('That email address does not look right.');
  const out = db.transaction(() => {
    if (!slotsFor(pg, now).includes(when)) throw err400('Sorry, that time was just taken. Please pick another time.');
    const staff = pickStaff(pg, when, now);
    if (staff === undefined) throw err400('Sorry, that time was just taken. Please pick another time.');
    const digits = phone.replace(/\D/g, '').slice(-10);
    let c = email ? db.prepare('SELECT * FROM contacts WHERE lower(email)=?').get(email) : null;
    if (!c && digits.length === 10) c = db.prepare('SELECT * FROM contacts').all().find((x) => String(x.phone || '').replace(/\D/g, '').slice(-10) === digits);
    const optIn = Boolean(pg.email_checkbox && email && body.email_ok);
    const source = `Checked "${pg.email_checkbox}" when booking "${pg.title}"`;
    if (c) {
      const patch = {};
      if (!c.phone && phone) patch.phone = phone;
      if (!c.email && email) patch.email = email;
      if (optIn && !c.email_ok && !c.do_not_contact) Object.assign(patch, { email: c.email || email, email_ok: true, email_ok_source: source });
      if (Object.keys(patch).length) c = crm.updateContact(c.id, patch);
    } else {
      c = crm.createContact({ name, email, phone, group_name: pg.group_name, stage: 'New', email_ok: optIn, email_ok_source: optIn ? source : null }, { source: 'booking' });
    }
    const ends = new Date(Date.parse(when) + pg.minutes * 60e3).toISOString();
    const id = db.prepare('INSERT INTO crm_appointments (page_id, contact_id, title, starts_at, ends_at, note, token, location, staff_id) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(pg.id, c.id, pg.title, when, ends, note || null, newToken(), pg.location || null, staff || null).lastInsertRowid;
    crm.logActivity(c.id, { kind: 'Meeting', note: `Booked "${pg.title}" for ${niceWhen(when)}${staff ? ` with ${staffName(staff)}` : ''}${note ? `:\n${note}` : ''}` });
    return { appointment: db.prepare('SELECT * FROM crm_appointments WHERE id=?').get(id), contact: c };
  })();
  crm.emit('appointment_booked', { contact: crm.getContact(out.contact.id), form: out.appointment.title, when: niceWhen(out.appointment.starts_at) });
  if (out.appointment.staff_id) tellStaff(out.appointment).catch(() => {});
  return { ...out, contact: crm.getContact(out.contact.id) };
}

function listAppointments({ past, biz } = {}) {
  const now = new Date().toISOString();
  const bf = require('./businesses').filter(biz, 'c.group_name');
  return db.prepare(`SELECT a.*, c.name AS contact_name, c.phone, c.email, p.location, t.name AS staff_name FROM crm_appointments a
    LEFT JOIN contacts c ON c.id=a.contact_id LEFT JOIN crm_booking_pages p ON p.id=a.page_id LEFT JOIN crm_team t ON t.id=a.staff_id
    WHERE ${past ? 'a.ends_at < ?' : "a.ends_at >= ? AND a.status='booked'"}${bf.sql ? ` AND (a.contact_id IS NULL OR ${bf.sql})` : ''}
    ORDER BY a.starts_at ${past ? 'DESC LIMIT 100' : ''}`).all(now, ...bf.args);
}

function cancel(id, { by = 'you' } = {}) {
  const a = db.prepare('SELECT * FROM crm_appointments WHERE id=?').get(id);
  if (!a) throw Object.assign(new Error('Appointment not found'), { status: 404 });
  db.prepare("UPDATE crm_appointments SET status='cancelled' WHERE id=?").run(id);
  if (a.contact_id && a.status === 'booked') crm.logActivity(a.contact_id, { kind: 'Meeting', note: `${by === 'them' ? 'They cancelled' : 'Cancelled'} "${a.title}" on ${niceWhen(a.starts_at)}` });
}

// Lines for the morning phone alert: today's appointments.
function todaysLines(now = new Date()) {
  const p = parts(now);
  const from = zoned(p.y, p.m, p.d, 0, 0).toISOString(), to = zoned(p.y, p.m, p.d, 23, 59).toISOString();
  return db.prepare(`SELECT a.starts_at, c.name FROM crm_appointments a LEFT JOIN contacts c ON c.id=a.contact_id
    WHERE a.status='booked' AND a.starts_at >= ? AND a.starts_at <= ? ORDER BY a.starts_at`).all(from, to)
    .map((a) => `• ${fmt(a.starts_at, { hour: 'numeric', minute: '2-digit' })} appointment: ${a.name || 'someone'}`);
}

// ---------- Adding, moving and cancelling ----------
const getAppt = (id) => db.prepare('SELECT * FROM crm_appointments WHERE id=?').get(Number(id));
const pageOf = (a) => (a && a.page_id ? db.prepare('SELECT * FROM crm_booking_pages WHERE id=?').get(a.page_id) : null);
// "2026-11-20" + "14:30" in the booking timezone -> ISO UTC.
function localToIso(date, time) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || '')), t = hm(time);
  if (!d || !t) throw err400('Pick a date and a time.');
  return zoned(+d[1], +d[2], +d[3], t[0], t[1]).toISOString();
}
// You add an appointment yourself (a phone call that turned into a meeting, a walk-in...).
function addAppointment(body = {}) {
  const c = db.prepare('SELECT * FROM contacts WHERE id=?').get(Number(body.contact_id));
  if (!c) throw err400('Pick who the appointment is with.');
  const pg = body.page_id ? db.prepare('SELECT * FROM crm_booking_pages WHERE id=?').get(Number(body.page_id)) : null;
  const minutes = Math.round(Number(body.minutes || (pg ? pg.minutes : 30)));
  if (!(minutes >= 5 && minutes <= 720)) throw err400('Length must be 5 to 720 minutes.');
  const starts = localToIso(body.date, body.time);
  const ends = new Date(Date.parse(starts) + minutes * 60e3).toISOString();
  const title = String(body.title || (pg ? pg.title : '') || 'Appointment').trim().slice(0, 120);
  const staff = body.staff_id ? Number(body.staff_id) : null;
  if (staff && !member(staff)) throw err400('That team member was not found.');
  const clash = db.prepare("SELECT a.*, c.name FROM crm_appointments a LEFT JOIN contacts c ON c.id=a.contact_id WHERE a.status='booked' AND a.starts_at < ? AND a.ends_at > ? AND COALESCE(a.staff_id,0)=?").get(ends, starts, staff || 0);
  if (clash && !body.force) throw Object.assign(err400(`That overlaps ${clash.name || 'another appointment'} at ${fmt(clash.starts_at, { hour: 'numeric', minute: '2-digit' })}.`), { clash: true });
  const id = db.prepare('INSERT INTO crm_appointments (page_id, contact_id, title, starts_at, ends_at, note, token, location, staff_id) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(pg ? pg.id : null, c.id, title, starts, ends, String(body.note || '').trim().slice(0, 1000) || null, newToken(), String(body.location || (pg && pg.location) || '').trim() || null, staff).lastInsertRowid;
  crm.logActivity(c.id, { kind: 'Meeting', note: `Appointment "${title}" set for ${niceWhen(starts)}` });
  return getAppt(id);
}
// Moves an appointment to a new time (you in the CRM, or the person with their own link).
function moveAppointment(id, startsIso, { by = 'you' } = {}) {
  const a = getAppt(id);
  if (!a || a.status !== 'booked') throw Object.assign(new Error('Appointment not found'), { status: 404 });
  const len = Date.parse(a.ends_at) - Date.parse(a.starts_at);
  const ends = new Date(Date.parse(startsIso) + len).toISOString();
  db.prepare('UPDATE crm_appointments SET starts_at=?, ends_at=?, reminded_at=NULL WHERE id=?').run(startsIso, ends, a.id);
  if (a.contact_id) crm.logActivity(a.contact_id, { kind: 'Meeting', note: `${by === 'them' ? 'They moved' : 'Moved'} "${a.title}" from ${niceWhen(a.starts_at)} to ${niceWhen(startsIso)}` });
  return getAppt(a.id);
}

// A team member gets an email when a booking lands on their calendar.
async function tellStaff(a, opts = {}) {
  const m = member(a.staff_id), email = require('./email');
  if (!m || !m.email || !email.provider()) return false;
  const c = a.contact_id ? db.prepare('SELECT name, email, phone FROM contacts WHERE id=?').get(a.contact_id) : null;
  await email.sendDirect({ to: m.email, toName: m.name, subject: `New booking: ${c ? c.name : 'someone'}, ${fmt(a.starts_at, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
    text: [`Hi ${String(m.name).split(' ')[0]},`, '', `${c ? c.name : 'Someone'} booked "${a.title}" with you:`, `${niceWhen(a.starts_at)} (${tzLabel()})`,
      ...(c && c.phone ? [`Phone: ${c.phone}`] : []), ...(c && c.email ? [`Email: ${c.email}`] : []), ...(a.note ? ['', a.note] : [])].join('\n') }, opts);
  return true;
}

// ---------- Emails to the person: confirmation and reminder ----------
const manageLink = (a) => `${config.publicBaseUrl}/book/a/${a.token}`;
function ensureToken(a) {
  if (a.token) return a;
  db.prepare('UPDATE crm_appointments SET token=? WHERE id=?').run(newToken(), a.id);
  return getAppt(a.id);
}
function bizFor(a) {
  const c = a.contact_id ? db.prepare('SELECT group_name FROM contacts WHERE id=?').get(a.contact_id) : null;
  const pg = pageOf(a);
  return require('./businesses').ownerOf((pg && pg.group_name) || (c && c.group_name));
}
async function emailPerson(a, kind, opts = {}) {
  const email = require('./email');
  a = ensureToken(a);
  const c = a.contact_id ? db.prepare('SELECT * FROM contacts WHERE id=?').get(a.contact_id) : null;
  if (!c || !c.email || !email.provider()) return false;
  const b = bizFor(a);
  const first = String(c.name).split(/\s+/)[0];
  const where = a.location || (pageOf(a) || {}).location;
  const lines = {
    confirm: [`Hi ${first},`, '', `You're booked: ${a.title}`, niceWhen(a.starts_at) + ` (${tzLabel()})`],
    remind: [`Hi ${first},`, '', `A reminder about your appointment: ${a.title}`, niceWhen(a.starts_at) + ` (${tzLabel()})`],
    moved: [`Hi ${first},`, '', `Your appointment "${a.title}" is now:`, niceWhen(a.starts_at) + ` (${tzLabel()})`],
  }[kind];
  const withWho = staffName(a.staff_id);
  const text = [...lines, ...(withWho ? [`With: ${withWho}`] : []), ...(where ? [`Where: ${where}`] : []), '', 'Need to change it? Pick a new time or cancel here:', manageLink(a), '',
    'Add it to your calendar:', `${manageLink(a)}/invite.ics`, '', `See you then!${b ? `\n${b.name}${b.phone ? `, ${b.phone}` : ''}` : ''}`].join('\n');
  const subject = { confirm: `Booked: ${a.title}`, remind: `Reminder: ${a.title}, ${fmt(a.starts_at, { weekday: 'long', hour: 'numeric', minute: '2-digit' })}`, moved: `New time: ${a.title}` }[kind];
  await email.sendDirect({ to: c.email, toName: c.name, subject, text }, opts);
  return true;
}
// Every 15 minutes: one reminder email per appointment, a set number of hours before it.
async function sendReminders(now = new Date(), opts = {}) {
  const rows = db.prepare(`SELECT a.*, COALESCE(p.remind_hours, 24) AS remind_hours FROM crm_appointments a LEFT JOIN crm_booking_pages p ON p.id=a.page_id
    WHERE a.status='booked' AND a.reminded_at IS NULL AND a.starts_at > ?`).all(now.toISOString());
  let n = 0;
  for (const a of rows) {
    if (!a.remind_hours || Date.parse(a.starts_at) - now.getTime() > a.remind_hours * 3600e3) continue;
    // Booked inside the reminder window: the confirmation email already covered it.
    const booked = Date.parse(`${String(a.created_at).replace(' ', 'T')}Z`);
    if (booked > Date.parse(a.starts_at) - a.remind_hours * 3600e3) { db.prepare('UPDATE crm_appointments SET reminded_at=? WHERE id=?').run(now.toISOString(), a.id); continue; }
    db.prepare('UPDATE crm_appointments SET reminded_at=? WHERE id=?').run(now.toISOString(), a.id);
    try { if (await emailPerson(a, 'remind', opts)) n++; } catch (e) { console.error(`[booking] reminder: ${e.message}`); }
  }
  return n;
}

// A calendar file, so the person (or you) can add it to Apple or Google Calendar.
function ics(a) {
  const z = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const t = (v) => String(v || '').replace(/[\;,]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  const b = bizFor(a);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Viral Touch CRM//EN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', `UID:appt-${a.id}-${a.token}@viraltouch`,
    `DTSTAMP:${z(new Date().toISOString())}`, `DTSTART:${z(a.starts_at)}`, `DTEND:${z(a.ends_at)}`, `SUMMARY:${t(a.title)}${b ? ` (${t(b.name)})` : ''}`,
    ...(a.location ? [`LOCATION:${t(a.location)}`] : []), `DESCRIPTION:${t(`Change or cancel: ${manageLink(a)}`)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

// ---------- Time off (days or hours nobody can book) ----------
function addTimeOff(body = {}) {
  const from = localToIso(body.from_date, body.all_day ? '00:00' : body.from_time);
  const to = localToIso(body.to_date || body.from_date, body.all_day ? '23:59' : body.to_time);
  if (Date.parse(to) <= Date.parse(from)) throw err400('The end must be after the start.');
  const id = db.prepare('INSERT INTO crm_time_off (starts_at, ends_at, note) VALUES (?,?,?)').run(from, to, String(body.note || '').trim().slice(0, 120) || null).lastInsertRowid;
  return db.prepare('SELECT * FROM crm_time_off WHERE id=?').get(id);
}
const listTimeOff = () => db.prepare('SELECT * FROM crm_time_off WHERE ends_at > ? ORDER BY starts_at').all(new Date().toISOString());

// One week (or any range) for the calendar view.
function calendar({ from, to, biz } = {}) {
  const f = Date.parse(from) || Date.now(), t = Date.parse(to) || f + 7 * 864e5;
  const bf = require('./businesses').filter(biz, 'c.group_name');
  const appts = db.prepare(`SELECT a.*, c.name AS contact_name, c.phone, c.email, c.group_name, t.name AS staff_name FROM crm_appointments a LEFT JOIN contacts c ON c.id=a.contact_id
    LEFT JOIN crm_team t ON t.id=a.staff_id WHERE a.status='booked' AND a.ends_at > ? AND a.starts_at < ?${bf.sql ? ` AND (a.contact_id IS NULL OR ${bf.sql})` : ''} ORDER BY a.starts_at`)
    .all(new Date(f).toISOString(), new Date(t).toISOString(), ...bf.args);
  const off = db.prepare('SELECT * FROM crm_time_off WHERE ends_at > ? AND starts_at < ? ORDER BY starts_at').all(new Date(f).toISOString(), new Date(t).toISOString());
  return { appointments: appts, timeOff: off, timezone: TZ() };
}

// ---------- Public pages (mounted at /book, no password) ----------
const { page, esc, nl } = crm.html;
const extraCss = `<style>.days{margin-top:14px}.day h2{font-size:1rem;margin:18px 0 8px}.slots{display:flex;flex-wrap:wrap;gap:8px}
.slots a{padding:9px 14px;border:1px solid var(--line);border-radius:999px;text-decoration:none;color:var(--accent);font-weight:600}
.slots a:hover{background:var(--accent);color:#fff}.when{background:var(--bg);border-radius:10px;padding:12px 14px;margin:12px 0;font-weight:600}a{color:var(--accent)}</style>`;

// The booking pages wear the business's own color.
const brand = (pg) => { const b = require('./businesses').ownerOf(pg.group_name); return b && /^#[0-9a-f]{6}$/i.test(b.color) ? `<style>:root{--accent:${b.color}}</style>` : ''; };

function renderPicker(pg, error = '', { ignore, lead } = {}) {
  const slots = slotsFor(pg, new Date(), { ignore });
  const byDay = new Map();
  for (const t of slots) {
    const k = fmt(t, { weekday: 'long', month: 'long', day: 'numeric' });
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(t);
  }
  const days = [...byDay.entries()].slice(0, 14);
  return page(pg.title, `${extraCss}${brand(pg)}<h1>${esc(pg.title)}</h1>${lead || (pg.intro ? `<p>${nl(pg.intro)}</p>` : '')}
${pg.location ? `<p class="muted">📍 ${esc(pg.location)}</p>` : ''}<p class="muted">${pg.minutes} minutes · times are ${esc(tzLabel())}</p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<div class="days">${days.map(([d, ts]) => `<div class="day"><h2>${esc(d)}</h2><div class="slots">${ts.map((t) => `<a href="?t=${encodeURIComponent(t)}">${esc(fmt(t, { hour: 'numeric', minute: '2-digit' }))}</a>`).join('')}</div></div>`).join('')
  || '<p>There are no open times right now. Please check back soon.</p>'}</div>`);
}

function renderDetails(pg, t, error = '', v = {}) {
  const val = (k) => esc(v[k]);
  return page(pg.title, `${extraCss}${brand(pg)}<h1>${esc(pg.title)}</h1><div class="when">🗓 ${esc(niceWhen(t))}${pg.location ? `<br><span class="muted">📍 ${esc(pg.location)}</span>` : ''}</div>
<p><a href="?">← Pick a different time</a></p>${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post"><input type="hidden" name="t" value="${esc(t)}">
<label for="n">Name</label><input id="n" name="name" required maxlength="120" autocomplete="name" value="${val('name')}">
<label for="p">Phone</label><input id="p" name="phone" type="tel" maxlength="40" autocomplete="tel" value="${val('phone')}">
<label for="e">Email</label><input id="e" name="email" type="email" maxlength="200" autocomplete="email" value="${val('email')}">
<label for="m">Anything we should know? <span class="muted">(optional)</span></label><textarea id="m" name="note" rows="3" maxlength="1000">${val('note')}</textarea>
${pg.email_checkbox ? `<label class="check"><input type="checkbox" name="email_ok" value="1"${v.email_ok ? ' checked' : ''}> <span>${esc(pg.email_checkbox)}</span></label>` : ''}
<div class="hp" aria-hidden="true"><label>Leave this empty<input name="website" tabindex="-1" autocomplete="off"></label></div>
<button type="submit">Book this time</button>
<p class="muted">Your details are only used for this appointment${pg.email_checkbox ? ', and to email you if you check the box' : ''}. They are never sold or shared.</p></form>`);
}

const publicBooking = express.Router();
publicBooking.use(express.urlencoded({ extended: false, limit: '20kb' }));
const activePage = (slug) => db.prepare('SELECT * FROM crm_booking_pages WHERE slug=? AND active=1').get(String(slug));
const notFound = (res) => res.status(404).send(page('Not found', '<h1>This booking page is not available.</h1>'));
// The person's own link (in their emails): see, move or cancel their appointment.
const byToken = (t) => db.prepare('SELECT * FROM crm_appointments WHERE token=?').get(String(t || ''));
const apptPage = (a) => pageOf(a) || { id: 0, title: a.title, group_name: 'Other', minutes: Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60e3), days: '1,2,3,4,5',
  start_time: '09:00', end_time: '17:00', days_ahead: 30, notice_hours: 2, location: a.location };
function renderManage(a, msg = '') {
  const pg = apptPage(a), when = esc(niceWhen(a.starts_at));
  if (a.status !== 'booked') return page(a.title, `${extraCss}${brand(pg)}<h1>${esc(a.title)}</h1><p>This appointment (${when}) was cancelled.</p>${pg.slug && pg.active ? `<p><a href="../${esc(pg.slug)}">Book a new time</a></p>` : ''}`);
  const past = Date.parse(a.starts_at) < Date.now();
  return page(a.title, `${extraCss}${brand(pg)}${msg ? `<p class="ok" style="background:#e7f7ec;color:#14532d;padding:12px 14px;border-radius:10px;font-weight:600">${esc(msg)}</p>` : ''}
<h1>${esc(a.title)}</h1><div class="when">🗓 ${when}${a.location || pg.location ? `<br><span class="muted">📍 ${esc(a.location || pg.location)}</span>` : ''}</div>
<p><a href="${esc(a.token)}/invite.ics">Add to my calendar</a></p>
${past ? '<p class="muted">This appointment has passed.</p>' : `${pg.slug ? `<p><a href="?move=1">Pick a different time</a></p>` : ''}
<form method="post" onsubmit="return confirm('Cancel this appointment?')"><input type="hidden" name="action" value="cancel"><button type="submit" style="background:#c92a2a">Cancel my appointment</button></form>`}`);
}
publicBooking.get('/a/:token/invite.ics', (req, res) => {
  const a = byToken(req.params.token);
  if (!a || a.status !== 'booked') return notFound(res);
  res.type('text/calendar').set('Content-Disposition', 'attachment; filename="appointment.ics"').send(ics(a));
});
publicBooking.get('/a/:token', (req, res) => {
  const a = byToken(req.params.token);
  if (!a) return notFound(res);
  const pg = pageOf(a);
  res.set('Cache-Control', 'no-store');
  if (a.status === 'booked' && pg && (req.query.move || req.query.t)) {
    const t = String(req.query.t || '');
    const lead = `<p>Your time now: <b>${esc(niceWhen(a.starts_at))}</b>. Pick a new time below.</p><p><a href="?">← Keep my time</a></p>`;
    if (t && slotsFor(pg, new Date(), { ignore: a.id }).includes(t)) {
      return res.send(page(pg.title, `${extraCss}${brand(pg)}<h1>Move to this time?</h1><div class="when">🗓 ${esc(niceWhen(t))}</div>
<form method="post"><input type="hidden" name="action" value="move"><input type="hidden" name="t" value="${esc(t)}"><button type="submit">Yes, move my appointment</button></form><p><a href="?move=1">← Pick a different time</a></p>`));
    }
    return res.send(renderPicker(pg, t ? 'Sorry, that time is no longer open.' : '', { ignore: a.id, lead }));
  }
  res.send(renderManage(a));
});
publicBooking.post('/a/:token', async (req, res) => {
  const a = byToken(req.params.token);
  if (!a || a.status !== 'booked') return notFound(res);
  if (crm.tooMany(String(req.get('cf-connecting-ip') || req.ip))) return res.status(429).send(page(a.title, '<h1>Too many tries</h1><p>Please try again later.</p>'));
  const c = a.contact_id ? db.prepare('SELECT name, phone FROM contacts WHERE id=?').get(a.contact_id) : null;
  if (req.body.action === 'cancel') {
    cancel(a.id, { by: 'them' });
    notify.send('Appointment cancelled', `${c ? c.name : 'Someone'} cancelled ${a.title}\n${niceWhen(a.starts_at)}`, { tags: 'calendar' }).catch(() => {});
    return res.send(renderManage(getAppt(a.id)));
  }
  if (req.body.action === 'move') {
    const pg = pageOf(a), t = String(req.body.t || '');
    if (!pg || !slotsFor(pg, new Date(), { ignore: a.id }).includes(t)) return res.status(400).send(renderPicker(pg || apptPage(a), 'Sorry, that time was just taken. Please pick another.', { ignore: a.id }));
    const moved = moveAppointment(a.id, t, { by: 'them' });
    notify.send('Appointment moved', `${c ? c.name : 'Someone'} moved ${a.title}\nfrom ${niceWhen(a.starts_at)}\nto ${niceWhen(t)}`, { tags: 'calendar', priority: 'high' }).catch(() => {});
    emailPerson(moved, 'moved').catch(() => {});
    return res.send(renderManage(moved, 'Done! Your appointment was moved.'));
  }
  res.redirect(303, req.params.token);
});

publicBooking.get('/:slug', (req, res) => {
  const pg = activePage(req.params.slug);
  if (!pg) return notFound(res);
  const t = String(req.query.t || '');
  if (t && slotsFor(pg).includes(t)) return res.send(renderDetails(pg, t));
  res.send(renderPicker(pg, t ? 'Sorry, that time is no longer open. Please pick another.' : ''));
});
publicBooking.post('/:slug', (req, res) => {
  const pg = activePage(req.params.slug);
  if (!pg) return notFound(res);
  if (req.body.website) return res.send(page(pg.title, '<h1>Thank you!</h1>'));
  if (crm.tooMany(String(req.get('cf-connecting-ip') || req.ip))) return res.status(429).send(page(pg.title, '<h1>Too many tries</h1><p>Please try again later.</p>'));
  try {
    const { appointment, contact } = book(pg, req.body);
    notify.send('New appointment', `${contact.name}${contact.phone ? ` (${contact.phone})` : ''}\n${niceWhen(appointment.starts_at)}\n${pg.title}${appointment.note ? `\n"${appointment.note}"` : ''}`,
      { tags: 'calendar', priority: 'high' }).catch(() => {});
    const emailed = Boolean(contact.email);
    emailPerson(appointment, 'confirm').catch((e) => console.error(`[booking] confirmation: ${e.message}`));
    res.send(page(pg.title, `${extraCss}${brand(pg)}<h1>You're booked!</h1><div class="when">🗓 ${esc(niceWhen(appointment.starts_at))}${pg.location ? `<br><span class="muted">📍 ${esc(pg.location)}</span>` : ''}</div>
<p>Thank you, ${esc(String(contact.name).split(/\s+/)[0])}. We'll see you then.${emailed ? ' We emailed you the details.' : ''}</p>
<p><a href="a/${esc(appointment.token)}/invite.ics">Add to my calendar</a> · <a href="a/${esc(appointment.token)}">Change or cancel</a></p>`));
  } catch (e) {
    const t = String(req.body.t || '');
    if (e.status && slotsFor(pg).includes(t)) return res.status(400).send(renderDetails(pg, t, e.message, req.body));
    res.status(e.status || 500).send(renderPicker(pg, e.status ? e.message : 'Something went wrong. Please try again.'));
  }
});

// ---------- Admin API (mounted at /api/crm/booking) ----------
const router = express.Router();
const wrap = (fn) => (req, res) => { try { fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/pages', wrap((req, res) => {
  const bf = require('./businesses').filter(req.query.biz);
  const pages = db.prepare(`SELECT * FROM crm_booking_pages ${bf.sql ? `WHERE ${bf.sql}` : ''} ORDER BY id`).all(...bf.args);
  const counts = db.prepare("SELECT page_id, COUNT(*) AS n FROM crm_appointments WHERE status='booked' AND ends_at >= ? GROUP BY page_id").all(new Date().toISOString());
  pages.forEach((p) => { p.url = `${config.publicBaseUrl}/book/${p.slug}`; p.upcoming = counts.find((c) => c.page_id === p.id)?.n || 0; });
  res.json({ pages, timezone: TZ() });
}));
router.post('/pages', wrap((req, res) => { require('./businesses').claim(req.query.biz, (req.body || {}).group_name); res.json(savePage(req.body || {})); }));
router.put('/pages/:id', wrap((req, res) => { require('./businesses').claim(req.query.biz, (req.body || {}).group_name); res.json(savePage(req.body || {}, Number(req.params.id))); }));
router.delete('/pages/:id', wrap((req, res) => { db.prepare('DELETE FROM crm_booking_pages WHERE id=?').run(req.params.id); res.json({ ok: true }); }));
router.get('/appointments', wrap((req, res) => res.json(listAppointments({ past: req.query.past === '1', biz: req.query.biz }))));
router.post('/appointments/:id/cancel', wrap((req, res) => { cancel(Number(req.params.id)); res.json({ ok: true }); }));
const awrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message, clash: e.clash || undefined }); } };
router.get('/calendar', wrap((req, res) => res.json(calendar(req.query))));
router.post('/appointments', awrap(async (req) => {
  const a = addAppointment(req.body || {});
  let emailed = false;
  if ((req.body || {}).email_them) emailed = await emailPerson(a, 'confirm').catch((e) => { throw Object.assign(new Error(`Saved, but the email didn't go out: ${e.message}`), { status: 502 }); });
  return { ...a, emailed };
}));
router.put('/appointments/:id', awrap(async (req) => {
  const b = req.body || {};
  const moved = moveAppointment(req.params.id, localToIso(b.date, b.time));
  if (b.email_them) await emailPerson(moved, 'moved').catch(() => {});
  return moved;
}));
router.get('/time-off', wrap((req, res) => res.json(listTimeOff())));
router.post('/time-off', wrap((req, res) => res.json(addTimeOff(req.body || {}))));
router.delete('/time-off/:id', wrap((req, res) => { db.prepare('DELETE FROM crm_time_off WHERE id=?').run(Number(req.params.id)); res.json({ ok: true }); }));

module.exports = { router, publicBooking, savePage, slotsFor, staffSlots, pickStaff, tellStaff, teamOf, book, cancel, listAppointments, todaysLines, zoned, parts, niceWhen, addAppointment, moveAppointment, sendReminders, emailPerson, ics, addTimeOff, listTimeOff, calendar, localToIso };
