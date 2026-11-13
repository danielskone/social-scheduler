// Business templates (GoHighLevel calls them "snapshots").
//
// Save the whole setup of one business (groups, pipelines, custom fields, forms, booking pages,
// website pages, products, email templates, automations, smart lists, chat bubble and its
// answer bot) as a template. Then start a new business from it in one click, or download it as
// a file and load it into a customer's own copy of the CRM. People, payments and messages are
// never copied: a template is only the setup.
//
// Three ready-made starter templates come with the CRM (auto shop, coach, event or nonprofit).
const express = require('express');
const crypto = require('crypto');
const db = require('../../src/db');

// Make sure every table a template touches exists before reading it.
for (const m of ['crm', 'businesses', 'pipelines', 'fields', 'booking', 'sites', 'products', 'automations', 'chat', 'lists']) require(`./${m}`);
db.exec(`
CREATE TABLE IF NOT EXISTS crm_biz_templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  data TEXT NOT NULL,                     -- JSON (the same as the downloaded file)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
const businesses = () => require('./businesses');
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const FORMAT = 'viral-touch-template';
const json = (v, d) => { try { return JSON.parse(v); } catch { return d; } };
const pick = (row, cols) => Object.fromEntries(cols.filter((c) => c in row).map((c) => [c, row[c]]));
const has = (table) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
const colsOf = (table) => db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((r) => r.name);

const FORM_COLS = ['title', 'intro', 'group_name', 'ask_company', 'ask_phone', 'ask_message', 'email_checkbox', 'thank_you', 'active', 'fields', 'style'];
const BOOK_COLS = ['title', 'intro', 'location', 'group_name', 'minutes', 'days', 'start_time', 'end_time', 'days_ahead', 'notice_hours', 'email_checkbox', 'active', 'buffer_minutes', 'max_per_day', 'remind_hours'];
const TPL_COLS = ['name', 'channel', 'subject', 'body', 'preheader', 'heading', 'image_url', 'button_text', 'button_url'];

// ---------- Making a template from a business ----------
function capture(bizId, { name, description } = {}) {
  const b = businesses().get(bizId);
  if (!b) throw err('Pick a business first.', 404);
  const groups = businesses().groupsOf(b.id) || b.groups;
  const inGroups = (g) => groups.includes(g);
  const automations = db.prepare('SELECT * FROM crm_automations ORDER BY id').all()
    .map((a) => ({ name: a.name, trigger: json(a.trigger_json, {}), steps: json(a.steps_json, []) }))
    .filter((a) => a.trigger && a.trigger.group && inGroups(a.trigger.group));
  const tplIds = new Set(automations.flatMap((a) => a.steps.map((s) => s.template_id)).filter(Boolean));
  const templates = db.prepare('SELECT * FROM crm_templates ORDER BY id').all().filter((t) => tplIds.has(t.id)).map((t) => ({ ref: t.id, ...pick(t, TPL_COLS) }));
  const data = {
    format: FORMAT, version: 1, name: String(name || `${b.name} setup`).trim().slice(0, 80), description: String(description || '').trim().slice(0, 300),
    business: { color: b.color }, groups,
    pipelines: db.prepare('SELECT name, stages, sort FROM crm_pipelines WHERE business_id=? ORDER BY sort, id').all(b.id).map((p) => ({ ...p, stages: json(p.stages, []) })),
    fields: db.prepare('SELECT label, type, options, sort FROM crm_fields WHERE business_id=? ORDER BY sort, id').all(b.id).map((f) => ({ ...f, options: json(f.options, null) })),
    forms: db.prepare('SELECT * FROM crm_forms ORDER BY id').all().filter((f) => inGroups(f.group_name)).map((f) => pick(f, FORM_COLS)),
    booking: db.prepare('SELECT * FROM crm_booking_pages ORDER BY id').all().filter((p) => inGroups(p.group_name)).map((p) => pick(p, BOOK_COLS)),
    sites: db.prepare('SELECT * FROM crm_sites WHERE business_id=? ORDER BY id').all(b.id).map((s) => ({ ...pick(s, ['title', 'description', 'font', 'look', 'color', 'chat']), sections: json(s.sections, []) })),
    products: db.prepare('SELECT name, description, price, max_qty, active FROM crm_products WHERE business_id=? ORDER BY id').all(b.id),
    templates, automations,
    smart_lists: db.prepare('SELECT name, filters_json FROM crm_smart_lists WHERE business_id=? ORDER BY id').all(b.id).map((l) => ({ name: l.name, filters: json(l.filters_json, {}) })),
    chat: (() => { const c = db.prepare('SELECT greeting, bot_on, bot_fallback FROM crm_chat_settings WHERE business_id=?').get(b.id); return c ? { ...c, bot_on: Boolean(c.bot_on) } : null; })(),
    faq: db.prepare('SELECT question, answer, keywords FROM crm_chat_faq WHERE business_id=? ORDER BY sort, id').all(b.id),
  };
  return data;
}
const counts = (d) => ({ groups: (d.groups || []).length, pipelines: (d.pipelines || []).length, fields: (d.fields || []).length, forms: (d.forms || []).length,
  booking: (d.booking || []).length, sites: (d.sites || []).length, products: (d.products || []).length, templates: (d.templates || []).length,
  automations: (d.automations || []).length, smart_lists: (d.smart_lists || []).length, faq: (d.faq || []).length });

function check(d) {
  if (!d || typeof d !== 'object' || d.format !== FORMAT) throw err('That file is not a Viral Touch template.');
  if (JSON.stringify(d).length > 3e6) throw err('That template is too big.');
  for (const k of ['groups', 'pipelines', 'fields', 'forms', 'booking', 'sites', 'products', 'templates', 'automations', 'smart_lists', 'faq']) if (d[k] != null && !Array.isArray(d[k])) throw err('That template file is damaged.');
  return d;
}
function save(data) {
  check(data);
  const r = db.prepare('INSERT INTO crm_biz_templates (name, description, data) VALUES (?,?,?)').run(String(data.name || 'My template').slice(0, 80), data.description || null, JSON.stringify(data));
  return get(r.lastInsertRowid);
}
function get(id) {
  const t = db.prepare('SELECT * FROM crm_biz_templates WHERE id=?').get(Number(id));
  if (!t) return null;
  const data = json(t.data, {});
  return { id: t.id, name: t.name, description: t.description, created_at: t.created_at, counts: counts(data), data };
}
const list = () => [...STARTERS.map((s) => ({ id: s.key, starter: true, name: s.name, description: s.description, counts: counts(s) })),
  ...db.prepare('SELECT id FROM crm_biz_templates ORDER BY id DESC').all().map((r) => { const t = get(r.id); delete t.data; return t; })];
const dataOf = (id) => { const s = STARTERS.find((x) => x.key === id); if (s) return s; const t = get(id); if (!t) throw err('Template not found', 404); return t.data; };

// ---------- Starting a business from a template ----------
const rnd = (n = 6) => crypto.randomBytes(n).toString('hex');
function apply(input, { name, color } = {}) {
  const d = check(typeof input === 'object' && input.format ? input : dataOf(input));
  name = String(name || '').trim().slice(0, 80);
  if (!name) throw err('Give the new business a name.');
  const B = businesses();
  // A group can only belong to one business, so a name already in use gets the business name after it.
  const taken = new Set(B.all().flatMap((b) => b.groups));
  const gmap = new Map((d.groups || []).map((g) => [g, taken.has(g) ? `${g} (${name})`.slice(0, 60) : g]));
  const G = (g) => (g && gmap.has(g) ? gmap.get(g) : g);
  const made = { forms: 0, booking: 0, sites: 0, products: 0, pipelines: 0, fields: 0, templates: 0, automations: 0, smart_lists: 0, faq: 0 };
  let bizId;
  db.transaction(() => {
    const sort = (db.prepare('SELECT MAX(sort) AS m FROM crm_businesses').get().m || 0) + 1;
    bizId = db.prepare('INSERT INTO crm_businesses (name, color, groups, sort) VALUES (?,?,?,?)').run(name, /^#[0-9a-f]{6}$/i.test(color || '') ? color : (d.business && d.business.color) || '#4f46e5', JSON.stringify([...gmap.values()]), sort).lastInsertRowid;
    for (const p of d.pipelines || []) { db.prepare('INSERT INTO crm_pipelines (business_id, name, stages, sort) VALUES (?,?,?,?)').run(bizId, String(p.name).slice(0, 60), JSON.stringify(p.stages || []), p.sort || 0); made.pipelines++; }
    for (const f of d.fields || []) { db.prepare('INSERT INTO crm_fields (business_id, label, type, options, sort) VALUES (?,?,?,?,?)').run(bizId, String(f.label).slice(0, 60), f.type || 'text', JSON.stringify(Array.isArray(f.options) ? f.options : []), f.sort || 0); made.fields++; }
    const fcols = colsOf('crm_forms');
    for (const f of d.forms || []) {
      const row = { ...pick(f, FORM_COLS.filter((c) => fcols.includes(c))), group_name: G(f.group_name) || [...gmap.values()][0] || 'Other', slug: rnd() };
      db.prepare(`INSERT INTO crm_forms (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map((k) => '@' + k).join(',')})`).run(row); made.forms++;
    }
    const bcols = colsOf('crm_booking_pages');
    for (const p of d.booking || []) {
      const row = { ...pick(p, BOOK_COLS.filter((c) => bcols.includes(c))), group_name: G(p.group_name) || [...gmap.values()][0] || 'Other', slug: rnd(5) };
      db.prepare(`INSERT INTO crm_booking_pages (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map((k) => '@' + k).join(',')})`).run(row); made.booking++;
    }
    for (const s of d.sites || []) {
      const base = String(`${name} ${s.title || 'page'}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 34) || 'site';
      let slug = base, n = 1; while (db.prepare('SELECT 1 FROM crm_sites WHERE slug=?').get(slug)) slug = `${base}-${++n}`;
      db.prepare('INSERT INTO crm_sites (business_id, slug, title, description, sections, font, look, color, chat, published) VALUES (?,?,?,?,?,?,?,?,?,0)')
        .run(bizId, slug, String(s.title || 'Home').slice(0, 120), s.description || null, JSON.stringify(s.sections || []), s.font || 'modern', s.look || 'light', s.color || null, s.chat ? 1 : 0); made.sites++;
    }
    for (const p of d.products || []) {
      db.prepare('INSERT INTO crm_products (business_id, name, description, price, max_qty, active, token) VALUES (?,?,?,?,?,?,?)')
        .run(bizId, String(p.name).slice(0, 120), p.description || null, Number(p.price) || 0, p.max_qty || 10, p.active == null ? 1 : p.active ? 1 : 0, crypto.randomBytes(9).toString('base64url')); made.products++;
    }
    const tcols = colsOf('crm_templates'), tmap = new Map();
    for (const t of d.templates || []) {
      const row = pick(t, TPL_COLS.filter((c) => tcols.includes(c)));
      if (!row.body) continue;
      row.name = String(row.name || 'Template').slice(0, 80); row.channel = row.channel === 'text' ? 'text' : 'email';
      tmap.set(t.ref, db.prepare(`INSERT INTO crm_templates (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map((k) => '@' + k).join(',')})`).run(row).lastInsertRowid); made.templates++;
    }
    // Automations arrive switched off (Draft), so nothing is sent until you look them over and press Publish.
    for (const a of d.automations || []) {
      const trigger = { ...a.trigger, group: G(a.trigger && a.trigger.group) };
      const steps = (a.steps || []).map((s) => ({ ...s, ...(s.template_id ? { template_id: tmap.get(s.template_id) || null } : {}), ...(s.group ? { group: G(s.group) } : {}) }));
      db.prepare('INSERT INTO crm_automations (name, active, trigger_json, steps_json) VALUES (?,0,?,?)').run(`${String(a.name).slice(0, 70)} (${name})`.slice(0, 100), JSON.stringify(trigger), JSON.stringify(steps)); made.automations++;
    }
    for (const l of d.smart_lists || []) {
      const f = { ...l.filters, ...(l.filters && l.filters.group ? { group: G(l.filters.group) } : {}) };
      db.prepare('INSERT INTO crm_smart_lists (business_id, name, filters_json) VALUES (?,?,?)').run(bizId, String(l.name).slice(0, 60), JSON.stringify(f)); made.smart_lists++;
    }
    if (d.chat || (d.faq || []).length) {
      db.prepare('INSERT INTO crm_chat_settings (business_id, key, enabled, greeting, bot_on, bot_fallback) VALUES (?,?,1,?,?,?)')
        .run(bizId, rnd(8), (d.chat && d.chat.greeting) || null, d.chat && d.chat.bot_on ? 1 : 0, (d.chat && d.chat.bot_fallback) || null);
      (d.faq || []).forEach((f, i) => { db.prepare('INSERT INTO crm_chat_faq (business_id, question, answer, keywords, sort) VALUES (?,?,?,?,?)').run(bizId, String(f.question).slice(0, 200), String(f.answer).slice(0, 1500), f.keywords || null, i + 1); made.faq++; });
    }
  })();
  return { business: B.get(bizId), made, renamed: [...gmap].filter(([a, b]) => a !== b).map(([from, to]) => ({ from, to })) };
}

// ---------- Ready-made starters ----------
const lead = (group, pipeline) => ({ name: `New ${group.toLowerCase()}`, trigger: { type: 'contact_added', group, stage: null },
  steps: [{ type: 'email', template_id: 1 }, { type: 'task', title: `Call {name} (new ${group.toLowerCase()})`, due_days: 0, template_id: null }, { type: 'follow_up', days: 2 }] });
const welcome = (biz) => ({ ref: 1, name: `Welcome (${biz})`, channel: 'email', subject: 'Thanks for reaching out, {first_name}!', body: `Hi {first_name},\n\nThanks for getting in touch. We got your message and will call you soon.\n\nTalk soon!` });
const S = (stages) => stages.map(([name, kind]) => ({ name, kind: kind || 'open' }));
const STARTERS = [
  { key: 'starter-auto', format: FORMAT, version: 1, name: 'Auto shop or car detailing', description: 'Leads, quotes and booked jobs for a car business.',
    business: { color: '#0d9488' }, groups: ['Auto lead', 'Auto customer'],
    pipelines: [{ name: 'Jobs', sort: 1, stages: S([['New'], ['Quote sent'], ['Booked'], ['Done', 'won'], ['Lost', 'lost']]) }],
    fields: [{ label: 'Car', type: 'text', sort: 1 }, { label: 'Service wanted', type: 'choice', options: ['Detail', 'Repair', 'Oil change', 'Other'], sort: 2 }],
    forms: [{ title: 'Get a free quote', intro: 'Tell us about your car and we will text or call you back today.', group_name: 'Auto lead', ask_company: 0, ask_phone: 1, ask_message: 1, thank_you: 'Thanks! We will reach out today.', active: 1 }],
    booking: [{ title: 'Book a service', intro: 'Pick a time to drop off your car.', group_name: 'Auto customer', minutes: 60, days: '1,2,3,4,5,6', start_time: '08:00', end_time: '17:00', days_ahead: 30, notice_hours: 12, active: 1 }],
    products: [{ name: 'Full detail', description: 'Inside and outside', price: 180, max_qty: 2, active: 1 }],
    templates: [welcome('auto')], automations: [lead('Auto lead')],
    smart_lists: [{ name: 'New leads', filters: { group: 'Auto lead', stage: 'New' } }],
    chat: { greeting: 'Hi! Need a quote or a time for your car? Ask here.', bot_on: true },
    faq: [{ question: 'What are your hours?', answer: 'We are open Monday to Saturday, 8 AM to 5 PM.', keywords: 'open, hours, close, time' },
      { question: 'How much does a detail cost?', answer: 'A full detail starts at $180. Send us your car model for an exact price.', keywords: 'price, cost, how much, detail' },
      { question: 'Can I book online?', answer: 'Yes! Use the "Book a service" page on our website to pick a time.', keywords: 'book, appointment, schedule' }] },
  { key: 'starter-coach', format: FORMAT, version: 1, name: 'Coach or consultant', description: 'Free calls, proposals and clients for a service business.',
    business: { color: '#4f46e5' }, groups: ['Coaching lead', 'Coaching client'],
    pipelines: [{ name: 'Clients', sort: 1, stages: S([['New'], ['Call booked'], ['Proposal sent'], ['Won', 'won'], ['Lost', 'lost']]) }],
    fields: [{ label: 'Goal', type: 'text', sort: 1 }],
    forms: [{ title: 'Apply for a free call', intro: 'A few questions so the call is useful for you.', group_name: 'Coaching lead', ask_company: 1, ask_phone: 1, ask_message: 1, thank_you: 'Thanks! Pick a time on the next page.', active: 1 }],
    booking: [{ title: 'Free 30 minute call', intro: 'A friendly call to see if we are a fit.', group_name: 'Coaching lead', minutes: 30, days: '1,2,3,4', start_time: '10:00', end_time: '16:00', days_ahead: 21, notice_hours: 24, active: 1 }],
    products: [{ name: 'Strategy session', description: '90 minutes, one on one', price: 250, max_qty: 1, active: 1 }],
    templates: [welcome('coach')], automations: [lead('Coaching lead')],
    smart_lists: [{ name: 'Clients', filters: { group: 'Coaching client' } }],
    chat: { greeting: 'Hi! Questions about working together? Ask away.', bot_on: true },
    faq: [{ question: 'How does a free call work?', answer: 'It is a 30 minute video call. Book it on our website and you will get the link by email.', keywords: 'free call, consultation, meet' },
      { question: 'What does it cost?', answer: 'Packages start at $250. We share exact prices on the free call.', keywords: 'price, cost, how much, rates' }] },
  { key: 'starter-event', format: FORMAT, version: 1, name: 'Event or nonprofit', description: 'Sponsors, donors, volunteers and entries for an event.',
    business: { color: '#dc2626' }, groups: ['Sponsor', 'Donor', 'Volunteer', 'Entry'],
    pipelines: [{ name: 'Sponsors', sort: 1, stages: S([['New'], ['Contacted'], ['Committed'], ['Paid', 'won'], ['Said no', 'lost']]) }],
    fields: [{ label: 'T-shirt size', type: 'choice', options: ['S', 'M', 'L', 'XL', '2XL'], sort: 1 }],
    forms: [{ title: 'Volunteer sign-up', intro: 'Thank you for helping! Tell us how to reach you.', group_name: 'Volunteer', ask_company: 0, ask_phone: 1, ask_message: 1, thank_you: 'Thank you! We will email you the details.', active: 1 },
      { title: 'Become a sponsor', intro: 'Sponsors make the event possible.', group_name: 'Sponsor', ask_company: 1, ask_phone: 1, ask_message: 1, thank_you: 'Thank you! We will call you this week.', active: 1 }],
    booking: [], products: [{ name: 'Gold sponsor', description: 'Logo on the banner and website', price: 500, max_qty: 1, active: 1 }],
    templates: [welcome('event')], automations: [lead('Sponsor'), lead('Volunteer')],
    smart_lists: [{ name: 'Sponsors to call', filters: { group: 'Sponsor', stage: 'Contacted' } }],
    chat: { greeting: 'Hi! Ask us about the event, sponsoring or volunteering.', bot_on: true },
    faq: [{ question: 'When is the event?', answer: 'See the date and times on our website home page.', keywords: 'date, when, time, day' },
      { question: 'How can I volunteer?', answer: 'Fill out the volunteer sign-up form on our website. Thank you!', keywords: 'volunteer, help, sign up' },
      { question: 'How do I become a sponsor?', answer: 'Use the "Become a sponsor" form and we will call you this week.', keywords: 'sponsor, sponsorship, logo, banner' }] },
];

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req, res)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap(() => list()));
router.post('/capture', wrap((req) => { const b = req.body || {}; const t = save(capture(b.business_id || req.query.biz, b)); delete t.data; return t; }));
router.post('/upload', wrap((req) => { const t = save(check((req.body || {}).data)); delete t.data; return t; }));
router.post('/apply', wrap((req) => { const b = req.body || {}; return apply(b.data ? b.data : b.id, b); }));
router.get('/:id/download', (req, res) => {
  try {
    const data = dataOf(/^starter-/.test(req.params.id) ? req.params.id : Number(req.params.id));
    const file = `${String(data.name || 'template').replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'template'}.viraltouch.json`;
    res.set('Content-Disposition', `attachment; filename="${file}"`).type('application/json').send(JSON.stringify(data, null, 2));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
router.get('/:id', wrap((req) => { const d = dataOf(/^starter-/.test(req.params.id) ? req.params.id : Number(req.params.id)); return { name: d.name, description: d.description, counts: counts(d), groups: d.groups,
  forms: (d.forms || []).map((f) => f.title), booking: (d.booking || []).map((b) => b.title), automations: (d.automations || []).map((a) => a.name), pipelines: (d.pipelines || []).map((p) => p.name) }; }));
router.delete('/:id', wrap((req) => { db.prepare('DELETE FROM crm_biz_templates WHERE id=?').run(Number(req.params.id)); return { ok: true }; }));

module.exports = { capture, save, get, list, apply, check, STARTERS, router };
