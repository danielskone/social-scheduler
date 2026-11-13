// Loyalty points. When it is on, people earn points for every dollar they pay you (invoices,
// Buy now, tickets, plans). When they have enough, they press a button in their customer
// portal and the points turn into a gift card. You can add or take away points by hand.
const express = require('express');
const db = require('../../src/db');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_points (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  points INTEGER NOT NULL,              -- earned (+) or spent (-)
  note TEXT,
  invoice_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS crm_points_contact ON crm_points(contact_id);
CREATE TABLE IF NOT EXISTS crm_loyalty_settings (key TEXT PRIMARY KEY, value TEXT);
`);
const crm = () => require('./crm');
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const money = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const getSet = (k, d = '') => db.prepare('SELECT value FROM crm_loyalty_settings WHERE key=?').get(k)?.value ?? d;
const setSet = (k, v) => db.prepare('INSERT INTO crm_loyalty_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));

function settings() {
  return { on: getSet('on', '0') === '1', per_dollar: Number(getSet('per_dollar', '1')), reward_points: Number(getSet('reward_points', '100')), reward_value: Number(getSet('reward_value', '5')),
    welcome: Number(getSet('welcome', '0')) };
}
function saveSettings(body = {}) {
  if ('on' in body) setSet('on', body.on ? '1' : '0');
  const num = (k, lo, hi, msg) => { if (!(k in body)) return; const n = Number(body[k]); if (!Number.isFinite(n) || n < lo || n > hi) throw err(msg); setSet(k, Math.round(n * 100) / 100); };
  num('per_dollar', 0.1, 100, 'Points for each $1: use a number from 0.1 to 100.');
  num('reward_points', 10, 100000, 'Points needed: use a number from 10 to 100,000.');
  num('reward_value', 1, 1000, 'The reward is a gift card from $1 to $1,000.');
  num('welcome', 0, 10000, 'Welcome points: use a number from 0 to 10,000.');
  setSet('reward_points', Math.round(Number(getSet('reward_points', '100'))));
  return settings();
}
const balance = (contactId) => db.prepare('SELECT COALESCE(SUM(points),0) AS n FROM crm_points WHERE contact_id=?').get(Number(contactId)).n;
function add(contactId, points, note, invoiceId = null) {
  points = Math.round(Number(points));
  if (!Number.isFinite(points) || !points) throw err('Type how many points, like 50 or -50.');
  if (!db.prepare('SELECT 1 FROM contacts WHERE id=?').get(Number(contactId))) throw err('Contact not found', 404);
  if (points < 0 && balance(contactId) + points < 0) throw err(`They only have ${balance(contactId)} points.`);
  db.prepare('INSERT INTO crm_points (contact_id, points, note, invoice_id) VALUES (?,?,?,?)').run(Number(contactId), points, String(note || '').trim().slice(0, 200) || null, invoiceId);
  return balance(contactId);
}
// Called when any invoice is paid: points for the money they paid (not the part a gift card paid,
// and nothing for buying a gift card, so points can't grow by going around in a circle).
function onPaid(inv) {
  const s = settings();
  if (!s.on || !inv || !inv.contact_id) return;
  if (db.prepare('SELECT 1 FROM crm_points WHERE invoice_id=?').get(inv.id)) return;
  if (db.prepare('SELECT 1 FROM crm_gift_cards WHERE invoice_id=?').get(inv.id)) return;
  const paid = Math.max(0, Number(inv.total || 0) - Number(inv.gift_paid || 0));
  if (/^(Gift card|Coupon)$/.test(inv.paid_how || '')) return;
  const pts = Math.floor(paid * s.per_dollar);
  if (pts <= 0) return;
  if (s.welcome && !db.prepare('SELECT 1 FROM crm_points WHERE contact_id=?').get(inv.contact_id)) add(inv.contact_id, s.welcome, 'Welcome bonus');
  add(inv.contact_id, pts, `Paid invoice #${inv.number}`, inv.id);
}
function status(contactId) {
  const s = settings(), have = balance(contactId);
  return { on: s.on, points: have, need: s.reward_points, value: s.reward_value, can: s.on && have >= s.reward_points, toGo: Math.max(0, s.reward_points - have) };
}
// Turns points into a gift card (from the portal, or by you from the CRM).
async function redeem(contactId) {
  const st = status(contactId);
  if (!st.on) throw err('Points are not on right now.');
  if (!st.can) throw err(`You need ${st.toGo} more points for a reward.`);
  add(contactId, -st.need, `Turned into a ${money(st.value)} gift card`);
  try { return await require('./giftcards').give({ contact_id: contactId, amount: st.value, source: 'points' }); }
  catch (e) { add(contactId, st.need, 'Points put back (the gift card could not be made)'); throw e; }
}
function overview(biz) {
  const people = db.prepare(`SELECT c.id, c.name, c.email, c.group_name, SUM(p.points) AS points, MAX(p.created_at) AS last FROM crm_points p JOIN contacts c ON c.id=p.contact_id
    GROUP BY c.id HAVING SUM(p.points) <> 0 OR COUNT(*) > 0 ORDER BY points DESC, c.name LIMIT 500`).all();
  const b = biz && biz !== 'all' ? require('./businesses').get(biz) : null;
  const rows = b ? people.filter((p) => b.groups.includes(p.group_name)) : people;
  const s = settings();
  return { settings: s, people: rows.map((p) => ({ ...p, ready: s.on && p.points >= s.reward_points })), totals: { members: rows.length, points: rows.reduce((n, p) => n + p.points, 0), ready: rows.filter((p) => s.on && p.points >= s.reward_points).length,
    rewarded: db.prepare("SELECT COUNT(*) AS n FROM crm_gift_cards WHERE source='points'").get().n } };
}
const history = (contactId) => db.prepare('SELECT * FROM crm_points WHERE contact_id=? ORDER BY id DESC LIMIT 100').all(Number(contactId));

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req) => overview(req.query.biz)));
router.put('/settings', wrap((req) => saveSettings(req.body || {})));
router.get('/contacts/:id', wrap((req) => ({ ...status(req.params.id), history: history(req.params.id) })));
router.post('/contacts/:id', wrap((req) => { const b = req.body || {}; const n = add(req.params.id, b.points, b.note || 'Changed by hand'); crm().logActivity(Number(req.params.id), { kind: 'Note', note: `${Number(b.points) > 0 ? 'Added' : 'Took away'} ${Math.abs(Math.round(Number(b.points)))} points${b.note ? `: ${b.note}` : ''}` }); return { points: n }; }));
router.post('/contacts/:id/redeem', wrap((req) => redeem(req.params.id)));

module.exports = { settings, saveSettings, balance, add, onPaid, status, redeem, overview, history, router };
