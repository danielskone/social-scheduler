// Automations for Viral Touch CRM: "when this happens, do these steps".
//
// Triggers: a new contact is added, someone fills out a form, a contact moves to a stage,
// or someone books an appointment. Each can be limited to one group (and a stage).
//
// Steps: buzz your phone, make a task (optionally with a message template ready to open
// in your own Mail/Messages app), move to a stage, change group, set the next follow-up,
// add a note, or wait some hours/days (optionally only carrying on if they are still in
// a stage, so "still New after 3 days" reminders stop once you've reached out).
//
// On purpose, automations never send email or texts by themselves. A "message" step makes
// a task with the filled-in message one tap away, and you press Send. That keeps your
// accounts safe from spam flags and keeps every email personal and wanted.
const express = require('express');
const db = require('./db');
const crm = require('./crm');
const notify = require('./notify');

const TRIGGERS = {
  contact_added: 'A new contact is added',
  form_filled: 'Someone fills out a form',
  stage_changed: 'A contact moves to a stage',
  appointment_booked: 'Someone books an appointment',
};
const STEPS = ['alert', 'task', 'stage', 'group', 'follow_up', 'note', 'wait'];

db.exec(`
CREATE TABLE IF NOT EXISTS crm_automations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  trigger_json TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  runs INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_automation_waits (
  id INTEGER PRIMARY KEY,
  automation_id INTEGER NOT NULL REFERENCES crm_automations(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  next_step INTEGER NOT NULL,
  run_at TEXT NOT NULL,             -- ISO time
  if_stage TEXT,
  vars_json TEXT
);
CREATE TABLE IF NOT EXISTS crm_automation_log (
  id INTEGER PRIMARY KEY,
  automation_id INTEGER REFERENCES crm_automations(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  summary TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const err400 = (m) => Object.assign(new Error(m), { status: 400 });
const ymd = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const addDays = (n, now = new Date()) => { const d = new Date(now); d.setDate(d.getDate() + (Number(n) || 0)); return ymd(d); };
const num = (v, d = 0, max = 365) => { const n = Number(v); return Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : d; };
const str = (v, n = 300) => String(v ?? '').trim().slice(0, n);

// {first_name} {name} {company} {email} {phone} {group} {stage} {form} {when}
function fill(text, c, vars = {}) {
  const first = String(c.name || '').split(/\s+/)[0] || 'there';
  const map = { first_name: first, name: c.name || '', company: c.company || c.name || '', email: c.email || '', phone: c.phone || '',
    group: c.group_name || '', stage: c.stage || '', form: vars.form || '', when: vars.when || '' };
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m));
}

// ---------- Saving ----------
function cleanStep(s) {
  const type = STEPS.includes(s?.type) ? s.type : null;
  if (!type) throw err400('Each step needs a type.');
  if (type === 'alert') return { type, title: str(s.title, 80) || 'Viral Touch CRM', message: str(s.message, 500) || '{name}' };
  if (type === 'task') {
    const title = str(s.title, 200);
    if (!title) throw err400('A "make a task" step needs a task name.');
    const template_id = s.template_id ? Number(s.template_id) : null;
    if (template_id && !db.prepare('SELECT 1 FROM crm_templates WHERE id=?').get(template_id)) throw err400('That message template no longer exists.');
    return { type, title, due_days: num(s.due_days), template_id };
  }
  if (type === 'stage') {
    if (!crm.STAGES.includes(s.stage)) throw err400('Pick a stage to move them to.');
    return { type, stage: s.stage };
  }
  if (type === 'group') {
    if (!str(s.group)) throw err400('Pick a group to put them in.');
    return { type, group: str(s.group, 80) };
  }
  if (type === 'follow_up') return { type, days: num(s.days) };
  if (type === 'note') {
    if (!str(s.note)) throw err400('A "note" step needs some text.');
    return { type, note: str(s.note, 1000) };
  }
  const unit = s.unit === 'hours' ? 'hours' : 'days';
  const amount = num(s.amount, 1, unit === 'hours' ? 24 * 90 : 365);
  if (!amount) throw err400('A "wait" step needs a number of hours or days.');
  return { type, amount, unit, if_stage: crm.STAGES.includes(s.if_stage) ? s.if_stage : null };
}

function cleanTrigger(t) {
  if (!TRIGGERS[t?.type]) throw err400('Pick what starts this automation.');
  const out = { type: t.type, group: str(t.group, 80) || null, stage: crm.STAGES.includes(t.stage) ? t.stage : null };
  if (t.type === 'stage_changed' && !out.stage) throw err400('Pick which stage starts it.');
  if (t.type === 'form_filled') out.form = str(t.form, 200) || null;
  return out;
}

const parse = (a) => a && { ...a, active: Boolean(a.active), trigger: JSON.parse(a.trigger_json), steps: JSON.parse(a.steps_json), trigger_json: undefined, steps_json: undefined };
const get = (id) => parse(db.prepare('SELECT * FROM crm_automations WHERE id=?').get(id));
const list = () => db.prepare('SELECT * FROM crm_automations ORDER BY id').all().map(parse);

function save(body, id) {
  const old = id ? get(id) : null;
  if (id && !old) throw Object.assign(new Error('Automation not found'), { status: 404 });
  const name = str(body.name ?? old?.name, 120);
  if (!name) throw err400('Give the automation a name.');
  const trigger = cleanTrigger(body.trigger ?? old?.trigger);
  const steps = (body.steps ?? old?.steps ?? []).map(cleanStep);
  if (!steps.length) throw err400('Add at least one step.');
  if (steps.length > 20) throw err400('Keep it to 20 steps or fewer.');
  if (steps[steps.length - 1].type === 'wait') throw err400('A "wait" step needs something after it.');
  const active = body.active === undefined ? (old ? old.active : true) : Boolean(body.active);
  const row = { name, active: active ? 1 : 0, trigger_json: JSON.stringify(trigger), steps_json: JSON.stringify(steps) };
  if (old) db.prepare('UPDATE crm_automations SET name=@name, active=@active, trigger_json=@trigger_json, steps_json=@steps_json WHERE id=@id').run({ ...row, id });
  else id = db.prepare('INSERT INTO crm_automations (name, active, trigger_json, steps_json) VALUES (@name,@active,@trigger_json,@steps_json)').run(row).lastInsertRowid;
  // Turning one off cancels anything it was waiting to do.
  if (!active) db.prepare('DELETE FROM crm_automation_waits WHERE automation_id=?').run(id);
  return get(id);
}

function remove(id) { db.prepare('DELETE FROM crm_automations WHERE id=?').run(id); }

// ---------- Running ----------
let depth = 0; // automations can set off other automations, but only a few levels deep

function matches(a, event, data) {
  const t = a.trigger, c = data.contact;
  if (t.type !== event) return false;
  if (t.group && t.group !== c.group_name) return false;
  if (event === 'stage_changed') return data.to === t.stage;
  if (t.stage && t.stage !== c.stage) return false;
  if (event === 'form_filled' && t.form && !String(data.form || '').toLowerCase().includes(t.form.toLowerCase())) return false;
  return true;
}

function log(a, contactId, summary) {
  db.prepare('INSERT INTO crm_automation_log (automation_id, contact_id, summary) VALUES (?,?,?)').run(a.id, contactId, summary);
  db.prepare('DELETE FROM crm_automation_log WHERE id <= (SELECT id FROM crm_automation_log ORDER BY id DESC LIMIT 1 OFFSET 500)').run();
}

// Runs steps from `from` until the end or a wait. Returns a short list of what it did.
function runSteps(a, contactId, from, vars, now = new Date()) {
  const done = [];
  for (let i = from; i < a.steps.length; i++) {
    const s = a.steps[i];
    const c = db.prepare('SELECT * FROM contacts WHERE id=?').get(contactId);
    if (!c) break;
    if (s.type === 'wait') {
      const ms = s.amount * (s.unit === 'hours' ? 3600e3 : 86400e3);
      db.prepare('INSERT INTO crm_automation_waits (automation_id, contact_id, next_step, run_at, if_stage, vars_json) VALUES (?,?,?,?,?,?)')
        .run(a.id, contactId, i + 1, new Date(now.getTime() + ms).toISOString(), s.if_stage, JSON.stringify(vars || {}));
      done.push(`waiting ${s.amount} ${s.unit}${s.if_stage ? ` (then only if still "${s.if_stage}")` : ''}`);
      break;
    }
    if (s.type === 'alert') {
      notify.send(fill(s.title, c, vars), fill(s.message, c, vars), { tags: 'robot' }).catch(() => {});
      done.push('phone alert');
    } else if (s.type === 'task') {
      // Never line up a message for someone who asked not to be contacted.
      if (s.template_id && c.do_not_contact) { done.push('skipped message (Do not contact)'); continue; }
      const t = crm.saveTask({ title: fill(s.title, c, vars), due_on: addDays(s.due_days, now), contact_id: c.id });
      if (s.template_id) db.prepare('UPDATE crm_tasks SET template_id=? WHERE id=?').run(s.template_id, t.id);
      done.push(`task "${t.title}"`);
    } else if (s.type === 'stage') {
      if (c.stage !== s.stage) { crm.updateContact(c.id, { stage: s.stage }); done.push(`moved to "${s.stage}"`); }
    } else if (s.type === 'group') {
      if (c.group_name !== s.group) { crm.updateContact(c.id, { group_name: s.group }); done.push(`group "${s.group}"`); }
    } else if (s.type === 'follow_up') {
      crm.updateContact(c.id, { next_follow_up: addDays(s.days, now) });
      done.push(`follow-up ${s.days ? `in ${s.days} day${s.days === 1 ? '' : 's'}` : 'today'}`);
    } else if (s.type === 'note') {
      crm.logActivity(c.id, { kind: 'Note', note: fill(s.note, c, vars) });
      done.push('note');
    }
  }
  return done;
}

function start(a, contactId, vars, now) {
  const done = runSteps(a, contactId, 0, vars, now);
  db.prepare("UPDATE crm_automations SET runs=runs+1, last_run_at=datetime('now') WHERE id=?").run(a.id);
  log(a, contactId, done.join(', ') || 'nothing to do');
  if (done.length) crm.logActivity(contactId, { kind: 'Automation', note: `"${a.name}": ${done.join(', ')}` });
}

function handle(event, data) {
  if (depth >= 3 || !data?.contact?.id) return;
  depth++;
  try {
    for (const a of list()) {
      if (!a.active || !matches(a, event, data)) continue;
      try { start(a, data.contact.id, { form: data.form, when: data.when }); }
      catch (e) { console.error(`[automation] "${a.name}" failed: ${e.message}`); try { log(a, data.contact.id, `Problem: ${e.message}`); } catch {} }
    }
  } finally { depth--; }
}
crm.events.on('crm', ({ event, ...data }) => handle(event, data));

// Called every minute: carries on automations whose wait is over.
function runWaiting(now = new Date()) {
  const due = db.prepare('SELECT * FROM crm_automation_waits WHERE run_at <= ? ORDER BY run_at, id LIMIT 200').all(now.toISOString());
  let ran = 0;
  for (const w of due) {
    db.prepare('DELETE FROM crm_automation_waits WHERE id=?').run(w.id);
    const a = get(w.automation_id);
    const c = db.prepare('SELECT * FROM contacts WHERE id=?').get(w.contact_id);
    if (!a || !a.active || !c) continue;
    if (w.if_stage && c.stage !== w.if_stage) { log(a, c.id, `stopped: no longer "${w.if_stage}" (now "${c.stage}")`); continue; }
    try {
      depth++;
      const done = runSteps(a, c.id, w.next_step, JSON.parse(w.vars_json || '{}'), now);
      log(a, c.id, done.join(', ') || 'nothing to do');
      if (done.length) crm.logActivity(c.id, { kind: 'Automation', note: `"${a.name}": ${done.join(', ')}` });
      ran++;
    } catch (e) {
      console.error(`[automation] "${a.name}" failed: ${e.message}`);
      log(a, c.id, `Problem: ${e.message}`);
    } finally { depth--; }
  }
  return ran;
}

// ---------- Ready-made automations, added once (deleting one keeps it deleted) ----------
db.exec('CREATE TABLE IF NOT EXISTS crm_flags (name TEXT PRIMARY KEY)');
if (!db.prepare("SELECT 1 FROM crm_flags WHERE name='starter_automations'").get()) {
  const tpl = (name) => db.prepare('SELECT id FROM crm_templates WHERE name=?').get(name)?.id || null;
  db.transaction(() => {
    save({ name: 'New website lead: reply fast', trigger: { type: 'contact_added', group: 'Viral Attraction lead' }, steps: [
      { type: 'task', title: 'Reply to {name} (new Viral Attraction lead)', due_days: 0 },
      { type: 'follow_up', days: 2 },
      { type: 'wait', amount: 3, unit: 'days', if_stage: 'New' },
      { type: 'alert', title: 'Lead waiting 3 days', message: '{name} from your website is still "New". Reach out today.' },
      { type: 'task', title: 'Follow up with {name}: no reply yet', due_days: 0 },
    ] });
    save({ name: 'New sponsor lead: send sponsor levels', trigger: { type: 'contact_added', group: 'Parade sponsor' }, steps: [
      { type: 'task', title: 'Send sponsor levels to {company}', due_days: 0, template_id: tpl('Sponsor ask') },
      { type: 'wait', amount: 5, unit: 'days', if_stage: 'New' },
      { type: 'task', title: 'Call {name} about sponsoring', due_days: 0 },
    ] });
    save({ name: 'Sponsor paid: say thank you', trigger: { type: 'stage_changed', stage: 'Paid / Done', group: 'Parade sponsor' }, steps: [
      { type: 'task', title: 'Send thank-you to {company}', due_days: 0, template_id: tpl('Sponsor thank you') },
      { type: 'task', title: 'Make a thank-you post for {company}', due_days: 2 },
      { type: 'alert', title: 'Sponsor paid', message: '{company} is paid. A thank-you task is ready.' },
    ] });
    save({ name: 'Committed: check on payment', trigger: { type: 'stage_changed', stage: 'Committed' }, steps: [
      { type: 'wait', amount: 7, unit: 'days', if_stage: 'Committed' },
      { type: 'task', title: 'Check on payment from {company}', due_days: 0 },
    ] });
    save({ name: 'Appointment booked: mark Interested', trigger: { type: 'appointment_booked', stage: 'New' }, steps: [
      { type: 'stage', stage: 'Interested' },
      { type: 'task', title: 'Get ready for appointment with {name} ({when})', due_days: 0 },
    ] });
    db.prepare("INSERT INTO crm_flags (name) VALUES ('starter_automations')").run();
  })();
}

// ---------- Routes (mounted at /api/crm/automations) ----------
const router = express.Router();
const wrap = (fn) => (req, res) => { try { fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req, res) => {
  const waiting = db.prepare('SELECT automation_id, COUNT(*) AS n FROM crm_automation_waits GROUP BY automation_id').all();
  res.json({
    triggers: TRIGGERS,
    automations: list().map((a) => ({ ...a, waiting: waiting.find((w) => w.automation_id === a.id)?.n || 0 })),
    log: db.prepare(`SELECT l.*, a.name AS automation_name, c.name AS contact_name FROM crm_automation_log l
      LEFT JOIN crm_automations a ON a.id=l.automation_id LEFT JOIN contacts c ON c.id=l.contact_id ORDER BY l.id DESC LIMIT 30`).all(),
  });
}));
router.post('/', wrap((req, res) => res.json(save(req.body || {}))));
router.put('/:id', wrap((req, res) => res.json(save(req.body || {}, Number(req.params.id)))));
router.delete('/:id', wrap((req, res) => { remove(Number(req.params.id)); res.json({ ok: true }); }));

module.exports = { router, save, get, list, remove, runWaiting, handle, fill, TRIGGERS };
