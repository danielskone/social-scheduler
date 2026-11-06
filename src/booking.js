// Appointment booking for Viral Touch CRM: public pages at /book/<random id> where people pick
// an open time. Each booking adds (or finds) the contact, logs it in their history and pings
// your iPhone. Times use BOOKING_TIMEZONE (default America/New_York), whatever the Mac's
// own timezone setting is.
const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const notify = require('./notify');
const config = require('./config');
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
`);

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
  };
  if (!p.title) throw err400('Give the booking page a title.');
  if (!(p.minutes >= 5 && p.minutes <= 480)) throw err400('Appointment length must be between 5 and 480 minutes.');
  if (!p.days) throw err400('Pick at least one day you are open.');
  const s = hm(p.start_time), e = hm(p.end_time);
  if (!s || !e || s[0] * 60 + s[1] + p.minutes > e[0] * 60 + e[1]) throw err400('Opening time must be before closing time, with room for one appointment.');
  if (!(p.days_ahead >= 1 && p.days_ahead <= 365)) throw err400('"How far ahead" must be 1 to 365 days.');
  if (!(p.notice_hours >= 0 && p.notice_hours <= 720)) throw err400('Notice must be 0 to 720 hours.');
  if (old) {
    db.prepare(`UPDATE crm_booking_pages SET title=@title, intro=@intro, location=@location, group_name=@group_name, minutes=@minutes, days=@days,
      start_time=@start_time, end_time=@end_time, days_ahead=@days_ahead, notice_hours=@notice_hours, email_checkbox=@email_checkbox, active=@active WHERE id=@id`).run({ ...p, id });
  } else {
    id = db.prepare(`INSERT INTO crm_booking_pages (slug, title, intro, location, group_name, minutes, days, start_time, end_time, days_ahead, notice_hours, email_checkbox, active)
      VALUES (@slug,@title,@intro,@location,@group_name,@minutes,@days,@start_time,@end_time,@days_ahead,@notice_hours,@email_checkbox,@active)`)
      .run({ ...p, slug: crypto.randomBytes(6).toString('hex') }).lastInsertRowid;
  }
  return db.prepare('SELECT * FROM crm_booking_pages WHERE id=?').get(id);
}

// A ready-made page for the car business, added once (stays deleted if you delete it).
if (!db.prepare("SELECT 1 FROM crm_flags WHERE name='starter_booking'").get()) {
  db.transaction(() => {
    savePage({ title: 'Book a visit with Daniel King Automotive', group_name: 'Auto customer', minutes: 30, days: '1,2,3,4,5,6', start_time: '09:00', end_time: '17:00',
      intro: 'Pick a time to come see a vehicle, take a test drive or talk about financing. Tell us what you are looking for and we will have it ready.',
      email_checkbox: 'Yes, email me about new arrivals and specials. I can unsubscribe any time.' });
    db.prepare("INSERT INTO crm_flags (name) VALUES ('starter_booking')").run();
  })();
}

// ---------- Open times ----------
function slotsFor(pg, now = new Date()) {
  const [sh, sm] = hm(pg.start_time), [eh, em] = hm(pg.end_time);
  const open = pg.days.split(',').map(Number);
  const earliest = now.getTime() + pg.notice_hours * 3600e3;
  const until = now.getTime() + (pg.days_ahead + 1) * 864e5;
  const busy = db.prepare("SELECT starts_at, ends_at FROM crm_appointments WHERE status='booked' AND ends_at > ? AND starts_at < ?")
    .all(new Date(earliest).toISOString(), new Date(until).toISOString())
    .map((a) => [Date.parse(a.starts_at), Date.parse(a.ends_at)]);
  const start = parts(now);
  const out = [];
  for (let i = 0; i <= pg.days_ahead; i++) {
    const noon = zoned(start.y, start.m, start.d, 12, 0);
    const day = parts(new Date(noon.getTime() + i * 864e5));
    if (!open.includes(day.wd)) continue;
    for (let mins = sh * 60 + sm; mins + pg.minutes <= eh * 60 + em; mins += pg.minutes) {
      const s = zoned(day.y, day.m, day.d, Math.floor(mins / 60), mins % 60).getTime();
      const e = s + pg.minutes * 60e3;
      if (s < earliest) continue;
      if (busy.some(([bs, be]) => s < be && e > bs)) continue;
      out.push(new Date(s).toISOString());
    }
  }
  return out;
}

// ---------- Booking ----------
function book(pg, body, now = new Date()) {
  const s = (k, n) => String(body[k] || '').trim().slice(0, n);
  const name = s('name', 120), email = s('email', 200).toLowerCase(), phone = s('phone', 40), note = s('note', 1000), when = s('t', 40);
  if (!name) throw err400('Please enter your name.');
  if (!phone && !email) throw err400('Please enter a phone number or email so we can confirm.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err400('That email address does not look right.');
  return db.transaction(() => {
    if (!slotsFor(pg, now).includes(when)) throw err400('Sorry, that time was just taken. Please pick another time.');
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
      c = crm.createContact({ name, email, phone, group_name: pg.group_name, stage: 'New', email_ok: optIn, email_ok_source: optIn ? source : null });
    }
    const ends = new Date(Date.parse(when) + pg.minutes * 60e3).toISOString();
    const id = db.prepare('INSERT INTO crm_appointments (page_id, contact_id, title, starts_at, ends_at, note) VALUES (?,?,?,?,?,?)')
      .run(pg.id, c.id, pg.title, when, ends, note || null).lastInsertRowid;
    crm.logActivity(c.id, { kind: 'Meeting', note: `Booked "${pg.title}" for ${niceWhen(when)}${note ? `:\n${note}` : ''}` });
    return { appointment: db.prepare('SELECT * FROM crm_appointments WHERE id=?').get(id), contact: c };
  })();
}

function listAppointments({ past } = {}) {
  const now = new Date().toISOString();
  return db.prepare(`SELECT a.*, c.name AS contact_name, c.phone, c.email, p.location FROM crm_appointments a
    LEFT JOIN contacts c ON c.id=a.contact_id LEFT JOIN crm_booking_pages p ON p.id=a.page_id
    WHERE ${past ? 'a.ends_at < ?' : "a.ends_at >= ? AND a.status='booked'"} ORDER BY a.starts_at ${past ? 'DESC LIMIT 100' : ''}`).all(now);
}

function cancel(id) {
  const a = db.prepare('SELECT * FROM crm_appointments WHERE id=?').get(id);
  if (!a) throw Object.assign(new Error('Appointment not found'), { status: 404 });
  db.prepare("UPDATE crm_appointments SET status='cancelled' WHERE id=?").run(id);
  if (a.contact_id && a.status === 'booked') crm.logActivity(a.contact_id, { kind: 'Meeting', note: `Cancelled "${a.title}" on ${niceWhen(a.starts_at)}` });
}

// Lines for the morning phone alert: today's appointments.
function todaysLines(now = new Date()) {
  const p = parts(now);
  const from = zoned(p.y, p.m, p.d, 0, 0).toISOString(), to = zoned(p.y, p.m, p.d, 23, 59).toISOString();
  return db.prepare(`SELECT a.starts_at, c.name FROM crm_appointments a LEFT JOIN contacts c ON c.id=a.contact_id
    WHERE a.status='booked' AND a.starts_at >= ? AND a.starts_at <= ? ORDER BY a.starts_at`).all(from, to)
    .map((a) => `• ${fmt(a.starts_at, { hour: 'numeric', minute: '2-digit' })} appointment: ${a.name || 'someone'}`);
}

// ---------- Public pages (mounted at /book, no password) ----------
const { page, esc, nl } = crm.html;
const extraCss = `<style>.days{margin-top:14px}.day h2{font-size:1rem;margin:18px 0 8px}.slots{display:flex;flex-wrap:wrap;gap:8px}
.slots a{padding:9px 14px;border:1px solid var(--line);border-radius:999px;text-decoration:none;color:var(--accent);font-weight:600}
.slots a:hover{background:var(--accent);color:#fff}.when{background:var(--bg);border-radius:10px;padding:12px 14px;margin:12px 0;font-weight:600}a{color:var(--accent)}</style>`;

function renderPicker(pg, error = '') {
  const slots = slotsFor(pg);
  const byDay = new Map();
  for (const t of slots) {
    const k = fmt(t, { weekday: 'long', month: 'long', day: 'numeric' });
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(t);
  }
  const days = [...byDay.entries()].slice(0, 14);
  return page(pg.title, `${extraCss}<h1>${esc(pg.title)}</h1>${pg.intro ? `<p>${nl(pg.intro)}</p>` : ''}
${pg.location ? `<p class="muted">📍 ${esc(pg.location)}</p>` : ''}<p class="muted">${pg.minutes} minutes · times are ${esc(tzLabel())}</p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<div class="days">${days.map(([d, ts]) => `<div class="day"><h2>${esc(d)}</h2><div class="slots">${ts.map((t) => `<a href="?t=${encodeURIComponent(t)}">${esc(fmt(t, { hour: 'numeric', minute: '2-digit' }))}</a>`).join('')}</div></div>`).join('')
  || '<p>There are no open times right now. Please check back soon.</p>'}</div>`);
}

function renderDetails(pg, t, error = '', v = {}) {
  const val = (k) => esc(v[k]);
  return page(pg.title, `${extraCss}<h1>${esc(pg.title)}</h1><div class="when">🗓 ${esc(niceWhen(t))}${pg.location ? `<br><span class="muted">📍 ${esc(pg.location)}</span>` : ''}</div>
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
    res.send(page(pg.title, `${extraCss}<h1>You're booked!</h1><div class="when">🗓 ${esc(niceWhen(appointment.starts_at))}${pg.location ? `<br><span class="muted">📍 ${esc(pg.location)}</span>` : ''}</div>
<p>Thank you, ${esc(String(contact.name).split(/\s+/)[0])}. We'll see you then. If you need to change the time, just call or text us.</p>`));
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
  const pages = db.prepare('SELECT * FROM crm_booking_pages ORDER BY id').all();
  const counts = db.prepare("SELECT page_id, COUNT(*) AS n FROM crm_appointments WHERE status='booked' AND ends_at >= ? GROUP BY page_id").all(new Date().toISOString());
  pages.forEach((p) => { p.url = `${config.publicBaseUrl}/book/${p.slug}`; p.upcoming = counts.find((c) => c.page_id === p.id)?.n || 0; });
  res.json({ pages, timezone: TZ() });
}));
router.post('/pages', wrap((req, res) => res.json(savePage(req.body || {}))));
router.put('/pages/:id', wrap((req, res) => res.json(savePage(req.body || {}, Number(req.params.id)))));
router.delete('/pages/:id', wrap((req, res) => { db.prepare('DELETE FROM crm_booking_pages WHERE id=?').run(req.params.id); res.json({ ok: true }); }));
router.get('/appointments', wrap((req, res) => res.json(listAppointments({ past: req.query.past === '1' }))));
router.post('/appointments/:id/cancel', wrap((req, res) => { cancel(Number(req.params.id)); res.json({ ok: true }); }));

module.exports = { router, publicBooking, savePage, slotsFor, book, cancel, listAppointments, todaysLines, zoned, parts, niceWhen };
