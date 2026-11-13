// Coupon codes for Buy now links and paid courses: a percent or a dollar amount off,
// with an end date and a limit on how many times it can be used.
const express = require('express');
const db = require('../../src/db');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_coupons (
  id INTEGER PRIMARY KEY,
  business_id INTEGER,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  percent REAL,                        -- 20 = 20% off
  amount REAL,                         -- or 10 = $10 off
  applies TEXT NOT NULL DEFAULT 'all', -- all, products, courses
  max_uses INTEGER,                    -- empty = no limit
  uses INTEGER NOT NULL DEFAULT 0,
  ends_on TEXT,                        -- YYYY-MM-DD, last day it works
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const round = (n) => Math.round(Number(n) * 100) / 100;
const money = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const get = (id) => db.prepare('SELECT * FROM crm_coupons WHERE id=?').get(Number(id));
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: process.env.BOOKING_TIMEZONE || 'America/New_York' });
const label = (c) => (c.percent ? `${c.percent}% off` : `${money(c.amount)} off`);
const shape = (c) => c && { ...c, active: Boolean(c.active), label: label(c), state: !c.active ? 'off' : c.ends_on && c.ends_on < today() ? 'ended' : c.max_uses && c.uses >= c.max_uses ? 'used up' : 'live' };

function list(biz) {
  return db.prepare('SELECT * FROM crm_coupons ORDER BY id DESC').all()
    .filter((c) => !biz || biz === 'all' || !c.business_id || c.business_id === Number(biz)).map(shape);
}
const anyLive = (kind) => list().some((c) => c.state === 'live' && (c.applies === 'all' || c.applies === kind));
function save(body = {}, id, biz) {
  const old = id ? get(id) : null;
  if (id && !old) throw err('Coupon not found', 404);
  const code = String(body.code ?? old?.code ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw err('Use 3 to 30 letters or numbers for the code, like SAVE20.');
  const clash = db.prepare('SELECT id FROM crm_coupons WHERE code=? AND id<>?').get(code, old ? old.id : 0);
  if (clash) throw err('You already have a coupon with that code.');
  const kind = body.kind || (old && old.amount ? 'amount' : 'percent');
  const value = Number(String(body.value ?? (old ? old.percent || old.amount : '')).replace(/[$%,\s]/g, ''));
  if (!Number.isFinite(value) || value <= 0) throw err('How much off? Type a number, like 20.');
  if (kind === 'percent' && value > 100) throw err('Percent off can be 100 at most.');
  const maxUses = 'max_uses' in body ? (Number(body.max_uses) > 0 ? Math.round(Number(body.max_uses)) : null) : old ? old.max_uses : null;
  const endsOn = 'ends_on' in body ? (/^\d{4}-\d{2}-\d{2}$/.test(body.ends_on || '') ? body.ends_on : null) : old?.ends_on ?? null;
  const row = { code, percent: kind === 'percent' ? round(value) : null, amount: kind === 'amount' ? round(value) : null,
    applies: ['all', 'products', 'courses'].includes(body.applies) ? body.applies : old?.applies || 'all', max_uses: maxUses, ends_on: endsOn,
    active: 'active' in body ? (body.active ? 1 : 0) : old ? old.active : 1,
    business_id: old ? old.business_id : (biz && biz !== 'all' && require('./businesses').get(biz) ? Number(biz) : null) };
  if (old) {
    db.prepare('UPDATE crm_coupons SET code=@code, percent=@percent, amount=@amount, applies=@applies, max_uses=@max_uses, ends_on=@ends_on, active=@active WHERE id=@id').run({ ...row, id: old.id });
    return shape(get(old.id));
  }
  return shape(get(db.prepare('INSERT INTO crm_coupons (code, percent, amount, applies, max_uses, ends_on, active, business_id) VALUES (@code,@percent,@amount,@applies,@max_uses,@ends_on,@active,@business_id)').run(row).lastInsertRowid));
}
function remove(id) { db.prepare('DELETE FROM crm_coupons WHERE id=?').run(Number(id)); return { ok: true }; }

// Checks a code for a sale. kind is 'products' or 'courses'. Returns the new price for one item.
function check(code, kind, price) {
  code = String(code || '').trim();
  if (!code) return null;
  const c = shape(db.prepare('SELECT * FROM crm_coupons WHERE code=?').get(code));
  if (!c || c.state !== 'live' || (c.applies !== 'all' && c.applies !== kind)) throw err('That coupon code is not valid.');
  const off = c.percent ? price * (c.percent / 100) : Math.min(price, c.amount);
  return { coupon: c, price: Math.max(0, round(price - off)) };
}
function use(id) { db.prepare('UPDATE crm_coupons SET uses=uses+1 WHERE id=?').run(Number(id)); }

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req) => ({ coupons: list(req.query.biz) })));
router.post('/', wrap((req) => save(req.body || {}, null, req.query.biz)));
router.put('/:id', wrap((req) => save(req.body || {}, req.params.id)));
router.delete('/:id', wrap((req) => remove(req.params.id)));

module.exports = { list, save, remove, check, use, anyLive, router };
