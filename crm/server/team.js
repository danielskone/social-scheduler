// Team logins: helpers who sign in to Viral Touch CRM with their own email and password.
//  - "Admin" can do everything.
//  - "Helper" can work with people, tasks, emails and invoices, but can't change the team,
//    payment settings or businesses, and can't delete people. A helper can be limited to
//    some businesses (for example only the Christmas Parade).
// A team login only opens the CRM, never Viral Post or Viral Clips. On the sign-up site
// (customer copies) teams are managed on the Account page instead (see src/saas).
const express = require('express');
const crypto = require('crypto');
const db = require('../../src/db');
const { hashPassword, checkPassword } = require('../../src/saas/store');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_team (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'helper',     -- admin or helper
  businesses TEXT NOT NULL DEFAULT '[]',   -- JSON business ids; empty = all
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS crm_team_state (key TEXT PRIMARY KEY, value TEXT);
`);
function secret() {
  let s = db.prepare("SELECT value FROM crm_team_state WHERE key='secret'").get()?.value;
  if (!s) { s = crypto.randomBytes(32).toString('hex'); db.prepare("INSERT OR REPLACE INTO crm_team_state (key, value) VALUES ('secret', ?)").run(s); }
  return s;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const parse = (m) => (m ? { ...m, businesses: (() => { try { return JSON.parse(m.businesses) || []; } catch { return []; } })() } : null);
const pub = (m) => { if (!m) return null; const { password_hash: _ph, ...rest } = m; return rest; };
const all = () => db.prepare('SELECT * FROM crm_team ORDER BY name COLLATE NOCASE').all().map(parse);
const get = (id) => parse(db.prepare('SELECT * FROM crm_team WHERE id=?').get(Number(id)));

function save(body = {}, id) {
  const old = id ? get(id) : null;
  if (id && !old) throw err('Team member not found', 404);
  const name = String(body.name ?? old?.name ?? '').trim().slice(0, 80);
  const email = String(body.email ?? old?.email ?? '').trim().toLowerCase();
  if (!name) throw err('Add their name.');
  if (!EMAIL_RE.test(email)) throw err('That email address does not look right.');
  const role = ['admin', 'helper'].includes(body.role) ? body.role : (old ? old.role : 'helper');
  const bizIds = Array.isArray(body.businesses) ? [...new Set(body.businesses.map(Number).filter(Boolean))] : (old ? old.businesses : []);
  const pw = body.password == null ? '' : String(body.password);
  if (!old && pw.length < 8) throw err('Give them a password with at least 8 characters.');
  if (pw && pw.length < 8) throw err('Use a password with at least 8 characters.');
  const clash = db.prepare('SELECT id FROM crm_team WHERE email=? AND id != ?').get(email, old ? old.id : 0);
  if (clash) throw err('Someone on the team already uses that email.');
  if (old) {
    db.prepare('UPDATE crm_team SET name=?, email=?, role=?, businesses=? WHERE id=?').run(name, email, role, JSON.stringify(role === 'admin' ? [] : bizIds), old.id);
    if (pw) db.prepare('UPDATE crm_team SET password_hash=? WHERE id=?').run(hashPassword(pw), old.id);
    return pub(get(old.id));
  }
  const r = db.prepare('INSERT INTO crm_team (name, email, password_hash, role, businesses) VALUES (?,?,?,?,?)').run(name, email, hashPassword(pw), role, JSON.stringify(role === 'admin' ? [] : bizIds));
  return pub(get(r.lastInsertRowid));
}
function remove(id) { db.prepare('DELETE FROM crm_team WHERE id=?').run(Number(id)); return { ok: true }; }

// ---------- Signing in ----------
// The cookie names the member and is signed; changing their password or removing them ends it.
const sign = (m) => crypto.createHmac('sha256', secret()).update(`${m.id}:${m.password_hash.slice(-24)}`).digest('base64url');
function login(email, password) {
  const m = parse(db.prepare('SELECT * FROM crm_team WHERE email=?').get(String(email || '').trim()));
  if (!m || !checkPassword(String(password || ''), m.password_hash)) return null;
  db.prepare("UPDATE crm_team SET last_login_at=datetime('now') WHERE id=?").run(m.id);
  return { member: pub(m), cookie: `${m.id}.${sign(m)}` };
}
function fromCookie(value) {
  const [id, sig] = String(value || '').split('.');
  const m = id && sig ? parse(db.prepare('SELECT * FROM crm_team WHERE id=?').get(Number(id))) : null;
  if (!m) return null;
  const want = Buffer.from(sign(m)), got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got) ? pub(m) : null;
}

// What a helper may not do (admins and the owner can do everything).
const ADMIN_ONLY = [
  [/^\/api\/crm\/team/, null],
  [/^\/api\/crm\/invoices\/settings/, 'PUT'],
  [/^\/api\/crm\/businesses/, 'POST|PUT|DELETE'],
  [/^\/api\/crm\/contacts\/\d+$/, 'DELETE'],
  [/^\/api\/crm\/fields/, 'POST|PUT|DELETE'],
  [/^\/api\/crm\/pipelines/, 'POST|PUT|DELETE'],
  [/^\/api\/crm\/reports\/settings/, 'PUT'],
  [/^\/api\/crm\/chat\/settings/, 'PUT'],
  [/^\/api\/crm\/products\/\d+$/, 'DELETE'],
  [/^\/api\/crm\/courses\/\d+$/, 'DELETE'],
  [/^\/api\/crm\/sites\/\d+$/, 'DELETE'],
];
function allowed(member, req) {
  if (!member || member.role === 'admin') return true;
  return !ADMIN_ONLY.some(([re, methods]) => re.test(req.path) && (!methods || new RegExp(`^(${methods})$`).test(req.method)));
}
// A helper limited to some businesses only ever sees those: ?biz= is forced to one of them.
function limitBusinesses(member, req) {
  if (!member || member.role === 'admin' || !member.businesses.length) return;
  const u = new URL(req.url, 'http://x');
  const want = Number(u.searchParams.get('biz'));
  if (!member.businesses.includes(want)) { u.searchParams.set('biz', String(member.businesses[0])); req.url = u.pathname + u.search; }
}

const router = express.Router();
const wrap = (fn) => (req, res) => { try { res.json(fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap(() => all().map(pub)));
router.post('/', wrap((req) => save(req.body || {})));
router.put('/:id', wrap((req) => save(req.body || {}, Number(req.params.id))));
router.delete('/:id', wrap((req) => remove(req.params.id)));
// Who is signed in (the page hides what a helper can't use).
const me = express.Router();
me.get('/', (req, res) => res.json({ customerCopy: Boolean(require('../../src/config').tenantKey), ...(req.team ? { team: true, ...req.team } : { team: false, role: 'owner', name: null }) }));

module.exports = { all, get, save, remove, login, fromCookie, allowed, limitBusinesses, router, me };
