// Contacts (a small personal CRM): people and businesses, the groups they belong to,
// notes/history, money pledged or paid, and follow-up reminders.
//
// Also: tasks, a pipeline board (the UI groups contacts by stage), message templates that
// open in your own Mail/Messages app one person at a time, and public sign-up forms.
//
// On purpose this app never bulk-sends email or texts. It only records whether
// someone said yes to email (and when/how), so a list can be exported to a proper email
// service that handles unsubscribe links and spam rules. That keeps your own email and
// social accounts safe from spam flags.
const express = require('express');
const db = require('../../src/db');
const notify = require('../../src/notify');
const config = require('../../src/config');
const { EventEmitter } = require('events');

// Automations (automations.js) listen here: contact_added, form_filled, stage_changed, appointment_booked.
const events = new EventEmitter();
function emit(event, data) {
  try { events.emit('crm', { event, ...data }); } catch (e) { console.error(`[crm] automation error: ${e.message}`); }
}

// Daniel's own copy starts with his groups; a customer's copy starts with everyday ones.
const GROUPS = config.ownerStarters
  ? ['Parade sponsor', 'Donor', 'Parade entry', 'Volunteer', 'Vendor', 'Viral Attraction lead', 'Auto customer', 'Other']
  : ['Lead', 'Customer', 'Partner', 'Vendor', 'Other'];
// Pipeline steps live in pipelines.js; each business can name its own.
const pipes = () => require('./pipelines');
const FIELDS = ['name', 'company', 'email', 'phone', 'website', 'address', 'group_name', 'stage', 'amount',
  'next_follow_up', 'email_ok', 'email_ok_source', 'do_not_contact', 'notes', 'pipeline_id'];

db.exec(`
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT, email TEXT, phone TEXT, website TEXT, address TEXT,
  group_name TEXT NOT NULL DEFAULT 'Other',
  stage TEXT NOT NULL DEFAULT 'New',
  amount REAL,                          -- dollars pledged/paid/spent
  next_follow_up TEXT,                  -- YYYY-MM-DD
  email_ok INTEGER NOT NULL DEFAULT 0,  -- they agreed to get email from you
  email_ok_source TEXT,                 -- how they agreed, e.g. "signed up on website"
  email_ok_at TEXT,
  do_not_contact INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contact_activities (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'Note',    -- Note, Call, Email, Meeting, Payment
  note TEXT NOT NULL,
  happened_on TEXT NOT NULL,            -- YYYY-MM-DD
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_reminders_sent (day TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS crm_tasks (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_on TEXT,                          -- YYYY-MM-DD
  done_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_forms (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,            -- random, so the link can't be guessed
  title TEXT NOT NULL,
  intro TEXT,
  group_name TEXT NOT NULL DEFAULT 'Other',
  ask_company INTEGER NOT NULL DEFAULT 1,
  ask_phone INTEGER NOT NULL DEFAULT 1,
  ask_message INTEGER NOT NULL DEFAULT 1,
  email_checkbox TEXT,                  -- wording of the optional "email me" box; empty = no box
  thank_you TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_form_entries (
  id INTEGER PRIMARY KEY,
  form_id INTEGER NOT NULL REFERENCES crm_forms(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  answers TEXT NOT NULL,                -- JSON [{ id, label, type, value }]
  files TEXT,                           -- JSON [{ field, label, name, file }] saved in data/form-files
  source TEXT NOT NULL DEFAULT 'link',  -- 'link' (this app's page) or 'website' (always-on website code)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','text')),
  subject TEXT,
  body TEXT NOT NULL
);
`);
// Look-up shortcuts so contact pages stay quick as the list grows.
db.exec(`
CREATE INDEX IF NOT EXISTS idx_activities_contact ON contact_activities(contact_id);
CREATE INDEX IF NOT EXISTS idx_tasks_contact ON crm_tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_form_entries_form ON crm_form_entries(form_id);
`);
// Tasks can carry a message template (automations use this), ready to open with one tap.
if (!db.prepare("SELECT 1 FROM pragma_table_info('crm_tasks') WHERE name='template_id'").get()) {
  db.exec('ALTER TABLE crm_tasks ADD COLUMN template_id INTEGER REFERENCES crm_templates(id) ON DELETE SET NULL');
}
// Email templates can also be designed emails (heading, picture, button) for campaigns and flows.
const DESIGN = ['preheader', 'heading', 'image_url', 'button_text', 'button_url'];
for (const col of DESIGN) {
  if (!db.prepare("SELECT 1 FROM pragma_table_info('crm_templates') WHERE name=?").get(col)) db.exec(`ALTER TABLE crm_templates ADD COLUMN ${col} TEXT`);
}

if (config.ownerStarters && !db.prepare('SELECT 1 FROM crm_templates LIMIT 1').get()) {
  const add = db.prepare('INSERT INTO crm_templates (name, channel, subject, body) VALUES (?,?,?,?)');
  const site = 'https://fuquayvarinachristmasparade.org';
  add.run('Sponsor ask', 'email', 'Sponsor the Fuquay-Varina Christmas Parade?',
    `Hi {first_name},\n\nI'm reaching out about the Fuquay-Varina Christmas Parade. We'd love to have {company} as a sponsor this year. Sponsors are thanked on our social pages and at the parade.\n\nYou can see sponsor levels and sign up here: ${site}\n\nThank you,\nDaniel King`);
  add.run('Sponsor thank you', 'email', 'Thank you for sponsoring the parade!',
    `Hi {first_name},\n\nThank you for sponsoring the Fuquay-Varina Christmas Parade! We'll be sharing a thank-you post soon.\n\nParade details: ${site}\n\nDaniel King`);
  add.run('Quick follow-up text', 'text', null,
    `Hi {first_name}, this is Daniel King with the Fuquay-Varina Christmas Parade. Just following up. Details are at ${site}`);
  add.run('Parade entry reminder text', 'text', null,
    `Hi {first_name}, reminder from the Fuquay-Varina Christmas Parade: please make sure your entry registration is complete at ${site}. Thank you!`);
}

const biz = () => require('./businesses');

const today = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function clean(body, existing = {}) {
  const c = { ...existing };
  for (const f of FIELDS) if (f in body) c[f] = body[f];
  const str = (v) => (v == null ? null : String(v).trim() || null);
  for (const f of ['name', 'company', 'email', 'phone', 'website', 'address', 'email_ok_source', 'notes']) c[f] = str(c[f]);
  if (!c.name) c.name = c.company;
  if (!c.name) throw Object.assign(new Error('Add a name or a company.'), { status: 400 });
  c.group_name = str(c.group_name) || 'Other';
  c.pipeline_id = c.pipeline_id === '' || c.pipeline_id == null ? null : Number(c.pipeline_id);
  if (c.pipeline_id && !pipes().get(c.pipeline_id)) c.pipeline_id = null;
  const steps = pipes().stageNames(pipes().ofContact(c));
  // A step that isn't in their pipeline (or none at all) means the pipeline's first step.
  c.stage = steps.includes(c.stage) ? c.stage : steps[0];
  c.amount = c.amount === '' || c.amount == null ? null : Number(String(c.amount).replace(/[$,\s]/g, ''));
  if (c.amount != null && !Number.isFinite(c.amount)) throw Object.assign(new Error('Amount must be a number.'), { status: 400 });
  c.next_follow_up = /^\d{4}-\d{2}-\d{2}$/.test(c.next_follow_up || '') ? c.next_follow_up : null;
  c.do_not_contact = c.do_not_contact === true || c.do_not_contact === 1 || c.do_not_contact === '1' || c.do_not_contact === 'true' ? 1 : 0;
  c.email_ok = (c.email_ok === true || c.email_ok === 1 || c.email_ok === '1' || c.email_ok === 'true') && !c.do_not_contact ? 1 : 0;
  if (c.email_ok && !c.email) throw Object.assign(new Error('Add an email address before marking "OK to email".'), { status: 400 });
  if (c.email_ok && !c.email_ok_source) throw Object.assign(new Error('Say how they agreed to email (for example "signed up on parade website").'), { status: 400 });
  // Remember when consent was given; clear it when it's taken away.
  c.email_ok_at = c.email_ok ? (existing.email_ok ? existing.email_ok_at : new Date().toISOString()) : null;
  if (!c.email_ok) c.email_ok_source = null;
  return c;
}

const cols = [...FIELDS, 'email_ok_at'];

// opts.source: 'manual', 'form', 'booking' or 'import'. Imports don't start automations,
// so loading an old spreadsheet can't create hundreds of tasks at once.
function createContact(body, { source = 'manual', form } = {}) {
  const c = clean(body);
  const r = db.prepare(`INSERT INTO contacts (${cols.join(',')}) VALUES (${cols.map((k) => '@' + k).join(',')})`).run(c);
  if (source !== 'import') {
    emit('contact_added', { contact: getContact(r.lastInsertRowid), source, form });
    if (c.email_ok) emit('email_opt_in', { contact: getContact(r.lastInsertRowid), source, form });
  }
  return getContact(r.lastInsertRowid);
}

function updateContact(id, body) {
  const old = db.prepare('SELECT * FROM contacts WHERE id=?').get(id);
  if (!old) throw Object.assign(new Error('Contact not found'), { status: 404 });
  const c = clean(body, old);
  db.prepare(`UPDATE contacts SET ${cols.map((k) => `${k}=@${k}`).join(',')}, updated_at=datetime('now') WHERE id=@id`).run({ ...c, id: old.id });
  if (old.email_ok && !c.email_ok) logActivity(old.id, { kind: 'Note', note: 'Removed from email list (no longer OK to email).' });
  if (!old.email_ok && c.email_ok) logActivity(old.id, { kind: 'Note', note: `OK to email: ${c.email_ok_source}` });
  if (!old.email_ok && c.email_ok) emit('email_opt_in', { contact: getContact(old.id) });
  if (old.stage !== c.stage) emit('stage_changed', { contact: getContact(old.id), from: old.stage, to: c.stage });
  return getContact(old.id);
}

function getContact(id) {
  const c = db.prepare('SELECT * FROM contacts WHERE id=?').get(id);
  if (!c) return null;
  c.pipeline = pipes().ofContact(c).id;
  c.activities = db.prepare('SELECT * FROM contact_activities WHERE contact_id=? ORDER BY happened_on DESC, id DESC').all(id);
  c.tasks = db.prepare('SELECT t.*, (SELECT name FROM crm_templates WHERE id=t.template_id) AS template_name FROM crm_tasks t WHERE contact_id=? ORDER BY (done_at IS NOT NULL), (due_on IS NULL), due_on, id').all(id);
  return c;
}

function listContacts({ q, group, stage, due, biz: b, pipeline } = {}) {
  const where = [], args = {};
  const bf = biz().filter(b);
  if (bf.sql) { let n = 0; where.push(bf.sql.replace(/\?/g, () => `@bg${n++}`)); bf.args.forEach((g, i) => { args[`bg${i}`] = g; }); }
  if (q) { where.push(`(name LIKE @q OR company LIKE @q OR email LIKE @q OR phone LIKE @q OR notes LIKE @q)`); args.q = `%${q}%`; }
  if (group) { where.push('group_name=@group'); args.group = group; }
  if (stage) { where.push('stage=@stage'); args.stage = stage; }
  if (due) { where.push('next_follow_up IS NOT NULL AND next_follow_up <= @today'); args.today = today(); }
  const rows = db.prepare(`SELECT * FROM contacts ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (next_follow_up IS NULL), next_follow_up, name COLLATE NOCASE`).all(args);
  // Which pipeline each person is in (people with none are in their business's first pipeline).
  for (const r of rows) { const p = pipes().ofContact(r); r.pipeline = p.id; r.stage_kind = pipes().kindOf(p, r.stage); }
  return pipeline ? rows.filter((r) => r.pipeline === Number(pipeline)) : rows;
}

function logActivity(contactId, { kind = 'Note', note, happened_on } = {}) {
  note = String(note || '').trim();
  if (!note) throw Object.assign(new Error('Write a note first.'), { status: 400 });
  if (!db.prepare('SELECT 1 FROM contacts WHERE id=?').get(contactId)) throw Object.assign(new Error('Contact not found'), { status: 404 });
  const day = /^\d{4}-\d{2}-\d{2}$/.test(happened_on || '') ? happened_on : today();
  db.prepare('INSERT INTO contact_activities (contact_id, kind, note, happened_on) VALUES (?,?,?,?)').run(contactId, String(kind).slice(0, 30), note, day);
  db.prepare("UPDATE contacts SET updated_at=datetime('now') WHERE id=?").run(contactId);
}

function summary(b) {
  const t = today();
  const bf = biz().filter(b);
  const W = bf.sql ? `WHERE ${bf.sql}` : '';
  const row = db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN next_follow_up IS NOT NULL AND next_follow_up <= ? THEN 1 ELSE 0 END) AS due,
      SUM(CASE WHEN email_ok=1 AND do_not_contact=0 THEN 1 ELSE 0 END) AS emailable
    FROM contacts ${W}`).get(t, ...bf.args);
  // Money: "open" steps add up as still to come, "won" steps as paid (each pipeline names its own steps).
  row.pledged = 0; row.paid = 0;
  for (const c of db.prepare(`SELECT stage, group_name, pipeline_id, amount FROM contacts ${W ? `${W} AND` : 'WHERE'} amount IS NOT NULL`).all(...bf.args)) {
    const kind = pipes().kindOf(pipes().ofContact(c), c.stage);
    if (kind === 'won') row.paid += c.amount; else if (kind === 'open') row.pledged += c.amount;
  }
  const byGroup = db.prepare(`SELECT group_name, COUNT(*) AS n, SUM(COALESCE(amount,0)) AS amount FROM contacts ${W} GROUP BY group_name ORDER BY n DESC`).all(...bf.args);
  const tf = biz().filter(b, 'c.group_name');
  const tasksDue = db.prepare(`SELECT COUNT(*) AS n FROM crm_tasks t LEFT JOIN contacts c ON c.id=t.contact_id
    WHERE t.done_at IS NULL AND t.due_on IS NOT NULL AND t.due_on <= ?${tf.sql ? ` AND (t.contact_id IS NULL OR ${tf.sql})` : ''}`).get(t, ...tf.args).n;
  return { ...row, tasksDue, due: row.due || 0, emailable: row.emailable || 0, pledged: row.pledged || 0, paid: row.paid || 0, byGroup };
}

// ---------- CSV ----------
const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formulas from running
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows, headers) => [headers.map((h) => csvCell(h[0])).join(','), ...rows.map((r) => headers.map((h) => csvCell(r[h[1]])).join(','))].join('\r\n') + '\r\n';

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

// Column names people commonly use in spreadsheets -> our fields.
const HEADER_MAP = {
  name: 'name', 'full name': 'name', contact: 'name', 'contact name': 'name',
  company: 'company', business: 'company', organization: 'company', organisation: 'company',
  email: 'email', 'email address': 'email', 'e-mail': 'email',
  phone: 'phone', 'phone number': 'phone', mobile: 'phone', cell: 'phone',
  website: 'website', address: 'address',
  group: 'group_name', type: 'group_name', category: 'group_name',
  stage: 'stage', status: 'stage', amount: 'amount', 'amount ($)': 'amount',
  'next follow-up': 'next_follow_up', 'follow up': 'next_follow_up', 'follow-up': 'next_follow_up',
  notes: 'notes', note: 'notes',
  'ok to email': 'email_ok', 'how they agreed to email': 'email_ok_source', 'do not contact': 'do_not_contact',
};
const yes = (v) => /^(y|yes|true|1|x)$/i.test(String(v || '').trim());

function importCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw Object.assign(new Error('That file has no rows under the header.'), { status: 400 });
  const map = rows[0].map((h) => HEADER_MAP[h.trim().toLowerCase()] || null);
  if (!map.includes('name') && !map.includes('company')) throw Object.assign(new Error('The first row needs a "Name" or "Company" column.'), { status: 400 });
  let imported = 0, skipped = 0; const errors = [];
  const run = db.transaction(() => {
    rows.slice(1).forEach((r, i) => {
      const body = {};
      map.forEach((f, j) => { if (f) body[f] = r[j]; });
      body.email_ok = yes(body.email_ok); body.do_not_contact = yes(body.do_not_contact);
      if (body.email_ok && !body.email_ok_source) body.email_ok = false; // never assume consent
      if (body.stage) body.stage = pipes().allStageNames().find((s) => s.toLowerCase() === String(body.stage).trim().toLowerCase()) || null;
      const email = String(body.email || '').trim();
      if (email && db.prepare('SELECT 1 FROM contacts WHERE lower(email)=lower(?)').get(email)) { skipped++; return; }
      try { createContact(body, { source: 'import' }); imported++; } catch (e) { errors.push(`Row ${i + 2}: ${e.message}`); }
    });
  });
  run();
  return { imported, skipped, errors: errors.slice(0, 10) };
}

const EXPORT_HEADERS = [['Name', 'name'], ['Company', 'company'], ['Email', 'email'], ['Phone', 'phone'], ['Website', 'website'],
  ['Address', 'address'], ['Group', 'group_name'], ['Stage', 'stage'], ['Amount', 'amount'], ['Next follow-up', 'next_follow_up'],
  ['OK to email', 'email_ok_yes'], ['How they agreed to email', 'email_ok_source'], ['Date agreed', 'email_ok_at'],
  ['Do not contact', 'dnc_yes'], ['Notes', 'notes']];

function exportCsv({ emailList = false } = {}) {
  const rows = emailList
    ? db.prepare("SELECT * FROM contacts WHERE email_ok=1 AND do_not_contact=0 AND email IS NOT NULL ORDER BY name COLLATE NOCASE").all()
    : db.prepare('SELECT * FROM contacts ORDER BY name COLLATE NOCASE').all();
  rows.forEach((r) => { r.email_ok_yes = r.email_ok ? 'Yes' : ''; r.dnc_yes = r.do_not_contact ? 'Yes' : ''; });
  if (emailList) {
    const first = (n) => String(n || '').split(/\s+/)[0];
    const last = (n) => String(n || '').split(/\s+/).slice(1).join(' ');
    rows.forEach((r) => { r.first = first(r.name); r.last = last(r.name); });
    return toCsv(rows, [['Email', 'email'], ['First name', 'first'], ['Last name', 'last'], ['Company', 'company'], ['Group', 'group_name'], ['Consent source', 'email_ok_source'], ['Consent date', 'email_ok_at']]);
  }
  return toCsv(rows, EXPORT_HEADERS);
}

// ---------- Daily phone reminder ----------
async function sendFollowUpReminder(now = new Date()) {
  const day = today(now);
  if (!notify.topic()) return false;
  if (db.prepare('SELECT 1 FROM crm_reminders_sent WHERE day=?').get(day)) return false;
  const due = db.prepare('SELECT name, company, next_follow_up FROM contacts WHERE next_follow_up IS NOT NULL AND next_follow_up <= ? AND do_not_contact=0 ORDER BY next_follow_up, name').all(day);
  const tasks = db.prepare(`SELECT t.title, t.due_on, c.name FROM crm_tasks t LEFT JOIN contacts c ON c.id=t.contact_id
    WHERE t.done_at IS NULL AND t.due_on IS NOT NULL AND t.due_on <= ? ORDER BY t.due_on, t.id`).all(day);
  db.prepare('INSERT INTO crm_reminders_sent (day) VALUES (?)').run(day);
  const items = [
    ...require('./booking').todaysLines(now),
    ...tasks.map((t) => `• ${t.title}${t.name ? ` (${t.name})` : ''}${t.due_on < day ? ' (overdue)' : ''}`),
    ...due.map((c) => `• Follow up: ${c.name}${c.company && c.company !== c.name ? ` (${c.company})` : ''}${c.next_follow_up < day ? ' (overdue)' : ''}`),
  ];
  if (!items.length) return false;
  const lines = items.slice(0, 10);
  if (items.length > 10) lines.push(`…and ${items.length - 10} more`);
  return notify.send(`${items.length} thing${items.length === 1 ? '' : 's'} today`, lines.join('\n'), { tags: 'telephone_receiver' });
}

// ---------- Tasks ----------
const err400 = (m) => Object.assign(new Error(m), { status: 400 });
const ymdOrNull = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);

function listTasks({ open, contact_id, biz: b } = {}) {
  const where = [], args = {};
  const bf = biz().filter(b, 'c.group_name');
  if (bf.sql) { let n = 0; where.push(`(t.contact_id IS NULL OR ${bf.sql.replace(/\?/g, () => `@bg${n++}`)})`); bf.args.forEach((g, i) => { args[`bg${i}`] = g; }); }
  if (open) where.push('t.done_at IS NULL');
  if (contact_id) { where.push('t.contact_id=@cid'); args.cid = Number(contact_id); }
  return db.prepare(`SELECT t.*, c.name AS contact_name, (SELECT name FROM crm_templates WHERE id=t.template_id) AS template_name
    FROM crm_tasks t LEFT JOIN contacts c ON c.id=t.contact_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (t.done_at IS NOT NULL), (t.due_on IS NULL), t.due_on, t.id`).all(args);
}
function saveTask(body, id) {
  const old = id ? db.prepare('SELECT * FROM crm_tasks WHERE id=?').get(id) : {};
  if (!old) throw Object.assign(new Error('Task not found'), { status: 404 });
  const t = { ...old, ...body };
  t.title = String(t.title || '').trim();
  if (!t.title) throw err400('Say what the task is.');
  t.due_on = ymdOrNull(t.due_on);
  t.contact_id = t.contact_id ? Number(t.contact_id) : null;
  if ('done' in body) t.done_at = body.done ? (old.done_at || new Date().toISOString()) : null;
  if (id) db.prepare('UPDATE crm_tasks SET title=@title, due_on=@due_on, contact_id=@contact_id, done_at=@done_at WHERE id=@id').run({ ...t, id });
  else id = db.prepare('INSERT INTO crm_tasks (title, due_on, contact_id, done_at) VALUES (@title,@due_on,@contact_id,@done_at)').run({ done_at: null, ...t }).lastInsertRowid;
  if (body.done && !old.done_at && t.contact_id) logActivity(t.contact_id, { kind: 'Task', note: `Done: ${t.title}` });
  return db.prepare('SELECT * FROM crm_tasks WHERE id=?').get(id);
}

// ---------- Message templates ----------
// Fill {first_name}, {name}, {company} for one person. Messages open in your own Mail or
// Messages app, one person at a time, so nothing is ever bulk-sent from your accounts.
function fillTemplate(text, c) {
  const first = String(c.name || '').split(/\s+/)[0] || 'there';
  return String(text || '').replace(/\{(first_name|name|company)\}/g, (_, k) => (k === 'first_name' ? first : k === 'company' ? c.company || c.name || 'your business' : c.name || ''));
}
function saveTemplate(body, id) {
  const t = { name: String(body.name || '').trim(), channel: body.channel === 'text' ? 'text' : 'email', subject: String(body.subject || '').trim() || null, body: String(body.body || '').trim() };
  if (!t.name || !t.body) throw err400('A template needs a name and a message.');
  for (const k of DESIGN) t[k] = t.channel === 'email' ? String(body[k] || '').trim().slice(0, 500) || null : null;
  if (t.button_text && !/^https?:\/\//i.test(t.button_url || '')) throw err400('The button needs a web address that starts with https://');
  if (t.image_url && !/^https:\/\//i.test(t.image_url)) throw err400('The picture needs a web address that starts with https:// (for example from your website).');
  const cols = ['name', 'channel', 'subject', 'body', ...DESIGN];
  if (id) db.prepare(`UPDATE crm_templates SET ${cols.map((k) => `${k}=@${k}`).join(',')} WHERE id=@id`).run({ ...t, id });
  else id = db.prepare(`INSERT INTO crm_templates (${cols.join(',')}) VALUES (${cols.map((k) => '@' + k).join(',')})`).run(t).lastInsertRowid;
  return db.prepare('SELECT * FROM crm_templates WHERE id=?').get(id);
}
// Builds the message for one contact and logs it. Refuses people marked "Do not contact".
function prepareMessage(contactId, templateId) {
  const c = db.prepare('SELECT * FROM contacts WHERE id=?').get(contactId);
  const t = db.prepare('SELECT * FROM crm_templates WHERE id=?').get(templateId);
  if (!c || !t) throw Object.assign(new Error('Not found'), { status: 404 });
  if (c.do_not_contact) throw err400(`${c.name} is marked "Do not contact".`);
  if (t.channel === 'email' && !c.email) throw err400(`${c.name} has no email address.`);
  if (t.channel === 'text' && !c.phone) throw err400(`${c.name} has no phone number.`);
  const subject = fillTemplate(t.subject, c), body = fillTemplate(t.body, c);
  const link = t.channel === 'email'
    ? `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : `sms:${String(c.phone).replace(/[^\d+]/g, '')}&body=${encodeURIComponent(body)}`;
  logActivity(c.id, { kind: t.channel === 'email' ? 'Email' : 'Text', note: `Opened "${t.name}" to send` });
  return { link, subject, body };
}

// ---------- Sign-up forms (public pages that add leads) ----------
// The form builder (forms.js) stores each form's questions as JSON in "fields" and its look in "style".
// Older forms have no "fields" yet; forms.js builds their questions from the ask_* switches.
const crypto = require('crypto');
for (const col of ['fields', 'style']) {
  if (!db.prepare('PRAGMA table_info(crm_forms)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE crm_forms ADD COLUMN ${col} TEXT`);
}
const asJson = (v) => (v == null || v === '' ? null : typeof v === 'string' ? v : JSON.stringify(v));
function saveForm(body, id) {
  const old = id ? db.prepare('SELECT * FROM crm_forms WHERE id=?').get(id) : null;
  if (id && !old) throw Object.assign(new Error('Form not found'), { status: 404 });
  const bool = (v, d) => (v === undefined ? d : v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? 1 : 0);
  const f = {
    title: String(body.title ?? old?.title ?? '').trim(),
    intro: String(body.intro ?? old?.intro ?? '').trim() || null,
    group_name: String(body.group_name ?? old?.group_name ?? '').trim() || 'Other',
    ask_company: bool(body.ask_company, old ? old.ask_company : 1),
    ask_phone: bool(body.ask_phone, old ? old.ask_phone : 1),
    ask_message: bool(body.ask_message, old ? old.ask_message : 1),
    email_checkbox: String(body.email_checkbox ?? old?.email_checkbox ?? '').trim() || null,
    thank_you: String(body.thank_you ?? old?.thank_you ?? '').trim() || null,
    active: bool(body.active, old ? old.active : 1),
    fields: body.fields !== undefined ? asJson(body.fields) : old?.fields ?? null,
    style: body.style !== undefined ? asJson(body.style) : old?.style ?? null,
  };
  if (!f.title) throw err400('Give the form a title.');
  if (f.fields) {
    // Keep the old switches in step with the questions, so older parts of the app still read them right.
    let list;
    try { list = JSON.parse(f.fields); } catch { throw err400('The form questions could not be read.'); }
    if (!Array.isArray(list)) throw err400('The form questions could not be read.');
    const has = (t) => list.some((x) => x && x.type === t);
    f.ask_company = has('company') ? 1 : 0; f.ask_phone = has('phone') ? 1 : 0; f.ask_message = has('long') ? 1 : 0;
    const consent = list.find((x) => x && x.type === 'consent');
    f.email_checkbox = consent ? String(consent.label || '').trim() || 'Yes, email me news and updates. I can unsubscribe any time.' : null;
  }
  if (old) db.prepare(`UPDATE crm_forms SET title=@title, intro=@intro, group_name=@group_name, ask_company=@ask_company, ask_phone=@ask_phone,
    ask_message=@ask_message, email_checkbox=@email_checkbox, thank_you=@thank_you, active=@active, fields=@fields, style=@style WHERE id=@id`).run({ ...f, id });
  else id = db.prepare(`INSERT INTO crm_forms (slug, title, intro, group_name, ask_company, ask_phone, ask_message, email_checkbox, thank_you, active, fields, style)
    VALUES (@slug,@title,@intro,@group_name,@ask_company,@ask_phone,@ask_message,@email_checkbox,@thank_you,@active,@fields,@style)`).run({ ...f, slug: crypto.randomBytes(6).toString('hex') }).lastInsertRowid;
  return db.prepare('SELECT * FROM crm_forms WHERE id=?').get(id);
}

// Ready-made parade forms, added once. If you delete one later it stays deleted.
db.exec('CREATE TABLE IF NOT EXISTS crm_flags (name TEXT PRIMARY KEY)');
if (config.ownerStarters && !db.prepare("SELECT 1 FROM crm_flags WHERE name='starter_forms'").get()) {
  const site = 'fuquayvarinachristmasparade.org';
  const box = 'Yes, email me Fuquay-Varina Christmas Parade news and updates. I can unsubscribe any time.';
  db.transaction(() => {
    saveForm({ title: 'Become a Fuquay-Varina Christmas Parade sponsor', group_name: 'Parade sponsor', ask_company: true, ask_phone: true, ask_message: true,
      intro: 'Help light up downtown Fuquay-Varina! Sponsors are thanked on our social pages and at the parade. Leave your details and we will send you the sponsor levels and perks.',
      email_checkbox: box, thank_you: `Thank you for your interest in sponsoring the parade! We will reach out soon. You can also see sponsor levels at ${site}.` });
    saveForm({ title: 'Register a parade entry', group_name: 'Parade entry', ask_company: true, ask_phone: true, ask_message: true,
      intro: 'Want to walk, ride or roll in the Fuquay-Varina Christmas Parade? Tell us about your group or float (type, size, number of people) and we will follow up with next steps.',
      email_checkbox: box, thank_you: `Thanks! We got your entry interest and will be in touch. Full entry rules and registration are at ${site}.` });
    saveForm({ title: 'Volunteer at the Christmas Parade', group_name: 'Volunteer', ask_company: false, ask_phone: true, ask_message: true,
      intro: 'We need friendly helpers on parade day for line-up, route safety and more. Sign up and we will be in touch with times and details.',
      email_checkbox: box, thank_you: `Thank you for volunteering! We will contact you with details. More info at ${site}.` });
    db.prepare("INSERT INTO crm_flags (name) VALUES ('starter_forms')").run();
  })();
}

const hits = new Map(); // ip -> [timestamps], simple spam brake for the public forms
function tooMany(ip, now = Date.now()) {
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  list.push(now); hits.set(ip, list);
  return list.length > 20;
}

// Saves a public form submission. Returns { contact, isNew }.
// opts.optIn = { source } marks them OK to email (used for website newsletter sign-ups).
function submitForm(form, body, opts = {}) {
  const s = (k, n) => String(body[k] || '').trim().slice(0, n);
  const name = s('name', 120), email = s('email', 200).toLowerCase(), phone = s('phone', 40), company = s('company', 160), message = s('message', 2000);
  if (!name) throw err400('Please enter your name.');
  if (!email && !phone) throw err400('Please enter an email or phone number.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err400('That email address does not look right.');
  const optIn = Boolean(email && (opts.optIn || (form.email_checkbox && body.email_ok)));
  const existing = email ? db.prepare('SELECT * FROM contacts WHERE lower(email)=?').get(email) : null;
  const source = opts.optIn ? String(opts.optIn.source) : `Checked "${form.email_checkbox}" on form "${form.title}"`;
  let contact, isNew = false;
  if (existing) {
    const patch = {};
    if (!existing.phone && phone) patch.phone = phone;
    if (!existing.company && company) patch.company = company;
    if (optIn && !existing.email_ok && !existing.do_not_contact) Object.assign(patch, { email_ok: true, email_ok_source: source });
    contact = Object.keys(patch).length ? updateContact(existing.id, patch) : existing;
  } else {
    contact = createContact({ name, email, phone, company, group_name: form.group_name, stage: 'New', email_ok: optIn, email_ok_source: optIn ? source : null }, { source: 'form', form: form.title });
    isNew = true;
  }
  logActivity(contact.id, { kind: 'Form', note: `Filled out "${form.title}"${message ? `:\n${message}` : ''}` });
  emit('form_filled', { contact: getContact(contact.id), form: form.title, isNew, newsletterOnly: Boolean(opts.newsletterOnly ?? (opts.optIn && !message)) });
  return { contact: getContact(contact.id), isNew };
}

const page = (title, inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="robots" content="noindex"><style>
:root{color-scheme:light dark;--bg:#f6f7f9;--panel:#fff;--text:#1d2330;--muted:#6b7385;--line:#e3e6ec;--accent:#3b5bdb}
@media (prefers-color-scheme:dark){:root{--bg:#14161b;--panel:#1c1f26;--text:#e6e8ee;--muted:#9aa1b2;--line:#2c313b;--accent:#7c95ff}}
body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px 16px}
.card{max-width:520px;margin:0 auto;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:24px}
h1{font-size:1.4rem;margin:0 0 8px}p{line-height:1.5}label{display:block;margin:14px 0 6px;font-weight:600;font-size:.92rem}
input,textarea{width:100%;box-sizing:border-box;font:inherit;color:inherit;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px}
.check{display:flex;gap:8px;align-items:flex-start;font-weight:400}.check input{width:auto;margin-top:3px}
button{margin-top:18px;width:100%;padding:12px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.hp{position:absolute;left:-9999px}.err{color:#c92a2a}.muted{color:var(--muted);font-size:.85rem}
</style></head><body><div class="card">${inner}</div></body></html>`;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = (v) => esc(v).replace(/\n/g, '<br>');

// The public form pages (/f/...) and the form builder's routes live in forms.js.

// ---------- Routes (mounted at /api/crm) ----------
const router = express.Router();
const wrap = (fn) => (req, res) => {
  try { fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
};
router.get('/meta', (req, res) => {
  const used = db.prepare('SELECT DISTINCT group_name FROM contacts').all().map((r) => r.group_name);
  const every = [...new Set([...GROUPS, ...used])];
  const b = req.query.biz;
  // With a business picked, only its groups are offered.
  const groups = b && b !== 'all' ? (biz().groupsOf(b, GROUPS) || every) : every;
  const pipelines = pipes().forBiz(b);
  res.json({ groups, stages: [...new Set(pipelines.flatMap(pipes().stageNames))], pipelines, summary: summary(b) });
});
router.get('/contacts', wrap((req, res) => res.json(listContacts(req.query))));
router.post('/contacts', wrap((req, res) => { biz().claim(req.query.biz, (req.body || {}).group_name); res.json(createContact(req.body || {})); }));
router.get('/contacts/:id', wrap((req, res) => {
  const c = getContact(req.params.id);
  if (!c) return res.status(404).json({ error: 'Contact not found' });
  res.json(c);
}));
router.put('/contacts/:id', wrap((req, res) => { biz().claim(req.query.biz, (req.body || {}).group_name); res.json(updateContact(req.params.id, req.body || {})); }));
router.delete('/contacts/:id', wrap((req, res) => {
  db.prepare('DELETE FROM contacts WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));
router.post('/contacts/:id/activities', wrap((req, res) => {
  logActivity(Number(req.params.id), req.body || {});
  res.json(getContact(req.params.id));
}));
router.delete('/activities/:id', wrap((req, res) => {
  db.prepare('DELETE FROM contact_activities WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));
router.get('/tasks', wrap((req, res) => res.json(listTasks(req.query))));
router.post('/tasks', wrap((req, res) => res.json(saveTask(req.body || {}))));
router.put('/tasks/:id', wrap((req, res) => res.json(saveTask(req.body || {}, Number(req.params.id)))));
router.delete('/tasks/:id', wrap((req, res) => { db.prepare('DELETE FROM crm_tasks WHERE id=?').run(req.params.id); res.json({ ok: true }); }));
router.get('/templates', wrap((req, res) => res.json(db.prepare('SELECT * FROM crm_templates ORDER BY channel, name').all())));
router.post('/templates', wrap((req, res) => res.json(saveTemplate(req.body || {}))));
router.put('/templates/:id', wrap((req, res) => res.json(saveTemplate(req.body || {}, Number(req.params.id)))));
router.delete('/templates/:id', wrap((req, res) => { db.prepare('DELETE FROM crm_templates WHERE id=?').run(req.params.id); res.json({ ok: true }); }));
router.post('/contacts/:id/message', wrap((req, res) => res.json(prepareMessage(Number(req.params.id), Number((req.body || {}).template_id)))));
router.post('/import', express.text({ type: '*/*', limit: '10mb' }), wrap((req, res) => res.json(importCsv(req.body))));
router.get('/export.csv', wrap((req, res) => {
  const emailList = req.query.list === 'email';
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${emailList ? 'email-list-opted-in' : 'contacts'}-${today()}.csv"`);
  res.send('﻿' + exportCsv({ emailList }));
}));

module.exports = { events, emit, html: { page, esc, nl }, router, listTasks, saveTask, saveTemplate, fillTemplate, prepareMessage, saveForm, submitForm, tooMany, createContact, updateContact, getContact, listContacts, logActivity, importCsv, exportCsv, parseCsv, summary, sendFollowUpReminder, GROUPS,
  get STAGES() { return pipes().allStageNames(); } };
