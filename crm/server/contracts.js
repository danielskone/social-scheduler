// Contracts to sign. Pick a ready-made agreement (or write your own), choose the person, and send
// the link. They read it on their phone, type their name and sign with a finger. You get a buzz,
// they get a signed copy by email, and the contact card shows it.
//
// Like quotes, this is a simple electronic signature: we keep their typed name, the drawing, the
// date and time, the internet address, and a fingerprint (hash) of the exact words they signed,
// so nobody can change the words later without it showing.
const express = require('express');
const crypto = require('crypto');
const db = require('../../src/db');
const config = require('../../src/config');
const notify = require('../../src/notify');
const email = require('./email');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_contracts (
  id INTEGER PRIMARY KEY,
  number INTEGER NOT NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  business_id INTEGER,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft, sent, signed, void
  token TEXT NOT NULL UNIQUE,
  sent_at TEXT, viewed_at TEXT,
  signed_name TEXT, signed_at TEXT, signed_ip TEXT, signed_agent TEXT, signature TEXT, signed_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
const crm = () => require('./crm');
const businesses = () => require('./businesses');
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const linkFor = (k) => `${config.publicBaseUrl}/sign/${k.token}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const longDate = (d = new Date()) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

// Ready-made agreements. Plain words, short. Not legal advice: the screen says to have a lawyer
// look at anything important.
const TEMPLATES = [
  { key: 'service', title: 'Service agreement', body: `This agreement is between {business} ("we") and {name} ("you"), made on {date}.

1. The work. We will do the work described here: [write what you will do].

2. Price and payment. You will pay [amount]. [Write when it is due, for example: half to start, half when done.]

3. Timing. We plan to start on [date] and finish by [date]. If something outside our control slows us down, we will tell you right away.

4. Changes. If you want changes to the work, we will agree on them in writing (email is fine), including any change in price.

5. Ending early. Either of us can end this agreement with [7] days written notice. You pay for work done up to that day.

6. Our responsibility. We will do the work with care. Our total responsibility is limited to the amount you paid us under this agreement.

7. The whole agreement. This is our full agreement. Changes must be in writing and agreed by both of us.` },
  { key: 'photo', title: 'Photo and video release', body: `I, {name}, give {business} permission to take and use photos, video and voice recordings of me, made on or after {date}.

They may use them on their website, social media, ads, flyers and other marketing, without paying me, for as long as they want.

I will not ask to approve each use. I understand I can ask them in writing to stop using them in new posts, and they will stop in new posts within a reasonable time. Things already printed or posted may stay.

If I am signing for a child, I am their parent or legal guardian and I agree for them.` },
  { key: 'sponsor', title: 'Sponsor agreement', body: `This agreement is between {business} and {name} ("the sponsor"), made on {date}.

1. Sponsorship. The sponsor will pay [amount] for the [level name] sponsorship of [event name].

2. What the sponsor gets. [List it, for example: logo on the website, thank-you posts on social media, banner at the event, booth space.]

3. Payment. Payment is due by [date]. Benefits start once payment is received.

4. Logo and name. The sponsor gives {business} permission to use their name and logo to promote the event. The sponsor will send a good-quality logo.

5. If the event changes. If the event is moved or cancelled, we will offer the same benefits at the new date or the next event, or a fair refund for benefits not given.

6. The whole agreement. This is the full agreement. Changes must be in writing.` },
  { key: 'nda', title: 'Simple non-disclosure (keep it private)', body: `This agreement is between {business} and {name}, made on {date}.

1. Private information. Either of us may share private business information with the other, like prices, customer lists, plans and ideas.

2. Keep it private. We each agree to keep the other's private information secret, to use it only to work together, and to share it only with people who need it and keep it secret too.

3. Not private. This does not cover information that is already public, that we already knew, or that the law makes us share.

4. How long. This lasts for [2] years from today.

5. Giving it back. When asked, we will return or delete the other's private information.` },
  { key: 'blank', title: 'Blank (write your own)', body: '' },
];
function fill(text, { contact, business } = {}) {
  return String(text || '')
    .replace(/\{name\}/g, contact?.name || 'the person signing')
    .replace(/\{company\}/g, contact?.company || contact?.name || '')
    .replace(/\{email\}/g, contact?.email || '')
    .replace(/\{business\}/g, business?.name || 'us')
    .replace(/\{date\}/g, longDate());
}

const get = (id) => db.prepare('SELECT * FROM crm_contracts WHERE id=?').get(Number(id));
const byToken = (t) => db.prepare('SELECT * FROM crm_contracts WHERE token=?').get(String(t));
function withExtras(k, { signature = false } = {}) {
  if (!k) return null;
  const c = k.contact_id ? db.prepare('SELECT id, name, company, email, phone, group_name FROM contacts WHERE id=?').get(k.contact_id) : null;
  const b = k.business_id ? businesses().get(k.business_id) : (c ? businesses().ownerOf(c.group_name) : null);
  const out = { ...k, contact: c, link: linkFor(k),
    business: b ? { id: b.id, name: b.name, color: b.color, email: b.email, phone: b.phone, address: b.address, website: b.website } : null };
  if (!signature) { out.hasSignature = Boolean(k.signature); delete out.signature; }
  return out;
}

function save(body = {}, id) {
  const old = id ? get(id) : null;
  if (id && !old) throw err('Contract not found', 404);
  if (old && old.status !== 'draft' && old.status !== 'sent') throw err('A signed or cancelled contract can\'t be changed. Make a new one.');
  const c = db.prepare('SELECT * FROM contacts WHERE id=?').get(Number(body.contact_id ?? old?.contact_id));
  if (!c) throw err('Pick who signs this contract.');
  const tpl = body.template ? TEMPLATES.find((t) => t.key === body.template) : null;
  const title = String(body.title ?? old?.title ?? tpl?.title ?? '').trim().slice(0, 140);
  if (!title) throw err('Give the contract a name.');
  const text = String(body.body ?? old?.body ?? tpl?.body ?? '').replace(/\r\n/g, '\n').trim().slice(0, 40000);
  if (text.length < 20) throw err('Write the words of the contract (at least one sentence).');
  const row = { contact_id: c.id, business_id: businesses().ownerOf(c.group_name)?.id || null, title, body: text };
  if (old) {
    // Changing a sent contract puts it back to a draft, so they never sign words that moved.
    db.prepare("UPDATE crm_contracts SET contact_id=@contact_id, business_id=@business_id, title=@title, body=@body, status='draft' WHERE id=@id").run({ ...row, id: old.id });
    return withExtras(get(old.id));
  }
  const number = (db.prepare('SELECT MAX(number) AS n FROM crm_contracts').get().n || 100) + 1;
  const r = db.prepare('INSERT INTO crm_contracts (number, contact_id, business_id, title, body, token) VALUES (@number,@contact_id,@business_id,@title,@body,@token)')
    .run({ ...row, number, token: crypto.randomBytes(18).toString('base64url') });
  return withExtras(get(r.lastInsertRowid));
}

function list({ biz, contact } = {}) {
  const f = businesses().filter(biz, 'c.group_name');
  const where = [f.sql, contact ? 'k.contact_id=?' : ''].filter(Boolean);
  const rows = db.prepare(`SELECT k.* FROM crm_contracts k LEFT JOIN contacts c ON c.id=k.contact_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY k.id DESC LIMIT 500`)
    .all(...f.args, ...(contact ? [Number(contact)] : [])).map((k) => withExtras(k));
  return { contracts: rows, templates: TEMPLATES.map(({ key, title }) => ({ key, title })),
    totals: { waiting: rows.filter((k) => k.status === 'sent').length, signed: rows.filter((k) => k.status === 'signed').length, drafts: rows.filter((k) => k.status === 'draft').length } };
}

async function send(id, { by = 'email', message } = {}, opts = {}) {
  const k = withExtras(get(id));
  if (!k) throw err('Contract not found', 404);
  if (!['draft', 'sent'].includes(k.status)) throw err('This contract was already signed or cancelled.');
  const c = k.contact;
  // Fill in the name, business and date now, so the words they read are the words they sign.
  const filled = fill(k.body, { contact: c, business: k.business });
  if (by === 'email') {
    if (!c || !c.email) throw err('This person has no email address. Copy the link and text it instead.');
    const first = String(c.name).split(' ')[0];
    const text = `${String(message || '').trim() || `Hi ${first},\n\nHere is the ${k.title.toLowerCase()}${k.business ? ` from ${k.business.name}` : ''} for you to sign.`}\n\nYou can read it and sign it on your phone here:\n${k.link}\n\nThank you!`;
    await email.sendDirect({ to: c.email, toName: c.name, subject: `Please sign: ${k.title}${k.business ? ` from ${k.business.name}` : ''}`, text }, opts);
  }
  db.prepare("UPDATE crm_contracts SET status='sent', body=?, sent_at=? WHERE id=?").run(filled, new Date().toISOString(), k.id);
  if (c) crm().logActivity(c.id, { kind: 'Note', note: `Contract "${k.title}" ${by === 'email' ? 'emailed' : 'marked as sent'} to sign` });
  return withExtras(get(k.id));
}

const hash = (k) => crypto.createHash('sha256').update(`${k.title}\n\n${k.body}`).digest('hex');
function sign(token, { name, signature, agree, ip, agent } = {}) {
  const k = byToken(token);
  if (!k || k.status !== 'sent') throw err('This contract can\'t be signed right now.', 404);
  name = String(name || '').trim().slice(0, 120);
  if (name.length < 2) throw err('Type your full name to sign.');
  if (!agree) throw err('Tick the box to agree.');
  const sig = String(signature || '');
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig) || sig.length < 400) throw err('Sign in the box with your finger or mouse.');
  if (sig.length > 400000) throw err('That signature is too big. Please clear it and sign again.');
  db.prepare("UPDATE crm_contracts SET status='signed', signed_name=?, signed_at=?, signed_ip=?, signed_agent=?, signature=?, signed_hash=? WHERE id=?")
    .run(name, new Date().toISOString(), String(ip || '').slice(0, 60), String(agent || '').slice(0, 300), sig, hash(k), k.id);
  const c = k.contact_id ? db.prepare('SELECT * FROM contacts WHERE id=?').get(k.contact_id) : null;
  if (c) {
    crm().logActivity(c.id, { kind: 'Note', note: `Signed contract "${k.title}" (signed as "${name}")` });
    crm().emit('contract_signed', { contact: crm().getContact(c.id), form: k.title });
  }
  notify.send('Contract signed!', `${c ? c.name : name} signed "${k.title}".`, { tags: 'tada', priority: 'high' }).catch(() => {});
  return withExtras(get(k.id));
}
function setStatus(id, status) {
  const k = get(id);
  if (!k) throw err('Contract not found', 404);
  if (status !== 'void') throw err('Unknown status');
  if (k.status === 'signed') throw err('A signed contract can\'t be cancelled here. Make a new one that replaces it.');
  db.prepare("UPDATE crm_contracts SET status='void' WHERE id=?").run(k.id);
  return withExtras(get(k.id));
}
function remove(id) {
  const k = get(id);
  if (k && k.status === 'signed') throw err('A signed contract is kept as a record and can\'t be deleted.');
  db.prepare('DELETE FROM crm_contracts WHERE id=?').run(Number(id));
  return { ok: true };
}
const forContact = (contactId) => db.prepare("SELECT id, number, title, status, token, signed_at, sent_at FROM crm_contracts WHERE contact_id=? AND status IN ('sent','signed') ORDER BY id DESC")
  .all(Number(contactId)).map((k) => ({ ...k, link: linkFor(k) }));

// ---------- The signing page (/sign/<secret link>) ----------
function paragraphs(text) {
  return String(text || '').split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}
function page(k, { notice } = {}) {
  const b = k.business || { name: 'Contract', color: '#4f46e5' };
  const c = k.contact || {};
  const canSign = k.status === 'sent';
  const badge = { signed: ['Signed', '#16a34a'], void: ['Cancelled', '#6b7280'], sent: ['Waiting for your signature', b.color] }[k.status] || ['Contract', b.color];
  const body = k.status === 'signed' ? k.body : fill(k.body, { contact: c, business: k.business });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(k.title)} · ${esc(b.name)}</title>
<style>
:root{--c:${esc(b.color)};--bg:#f5f6fb;--panel:#fff;--text:#171a24;--muted:#6a7184;--line:#e4e7ef}
@media (prefers-color-scheme:dark){:root{--bg:#0f1117;--panel:#181b24;--text:#eceef4;--muted:#9aa1b4;--line:#2a2f3c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:28px 16px 60px}.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:28px;box-shadow:0 4px 20px rgb(16 24 40/.06)}
.top{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;border-top:6px solid var(--c);margin:-28px -28px 22px;padding:24px 28px 0;border-radius:18px 18px 0 0}
h1{margin:0;font-size:1.4rem}h2{font-size:1.3rem;margin:4px 0 14px}.muted{color:var(--muted)}.small{font-size:.88rem}
.badge{display:inline-block;padding:4px 12px;border-radius:999px;color:#fff;font-weight:700;font-size:.85rem;background:${badge[1]}}
.words p{margin:0 0 14px}.ok{margin-bottom:16px;padding:14px 16px;border-radius:12px;background:#e7f7ec;color:#14532d;font-weight:600}
.err{margin-bottom:16px;padding:14px 16px;border-radius:12px;background:#fdecec;color:#7f1d1d}
.sign{margin-top:22px;padding:18px;border:2px solid var(--c);border-radius:16px}label{display:block;font-weight:600;margin:12px 0 6px}
input[type=text]{width:100%;font:inherit;color:inherit;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:11px}
canvas{display:block;width:100%;height:170px;border:1px dashed var(--muted);border-radius:12px;background:#fff;touch-action:none;cursor:crosshair}
.check{display:flex;gap:10px;align-items:flex-start;font-weight:400}.check input{margin-top:5px;width:18px;height:18px}
.btn{display:block;width:100%;margin-top:16px;padding:15px;border:0;border-radius:14px;background:var(--c);color:#fff;font:inherit;font-weight:700;font-size:1.1rem;cursor:pointer}
.link{background:none;border:0;color:var(--muted);text-decoration:underline;font:inherit;cursor:pointer;padding:0}.row{display:flex;justify-content:space-between;align-items:center;gap:10px}
.signed{margin-top:22px;padding:18px;border:1px solid var(--line);border-radius:16px}.signed img{max-width:260px;height:auto;background:#fff;border-radius:8px;border:1px solid var(--line)}
footer{text-align:center;margin-top:18px}.print{margin-top:12px}
@media (max-width:560px){.card{padding:20px}.top{margin:-20px -20px 18px;padding:20px 20px 0}}
@media print{.sign,footer,.print{display:none}body{background:#fff}.card{border:0;box-shadow:none}}
</style></head><body><div class="wrap">
${notice ? `<div class="${notice.ok ? 'ok' : 'err'}">${esc(notice.text)}</div>` : ''}
<div class="card"><div class="top"><div><h1>${esc(b.name)}</h1><div class="muted small">${[b.address, b.phone, b.email, b.website].filter(Boolean).map(esc).join('<br>')}</div></div>
<div style="text-align:right"><div class="muted small">Contract #${k.number}</div><span class="badge">${badge[0]}</span></div></div>
<h2>${esc(k.title)}</h2>
<div class="words">${paragraphs(body)}</div>
${k.status === 'signed' ? `<div class="signed"><b>Signed by ${esc(k.signed_name)}</b><div class="muted small">${new Date(k.signed_at).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}</div>
  ${k.signature ? `<img src="${esc(k.signature)}" alt="Signature of ${esc(k.signed_name)}">` : ''}
  <div class="muted small" style="margin-top:8px;word-break:break-all">Fingerprint of the signed words: ${esc(String(k.signed_hash || '').slice(0, 16))}</div>
  <button class="btn print" type="button" onclick="print()">Print or save as PDF</button></div>` : ''}
${k.status === 'void' ? '<div class="err">This contract was cancelled. Please ask for a new one if you still need it.</div>' : ''}
${canSign ? `<form class="sign" method="post" action="${esc(k.token)}/sign" id="sign-form"><b style="font-size:1.1rem">Sign this contract</b>
  <label for="nm">Your full name</label><input type="text" id="nm" name="name" required maxlength="120" autocomplete="name" value="${esc(c.name || '')}">
  <div class="row"><label style="margin-bottom:6px">Sign here</label><button type="button" class="link" id="clear">Clear</button></div>
  <canvas id="pad" aria-label="Signature box: draw your signature"></canvas><input type="hidden" name="signature" id="sig">
  <label class="check"><input type="checkbox" name="agree" value="1" required> <span>I read this contract and I agree to it. I agree to sign it electronically. My typed name and signature count as my signature.</span></label>
  <button class="btn" type="submit">Sign the contract</button></form>` : ''}
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

const notAvailable = (res) => res.status(404).send('<meta name="viewport" content="width=device-width, initial-scale=1"><p style="font:18px system-ui;padding:20px">This contract is not available.</p>');
function publicRouter() {
  const r = express.Router();
  r.use(express.urlencoded({ extended: false, limit: '600kb' }));
  r.get('/:token', (req, res) => {
    const k = byToken(req.params.token);
    if (!k || k.status === 'draft') return notAvailable(res);
    if (!k.viewed_at && k.status === 'sent') {
      db.prepare('UPDATE crm_contracts SET viewed_at=? WHERE id=?').run(new Date().toISOString(), k.id);
      const c = k.contact_id ? db.prepare('SELECT name FROM contacts WHERE id=?').get(k.contact_id) : null;
      if (c) {
        crm().logActivity(k.contact_id, { kind: 'Note', note: `Opened contract "${k.title}"` });
        notify.send('Contract opened', `${c.name} is reading "${k.title}" right now.`, { tags: 'eyes' }).catch(() => {});
      }
    }
    const notice = req.query.signed ? { ok: true, text: 'Thank you! The contract is signed. We emailed you a copy.' }
      : req.query.error ? { ok: false, text: String(req.query.error).slice(0, 200) } : null;
    res.set('Cache-Control', 'no-store').type('html').send(page(withExtras(byToken(req.params.token), { signature: true }), { notice }));
  });
  r.post('/:token/sign', (req, res) => {
    const t = encodeURIComponent(req.params.token);
    if (crm().tooMany(String(req.get('cf-connecting-ip') || req.ip))) return res.redirect(303, `../${t}?error=${encodeURIComponent('Too many tries. Please wait a bit.')}`);
    try {
      const k = sign(req.params.token, { ...req.body, ip: req.get('cf-connecting-ip') || req.ip, agent: req.get('user-agent') });
      if (k.contact && k.contact.email && email.provider()) {
        email.sendDirect({ to: k.contact.email, toName: k.contact.name, subject: `Signed: ${k.title}${k.business ? ` with ${k.business.name}` : ''}`,
          text: `Hi ${String(k.contact.name).split(' ')[0]},\n\nThank you! You signed "${k.title}".\n\nYour signed copy (you can print it or save it as a PDF):\n${k.link}` }).catch(() => {});
      }
      res.redirect(303, `../${t}?signed=1`);
    } catch (e) { res.redirect(303, `../${t}?error=${encodeURIComponent(e.message)}`); }
  });
  return r;
}

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req) => list(req.query)));
router.get('/templates', wrap(() => TEMPLATES.map(({ key, title }) => ({ key, title }))));
router.get('/templates/:key', wrap((req) => { const t = TEMPLATES.find((x) => x.key === req.params.key); if (!t) throw err('Not found', 404); return t; }));
router.get('/:id', wrap((req) => { const k = withExtras(get(req.params.id), { signature: true }); if (!k) throw err('Contract not found', 404); return k; }));
router.post('/', wrap((req) => save(req.body || {})));
router.put('/:id', wrap((req) => save(req.body || {}, Number(req.params.id))));
router.post('/:id/send', wrap((req) => send(req.params.id, req.body || {})));
router.post('/:id/status', wrap((req) => setStatus(req.params.id, (req.body || {}).status)));
router.delete('/:id', wrap((req) => remove(req.params.id)));

module.exports = { TEMPLATES, fill, save, list, send, sign, setStatus, remove, forContact, publicRouter, router, get, withExtras };
