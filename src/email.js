// Sends the CRM's emails (automations and campaigns). Set up once with: npm run email-setup
//
// Two ways to send, both free:
//  - "mailbox": straight from your own email account (for example daniel@viralattraction.com
//    at Hostinger, or Gmail with an app password). No other account needed. Viral Post also
//    checks that inbox every hour and turns "unsubscribe" replies into "Do not contact".
//  - "brevo": through Brevo (adds open/click stats and one-click unsubscribe pages).
// Email can't go straight from a home internet connection: Gmail, Outlook and others block it
// as spam, so a real mailbox or email service always does the delivery.
//
// Every email follows the US CAN-SPAM rules:
//  - it only goes to someone who just reached out to you (a form, website or booking) or
//    who said yes to email, and never to anyone marked "Do not contact";
//  - it ends with your name, your mailing address, and how to unsubscribe (reply
//    "unsubscribe"); the email also carries a one-click unsubscribe header;
//  - each automation emails a person at most once, and there is a daily limit.
const db = require('./db');
const design = require('./emaildesign');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_emails_sent (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  automation_id INTEGER,
  template_id INTEGER,
  to_email TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'sending',  -- sending, sent, failed
  error TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
if (!db.prepare("SELECT 1 FROM pragma_table_info('crm_emails_sent') WHERE name='campaign_id'").get()) db.exec('ALTER TABLE crm_emails_sent ADD COLUMN campaign_id INTEGER');

const settings = () => ({
  smtpHost: (process.env.SMTP_HOST || '').trim(),
  smtpPort: Number(process.env.SMTP_PORT || 465),
  smtpUser: (process.env.SMTP_USER || process.env.EMAIL_FROM || '').trim(),
  smtpPass: process.env.SMTP_PASS || '',
  imapHost: (process.env.IMAP_HOST || '').trim(),
  imapPort: Number(process.env.IMAP_PORT || 993),
  key: (process.env.BREVO_API_KEY || '').trim(),
  from: (process.env.EMAIL_FROM || '').trim(),
  fromName: (process.env.EMAIL_FROM_NAME || '').trim() || 'Daniel King',
  address: (process.env.EMAIL_MAILING_ADDRESS || '').trim(),
  limit: Number(process.env.EMAIL_DAILY_LIMIT || 100),
  api: (process.env.BREVO_API_BASE || 'https://api.brevo.com').replace(/\/$/, ''),
});
// Your own mailbox wins when both are set up.
const provider = () => { const s = settings(); return s.smtpHost && s.smtpPass ? 'mailbox' : s.key ? 'brevo' : null; };
// CAN-SPAM needs a postal address (street or PO box), not an email or website.
const postalAddress = (a) => a.length >= 10 && /\d/.test(a) && !/@|https?:|www\./i.test(a);
const ready = () => { const s = settings(); return Boolean(provider() && s.from && postalAddress(s.address)); };

function footer(reason) {
  const s = settings();
  return `\n\n--\n${s.fromName}\n${s.address}\n\nYou're getting this email because ${reason}. `
    + `Don't want emails from us? Just reply with "unsubscribe" and we'll take you off right away.`;
}

function footerHtml(reason) {
  const s = settings(), e = design.esc;
  return `<b>${e(s.fromName)}</b><br>${e(s.address)}<br><br>You're getting this email because ${e(reason)}. `
    + `Don't want emails from us? <a href="mailto:${e(s.from)}?subject=unsubscribe" style="color:#80869a">Unsubscribe</a> (or just reply "unsubscribe").`;
}

const sentToday = () => db.prepare("SELECT COUNT(*) AS n FROM crm_emails_sent WHERE status != 'failed' AND sent_at >= datetime('now', '-1 day')").get().n;

// Throws (with a plain-English message) if this email must not go out. Otherwise records it
// as "sending" and returns the row id. Kept synchronous so two runs can't both send.
function claim({ contact, automationId, templateId, subject, campaignId = null }) {
  if (!ready()) throw new Error('Email is not set up yet (run: npm run email-setup)');
  if (!contact.email) throw new Error(`${contact.name} has no email address`);
  if (contact.do_not_contact) throw new Error(`${contact.name} is marked "Do not contact"`);
  const dup = campaignId
    ? db.prepare("SELECT 1 FROM crm_emails_sent WHERE contact_id=? AND campaign_id=? AND status != 'failed'").get(contact.id, campaignId)
    : db.prepare("SELECT 1 FROM crm_emails_sent WHERE contact_id=? AND automation_id=? AND template_id=? AND status != 'failed'").get(contact.id, automationId, templateId);
  if (dup) throw new Error(`already emailed ${contact.name} by this ${campaignId ? 'campaign' : 'automation'}`);
  if (sentToday() >= settings().limit) throw new Error(`daily email limit reached (${settings().limit})`);
  return db.prepare('INSERT INTO crm_emails_sent (contact_id, automation_id, template_id, campaign_id, to_email, subject) VALUES (?,?,?,?,?,?)')
    .run(contact.id, automationId, templateId, campaignId, contact.email, subject).lastInsertRowid;
}

let transport = null, transportKey = '';
function mailbox() {
  const s = settings(), k = [s.smtpHost, s.smtpPort, s.smtpUser, s.smtpPass].join('|');
  if (!transport || transportKey !== k) {
    transport = require('nodemailer').createTransport({ host: s.smtpHost, port: s.smtpPort, secure: s.smtpPort === 465,
      auth: { user: s.smtpUser, pass: s.smtpPass }, connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 30000,
      tls: { rejectUnauthorized: !process.env.SMTP_INSECURE_TEST } });
    transportKey = k;
  }
  return transport;
}
const friendlySmtp = (e) => (/auth|535|534|Invalid login|credentials/i.test(e.message)
  ? 'Your email provider said the email or password is wrong (for Gmail use an app password). Run: npm run email-setup'
  : /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout/i.test(e.message) ? `Could not reach your email server (${e.message}). Check the internet connection.` : e.message);

async function deliver(rowId, { to, toName, subject, text, reason, design: d }, { fetchImpl = fetch } = {}) {
  const s = settings();
  const textContent = [d?.heading, text, d?.button_text && d?.button_url ? `${d.button_text}: ${d.button_url}` : ''].filter(Boolean).join('\n\n') + footer(reason);
  const htmlContent = design.render({ ...(d || {}), body: text }, footerHtml(reason));
  if (provider() === 'mailbox') {
    try {
      await mailbox().sendMail({ from: { name: s.fromName, address: s.from }, to: toName ? { name: toName, address: to } : to, subject,
        text: textContent, html: htmlContent, headers: { 'List-Unsubscribe': `<mailto:${s.from}?subject=unsubscribe>` } });
      db.prepare("UPDATE crm_emails_sent SET status='sent' WHERE id=?").run(rowId);
      return { ok: true };
    } catch (e) {
      const msg = friendlySmtp(e);
      db.prepare("UPDATE crm_emails_sent SET status='failed', error=? WHERE id=?").run(String(msg).slice(0, 300), rowId);
      return { ok: false, error: msg };
    }
  }
  try {
    const res = await fetchImpl(`${s.api}/v3/smtp/email`, {
      method: 'POST',
      headers: { 'api-key': s.key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: s.from, name: s.fromName },
        to: [{ email: to, ...(toName ? { name: toName } : {}) }],
        replyTo: { email: s.from, name: s.fromName },
        subject,
        textContent,
        htmlContent,
        headers: { 'List-Unsubscribe': `<mailto:${s.from}?subject=unsubscribe>` },
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(res.status === 401 ? 'Brevo says the API key is wrong (run: npm run email-setup)' : body.message || `Brevo error ${res.status}`);
    }
    db.prepare("UPDATE crm_emails_sent SET status='sent' WHERE id=?").run(rowId);
    return { ok: true };
  } catch (e) {
    db.prepare("UPDATE crm_emails_sent SET status='failed', error=? WHERE id=?").run(String(e.message).slice(0, 300), rowId);
    return { ok: false, error: e.message };
  }
}

// A test email to yourself, used by `npm run email-setup`.
async function sendTest(opts) {
  const s = settings();
  const id = db.prepare("INSERT INTO crm_emails_sent (to_email, subject) VALUES (?, 'Viral Touch CRM test email')").run(s.from).lastInsertRowid;
  return deliver(id, { to: s.from, toName: s.fromName, subject: 'Viral Touch CRM test email',
    text: 'It works! Your CRM automations can now send welcome emails.', reason: 'you set up email in Viral Touch CRM' }, opts);
}

// ---------- "unsubscribe" replies (mailbox mode) ----------
// Reads new messages in your inbox whose subject (or first line) says unsubscribe / stop /
// remove me, and returns the sender addresses. Marks nothing as read.
const UNSUB = /^\s*(re:\s*)?(unsubscribe|stop|remove me|opt out|take me off)\b/i;
async function unsubscribeReplies(since, { client } = {}) {
  const s = settings();
  if (provider() !== 'mailbox' || !s.imapHost) return [];
  const { ImapFlow } = require('imapflow');
  const imap = client || new ImapFlow({ host: s.imapHost, port: s.imapPort, secure: s.imapPort === 993, auth: { user: s.smtpUser, pass: s.smtpPass },
    logger: false, tls: { rejectUnauthorized: !process.env.SMTP_INSECURE_TEST } });
  const found = new Set();
  await imap.connect();
  const lock = await imap.getMailboxLock('INBOX');
  try {
    const uids = await imap.search({ since: new Date(since) }, { uid: true }) || [];
    for await (const m of imap.fetch(uids.slice(-500), { envelope: true, source: true }, { uid: true })) {
      const from = m.envelope?.from?.[0]?.address;
      if (!from || from.toLowerCase() === s.from.toLowerCase()) continue;
      const subj = m.envelope?.subject || '';
      const src = m.source ? m.source.toString('utf8') : '';
      const bodyStart = src.split(/\r?\n\r?\n/).slice(1).join('\n').split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('>') && !/^content-|^--/i.test(l)) || '';
      if (UNSUB.test(subj) || UNSUB.test(bodyStart)) found.add(from.toLowerCase());
    }
  } finally { lock.release(); await imap.logout().catch(() => {}); }
  return [...found];
}

// Checks that the mailbox password works, for npm run email-setup.
async function verify() {
  if (provider() !== 'mailbox') return { ok: true };
  try { await mailbox().verify(); return { ok: true }; } catch (e) { return { ok: false, error: friendlySmtp(e) }; }
}

function status() {
  const s = settings();
  return { ready: ready(), provider: provider(), stats: provider() === 'brevo', from: s.from, sentToday: sentToday(), limit: s.limit,
    recent: db.prepare('SELECT e.*, c.name AS contact_name FROM crm_emails_sent e LEFT JOIN contacts c ON c.id=e.contact_id ORDER BY e.id DESC LIMIT 10').all() };
}

module.exports = { ready, provider, unsubscribeReplies, verify, claim, deliver, sendTest, status, footer, footerHtml, settings };
