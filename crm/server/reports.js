// Monthly reports: one page per business with the month's numbers (new people, deals won,
// appointments, money paid, quotes signed, reviews, emails, form sign-ups) and the last six
// months side by side. Press "Email this report", or add an address and it goes out by
// itself on the 1st of every month (great for an agency client or a board).
const express = require('express');
const db = require('../../src/db');
const crm = require('./crm');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_wins (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  group_name TEXT,
  amount REAL,
  stage TEXT,
  won_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS crm_reports_sent (business_id INTEGER, month TEXT, sent_at TEXT, PRIMARY KEY (business_id, month));
`);
// Every time someone moves into a "won" step, note it (so "deals won this month" is exact).
crm.events.on('crm', (e) => {
  if (e.event !== 'stage_changed' || !e.contact) return;
  try {
    const pipes = require('./pipelines');
    if (pipes.kindOf(pipes.ofContact(e.contact), e.to) !== 'won') return;
    db.prepare('INSERT INTO crm_wins (contact_id, group_name, amount, stage, won_at) VALUES (?,?,?,?,?)').run(e.contact.id, e.contact.group_name, e.contact.amount || 0, e.to, new Date().toISOString());
  } catch (err) { console.error(`[reports] ${err.message}`); }
});

const businesses = () => require('./businesses');
const TZ = () => process.env.BOOKING_TIMEZONE || 'America/New_York';
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const money = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// Month "2026-11" -> [start, end) as ISO UTC, in the business timezone.
function range(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) throw err('Pick a month.');
  const { zoned } = require('./booking');
  const y = +m[1], mo = +m[2];
  const start = zoned(y, mo, 1, 0, 0, TZ()), end = zoned(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, 1, 0, 0, TZ());
  return [start.toISOString(), end.toISOString()];
}
const sqlTime = (iso) => iso.replace('T', ' ').slice(0, 19); // created_at columns use SQLite's "YYYY-MM-DD HH:MM:SS"
const thisMonth = (d = new Date()) => { const p = require('./booking').parts(d, TZ()); return `${p.y}-${String(p.m).padStart(2, '0')}`; };
const shift = (month, n) => { let [y, m] = month.split('-').map(Number); m += n; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return `${y}-${String(m).padStart(2, '0')}`; };
const label = (month) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const short = (month) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short' });

// The numbers for one business (or all) and one month.
function numbers(biz, month) {
  const [from, to] = range(month);
  const f = businesses().filter(biz, 'c.group_name');
  const and = f.sql ? ` AND ${f.sql}` : '';
  const one = (sql, ...args) => db.prepare(sql).get(...args, ...f.args) || {};
  const people = one(`SELECT COUNT(*) AS n FROM contacts c WHERE c.created_at >= ? AND c.created_at < ?${and}`, sqlTime(from), sqlTime(to)).n || 0;
  const wins = one(`SELECT COUNT(*) AS n, COALESCE(SUM(w.amount),0) AS v FROM crm_wins w JOIN contacts c ON c.id=w.contact_id WHERE w.won_at >= ? AND w.won_at < ?${and}`, from, to);
  const appts = one(`SELECT COUNT(*) AS n FROM crm_appointments a JOIN contacts c ON c.id=a.contact_id WHERE a.status='booked' AND a.starts_at >= ? AND a.starts_at < ?${and}`, from, to).n || 0;
  const paid = one(`SELECT COUNT(*) AS n, COALESCE(SUM(i.total),0) AS v FROM crm_invoices i JOIN contacts c ON c.id=i.contact_id WHERE i.status='paid' AND i.paid_at >= ? AND i.paid_at < ?${and}`, from, to);
  const quotes = (() => { try { return one(`SELECT COUNT(*) AS n, COALESCE(SUM(q.total),0) AS v FROM crm_quotes q JOIN contacts c ON c.id=q.contact_id WHERE q.status='accepted' AND q.signed_at >= ? AND q.signed_at < ?${and}`, from, to); } catch { return { n: 0, v: 0 }; } })();
  const reviews = one(`SELECT COUNT(*) AS n, COUNT(r.clicked_at) AS opened FROM crm_review_requests r JOIN contacts c ON c.id=r.contact_id WHERE r.sent_at >= ? AND r.sent_at < ?${and}`, from, to);
  const emails = one(`SELECT COUNT(*) AS n FROM crm_emails_sent e JOIN contacts c ON c.id=e.contact_id WHERE e.status='sent' AND e.sent_at >= ? AND e.sent_at < ?${and}`, sqlTime(from), sqlTime(to)).n || 0;
  const forms = one(`SELECT COUNT(*) AS n FROM crm_form_entries e JOIN contacts c ON c.id=e.contact_id WHERE e.created_at >= ? AND e.created_at < ?${and}`, sqlTime(from), sqlTime(to)).n || 0;
  return { people, won: wins.n || 0, wonValue: wins.v || 0, appointments: appts, paid: paid.v || 0, paidCount: paid.n || 0, quotesSigned: quotes.n || 0, quotesValue: quotes.v || 0,
    reviewsAsked: reviews.n || 0, reviewsOpened: reviews.opened || 0, emails, forms };
}

function report(biz, month = thisMonth()) {
  const now = numbers(biz, month), before = numbers(biz, shift(month, -1));
  const months = Array.from({ length: 6 }, (_, i) => shift(month, i - 5));
  const series = months.map((m) => { const n = m === month ? now : numbers(biz, m); return { month: m, label: short(m), people: n.people, paid: n.paid, won: n.won }; });
  const f = businesses().filter(biz, 'c.group_name');
  const unpaid = db.prepare(`SELECT COALESCE(SUM(i.total),0) AS v FROM crm_invoices i JOIN contacts c ON c.id=i.contact_id WHERE i.status='sent'${f.sql ? ` AND ${f.sql}` : ''}`).get(...f.args).v;
  const b = biz && biz !== 'all' ? businesses().get(biz) : null;
  return { month, label: label(month), business: b ? { id: b.id, name: b.name, color: b.color, report_email: b.report_email || '' } : null,
    numbers: now, before, series, unpaidNow: unpaid, isCurrent: month === thisMonth() };
}

// The report as a plain email (easy to read on a phone, and nothing to break).
function asText(r) {
  const n = r.numbers, p = r.before;
  const ch = (a, b) => (b === a ? '' : ` (${a > b ? 'up' : 'down'} from ${b})`);
  const chm = (a, b) => (Math.round(b) === Math.round(a) ? '' : ` (${a > b ? 'up' : 'down'} from ${money(b)})`);
  return [`${r.business ? r.business.name : 'All businesses'}: ${r.label}${r.isCurrent ? ' so far' : ''}`, '',
    `New people: ${n.people}${ch(n.people, p.people)}`,
    `Deals won: ${n.won}${n.wonValue ? `, worth ${money(n.wonValue)}` : ''}${ch(n.won, p.won)}`,
    `Money paid: ${money(n.paid)}${chm(n.paid, p.paid)}`,
    `Still waiting to be paid: ${money(r.unpaidNow)}`,
    `Quotes signed: ${n.quotesSigned}${n.quotesValue ? `, worth ${money(n.quotesValue)}` : ''}`,
    `Appointments: ${n.appointments}${ch(n.appointments, p.appointments)}`,
    `Form sign-ups: ${n.forms}`,
    `Review requests: ${n.reviewsAsked} sent, ${n.reviewsOpened} opened`,
    `Emails sent: ${n.emails}`, '',
    'Last 6 months (new people / money paid):',
    ...r.series.map((s) => `  ${s.label}: ${s.people} / ${money(s.paid)}`)].join('\n');
}
async function emailReport(biz, month, to, opts = {}) {
  const email = require('./email');
  to = String(to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw err('Add the email address to send it to.');
  const r = report(biz, month);
  await email.sendDirect({ to, subject: `${r.business ? r.business.name : 'Your'} report: ${r.label}`, text: asText(r) }, opts);
  return { ok: true, to };
}
// The 1st of each month: last month's report to every business that has a report address.
async function sendMonthly(now = new Date(), opts = {}) {
  const month = shift(thisMonth(now), -1);
  let n = 0;
  for (const b of businesses().all().filter((x) => x.report_email)) {
    if (db.prepare('SELECT 1 FROM crm_reports_sent WHERE business_id=? AND month=?').get(b.id, month)) continue;
    try {
      await emailReport(b.id, month, b.report_email, opts);
      db.prepare('INSERT INTO crm_reports_sent (business_id, month, sent_at) VALUES (?,?,?)').run(b.id, month, new Date().toISOString());
      n++;
    } catch (e) { console.error(`[reports] ${b.name}: ${e.message}`); }
  }
  return n;
}
function setReportEmail(biz, address) {
  const b = businesses().get(biz);
  if (!b) throw err('Pick one business first (top of the menu).');
  const v = String(address || '').trim();
  if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw err('That email address does not look right.');
  db.prepare('UPDATE crm_businesses SET report_email=? WHERE id=?').run(v || null, b.id);
  return { ok: true, report_email: v };
}

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req) => report(req.query.biz, req.query.month || thisMonth())));
router.post('/email', wrap((req) => emailReport(req.query.biz, (req.body || {}).month || thisMonth(), (req.body || {}).to)));
router.put('/settings', wrap((req) => setReportEmail(req.query.biz, (req.body || {}).report_email)));

module.exports = { numbers, report, asText, emailReport, sendMonthly, setReportEmail, router, thisMonth, shift };
