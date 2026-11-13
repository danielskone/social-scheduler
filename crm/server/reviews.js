// Review requests: ask a happy customer to leave a review (Google, Facebook, Yelp...).
// Each business saves its review link in Settings. The request goes out as an email from your
// own address, or opens your Messages app with the text ready (texts are never sent by
// themselves). The link in it is a short tracked link (/r/...), so you can see who opened it.
// One person is asked at most once every 90 days, and never if marked "Do not contact".
const express = require('express');
const crypto = require('crypto');
const db = require('../../src/db');
const config = require('../../src/config');
const notify = require('../../src/notify');
const email = require('./email');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_review_requests (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  business_id INTEGER,
  channel TEXT NOT NULL,                 -- email or text
  token TEXT NOT NULL UNIQUE,
  sent_at TEXT NOT NULL,
  clicked_at TEXT
);
`);
const crm = () => require('./crm');
const businesses = () => require('./businesses');
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const DEFAULT_MESSAGE = 'Hi {first_name}, thank you for choosing {business}! Would you take 30 seconds to leave us a review? It really helps a small business like ours.\n{link}';
const AGAIN_DAYS = 90;

const linkFor = (token) => `${config.publicBaseUrl}/r/${token}`;
const contact = (id) => db.prepare('SELECT * FROM contacts WHERE id=?').get(Number(id));

// The business a person belongs to, and whether it has a review link yet.
function context(contactId) {
  const c = contact(contactId);
  if (!c) throw err('Person not found', 404);
  const b = businesses().ownerOf(c.group_name);
  const last = db.prepare('SELECT * FROM crm_review_requests WHERE contact_id=? ORDER BY sent_at DESC LIMIT 1').get(c.id);
  const tooSoon = last && Date.now() - new Date(last.sent_at) < AGAIN_DAYS * 86400e3;
  return { contact: c, business: b ? { id: b.id, name: b.name, review_url: b.review_url || null } : null, last: last || null, tooSoon: Boolean(tooSoon),
    message: DEFAULT_MESSAGE, canEmail: Boolean(c.email && email.provider()), canText: Boolean(c.phone) };
}

function fill(text, c, b, link) {
  return crm().fillTemplate(String(text || DEFAULT_MESSAGE), c).replace(/\{business\}/g, b.name).replace(/\{link\}/g, link);
}

// Sends (email) or prepares (text) a review request. Returns { ok, link?, sms? }.
async function ask(contactId, { channel = 'email', message, force } = {}, opts = {}) {
  const ctx = context(contactId), c = ctx.contact, b = ctx.business;
  if (!b || !b.review_url) throw err(`Add a review link for ${b ? b.name : 'your business'} first (Settings, edit the business).`);
  if (c.do_not_contact) throw err(`${c.name} is marked "Do not contact".`);
  if (ctx.tooSoon && !force) throw err(`You already asked ${c.name} on ${new Date(ctx.last.sent_at).toLocaleDateString()}. People are asked at most once every ${AGAIN_DAYS} days.`);
  if (!['email', 'text'].includes(channel)) throw err('Pick email or text.');
  const token = crypto.randomBytes(9).toString('base64url');
  const link = linkFor(token);
  let text = fill(message, c, b, link);
  if (!text.includes(link)) text += `\n${link}`;
  if (channel === 'email') {
    if (!c.email) throw err(`${c.name} has no email address.`);
    await email.sendDirect({ to: c.email, toName: c.name, subject: `How did we do, ${String(c.name).split(' ')[0]}?`,
      text: `${text}\n\n(If you'd rather not get messages like this, just reply "stop".)` }, opts);
  } else if (!c.phone) throw err(`${c.name} has no phone number.`);
  db.prepare('INSERT INTO crm_review_requests (contact_id, business_id, channel, token, sent_at) VALUES (?,?,?,?,?)').run(c.id, b.id, channel, token, new Date().toISOString());
  crm().logActivity(c.id, { kind: channel === 'email' ? 'Email' : 'Text', note: `Asked for a review (${channel === 'email' ? 'email sent' : 'text opened in Messages'})` });
  const phone = String(c.phone || '').replace(/[^\d+]/g, '');
  return { ok: true, link, sms: channel === 'text' ? `sms:${phone}&body=${encodeURIComponent(text)}` : null };
}

// The short link in the message: notes the click, then goes to the review page.
function publicRouter() {
  const r = express.Router();
  r.get('/:token', (req, res) => {
    const row = db.prepare('SELECT * FROM crm_review_requests WHERE token=?').get(String(req.params.token));
    const b = row && businesses().get(row.business_id);
    if (!row || !b || !b.review_url) return res.status(404).send('<meta name="viewport" content="width=device-width, initial-scale=1"><p style="font:18px system-ui;padding:20px">This link has expired.</p>');
    if (!row.clicked_at) {
      db.prepare('UPDATE crm_review_requests SET clicked_at=? WHERE id=?').run(new Date().toISOString(), row.id);
      const c = contact(row.contact_id);
      if (c) {
        crm().logActivity(c.id, { kind: 'Note', note: 'Opened your review link' });
        notify.send('Review link opened', `${c.name} opened your ${b.name} review link.`, { tags: 'star' }).catch(() => {});
      }
    }
    res.redirect(302, b.review_url);
  });
  return r;
}

// The Reviews page: who was asked, who opened the link, and who to ask next.
function overview(biz) {
  const f = businesses().filter(biz, 'c.group_name');
  const rows = db.prepare(`SELECT r.*, c.name, c.email, c.phone, c.group_name FROM crm_review_requests r JOIN contacts c ON c.id=r.contact_id
    ${f.sql ? `WHERE ${f.sql}` : ''} ORDER BY r.sent_at DESC LIMIT 300`).all(...f.args);
  const since = new Date(Date.now() - 30 * 86400e3).toISOString();
  const recent = rows.filter((r) => r.sent_at >= since);
  // People in a "won" step who were never asked: good people to ask.
  const asked = new Set(db.prepare('SELECT DISTINCT contact_id AS id FROM crm_review_requests').all().map((r) => r.id));
  const suggest = crm().listContacts({ biz }).filter((c) => c.stage_kind === 'won' && !asked.has(c.id) && !c.do_not_contact && (c.email || c.phone))
    .slice(0, 20).map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, stage: c.stage, group_name: c.group_name }));
  const bizList = businesses().all().filter((b) => !biz || biz === 'all' || b.id === Number(biz)).map((b) => ({ id: b.id, name: b.name, review_url: b.review_url || null }));
  return {
    totals: { sent: recent.length, opened: recent.filter((r) => r.clicked_at).length, allTime: rows.length },
    requests: rows.map((r) => ({ id: r.id, contact_id: r.contact_id, name: r.name, channel: r.channel, sent_at: r.sent_at, clicked_at: r.clicked_at })),
    suggest, businesses: bizList, message: DEFAULT_MESSAGE,
  };
}

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req) => overview(req.query.biz)));
router.get('/contact/:id', wrap((req) => context(req.params.id)));
router.post('/contact/:id', wrap((req) => ask(req.params.id, req.body || {})));

module.exports = { ask, context, overview, publicRouter, router, DEFAULT_MESSAGE };
