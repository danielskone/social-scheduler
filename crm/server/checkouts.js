// Reminders for unfinished checkouts. When someone starts paying on a Buy now page, a paid
// course or a monthly plan, and doesn't finish, we email them once (after 1 hour by default)
// with a link to finish. Only people who typed their own email on the page get one.
const express = require('express');
const db = require('../../src/db');
const config = require('../../src/config');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_checkouts (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER UNIQUE,
  sub_id INTEGER UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reminded_at TEXT,
  done INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS crm_checkout_settings (key TEXT PRIMARY KEY, value TEXT);
`);
const money = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const getSet = (k, d) => { const r = db.prepare('SELECT value FROM crm_checkout_settings WHERE key=?').get(k); return r ? r.value : d; };
const setSet = (k, v) => db.prepare('INSERT INTO crm_checkout_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
function settings() { return { on: getSet('on', '1') === '1', hours: Number(getSet('hours', '1')) }; }
function saveSettings(body = {}) {
  if ('on' in body) setSet('on', body.on ? '1' : '0');
  if ('hours' in body) { const h = Number(body.hours); if (![1, 3, 12, 24].includes(h)) throw Object.assign(new Error('Pick 1, 3, 12 or 24 hours.'), { status: 400 }); setSet('hours', h); }
  return settings();
}
function track({ invoiceId, subId }) {
  db.prepare('INSERT OR IGNORE INTO crm_checkouts (invoice_id, sub_id) VALUES (?,?)').run(invoiceId || null, subId || null);
}

// Every 15 minutes: send reminders that are due. Returns how many went out.
async function run(now = Date.now(), opts = {}) {
  const s = settings();
  const email = require('./email');
  if (!s.on || !email.provider()) return 0;
  const due = new Date(now - s.hours * 3600e3).toISOString().replace('T', ' ').slice(0, 19);
  const old = new Date(now - 3 * 864e5).toISOString().replace('T', ' ').slice(0, 19);
  const rows = db.prepare('SELECT * FROM crm_checkouts WHERE done=0 AND reminded_at IS NULL AND created_at<=? AND created_at>=?').all(due, old);
  let sent = 0;
  for (const r of rows) {
    let c = null, what = '', link = '', total = 0;
    if (r.invoice_id) {
      const inv = db.prepare('SELECT * FROM crm_invoices WHERE id=?').get(r.invoice_id);
      if (!inv || inv.status !== 'sent') { db.prepare('UPDATE crm_checkouts SET done=1 WHERE id=?').run(r.id); continue; }
      c = db.prepare('SELECT * FROM contacts WHERE id=?').get(inv.contact_id);
      what = (() => { try { return JSON.parse(inv.items).map((i) => i.what).join(', '); } catch { return 'your order'; } })();
      link = `${config.publicBaseUrl}/invoice/${inv.token}`; total = inv.total;
    } else if (r.sub_id) {
      const sub = db.prepare('SELECT s.*, p.token AS plan_token, p.active AS plan_active FROM crm_subscriptions s LEFT JOIN crm_plans p ON p.id=s.plan_id WHERE s.id=?').get(r.sub_id);
      if (!sub || sub.status !== 'pending' || !sub.plan_token || !sub.plan_active) { db.prepare('UPDATE crm_checkouts SET done=1 WHERE id=?').run(r.id); continue; }
      // Someone who started again and finished doesn't need a nudge.
      if (db.prepare("SELECT 1 FROM crm_subscriptions WHERE contact_id=? AND plan_id=? AND status<>'pending'").get(sub.contact_id, sub.plan_id)) { db.prepare('UPDATE crm_checkouts SET done=1 WHERE id=?').run(r.id); continue; }
      c = db.prepare('SELECT * FROM contacts WHERE id=?').get(sub.contact_id);
      what = sub.name; link = `${config.publicBaseUrl}/subscribe/${sub.plan_token}`; total = sub.amount;
    }
    db.prepare('UPDATE crm_checkouts SET reminded_at=? WHERE id=?').run(new Date(now).toISOString(), r.id);
    if (!c || !c.email || c.do_not_contact) continue;
    const b = require('./businesses').ownerOf(c.group_name);
    try {
      await email.sendDirect({ to: c.email, toName: c.name, subject: `Still want ${what.length > 40 ? 'your order' : what}?`,
        text: `Hi ${String(c.name).split(' ')[0]},\n\nYou started getting ${what} (${money(total)}) but didn't finish paying. No problem, it only takes a minute:\n\n${link}\n\nQuestions? Just reply to this email.\n\n${b ? b.name : ''}` }, opts);
      require('./crm').logActivity(c.id, { kind: 'Email', note: `Sent a reminder to finish paying for ${what}` });
      sent++;
    } catch (e) { console.error(`[checkouts] ${e.message}`); }
  }
  return sent;
}
function stats() {
  const r = db.prepare("SELECT COUNT(*) AS started, SUM(reminded_at IS NOT NULL) AS reminded FROM crm_checkouts WHERE created_at > datetime('now','-30 days')").get();
  const saved = db.prepare(`SELECT COUNT(*) AS n FROM crm_checkouts k LEFT JOIN crm_invoices i ON i.id=k.invoice_id LEFT JOIN crm_subscriptions s ON s.id=k.sub_id
    WHERE k.reminded_at IS NOT NULL AND (i.status='paid' OR s.status IN ('active','ending','past_due')) AND k.created_at > datetime('now','-30 days')`).get().n;
  return { started: r.started || 0, reminded: r.reminded || 0, saved };
}

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap(() => ({ ...settings(), ...stats() })));
router.put('/', wrap((req) => ({ ...saveSettings(req.body || {}), ...stats() })));

module.exports = { track, run, settings, saveSettings, stats, router };
