// Quotes (estimates) with an online signature. Make a quote for a person, send the link, and
// they read it on their phone, type their name and sign with a finger. A signed quote turns
// into an invoice with one press (or by itself, if you tick "make the invoice when signed").
//
// The signature is a simple electronic signature: we keep their typed name, the drawing, the
// date and time, and the internet address it came from, and show "Signed by ... on ..." on
// the quote. Their consent to sign electronically is part of the signing box.
const express = require('express');
const crypto = require('crypto');
const db = require('../../src/db');
const config = require('../../src/config');
const notify = require('../../src/notify');
const email = require('./email');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_quotes (
  id INTEGER PRIMARY KEY,
  number INTEGER NOT NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  business_id INTEGER,
  title TEXT,
  items TEXT NOT NULL DEFAULT '[]',
  tax_rate REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',    -- draft, sent, accepted, declined, void
  valid_until TEXT,                        -- YYYY-MM-DD
  terms TEXT,
  note TEXT,
  auto_invoice INTEGER NOT NULL DEFAULT 1, -- make (and email) the invoice when signed
  token TEXT NOT NULL UNIQUE,
  sent_at TEXT, viewed_at TEXT,
  signed_name TEXT, signed_at TEXT, signed_ip TEXT, signed_agent TEXT, signature TEXT,
  declined_reason TEXT,
  invoice_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
const crm = () => require('./crm');
const businesses = () => require('./businesses');
const invoices = () => require('./invoices');
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const money = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const linkFor = (q) => `${config.publicBaseUrl}/quote/${q.token}`;
const today = () => new Date().toISOString().slice(0, 10);
const DEFAULT_TERMS = 'This quote is good until the date shown. Work starts once it is signed. The final invoice matches this quote unless we both agree to changes.';

const parse = (r) => (r ? { ...r, items: (() => { try { return JSON.parse(r.items) || []; } catch { return []; } })() } : null);
const get = (id) => parse(db.prepare('SELECT * FROM crm_quotes WHERE id=?').get(Number(id)));
const byToken = (t) => parse(db.prepare('SELECT * FROM crm_quotes WHERE token=?').get(String(t)));
function withExtras(q, { signature = false } = {}) {
  if (!q) return null;
  const c = q.contact_id ? db.prepare('SELECT id, name, company, email, phone, address, group_name FROM contacts WHERE id=?').get(q.contact_id) : null;
  const b = q.business_id ? businesses().get(q.business_id) : (c ? businesses().ownerOf(c.group_name) : null);
  const expired = q.status === 'sent' && q.valid_until && q.valid_until < today();
  const inv = q.invoice_id ? invoices().get(q.invoice_id) : null;
  const out = { ...q, ...invoices().sums(q.items, q.tax_rate), contact: c, link: linkFor(q), label: expired ? 'expired' : q.status,
    business: b ? { id: b.id, name: b.name, color: b.color, email: b.email, phone: b.phone, address: b.address, website: b.website } : null,
    invoice: inv ? { id: inv.id, number: inv.number, status: inv.status, link: `${config.publicBaseUrl}/invoice/${inv.token}` } : null };
  if (!signature) { out.hasSignature = Boolean(q.signature); delete out.signature; }
  return out;
}

function save(body = {}, id) {
  const old = id ? get(id) : null;
  if (id && !old) throw err('Quote not found', 404);
  if (old && !['draft', 'sent'].includes(old.status)) throw err('A signed, declined or cancelled quote can\'t be changed. Make a new one.');
  const c = db.prepare('SELECT * FROM contacts WHERE id=?').get(Number(body.contact_id ?? old?.contact_id));
  if (!c) throw err('Pick who the quote is for.');
  const items = body.items ? invoices().cleanItems(body.items) : old.items;
  const taxRate = body.tax_rate == null || body.tax_rate === '' ? (old ? old.tax_rate : 0) : Number(body.tax_rate);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 50) throw err('Tax must be a percent between 0 and 50.');
  const pickText = (k, n) => (k in body ? String(body[k] || '').trim().slice(0, n) || null : (old ? old[k] : null));
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(body.valid_until || '') ? body.valid_until : body.valid_until === '' ? null
    : (old ? old.valid_until : new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10));
  const { total } = invoices().sums(items, taxRate);
  if (total <= 0) throw err('The total must be more than $0.');
  const auto = 'auto_invoice' in body ? (body.auto_invoice ? 1 : 0) : (old ? old.auto_invoice : 1);
  const row = { contact_id: c.id, business_id: businesses().ownerOf(c.group_name)?.id || null, title: pickText('title', 120), items: JSON.stringify(items), tax_rate: taxRate,
    total, valid_until: valid, terms: 'terms' in body ? pickText('terms', 3000) : (old ? old.terms : DEFAULT_TERMS), note: pickText('note', 1000), auto_invoice: auto };
  if (old) {
    db.prepare(`UPDATE crm_quotes SET contact_id=@contact_id, business_id=@business_id, title=@title, items=@items, tax_rate=@tax_rate, total=@total,
      valid_until=@valid_until, terms=@terms, note=@note, auto_invoice=@auto_invoice WHERE id=@id`).run({ ...row, id: old.id });
    return withExtras(get(old.id));
  }
  const number = (db.prepare('SELECT MAX(number) AS n FROM crm_quotes').get().n || 1000) + 1;
  const r = db.prepare(`INSERT INTO crm_quotes (number, contact_id, business_id, title, items, tax_rate, total, valid_until, terms, note, auto_invoice, token)
    VALUES (@number,@contact_id,@business_id,@title,@items,@tax_rate,@total,@valid_until,@terms,@note,@auto_invoice,@token)`)
    .run({ ...row, number, token: crypto.randomBytes(18).toString('base64url') });
  return withExtras(get(r.lastInsertRowid));
}

function list({ biz, status } = {}) {
  const f = businesses().filter(biz, 'c.group_name');
  const rows = db.prepare(`SELECT q.* FROM crm_quotes q LEFT JOIN contacts c ON c.id=q.contact_id ${f.sql ? `WHERE ${f.sql}` : ''} ORDER BY q.id DESC LIMIT 500`).all(...f.args)
    .map((r) => withExtras(parse(r)));
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  return {
    quotes: status ? rows.filter((r) => r.label === status) : rows,
    totals: {
      waiting: rows.filter((r) => r.label === 'sent').reduce((n, r) => n + r.total, 0),
      waitingCount: rows.filter((r) => r.label === 'sent').length,
      signed30: rows.filter((r) => r.status === 'accepted' && r.signed_at >= since).reduce((n, r) => n + r.total, 0),
      winRate: (() => { const done = rows.filter((r) => ['accepted', 'declined'].includes(r.status)); return done.length ? Math.round(100 * done.filter((r) => r.status === 'accepted').length / done.length) : null; })(),
      drafts: rows.filter((r) => r.status === 'draft').length,
    },
  };
}

async function send(id, { by = 'email', message } = {}, opts = {}) {
  const q = withExtras(get(id));
  if (!q) throw err('Quote not found', 404);
  if (!['draft', 'sent'].includes(q.status)) throw err('This quote was already signed, declined or cancelled.');
  const c = q.contact;
  if (by === 'email') {
    if (!c || !c.email) throw err('This person has no email address. Copy the link and text it instead.');
    const first = String(c.name).split(' ')[0];
    const text = `${String(message || '').trim() || `Hi ${first},\n\nHere is your quote${q.title ? ` for ${q.title}` : ''}${q.business ? ` from ${q.business.name}` : ''}: ${money(q.total)}.`}\n\nYou can read it and sign it on your phone here:\n${q.link}\n\nThank you!`;
    await email.sendDirect({ to: c.email, toName: c.name, subject: `Quote #${q.number}${q.title ? `: ${q.title}` : ''}${q.business ? ` from ${q.business.name}` : ''}`, text }, opts);
  }
  db.prepare("UPDATE crm_quotes SET status='sent', sent_at=? WHERE id=?").run(new Date().toISOString(), q.id);
  if (c) crm().logActivity(c.id, { kind: 'Payment', note: `Quote #${q.number} for ${money(q.total)} ${by === 'email' ? 'emailed' : 'marked as sent'}` });
  return withExtras(get(q.id));
}

// Makes the invoice for a signed quote (once).
async function toInvoice(id, { sendIt = false } = {}, opts = {}) {
  const q = get(id);
  if (!q) throw err('Quote not found', 404);
  if (q.invoice_id && invoices().get(q.invoice_id)) return withExtras(q);
  if (!q.contact_id) throw err('The person on this quote was removed.');
  const due = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const inv = invoices().save({ contact_id: q.contact_id, items: q.items, tax_rate: q.tax_rate, due_date: due, note: `For quote #${q.number}${q.title ? `: ${q.title}` : ''}${q.note ? `\n${q.note}` : ''}` });
  db.prepare('UPDATE crm_quotes SET invoice_id=? WHERE id=?').run(inv.id, q.id);
  if (sendIt) {
    try { await invoices().send(inv.id, { by: 'email' }, opts); } catch { /* no email: the invoice stays a draft, you send it */ }
  }
  return withExtras(get(q.id));
}

async function accept(token, { name, signature, agree, ip, agent } = {}, opts = {}) {
  const q = byToken(token);
  if (!q || !['sent'].includes(q.status)) throw err('This quote can\'t be signed right now.', 404);
  if (q.valid_until && q.valid_until < today()) throw err('This quote has expired. Please ask for a new one.');
  name = String(name || '').trim().slice(0, 120);
  if (name.length < 2) throw err('Type your full name to sign.');
  if (!agree) throw err('Tick the box to agree.');
  const sig = String(signature || '');
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig) || sig.length < 400) throw err('Sign in the box with your finger or mouse.');
  if (sig.length > 400000) throw err('That signature is too big. Please clear it and sign again.');
  db.prepare("UPDATE crm_quotes SET status='accepted', signed_name=?, signed_at=?, signed_ip=?, signed_agent=?, signature=? WHERE id=?")
    .run(name, new Date().toISOString(), String(ip || '').slice(0, 60), String(agent || '').slice(0, 300), sig, q.id);
  const c = q.contact_id ? db.prepare('SELECT * FROM contacts WHERE id=?').get(q.contact_id) : null;
  if (c) {
    crm().logActivity(c.id, { kind: 'Payment', note: `Signed quote #${q.number} for ${money(q.total)} (signed as "${name}")` });
    crm().emit('quote_signed', { contact: crm().getContact(c.id), form: `Quote #${q.number}` });
  }
  notify.send('Quote signed!', `${c ? c.name : name} signed quote #${q.number} for ${money(q.total)}.`, { tags: 'tada', priority: 'high' }).catch(() => {});
  if (q.auto_invoice) await toInvoice(q.id, { sendIt: true }, opts).catch((e) => console.error(`[quotes] invoice: ${e.message}`));
  return withExtras(get(q.id));
}
function decline(token, reason) {
  const q = byToken(token);
  if (!q || q.status !== 'sent') throw err('This quote can\'t be changed right now.', 404);
  db.prepare("UPDATE crm_quotes SET status='declined', declined_reason=?, signed_at=? WHERE id=?").run(String(reason || '').trim().slice(0, 500) || null, new Date().toISOString(), q.id);
  const c = q.contact_id ? db.prepare('SELECT name FROM contacts WHERE id=?').get(q.contact_id) : null;
  if (q.contact_id) crm().logActivity(q.contact_id, { kind: 'Note', note: `Said no to quote #${q.number}${reason ? `: "${String(reason).slice(0, 200)}"` : ''}` });
  notify.send('Quote declined', `${c ? c.name : 'Someone'} said no to quote #${q.number}${reason ? `: "${String(reason).slice(0, 120)}"` : ''}.`, { tags: 'memo' }).catch(() => {});
  return withExtras(get(q.id));
}
function setStatus(id, status) {
  const q = get(id);
  if (!q) throw err('Quote not found', 404);
  if (status === 'void') { if (q.status === 'accepted') throw err('A signed quote can\'t be cancelled. Cancel its invoice instead.'); }
  else if (status === 'sent') { if (!['declined', 'void'].includes(q.status)) throw err('Only a declined or cancelled quote can be opened again.'); }
  else throw err('Unknown status');
  db.prepare(`UPDATE crm_quotes SET status=?${status === 'sent' ? ', declined_reason=NULL, signed_at=NULL' : ''} WHERE id=?`).run(status, q.id);
  return withExtras(get(q.id));
}
function remove(id) {
  const q = get(id);
  if (q && q.status !== 'draft') throw err('Only a draft can be deleted. Cancel a sent quote instead.');
  db.prepare('DELETE FROM crm_quotes WHERE id=?').run(Number(id));
  return { ok: true };
}

// ---------- The customer's quote page (/quote/<secret link>) ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = (s) => esc(s).replace(/\n/g, '<br>');
function page(q, { notice } = {}) {
  const b = q.business || { name: 'Quote', color: '#4f46e5' };
  const c = q.contact || {};
  const date = (iso) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');
  const badge = { accepted: ['Signed', '#16a34a'], declined: ['Declined', '#6b7280'], void: ['Cancelled', '#6b7280'], expired: ['Expired', '#d97706'], sent: ['Waiting for you', b.color] }[q.label] || ['Quote', b.color];
  const canSign = q.label === 'sent';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Quote #${q.number} · ${esc(b.name)}</title>
<style>
:root{--c:${esc(b.color)};--bg:#f5f6fb;--panel:#fff;--text:#171a24;--muted:#6a7184;--line:#e4e7ef}
@media (prefers-color-scheme:dark){:root{--bg:#0f1117;--panel:#181b24;--text:#eceef4;--muted:#9aa1b4;--line:#2a2f3c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:28px 16px 60px}.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:28px;box-shadow:0 4px 20px rgb(16 24 40/.06)}
.top{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;border-top:6px solid var(--c);margin:-28px -28px 22px;padding:24px 28px 0;border-radius:18px 18px 0 0}
h1{margin:0;font-size:1.5rem}h2{font-size:1.1rem;margin:26px 0 8px}.muted{color:var(--muted)}.small{font-size:.88rem}.badge{display:inline-block;padding:4px 12px;border-radius:999px;color:#fff;font-weight:700;font-size:.85rem;background:${badge[1]}}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:18px 0}table{width:100%;border-collapse:collapse;margin:8px 0 4px}th,td{padding:10px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}td.n,th.n{text-align:right;white-space:nowrap}.sum{margin-left:auto;max-width:280px}.sum div{display:flex;justify-content:space-between;padding:4px 6px}
.total{font-size:1.3rem;font-weight:800;border-top:2px solid var(--text);margin-top:4px;padding-top:8px!important}
.note{margin-top:18px;padding:14px 16px;border-radius:12px;background:color-mix(in srgb,var(--c) 9%,var(--panel))}.terms{font-size:.92rem;color:var(--muted);white-space:normal}
.ok{margin-bottom:16px;padding:14px 16px;border-radius:12px;background:#e7f7ec;color:#14532d;font-weight:600}.err{margin-bottom:16px;padding:14px 16px;border-radius:12px;background:#fdecec;color:#7f1d1d}
.sign{margin-top:22px;padding:18px;border:2px solid var(--c);border-radius:16px}label{display:block;font-weight:600;margin:12px 0 6px}
input[type=text],textarea{width:100%;font:inherit;color:inherit;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:11px}
canvas{display:block;width:100%;height:170px;border:1px dashed var(--muted);border-radius:12px;background:#fff;touch-action:none;cursor:crosshair}
.check{display:flex;gap:10px;align-items:flex-start;font-weight:400}.check input{margin-top:5px;width:18px;height:18px}
.btn{display:block;width:100%;margin-top:16px;padding:15px;border:0;border-radius:14px;background:var(--c);color:#fff;font:inherit;font-weight:700;font-size:1.1rem;cursor:pointer}
.link{background:none;border:0;color:var(--muted);text-decoration:underline;font:inherit;cursor:pointer;padding:0}.row{display:flex;justify-content:space-between;align-items:center;gap:10px}
.signed img{max-width:260px;height:auto;background:#fff;border-radius:8px;border:1px solid var(--line)}footer{text-align:center;margin-top:18px}
details{margin-top:14px}summary{cursor:pointer;color:var(--muted)}
@media (max-width:560px){.card{padding:20px}.top{margin:-20px -20px 18px;padding:20px 20px 0}.two{grid-template-columns:1fr}}
@media print{.sign,footer,details{display:none}body{background:#fff}.card{border:0;box-shadow:none}}
</style></head><body><div class="wrap">
${notice ? `<div class="${notice.ok ? 'ok' : 'err'}">${esc(notice.text)}</div>` : ''}
<div class="card"><div class="top"><div><h1>${esc(b.name)}</h1><div class="muted small">${[b.address, b.phone, b.email, b.website].filter(Boolean).map(esc).join('<br>')}</div></div>
<div style="text-align:right"><div class="muted small">Quote</div><div style="font-size:1.4rem;font-weight:800">#${q.number}</div><span class="badge">${badge[0]}</span></div></div>
${q.title ? `<h2 style="margin-top:0">${esc(q.title)}</h2>` : ''}
<div class="two"><div><div class="muted small">Prepared for</div><b>${esc(c.name || '')}</b>${c.company && c.company !== c.name ? `<br>${esc(c.company)}` : ''}</div>
<div><div class="muted small">Good until</div><b>${q.valid_until ? date(q.valid_until) : 'No end date'}</b><div class="muted small">Sent ${date(q.sent_at || `${q.created_at.replace(' ', 'T')}Z`)}</div></div></div>
<table><thead><tr><th>What</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr></thead><tbody>
${q.items.map((i) => `<tr><td>${esc(i.what)}</td><td class="n">${i.qty}</td><td class="n">${money(i.price)}</td><td class="n">${money(i.qty * i.price)}</td></tr>`).join('')}
</tbody></table><div class="sum">${q.tax ? `<div><span>Subtotal</span><span>${money(q.subtotal)}</span></div><div><span>Tax (${q.tax_rate}%)</span><span>${money(q.tax)}</span></div>` : ''}
<div class="total"><span>Total</span><span>${money(q.total)}</span></div></div>
${q.note ? `<div class="note">${nl(q.note)}</div>` : ''}
${q.terms ? `<h2>Terms</h2><div class="terms">${nl(q.terms)}</div>` : ''}
${q.status === 'accepted' ? `<div class="sign signed"><b>Signed by ${esc(q.signed_name)}</b><div class="muted small">${new Date(q.signed_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}</div>
  ${q.signature ? `<img src="${esc(q.signature)}" alt="Signature of ${esc(q.signed_name)}">` : ''}
  ${q.invoice && q.invoice.status !== 'draft' ? `<p><a href="../invoice/${esc(String(q.invoice.link).split('/invoice/')[1])}"><b>View and pay invoice #${q.invoice.number}</b></a></p>` : ''}</div>` : ''}
${q.status === 'declined' ? '<div class="note">You said no to this quote. Changed your mind? Just reply to the email this came in.</div>' : ''}
${canSign ? `<form class="sign" method="post" action="${esc(q.token)}/accept" id="sign-form"><b style="font-size:1.1rem">Accept and sign</b>
  <label for="nm">Your full name</label><input type="text" id="nm" name="name" required maxlength="120" autocomplete="name" value="${esc(c.name || '')}">
  <div class="row"><label style="margin-bottom:6px">Sign here</label><button type="button" class="link" id="clear">Clear</button></div>
  <canvas id="pad" aria-label="Signature box: draw your signature"></canvas><input type="hidden" name="signature" id="sig">
  <label class="check"><input type="checkbox" name="agree" value="1" required> <span>I accept this quote and its terms, and I agree to sign it electronically. My typed name and signature count as my signature.</span></label>
  <button class="btn" type="submit">Sign and accept ${money(q.total)}</button></form>
  <details><summary>Not a fit? Tell us why</summary><form method="post" action="${esc(q.token)}/decline"><label for="why">What would you change? <span class="muted small">(optional)</span></label>
  <textarea id="why" name="reason" rows="3" maxlength="500"></textarea><button class="btn" type="submit" style="background:#6b7280">Say no to this quote</button></form></details>` : ''}
</div><footer class="muted small">Questions? Reply to the email this came in${b.phone ? ` or call ${esc(b.phone)}` : ''}.</footer></div>
${canSign ? `<script>
(() => {
  const c = document.getElementById('pad'), x = c.getContext('2d'); let drawn = false, down = false, last = null;
  function size() { const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1; c.width = r.width * d; c.height = r.height * d; x.scale(d, d); x.lineWidth = 2.4; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = '#111'; drawn = false; }
  size(); addEventListener('resize', () => { if (!drawn) size(); });
  const pt = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  c.addEventListener('pointerdown', (e) => { down = true; last = pt(e); c.setPointerCapture(e.pointerId); x.beginPath(); x.arc(last[0], last[1], 1.1, 0, 7); x.fillStyle = '#111'; x.fill(); drawn = true; });
  c.addEventListener('pointermove', (e) => { if (!down) return; const p = pt(e); x.beginPath(); x.moveTo(last[0], last[1]); x.lineTo(p[0], p[1]); x.stroke(); last = p; drawn = true; });
  addEventListener('pointerup', () => { down = false; });
  document.getElementById('clear').onclick = () => { x.clearRect(0, 0, c.width, c.height); drawn = false; };
  document.getElementById('sign-form').addEventListener('submit', (e) => {
    if (!drawn) { e.preventDefault(); alert('Please sign in the box first.'); return; }
    document.getElementById('sig').value = c.toDataURL('image/png');
  });
})();
</script>` : ''}</body></html>`;
}

const notAvailable = (res) => res.status(404).send('<meta name="viewport" content="width=device-width, initial-scale=1"><p style="font:18px system-ui;padding:20px">This quote is not available.</p>');
function publicRouter() {
  const r = express.Router();
  r.use(express.urlencoded({ extended: false, limit: '600kb' }));
  r.get('/:token', (req, res) => {
    const q = byToken(req.params.token);
    if (!q || q.status === 'draft') return notAvailable(res);
    if (!q.viewed_at && q.status === 'sent') {
      db.prepare('UPDATE crm_quotes SET viewed_at=? WHERE id=?').run(new Date().toISOString(), q.id);
      const c = q.contact_id ? db.prepare('SELECT name FROM contacts WHERE id=?').get(q.contact_id) : null;
      if (c) {
        crm().logActivity(q.contact_id, { kind: 'Note', note: `Opened quote #${q.number}` });
        notify.send('Quote opened', `${c.name} is looking at quote #${q.number} right now.`, { tags: 'eyes' }).catch(() => {});
      }
    }
    const notice = req.query.signed ? { ok: true, text: 'Thank you! Your quote is signed. We sent you a copy.' } : req.query.declined ? { ok: true, text: 'Thanks for letting us know.' }
      : req.query.error ? { ok: false, text: String(req.query.error).slice(0, 200) } : null;
    res.set('Cache-Control', 'no-store').type('html').send(page(withExtras(byToken(req.params.token), { signature: true }), { notice }));
  });
  r.post('/:token/accept', async (req, res) => {
    const t = encodeURIComponent(req.params.token);
    if (require('./crm').tooMany(String(req.get('cf-connecting-ip') || req.ip))) return res.redirect(303, `../${t}?error=${encodeURIComponent('Too many tries. Please wait a bit.')}`);
    try {
      const q = await accept(req.params.token, { ...req.body, ip: req.get('cf-connecting-ip') || req.ip, agent: req.get('user-agent') });
      // A copy for them, by email, with the link to the signed quote.
      if (q.contact && q.contact.email && email.provider()) {
        email.sendDirect({ to: q.contact.email, toName: q.contact.name, subject: `Signed: quote #${q.number}${q.business ? ` from ${q.business.name}` : ''}`,
          text: `Hi ${String(q.contact.name).split(' ')[0]},\n\nThank you! You signed quote #${q.number} for ${money(q.total)}.\n\nYour signed copy:\n${q.link}${q.invoice ? `\n\nYour invoice:\n${q.invoice.link}` : ''}` }).catch(() => {});
      }
      res.redirect(303, `../${t}?signed=1`);
    } catch (e) { res.redirect(303, `../${t}?error=${encodeURIComponent(e.message)}`); }
  });
  r.post('/:token/decline', (req, res) => {
    const t = encodeURIComponent(req.params.token);
    try { decline(req.params.token, req.body.reason); res.redirect(303, `../${t}?declined=1`); } catch (e) { res.redirect(303, `../${t}?error=${encodeURIComponent(e.message)}`); }
  });
  return r;
}

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req) => list(req.query)));
router.get('/:id', wrap((req) => { const q = withExtras(get(req.params.id), { signature: true }); if (!q) throw err('Quote not found', 404); return q; }));
router.post('/', wrap((req) => save(req.body || {})));
router.put('/:id', wrap((req) => save(req.body || {}, Number(req.params.id))));
router.post('/:id/send', wrap((req) => send(req.params.id, req.body || {})));
router.post('/:id/invoice', wrap((req) => toInvoice(req.params.id, { sendIt: Boolean((req.body || {}).send) })));
router.post('/:id/status', wrap((req) => setStatus(req.params.id, (req.body || {}).status)));
router.delete('/:id', wrap((req) => remove(req.params.id)));

module.exports = { save, list, send, accept, decline, toInvoice, setStatus, remove, publicRouter, router, get, withExtras, DEFAULT_TERMS };
