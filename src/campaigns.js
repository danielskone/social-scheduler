// Email marketing for Viral Touch CRM (like Omnisend): segments, campaigns and stats.
//
// Campaigns are sent by Brevo (free plan: 300 emails a day) as real marketing campaigns, so
// Brevo adds a working one-click unsubscribe link and tracks opens and clicks. Each hour this
// app reads the stats back, and anyone who unsubscribed is marked "Do not contact" here too,
// so automations never email them again.
//
// Rules (US CAN-SPAM): campaigns only ever go to people marked "OK to email" (they said yes),
// never to "Do not contact", and every email shows your mailing address and an unsubscribe link.
const express = require('express');
const db = require('./db');
const crm = require('./crm');
const email = require('./email');
const design = require('./emaildesign');
const notify = require('./notify');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_segments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  groups_json TEXT NOT NULL DEFAULT '[]',   -- empty = every group
  stages_json TEXT NOT NULL DEFAULT '[]',   -- empty = every stage
  joined_days INTEGER,                      -- only people who said yes in the last N days
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_campaigns (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  template_id INTEGER REFERENCES crm_templates(id) ON DELETE SET NULL,
  segment_id INTEGER REFERENCES crm_segments(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',     -- draft, sending, scheduled, sent, failed
  send_at TEXT,                             -- ISO; empty = send right away
  subject TEXT, html TEXT,                  -- what was actually sent
  recipients INTEGER,
  brevo_campaign_id INTEGER, brevo_list_id INTEGER,
  stats_json TEXT, stats_at TEXT,
  error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_email_state (key TEXT PRIMARY KEY, value TEXT);
`);
const getState = (k) => db.prepare('SELECT value FROM crm_email_state WHERE key=?').get(k)?.value;
const setState = (k, v) => db.prepare('INSERT INTO crm_email_state (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));

const err400 = (m) => Object.assign(new Error(m), { status: 400 });
const FREE_DAILY = () => Number(process.env.BREVO_DAILY_CAP || 300);

// ---------- Segments ----------
const parseSeg = (s) => s && { ...s, groups: JSON.parse(s.groups_json), stages: JSON.parse(s.stages_json), groups_json: undefined, stages_json: undefined };

function members(seg) {
  const where = ['email_ok=1', 'do_not_contact=0', "email IS NOT NULL AND email != ''"], args = {};
  if (seg?.groups?.length) { where.push(`group_name IN (${seg.groups.map((_, i) => `@g${i}`).join(',')})`); seg.groups.forEach((g, i) => (args[`g${i}`] = g)); }
  if (seg?.stages?.length) { where.push(`stage IN (${seg.stages.map((_, i) => `@s${i}`).join(',')})`); seg.stages.forEach((g, i) => (args[`s${i}`] = g)); }
  if (seg?.joined_days) { where.push("email_ok_at >= @since"); args.since = new Date(Date.now() - seg.joined_days * 86400e3).toISOString(); }
  return db.prepare(`SELECT * FROM contacts WHERE ${where.join(' AND ')} ORDER BY name COLLATE NOCASE`).all(args);
}

function saveSegment(body, id) {
  const old = id ? db.prepare('SELECT * FROM crm_segments WHERE id=?').get(id) : null;
  if (id && !old) throw Object.assign(new Error('Segment not found'), { status: 404 });
  const name = String(body.name || '').trim().slice(0, 120);
  if (!name) throw err400('Give the segment a name.');
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter(Boolean).slice(0, 30);
  const row = { name, groups_json: JSON.stringify(list(body.groups)), stages_json: JSON.stringify(list(body.stages).filter((s) => crm.STAGES.includes(s))),
    joined_days: Number(body.joined_days) > 0 ? Math.min(Math.round(Number(body.joined_days)), 3650) : null };
  if (old) db.prepare('UPDATE crm_segments SET name=@name, groups_json=@groups_json, stages_json=@stages_json, joined_days=@joined_days WHERE id=@id').run({ ...row, id });
  else id = db.prepare('INSERT INTO crm_segments (name, groups_json, stages_json, joined_days) VALUES (@name,@groups_json,@stages_json,@joined_days)').run(row).lastInsertRowid;
  return parseSeg(db.prepare('SELECT * FROM crm_segments WHERE id=?').get(id));
}
const listSegments = () => db.prepare('SELECT * FROM crm_segments ORDER BY id').all().map(parseSeg).map((s) => ({ ...s, count: members(s).length }));

if (!db.prepare("SELECT 1 FROM crm_flags WHERE name='starter_segments'").get()) {
  db.transaction(() => {
    saveSegment({ name: 'Everyone who said yes to email' });
    saveSegment({ name: 'Viral Attraction subscribers', groups: ['Viral Attraction lead'] });
    saveSegment({ name: 'Parade community', groups: ['Parade sponsor', 'Parade entry', 'Volunteer', 'Vendor', 'Donor'] });
    saveSegment({ name: 'Joined in the last 30 days', joined_days: 30 });
    db.prepare("INSERT INTO crm_flags (name) VALUES ('starter_segments')").run();
  })();
}

// ---------- Brevo marketing API ----------
async function brevo(method, path, body, { fetchImpl = fetch } = {}) {
  const s = email.settings();
  const res = await fetchImpl(`${s.api}/v3${path}`, {
    method, headers: { 'api-key': s.key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) throw new Error('Brevo says the API key is wrong (run: npm run email-setup)');
    throw new Error(data.message || `Brevo error ${res.status}`);
  }
  return data;
}

// Brevo has FIRSTNAME and LASTNAME built in; COMPANY is added once.
async function ensureCompanyField(opts) {
  if (getState('brevo_company_attr')) return;
  try { await brevo('POST', '/contacts/attributes/normal/COMPANY', { type: 'text' }, opts); } catch (e) { if (!/exist/i.test(e.message)) throw e; }
  setState('brevo_company_attr', 1);
}

async function folderId(opts) {
  const have = getState('brevo_folder_id');
  if (have) return Number(have);
  const f = await brevo('POST', '/contacts/folders', { name: 'Viral Touch CRM' }, opts);
  setState('brevo_folder_id', f.id);
  return f.id;
}

// Brevo personalizes campaigns itself; turn our fill-ins into its own.
const brevoFill = (text) => String(text || '')
  .replace(/\{first_name\}/g, "{{ contact.FIRSTNAME | default : 'there' }}")
  .replace(/\{name\}/g, '{{ contact.FIRSTNAME }} {{ contact.LASTNAME }}')
  .replace(/\{company\}/g, "{{ contact.COMPANY | default : 'your business' }}");

function campaignHtml(t) {
  const s = email.settings(), e = design.esc;
  const footer = `<b>${e(s.fromName)}</b><br>${e(s.address)}<br><br>You're getting this email because you said yes to email from us. `
    + '<a href="{{ unsubscribe }}" style="color:#80869a">Unsubscribe</a> any time with one click.';
  return design.render({ ...t, heading: brevoFill(t.heading), body: brevoFill(t.body), preheader: brevoFill(t.preheader) }, footer);
}

// ---------- Campaigns ----------
function saveCampaign(body, id) {
  const old = id ? db.prepare('SELECT * FROM crm_campaigns WHERE id=?').get(id) : null;
  if (id && !old) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  if (old && old.status !== 'draft' && old.status !== 'failed') throw err400('This campaign was already sent or scheduled, so it can no longer be changed. Copy it instead.');
  const name = String(body.name ?? old?.name ?? '').trim().slice(0, 120);
  if (!name) throw err400('Give the campaign a name.');
  const template_id = Number(body.template_id ?? old?.template_id) || null;
  if (template_id && !db.prepare("SELECT 1 FROM crm_templates WHERE id=? AND channel='email'").get(template_id)) throw err400('Pick one of your email designs.');
  const segment_id = Number(body.segment_id ?? old?.segment_id) || null;
  const sendAt = body.send_at === undefined ? old?.send_at : body.send_at;
  const send_at = sendAt && !Number.isNaN(Date.parse(sendAt)) ? new Date(sendAt).toISOString() : null;
  const row = { name, template_id, segment_id, send_at };
  if (old) db.prepare("UPDATE crm_campaigns SET name=@name, template_id=@template_id, segment_id=@segment_id, send_at=@send_at, status='draft', error=NULL WHERE id=@id").run({ ...row, id });
  else id = db.prepare('INSERT INTO crm_campaigns (name, template_id, segment_id, send_at) VALUES (@name,@template_id,@segment_id,@send_at)').run(row).lastInsertRowid;
  return getCampaign(id);
}
function getCampaign(id) {
  const c = db.prepare(`SELECT c.*, t.name AS template_name, s.name AS segment_name FROM crm_campaigns c
    LEFT JOIN crm_templates t ON t.id=c.template_id LEFT JOIN crm_segments s ON s.id=c.segment_id WHERE c.id=?`).get(id);
  if (c) { c.stats = c.stats_json ? JSON.parse(c.stats_json) : null; delete c.stats_json; delete c.html; }
  return c;
}
const listCampaigns = () => db.prepare('SELECT id FROM crm_campaigns ORDER BY COALESCE(sent_at, send_at, created_at) DESC, id DESC LIMIT 100').all().map((r) => getCampaign(r.id));

// Checks everything first, then hands the campaign to Brevo. Returns the updated campaign.
async function sendCampaign(id, opts = {}) {
  const c = db.prepare('SELECT * FROM crm_campaigns WHERE id=?').get(id);
  if (!c) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  if (!['draft', 'failed'].includes(c.status)) throw err400('This campaign was already sent or scheduled.');
  if (!email.ready()) throw err400('Email is not set up yet. In Terminal run: npm run email-setup');
  const t = db.prepare("SELECT * FROM crm_templates WHERE id=? AND channel='email'").get(c.template_id);
  if (!t) throw err400('Pick an email design for this campaign.');
  const seg = parseSeg(db.prepare('SELECT * FROM crm_segments WHERE id=?').get(c.segment_id));
  if (!seg) throw err400('Pick who gets this campaign (a segment).');
  if (c.send_at && Date.parse(c.send_at) < Date.now() + 2 * 60e3) throw err400('Pick a send time at least a few minutes from now, or clear it to send right away.');
  await syncUnsubscribes(opts).catch(() => {}); // never email someone who just unsubscribed
  const people = members(seg);
  if (!people.length) throw err400('Nobody in this segment has said yes to email yet.');
  const room = FREE_DAILY() - email.status().sentToday;
  if (people.length > room) throw err400(`Brevo's free plan sends up to ${FREE_DAILY()} emails a day, and this segment has ${people.length} people (room for ${Math.max(room, 0)} today). Pick a smaller segment or split it over two days.`);

  db.prepare("UPDATE crm_campaigns SET status='sending', error=NULL WHERE id=?").run(id);
  try {
    const s = email.settings();
    await ensureCompanyField(opts);
    const list = await brevo('POST', '/contacts/lists', { name: `${c.name} (${new Date().toISOString().slice(0, 10)})`.slice(0, 100), folderId: await folderId(opts) }, opts);
    for (const p of people) {
      const [first, ...rest] = String(p.name || '').split(/\s+/);
      await brevo('POST', '/contacts', { email: p.email, listIds: [list.id], updateEnabled: true,
        attributes: { FIRSTNAME: first || '', LASTNAME: rest.join(' '), ...(p.company ? { COMPANY: p.company } : {}) } }, opts);
    }
    const subject = brevoFill(t.subject || t.name), html = campaignHtml(t);
    const camp = await brevo('POST', '/emailCampaigns', {
      name: c.name, subject, previewText: brevoFill(t.preheader || ''), sender: { name: s.fromName, email: s.from }, replyTo: s.from,
      htmlContent: html, recipients: { listIds: [list.id] }, ...(c.send_at ? { scheduledAt: c.send_at } : {}),
    }, opts);
    if (!c.send_at) await brevo('POST', `/emailCampaigns/${camp.id}/sendNow`, null, opts);
    db.prepare(`UPDATE crm_campaigns SET status=?, subject=?, html=?, recipients=?, brevo_campaign_id=?, brevo_list_id=?, sent_at=? WHERE id=?`)
      .run(c.send_at ? 'scheduled' : 'sent', subject, html, people.length, camp.id, list.id, c.send_at || new Date().toISOString(), id);
    for (const p of people) crm.logActivity(p.id, { kind: 'Email', note: `${c.send_at ? 'Scheduled' : 'Sent'} campaign "${c.name}"` });
  } catch (e) {
    db.prepare("UPDATE crm_campaigns SET status='failed', error=? WHERE id=?").run(String(e.message).slice(0, 300), id);
    throw err400(`Brevo did not take the campaign: ${e.message}`);
  }
  return getCampaign(id);
}

function copyCampaign(id) {
  const c = db.prepare('SELECT * FROM crm_campaigns WHERE id=?').get(id);
  if (!c) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  return saveCampaign({ name: `${c.name} (copy)`, template_id: c.template_id, segment_id: c.segment_id, send_at: null });
}

// ---------- Stats and unsubscribes (hourly) ----------
async function refreshStats(opts = {}) {
  if (!email.ready()) return 0;
  const rows = db.prepare(`SELECT * FROM crm_campaigns WHERE brevo_campaign_id IS NOT NULL AND status IN ('sent','scheduled')
    AND sent_at >= ? ORDER BY id DESC LIMIT 30`).all(new Date(Date.now() - 60 * 86400e3).toISOString());
  let n = 0;
  for (const r of rows) {
    try {
      const d = await brevo('GET', `/emailCampaigns/${r.brevo_campaign_id}?statistics=globalStats`, null, opts);
      const g = d.statistics?.globalStats || {};
      const stats = { sent: g.sent || 0, delivered: g.delivered || 0, opened: g.uniqueViews || 0, clicked: g.uniqueClicks || 0,
        unsubscribed: g.unsubscriptions || 0, bounced: (g.hardBounces || 0) + (g.softBounces || 0), complaints: g.complaints || 0 };
      const status = r.status === 'scheduled' && d.status === 'sent' ? 'sent' : r.status;
      db.prepare("UPDATE crm_campaigns SET stats_json=?, stats_at=datetime('now'), status=? WHERE id=?").run(JSON.stringify(stats), status, r.id);
      n++;
    } catch (e) { console.error(`[campaigns] stats for "${r.name}": ${e.message}`); }
  }
  return n;
}

// People who unsubscribed (or marked spam) in Brevo become "Do not contact" here.
async function syncUnsubscribes(opts = {}) {
  if (!email.ready()) return 0;
  const since = getState('unsub_synced_at') || new Date(Date.now() - 365 * 86400e3).toISOString();
  const started = new Date().toISOString();
  let offset = 0, marked = 0;
  for (let page = 0; page < 20; page++) {
    const d = await brevo('GET', `/contacts?limit=500&offset=${offset}&modifiedSince=${encodeURIComponent(since)}`, null, opts);
    for (const bc of d.contacts || []) {
      if (!bc.emailBlacklisted) continue;
      const c = db.prepare('SELECT * FROM contacts WHERE lower(email)=lower(?)').get(bc.email);
      if (!c || c.do_not_contact) continue;
      crm.updateContact(c.id, { do_not_contact: true });
      crm.logActivity(c.id, { kind: 'Email', note: 'Unsubscribed from emails (through Brevo). Marked "Do not contact".' });
      marked++;
    }
    if ((d.contacts || []).length < 500) break;
    offset += 500;
  }
  setState('unsub_synced_at', started);
  if (marked) notify.send('Unsubscribed', `${marked} ${marked === 1 ? 'person' : 'people'} unsubscribed from your emails. They're now "Do not contact".`, { tags: 'wave' }).catch(() => {});
  return marked;
}

async function hourly(opts) {
  try { await syncUnsubscribes(opts); } catch (e) { console.error(`[campaigns] unsubscribes: ${e.message}`); }
  try { await refreshStats(opts); } catch (e) { console.error(`[campaigns] stats: ${e.message}`); }
}

function overview() {
  const subscribers = db.prepare("SELECT COUNT(*) AS n FROM contacts WHERE email_ok=1 AND do_not_contact=0 AND email IS NOT NULL AND email != ''").get().n;
  const newSubs = db.prepare("SELECT COUNT(*) AS n FROM contacts WHERE email_ok=1 AND do_not_contact=0 AND email_ok_at >= ?").get(new Date(Date.now() - 30 * 86400e3).toISOString()).n;
  const sent = listCampaigns().filter((c) => c.stats && c.stats.delivered);
  const sum = (k) => sent.reduce((n, c) => n + (c.stats[k] || 0), 0);
  const delivered = sum('delivered');
  const flowEmails = db.prepare("SELECT COUNT(*) AS n FROM crm_emails_sent WHERE status='sent' AND automation_id IS NOT NULL AND sent_at >= datetime('now','-30 days')").get().n;
  return { subscribers, newSubs, campaignsSent: listCampaigns().filter((c) => c.status === 'sent').length, flowEmails,
    openRate: delivered ? sum('opened') / delivered : null, clickRate: delivered ? sum('clicked') / delivered : null, unsubscribed: sum('unsubscribed') };
}

// ---------- Routes (mounted at /api/crm/email) ----------
const router = express.Router();
const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req, res) => res.json({ overview: overview(), email: email.status(), segments: listSegments(), campaigns: listCampaigns(), groups: crm.GROUPS, stages: crm.STAGES })));
router.post('/segments', wrap((req, res) => res.json(saveSegment(req.body || {}))));
router.put('/segments/:id', wrap((req, res) => res.json(saveSegment(req.body || {}, Number(req.params.id)))));
router.delete('/segments/:id', wrap((req, res) => { db.prepare('DELETE FROM crm_segments WHERE id=?').run(req.params.id); res.json({ ok: true }); }));
router.get('/segments/:id/people', wrap((req, res) => res.json(members(parseSeg(db.prepare('SELECT * FROM crm_segments WHERE id=?').get(req.params.id))).map((c) => ({ id: c.id, name: c.name, email: c.email, group_name: c.group_name })))));
router.post('/campaigns', wrap((req, res) => res.json(saveCampaign(req.body || {}))));
router.put('/campaigns/:id', wrap((req, res) => res.json(saveCampaign(req.body || {}, Number(req.params.id)))));
router.delete('/campaigns/:id', wrap((req, res) => { db.prepare("DELETE FROM crm_campaigns WHERE id=? AND status IN ('draft','failed')").run(req.params.id); res.json({ ok: true }); }));
router.post('/campaigns/:id/send', wrap(async (req, res) => res.json(await sendCampaign(Number(req.params.id)))));
router.post('/campaigns/:id/copy', wrap((req, res) => res.json(copyCampaign(Number(req.params.id)))));
router.post('/refresh', wrap(async (req, res) => { await hourly(); res.json({ ok: true }); }));
// What an email design looks like, for the preview box.
router.post('/preview', express.json({ limit: '200kb' }), wrap((req, res) => {
  const t = req.body || {}, sample = { name: 'Alex Smith', company: 'Smith Hardware' };
  res.type('html').send(design.render({ ...t, heading: crm.fillTemplate(t.heading, sample), body: crm.fillTemplate(t.body, sample), preheader: '' },
    email.footerHtml('you said yes to email from us')));
}));
router.get('/preview/:templateId', wrap((req, res) => {
  const t = db.prepare('SELECT * FROM crm_templates WHERE id=?').get(req.params.templateId);
  if (!t) return res.status(404).send('Not found');
  const sample = { name: 'Alex Smith', company: 'Smith Hardware' };
  res.type('html').send(design.render({ ...t, heading: crm.fillTemplate(t.heading, sample), body: crm.fillTemplate(t.body, sample), preheader: '' },
    email.footerHtml('you said yes to email from us')));
}));

module.exports = { router, members, saveSegment, listSegments, saveCampaign, sendCampaign, copyCampaign, getCampaign, refreshStats, syncUnsubscribes, hourly, overview, brevoFill };
