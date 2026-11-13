// Gift cards. People buy one on your gift card page (/gift) and pay by card with your own Stripe.
// The person it's for gets an email with a code. They type the code on any invoice or Buy now
// page, and the card pays what it can; whatever is left on it stays for next time. You can also
// give cards away from the CRM (prizes, thank-yous), and loyalty points turn into gift cards.
const express = require('express');
const crypto = require('crypto');
const db = require('../../src/db');
const config = require('../../src/config');
const notify = require('../../src/notify');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_gift_cards (
  id INTEGER PRIMARY KEY,
  business_id INTEGER,
  code TEXT NOT NULL UNIQUE,
  amount REAL NOT NULL,                 -- what it was worth at the start
  balance REAL NOT NULL,                -- what is left
  status TEXT NOT NULL DEFAULT 'active', -- pending (waiting for payment), active, void
  buyer_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  owner_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,  -- who it is for
  to_name TEXT, to_email TEXT, message TEXT,
  source TEXT NOT NULL DEFAULT 'sold',  -- sold, given, points
  invoice_id INTEGER,                   -- the invoice that bought it
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_gift_card_uses (
  id INTEGER PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES crm_gift_cards(id) ON DELETE CASCADE,
  invoice_id INTEGER,
  amount REAL NOT NULL,                 -- money taken off the card (negative = put back)
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_gift_settings (key TEXT PRIMARY KEY, value TEXT);
`);
const crm = () => require('./crm');
const businesses = () => require('./businesses');
const invoices = () => require('./invoices');
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const round = (n) => Math.round(Number(n) * 100) / 100;
const money = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = (s) => esc(s).replace(/\n/g, '<br>');
const getSet = (k, d = '') => db.prepare('SELECT value FROM crm_gift_settings WHERE key=?').get(k)?.value ?? d;
const setSet = (k, v) => db.prepare('INSERT INTO crm_gift_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v ?? ''));

function settings() {
  const amounts = String(getSet('amounts', '25,50,100')).split(',').map(Number).filter((n) => n > 0);
  return { on: getSet('on', '1') === '1', amounts, custom: getSet('custom', '1') === '1', min: Number(getSet('min', '10')), max: Number(getSet('max', '500')),
    link: `${config.publicBaseUrl}/gift`, stripe: invoices().settings().stripe };
}
function saveSettings(body = {}) {
  if ('on' in body) setSet('on', body.on ? '1' : '0');
  if ('custom' in body) setSet('custom', body.custom ? '1' : '0');
  if ('amounts' in body) {
    const a = [...new Set((Array.isArray(body.amounts) ? body.amounts : String(body.amounts || '').split(',')).map((x) => round(String(x).replace(/[$\s]/g, ''))).filter((n) => n >= 1 && n <= 5000))].sort((x, y) => x - y).slice(0, 8);
    if (!a.length) throw err('Add at least one amount, like 25, 50, 100.');
    setSet('amounts', a.join(','));
  }
  for (const k of ['min', 'max']) if (k in body) { const n = Number(body[k]); if (!(n >= 1 && n <= 5000)) throw err('Use an amount from $1 to $5,000.'); setSet(k, round(n)); }
  if (Number(getSet('min', '10')) > Number(getSet('max', '500'))) throw err('The smallest amount must be less than the biggest.');
  return settings();
}

// Codes look like ABCD-EFGH-JKMN: no 0/O or 1/I/L, so they are easy to read out loud.
const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => { let s = ''; for (let i = 0; i < 12; i++) s += ABC[crypto.randomInt(ABC.length)]; return s.match(/.{4}/g).join('-'); };
const normal = (code) => { const s = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return s.length === 12 ? s.match(/.{4}/g).join('-') : ''; };
const last4 = (code) => String(code).slice(-4);
const byCode = (code) => db.prepare('SELECT * FROM crm_gift_cards WHERE code=?').get(normal(code));
const cardLink = (c) => `${config.publicBaseUrl}/gift/card/${c.code}`;
const shape = (c) => c && { ...c, link: cardLink(c), used: round(c.amount - c.balance),
  buyer_name: c.buyer_id ? db.prepare('SELECT name FROM contacts WHERE id=?').get(c.buyer_id)?.name || null : null,
  owner_name: c.owner_id ? db.prepare('SELECT name FROM contacts WHERE id=?').get(c.owner_id)?.name || c.to_name : c.to_name };

function list(biz) {
  const rows = db.prepare("SELECT * FROM crm_gift_cards WHERE status<>'pending' ORDER BY id DESC LIMIT 1000").all()
    .filter((c) => !biz || biz === 'all' || !c.business_id || c.business_id === Number(biz)).map(shape);
  const live = rows.filter((c) => c.status === 'active');
  return { cards: rows, totals: { sold: round(rows.filter((c) => c.source === 'sold').reduce((n, c) => n + c.amount, 0)), outstanding: round(live.reduce((n, c) => n + c.balance, 0)),
    count: live.filter((c) => c.balance > 0).length }, settings: settings() };
}
const anyActive = () => Boolean(db.prepare("SELECT 1 FROM crm_gift_cards WHERE status='active' AND balance>0").get());

// The person a card is for: an existing contact (by email), or a new one.
function ownerFor({ to_name, to_email }, bizId) {
  const email = String(to_email || '').trim().toLowerCase();
  if (!email) return null;
  let c = db.prepare('SELECT * FROM contacts WHERE lower(email)=?').get(email);
  if (!c) {
    const b = (bizId && businesses().get(bizId)) || businesses().all()[0];
    c = crm().createContact({ name: String(to_name || '').trim() || email.split('@')[0], email, group_name: (b && b.groups[0]) || 'Other', stage: 'New' }, { source: 'gift card' });
  }
  return c;
}
function insertCard({ amount, bizId, buyer, owner, to_name, to_email, message, source, invoiceId, status }) {
  let code = newCode();
  while (db.prepare('SELECT 1 FROM crm_gift_cards WHERE code=?').get(code)) code = newCode();
  const id = db.prepare(`INSERT INTO crm_gift_cards (business_id, code, amount, balance, status, buyer_id, owner_id, to_name, to_email, message, source, invoice_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(bizId || null, code, amount, amount, status, buyer?.id || null, owner?.id || null,
    String(to_name || owner?.name || '').trim().slice(0, 80) || null, String(to_email || owner?.email || '').trim().toLowerCase().slice(0, 200) || null,
    String(message || '').trim().slice(0, 500) || null, source, invoiceId || null).lastInsertRowid;
  return db.prepare('SELECT * FROM crm_gift_cards WHERE id=?').get(id);
}
async function emailCard(card, opts = {}) {
  const email = require('./email');
  if (!card.to_email || !email.provider()) return false;
  const b = (card.business_id && businesses().get(card.business_id)) || businesses().all()[0] || {};
  const from = card.buyer_id && card.buyer_id !== card.owner_id ? db.prepare('SELECT name FROM contacts WHERE id=?').get(card.buyer_id)?.name : null;
  const first = String(card.to_name || '').split(' ')[0] || 'there';
  await email.sendDirect({ to: card.to_email, toName: card.to_name, subject: `${from ? `${from} sent you` : 'Here is'} a ${money(card.amount)} gift card${b.name ? ` for ${b.name}` : ''}`,
    text: `Hi ${first},\n\n${from ? `${from} sent you a ${money(card.amount)} gift card` : `Here is your ${money(card.amount)} gift card`}${b.name ? ` for ${b.name}` : ''}!${card.message ? `\n\n"${card.message}"` : ''}\n\nYour gift card code: ${card.code}\n\nUse it when you pay any of our invoices or buy online: type the code in the gift card box. See what is left on it any time:\n${cardLink(card)}\n\nEnjoy!${b.name ? `\n${b.name}` : ''}` }, opts);
  return true;
}

// From the CRM: give a card away (a prize, a thank-you, a refund as store credit).
async function give(body = {}, biz) {
  const amount = round(String(body.amount ?? '').replace(/[$,\s]/g, ''));
  if (!(amount >= 1 && amount <= 5000)) throw err('Pick an amount from $1 to $5,000.');
  if (!body.contact_id && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.to_email || '').trim())) throw err('Pick a person, or type their email.');
  const bizId = businesses().get(biz) ? Number(biz) : null;
  const owner = body.contact_id ? db.prepare('SELECT * FROM contacts WHERE id=?').get(Number(body.contact_id)) : ownerFor(body, bizId);
  if (!owner) throw err('Pick a person.');
  const card = insertCard({ amount, bizId, owner, to_name: owner.name, to_email: owner.email || body.to_email, message: body.message, source: body.source || 'given', status: 'active' });
  crm().logActivity(owner.id, { kind: 'Payment', note: `Got a ${money(amount)} gift card (${body.source === 'points' ? 'points reward' : 'from you'}) ending ${last4(card.code)}` });
  const emailed = body.send === false ? false : await emailCard(card).catch(() => false);
  return { ...shape(card), emailed };
}

// ---------- Buying a card ----------
async function buy(body = {}) {
  const s = settings();
  if (!s.on) throw err('Gift cards are not available right now.', 404);
  if (!s.stripe) throw err('Card payments are not set up yet. Please contact us.');
  let amount = round(String(body.amount === 'other' ? body.other : body.amount || '').replace(/[$,\s]/g, ''));
  if (!s.amounts.includes(amount) && !(s.custom && amount >= s.min && amount <= s.max)) throw err(s.custom ? `Pick an amount from ${money(s.min)} to ${money(s.max)}.` : 'Pick an amount.');
  const forSelf = body.for !== 'someone';
  const toEmail = String(forSelf ? body.email : body.to_email || '').trim().toLowerCase();
  if (!forSelf && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) throw err("Type the email of the person it's for.");
  if (!forSelf && !String(body.to_name || '').trim()) throw err("Type the name of the person it's for.");
  const bizId = businesses().get(body.b) ? Number(body.b) : businesses().all()[0]?.id || null;
  const products = require('./products');
  const buyer = products.buyer(body, bizId, `Started buying a ${money(amount)} gift card${forSelf ? '' : ` for ${String(body.to_name).trim()}`}`);
  const pay = await products.startPayment({ contact: buyer, items: [{ what: `Gift card${forSelf ? '' : ` for ${String(body.to_name).trim().slice(0, 60)}`}`, qty: 1, price: amount }], note: forSelf ? null : `Sent to ${toEmail} once paid.` });
  insertCard({ amount, bizId, buyer, to_name: forSelf ? buyer.name : body.to_name, to_email: forSelf ? buyer.email : toEmail, message: forSelf ? null : body.message, source: 'sold', invoiceId: pay.invoice.id, status: 'pending' });
  return pay;
}
// Called when any invoice is paid: a card bought with it goes live and is emailed.
function onPaid(invoiceId) {
  const card = db.prepare("SELECT * FROM crm_gift_cards WHERE invoice_id=? AND status='pending'").get(Number(invoiceId));
  if (!card) return;
  const owner = ownerFor(card, card.business_id);
  db.prepare("UPDATE crm_gift_cards SET status='active', owner_id=? WHERE id=?").run(owner ? owner.id : null, card.id);
  const live = db.prepare('SELECT * FROM crm_gift_cards WHERE id=?').get(card.id);
  if (owner && owner.id !== card.buyer_id) crm().logActivity(owner.id, { kind: 'Payment', note: `Got a ${money(card.amount)} gift card ending ${last4(card.code)}` });
  const buyer = card.buyer_id && db.prepare('SELECT name FROM contacts WHERE id=?').get(card.buyer_id);
  notify.send('Gift card sold', `${buyer ? buyer.name : 'Someone'} bought a ${money(card.amount)} gift card${card.to_name && owner && owner.id !== card.buyer_id ? ` for ${card.to_name}` : ''}.`, { tags: 'gift' }).catch(() => {});
  emailCard(live).catch((e) => console.error(`[giftcards] ${e.message}`));
}

// ---------- Using a card ----------
function take(card, invoiceId, amount, note) {
  db.prepare('UPDATE crm_gift_cards SET balance=round(balance-?,2) WHERE id=?').run(amount, card.id);
  db.prepare('INSERT INTO crm_gift_card_uses (card_id, invoice_id, amount, note) VALUES (?,?,?,?)').run(card.id, invoiceId, amount, note || null);
}
function usable(code) {
  const c = byCode(code);
  if (!c || c.status !== 'active') throw err('That gift card code is not valid. Check the letters and try again.');
  if (c.balance <= 0) throw err('That gift card has nothing left on it.');
  return c;
}
// Puts a card toward an invoice. Returns how much it paid and whether the invoice is now paid.
function applyToInvoice(token, code) {
  const raw = db.prepare('SELECT id FROM crm_invoices WHERE token=?').get(String(token));
  const inv = raw && invoices().withExtras(invoices().get(raw.id));
  if (!inv || !['sent'].includes(inv.status)) throw err('This invoice can not take a gift card.');
  const card = usable(code);
  const used = round(Math.min(card.balance, inv.due));
  if (used <= 0) throw err('Nothing is left to pay on this invoice.');
  db.transaction(() => {
    take(card, inv.id, used, `Invoice #${inv.number}`);
    db.prepare('UPDATE crm_invoices SET gift_paid=round(gift_paid+?,2), stripe_session=NULL WHERE id=?').run(used, inv.id);
  })();
  if (inv.contact) crm().logActivity(inv.contact.id, { kind: 'Payment', note: `Used gift card ending ${last4(card.code)}: ${money(used)} on invoice #${inv.number}` });
  const paid = round(inv.due - used) <= 0;
  if (paid) invoices().markPaid(inv.id, 'Gift card');
  return { used, paid, left: round(card.balance - used) };
}
// A cancelled invoice gives its gift card money back.
function refundInvoice(invoiceId) {
  for (const u of db.prepare('SELECT card_id, SUM(amount) AS amt FROM crm_gift_card_uses WHERE invoice_id=? GROUP BY card_id').all(Number(invoiceId))) {
    if (u.amt <= 0) continue;
    db.prepare('UPDATE crm_gift_cards SET balance=round(balance+?,2) WHERE id=?').run(u.amt, u.card_id);
    db.prepare('INSERT INTO crm_gift_card_uses (card_id, invoice_id, amount, note) VALUES (?,?,?,?)').run(u.card_id, invoiceId, -u.amt, 'Invoice cancelled: money put back');
  }
  db.prepare('UPDATE crm_invoices SET gift_paid=0 WHERE id=?').run(Number(invoiceId));
}
function voidCard(id) {
  const c = db.prepare('SELECT * FROM crm_gift_cards WHERE id=?').get(Number(id));
  if (!c) throw err('Gift card not found', 404);
  db.prepare("UPDATE crm_gift_cards SET status='void' WHERE id=?").run(c.id);
  return shape(db.prepare('SELECT * FROM crm_gift_cards WHERE id=?').get(c.id));
}
function detail(id) {
  const c = shape(db.prepare('SELECT * FROM crm_gift_cards WHERE id=?').get(Number(id)));
  if (!c) throw err('Gift card not found', 404);
  c.uses = db.prepare('SELECT u.*, i.number FROM crm_gift_card_uses u LEFT JOIN crm_invoices i ON i.id=u.invoice_id WHERE card_id=? ORDER BY u.id DESC').all(c.id);
  return c;
}
const forContact = (contactId) => db.prepare("SELECT * FROM crm_gift_cards WHERE owner_id=? AND status='active' AND balance>0 ORDER BY id").all(Number(contactId)).map(shape);

// The little "Have a gift card?" box on an invoice page.
function invoiceForm(inv) {
  if (!anyActive()) return '';
  return `<details style="margin-top:16px"${inv.gift_paid ? ' open' : ''}><summary class="muted" style="cursor:pointer">Have a gift card?</summary>
<form method="post" action="${esc(inv.token)}/gift" style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><input name="code" required placeholder="ABCD-EFGH-JKMN" autocapitalize="characters" autocomplete="off" maxlength="20" aria-label="Gift card code" style="flex:1;min-width:180px;font:inherit;padding:11px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--text)">
<button style="padding:11px 18px;border:0;border-radius:10px;background:var(--c);color:#fff;font:inherit;font-weight:700;cursor:pointer">Use gift card</button></form></details>`;
}

// ---------- Public pages ----------
function shell(b, title, body) {
  const color = b?.color || '#4f46e5';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>:root{--c:${esc(color)};--bg:#f5f6fb;--panel:#fff;--text:#171a24;--muted:#6a7184;--line:#e4e7ef}
@media (prefers-color-scheme:dark){:root{--bg:#0f1117;--panel:#181b24;--text:#eceef4;--muted:#9aa1b4;--line:#2a2f3c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:560px;margin:0 auto;padding:24px 16px 50px}.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:24px}
.gc{border-radius:18px;padding:22px;color:#fff;background:linear-gradient(135deg,var(--c),color-mix(in srgb,var(--c) 55%,#000));aspect-ratio:1.6;display:flex;flex-direction:column;justify-content:space-between;margin-bottom:18px;box-shadow:0 12px 30px color-mix(in srgb,var(--c) 30%,transparent)}
.gc .biz{font-weight:700;opacity:.9}.gc .amt{font-size:2.4rem;font-weight:800;line-height:1}.gc .code{font:600 1.15rem ui-monospace,Menlo,monospace;letter-spacing:.08em}
h1{margin:0 0 6px;font-size:1.5rem}.muted{color:var(--muted);font-size:.9rem}label{display:block;font-weight:600;margin:14px 0 6px;font-size:.92rem}
input,select,textarea{width:100%;font:inherit;color:inherit;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:11px}
.amts{display:flex;flex-wrap:wrap;gap:8px}.amts label{margin:0;font-weight:700}.amts input{position:absolute;opacity:0;width:1px}.amts span{display:block;padding:11px 18px;border:2px solid var(--line);border-radius:12px;cursor:pointer}
.amts input:checked+span{border-color:var(--c);background:color-mix(in srgb,var(--c) 10%,var(--panel))}.amts input:focus-visible+span{outline:2px solid var(--c)}
.seg{display:flex;gap:8px}.seg label{flex:1;margin:0}.seg span{display:block;text-align:center;padding:10px;border:2px solid var(--line);border-radius:12px;cursor:pointer;font-weight:600}.seg input{position:absolute;opacity:0;width:1px}.seg input:checked+span{border-color:var(--c)}
button{display:block;width:100%;margin-top:20px;padding:15px;border:0;border-radius:14px;background:var(--c);color:#fff;font:inherit;font-weight:700;font-size:1.08rem;cursor:pointer}
.err{margin:14px 0;padding:12px 14px;border-radius:12px;background:#fdecec;color:#7f1d1d}.hp{position:absolute;left:-9999px}.big{font-size:1.6rem;font-weight:800}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}
function buyPage({ bizId, error, values = {} } = {}) {
  const s = settings();
  const b = (bizId && businesses().get(bizId)) || businesses().all()[0] || {};
  const pick = values.amount || String(s.amounts[1] ?? s.amounts[0]);
  const someone = values.for === 'someone';
  return shell(b, `Gift cards${b.name ? ` · ${b.name}` : ''}`, `<div class="gc"><div class="biz">${esc(b.name || '')}</div><div><div class="muted" style="color:#fff;opacity:.8">Gift card</div><div class="amt" id="show">${money(Number(pick) || 0)}</div></div></div>
<div class="card"><h1>Give a gift card</h1><p class="muted">Pay by card. The gift card code is emailed right away and works on anything we sell.</p>
${error ? `<div class="err">${esc(error)}</div>` : ''}
<form method="post" id="gf"><input type="hidden" name="b" value="${esc(values.b || bizId || '')}">
<label>Amount</label><div class="amts">${s.amounts.map((a) => `<label><input type="radio" name="amount" value="${a}"${String(a) === pick ? ' checked' : ''}><span>${money(a).replace('.00', '')}</span></label>`).join('')}
${s.custom ? `<label><input type="radio" name="amount" value="other"${pick === 'other' ? ' checked' : ''}><span>Other</span></label>` : ''}</div>
${s.custom ? `<div id="oth"${pick === 'other' ? '' : ' hidden'}><label for="o">Other amount <span class="muted">(${money(s.min)} to ${money(s.max)})</span></label><input id="o" name="other" inputmode="decimal" value="${esc(values.other)}"></div>` : ''}
<label>Who is it for?</label><div class="seg"><label><input type="radio" name="for" value="me"${someone ? '' : ' checked'}><span>Me</span></label><label><input type="radio" name="for" value="someone"${someone ? ' checked' : ''}><span>Someone else</span></label></div>
<div id="to"${someone ? '' : ' hidden'}><label for="tn">Their name</label><input id="tn" name="to_name" maxlength="80" value="${esc(values.to_name)}">
<label for="te">Their email <span class="muted">(we email them the gift card)</span></label><input id="te" name="to_email" type="email" maxlength="200" value="${esc(values.to_email)}">
<label for="m">A note to them <span class="muted">(optional)</span></label><textarea id="m" name="message" rows="2" maxlength="500">${esc(values.message)}</textarea></div>
<label for="n">Your name</label><input id="n" name="name" required maxlength="80" autocomplete="name" value="${esc(values.name)}">
<label for="e">Your email <span class="muted">(for your receipt)</span></label><input id="e" name="email" type="email" required maxlength="200" autocomplete="email" value="${esc(values.email)}">
<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<button type="submit" id="go"${s.stripe ? '' : ' disabled'}>Pay with card</button>
<p class="muted" style="text-align:center">${s.stripe ? '🔒 You pay on a secure Stripe page.' : 'Card payments are not set up yet.'}</p></form></div>
<script>(function(){var f=document.getElementById('gf'),o=document.getElementById('oth'),t=document.getElementById('to'),sh=document.getElementById('show'),g=document.getElementById('go');
function u(){var a=f.querySelector('[name=amount]:checked'),v=a?a.value:'';if(o)o.hidden=v!=='other';var n=v==='other'?parseFloat((f.other.value||'').replace(/[$,]/g,'')):parseFloat(v);
sh.textContent='$'+(n>0?n.toFixed(2):'0.00');g.textContent=n>0?'Pay $'+n.toFixed(2)+' with card':'Pay with card';var s=f.querySelector('[name=for]:checked').value==='someone';t.hidden=!s;f.to_name.required=s;f.to_email.required=s}
f.addEventListener('input',u);f.addEventListener('change',u);u()})();</script>`);
}
function cardPage(c) {
  const b = (c.business_id && businesses().get(c.business_id)) || businesses().all()[0] || {};
  const st = c.status === 'void' ? 'This gift card was cancelled.' : c.status === 'pending' ? 'This gift card is waiting for its payment to go through.' : c.balance > 0 ? `${money(c.balance)} left to spend` : 'All used up. Thank you!';
  return shell(b, `Gift card · ${b.name || ''}`, `<div class="gc"><div class="biz">${esc(b.name || '')}</div><div><div class="amt">${money(c.status === 'active' ? c.balance : 0)}</div><div class="code" style="margin-top:8px">${esc(c.code)}</div></div></div>
<div class="card"><div class="big">${esc(st)}</div>${c.to_name ? `<p class="muted">For ${esc(c.to_name)}. Started at ${money(c.amount)}.</p>` : ''}${c.message ? `<p>"${nl(c.message)}"</p>` : ''}
<p>To use it, type the code <b>${esc(c.code)}</b> in the gift card box when you pay one of our invoices or buy online.</p></div>`);
}

function publicRouter() {
  const r = express.Router();
  r.use(express.urlencoded({ extended: false, limit: '20kb' }));
  const page = (res, html, status = 200) => res.status(status).set('Cache-Control', 'no-store').type('html').send(html);
  const nope = (res) => page(res, '<meta name="viewport" content="width=device-width, initial-scale=1"><p style="font:18px system-ui;padding:20px">This page is not available.</p>', 404);
  r.get('/card/:code', (req, res) => { const c = byCode(req.params.code); if (!c) return nope(res); page(res, cardPage(c)); });
  r.get('/', (req, res) => { if (!settings().on) return nope(res); page(res, buyPage({ bizId: Number(req.query.b) || null })); });
  r.post('/', async (req, res) => {
    if (!settings().on) return nope(res);
    if (req.body.website) return page(res, buyPage());
    if (crm().tooMany(String(req.get('cf-connecting-ip') || req.ip))) return page(res, buyPage({ error: 'Too many tries. Please wait a bit.', values: req.body }), 429);
    try { const out = await buy({ ...req.body, ref: require('./referrals').fromReq(req) }); res.redirect(303, out.url); }
    catch (x) { page(res, buyPage({ bizId: Number(req.body.b) || null, error: x.message, values: req.body }), x.status || 500); }
  });
  return r;
}

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req) => list(req.query.biz)));
router.put('/settings', wrap((req) => saveSettings(req.body || {})));
router.get('/lookup', wrap((req) => { const c = byCode(req.query.code); if (!c) throw err('No gift card with that code.', 404); return detail(c.id); }));
router.get('/:id', wrap((req) => detail(req.params.id)));
router.post('/', wrap((req) => give(req.body || {}, req.query.biz)));
router.post('/:id/void', wrap((req) => voidCard(req.params.id)));
router.post('/:id/resend', wrap(async (req) => ({ emailed: await emailCard(db.prepare('SELECT * FROM crm_gift_cards WHERE id=?').get(Number(req.params.id))) })));

module.exports = { settings, saveSettings, list, give, buy, onPaid, applyToInvoice, usable, refundInvoice, voidCard, detail, forContact, invoiceForm, anyActive, normal, publicRouter, router };
