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
// Email: a "message" task puts a filled-in message one tap away and you press Send. The
// "send email now" step sends by itself, but only through a proper email service (Brevo,
// see email.js), only to people who just reached out to you or said yes to email, with your
// address and an unsubscribe line in every email. Texts are never sent automatically.
const express = require('express');
const db = require('../../src/db');
const config = require('../../src/config');
const crm = require('./crm');
const notify = require('../../src/notify');
const email = require('./email');
const kit = require('./workflow-kit');

const TRIGGERS = {
  contact_added: 'A new contact is added',
  form_filled: 'Someone fills out a form',
  stage_changed: 'A contact moves to a stage',
  appointment_booked: 'Someone books an appointment',
  email_opt_in: 'Someone says yes to email (subscribes)',
  plan_started: 'Someone starts a monthly plan',
  contract_signed: 'Someone signs a contract',
  quote_signed: 'Someone signs a quote',
  event_registered: 'Someone gets tickets to an event',
};
const STEPS = ['alert', 'email', 'text', 'task', 'stage', 'group', 'follow_up', 'note', 'wait'];

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
  if (type === 'email') {
    const t = db.prepare("SELECT * FROM crm_templates WHERE id=? AND channel='email'").get(Number(s.template_id));
    if (!t) throw err400('A "send email" step needs one of your email templates.');
    return { type, template_id: t.id };
  }
  if (type === 'text') { // a text ready to send: you tap Send in Messages (texts never go out by themselves)
    const t = db.prepare('SELECT * FROM crm_templates WHERE id=?').get(Number(s.template_id));
    if (!t) throw err400('A "send a text" step needs one of your message templates.');
    return { type, template_id: t.id, title: str(s.title, 200) || 'Text {name}' };
  }
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
  if (t.type === 'form_filled') {
    out.form = str(t.form, 200) || null;
    out.skip_newsletter = Boolean(t.skip_newsletter);
  }
  return out;
}

const parse = (a) => {
  if (!a) return a;
  const steps = JSON.parse(a.steps_json);
  return { ...a, active: Boolean(a.active), trigger: JSON.parse(a.trigger_json), steps, problems: problems(steps), trigger_json: undefined, steps_json: undefined };
};
const get = (id) => parse(db.prepare('SELECT * FROM crm_automations WHERE id=?').get(id));
const list = () => db.prepare('SELECT * FROM crm_automations ORDER BY id').all().map(parse);

// A draft (switched off) may still have unfinished steps: each one keeps a "problem" note,
// shown as an orange mark in the builder. Publishing (switching on) needs every step finished.
const KEEP = ['type', 'title', 'message', 'template_id', 'due_days', 'stage', 'group', 'days', 'note', 'amount', 'unit', 'if_stage'];
function draftStep(s) {
  try { return cleanStep(s); } catch (e) {
    const out = { problem: e.message };
    for (const k of KEEP) if (s?.[k] !== undefined && s[k] !== null && s[k] !== '') out[k] = typeof s[k] === 'string' ? str(s[k], 1000) : s[k];
    if (!STEPS.includes(out.type)) out.type = 'task';
    return out;
  }
}
function problems(steps) {
  const out = [];
  steps.forEach((s, i) => { if (s.problem) out.push(`Step ${i + 1}: ${s.problem}`); });
  if (!steps.length) out.push('Add at least one step.');
  else if (steps[steps.length - 1].type === 'wait') out.push('A "wait" step needs something after it.');
  return out;
}

function save(body, id) {
  const old = id ? get(id) : null;
  if (id && !old) throw Object.assign(new Error('Automation not found'), { status: 404 });
  const name = str(body.name ?? old?.name, 120);
  if (!name) throw err400('Give the automation a name.');
  const trigger = cleanTrigger(body.trigger ?? old?.trigger);
  const active = body.active === undefined ? (old ? old.active : true) : Boolean(body.active);
  const raw = body.steps ?? old?.steps ?? [];
  if (raw.length > 20) throw err400('Keep it to 20 steps or fewer.');
  if (active) { // publishing: every step must be finished
    const p = problems(raw.map(draftStep));
    if (p.length) throw err400(`Can't publish yet. ${p[0]}`);
  }
  const steps = raw.map(active ? cleanStep : draftStep);
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
  // "Group" can list several, separated by commas.
  if (t.group && !t.group.split(',').map((g) => g.trim().toLowerCase()).includes(String(c.group_name).toLowerCase())) return false;
  if (event === 'form_filled' && t.skip_newsletter && data.newsletterOnly) return false;
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
    } else if (s.type === 'email') {
      done.push(sendEmail(a, c, s, vars));
    } else if (s.type === 'text') {
      // Texts never go out by themselves: a task with the filled-in text, one tap away.
      if (c.do_not_contact) { done.push('skipped text (Do not contact)'); continue; }
      if (!c.phone) { done.push('skipped text (no phone number)'); continue; }
      const t = crm.saveTask({ title: fill(s.title || 'Text {name}', c, vars), due_on: addDays(0, now), contact_id: c.id });
      db.prepare('UPDATE crm_tasks SET template_id=? WHERE id=?').run(s.template_id, t.id);
      done.push(`text ready to send ("${t.title}")`);
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

const QUIET = 'email skipped (not set up yet)'; // shown in Recent runs, kept out of contact history
const forHistory = (done) => done.filter((d) => d !== QUIET);

// Sends one template email through Brevo (in the background) and reports what happened.
function sendEmail(a, c, s, vars = {}) {
  const t = db.prepare('SELECT * FROM crm_templates WHERE id=?').get(s.template_id);
  if (!t) return 'skipped email (template was deleted)';
  if (!email.ready()) return QUIET; // not connected to Brevo yet: everything else still runs
  // CAN-SPAM and good sense: only people who contacted you, or who said yes to email.
  if (!vars.reached_out && !c.email_ok) return `skipped email: ${c.name} didn't contact you or say yes to email`;
  const subject = crm.fillTemplate(t.subject || t.name, c), text = crm.fillTemplate(t.body, c);
  const design = { ...t, heading: crm.fillTemplate(t.heading, c), body: text, preheader: crm.fillTemplate(t.preheader, c) };
  let rowId;
  try { rowId = email.claim({ contact: c, automationId: a.id, templateId: t.id, subject }); }
  catch (e) { return `skipped email: ${e.message}`; }
  const reason = vars.reached_out ? `you contacted us${vars.form ? ` ("${vars.form}")` : ''}` : 'you signed up to get email from us';
  email.deliver(rowId, { to: c.email, toName: c.name, subject, text, reason, design }).then((r) => {
    try {
      if (r.ok) crm.logActivity(c.id, { kind: 'Email', note: `Sent "${t.name}" automatically ("${subject}")` });
      else {
        log(a, c.id, `Email to ${c.email} failed: ${r.error}`);
        notify.send('Automatic email failed', `"${t.name}" to ${c.name}: ${r.error}`, { tags: 'warning', priority: 'high' }).catch(() => {});
      }
    } catch {} // contact may have been deleted meanwhile
  });
  return `email "${t.name}"`;
}

function start(a, contactId, vars, now) {
  const done = runSteps(a, contactId, 0, vars, now);
  db.prepare("UPDATE crm_automations SET runs=runs+1, last_run_at=datetime('now') WHERE id=?").run(a.id);
  log(a, contactId, done.join(', ') || 'nothing to do');
  if (forHistory(done).length) crm.logActivity(contactId, { kind: 'Automation', note: `"${a.name}": ${forHistory(done).join(', ')}` });
}

function handle(event, data) {
  if (depth >= 3 || !data?.contact?.id) return;
  depth++;
  try {
    for (const a of list()) {
      if (!a.active || !matches(a, event, data)) continue;
      // They reached out themselves (form, website, booking): a reply email is welcome.
      const reached_out = ['form_filled', 'appointment_booked', 'plan_started', 'contract_signed', 'quote_signed', 'event_registered'].includes(event) || (event === 'contact_added' && ['form', 'booking'].includes(data.source));
      try { start(a, data.contact.id, { form: data.form, when: data.when, reached_out }); }
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
      if (forHistory(done).length) crm.logActivity(c.id, { kind: 'Automation', note: `"${a.name}": ${forHistory(done).join(', ')}` });
      ran++;
    } catch (e) {
      console.error(`[automation] "${a.name}" failed: ${e.message}`);
      log(a, c.id, `Problem: ${e.message}`);
    } finally { depth--; }
  }
  return ran;
}

// ---------- Test run: says what would happen for one contact, without doing any of it ----------
function dryRun(body, contactId) {
  const c = db.prepare('SELECT * FROM contacts WHERE id=?').get(contactId);
  if (!c) throw err400('Pick a contact to test with.');
  const trigger = cleanTrigger(body.trigger);
  const steps = (body.steps || []).map(draftStep);
  const event = { contact: c, form: trigger.form || 'a form', to: trigger.stage, newsletterOnly: false };
  const would = matches({ trigger }, trigger.type, event);
  const why = [];
  if (trigger.group && !trigger.group.split(',').map((g) => g.trim().toLowerCase()).includes(String(c.group_name).toLowerCase())) why.push(`${c.name} is in group "${c.group_name}", not "${trigger.group}"`);
  if (trigger.type !== 'stage_changed' && trigger.stage && trigger.stage !== c.stage) why.push(`${c.name} is "${c.stage}", not "${trigger.stage}"`);
  const vars = { form: trigger.form || 'your form', when: 'their appointment time', reached_out: ['form_filled', 'appointment_booked'].includes(trigger.type) };
  const tplName = (id) => db.prepare('SELECT name FROM crm_templates WHERE id=?').get(id)?.name || 'a template';
  const lines = steps.map((s) => {
    if (s.problem) return `Not finished: ${s.problem}`;
    return {
      alert: () => `Buzz your phone: "${fill(s.title, c, vars)}: ${fill(s.message, c, vars)}"`,
      email: () => (c.do_not_contact ? `Skip email "${tplName(s.template_id)}" (${c.name} is Do not contact)` : !c.email ? 'Skip email (no email address)'
        : !vars.reached_out && !c.email_ok ? `Skip email "${tplName(s.template_id)}" (${c.name} didn't contact you or say yes to email)` : `Email "${tplName(s.template_id)}" to ${c.email}`),
      text: () => (c.phone ? `Make a task to text ${c.phone} with "${tplName(s.template_id)}" (you tap Send)` : 'Skip text (no phone number)'),
      task: () => `Make a task: "${fill(s.title, c, vars)}"${s.due_days ? `, due in ${s.due_days} day${s.due_days === 1 ? '' : 's'}` : ', due today'}`,
      stage: () => `Move ${c.name} to "${s.stage}"`,
      group: () => `Put ${c.name} in group "${s.group}"`,
      follow_up: () => `Set next follow-up to ${addDays(s.days)}`,
      note: () => `Add a note: "${fill(s.note, c, vars)}"`,
      wait: () => `Wait ${s.amount} ${s.unit}${s.if_stage ? `, then carry on only if ${c.name} is still "${s.if_stage}"` : ''}`,
    }[s.type]();
  });
  return { contact: c.name, would_start: would, why, steps: lines };
}

// ---------- Ready-made automations, added once (deleting one keeps it deleted) ----------
db.exec('CREATE TABLE IF NOT EXISTS crm_flags (name TEXT PRIMARY KEY)');
if (config.ownerStarters && !db.prepare("SELECT 1 FROM crm_flags WHERE name='starter_automations'").get()) {
  const tpl = (name) => db.prepare('SELECT id FROM crm_templates WHERE name=?').get(name)?.id || null;
  const addTpl = (name, subject, body) => tpl(name) || crm.saveTemplate({ name, channel: 'email', subject, body }).id;
  db.transaction(() => {
    const welcomeVA = addTpl('Website lead welcome', 'Thanks for reaching out to Viral Attraction!',
      `Hi {first_name},\n\nThanks for reaching out to Viral Attraction! I got your message and I'll get back to you personally within one business day.\n\nIf it's easier, just reply to this email with a good time to talk.\n\nTalk soon,\nDaniel King\nViral Attraction\nhttps://viralattraction.com`);
    const welcomeSponsor = addTpl('Sponsor lead welcome', 'Thank you for your interest in sponsoring the parade!',
      `Hi {first_name},\n\nThank you for your interest in sponsoring the Fuquay-Varina Christmas Parade! I'll reach out soon with the details.\n\nIn the meantime, you can see the sponsor levels and sign up here: https://fuquayvarinachristmasparade.org/parade/sponsorship\n\nThank you,\nDaniel King\nFuquay-Varina Christmas Parade`);
    save({ name: 'New website lead: reply fast', trigger: { type: 'form_filled', group: 'Viral Attraction lead', skip_newsletter: true }, steps: [
      { type: 'email', template_id: welcomeVA },
      { type: 'task', title: 'Reply to {name} (new Viral Attraction lead)', due_days: 0 },
      { type: 'follow_up', days: 2 },
      { type: 'wait', amount: 3, unit: 'days', if_stage: 'New' },
      { type: 'alert', title: 'Lead waiting 3 days', message: '{name} from your website is still "New". Reach out today.' },
      { type: 'task', title: 'Follow up with {name}: no reply yet', due_days: 0 },
    ] });
    save({ name: 'New sponsor lead: send sponsor levels', trigger: { type: 'contact_added', group: 'Parade sponsor' }, steps: [
      { type: 'email', template_id: welcomeSponsor },
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

// Ready-made email flows (Omnisend-style welcome series), added once.
if (config.ownerStarters && !db.prepare("SELECT 1 FROM crm_flags WHERE name='starter_email_flows'").get()) {
  const tpl = (name) => db.prepare('SELECT id FROM crm_templates WHERE name=?').get(name)?.id || null;
  const add = (name, f) => tpl(name) || crm.saveTemplate({ name, channel: 'email', ...f }).id;
  const va = 'https://viralattraction.com', parade = 'https://fuquayvarinachristmasparade.org';
  db.transaction(() => {
    const w1 = add('Viral Attraction welcome 1: hello', { subject: 'Welcome to Viral Attraction, {first_name}!', preheader: "Here's what to expect from us",
      heading: 'Welcome to Viral Attraction!', button_text: 'See our work', button_url: va,
      body: `Hi {first_name},\n\nThanks for joining the Viral Attraction email list! We're a video marketing team right here in Fuquay-Varina, and we help local businesses get seen with short videos that people actually watch.\n\nEvery so often we'll send you simple video ideas, local success stories and the occasional special offer. No spam, ever.\n\nTalk soon,\nDaniel King` });
    const w2 = add('Viral Attraction welcome 2: tips', { subject: '3 quick video ideas for your business', preheader: 'You can film these on your phone this week',
      heading: '3 videos you can film this week', button_text: 'Get more ideas', button_url: va,
      body: `Hi {first_name},\n\nHere are three short videos that work for almost any local business:\n\n**1. Meet the owner.** 30 seconds on why you started and who you love helping.\n\n**2. Behind the scenes.** Show how your product or service comes together.\n\n**3. Happy customer.** A quick clip of a real customer saying what they liked.\n\nKeep each one under 60 seconds and post it on Facebook, Instagram, TikTok and YouTube Shorts.\n\nDaniel King\nViral Attraction` });
    const w3 = add('Viral Attraction welcome 3: free call', { subject: 'Want a free video plan, {first_name}?', preheader: 'A free 20-minute call, no pressure',
      heading: 'Let us plan your next videos for free', button_text: 'Book a free call', button_url: va,
      body: `Hi {first_name},\n\nIf you'd like help getting more customers from video, I'd be happy to look at your business and give you a simple video plan on a free 20-minute call. No pressure at all.\n\nJust tap the button below, or reply to this email with a good time.\n\nDaniel King\nViral Attraction` });
    const p1 = add('Parade news welcome', { subject: "You're on the Fuquay-Varina Christmas Parade list!", preheader: 'Parade news, sponsor spots and ways to help',
      heading: 'Thanks for joining the parade list!', button_text: 'Visit the parade website', button_url: parade,
      body: `Hi {first_name},\n\nThank you for signing up for Fuquay-Varina Christmas Parade news! We'll keep you posted on the parade date, route and fun extras.\n\nWant to be part of it? On our website you can **sponsor** the parade, **shop** parade gear, **register** an entry or **donate**:\n${parade}\n\nSee you downtown!\nDaniel King\nFuquay-Varina Christmas Parade` });
    save({ name: 'Welcome series: Viral Attraction subscribers', trigger: { type: 'email_opt_in', group: 'Viral Attraction lead' }, steps: [
      { type: 'email', template_id: w1 },
      { type: 'wait', amount: 2, unit: 'days' },
      { type: 'email', template_id: w2 },
      { type: 'wait', amount: 3, unit: 'days', if_stage: 'New' },
      { type: 'email', template_id: w3 },
    ] });
    save({ name: 'Welcome: parade news subscribers', trigger: { type: 'email_opt_in', group: 'Parade entry, Volunteer, Vendor, Donor, Other' }, steps: [
      { type: 'email', template_id: p1 },
    ] });
    db.prepare("INSERT INTO crm_flags (name) VALUES ('starter_email_flows')").run();
  })();
}

// ---------- Routes (mounted at /api/crm/automations) ----------
const router = express.Router();
const wrap = (fn) => (req, res) => { try { fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req, res) => {
  const waiting = db.prepare('SELECT automation_id, COUNT(*) AS n FROM crm_automation_waits GROUP BY automation_id').all();
  res.json({
    triggers: TRIGGERS,
    email: email.status(),
    automations: list().map((a) => ({ ...a, waiting: waiting.find((w) => w.automation_id === a.id)?.n || 0 })),
    log: db.prepare(`SELECT l.*, a.name AS automation_name, c.name AS contact_name FROM crm_automation_log l
      LEFT JOIN crm_automations a ON a.id=l.automation_id LEFT JOIN contacts c ON c.id=l.contact_id ORDER BY l.id DESC LIMIT 30`).all(),
  });
}));
// The builder: ready-made workflows, "describe it" drafts, history and a safe test run.
router.get('/library', wrap((req, res) => res.json(kit.library())));
router.post('/library/:key', wrap((req, res) => res.json(save(kit.fromLibrary(req.params.key)))));
router.post('/suggest', wrap((req, res) => res.json(kit.suggest(String(req.body?.text || '')))));
router.get('/:id/history', wrap((req, res) => {
  const id = Number(req.params.id);
  res.json({
    log: db.prepare(`SELECT l.*, c.name AS contact_name FROM crm_automation_log l LEFT JOIN contacts c ON c.id=l.contact_id
      WHERE l.automation_id=? ORDER BY l.id DESC LIMIT 200`).all(id),
    waiting: db.prepare(`SELECT w.*, c.name AS contact_name FROM crm_automation_waits w JOIN contacts c ON c.id=w.contact_id
      WHERE w.automation_id=? ORDER BY w.run_at`).all(id),
  });
}));
router.post('/test', wrap((req, res) => res.json(dryRun(req.body?.automation || {}, Number(req.body?.contact_id)))));
router.post('/', wrap((req, res) => res.json(save(req.body || {}))));
router.put('/:id', wrap((req, res) => res.json(save(req.body || {}, Number(req.params.id)))));
router.delete('/:id', wrap((req, res) => { remove(Number(req.params.id)); res.json({ ok: true }); }));

module.exports = { router, save, get, list, remove, runWaiting, handle, fill, dryRun, TRIGGERS, STEPS };
