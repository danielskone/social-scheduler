// Facebook and Instagram messages in Conversations (like GoHighLevel's one inbox).
//
// Every 2 minutes it asks Facebook for new Messenger messages on your Pages and new Instagram
// direct messages, using the Pages you already connected in Viral Post (official Graph API,
// no scraping). Someone new becomes a contact by themselves. Their messages show in
// Conversations next to their emails and chats, your iPhone buzzes, and you answer from the CRM.
//
// Facebook rules: you can answer within 24 hours of their last message (after that, answer
// in the Facebook or Instagram app). While the Meta app is in Development mode, Facebook only
// lets apps see messages from people who have a role on the app (you and your testers); real
// customers show up once the app passes Meta's App Review for pages_messaging.
const express = require('express');
const db = require('../../src/db');
const notify = require('../../src/notify');
const meta = require('../../src/meta');

require('./inbox'); // makes crm_messages
require('./chat'); // adds crm_messages.channel
db.exec(`
CREATE TABLE IF NOT EXISTS crm_social_people (
  platform TEXT NOT NULL,                  -- facebook or instagram
  account_id INTEGER NOT NULL,             -- the Page or Instagram account in Viral Post
  user_id TEXT NOT NULL,                   -- their id for that Page (Facebook only gives page-scoped ids)
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  handle TEXT,                             -- Instagram @username
  PRIMARY KEY (platform, account_id, user_id)
);
CREATE INDEX IF NOT EXISTS crm_social_people_contact ON crm_social_people(contact_id);
CREATE TABLE IF NOT EXISTS crm_social_accounts (
  account_id INTEGER PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  group_name TEXT,                         -- group for new people (empty = first group of the first business)
  last_check TEXT, last_error TEXT,
  since TEXT                               -- newest conversation time already read
);
`);
if (!db.prepare("SELECT 1 FROM pragma_table_info('crm_messages') WHERE name='account_id'").get()) db.exec('ALTER TABLE crm_messages ADD COLUMN account_id INTEGER');

const crm = () => require('./crm');
const businesses = () => require('./businesses');
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const NAMES = { facebook: 'Facebook', instagram: 'Instagram' };
const WINDOW_MS = 24 * 3600e3;

// The Page (and its token) behind each account. Instagram calls go through its linked Page.
function accounts() {
  const rows = db.prepare("SELECT id, platform, external_id, name, username, picture_url, access_token FROM accounts WHERE platform IN ('facebook','instagram') ORDER BY platform, name").all();
  const pages = rows.filter((r) => r.platform === 'facebook');
  return rows.map((a) => {
    const page = a.platform === 'facebook' ? a : pages.find((p) => p.access_token === a.access_token);
    const s = db.prepare('SELECT * FROM crm_social_accounts WHERE account_id=?').get(a.id) || { enabled: 1 };
    return { ...a, page_id: page ? page.external_id : null, page_name: page ? page.name : null, enabled: Boolean(s.enabled), group_name: s.group_name || null,
      last_check: s.last_check || null, last_error: s.last_error || null, since: s.since || null };
  });
}
const accountById = (id) => accounts().find((a) => a.id === Number(id));
function setState(accountId, fields) {
  db.prepare('INSERT INTO crm_social_accounts (account_id) VALUES (?) ON CONFLICT(account_id) DO NOTHING').run(accountId);
  for (const [k, v] of Object.entries(fields)) db.prepare(`UPDATE crm_social_accounts SET ${k}=? WHERE account_id=?`).run(v, accountId);
}

// For the page: what is connected, and what each one can do.
function status() {
  const list = accounts().map(({ access_token, ...a }) => ({ ...a, can: Boolean(a.page_id) }));
  return { accounts: list, connected: list.length > 0, on: list.some((a) => a.enabled && a.can),
    groups: [...new Set(businesses().all().flatMap((b) => b.groups))] };
}
function saveAccount(id, body = {}) {
  const a = accountById(id);
  if (!a) throw err('That account is not connected in Viral Post.', 404);
  const f = {};
  if ('enabled' in body) f.enabled = body.enabled ? 1 : 0;
  if ('group_name' in body) f.group_name = String(body.group_name || '').trim().slice(0, 60) || null;
  setState(a.id, f);
  return status();
}

function newPersonGroup(a) {
  if (a.group_name) return a.group_name;
  const first = businesses().all()[0];
  return (first && first.groups[0]) || 'Other';
}
// Finds (or makes) the contact for someone who messaged a Page or Instagram account.
function personFor(a, from) {
  const known = db.prepare('SELECT contact_id FROM crm_social_people WHERE platform=? AND account_id=? AND user_id=?').get(a.platform, a.id, String(from.id));
  if (known && db.prepare('SELECT 1 FROM contacts WHERE id=?').get(known.contact_id)) {
    // Facebook sometimes shares their email later: fill it in when the card has none.
    if (from.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from.email) && !db.prepare('SELECT 1 FROM contacts WHERE lower(email)=?').get(String(from.email).toLowerCase())) {
      db.prepare("UPDATE contacts SET email=? WHERE id=? AND (email IS NULL OR email='')").run(String(from.email).toLowerCase(), known.contact_id);
    }
    return { contact: crm().getContact(known.contact_id), isNew: false };
  }
  const handle = a.platform === 'instagram' ? String(from.username || '').replace(/^@/, '') : null;
  const name = String(from.name || (handle ? `@${handle}` : '') || `${NAMES[a.platform]} visitor`).slice(0, 80);
  const email = from.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from.email) ? String(from.email).toLowerCase() : null;
  let c = email ? db.prepare('SELECT * FROM contacts WHERE lower(email)=?').get(email) : null;
  if (!c) c = crm().createContact({ name, email, group_name: newPersonGroup(a), stage: 'New', notes: `Messaged ${a.platform === 'instagram' ? `@${a.username || a.name}` : a.name} on ${NAMES[a.platform]}.` }, { source: a.platform });
  db.prepare('INSERT OR REPLACE INTO crm_social_people (platform, account_id, user_id, contact_id, handle) VALUES (?,?,?,?,?)').run(a.platform, a.id, String(from.id), c.id, handle);
  return { contact: c, isNew: true };
}

// Saves one message. Returns the saved row (or null when it was already saved).
function saveMessage(a, m, { quiet = false } = {}) {
  const key = `${a.platform}:${m.id}`;
  if (db.prepare('SELECT 1 FROM crm_messages WHERE message_id=?').get(key)) return null;
  const mine = String(m.from && m.from.id) === String(a.platform === 'instagram' ? a.external_id : a.page_id);
  const other = mine ? (m.to && m.to.data && m.to.data[0]) : m.from;
  if (!other || !other.id) return null;
  const { contact } = personFor(a, other);
  let text = String(m.message || '').trim();
  if (!text) text = m.attachments || m.sticker ? '(sent a photo, video or file. Open it in the Facebook or Instagram app.)' : '(sent something the CRM cannot show)';
  const at = new Date(m.created_time || Date.now()).toISOString();
  const r = db.prepare(`INSERT INTO crm_messages (contact_id, direction, channel, account_id, subject, body, full_text, message_id, is_read, sent_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(contact.id, mine ? 'out' : 'in', a.platform, a.id, `${NAMES[a.platform]} message`, text.slice(0, 5000), text.slice(0, 20000), key, mine || quiet ? 1 : 0, at);
  if (!mine) crm().logActivity(contact.id, { kind: 'Note', note: `${NAMES[a.platform]} message:\n${text.slice(0, 300)}` });
  return { id: r.lastInsertRowid, contact, mine, text };
}

const FIELDS = 'id,updated_time,messages.limit(25){id,message,created_time,from,to,attachments.limit(1){mime_type},sticker}';
// Reads new messages for one account. `graph` stands in for Facebook in tests.
async function checkAccount(a, graph = meta.call) {
  const first = !a.since;
  let newest = a.since || '';
  const added = [];
  try {
    const page = await graph('GET', `${a.page_id}/conversations`, { access_token: a.access_token, platform: a.platform === 'instagram' ? 'instagram' : 'messenger', fields: FIELDS, limit: 25 });
    for (const conv of page.data || []) {
      if (a.since && conv.updated_time && conv.updated_time <= a.since) continue;
      if (conv.updated_time > newest) newest = conv.updated_time;
      // On the very first check, older messages come in as already read (no flood of phone buzzes).
      const recent = (t) => Date.now() - Date.parse(t) < 15 * 60e3;
      const msgs = [...((conv.messages && conv.messages.data) || [])].reverse();
      for (const m of msgs) {
        if (first && Date.now() - Date.parse(m.created_time) > 30 * 86400e3) continue;
        const row = saveMessage(a, m, { quiet: first && !recent(m.created_time) });
        if (row && !row.mine && !(first && !recent(m.created_time))) added.push(row);
      }
    }
    setState(a.id, { since: newest || null, last_check: new Date().toISOString(), last_error: null });
  } catch (e) {
    const perm = e.code === 10 || e.code === 190 || (e.code >= 200 && e.code < 300) || /permission/i.test(e.message);
    setState(a.id, { last_check: new Date().toISOString(), last_error: perm
      ? 'Facebook said the CRM may not read these messages yet. Reconnect Facebook and Instagram in Viral Post once, then wait 2 minutes.'
      : `Could not read messages (${e.message}).` });
    return { ok: false, added: 0, error: e.message };
  }
  for (const r of added.slice(0, 5)) notify.send(`${NAMES[a.platform]}: ${r.contact.name}`, r.text.slice(0, 200), { tags: 'speech_balloon', priority: 'high' }).catch(() => {});
  if (added.length > 5) notify.send(`${NAMES[a.platform]} messages`, `${added.length} new messages in Conversations.`, { tags: 'speech_balloon' }).catch(() => {});
  return { ok: true, added: added.length };
}

let running = null;
async function check(opts = {}) {
  if (running) return running;
  running = (async () => {
    let added = 0;
    const errors = [];
    for (const a of accounts().filter((x) => x.enabled && x.page_id)) {
      const r = await checkAccount(a, opts.graph);
      added += r.added;
      if (!r.ok) errors.push(`${a.name}: ${r.error}`);
    }
    return { ok: !errors.length, added, errors };
  })();
  try { return await running; } finally { running = null; }
}

// What the reply box needs: which account to answer from, and whether the 24 hours are up.
function replyInfo(contactId) {
  const last = db.prepare("SELECT * FROM crm_messages WHERE contact_id=? AND channel IN ('facebook','instagram') AND direction='in' ORDER BY sent_at DESC, id DESC LIMIT 1").get(Number(contactId));
  if (!last) return null;
  const a = accountById(last.account_id);
  const open = Date.now() - Date.parse(last.sent_at) < WINDOW_MS;
  return { channel: last.channel, account: a ? (a.platform === 'instagram' ? `@${a.username || a.name}` : a.name) : null, open,
    closesAt: new Date(Date.parse(last.sent_at) + WINDOW_MS).toISOString(), connected: Boolean(a) };
}

// You answer from Conversations. Facebook only allows it within 24 hours of their last message.
async function reply(contactId, text, graph = meta.call) {
  const c = db.prepare('SELECT * FROM contacts WHERE id=?').get(Number(contactId));
  if (!c) throw err('Person not found', 404);
  text = String(text || '').trim();
  if (!text) throw err('Write a message first.');
  if (text.length > 1900) throw err('Facebook messages can be up to 1,900 letters. Make it a little shorter.');
  const last = db.prepare("SELECT * FROM crm_messages WHERE contact_id=? AND channel IN ('facebook','instagram') AND direction='in' ORDER BY sent_at DESC, id DESC LIMIT 1").get(c.id);
  if (!last) throw err(`${c.name} has not messaged you on Facebook or Instagram.`);
  const a = accountById(last.account_id);
  if (!a || !a.page_id) throw err('That Page is not connected in Viral Post any more.');
  if (Date.now() - Date.parse(last.sent_at) >= WINDOW_MS) throw err(`Facebook only lets apps answer within 24 hours of their last message. Answer ${String(c.name).split(' ')[0]} in the ${NAMES[a.platform]} app instead${c.email ? ', or send an email' : ''}.`);
  const who = db.prepare('SELECT user_id FROM crm_social_people WHERE platform=? AND account_id=? AND contact_id=? LIMIT 1').get(a.platform, a.id, c.id);
  if (!who) throw err('Could not find who to send this to.');
  let sent;
  try {
    sent = await graph('POST', `${a.page_id}/messages`, { access_token: a.access_token, recipient: JSON.stringify({ id: who.user_id }), message: JSON.stringify({ text }), messaging_type: 'RESPONSE' });
  } catch (e) {
    throw err(e.code === 10 || e.code === 200 || e.code === 190 ? 'Facebook did not allow this message. Reconnect Facebook and Instagram in Viral Post, then try again.' : `Facebook did not send it (${e.message}).`);
  }
  db.prepare(`INSERT INTO crm_messages (contact_id, direction, channel, account_id, subject, body, full_text, message_id, is_read, sent_at) VALUES (?, 'out', ?, ?, ?, ?, ?, ?, 1, ?)`)
    .run(c.id, a.platform, a.id, `${NAMES[a.platform]} message`, text, text, `${a.platform}:${(sent && sent.message_id) || `out-${Date.now()}`}`, new Date().toISOString());
  crm().logActivity(c.id, { kind: 'Note', note: `You answered on ${NAMES[a.platform]}:\n${text.slice(0, 300)}` });
  return { ok: true };
}

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap(() => status()));
router.put('/accounts/:id', wrap((req) => saveAccount(req.params.id, req.body || {})));
router.post('/check', wrap(() => check()));
router.post('/:contactId/reply', wrap((req) => reply(req.params.contactId, (req.body || {}).text)));

module.exports = { accounts, status, saveAccount, check, checkAccount, saveMessage, replyInfo, reply, router };
