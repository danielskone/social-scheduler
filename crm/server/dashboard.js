// Dashboard (numbers and charts) and Launchpad (what's set up and what isn't) for Viral Touch CRM.
// Both follow the business picked in the switcher (?biz=), like everything else.
const express = require('express');
const db = require('../../src/db');
const notify = require('../../src/notify');
const crm = require('./crm');
const biz = require('./businesses');
const config = require('../../src/config');

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const WON = 'Paid / Done', LOST = 'Not this year';

// Range: ?days=7|30|90|365 or days=all. Returns local YYYY-MM-DD bounds (inclusive).
function range(q = {}) {
  const now = new Date();
  if (q.days === 'all') {
    const first = db.prepare('SELECT MIN(created_at) AS d FROM contacts').get().d;
    return { from: first ? first.slice(0, 10) : ymd(now), to: ymd(now), days: 'all' };
  }
  const days = [7, 30, 90, 365].includes(Number(q.days)) ? Number(q.days) : 30;
  const from = new Date(now); from.setDate(from.getDate() - (days - 1));
  return { from: ymd(from), to: ymd(now), days };
}

// created_at is saved in UTC by SQLite; turn it into the Mac's local day before comparing.
const LOCAL_DAY = "date(created_at, 'localtime')";

function dashboard(q = {}) {
  const r = range(q);
  const bf = biz.filter(q.biz);
  const and = bf.sql ? ` AND ${bf.sql}` : '';
  const people = db.prepare(`SELECT id, stage, COALESCE(amount,0) AS amount, group_name, ${LOCAL_DAY} AS day FROM contacts WHERE 1=1${and}`).all(...bf.args);
  const inRange = people.filter((p) => p.day >= r.from && p.day <= r.to);
  const stages = crm.STAGES;

  // Opportunity status / value: people added in the range, by stage.
  const byStage = stages.map((st) => {
    const list = inRange.filter((p) => p.stage === st);
    return { stage: st, count: list.length, value: list.reduce((n, p) => n + p.amount, 0) };
  });
  const won = byStage.find((s) => s.stage === WON);
  const lost = byStage.find((s) => s.stage === LOST);
  const open = byStage.filter((s) => s.stage !== WON && s.stage !== LOST);
  const decided = won.count + lost.count;

  // Funnel: how many reached each step or further (Not this year is left out).
  const steps = stages.filter((s) => s !== LOST);
  const funnel = steps.map((st, i) => ({ stage: st, count: inRange.filter((p) => p.stage !== LOST && steps.indexOf(p.stage) >= i).length }));

  // New people over time: by day for short ranges, by week for 90 days, by month for longer.
  const span = Math.round((new Date(`${r.to}T12:00`) - new Date(`${r.from}T12:00`)) / 864e5) + 1;
  const unit = span <= 31 ? 'day' : span <= 120 ? 'week' : 'month';
  const keyOf = (day) => {
    const d = new Date(`${day}T12:00`);
    if (unit === 'day') return day;
    if (unit === 'month') return day.slice(0, 7);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday of that week
    return ymd(d);
  };
  const buckets = new Map();
  for (let d = new Date(`${r.from}T12:00`); ymd(d) <= r.to; d.setDate(d.getDate() + 1)) buckets.set(keyOf(ymd(d)), 0);
  inRange.forEach((p) => buckets.set(keyOf(p.day), (buckets.get(keyOf(p.day)) || 0) + 1));
  const overTime = [...buckets].map(([key, count]) => ({ key, count }));

  const byGroup = [...inRange.reduce((m, p) => m.set(p.group_name, (m.get(p.group_name) || 0) + 1), new Map())]
    .map(([group, count]) => ({ group, count })).sort((a, b) => b.count - a.count);

  // Things that happened in the range.
  const cf = biz.filter(q.biz, 'c.group_name');
  const cand = cf.sql ? ` AND (${cf.sql})` : '';
  const fromIso = new Date(`${r.from}T00:00:00`).toISOString(), toIso = new Date(`${r.to}T23:59:59.999`).toISOString();
  const appts = db.prepare(`SELECT COUNT(*) AS n FROM crm_appointments a LEFT JOIN contacts c ON c.id=a.contact_id
    WHERE a.status='booked' AND a.starts_at BETWEEN ? AND ?${cand}`).get(fromIso, toIso, ...cf.args).n;
  const tasksDone = db.prepare(`SELECT COUNT(*) AS n FROM crm_tasks t LEFT JOIN contacts c ON c.id=t.contact_id
    WHERE t.done_at IS NOT NULL AND date(t.done_at, 'localtime') BETWEEN ? AND ?${cf.sql ? ` AND (t.contact_id IS NULL OR ${cf.sql})` : ''}`).get(r.from, r.to, ...cf.args).n;
  const ff = biz.filter(q.biz, 'f.group_name');
  const formsFilled = db.prepare(`SELECT COUNT(*) AS n FROM crm_form_entries e JOIN crm_forms f ON f.id=e.form_id
    WHERE date(e.created_at, 'localtime') BETWEEN ? AND ?${ff.sql ? ` AND ${ff.sql}` : ''}`).get(r.from, r.to, ...ff.args).n;

  // Coming up next (not tied to the range).
  const now = new Date().toISOString();
  const upcoming = db.prepare(`SELECT a.id, a.title, a.starts_at, c.name AS contact_name FROM crm_appointments a LEFT JOIN contacts c ON c.id=a.contact_id
    WHERE a.status='booked' AND a.ends_at >= ?${cand} ORDER BY a.starts_at LIMIT 5`).all(now, ...cf.args);
  const due = crm.listTasks({ open: true, biz: q.biz }).filter((t) => t.due_on && t.due_on <= ymd(new Date())).slice(0, 5);

  return {
    range: r, unit,
    totals: {
      newPeople: inRange.length, allPeople: people.length,
      openValue: open.reduce((n, s) => n + s.value, 0), openCount: open.reduce((n, s) => n + s.count, 0),
      wonValue: won.value, wonCount: won.count, lostCount: lost.count,
      winRate: decided ? Math.round((won.count / decided) * 100) : null,
      appointments: appts, tasksDone, formsFilled,
    },
    byStage, funnel, overTime, byGroup, upcoming, due,
  };
}

// Launchpad: each thing that makes the CRM work, and whether it's done yet.
function launchpad(q = {}) {
  let email = { ready: false }, cal = { connected: false }, site = { connected: false };
  try { email = require('./email').status(); } catch { /* not set up */ }
  try { cal = require('./gcal').status(); } catch { /* not set up */ }
  try { site = require('./website').status(); } catch { /* not set up */ }
  const bf = biz.filter(q.biz);
  const where = bf.sql ? `WHERE ${bf.sql}` : '';
  const count = (sql, ...a) => { try { return db.prepare(sql).get(...a).n; } catch { return 0; } };
  const people = count(`SELECT COUNT(*) AS n FROM contacts ${where}`, ...bf.args);
  const formsN = count(`SELECT COUNT(*) AS n FROM crm_forms ${where}`, ...bf.args);
  const pagesN = count(`SELECT COUNT(*) AS n FROM crm_booking_pages ${where}`, ...bf.args);
  const flows = count('SELECT COUNT(*) AS n FROM crm_automations WHERE active=1');
  const b = q.biz && q.biz !== 'all' ? biz.get(q.biz) : null;
  // A paying customer's copy (sign-up site) has no Terminal: email is set on the Account page,
  // and the Mac-only connections (Google Calendar feed, website inbox) are left out.
  const saas = Boolean(config.tenantKey);
  const items = [
      { key: 'phone', title: 'Phone alerts', done: Boolean(notify.topic()), text: 'Your phone buzzes when a new lead, form or booking comes in. Uses the free ntfy app.', phone: true },
      { key: 'email', title: 'Your email', done: Boolean(email.ready), text: email.ready ? `Sending from ${email.from || 'your mailbox'}.` : 'Lets the CRM send welcome emails and newsletters from your own email address.',
        ...(saas ? { href: '/account' } : { how: 'In Terminal on your Mac run: npm run email-setup' }) },
      ...(saas ? [] : [
        { key: 'calendar', title: 'Google Calendar bookings', done: Boolean(cal.connected), text: 'People who book a call on your Google booking page show up in Appointments and People.', how: 'In Terminal on your Mac run: npm run calendar' },
        { key: 'website', title: 'Website forms', done: Boolean(site.connected), text: 'Sign-ups from your website forms come in as new people by themselves.', how: 'In Terminal on your Mac run: npm run website' },
      ]),
      { key: 'business', title: 'Business details', done: Boolean(b ? (b.phone || b.email) : biz.all().some((x) => x.phone || x.email)), text: 'Your business name, phone, email, website and color.', go: '#contacts/settings' },
      { key: 'contact', title: 'Add your first person', done: people > 0, text: 'Add someone by hand, or bring in a spreadsheet.', go: '#contacts/people' },
      { key: 'form', title: 'Make a form', done: formsN > 0, text: 'A sign-up form you can share as a link or QR code.', go: '#contacts/forms' },
      { key: 'booking', title: 'Make a booking page', done: pagesN > 0, text: 'A link people use to book a call with you.', go: '#contacts/appointments' },
      { key: 'automation', title: 'Switch on an automation', done: flows > 0, text: 'Your helper that makes tasks and sends welcome emails by itself.', go: '#contacts/automations' },
  ];
  return { business: b, saas, items };
}

// Phone alerts without Terminal: makes this copy's private ntfy topic and sends a test.
async function phoneAlerts(test) {
  const topic = notify.createTopic();
  let sent = false;
  if (test) {
    sent = await notify.send('Viral Touch CRM', 'Phone alerts are working. You will get a buzz for new leads, forms and bookings.', { tags: 'tada' }).catch(() => false);
  }
  return { topic, sent, app: 'https://apps.apple.com/us/app/ntfy/id1625396347', android: 'https://play.google.com/store/apps/details?id=io.heckel.ntfy' };
}

const router = express.Router();
const wrap = (fn) => (req, res) => { try { res.json(fn(req.query)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/dashboard', wrap(dashboard));
router.get('/launchpad', wrap(launchpad));
router.post('/phone-alerts', async (req, res) => {
  try { res.json(await phoneAlerts(req.query.test === '1')); } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = { dashboard, launchpad, phoneAlerts, range, router };
