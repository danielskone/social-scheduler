// Conversations: an email inbox inside the CRM (like GoHighLevel's Conversations).
//
// Every 2 minutes it reads new messages in your own mailbox (the one set up with
// npm run email-setup, or on the Account page for customers) and keeps the ones from people
// who are already in the CRM. Each one shows on that person's card and in Conversations,
// and your iPhone buzzes. You answer from the CRM, and the reply goes out from your own
// email address, threaded under their message. Nothing is marked as read or deleted in
// your mailbox, and mail from strangers (newsletters, spam) stays out of the CRM.
const express = require('express');
const db = require('../../src/db');
const notify = require('../../src/notify');
const email = require('./email');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_messages (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,                  -- in (they wrote) or out (you replied)
  from_email TEXT, to_email TEXT,
  subject TEXT,
  body TEXT,                                -- their new words, without the quoted older emails
  full_text TEXT,                           -- the whole email as text
  message_id TEXT UNIQUE,
  in_reply_to TEXT,
  sent_at TEXT NOT NULL,                    -- ISO time
  is_read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS crm_messages_contact ON crm_messages(contact_id, sent_at);
CREATE TABLE IF NOT EXISTS crm_inbox_state (key TEXT PRIMARY KEY, value TEXT);
`);
const getState = (k) => db.prepare('SELECT value FROM crm_inbox_state WHERE key=?').get(k)?.value;
const setState = (k, v) => db.prepare('INSERT INTO crm_inbox_state (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
const crm = () => require('./crm');
const businesses = () => require('./businesses');
const err = (m, status = 400) => Object.assign(new Error(m), { status });

// What the inbox can do right now, in plain words for the page.
function status() {
  const s = email.settings(), p = email.provider();
  const canReceive = p === 'mailbox' && Boolean(s.imapHost);
  return {
    canSend: Boolean(p && s.from), canReceive, from: s.from || null,
    lastCheck: getState('last_check') || null, lastError: getState('last_error') || null,
    why: !p ? 'Email is not set up yet.' : !canReceive ? 'Replies can be sent, but reading your inbox needs your own mailbox with an incoming mail server (IMAP).' : null,
  };
}

// Keeps only their new words: drops "> quoted" lines and the older emails under "On ... wrote:".
function newPart(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  const quoteStart = (i) => {
    const l = lines[i];
    const joined = lines.slice(i, i + 3).join(' ');
    if (/^On\s/.test(l) && joined.includes('wrote:') && joined.indexOf('wrote:') < 300) return true;
    if (/^-{2,}\s*Original Message/i.test(l) || /^_{6,}\s*$/.test(l)) return true;
    return /^From:\s.+/.test(l) && /^(Sent|Date):/m.test(lines.slice(i + 1, i + 4).join('\n'));
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (out.some((x) => x.trim()) && quoteStart(i)) break;
    if (/^\s*>/.test(l)) continue;
    out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const findContact = (addr) => db.prepare('SELECT * FROM contacts WHERE lower(email)=lower(?) ORDER BY id LIMIT 1').get(addr);

// Saves one email (already parsed). Returns the saved row, or null when it isn't for the CRM.
function saveIncoming({ from, fromName, to, subject, text, messageId, inReplyTo, date }) {
  if (!from) return null;
  const me = (email.settings().from || '').toLowerCase();
  if (from.toLowerCase() === me) return null;
  const c = findContact(from);
  if (!c) return null; // strangers and newsletters stay in your normal mailbox
  const id = messageId || `<no-id-${from}-${date}-${String(subject).slice(0, 40)}>`;
  if (db.prepare('SELECT 1 FROM crm_messages WHERE message_id=?').get(id)) return null;
  const full = String(text || '').slice(0, 50000);
  const body = newPart(full).slice(0, 20000) || full.slice(0, 20000);
  const r = db.prepare(`INSERT INTO crm_messages (contact_id, direction, from_email, to_email, subject, body, full_text, message_id, in_reply_to, sent_at)
    VALUES (?, 'in', ?, ?, ?, ?, ?, ?, ?, ?)`).run(c.id, from.toLowerCase(), to || me, subject || '(no subject)', body, full, id, inReplyTo || null,
    new Date(date || Date.now()).toISOString());
  crm().logActivity(c.id, { kind: 'Email', note: `Wrote to you: "${subject || '(no subject)'}"\n${body.slice(0, 300)}` });
  return { id: r.lastInsertRowid, contact: c, fromName, subject, body };
}

// Reads new mail from your inbox. `client` is a stand-in mailbox for tests.
let running = null;
async function check(opts = {}) {
  if (running) return running;
  running = (async () => {
    const st = status();
    if (!st.canReceive) return { ok: false, added: 0, error: st.why };
    const s = email.settings();
    const { simpleParser } = require('mailparser');
    const imap = opts.client || new (require('imapflow').ImapFlow)({ host: s.imapHost, port: s.imapPort, secure: s.imapPort === 993,
      auth: { user: s.smtpUser, pass: s.smtpPass }, logger: false, tls: { rejectUnauthorized: !process.env.SMTP_INSECURE_TEST } });
    const since = getState('since') || new Date(Date.now() - 14 * 86400e3).toISOString();
    const started = new Date(Date.now() - 86400e3).toISOString(); // IMAP searches by day, so look back a day each time
    const added = [];
    try {
      await imap.connect();
      const lock = await imap.getMailboxLock('INBOX');
      try {
        const uids = await imap.search({ since: new Date(since) }, { uid: true }) || [];
        for await (const m of imap.fetch(uids.slice(-300), { envelope: true, source: true, internalDate: true }, { uid: true })) {
          const from = m.envelope?.from?.[0]?.address;
          if (!from || !findContact(from)) continue; // parse only mail from people in the CRM
          const mid = m.envelope?.messageId;
          if (mid && db.prepare('SELECT 1 FROM crm_messages WHERE message_id=?').get(mid)) continue;
          const p = await simpleParser(m.source);
          const row = saveIncoming({ from, fromName: m.envelope.from[0].name, to: m.envelope?.to?.[0]?.address, subject: p.subject || m.envelope.subject,
            text: p.text || '', messageId: p.messageId || mid, inReplyTo: p.inReplyTo, date: p.date || m.internalDate || m.envelope.date });
          if (row) added.push(row);
        }
      } finally { lock.release(); }
      await imap.logout().catch(() => {});
      setState('since', started);
      setState('last_check', new Date().toISOString());
      setState('last_error', '');
    } catch (e) {
      const msg = /auth|login|credentials/i.test(e.message) ? 'Your mailbox said the email or password is wrong.' : `Could not read your inbox (${e.message}).`;
      setState('last_error', msg);
      return { ok: false, added: 0, error: msg };
    }
    for (const r of added.slice(0, 5)) {
      notify.send(`Email from ${r.contact.name}`, `${r.subject}\n${r.body.slice(0, 200)}`, { tags: 'envelope_with_arrow' }).catch(() => {});
    }
    if (added.length > 5) notify.send('New emails', `${added.length} new emails in Conversations.`, { tags: 'envelope_with_arrow' }).catch(() => {});
    return { ok: true, added: added.length };
  })();
  try { return await running; } finally { running = null; }
}

// The list on the left: one row per person, newest first.
function conversations({ biz, q, unread } = {}) {
  const f = businesses().filter(biz, 'c.group_name');
  const where = [f.sql, q ? '(c.name LIKE ? OR c.email LIKE ? OR c.company LIKE ?)' : '', unread ? 'x.unread > 0' : ''].filter(Boolean);
  const args = [...f.args, ...(q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [])];
  return db.prepare(`
    WITH x AS (SELECT contact_id, SUM(direction='in' AND is_read=0) AS unread,
      (SELECT id FROM crm_messages l WHERE l.contact_id=g.contact_id ORDER BY l.sent_at DESC, l.id DESC LIMIT 1) AS last_id FROM crm_messages g GROUP BY contact_id)
    SELECT c.id, c.name, c.company, c.email, c.group_name, x.unread, m.subject, m.body, m.direction, m.sent_at
    FROM x JOIN contacts c ON c.id=x.contact_id JOIN crm_messages m ON m.id=x.last_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY m.sent_at DESC, m.id DESC LIMIT 200`).all(...args)
    .map((r) => ({ ...r, snippet: String(r.body || '').replace(/\s+/g, ' ').slice(0, 120) }));
}
function unreadCount(biz) {
  const f = businesses().filter(biz, 'c.group_name');
  return db.prepare(`SELECT COUNT(*) AS n FROM crm_messages m JOIN contacts c ON c.id=m.contact_id WHERE m.direction='in' AND m.is_read=0${f.sql ? ` AND ${f.sql}` : ''}`).get(...f.args).n;
}

// One person's emails, oldest first. Automatic emails (automations, campaigns) show too, so you see everything they got.
function thread(contactId, { markRead = true } = {}) {
  const c = db.prepare('SELECT id, name, company, email, phone, group_name, do_not_contact FROM contacts WHERE id=?').get(Number(contactId));
  if (!c) throw err('Person not found', 404);
  if (markRead) db.prepare("UPDATE crm_messages SET is_read=1 WHERE contact_id=? AND direction='in' AND is_read=0").run(c.id);
  const msgs = db.prepare('SELECT id, direction, subject, body, full_text, sent_at, message_id FROM crm_messages WHERE contact_id=?').all(c.id)
    .map((m) => ({ ...m, kind: 'message', more: m.full_text && m.full_text.trim() !== String(m.body).trim() }));
  const auto = db.prepare(`SELECT e.id, e.subject, e.sent_at, e.status, a.name AS automation, k.name AS campaign FROM crm_emails_sent e
    LEFT JOIN crm_automations a ON a.id=e.automation_id LEFT JOIN crm_campaigns k ON k.id=e.campaign_id
    WHERE e.contact_id=? AND e.status='sent'`).all(c.id)
    .map((e) => ({ id: `a${e.id}`, direction: 'out', kind: 'auto', subject: e.subject, body: '', via: e.campaign ? `Campaign: ${e.campaign}` : e.automation ? `Automation: ${e.automation}` : 'Automatic email',
      sent_at: new Date(`${e.sent_at.replace(' ', 'T')}Z`).toISOString() }));
  const all = [...msgs, ...auto].sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)));
  for (const m of all) delete m.full_text;
  return { contact: c, messages: all, status: status() };
}
function fullText(messageId) {
  const m = db.prepare('SELECT full_text FROM crm_messages WHERE id=?').get(Number(messageId));
  if (!m) throw err('Not found', 404);
  return { text: m.full_text };
}

// You answer someone from the CRM.
async function reply(contactId, { text, subject } = {}, opts = {}) {
  const c = db.prepare('SELECT * FROM contacts WHERE id=?').get(Number(contactId));
  if (!c) throw err('Person not found', 404);
  if (!c.email) throw err(`${c.name} has no email address.`);
  text = String(text || '').trim();
  if (!text) throw err('Write a message first.');
  if (text.length > 20000) throw err('That message is too long.');
  const last = db.prepare("SELECT * FROM crm_messages WHERE contact_id=? AND direction='in' ORDER BY sent_at DESC, id DESC LIMIT 1").get(c.id);
  // "Do not contact" means no emails, unless they wrote to you first (then a reply is just answering them).
  if (c.do_not_contact && !(last && Date.now() - new Date(last.sent_at) < 30 * 86400e3)) throw err(`${c.name} is marked "Do not contact".`);
  const subj = String(subject || '').trim().slice(0, 200) || (last ? (/^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`) : `Hi ${String(c.name).split(' ')[0]}`);
  const messageId = await email.sendDirect({ to: c.email, toName: c.name, subject: subj, text, inReplyTo: last ? last.message_id : null }, opts);
  db.prepare(`INSERT INTO crm_messages (contact_id, direction, from_email, to_email, subject, body, full_text, message_id, in_reply_to, is_read, sent_at)
    VALUES (?, 'out', ?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(c.id, email.settings().from, c.email, subj, text, text, messageId, last ? last.message_id : null, new Date().toISOString());
  crm().logActivity(c.id, { kind: 'Email', note: `You wrote: "${subj}"\n${text.slice(0, 300)}` });
  return thread(c.id, { markRead: false });
}

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req) => ({ conversations: conversations(req.query), unread: unreadCount(req.query.biz), status: status() })));
router.get('/unread', wrap((req) => ({ unread: unreadCount(req.query.biz) })));
router.post('/check', wrap(() => check()));
router.get('/message/:id', wrap((req) => fullText(req.params.id)));
router.get('/:contactId', wrap((req) => thread(req.params.contactId)));
router.post('/:contactId/reply', wrap((req) => reply(req.params.contactId, req.body || {})));
router.post('/:contactId/unread', wrap((req) => {
  const m = db.prepare("SELECT id FROM crm_messages WHERE contact_id=? AND direction='in' ORDER BY sent_at DESC, id DESC LIMIT 1").get(Number(req.params.contactId));
  if (m) db.prepare('UPDATE crm_messages SET is_read=0 WHERE id=?').run(m.id);
  return { ok: true };
}));

module.exports = { check, saveIncoming, newPart, conversations, unreadCount, thread, reply, status, router };
