// Automatic emails (used by CRM automations), sent through Brevo's free plan.
//
// Why Brevo and not Gmail: sending automatic email from your own Gmail can get the account
// flagged. Brevo is a proper email service (free up to 300 emails a day) that signs your
// email so it lands in the inbox. Set it up once with: npm run email-setup
//
// Every email follows the US CAN-SPAM rules:
//  - it only goes to someone who just reached out to you (a form, website or booking) or
//    who said yes to email, and never to anyone marked "Do not contact";
//  - it ends with your name, your mailing address, and how to unsubscribe (reply
//    "unsubscribe"); the email also carries a one-click unsubscribe header;
//  - each automation emails a person at most once, and there is a daily limit.
const db = require('./db');

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

const settings = () => ({
  key: (process.env.BREVO_API_KEY || '').trim(),
  from: (process.env.EMAIL_FROM || '').trim(),
  fromName: (process.env.EMAIL_FROM_NAME || '').trim() || 'Daniel King',
  address: (process.env.EMAIL_MAILING_ADDRESS || '').trim(),
  limit: Number(process.env.EMAIL_DAILY_LIMIT || 100),
  api: (process.env.BREVO_API_BASE || 'https://api.brevo.com').replace(/\/$/, ''),
});
const ready = () => { const s = settings(); return Boolean(s.key && s.from && s.address); };

function footer(reason) {
  const s = settings();
  return `\n\n--\n${s.fromName}\n${s.address}\n\nYou're getting this email because ${reason}. `
    + `Don't want emails from us? Just reply with "unsubscribe" and we'll take you off right away.`;
}

const sentToday = () => db.prepare("SELECT COUNT(*) AS n FROM crm_emails_sent WHERE status != 'failed' AND sent_at >= datetime('now', '-1 day')").get().n;

// Throws (with a plain-English message) if this email must not go out. Otherwise records it
// as "sending" and returns the row id. Kept synchronous so two runs can't both send.
function claim({ contact, automationId, templateId, subject }) {
  if (!ready()) throw new Error('Email is not set up yet (run: npm run email-setup)');
  if (!contact.email) throw new Error(`${contact.name} has no email address`);
  if (contact.do_not_contact) throw new Error(`${contact.name} is marked "Do not contact"`);
  if (db.prepare("SELECT 1 FROM crm_emails_sent WHERE contact_id=? AND automation_id=? AND template_id=? AND status != 'failed'").get(contact.id, automationId, templateId)) {
    throw new Error(`already emailed ${contact.name} by this automation`);
  }
  if (sentToday() >= settings().limit) throw new Error(`daily email limit reached (${settings().limit})`);
  return db.prepare('INSERT INTO crm_emails_sent (contact_id, automation_id, template_id, to_email, subject) VALUES (?,?,?,?,?)')
    .run(contact.id, automationId, templateId, contact.email, subject).lastInsertRowid;
}

async function deliver(rowId, { to, toName, subject, text, reason }, { fetchImpl = fetch } = {}) {
  const s = settings();
  try {
    const res = await fetchImpl(`${s.api}/v3/smtp/email`, {
      method: 'POST',
      headers: { 'api-key': s.key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: s.from, name: s.fromName },
        to: [{ email: to, ...(toName ? { name: toName } : {}) }],
        replyTo: { email: s.from, name: s.fromName },
        subject,
        textContent: text + footer(reason),
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

function status() {
  const s = settings();
  return { ready: ready(), from: s.from, sentToday: sentToday(), limit: s.limit,
    recent: db.prepare('SELECT e.*, c.name AS contact_name FROM crm_emails_sent e LEFT JOIN contacts c ON c.id=e.contact_id ORDER BY e.id DESC LIMIT 10').all() };
}

module.exports = { ready, claim, deliver, sendTest, status, footer, settings };
