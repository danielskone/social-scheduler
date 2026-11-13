// Products and pay links. Save what you sell once (name, price, a short line). Use a product
// in a quote or invoice with one tap, or share its "Buy now" link: people pick how many, type
// their name and email, and pay by card with your own Stripe. Each sale becomes a paid
// invoice on their card (so it shows in Payments and Reports), and your iPhone buzzes.
const express = require('express');
const crypto = require('crypto');
const db = require('../../src/db');
const config = require('../../src/config');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_products (
  id INTEGER PRIMARY KEY,
  business_id INTEGER,
  name TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL,
  max_qty INTEGER NOT NULL DEFAULT 1,     -- how many one person can buy at once (1 = no choice)
  active INTEGER NOT NULL DEFAULT 1,
  token TEXT NOT NULL UNIQUE,
  sold INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
const businesses = () => require('./businesses');
const invoices = () => require('./invoices');
const crm = () => require('./crm');
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const money = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const linkFor = (p) => `${config.publicBaseUrl}/pay/${p.token}`;
const get = (id) => db.prepare('SELECT * FROM crm_products WHERE id=?').get(Number(id));
const withLink = (p) => (p ? { ...p, link: linkFor(p), active: Boolean(p.active) } : null);

function list(biz) {
  return db.prepare('SELECT * FROM crm_products ORDER BY active DESC, name COLLATE NOCASE').all()
    .filter((p) => !biz || biz === 'all' || !p.business_id || p.business_id === Number(biz)).map(withLink);
}
function save(body = {}, id, biz) {
  const old = id ? get(id) : null;
  if (id && !old) throw err('Product not found', 404);
  const name = String(body.name ?? old?.name ?? '').trim().slice(0, 120);
  if (!name) throw err('Give the product a name.');
  const price = Math.round(Number(String(body.price ?? old?.price ?? '').replace(/[$,\s]/g, '')) * 100) / 100;
  if (!Number.isFinite(price) || price <= 0 || price > 999999) throw err('Add a price, like 49 or 19.99.');
  const maxQty = Math.min(100, Math.max(1, Math.round(Number(body.max_qty ?? old?.max_qty ?? 1)) || 1));
  const row = { name, price, max_qty: maxQty, description: 'description' in body ? String(body.description || '').trim().slice(0, 600) || null : (old ? old.description : null),
    active: 'active' in body ? (body.active ? 1 : 0) : (old ? old.active : 1),
    business_id: 'business_id' in body ? (businesses().get(body.business_id) ? Number(body.business_id) : null) : (old ? old.business_id : (biz && biz !== 'all' && businesses().get(biz) ? Number(biz) : null)) };
  if (old) {
    db.prepare('UPDATE crm_products SET name=@name, price=@price, max_qty=@max_qty, description=@description, active=@active, business_id=@business_id WHERE id=@id').run({ ...row, id: old.id });
    return withLink(get(old.id));
  }
  const r = db.prepare('INSERT INTO crm_products (name, price, max_qty, description, active, business_id, token) VALUES (@name,@price,@max_qty,@description,@active,@business_id,@token)')
    .run({ ...row, token: crypto.randomBytes(9).toString('base64url') });
  return withLink(get(r.lastInsertRowid));
}
function remove(id) { db.prepare('DELETE FROM crm_products WHERE id=?').run(Number(id)); return { ok: true }; }

// A buyer: finds them by email, or adds them to the business's first group.
function buyer(body, bizId, note) {
  const name = String(body.name || '').trim().slice(0, 80), email = String(body.email || '').trim().toLowerCase().slice(0, 200);
  const phone = String(body.phone || '').trim().slice(0, 40);
  if (!name) throw err('Please type your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err('Please type your email, so we can send your receipt.');
  let c = db.prepare('SELECT * FROM contacts WHERE lower(email)=?').get(email);
  if (!c) {
    const b = (bizId && businesses().get(bizId)) || businesses().all()[0];
    c = crm().createContact({ name, email, phone: phone || null, group_name: (b && b.groups[0]) || 'Other', stage: 'New' }, { source: 'pay link' });
  } else if (phone && !c.phone) crm().updateContact(c.id, { phone });
  crm().logActivity(c.id, { kind: 'Payment', note });
  return c;
}
// Starts a card payment: makes the invoice, marks it sent, and returns the Stripe page to go to.
async function startPayment({ contact, items, note }) {
  if (!invoices().settings().stripe) throw err('Card payments are not set up yet. Please contact us to pay another way.');
  const inv = invoices().save({ contact_id: contact.id, items, note });
  await invoices().send(inv.id, { by: 'link' });
  const out = await invoices().checkout(inv.token);
  return { invoice: invoices().get(inv.id), url: out.url };
}
async function buy(token, body = {}) {
  const p = db.prepare('SELECT * FROM crm_products WHERE token=? AND active=1').get(String(token));
  if (!p) throw err('This product is not available.', 404);
  if (!invoices().settings().stripe) throw err('Card payments are not set up yet. Please contact us to pay another way.');
  const qty = Math.min(p.max_qty, Math.max(1, Math.round(Number(body.qty) || 1)));
  const c = buyer(body, p.business_id, `Started buying ${qty > 1 ? `${qty} x ` : ''}${p.name} (${money(p.price * qty)})`);
  const r = await startPayment({ contact: c, items: [{ what: p.name, qty, price: p.price }], note: p.description || null });
  db.prepare('UPDATE crm_products SET sold=sold+? WHERE id=?').run(qty, p.id);
  return r;
}

// ---------- The public "Buy now" page ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const nl = (v) => esc(v).replace(/\n/g, '<br>');
function buyPage({ title, sub, description, price, maxQty = 1, bizId, error, values = {}, button = 'Pay with card', extra = '' }) {
  const b = (bizId && businesses().get(bizId)) || businesses().all()[0] || { name: '', color: '#4f46e5' };
  const stripeOn = invoices().settings().stripe;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}${b.name ? ` · ${esc(b.name)}` : ''}</title>
<style>:root{--c:${esc(b.color)};--bg:#f5f6fb;--panel:#fff;--text:#171a24;--muted:#6a7184;--line:#e4e7ef}
@media (prefers-color-scheme:dark){:root{--bg:#0f1117;--panel:#181b24;--text:#eceef4;--muted:#9aa1b4;--line:#2a2f3c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:520px;margin:0 auto;padding:28px 16px 50px}.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:26px;border-top:6px solid var(--c)}
.biz{color:var(--muted);font-size:.9rem;font-weight:600}h1{margin:4px 0 6px;font-size:1.5rem}.price{font-size:1.6rem;font-weight:800;color:var(--c)}.desc{color:var(--muted);margin:10px 0 4px}
label{display:block;font-weight:600;margin:14px 0 6px;font-size:.92rem}input,select{width:100%;font:inherit;color:inherit;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:11px}
button{display:block;width:100%;margin-top:20px;padding:15px;border:0;border-radius:14px;background:var(--c);color:#fff;font:inherit;font-weight:700;font-size:1.08rem;cursor:pointer}button:disabled{opacity:.5}
.err{margin-top:14px;padding:12px 14px;border-radius:12px;background:#fdecec;color:#7f1d1d}.muted{color:var(--muted);font-size:.85rem}.hp{position:absolute;left:-9999px}.lock{text-align:center;margin-top:12px}
ul{padding-left:20px;color:var(--muted)}</style></head><body><div class="wrap"><div class="card">
<div class="biz">${esc(b.name)}</div><h1>${esc(title)}</h1>${sub || ''}<div class="price">${money(price)}${maxQty > 1 ? ' <span class="muted">each</span>' : ''}</div>
${description ? `<p class="desc">${nl(description)}</p>` : ''}${extra}
${error ? `<div class="err">${esc(error)}</div>` : ''}
<form method="post">${maxQty > 1 ? `<label for="q">How many?</label><select id="q" name="qty">${Array.from({ length: maxQty }, (_, i) => `<option${Number(values.qty) === i + 1 ? ' selected' : ''}>${i + 1}</option>`).join('')}</select>` : ''}
<label for="n">Your name</label><input id="n" name="name" required maxlength="80" autocomplete="name" value="${esc(values.name)}">
<label for="e">Email <span class="muted">(for your receipt)</span></label><input id="e" name="email" type="email" required maxlength="200" autocomplete="email" value="${esc(values.email)}">
<label for="p">Phone <span class="muted">(optional)</span></label><input id="p" name="phone" type="tel" maxlength="40" autocomplete="tel" value="${esc(values.phone)}">
<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<button type="submit"${price > 0 && !stripeOn ? ' disabled' : ''}>${esc(button)}</button>
${price > 0 ? (stripeOn ? '<p class="muted lock">🔒 You pay on a secure Stripe page.</p>' : '<p class="muted lock">Card payments are not set up yet. Please contact us to pay.</p>') : ''}
</form></div></div></body></html>`;
}

function publicRouter() {
  const r = express.Router();
  r.use(express.urlencoded({ extended: false, limit: '20kb' }));
  const product = (t) => db.prepare('SELECT * FROM crm_products WHERE token=? AND active=1').get(String(t));
  const show = (p, extra = {}) => buyPage({ title: p.name, description: p.description, price: p.price, maxQty: p.max_qty, bizId: p.business_id, button: `Pay ${money(p.price)} with card`, ...extra });
  r.get('/:token', (req, res) => {
    const p = product(req.params.token);
    if (!p) return res.status(404).send('<meta name="viewport" content="width=device-width, initial-scale=1"><p style="font:18px system-ui;padding:20px">This product is not available.</p>');
    res.set('Cache-Control', 'no-store').type('html').send(show(p));
  });
  r.post('/:token', async (req, res) => {
    const p = product(req.params.token);
    if (!p) return res.status(404).send('Not available');
    if (req.body.website) return res.send('Thank you!');
    if (crm().tooMany(String(req.get('cf-connecting-ip') || req.ip))) return res.status(429).send(show(p, { error: 'Too many tries. Please wait a bit.', values: req.body }));
    try { const out = await buy(p.token, req.body); res.redirect(303, out.url); }
    catch (e) { res.status(e.status || 500).send(show(p, { error: e.message, values: req.body })); }
  });
  return r;
}

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req) => ({ products: list(req.query.biz), stripe: invoices().settings().stripe })));
router.post('/', wrap((req) => save(req.body || {}, null, req.query.biz)));
router.put('/:id', wrap((req) => save(req.body || {}, req.params.id)));
router.delete('/:id', wrap((req) => remove(req.params.id)));

module.exports = { list, save, remove, buy, buyer, startPayment, buyPage, publicRouter, router };
