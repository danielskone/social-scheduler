// Monthly payments (subscriptions). Make a plan, like "Car care club, $29 a month". People sign up
// on its page and pay by card with your own Stripe. Stripe charges them every month by itself.
// Each payment shows up here as a paid invoice (so it counts in Payments, Reports and referrals).
// A plan can include a course: members keep it while they pay. Nobody needs webhooks: we ask
// Stripe for news every 10 minutes.
const express = require('express');
const crypto = require('crypto');
const db = require('../../src/db');
const config = require('../../src/config');
const notify = require('../../src/notify');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_plans (
  id INTEGER PRIMARY KEY,
  business_id INTEGER,
  name TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL,
  every TEXT NOT NULL DEFAULT 'month',       -- week, month, year
  course_id INTEGER,                         -- members get this course while they pay
  active INTEGER NOT NULL DEFAULT 1,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_subscriptions (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER REFERENCES crm_plans(id) ON DELETE SET NULL,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  every TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',    -- pending, active, past_due, ending, canceled
  token TEXT NOT NULL UNIQUE,
  stripe_session TEXT,
  stripe_sub TEXT,
  renews_at TEXT,
  started_at TEXT,
  canceled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_sub_payments (
  stripe_invoice TEXT PRIMARY KEY,
  sub_id INTEGER NOT NULL,
  invoice_id INTEGER,
  paid_at TEXT NOT NULL
);
`);
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const money = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const round = (n) => Math.round(Number(n) * 100) / 100;
const invoices = () => require('./invoices');
const crm = () => require('./crm');
const EVERY = { week: 'week', month: 'month', year: 'year' };
const per = (e) => ({ week: 'a week', month: 'a month', year: 'a year' }[e] || 'a month');
const linkFor = (p) => `${config.publicBaseUrl}/subscribe/${p.token}`;
const getPlan = (id) => db.prepare('SELECT * FROM crm_plans WHERE id=?').get(Number(id));
const shapePlan = (p) => p && { ...p, active: Boolean(p.active), link: linkFor(p), per: per(p.every),
  members: db.prepare("SELECT COUNT(*) AS n FROM crm_subscriptions WHERE plan_id=? AND status IN ('active','past_due','ending')").get(p.id).n,
  course: p.course_id ? (db.prepare('SELECT id, title FROM crm_courses WHERE id=?').get(p.course_id) || null) : null };

function list(biz) {
  const plans = db.prepare('SELECT * FROM crm_plans ORDER BY active DESC, id DESC').all()
    .filter((p) => !biz || biz === 'all' || !p.business_id || p.business_id === Number(biz)).map(shapePlan);
  const f = require('./businesses').filter(biz, 'c.group_name');
  const subs = db.prepare(`SELECT s.*, c.name AS contact_name, c.email FROM crm_subscriptions s JOIN contacts c ON c.id=s.contact_id
    WHERE s.status<>'pending' ${f.sql ? `AND ${f.sql}` : ''} ORDER BY s.id DESC LIMIT 300`).all(...f.args);
  const live = subs.filter((s) => ['active', 'past_due', 'ending'].includes(s.status));
  const monthly = round(live.reduce((n, s) => n + (s.every === 'year' ? s.amount / 12 : s.every === 'week' ? s.amount * 52 / 12 : s.amount), 0));
  return { plans, subscriptions: subs, totals: { members: live.length, monthly, pastDue: subs.filter((s) => s.status === 'past_due').length } };
}
function save(body = {}, id, biz) {
  const old = id ? getPlan(id) : null;
  if (id && !old) throw err('Plan not found', 404);
  const name = String(body.name ?? old?.name ?? '').trim().slice(0, 120);
  if (!name) throw err('Give the plan a name.');
  const amount = round(Number(String(body.amount ?? old?.amount ?? '').replace(/[$,\s]/g, '')));
  if (!Number.isFinite(amount) || amount < 1 || amount > 99999) throw err('Add a price of at least $1, like 29.');
  const every = EVERY[body.every] || old?.every || 'month';
  const courseId = 'course_id' in body ? (Number(body.course_id) && db.prepare('SELECT id FROM crm_courses WHERE id=?').get(Number(body.course_id)) ? Number(body.course_id) : null) : old?.course_id ?? null;
  const row = { name, amount, every, course_id: courseId, description: 'description' in body ? String(body.description || '').trim().slice(0, 1000) || null : old?.description ?? null,
    active: 'active' in body ? (body.active ? 1 : 0) : old ? old.active : 1,
    business_id: old ? old.business_id : (biz && biz !== 'all' && require('./businesses').get(biz) ? Number(biz) : null) };
  if (old) {
    // Price changes apply to new members. People already paying keep their price.
    db.prepare('UPDATE crm_plans SET name=@name, amount=@amount, every=@every, course_id=@course_id, description=@description, active=@active WHERE id=@id').run({ ...row, id: old.id });
    return shapePlan(getPlan(old.id));
  }
  return shapePlan(getPlan(db.prepare('INSERT INTO crm_plans (name, amount, every, course_id, description, active, business_id, token) VALUES (@name,@amount,@every,@course_id,@description,@active,@business_id,@token)')
    .run({ ...row, token: crypto.randomBytes(9).toString('base64url') }).lastInsertRowid));
}
function remove(id) {
  if (db.prepare("SELECT 1 FROM crm_subscriptions WHERE plan_id=? AND status IN ('active','past_due','ending')").get(Number(id))) throw err('People are still paying for this plan. Turn it off instead, or cancel their plans first.');
  db.prepare('DELETE FROM crm_plans WHERE id=?').run(Number(id));
  return { ok: true };
}

// ---------- Signing up ----------
async function subscribe(token, body = {}) {
  const p = db.prepare('SELECT * FROM crm_plans WHERE token=? AND active=1').get(String(token));
  if (!p) throw err('This plan is not available.', 404);
  if (!invoices().stripeOn()) throw err('Card payments are not set up yet. Please contact us.');
  const c = require('./products').buyer(body, p.business_id, `Started signing up for ${p.name} (${money(p.amount)} ${per(p.every)})`);
  const subToken = crypto.randomBytes(15).toString('base64url');
  const id = db.prepare('INSERT INTO crm_subscriptions (plan_id, contact_id, name, amount, every, token) VALUES (?,?,?,?,?,?)').run(p.id, c.id, p.name, p.amount, p.every, subToken).lastInsertRowid;
  const back = `${config.publicBaseUrl}/subscribe/${p.token}`;
  const f = { mode: 'subscription', success_url: `${config.publicBaseUrl}/subscribe/done/${subToken}?session={CHECKOUT_SESSION_ID}`, cancel_url: back,
    client_reference_id: `sub-${id}`, 'metadata[plan]': p.name,
    'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][unit_amount]': String(Math.round(p.amount * 100)),
    'line_items[0][price_data][recurring][interval]': p.every, 'line_items[0][price_data][product_data][name]': p.name };
  if (c.email) f.customer_email = c.email;
  const s = await invoices().stripe('POST', 'checkout/sessions', f);
  db.prepare('UPDATE crm_subscriptions SET stripe_session=? WHERE id=?').run(s.id, id);
  try { require('./checkouts').track({ subId: id }); } catch {}
  return { url: s.url, id };
}
// After Stripe sends them back (and every 10 minutes for sign-ups still waiting).
async function confirm(sub) {
  if (!sub || sub.status !== 'pending' || !sub.stripe_session) return sub;
  const s = await invoices().stripe('GET', `checkout/sessions/${encodeURIComponent(sub.stripe_session)}`);
  if (s.client_reference_id !== `sub-${sub.id}` || s.status !== 'complete' || !s.subscription) return sub;
  const subId = typeof s.subscription === 'string' ? s.subscription : s.subscription.id;
  const now = new Date().toISOString();
  const done = db.prepare("UPDATE crm_subscriptions SET status='active', stripe_sub=?, started_at=? WHERE id=? AND status='pending'").run(subId, now, sub.id).changes;
  if (done) {
    const c = crm().getContact(sub.contact_id);
    crm().logActivity(sub.contact_id, { kind: 'Payment', note: `Started the plan ${sub.name} (${money(sub.amount)} ${per(sub.every)})` });
    notify.send('New member', `${c ? c.name : 'Someone'} started ${sub.name} (${money(sub.amount)} ${per(sub.every)}).`, { tags: 'repeat' }).catch(() => {});
    crm().emit('plan_started', { contact: c, form: sub.name });
    const plan = sub.plan_id && getPlan(sub.plan_id);
    if (plan && plan.course_id) await require('./courses').grant(plan.course_id, sub.contact_id, { via: `Plan: ${sub.name}` }).catch(() => {});
    await syncOne(db.prepare('SELECT * FROM crm_subscriptions WHERE id=?').get(sub.id)).catch((e) => console.error(`[plans] ${e.message}`));
  }
  return db.prepare('SELECT * FROM crm_subscriptions WHERE id=?').get(sub.id);
}
// Asks Stripe about one plan: is it still paid, when does it renew, and any new payments.
async function syncOne(sub) {
  if (!sub || !sub.stripe_sub) return;
  const s = await invoices().stripe('GET', `subscriptions/${encodeURIComponent(sub.stripe_sub)}`);
  const status = s.status === 'active' || s.status === 'trialing' ? (s.cancel_at_period_end ? 'ending' : 'active') : s.status === 'past_due' || s.status === 'unpaid' ? 'past_due' : s.status === 'canceled' || s.status === 'incomplete_expired' ? 'canceled' : sub.status;
  const end = s.current_period_end || (s.items && s.items.data && s.items.data[0] && s.items.data[0].current_period_end);
  db.prepare('UPDATE crm_subscriptions SET status=?, renews_at=?, canceled_at=COALESCE(canceled_at, ?) WHERE id=?')
    .run(status, end ? new Date(end * 1000).toISOString() : sub.renews_at, status === 'canceled' ? new Date().toISOString() : null, sub.id);
  if (status !== sub.status) {
    const c = crm().getContact(sub.contact_id);
    if (status === 'past_due') notify.send('Payment failed', `${c ? c.name : 'A member'}'s card was declined for ${sub.name}. Stripe will try again.`, { tags: 'warning' }).catch(() => {});
    if (status === 'canceled') {
      crm().logActivity(sub.contact_id, { kind: 'Payment', note: `Plan ${sub.name} ended` });
      const plan = sub.plan_id && getPlan(sub.plan_id);
      if (plan && plan.course_id) require('./courses').revoke(plan.course_id, sub.contact_id);
    }
  }
  // New paid Stripe invoices become paid invoices here.
  const inv = await invoices().stripe('GET', `invoices?subscription=${encodeURIComponent(sub.stripe_sub)}&status=paid&limit=12`);
  for (const si of (inv.data || []).slice().reverse()) {
    if (db.prepare('SELECT 1 FROM crm_sub_payments WHERE stripe_invoice=?').get(si.id)) continue;
    const amount = round((si.amount_paid || 0) / 100);
    if (amount <= 0) { db.prepare('INSERT OR IGNORE INTO crm_sub_payments (stripe_invoice, sub_id, paid_at) VALUES (?,?,?)').run(si.id, sub.id, new Date().toISOString()); continue; }
    const mine = invoices().save({ contact_id: sub.contact_id, items: [{ what: `${sub.name} (${{ week: 'weekly', month: 'monthly', year: 'yearly' }[sub.every] || 'monthly'} plan)`, qty: 1, price: amount }] });
    db.prepare("UPDATE crm_invoices SET status='sent', sent_at=? WHERE id=?").run(new Date().toISOString(), mine.id);
    invoices().markPaid(mine.id, 'Card (Stripe plan)', { quiet: true });
    db.prepare('INSERT OR IGNORE INTO crm_sub_payments (stripe_invoice, sub_id, invoice_id, paid_at) VALUES (?,?,?,?)').run(si.id, sub.id, mine.id, new Date().toISOString());
  }
}
async function syncAll() {
  if (!invoices().stripeOn()) return 0;
  let n = 0;
  for (const sub of db.prepare("SELECT * FROM crm_subscriptions WHERE status='pending' AND stripe_session IS NOT NULL AND created_at > datetime('now','-3 days')").all()) {
    try { await confirm(sub); n++; } catch (e) { console.error(`[plans] ${e.message}`); }
  }
  for (const sub of db.prepare("SELECT * FROM crm_subscriptions WHERE status IN ('active','past_due','ending')").all()) {
    try { await syncOne(sub); n++; } catch (e) { console.error(`[plans] ${e.message}`); }
  }
  return n;
}
// Cancel: now (you, from the CRM) or at the end of what they paid for (them, from their portal).
async function cancel(id, { now = true, by = 'you' } = {}) {
  const sub = db.prepare('SELECT * FROM crm_subscriptions WHERE id=?').get(Number(id));
  if (!sub) throw err('Plan not found', 404);
  if (sub.status === 'pending') { db.prepare("UPDATE crm_subscriptions SET status='canceled', canceled_at=? WHERE id=?").run(new Date().toISOString(), sub.id); return sub; }
  if (!sub.stripe_sub || sub.status === 'canceled') return sub;
  try {
    if (now) await invoices().stripe('DELETE', `subscriptions/${encodeURIComponent(sub.stripe_sub)}`);
    else await invoices().stripe('POST', `subscriptions/${encodeURIComponent(sub.stripe_sub)}`, { cancel_at_period_end: 'true' });
  } catch (e) {
    if (/permission|restricted/i.test(e.message)) throw err('Your Stripe key can\'t change plans yet. In Stripe, edit the Viral Touch key and set Subscriptions to Write. Or cancel it in your Stripe dashboard.');
    throw e;
  }
  crm().logActivity(sub.contact_id, { kind: 'Payment', note: `${by === 'them' ? 'They cancelled' : 'You cancelled'} the plan ${sub.name}${now ? '' : ' (it ends after the time already paid for)'}` });
  if (by === 'them') { const c = crm().getContact(sub.contact_id); notify.send('Plan cancelled', `${c ? c.name : 'A member'} cancelled ${sub.name}.`, { tags: 'wave' }).catch(() => {}); }
  await syncOne(sub).catch(() => {});
  return db.prepare('SELECT * FROM crm_subscriptions WHERE id=?').get(sub.id);
}
const forContact = (contactId) => db.prepare("SELECT * FROM crm_subscriptions WHERE contact_id=? AND status IN ('active','past_due','ending') ORDER BY id DESC").all(Number(contactId));

// ---------- Public pages ----------
function publicRouter() {
  const r = express.Router();
  r.use(express.urlencoded({ extended: false, limit: '20kb' }));
  const products = () => require('./products');
  const plan = (t) => db.prepare('SELECT * FROM crm_plans WHERE token=? AND active=1').get(String(t));
  const course = (p) => p.course_id && db.prepare('SELECT title FROM crm_courses WHERE id=?').get(p.course_id);
  const show = (p, extra = {}) => products().buyPage({ title: p.name, description: p.description, price: p.amount, bizId: p.business_id,
    sub: `<div class="muted" style="margin-bottom:4px">Paid ${per(p.every)}. Cancel any time.</div>`,
    extra: course(p) ? `<p class="desc">Includes the course <b>${course(p).title.replace(/[<>&"]/g, '')}</b>.</p>` : '',
    button: `Start for ${money(p.amount)} ${per(p.every)}`, ...extra });
  r.get('/done/:token', async (req, res) => {
    let sub = db.prepare('SELECT * FROM crm_subscriptions WHERE token=?').get(String(req.params.token));
    if (!sub) return res.status(404).send('Not found');
    try { sub = await confirm(sub); } catch (e) { console.error(`[plans] ${e.message}`); }
    const portal = require('./portal');
    const ok = sub.status !== 'pending';
    res.set('Cache-Control', 'no-store').type('html').send(portal.shell({ title: sub.name, body: `<h1>${ok ? 'You are in! 🎉' : 'Almost done'}</h1>
<p>${ok ? `Your plan <b>${sub.name.replace(/[<>&"]/g, '')}</b> is active. Your receipt is in your email.` : 'We are confirming your payment. This page updates in a minute.'}</p>
<p><a class="btn" href="../../portal/${portal.tokenFor(sub.contact_id)}">Go to your account</a></p>${ok ? '' : '<meta http-equiv="refresh" content="20">'}` }));
  });
  r.get('/:token', (req, res) => {
    const p = plan(req.params.token);
    if (!p) return res.status(404).send('<meta name="viewport" content="width=device-width, initial-scale=1"><p style="font:18px system-ui;padding:20px">This plan is not available.</p>');
    res.set('Cache-Control', 'no-store').type('html').send(show(p));
  });
  r.post('/:token', async (req, res) => {
    const p = plan(req.params.token);
    if (!p) return res.status(404).send('Not available');
    if (req.body.website) return res.send('Thank you!');
    if (crm().tooMany(String(req.get('cf-connecting-ip') || req.ip))) return res.status(429).send(show(p, { error: 'Too many tries. Please wait a bit.', values: req.body }));
    try { const out = await subscribe(p.token, { ...req.body, ref: require('./referrals').fromReq(req) }); res.redirect(303, out.url); }
    catch (e) { res.status(e.status || 500).send(show(p, { error: e.message, values: req.body })); }
  });
  return r;
}

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req) => list(req.query.biz)));
router.post('/', wrap((req) => save(req.body || {}, null, req.query.biz)));
router.put('/:id', wrap((req) => save(req.body || {}, req.params.id)));
router.delete('/:id', wrap((req) => remove(req.params.id)));
router.post('/subscriptions/:id/cancel', wrap((req) => cancel(req.params.id, { now: (req.body || {}).now !== false })));
router.post('/sync', wrap(async () => ({ checked: await syncAll() })));

module.exports = { list, save, remove, subscribe, confirm, syncOne, syncAll, cancel, forContact, publicRouter, router, per };
