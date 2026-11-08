// Website sign-ups -> Viral Touch CRM.
//
// Your website (e.g. viralattraction.com) sends each form sign-up to a free "website inbox":
// a Google Sheet with a small script (website-inbox/Code.gs) in your own Google account. It is
// always on, so nothing is lost while this Mac is off, and the Mac never has to be opened up
// to the internet. Every 2 minutes this file reads new rows (with a secret key) and adds or
// updates the person in Contacts, then buzzes your phone.
//
// Email consent: only a newsletter sign-up counts as "OK to email". A contact form does not.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const crm = require('./crm');
const notify = require('./notify');

db.exec(`
CREATE TABLE IF NOT EXISTS website_inbox (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_row INTEGER NOT NULL DEFAULT 1,
  last_check TEXT, last_error TEXT, imported INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO website_inbox (id) VALUES (1);
`);

const GROUP = process.env.WEBSITE_GROUP || 'Viral Attraction lead';
const settings = () => ({ url: (process.env.WEBSITE_INBOX_URL || '').trim(), key: (process.env.WEBSITE_INBOX_KEY || '').trim() });
const state = () => db.prepare('SELECT * FROM website_inbox WHERE id=1').get();

// Turns one inbox row into a CRM contact (new or updated) plus a history note.
function importRow(r) {
  // A form made in the form builder, sent by its always-on website code.
  const own = /^vpform:([0-9a-f]+)$/.exec(String(r.form || '').trim());
  if (own) {
    const done = require('./forms').recordFromInbox(own[1], r);
    if (done) return { ...done, viaForm: true };
  }
  const site = String(r.form || '').split(':')[0].trim() || 'your website';
  const title = String(r.form || 'Website form').trim();
  const message = [
    r.interest && `Interested in: ${r.interest}`,
    r.preferred_time && `Best time to connect: ${r.preferred_time}`,
    r.message,
    r.page && `Page: ${r.page}`,
  ].filter(Boolean).join('\n');
  const optIn = r.newsletter && r.email ? { source: `Signed up for email updates on ${site} ("${title}"), ${String(r.received || '').slice(0, 10)}` } : null;
  return crm.submitForm(
    { title, group_name: GROUP },
    { name: r.name || r.company || (r.email || '').split('@')[0], email: r.email, phone: r.phone, company: r.company, message },
    { optIn, newsletterOnly: Boolean(optIn && !r.message && !r.interest && !r.preferred_time) },
  );
}

let running = false;
async function check({ fetchImpl = fetch } = {}) {
  const { url, key } = settings();
  if (!url || !key || running) return { skipped: true };
  running = true;
  const s = state();
  let added = 0, updated = 0;
  try {
    const u = new URL(url);
    u.searchParams.set('key', key);
    u.searchParams.set('after', String(s.last_row));
    const res = await fetchImpl(u, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const body = await res.json().catch(() => null);
    if (!body) throw new Error(`The website inbox did not answer properly (status ${res.status}). Check the Web app URL.`);
    if (!body.ok) throw new Error(body.error === 'wrong key' ? 'The website inbox says the secret key is wrong. Run: npm run website' : String(body.error || 'Website inbox error'));
    // A brand-new Sheet starts again at row 2.
    if (Number(body.last) < s.last_row) { db.prepare('UPDATE website_inbox SET last_row=1 WHERE id=1').run(); running = false; return check({ fetchImpl }); }
    let last = s.last_row;
    for (const r of body.rows || []) {
      try {
        const { contact, isNew, viaForm } = importRow(r);
        if (contact) { if (isNew) added++; else updated++; }
        if (viaForm || !contact) { last = Math.max(last, Number(r.row) || last); continue; } // forms.js already sent the alert
        notify.send(isNew ? 'New website lead' : 'Website form filled again',
          `${contact.name}${contact.company ? ` (${contact.company})` : ''} filled out "${r.form}"${r.interest ? ` - ${r.interest}` : ''}`, { tags: 'globe_with_meridians' }).catch(() => {});
      } catch (e) {
        console.error(`Website sign-up in row ${r.row} skipped: ${e.message}`);
      }
      last = Math.max(last, Number(r.row) || last);
    }
    db.prepare("UPDATE website_inbox SET last_row=?, last_check=datetime('now'), last_error=NULL, imported=imported+? WHERE id=1").run(last, added + updated);
    if ((body.rows || []).length >= 200) { running = false; const more = await check({ fetchImpl }); return { added: added + more.added, updated: updated + more.updated }; }
    return { added, updated };
  } catch (e) {
    db.prepare("UPDATE website_inbox SET last_check=datetime('now'), last_error=? WHERE id=1").run(String(e.message || e).slice(0, 300));
    return { error: e.message };
  } finally {
    running = false;
  }
}

// The code to paste into the website, with this inbox's address filled in.
function snippet() {
  const { url } = settings();
  const js = fs.readFileSync(path.join(__dirname, '..', 'website-inbox', 'snippet.js'), 'utf8').replace('__INBOX_URL__', url.replace(/['\\<>]/g, ''));
  return `<script>\n${js}</script>\n`;
}

function status() {
  const { url, key } = settings();
  const s = state();
  return { connected: Boolean(url && key), lastCheck: s.last_check, lastError: s.last_error, imported: s.imported, group: GROUP, snippet: url && key ? snippet() : '' };
}

module.exports = { check, status, snippet, importRow };
