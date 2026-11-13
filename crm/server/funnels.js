// Funnels: a few Sites pages in order. A sign-up page, then a thank-you page, then an offer.
// Any button set to "#next" goes to the next page, and after someone fills in the form on a
// page they move on by themselves. Each step shows how many people saw it, so you can see
// where people stop.
const express = require('express');
const db = require('../../src/db');
const sites = () => require('./sites');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_funnels (
  id INTEGER PRIMARY KEY,
  business_id INTEGER,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_funnel_steps (
  id INTEGER PRIMARY KEY,
  funnel_id INTEGER NOT NULL REFERENCES crm_funnels(id) ON DELETE CASCADE,
  site_id INTEGER NOT NULL UNIQUE REFERENCES crm_sites(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0
);
`);
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const businesses = () => require('./businesses');

// The next live page after this one, or null.
function nextSlug(siteId) {
  const st = db.prepare('SELECT * FROM crm_funnel_steps WHERE site_id=?').get(Number(siteId));
  if (!st) return null;
  const n = db.prepare(`SELECT s.slug FROM crm_funnel_steps f JOIN crm_sites s ON s.id=f.site_id
    WHERE f.funnel_id=? AND (f.position>? OR (f.position=? AND f.id>?)) AND s.published=1 ORDER BY f.position, f.id LIMIT 1`).get(st.funnel_id, st.position, st.position, st.id);
  return n ? n.slug : null;
}

function full(id) {
  const f = db.prepare('SELECT * FROM crm_funnels WHERE id=?').get(Number(id));
  if (!f) throw err('Funnel not found', 404);
  const steps = db.prepare(`SELECT f.id, f.site_id, f.position, s.title, s.slug, s.published, s.views FROM crm_funnel_steps f JOIN crm_sites s ON s.id=f.site_id
    WHERE f.funnel_id=? ORDER BY f.position, f.id`).all(f.id);
  const config = require('../../src/config');
  steps.forEach((st, i) => {
    st.link = `${config.publicBaseUrl}/s/${st.slug}`;
    st.published = Boolean(st.published);
    st.went_on = i && steps[i - 1].views ? Math.min(100, Math.round((st.views / steps[i - 1].views) * 100)) : null;
  });
  return { ...f, steps };
}
function list(biz) {
  return db.prepare('SELECT id, business_id FROM crm_funnels ORDER BY id DESC').all()
    .filter((f) => !biz || biz === 'all' || !f.business_id || f.business_id === Number(biz)).map((f) => full(f.id));
}

// Ready-made funnels. Each makes its pages for you.
const TEMPLATES = {
  leads: { name: 'Get sign-ups', about: 'A sign-up page with your form, then a thank-you page.', steps: (name) => [
    { title: `${name}: sign up`, sections: [
      { type: 'hero', heading: 'Get your free guide', text: 'Type your name and email and we will send it right away.', button_text: 'Get it now', button_link: '#signup' },
      { type: 'form', heading: 'Where should we send it?', text: '' },
    ] },
    { title: `${name}: thank you`, sections: [
      { type: 'hero', heading: 'Thank you! Check your email.', text: 'Your guide is on the way. While you wait, take a look at how we can help.', button_text: 'See how', button_link: '#next' },
    ] },
  ] },
  sale: { name: 'Sell something', about: 'An offer page with a Buy button, then a thank-you page.', steps: (name) => [
    { title: `${name}: offer`, sections: [
      { type: 'hero', heading: 'The offer, in one line', text: 'Say who it is for and what they get.', button_text: 'Buy now', button_link: '#buy' },
      { type: 'services', heading: 'What you get', text: '', items: [{ title: 'Thing one', text: 'Why it helps.', price: '' }, { title: 'Thing two', text: 'Why it helps.', price: '' }, { title: 'Thing three', text: 'Why it helps.', price: '' }] },
      { type: 'reviews', heading: 'What people say', items: [{ quote: 'Worth every penny.', name: 'A happy customer' }] },
      { type: 'buy', heading: 'Get it today', text: '', product: '', button_text: 'Buy now' },
      { type: 'faq', heading: 'Questions', items: [{ q: 'How do I pay?', a: 'By card, on a secure Stripe page.' }] },
    ] },
    { title: `${name}: thank you`, sections: [
      { type: 'hero', heading: 'Thank you for your order!', text: 'Your receipt is in your email. We will be in touch soon.', button_text: '', button_link: '' },
    ] },
  ] },
  call: { name: 'Book calls', about: 'A page that sells a free call, then the booking page.', steps: (name) => [
    { title: `${name}: free call`, sections: [
      { type: 'hero', heading: 'Book your free call', text: 'In 20 minutes we will look at where you are and the next best step.', button_text: 'Pick a time', button_link: '#book' },
      { type: 'services', heading: 'On the call we will', text: '', items: [{ title: 'Look at your goals', text: '', price: '' }, { title: 'Find what is holding you back', text: '', price: '' }, { title: 'Make a simple plan', text: '', price: '' }] },
      { type: 'booking', heading: 'Pick a time', text: 'It only takes a minute.' },
    ] },
  ] },
};
function create({ name, template = 'leads', biz } = {}) {
  name = String(name || '').trim().slice(0, 80);
  if (!name) throw err('Give the funnel a name.');
  const t = TEMPLATES[template] || TEMPLATES.leads;
  const bizId = businesses().get(biz) ? Number(biz) : (businesses().all()[0] || {}).id || null;
  const id = db.prepare('INSERT INTO crm_funnels (name, business_id) VALUES (?,?)').run(name, bizId).lastInsertRowid;
  t.steps(name).forEach((st, i) => {
    const page = sites().create({ template: 'blank', biz: bizId, title: st.title });
    const sections = st.sections.map((x) => (x.type === 'buy' && !x.product ? { ...x, product: String((db.prepare('SELECT id FROM crm_products WHERE active=1 ORDER BY id LIMIT 1').get() || {}).id || '') } : x));
    sites().save(page.id, { sections, published: true });
    db.prepare('INSERT INTO crm_funnel_steps (funnel_id, site_id, position) VALUES (?,?,?)').run(id, page.id, i);
  });
  return full(id);
}
function rename(id, body = {}) {
  const name = String(body.name || '').trim().slice(0, 80);
  if (!name) throw err('Give the funnel a name.');
  db.prepare('UPDATE crm_funnels SET name=? WHERE id=?').run(name, Number(id));
  return full(id);
}
// Removing a funnel keeps its pages (they stay in Sites).
function remove(id) { db.prepare('DELETE FROM crm_funnels WHERE id=?').run(Number(id)); return { ok: true }; }
function addStep(id, body = {}) {
  const f = full(id);
  let siteId = Number(body.site_id);
  if (!siteId) {
    const page = sites().create({ template: 'blank', biz: f.business_id, title: String(body.title || `${f.name}: step ${f.steps.length + 1}`) });
    sites().save(page.id, { published: true });
    siteId = page.id;
  }
  if (!db.prepare('SELECT id FROM crm_sites WHERE id=?').get(siteId)) throw err('Page not found', 404);
  const used = db.prepare('SELECT f.name FROM crm_funnel_steps s JOIN crm_funnels f ON f.id=s.funnel_id WHERE s.site_id=?').get(siteId);
  if (used) throw err(`That page is already a step in "${used.name}".`);
  db.prepare('INSERT INTO crm_funnel_steps (funnel_id, site_id, position) VALUES (?,?,?)').run(f.id, siteId, f.steps.length);
  return full(id);
}
function removeStep(id, stepId) { db.prepare('DELETE FROM crm_funnel_steps WHERE id=? AND funnel_id=?').run(Number(stepId), Number(id)); return full(id); }
function reorder(id, ids = []) {
  const st = db.prepare('UPDATE crm_funnel_steps SET position=? WHERE id=? AND funnel_id=?');
  db.transaction(() => ids.forEach((sid, i) => st.run(i, Number(sid), Number(id))))();
  return full(id);
}

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req) => ({ funnels: list(req.query.biz), templates: Object.fromEntries(Object.entries(TEMPLATES).map(([k, v]) => [k, { name: v.name, about: v.about }])) })));
router.post('/', wrap((req) => create({ ...(req.body || {}), biz: (req.body || {}).biz || req.query.biz })));
router.get('/:id', wrap((req) => full(req.params.id)));
router.put('/:id', wrap((req) => rename(req.params.id, req.body)));
router.delete('/:id', wrap((req) => remove(req.params.id)));
router.post('/:id/steps', wrap((req) => addStep(req.params.id, req.body)));
router.delete('/:id/steps/:sid', wrap((req) => removeStep(req.params.id, req.params.sid)));
router.post('/:id/order', wrap((req) => reorder(req.params.id, (req.body || {}).ids)));

module.exports = { nextSlug, full, list, create, rename, remove, addStep, removeStep, reorder, router, TEMPLATES };
