// Team tasks: the Tasks board (To do, Doing, Done) and a daily email of what is due.
//
// Every morning at 7 each person on your team gets one email with their tasks that are due
// today or late, and you get one with yours (tasks for nobody in particular are yours).
// When you give someone a task, they get a short email right away. Emails go out from your
// own mailbox (the one set up for the CRM), so this costs nothing.
const express = require('express');
const db = require('../../src/db');
const config = require('../../src/config');

require('./crm'); // makes crm_tasks and its board columns
require('./team'); // makes crm_team
db.exec(`
CREATE TABLE IF NOT EXISTS crm_task_settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS crm_task_mail_sent (day TEXT NOT NULL, who TEXT NOT NULL, PRIMARY KEY (day, who));
`);
const email = () => require('./email');
const getSet = (k, d = '') => db.prepare('SELECT value FROM crm_task_settings WHERE key=?').get(k)?.value ?? d;
const setSet = (k, v) => db.prepare('INSERT INTO crm_task_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
const TZ = () => process.env.BOOKING_TIMEZONE || 'America/New_York';
const ymd = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ() }).format(d);
const pretty = (s) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const crmLink = () => `${config.publicBaseUrl || ''}`.replace(/\/$/, '') + '/#contacts/tasks';

function settings() {
  const e = email();
  return { daily: getSet('daily', '1') === '1', ownerEmail: getSet('owner_email', '') || e.settings().from || '', emailReady: Boolean(e.provider() && e.settings().from) };
}
function saveSettings(body = {}) {
  if ('daily' in body) setSet('daily', body.daily ? '1' : '0');
  if ('owner_email' in body) {
    const v = String(body.owner_email || '').trim().toLowerCase();
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw Object.assign(new Error('That email address does not look right.'), { status: 400 });
    setSet('owner_email', v);
  }
  return settings();
}
// The people a task can be given to: you (the owner) and everyone on the team.
const people = () => [{ id: null, name: 'You (owner)' }, ...db.prepare('SELECT id, name, email FROM crm_team ORDER BY name COLLATE NOCASE').all()];

const line = (t, day) => `- ${t.priority ? '(Important) ' : ''}${t.title}${t.contact_name ? ` (${t.contact_name})` : ''}${t.due_on ? (t.due_on < day ? `, late since ${pretty(t.due_on)}` : ', due today') : ''}`;
function dueFor(assignedTo, day) {
  return db.prepare(`SELECT t.*, c.name AS contact_name FROM crm_tasks t LEFT JOIN contacts c ON c.id=t.contact_id
    WHERE t.done_at IS NULL AND t.due_on IS NOT NULL AND t.due_on <= ? AND ${assignedTo ? 't.assigned_to=?' : 't.assigned_to IS NULL'}
    ORDER BY t.priority DESC, t.due_on, t.id`).all(...[day, ...(assignedTo ? [assignedTo] : [])]);
}
function dailyText(name, tasks, day) {
  const late = tasks.filter((t) => t.due_on < day).length;
  return { subject: `${tasks.length} task${tasks.length === 1 ? '' : 's'} for today${late ? ` (${late} late)` : ''}`,
    text: `Good morning ${String(name || '').split(' ')[0] || 'there'},\n\nHere is what is on your list today:\n\n${tasks.slice(0, 40).map((t) => line(t, day)).join('\n')}${tasks.length > 40 ? `\n...and ${tasks.length - 40} more` : ''}\n\nOpen your Tasks board: ${crmLink()}` };
}

// The 7am email. Safe to call more than once a day: each person gets one email a day.
async function sendDaily(now = new Date(), opts = {}) {
  const s = settings();
  if (!s.daily || !s.emailReady) return { sent: 0, why: !s.daily ? 'off' : 'no email' };
  const day = ymd(now);
  const list = [{ key: 'owner', id: null, name: '', email: s.ownerEmail }, ...db.prepare('SELECT id, name, email FROM crm_team').all().map((m) => ({ key: `team:${m.id}`, ...m }))];
  let sent = 0;
  for (const p of list) {
    if (!p.email || db.prepare('SELECT 1 FROM crm_task_mail_sent WHERE day=? AND who=?').get(day, p.key)) continue;
    const tasks = dueFor(p.id, day);
    if (!tasks.length) continue;
    const m = dailyText(p.name, tasks, day);
    try {
      await email().sendDirect({ to: p.email, toName: p.name || undefined, subject: m.subject, text: m.text }, opts);
      db.prepare('INSERT INTO crm_task_mail_sent (day, who) VALUES (?,?)').run(day, p.key);
      sent++;
    } catch (e) { console.error(`[tasks] daily email to ${p.email} failed: ${e.message}`); }
  }
  return { sent };
}

// "Ana gave you a task" email, right when a task is given to someone on the team.
async function tellAssignee(taskId, opts = {}) {
  const t = db.prepare('SELECT t.*, c.name AS contact_name FROM crm_tasks t LEFT JOIN contacts c ON c.id=t.contact_id WHERE t.id=?').get(Number(taskId));
  if (!t || !t.assigned_to) return false;
  const m = db.prepare('SELECT * FROM crm_team WHERE id=?').get(t.assigned_to);
  if (!m || !m.email || !settings().emailReady) return false;
  await email().sendDirect({ to: m.email, toName: m.name, subject: `New task: ${t.title.slice(0, 80)}`,
    text: `Hi ${String(m.name).split(' ')[0]},\n\nYou have a new task:\n\n${t.priority ? '(Important) ' : ''}${t.title}${t.contact_name ? `\nFor: ${t.contact_name}` : ''}${t.due_on ? `\nDue: ${pretty(t.due_on)}` : ''}${t.notes ? `\n\n${t.notes}` : ''}\n\nOpen your Tasks board: ${crmLink()}` }, opts);
  return true;
}

// Numbers for the top of the board.
function summary({ who, me } = {}) {
  const day = ymd();
  const rows = require('./crm').listTasks({ open: 'board', who, me });
  const open = rows.filter((t) => !t.done_at);
  return { open: open.length, late: open.filter((t) => t.due_on && t.due_on < day).length, today: open.filter((t) => t.due_on === day).length,
    doneWeek: rows.filter((t) => t.done_at && Date.now() - Date.parse(t.done_at) < 7 * 86400e3).length, day };
}

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/board', wrap((req) => {
  const me = req.team ? req.team.id : null;
  return { tasks: require('./crm').listTasks({ open: 'board', biz: req.query.biz, who: req.query.who, me }), people: people(), settings: settings(),
    summary: summary({ who: req.query.who, me }), me: req.team ? { id: req.team.id, name: req.team.name } : { id: null, name: 'You (owner)' } };
}));
router.get('/people', wrap(() => people()));
router.put('/settings', wrap((req) => saveSettings(req.body || {})));
router.post('/send-now', wrap(() => sendDaily()));

module.exports = { settings, saveSettings, sendDaily, tellAssignee, dueFor, dailyText, summary, people, router };
