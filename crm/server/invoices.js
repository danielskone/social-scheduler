// Invoices and payments. Make an invoice for a person, send it by email (or copy the link),
// and they pay online with a card through YOUR OWN Stripe account (money goes straight to
// you; Viral Touch never touches it), or by cash, check or Zelle, which you mark as paid.
//
// Stripe is optional: paste a "restricted key" from your Stripe dashboard in Payments >
// Settings. Without it, invoices still work and show your "how to pay" note instead.
// The customer's invoice page lives at /invoice/<secret link>, with no password.
const express = require('express');
const crypto = require('crypto');
const db = require('../../src/db');
const config = require('../../src/config');
const notify = require('../../src/notify');
const email = require('./email');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_invoices (
  id INTEGER PRIMARY KEY,
  number INTEGER NOT NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  business_id INTEGER,
  items TEXT NOT NULL DEFAULT '[]',      -- JSON [{ what, qty, price }]
  tax_rate REAL NOT NULL DEFAULT 0,      -- percent
  total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft, sent, paid, void
  due_date TEXT,                         -- YYYY-MM-DD
  note TEXT,
  token TEXT NOT NULL UNIQUE,
  stripe_session TEXT,
  paid_at TEXT, paid_how TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_pay_settings (key TEXT PRIMARY KEY, value TEXT);
`);
// Part paid with a gift card (giftcards.js): the card covers this much, the rest is paid by card or cash.
if (!db.prepare("SELECT 1 FROM pragma_table_info('crm_invoices') WHERE name='gift_paid'").get()) db.exec('ALTER TABLE crm_invoices ADD COLUMN gift_paid REAL NOT NULL DEFAULT 0');
const getSet = (k) => db.prepare('SELECT value FROM crm_pay_settings WHERE key=?').get(k)?.value || '';
const setSet = (k, v) => db.prepare('INSERT INTO crm_pay_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v ?? ''));
const crm = () => require('./crm');
const businesses = () => require('./businesses');
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const money = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const round = (n) => Math.round(Number(n) * 100) / 100;
const linkFor = (inv) => `${config.publicBaseUrl}/invoice/${inv.token}`;
const stripeBase = () => (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/$/, '');

// ---------- Settings ----------
function settings({ reveal = false } = {}) {
  const key = getSet('stripe_key');
  return { stripe: Boolean(key), stripeKey: reveal ? key : key ? `${key.slice(0, 8)}...${key.slice(-4)}` : '', payNote: getSet('pay_note'),
    stripeAccount: getSet('stripe_account') || null };
}
async function saveSettings(body = {}) {
  if ('payNote' in body) setSet('pay_note', String(body.payNote || '').trim().slice(0, 500));
  if ('stripeKey' in body) {
    const key = String(body.stripeKey || '').trim();
    if (!key) { setSet('stripe_key', ''); setSet('stripe_account', ''); return settings(); }
    if (!/^(rk|sk)_(live|test)_[A-Za-z0-9]{10,}$/.test(key)) throw err('That doesn\'t look like a Stripe key. It starts with rk_live_ (or sk_live_).');
    // Check the key works before saving it.
    const r = await stripe('GET', 'account', null, key).catch((e) => ({ error: e }));
    if (r.error && !/permission|restricted/i.test(r.error.message)) throw err(`Stripe said: ${r.error.message}`);
    setSet('stripe_key', key);
    setSet('stripe_account', (r && !r.error && (r.settings?.dashboard?.display_name || r.business_profile?.name || r.email)) || (key.includes('_test_') ? 'Test mode' : 'Connected'));
  }
  return settings();
}

async function stripe(method, path, form, key = getSet('stripe_key')) {
  const body = form ? new URLSearchParams(form).toString() : undefined;
  const res = await fetch(`${stripeBase()}/v1/${path}`, { method, headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body, signal: AbortSignal.timeout(20000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Stripe error ${res.status}`);
  return data;
}

// ---------- Invoices ----------
const parse = (r) => (r ? { ...r, items: (() => { try { return JSON.parse(r.items) || []; } catch { return []; } })() } : null);
const get = (id) => parse(db.prepare('SELECT * FROM crm_invoices WHERE id=?').get(Number(id)));
const byToken = (t) => parse(db.prepare('SELECT * FROM crm_invoices WHERE token=?').get(String(t)));
function sums(items, taxRate) {
  const subtotal = round(items.reduce((n, i) => n + i.qty * i.price, 0));
  const tax = round(subtotal * (Number(taxRate) || 0) / 100);
  return { subtotal, tax, total: round(subtotal + tax) };
}
function withExtras(inv) {
  if (!inv) return null;
  const c = inv.contact_id ? db.prepare('SELECT id, name, company, email, phone, address, group_name FROM contacts WHERE id=?').get(inv.contact_id) : null;
  const b = inv.business_id ? businesses().get(inv.business_id) : (c ? businesses().ownerOf(c.group_name) : null);
  const overdue = inv.status === 'sent' && inv.due_date && inv.due_date < new Date().toISOString().slice(0, 10);
  const s = sums(inv.items, inv.tax_rate);
  return { ...inv, ...s, gift_paid: round(inv.gift_paid || 0), due: Math.max(0, round(s.total - (inv.gift_paid || 0))), contact: c, business: b ? { id: b.id, name: b.name, color: b.color, email: b.email, phone: b.phone, address: b.address, website: b.website } : null,
    link: linkFor(inv), label: overdue ? 'overdue' : inv.status };
}

function cleanItems(list) {
  if (!Array.isArray(list)) throw err('Add what the invoice is for.');
  const items = list.map((i) => ({ what: String(i.what || '').trim().slice(0, 200), qty: Number(i.qty ?? 1), price: Number(String(i.price ?? '').replace(/[$,\s]/g, '')) }))
    .filter((i) => i.what || i.price);
  if (!items.length) throw err('Add at least one line, like "Gold sponsorship, $500".');
  if (items.length > 50) throw err('That is too many lines.');
  for (const i of items) {
    if (!i.what) throw err('Every line needs a description.');
    if (!Number.isFinite(i.qty) || i.qty <= 0) throw err(`Check the quantity for "${i.what}".`);
    if (!Number.isFinite(i.price) || i.price < 0) throw err(`Check the price for "${i.what}".`);
    i.price = round(i.price);
  }
  return items;
}

function save(body = {}, id, { allowZero = false } = {}) {
  const old = id ? get(id) : null;
  if (id && !old) throw err('Invoice not found', 404);
  if (old && old.status !== 'draft' && old.status !== 'sent') throw err('A paid or cancelled invoice can\'t be changed.');
  const contactId = Number(body.contact_id ?? old?.contact_id);
  const c = db.prepare('SELECT * FROM contacts WHERE id=?').get(contactId);
  if (!c) throw err('Pick who the invoice is for.');
  const items = body.items ? cleanItems(body.items) : old.items;
  const taxRate = body.tax_rate == null || body.tax_rate === '' ? (old ? old.tax_rate : 0) : Number(body.tax_rate);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 50) throw err('Tax must be a percent between 0 and 50.');
  const due = /^\d{4}-\d{2}-\d{2}$/.test(body.due_date || '') ? body.due_date : body.due_date === '' ? null : (old ? old.due_date : null);
  const note = 'note' in body ? String(body.note || '').trim().slice(0, 1000) || null : (old ? old.note : null);
  const { total } = sums(items, taxRate);
  if (old && old.gift_paid && total < old.gift_paid) throw err(`A gift card already paid ${money(old.gift_paid)}, so the total can't be lower than that.`);
  if (total <= 0 && !allowZero) throw err('The total must be more than $0.');
  if (total > 999999) throw err('That total is too big for one invoice.');
  const biz = businesses().ownerOf(c.group_name);
  if (old) {
    db.prepare('UPDATE crm_invoices SET contact_id=?, business_id=?, items=?, tax_rate=?, total=?, due_date=?, note=?, stripe_session=NULL WHERE id=?')
      .run(c.id, biz ? biz.id : null, JSON.stringify(items), taxRate, total, due, note, old.id);
    return withExtras(get(old.id));
  }
  const number = (db.prepare('SELECT MAX(number) AS n FROM crm_invoices').get().n || 1000) + 1;
  const token = crypto.randomBytes(18).toString('base64url');
  const r = db.prepare('INSERT INTO crm_invoices (number, contact_id, business_id, items, tax_rate, total, due_date, note, token) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(number, c.id, biz ? biz.id : null, JSON.stringify(items), taxRate, total, due, note, token);
  return withExtras(get(r.lastInsertRowid));
}

function list({ biz, status } = {}) {
  const f = businesses().filter(biz, 'c.group_name');
  const rows = db.prepare(`SELECT i.* FROM crm_invoices i LEFT JOIN contacts c ON c.id=i.contact_id ${f.sql ? `WHERE ${f.sql}` : ''} ORDER BY i.id DESC LIMIT 500`).all(...f.args)
    .map((r) => withExtras(parse(r)));
  const shown = status ? rows.filter((r) => r.label === status || (status === 'unpaid' && ['sent', 'overdue'].includes(r.label))) : rows;
  const since = new Date(Date.now() - 30 * 86400e3).toISOString();
  return {
    invoices: shown,
    totals: {
      unpaid: round(rows.filter((r) => r.status === 'sent').reduce((n, r) => n + r.total, 0)),
      overdue: round(rows.filter((r) => r.label === 'overdue').reduce((n, r) => n + r.total, 0)),
      paid30: round(rows.filter((r) => r.status === 'paid' && r.paid_at >= since).reduce((n, r) => n + r.total, 0)),
      drafts: rows.filter((r) => r.status === 'draft').length,
    },
    settings: settings(),
  };
}

// Sends the invoice link by email from your own address (or just marks it sent, to share the link yourself).
async function send(id, { by = 'email', message } = {}, opts = {}) {
  const inv = withExtras(get(id));
  if (!inv) throw err('Invoice not found', 404);
  if (!['draft', 'sent'].includes(inv.status)) throw err('This invoice is already paid or cancelled.');
  const c = inv.contact;
  if (by === 'email') {
    if (!c || !c.email) throw err('This person has no email address. Copy the link and text it instead.');
    const first = String(c.name).split(' ')[0];
    const text = `${String(message || '').trim() || `Hi ${first},\n\nHere is invoice #${inv.number}${inv.business ? ` from ${inv.business.name}` : ''} for ${money(inv.total)}${inv.due_date ? `, due ${new Date(`${inv.due_date}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}` : ''}.`}\n\nView and pay it here:\n${inv.link}\n\nThank you!`;
    await email.sendDirect({ to: c.email, toName: c.name, subject: `Invoice #${inv.number}${inv.business ? ` from ${inv.business.name}` : ''}`, text }, opts);
  }
  db.prepare("UPDATE crm_invoices SET status='sent', sent_at=? WHERE id=?").run(new Date().toISOString(), inv.id);
  if (c) crm().logActivity(c.id, { kind: 'Payment', note: `Invoice #${inv.number} for ${money(inv.total)} ${by === 'email' ? 'emailed' : 'marked as sent'}` });
  return withExtras(get(inv.id));
}

function markPaid(id, how = 'Cash or check', { quiet } = {}) {
  const inv = withExtras(get(id));
  if (!inv) throw err('Invoice not found', 404);
  if (inv.status === 'paid') return inv;
  if (inv.status === 'void') throw err('This invoice was cancelled.');
  db.prepare("UPDATE crm_invoices SET status='paid', paid_at=?, paid_how=? WHERE id=?").run(new Date().toISOString(), String(how).slice(0, 60), inv.id);
  try { require('./giftcards').onPaid(inv.id); } catch (e) { console.error(`[invoices] ${e.message}`); }
  try { require('./loyalty').onPaid(get(inv.id)); } catch (e) { console.error(`[invoices] ${e.message}`); }
  try { require('./courses').onPaid(inv.id); } catch (e) { console.error(`[invoices] ${e.message}`); }
  try { require('./events').onPaid(inv.id); } catch (e) { console.error(`[invoices] ${e.message}`); }
  try { require('./referrals').onPaid(get(inv.id)); } catch (e) { console.error(`[invoices] ${e.message}`); }
  if (inv.contact) {
    crm().logActivity(inv.contact.id, { kind: 'Payment', note: `Paid invoice #${inv.number}: ${money(inv.total)} (${how})` });
    if (!quiet) notify.send('Invoice paid', `${inv.contact.name} paid ${money(inv.total)} (invoice #${inv.number}, ${how}).`, { tags: 'moneybag' }).catch(() => {});
  }
  return withExtras(get(inv.id));
}
function setStatus(id, status) {
  const inv = get(id);
  if (!inv) throw err('Invoice not found', 404);
  if (status === 'void') { if (inv.status === 'paid') throw err('A paid invoice can\'t be cancelled. Refund it in Stripe instead.'); }
  else if (status === 'sent') { if (inv.status !== 'paid') throw err('Only a paid invoice can be marked unpaid.'); }
  else throw err('Unknown status');
  db.prepare(`UPDATE crm_invoices SET status=?${status === 'sent' ? ', paid_at=NULL, paid_how=NULL' : ''} WHERE id=?`).run(status, inv.id);
  if (status === 'void') { try { require('./giftcards').refundInvoice(inv.id); } catch (e) { console.error(`[invoices] ${e.message}`); } }
  return withExtras(get(inv.id));
}
function remove(id) {
  const inv = get(id);
  if (inv && inv.status !== 'draft') throw err('Only a draft can be deleted. Cancel a sent invoice instead.');
  db.prepare('DELETE FROM crm_invoices WHERE id=?').run(Number(id));
  return { ok: true };
}

// ---------- Paying online (Stripe Checkout, on the customer's own Stripe) ----------
async function checkout(token) {
  const inv = withExtras(byToken(token));
  if (!inv || inv.status === 'void' || inv.status === 'draft') throw err('This invoice is not available.', 404);
  if (inv.status === 'paid') return { paid: true };
  if (inv.due <= 0) { markPaid(inv.id, 'Gift card'); return { paid: true }; }
  if (!getSet('stripe_key')) throw err('Online payment is not set up for this invoice.');
  const base = linkFor(inv), f = {
    mode: 'payment', success_url: `${base}?paid=1&session={CHECKOUT_SESSION_ID}`, cancel_url: base,
    client_reference_id: `invoice-${inv.id}`, 'metadata[invoice]': String(inv.number), 'payment_intent_data[description]': `Invoice #${inv.number}`,
  };
  if (inv.contact && inv.contact.email) f.customer_email = inv.contact.email;
  // One line with the total (tax included), so Stripe charges exactly what the invoice says.
  f['line_items[0][quantity]'] = '1';
  f['line_items[0][price_data][currency]'] = 'usd';
  f['line_items[0][price_data][unit_amount]'] = String(Math.round(inv.due * 100));
  f['line_items[0][price_data][product_data][name]'] = `Invoice #${inv.number}${inv.business ? ` - ${inv.business.name}` : ''}`;
  const s = await stripe('POST', 'checkout/sessions', f);
  db.prepare('UPDATE crm_invoices SET stripe_session=? WHERE id=?').run(s.id, inv.id);
  return { url: s.url };
}
async function checkSession(inv, sessionId = inv.stripe_session) {
  if (!sessionId || !getSet('stripe_key') || inv.status === 'paid') return inv.status === 'paid';
  const s = await stripe('GET', `checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (s.client_reference_id !== `invoice-${inv.id}`) return false;
  if (s.payment_status === 'paid') { markPaid(inv.id, 'Card (Stripe)'); return true; }
  return false;
}
// Every 10 minutes: invoices waiting on a Stripe payment get checked (no webhooks needed).
async function checkPending() {
  if (!getSet('stripe_key')) return 0;
  let n = 0;
  for (const r of db.prepare("SELECT * FROM crm_invoices WHERE status='sent' AND stripe_session IS NOT NULL").all()) {
    try { if (await checkSession(parse(r))) n++; } catch (e) { console.error(`[invoices] ${e.message}`); }
  }
  return n;
}

// ---------- The customer's invoice page ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = (s) => esc(s).replace(/\n/g, '<br>');
function page(inv, { notice } = {}) {
  const b = inv.business || { name: 'Invoice', color: '#4f46e5' };
  const c = inv.contact || {};
  const date = (iso) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');
  const st = getSet('stripe_key'), note = getSet('pay_note');
  const badge = { paid: ['Paid', '#16a34a'], void: ['Cancelled', '#6b7280'], overdue: ['Overdue', '#dc2626'], sent: ['Due', b.color] }[inv.label] || ['Due', b.color];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Invoice #${inv.number} · ${esc(b.name)}</title>
<style>
:root{--c:${esc(b.color)};--bg:#f5f6fb;--panel:#fff;--text:#171a24;--muted:#6a7184;--line:#e4e7ef}
@media (prefers-color-scheme:dark){:root{--bg:#0f1117;--panel:#181b24;--text:#eceef4;--muted:#9aa1b4;--line:#2a2f3c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:28px 16px 60px}.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:28px;box-shadow:0 4px 20px rgb(16 24 40/.06)}
.top{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;border-top:6px solid var(--c);margin:-28px -28px 22px;padding:24px 28px 0;border-radius:18px 18px 0 0}
h1{margin:0;font-size:1.5rem}.muted{color:var(--muted)}.small{font-size:.88rem}.badge{display:inline-block;padding:4px 12px;border-radius:999px;color:#fff;font-weight:700;font-size:.85rem;background:${badge[1]}}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:18px 0}table{width:100%;border-collapse:collapse;margin:8px 0 4px}th,td{padding:10px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}td.n,th.n{text-align:right;white-space:nowrap}.sum{margin-left:auto;max-width:280px}.sum div{display:flex;justify-content:space-between;padding:4px 6px}
.total{font-size:1.3rem;font-weight:800;border-top:2px solid var(--text);margin-top:4px;padding-top:8px!important}.pay{display:block;width:100%;margin-top:22px;padding:15px;border:0;border-radius:14px;background:var(--c);color:#fff;font:inherit;font-weight:700;font-size:1.1rem;cursor:pointer}
.note{margin-top:18px;padding:14px 16px;border-radius:12px;background:color-mix(in srgb,var(--c) 9%,var(--panel));white-space:normal}.ok{margin-bottom:16px;padding:14px 16px;border-radius:12px;background:#e7f7ec;color:#14532d;font-weight:600}
.err{margin-bottom:16px;padding:14px 16px;border-radius:12px;background:#fdecec;color:#7f1d1d}footer{text-align:center;margin-top:18px}
@media (max-width:560px){.card{padding:20px}.top{margin:-20px -20px 18px;padding:20px 20px 0}.two{grid-template-columns:1fr}}
@media print{.pay,footer{display:none}body{background:#fff}.card{border:0;box-shadow:none}}
</style></head><body><div class="wrap">
${notice ? `<div class="${notice.ok ? 'ok' : 'err'}">${esc(notice.text)}</div>` : ''}
<div class="card"><div class="top"><div><h1>${esc(b.name)}</h1><div class="muted small">${[b.address, b.phone, b.email, b.website].filter(Boolean).map(esc).join('<br>')}</div></div>
<div style="text-align:right"><div class="muted small">Invoice</div><div style="font-size:1.4rem;font-weight:800">#${inv.number}</div><span class="badge">${badge[0]}</span></div></div>
<div class="two"><div><div class="muted small">Bill to</div><b>${esc(c.name || '')}</b>${c.company && c.company !== c.name ? `<br>${esc(c.company)}` : ''}${c.address ? `<br><span class="small">${esc(c.address)}</span>` : ''}</div>
<div><div class="muted small">${inv.status === 'paid' ? 'Paid on' : 'Due'}</div><b>${inv.status === 'paid' ? date(inv.paid_at) : inv.due_date ? date(inv.due_date) : 'On receipt'}</b><div class="muted small">Sent ${date(inv.sent_at || inv.created_at.replace(' ', 'T') + 'Z')}</div></div></div>
<table><thead><tr><th>What</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr></thead><tbody>
${inv.items.map((i) => `<tr><td>${esc(i.what)}</td><td class="n">${i.qty}</td><td class="n">${money(i.price)}</td><td class="n">${money(i.qty * i.price)}</td></tr>`).join('')}
</tbody></table><div class="sum">${inv.tax ? `<div><span>Subtotal</span><span>${money(inv.subtotal)}</span></div><div><span>Tax (${inv.tax_rate}%)</span><span>${money(inv.tax)}</span></div>` : ''}
<div class="total"><span>Total</span><span>${money(inv.total)}</span></div>${inv.gift_paid ? `<div><span>Gift card</span><span>-${money(inv.gift_paid)}</span></div><div style="font-weight:800"><span>${inv.status === 'paid' ? 'Paid' : 'Left to pay'}</span><span>${money(inv.due)}</span></div>` : ''}</div>
${inv.note ? `<div class="note">${nl(inv.note)}</div>` : ''}
${(() => { try { return require('./courses').invoiceExtra(inv); } catch { return ''; } })()}${(() => { try { return require('./events').invoiceExtra(inv); } catch { return ''; } })()}
${['sent', 'overdue'].includes(inv.label) && st ? `<form method="post" action="${esc(inv.token)}/pay"><button class="pay">Pay ${money(inv.due)} with card</button></form>` : ''}
${['sent', 'overdue'].includes(inv.label) ? (() => { try { return require('./giftcards').invoiceForm(inv); } catch { return ''; } })() : ''}
${['sent', 'overdue'].includes(inv.label) && note ? `<div class="note"><b>Other ways to pay</b><br>${nl(note)}</div>` : ''}
</div><footer class="muted small">Questions? Reply to the email this came in${b.phone ? ` or call ${esc(b.phone)}` : ''}.</footer></div></body></html>`;
}

function publicRouter() {
  const r = express.Router();
  r.get('/:token', async (req, res) => {
    let inv = byToken(req.params.token);
    if (!inv || inv.status === 'draft') return res.status(404).send('<meta name="viewport" content="width=device-width, initial-scale=1"><p style="font:18px system-ui;padding:20px">This invoice is not available.</p>');
    let notice = null;
    if (req.query.paid && inv.status !== 'paid') {
      try { if (await checkSession(inv, String(req.query.session || '') || inv.stripe_session)) notice = { ok: true, text: 'Thank you! Your payment went through.' }; }
      catch (e) { console.error(`[invoices] ${e.message}`); }
      if (!notice) notice = { ok: true, text: 'Thank you! Your payment is being confirmed.' };
      inv = byToken(req.params.token);
    } else if (req.query.paid) notice = { ok: true, text: 'Thank you! Your payment went through.' };
    if (req.query.gift) notice = { ok: true, text: `Your gift card paid ${money(Number(req.query.gift) || 0)}.` };
    if (req.query.error) notice = { ok: false, text: String(req.query.error).slice(0, 200) };
    res.set('Cache-Control', 'no-store').type('html').send(page(withExtras(inv), { notice }));
  });
  r.post('/:token/gift', async (req, res) => {
    const back = `../${encodeURIComponent(req.params.token)}`;
    if (crm().tooMany(String(req.get('cf-connecting-ip') || req.ip))) return res.redirect(303, `${back}?error=${encodeURIComponent('Too many tries. Please wait a bit.')}`);
    try {
      const out = require('./giftcards').applyToInvoice(req.params.token, (req.body || {}).code);
      res.redirect(303, out.paid ? `${back}?paid=1` : `${back}?gift=${encodeURIComponent(out.used)}`);
    } catch (e) { res.redirect(303, `${back}?error=${encodeURIComponent(e.message)}`); }
  });
  r.post('/:token/pay', async (req, res) => {
    try {
      const out = await checkout(req.params.token);
      res.redirect(303, out.paid ? `../${encodeURIComponent(req.params.token)}?paid=1` : out.url);
    } catch (e) { res.redirect(303, `../${encodeURIComponent(req.params.token)}?error=${encodeURIComponent(e.message)}`); }
  });
  return r;
}

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req) => list(req.query)));
router.get('/settings', wrap(() => settings()));
router.put('/settings', wrap((req) => saveSettings(req.body || {})));
router.post('/check', wrap(async () => ({ paid: await checkPending() })));
router.get('/:id', wrap((req) => { const i = withExtras(get(req.params.id)); if (!i) throw err('Invoice not found', 404); return i; }));
router.post('/', wrap((req) => save(req.body || {})));
router.put('/:id', wrap((req) => save(req.body || {}, Number(req.params.id))));
router.post('/:id/send', wrap((req) => send(req.params.id, req.body || {})));
router.post('/:id/paid', wrap((req) => markPaid(req.params.id, (req.body || {}).how || 'Cash or check')));
router.post('/:id/status', wrap((req) => setStatus(req.params.id, (req.body || {}).status)));
router.delete('/:id', wrap((req) => remove(req.params.id)));

module.exports = { stripe, stripeOn: () => Boolean(getSet("stripe_key")), save, list, send, markPaid, setStatus, remove, checkout, checkSession, checkPending, settings, saveSettings, publicRouter, router, page, withExtras, get, cleanItems, sums };
