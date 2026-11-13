// Customer portal. Each person gets a private link (no password to forget). It shows their
// invoices, quotes, appointments, booking pages and courses in one place. People can ask for
// a fresh link by typing their email at /portal, and you can copy or email it from their card.
const express = require('express');
const crypto = require('crypto');
const db = require('../../src/db');
const config = require('../../src/config');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_portal_tokens (
  token TEXT PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_portal_tokens_contact ON crm_portal_tokens(contact_id);
`);
const DAYS = 60;
const businesses = () => require('./businesses');
const crm = () => require('./crm');
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const money = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// A link for this person. Reuses one that still has more than a week left.
function tokenFor(contactId, now = Date.now()) {
  const c = db.prepare('SELECT id FROM contacts WHERE id=?').get(Number(contactId));
  if (!c) throw err('Person not found', 404);
  const old = db.prepare('SELECT token FROM crm_portal_tokens WHERE contact_id=? AND expires_at>? ORDER BY expires_at DESC LIMIT 1')
    .get(c.id, new Date(now + 7 * 864e5).toISOString());
  if (old) return old.token;
  const token = crypto.randomBytes(18).toString('base64url');
  db.prepare('INSERT INTO crm_portal_tokens (token, contact_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(token, c.id, new Date(now).toISOString(), new Date(now + DAYS * 864e5).toISOString());
  return token;
}
const linkFor = (contactId) => `${config.publicBaseUrl}/portal/${tokenFor(contactId)}`;
function contactFor(token, now = Date.now()) {
  const t = db.prepare('SELECT * FROM crm_portal_tokens WHERE token=?').get(String(token || ''));
  if (!t || Date.parse(t.expires_at) < now) return null;
  return db.prepare('SELECT * FROM contacts WHERE id=?').get(t.contact_id) || null;
}
const bizOf = (c) => (c && businesses().ownerOf ? businesses().ownerOf(c.group_name) : null) || businesses().all()[0] || { name: '', color: '#4f46e5' };

// Emails the person their link. Returns true when it went out.
async function emailLink(contactId, { why } = {}, opts = {}) {
  const c = crm().getContact(Number(contactId));
  if (!c) throw err('Person not found', 404);
  if (!c.email) throw err('This person has no email address. Copy the link and text it instead.');
  const email = require('./email');
  if (!email.provider()) throw err('Set up email first (Launchpad, Email). Or copy the link and text it.');
  const b = bizOf(c);
  await email.sendDirect({ to: c.email, toName: c.name, subject: `Your link for ${b.name || 'your account'}`,
    text: `Hi ${String(c.name).split(' ')[0]},\n\n${why || 'Here is your private link'}. Open it to see your invoices, quotes, appointments and courses:\n\n${linkFor(c.id)}\n\nThe link works for ${DAYS} days. Keep it to yourself, it opens your account without a password. You can always get a new one at ${config.publicBaseUrl}/portal\n\n${b.name || ''}` }, opts);
  crm().logActivity(c.id, { kind: 'Email', note: 'Emailed their customer portal link' });
  return true;
}

// ---------- Page shell shared by the portal and courses ----------
function shell({ title, biz, body, wide }) {
  const b = biz || businesses().all()[0] || { name: '', color: '#4f46e5' };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}${b.name ? ` · ${esc(b.name)}` : ''}</title>
<style>:root{--c:${esc(b.color || '#4f46e5')};--bg:#f5f6fb;--panel:#fff;--text:#171a24;--muted:#6a7184;--line:#e4e7ef}
@media (prefers-color-scheme:dark){:root{--bg:#0f1117;--panel:#181b24;--text:#eceef4;--muted:#9aa1b4;--line:#2a2f3c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
a{color:var(--c)}.bar{background:var(--c);color:#fff}.bar .in{max-width:${wide ? 980 : 760}px;margin:0 auto;padding:16px;display:flex;justify-content:space-between;align-items:center;gap:12px}
.bar b{font-size:1.1rem}.bar a{color:#fff;text-decoration:none;font-weight:600;opacity:.9}.wrap{max-width:${wide ? 980 : 760}px;margin:0 auto;padding:22px 16px 60px}
h1{font-size:1.5rem;margin:0 0 4px}h2{font-size:1.1rem;margin:26px 0 10px}.muted{color:var(--muted)}.small{font-size:.88rem}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin-bottom:10px}
.row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.row>div{min-width:0}
.btn{display:inline-block;padding:10px 16px;border-radius:12px;background:var(--c);color:#fff!important;text-decoration:none;font-weight:700;border:0;font:inherit;cursor:pointer}
.btn.ghost{background:transparent;color:var(--c)!important;border:1px solid var(--line)}.pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:.8rem;font-weight:700;background:var(--line)}
.pill.ok{background:#e7f7ec;color:#14532d}.pill.due{background:#fff4e0;color:#7a4b00}.empty{color:var(--muted);padding:6px 2px}
.prog{height:8px;border-radius:9px;background:var(--line);overflow:hidden;margin-top:8px}.prog i{display:block;height:100%;background:var(--c)}
input{width:100%;font:inherit;color:inherit;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:11px}label{display:block;font-weight:600;margin:14px 0 6px}
.note{margin:14px 0;padding:14px 16px;border-radius:12px;background:color-mix(in srgb,var(--c) 10%,var(--panel))}.err{margin:14px 0;padding:12px 14px;border-radius:12px;background:#fdecec;color:#7f1d1d}
.lessons a{display:flex;gap:10px;align-items:center;padding:12px 14px;border-bottom:1px solid var(--line);text-decoration:none;color:inherit}.lessons a:last-child{border:0}
.lessons a.on{background:color-mix(in srgb,var(--c) 10%,var(--panel));font-weight:700}.tick{width:22px;height:22px;flex:none;border-radius:50%;border:2px solid var(--line);display:grid;place-items:center;font-size:.75rem;color:#fff}
.tick.done{background:#16a34a;border-color:#16a34a}.video{position:relative;padding-top:56.25%;border-radius:14px;overflow:hidden;background:#000;margin:12px 0}.video iframe,.video video{position:absolute;inset:0;width:100%;height:100%;border:0}
.course{display:grid;grid-template-columns:280px 1fr;gap:18px;align-items:start}.course .side{padding:0;overflow:hidden}
@media (max-width:760px){.course{grid-template-columns:1fr}.course .side{order:2}}
</style></head><body><div class="bar"><div class="in"><b>${esc(b.name || 'Your account')}</b>${b.phone ? `<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>` : ''}</div></div>
<div class="wrap">${body}</div></body></html>`;
}

const when = (iso) => require('./booking').niceWhen(iso);
const day = (iso) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso.replace(' ', 'T') + (iso.length === 19 ? 'Z' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

function home(c, token) {
  const b = bizOf(c);
  const base = esc(token);
  const courses = (() => { try { return require('./courses').forContact(c.id); } catch { return []; } })();
  const invoices = db.prepare("SELECT * FROM crm_invoices WHERE contact_id=? AND status NOT IN ('draft','void') ORDER BY id DESC LIMIT 30").all(c.id);
  const quotes = (() => { try { return db.prepare("SELECT * FROM crm_quotes WHERE contact_id=? AND status NOT IN ('draft','void') ORDER BY id DESC LIMIT 30").all(c.id); } catch { return []; } })();
  const appts = db.prepare("SELECT * FROM crm_appointments WHERE contact_id=? AND status='booked' AND ends_at>? ORDER BY starts_at").all(c.id, new Date().toISOString());
  const pages = db.prepare('SELECT * FROM crm_booking_pages WHERE active=1 ORDER BY id').all()
    .filter((p) => !b.groups || !b.groups.length || b.groups.includes(p.group_name));
  const due = invoices.filter((i) => i.status !== 'paid');
  const partner = (() => { try { return require('./referrals').forContact(c.id); } catch { return null; } })();
  const plans = (() => { try { return require('./plans').forContact(c.id); } catch { return []; } })();
  const contracts = (() => { try { return require('./contracts').forContact(c.id); } catch { return []; } })();
  const per = (e) => ({ week: 'a week', month: 'a month', year: 'a year' }[e] || 'a month');
  const sec = (title, items, emptyText) => `<h2>${title}</h2>${items.length ? items.join('') : `<div class="empty">${emptyText}</div>`}`;
  const body = `<h1>Hi ${esc(String(c.name).split(' ')[0])}</h1><div class="muted">Everything you have with ${esc(b.name || 'us')}, in one place.</div>
${due.length ? `<div class="note"><b>You have ${due.length} invoice${due.length > 1 ? 's' : ''} to pay</b> (${money(due.reduce((s, i) => s + i.total, 0))}).</div>` : ''}
${courses.length ? sec('Your courses', courses.map((k) => `<div class="card"><div class="row"><div><b>${esc(k.title)}</b><div class="muted small">${k.done} of ${k.lessons} lessons done</div></div>
<a class="btn" href="${base}?course=${k.id}">${k.done ? 'Keep going' : 'Start'}</a></div><div class="prog"><i style="width:${k.lessons ? Math.round(k.done / k.lessons * 100) : 0}%"></i></div></div>`), '') : ''}
${plans.length ? sec('Your plans', plans.map((s) => `<div class="card"><div class="row"><div><b>${esc(s.name)} · ${money(s.amount)} ${per(s.every)}</b>
<span class="pill ${s.status === 'past_due' ? 'due' : 'ok'}">${{ active: 'Active', past_due: 'Card declined', ending: 'Ending' }[s.status] || esc(s.status)}</span>
<div class="muted small">${s.status === 'ending' ? `Ends ${day(s.renews_at)}. You keep it until then.` : s.status === 'past_due' ? 'Your card was declined. We will try again soon. Questions? Reply to any email from us.' : s.renews_at ? `Renews ${day(s.renews_at)}` : ''}</div></div>
${s.status === 'ending' ? '' : `<form method="post" action="${base}/cancel" onsubmit="return confirm('Cancel ${esc(s.name).replace(/'/g, '')}? You keep it until the end of the time you already paid for.')"><input type="hidden" name="sub" value="${s.id}"><button class="btn ghost" type="submit">Cancel plan</button></form>`}</div></div>`), '') : ''}
${contracts.length ? sec('Contracts', contracts.map((k) => `<div class="card"><div class="row"><div><b>${esc(k.title)}</b> <span class="pill ${k.status === 'signed' ? 'ok' : 'due'}">${k.status === 'signed' ? 'Signed' : 'Please sign'}</span>
<div class="muted small">${k.status === 'signed' ? `Signed ${day(k.signed_at)}` : `Sent ${day(k.sent_at)}`}</div></div>
<a class="btn${k.status === 'signed' ? ' ghost' : ''}" href="../sign/${esc(k.token)}">${k.status === 'signed' ? 'View' : 'Read and sign'}</a></div></div>`), '') : ''}
${sec('Appointments', appts.map((a) => `<div class="card"><div class="row"><div><b>${esc(a.title)}</b><div class="muted small">${esc(when(a.starts_at))}${a.location ? ` · ${esc(a.location)}` : ''}</div></div>
${a.token ? `<a class="btn ghost" href="../book/a/${esc(a.token)}">Change or cancel</a>` : ''}</div></div>`), 'No upcoming appointments.')}
${pages.length ? `<div class="row" style="gap:8px;justify-content:flex-start">${pages.map((p) => `<a class="btn ghost" href="../book/${esc(p.slug)}">Book: ${esc(p.title)}</a>`).join('')}</div>` : ''}
${sec('Invoices', invoices.map((i) => `<div class="card"><div class="row"><div><b>#${i.number} · ${money(i.total)}</b> <span class="pill ${i.status === 'paid' ? 'ok' : 'due'}">${i.status === 'paid' ? 'Paid' : 'Due'}</span>
<div class="muted small">${i.status === 'paid' ? `Paid ${day(i.paid_at)}` : i.due_date ? `Due ${day(i.due_date)}` : `Sent ${day(i.sent_at || i.created_at)}`}</div></div>
<a class="btn${i.status === 'paid' ? ' ghost' : ''}" href="../invoice/${esc(i.token)}">${i.status === 'paid' ? 'View' : 'View and pay'}</a></div></div>`), 'No invoices yet.')}
${partner ? `<h2>Share and earn</h2><div class="card"><div class="muted small">Send friends your link. When they buy, you earn ${partner.percent}% of the sale.</div>
<input readonly value="${esc(partner.link)}" aria-label="Your link" onclick="this.select()" style="margin:10px 0">
<div class="row" style="justify-content:flex-start;gap:22px"><div><b>${partner.clicks}</b><div class="muted small">Visits</div></div><div><b>${partner.people}</b><div class="muted small">People</div></div><div><b>${partner.sales}</b><div class="muted small">Sales</div></div><div><b>${money(partner.owed)}</b><div class="muted small">To be paid</div></div><div><b>${money(partner.paid)}</b><div class="muted small">Paid to you</div></div></div></div>` : ''}
${quotes.length ? sec('Quotes', quotes.map((q) => `<div class="card"><div class="row"><div><b>${esc(q.title || `Quote #${q.number}`)} · ${money(q.total)}</b> <span class="pill ${q.status === 'accepted' ? 'ok' : ''}">${esc({ sent: 'Waiting for you', accepted: 'Signed', declined: 'Declined', expired: 'Expired' }[q.status] || q.status)}</span></div>
<a class="btn ghost" href="../quote/${esc(q.token)}">View</a></div></div>`), '') : ''}
<p class="muted small" style="margin-top:30px">This private link opens your account without a password, so keep it to yourself.</p>`;
  return shell({ title: 'Your account', biz: b, body });
}

function signInPage({ sent, error } = {}) {
  const body = `<h1>Your account</h1><p class="muted">Type the email you use with us. We will email you a private link. No password needed.</p>
${sent ? '<div class="note"><b>Check your email.</b> If we have that address, your link is on the way. It can take a minute.</div>' : ''}${error ? `<div class="err">${esc(error)}</div>` : ''}
<form method="post"><label for="e">Email</label><input id="e" name="email" type="email" required autocomplete="email" maxlength="200"><input name="website" style="position:absolute;left:-9999px" tabindex="-1" autocomplete="off" aria-hidden="true">
<p><button class="btn" type="submit">Email me my link</button></p></form>`;
  return shell({ title: 'Sign in', body });
}
const gone = () => shell({ title: 'Link expired', body: '<h1>This link has expired</h1><p class="muted">For your safety, links stop working after a while.</p><p><a class="btn" href="../portal">Get a new link</a></p>' });

function publicRouter() {
  const r = express.Router();
  r.use(express.urlencoded({ extended: false, limit: '20kb' }));
  const page = (res, html, status = 200) => res.status(status).set('Cache-Control', 'no-store').type('html').send(html);
  r.get('/', (req, res) => page(res, signInPage()));
  r.post('/', async (req, res) => {
    if (req.body.website) return page(res, signInPage({ sent: true }));
    if (crm().tooMany(String(req.get('cf-connecting-ip') || req.ip))) return page(res, signInPage({ error: 'Too many tries. Please wait a bit.' }), 429);
    const email = String(req.body.email || '').trim().toLowerCase();
    const c = email && db.prepare('SELECT id FROM contacts WHERE lower(email)=?').get(email);
    if (c) emailLink(c.id, { why: 'You asked for your link' }).catch((e) => console.error(`[portal] ${e.message}`));
    page(res, signInPage({ sent: true }));
  });
  r.get('/:token', (req, res) => {
    const c = contactFor(req.params.token);
    if (!c) return page(res, gone(), 404);
    if (req.query.course) {
      const html = require('./courses').coursePage(c, req.params.token, req.query.course, req.query.lesson, req.query.tab);
      return html ? page(res, html) : res.redirect(303, encodeURIComponent(req.params.token));
    }
    page(res, home(c, req.params.token));
  });
  r.post('/:token/done', (req, res) => {
    const c = contactFor(req.params.token);
    if (!c) return page(res, gone(), 404);
    const next = require('./courses').markDone(c.id, req.body.lesson, req.body.undo === '1');
    res.redirect(303, `../${encodeURIComponent(req.params.token)}?course=${next.course}${next.lesson ? `&lesson=${next.lesson}` : ''}`);
  });
  // Members cancel their own plan. It ends after the time they already paid for.
  r.post('/:token/cancel', async (req, res) => {
    const c = contactFor(req.params.token);
    if (!c) return page(res, gone(), 404);
    const sub = db.prepare("SELECT id FROM crm_subscriptions WHERE id=? AND contact_id=?").get(Number(req.body.sub), c.id);
    if (sub) {
      await require('./plans').cancel(sub.id, { now: false, by: 'them' }).catch((e) => {
        // We could not reach Stripe: tell the owner so they cancel it by hand.
        console.error(`[portal] ${e.message}`);
        require('../../src/notify').send('Please cancel a plan', `${c.name} asked to cancel their plan, but Stripe said: ${e.message}`, { tags: 'warning', priority: 'high' }).catch(() => {});
        crm().logActivity(c.id, { kind: 'Payment', note: 'Asked to cancel their plan. Please cancel it in Stripe.' });
      });
    }
    res.redirect(303, `../${encodeURIComponent(req.params.token)}`);
  });
  // The members community.
  const talk = (fn) => (req, res) => {
    const c = contactFor(req.params.token);
    if (!c) return page(res, gone(), 404);
    const back = `../${encodeURIComponent(req.params.token)}?course=${Number(req.body.course) || 0}&tab=talk`;
    try { const out = fn(c, req.body); res.redirect(303, `${back}${out && out.post ? `#p${out.post}` : ''}`); }
    catch (e) { res.redirect(303, back); }
  };
  const community = () => require('./community');
  r.post('/:token/post', talk((c, b) => community().memberPost(c.id, b.course, b.body)));
  r.post('/:token/comment', talk((c, b) => community().memberComment(c.id, b.post, b.body)));
  r.post('/:token/unpost', talk((c, b) => community().memberDelete(c.id, 'post', b.post)));
  r.get('/:token/media/:file', (req, res) => {
    const c = contactFor(req.params.token);
    const f = c && require('./courses').mediaFor(c.id, req.params.file);
    if (!f) return res.status(404).send('Not found');
    res.sendFile(f, { maxAge: 0 });
  });
  return r;
}

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.post('/:contactId/link', wrap(async (req) => {
  const link = linkFor(req.params.contactId);
  const emailed = (req.body || {}).send ? await emailLink(req.params.contactId) : false;
  return { link, emailed };
}));

module.exports = { tokenFor, linkFor, contactFor, emailLink, shell, publicRouter, router, DAYS };
