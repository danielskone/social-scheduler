// Referral partners. Give a customer or a partner their own link. When someone opens it,
// we remember who sent them (for 60 days). When that person pays an invoice, the partner
// earns the percent you set. You pay partners yourself (cash, Zelle...) and mark it paid.
// Partners see their link and what they earned in their customer portal.
const express = require('express');
const crypto = require('crypto');
const db = require('../../src/db');
const config = require('../../src/config');
const notify = require('../../src/notify');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_referrers (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL UNIQUE REFERENCES contacts(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  percent REAL NOT NULL DEFAULT 10,
  clicks INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_referrals (
  id INTEGER PRIMARY KEY,
  referrer_id INTEGER NOT NULL REFERENCES crm_referrers(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  invoice_id INTEGER UNIQUE,           -- empty = they signed up (no sale yet)
  amount REAL NOT NULL DEFAULT 0,
  commission REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'signed_up', -- signed_up, owed, paid
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);
CREATE TABLE IF NOT EXISTS crm_ref_settings (key TEXT PRIMARY KEY, value TEXT);
`);
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const round = (n) => Math.round(Number(n) * 100) / 100;
const money = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const crm = () => require('./crm');
const getSet = (k) => (db.prepare('SELECT value FROM crm_ref_settings WHERE key=?').get(k) || {}).value || '';
const setSet = (k, v) => db.prepare('INSERT INTO crm_ref_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v ?? ''));

// Where partner links land: a Sites page, a Buy now page or a course page (a path like /s/my-page).
function settings() {
  const landing = getSet('landing');
  return { landing, landingUrl: `${config.publicBaseUrl}${landing || '/portal'}`, percent: Number(getSet('percent') || 10), choices: landingChoices() };
}
function landingChoices() {
  const out = [];
  db.prepare('SELECT title, slug FROM crm_sites WHERE published=1 ORDER BY id DESC').all().forEach((s) => out.push({ path: `/s/${s.slug}`, name: `Page: ${s.title}` }));
  try { db.prepare('SELECT name, token FROM crm_products WHERE active=1 ORDER BY name').all().forEach((p) => out.push({ path: `/pay/${p.token}`, name: `Buy now: ${p.name}` })); } catch {}
  try { db.prepare('SELECT title, slug FROM crm_courses WHERE active=1 ORDER BY id DESC').all().forEach((c) => out.push({ path: `/learn/${c.slug}`, name: `Course: ${c.title}` })); } catch {}
  return out;
}
function saveSettings(body = {}) {
  if ('landing' in body) {
    const ok = !body.landing || landingChoices().some((c) => c.path === body.landing);
    if (!ok) throw err('Pick a page from the list.');
    setSet('landing', body.landing || '');
  }
  if ('percent' in body) {
    const p = Number(body.percent);
    if (!Number.isFinite(p) || p < 0 || p > 90) throw err('Use a percent from 0 to 90.');
    setSet('percent', round(p));
  }
  return settings();
}
const linkFor = (r) => { const s = settings(); return `${s.landingUrl}${s.landingUrl.includes('?') ? '&' : '?'}ref=${r.code}`; };

function stats(r) {
  const rows = db.prepare('SELECT * FROM crm_referrals WHERE referrer_id=?').all(r.id);
  const people = new Set(rows.map((x) => x.contact_id));
  const sales = rows.filter((x) => x.invoice_id);
  return { people: people.size, sales: sales.length, sold: round(sales.reduce((n, x) => n + x.amount, 0)),
    owed: round(sales.filter((x) => x.status === 'owed').reduce((n, x) => n + x.commission, 0)),
    paid: round(sales.filter((x) => x.status === 'paid').reduce((n, x) => n + x.commission, 0)) };
}
function list(biz) {
  const f = require('./businesses').filter(biz, 'c.group_name');
  return db.prepare(`SELECT r.*, c.name, c.email FROM crm_referrers r JOIN contacts c ON c.id=r.contact_id ${f.sql ? `WHERE ${f.sql}` : ''} ORDER BY r.id DESC`).all(...f.args)
    .map((r) => ({ ...r, active: Boolean(r.active), link: linkFor(r), ...stats(r) }));
}
function makeCode(name) {
  const base = String(name || 'friend').split(/\s+/)[0].toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'FRIEND';
  let code = base, n = 0;
  while (db.prepare('SELECT 1 FROM crm_referrers WHERE code=?').get(code)) code = `${base}${crypto.randomInt(10, 99)}${n++ > 5 ? crypto.randomInt(10, 99) : ''}`;
  return code;
}
function add(contactId, body = {}) {
  const c = crm().getContact(Number(contactId));
  if (!c) throw err('Person not found', 404);
  const old = db.prepare('SELECT * FROM crm_referrers WHERE contact_id=?').get(c.id);
  if (old) return update(old.id, { ...body, active: true });
  const pct = body.percent === undefined || body.percent === '' ? settings().percent : Number(body.percent);
  if (!Number.isFinite(pct) || pct < 0 || pct > 90) throw err('Use a percent from 0 to 90.');
  const id = db.prepare('INSERT INTO crm_referrers (contact_id, code, percent) VALUES (?,?,?)').run(c.id, makeCode(c.name), round(pct)).lastInsertRowid;
  crm().logActivity(c.id, { kind: 'Note', note: `Became a referral partner (${round(pct)}% of each sale)` });
  return one(id);
}
function one(id) { const r = list().find((x) => x.id === Number(id)); if (!r) throw err('Partner not found', 404); return r; }
function update(id, body = {}) {
  const r = db.prepare('SELECT * FROM crm_referrers WHERE id=?').get(Number(id));
  if (!r) throw err('Partner not found', 404);
  let code = r.code;
  if (body.code !== undefined) {
    code = String(body.code).trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,20}$/.test(code)) throw err('Use 3 to 20 letters or numbers for the code.');
    if (db.prepare('SELECT 1 FROM crm_referrers WHERE code=? AND id<>?').get(code, r.id)) throw err('Another partner has that code.');
  }
  const pct = body.percent === undefined || body.percent === '' ? r.percent : Number(body.percent);
  if (!Number.isFinite(pct) || pct < 0 || pct > 90) throw err('Use a percent from 0 to 90.');
  db.prepare('UPDATE crm_referrers SET code=?, percent=?, active=? WHERE id=?').run(code, round(pct), 'active' in body ? (body.active ? 1 : 0) : r.active, r.id);
  return one(r.id);
}
function remove(id) { db.prepare('DELETE FROM crm_referrers WHERE id=?').run(Number(id)); return { ok: true }; }
function markPaid(id) {
  const r = one(id);
  const n = db.prepare("UPDATE crm_referrals SET status='paid', paid_at=? WHERE referrer_id=? AND status='owed'").run(new Date().toISOString(), r.id).changes;
  if (n) crm().logActivity(r.contact_id, { kind: 'Payment', note: `You paid their referral earnings: ${money(r.owed)}` });
  return one(r.id);
}
function sales(id) {
  return db.prepare(`SELECT x.*, c.name FROM crm_referrals x JOIN contacts c ON c.id=x.contact_id WHERE x.referrer_id=? ORDER BY x.id DESC LIMIT 200`).all(Number(id));
}

// ---------- Tracking ----------
const byCode = (code) => (code && /^[A-Za-z0-9_-]{3,20}$/.test(code) ? db.prepare('SELECT * FROM crm_referrers WHERE code=? AND active=1').get(String(code)) : null);
// Runs before the public pages: remembers ?ref=CODE in a cookie for 60 days.
function catcher(req, res, next) {
  const code = req.query && req.query.ref;
  if (code && req.method === 'GET') {
    const r = byCode(String(code));
    if (r) {
      db.prepare('UPDATE crm_referrers SET clicks=clicks+1 WHERE id=?').run(r.id);
      res.cookie('vt_ref', r.code, { maxAge: 60 * 864e5, sameSite: 'lax', httpOnly: true, path: '/' });
    }
  }
  next();
}
const fromReq = (req) => { const m = String(req.headers.cookie || '').match(/(?:^|;\s*)vt_ref=([A-Za-z0-9_-]{3,20})/); return m ? m[1] : null; };
// Connects a new buyer or member to the partner who sent them (first partner wins).
function attach(contact, code) {
  const r = byCode(code);
  if (!r || !contact || r.contact_id === contact.id) return null;
  if (db.prepare('SELECT 1 FROM crm_referrals WHERE contact_id=?').get(contact.id)) return null;
  db.prepare('INSERT INTO crm_referrals (referrer_id, contact_id) VALUES (?,?)').run(r.id, contact.id);
  const p = crm().getContact(r.contact_id);
  crm().logActivity(contact.id, { kind: 'Note', note: `Sent by referral partner ${p ? p.name : r.code}` });
  return r;
}
// Called when an invoice is paid: the partner who sent this person earns their percent.
function onPaid(inv) {
  if (!inv || !inv.contact_id || !inv.total) return;
  const first = db.prepare('SELECT * FROM crm_referrals WHERE contact_id=? ORDER BY id LIMIT 1').get(inv.contact_id);
  if (!first) return;
  const r = db.prepare('SELECT * FROM crm_referrers WHERE id=?').get(first.referrer_id);
  if (!r) return;
  const commission = round(inv.total * (r.percent / 100));
  const done = db.prepare("INSERT OR IGNORE INTO crm_referrals (referrer_id, contact_id, invoice_id, amount, commission, status) VALUES (?,?,?,?,?,'owed')")
    .run(r.id, inv.contact_id, inv.id, inv.total, commission).changes;
  if (!done) return;
  const p = crm().getContact(r.contact_id), buyer = crm().getContact(inv.contact_id);
  if (p) crm().logActivity(p.id, { kind: 'Payment', note: `Earned ${money(commission)} from ${buyer ? buyer.name : 'a referral'} (${money(inv.total)} sale)` });
  notify.send('Referral sale', `${p ? p.name : r.code} sent ${buyer ? buyer.name : 'someone'} who paid ${money(inv.total)}. You owe them ${money(commission)}.`, { tags: 'handshake' }).catch(() => {});
}
// What a partner sees in their portal.
function forContact(contactId) {
  const r = db.prepare('SELECT * FROM crm_referrers WHERE contact_id=? AND active=1').get(Number(contactId));
  return r ? { ...r, link: linkFor(r), ...stats(r) } : null;
}

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req) => ({ partners: list(req.query.biz), settings: settings() })));
router.put('/settings', wrap((req) => saveSettings(req.body || {})));
router.post('/', wrap((req) => add((req.body || {}).contact_id, req.body || {})));
router.put('/:id', wrap((req) => update(req.params.id, req.body || {})));
router.delete('/:id', wrap((req) => remove(req.params.id)));
router.post('/:id/paid', wrap((req) => markPaid(req.params.id)));
router.get('/:id/sales', wrap((req) => ({ sales: sales(req.params.id) })));

module.exports = { settings, saveSettings, list, add, update, remove, markPaid, sales, catcher, fromReq, attach, onPaid, forContact, router };
