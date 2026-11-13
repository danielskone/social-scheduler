// Activity history: who on the team changed what, and when (admins and the owner can read it).
// Every change made in the CRM (adding, editing, deleting, sending) is written down in plain words.
// Kept for 180 days.
const express = require('express');
const db = require('../../src/db');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_audit (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  who TEXT NOT NULL,                       -- the person's name, or "Owner"
  member_id INTEGER,                       -- team member id (empty = the owner)
  action TEXT NOT NULL,                    -- plain words, like "Added a person"
  detail TEXT,                             -- the name or title it was about
  method TEXT, path TEXT
);
CREATE INDEX IF NOT EXISTS crm_audit_at ON crm_audit(at);
`);

// Plain words for each kind of change. The first match wins.
const NOUNS = [
  [/^\/contacts\/\d+\/merge|^\/duplicates\/merge/, 'Merged duplicate people'], [/^\/duplicates/, 'Duplicates'],
  [/^\/contacts\/import/, 'Imported people'], [/^\/contacts\/\d+\/activities/, 'a note'], [/^\/contacts/, 'a person'],
  [/^\/lists\/bulk\/(\w+)/, (m) => `Bulk action: ${m[1].replace(/_/g, ' ')}`], [/^\/lists/, 'a smart list'],
  [/^\/tasks/, 'a task'], [/^\/taskboard/, 'task settings'], [/^\/pipelines/, 'a pipeline'], [/^\/businesses/, 'a business'],
  [/^\/booking\/appointments/, 'an appointment'], [/^\/booking\/pages/, 'a booking page'], [/^\/booking\/time-off/, 'time off'],
  [/^\/invoices\/\d+\/send/, 'Sent an invoice'], [/^\/invoices\/\d+\/paid/, 'Marked an invoice paid'], [/^\/invoices/, 'an invoice'],
  [/^\/quotes/, 'a quote'], [/^\/contracts/, 'a contract'], [/^\/products/, 'a product'], [/^\/coupons/, 'a coupon'], [/^\/plans/, 'a monthly plan'],
  [/^\/giftcards/, 'a gift card'], [/^\/loyalty/, 'points'], [/^\/referrals/, 'a referral partner'],
  [/^\/inbox\/\d+\/reply|^\/chat\/\d+\/reply|^\/social\/\d+\/reply/, 'Answered a message'], [/^\/chat\/faq/, 'an answer bot question'], [/^\/chat/, 'chat settings'],
  [/^\/social/, 'Facebook and Instagram settings'], [/^\/email\/campaigns\/\d+\/send|^\/campaigns\/\d+\/send/, 'Sent an email campaign'], [/^\/email|^\/campaigns/, 'email'],
  [/^\/templates/, 'a message template'], [/^\/automations/, 'an automation'], [/^\/forms/, 'a form'], [/^\/fields/, 'a custom field'],
  [/^\/sites/, 'a web page'], [/^\/funnels/, 'a funnel'], [/^\/blog/, 'a blog post'], [/^\/courses/, 'a course'], [/^\/community/, 'a community post'],
  [/^\/events/, 'an event'], [/^\/reviews/, 'a review request'], [/^\/reports/, 'report settings'], [/^\/team/, 'a team member'],
  [/^\/biztemplates\/apply/, 'Started a business from a template'], [/^\/biztemplates/, 'a business template'],
  [/^\/backups\/[^/]+\/restore/, 'Put back a backup'], [/^\/backups/, 'a backup'], [/^\/portal/, 'a portal link'],
];
const VERB = { POST: 'Added', PUT: 'Changed', PATCH: 'Changed', DELETE: 'Deleted' };
function describe(method, p) {
  for (const [re, what] of NOUNS) {
    const m = re.exec(p);
    if (!m) continue;
    if (typeof what === 'function') return what(m);
    if (/^[A-Z]/.test(what)) return what; // already a whole sentence
    return `${VERB[method] || 'Changed'} ${what}`;
  }
  return `${VERB[method] || 'Changed'} something (${p.split('/')[1] || 'CRM'})`;
}
const detailOf = (b) => {
  if (!b || typeof b !== 'object' || Buffer.isBuffer(b)) return null;
  const v = b.name || b.title || b.subject || b.question || b.text || b.note || null;
  return v ? String(v).replace(/\s+/g, ' ').slice(0, 120) : null;
};
// Paths that are not really changes (checking for mail, previews, tests).
const SKIP = /^\/(inbox\/check|social\/check|chat\/faq-test|automations\/preview|automations\/describe|email\/preview|.*\/preview)/;

// Mounted on /api/crm: writes one line after every change that worked.
function middleware(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || SKIP.test(req.path)) return next();
  const at = req.path; // read now: inner routers change req.path while they run
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    try {
      db.prepare('INSERT INTO crm_audit (who, member_id, action, detail, method, path) VALUES (?,?,?,?,?,?)')
        .run(req.team ? req.team.name : 'Owner', req.team ? req.team.id : null, describe(req.method, at), detailOf(req.body), req.method, at.slice(0, 200));
    } catch (e) { console.error('[audit]', e.message); }
  });
  next();
}

function list({ who, q, before, limit } = {}) {
  const where = [], args = [];
  if (who === 'owner') where.push('member_id IS NULL'); else if (who) { where.push('member_id=?'); args.push(Number(who)); }
  if (q) { where.push('(action LIKE ? OR detail LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  if (before) { where.push('id < ?'); args.push(Number(before)); }
  const n = Math.min(Number(limit) || 100, 500);
  const rows = db.prepare(`SELECT id, at, who, member_id, action, detail FROM crm_audit${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`).all(...args, n);
  const people = db.prepare('SELECT DISTINCT who, member_id FROM crm_audit ORDER BY who').all();
  return { rows, people, more: rows.length === n };
}
function prune() { return db.prepare("DELETE FROM crm_audit WHERE at < datetime('now', '-180 days')").run().changes; }

const router = express.Router();
router.get('/', (req, res) => res.json(list(req.query)));

module.exports = { middleware, list, describe, prune, router };
