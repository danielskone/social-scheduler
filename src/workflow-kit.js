// Ready-made workflows for the CRM's Automations builder, and "describe it in a sentence":
// turns plain words ("when someone fills out a form, email them, wait 2 days, then remind me")
// into a draft workflow. All of this is plain keyword matching on this Mac: free, no AI service.
const db = require('./db');
const crm = require('./crm');

const tplId = (name, channel) => db.prepare(`SELECT id FROM crm_templates WHERE name=?${channel ? ' AND channel=?' : ''}`).get(...[name, channel].filter(Boolean))?.id || null;
const firstTpl = (channel) => db.prepare('SELECT id FROM crm_templates WHERE channel=? ORDER BY id LIMIT 1').get(channel)?.id || null;

// Each one starts as a Draft, so nothing happens until you look it over and click Publish.
const LIBRARY = [
  { key: 'website-lead', category: 'Leads', name: 'New website lead: reply fast', about: 'Someone fills out your website form: welcome email, a task to reply today, and a nudge if they are still New after 3 days.',
    trigger: { type: 'form_filled', group: 'Viral Attraction lead', skip_newsletter: true },
    steps: () => [{ type: 'email', template_id: tplId('Website lead welcome', 'email') }, { type: 'task', title: 'Reply to {name} (new lead)', due_days: 0 },
      { type: 'wait', amount: 3, unit: 'days', if_stage: 'New' }, { type: 'alert', title: 'Lead waiting 3 days', message: '{name} is still "New". Reach out today.' }] },
  { key: 'hot-lead', category: 'Leads', name: 'Hot lead: call today', about: 'A contact moves to "Interested": buzz your phone and make a "call today" task.',
    trigger: { type: 'stage_changed', stage: 'Interested' },
    steps: () => [{ type: 'alert', title: 'Hot lead', message: '{name} is Interested. Call them today.' }, { type: 'task', title: 'Call {name} ({phone})', due_days: 0 }] },
  { key: 'no-reply', category: 'Follow-up', name: 'No reply after 3 days', about: 'After you mark someone "Contacted", wait 3 days. If they are still Contacted, get a text ready and a reminder.',
    trigger: { type: 'stage_changed', stage: 'Contacted' },
    steps: () => [{ type: 'wait', amount: 3, unit: 'days', if_stage: 'Contacted' }, { type: 'text', template_id: tplId('Quick follow-up text', 'text') || firstTpl('text'), title: 'Text {name}: follow-up' },
      { type: 'follow_up', days: 4 }] },
  { key: 'appointment', category: 'Appointments', name: 'Appointment booked: get ready', about: 'Someone books a call: move them to Interested, make a prep task and buzz your phone.',
    trigger: { type: 'appointment_booked' },
    steps: () => [{ type: 'stage', stage: 'Interested' }, { type: 'task', title: 'Get ready for call with {name} ({when})', due_days: 0 }, { type: 'alert', title: 'New booking', message: '{name} booked {when}' }] },
  { key: 'after-call', category: 'Appointments', name: 'After the call: follow up', about: 'One day after a booking, a task to send a recap and next steps.',
    trigger: { type: 'appointment_booked' },
    steps: () => [{ type: 'wait', amount: 1, unit: 'days' }, { type: 'task', title: 'Send {name} a recap and next steps', due_days: 0 }, { type: 'follow_up', days: 7 }] },
  { key: 'sponsor-lead', category: 'Parade', name: 'New sponsor lead', about: 'New parade sponsor contact: welcome email with sponsor levels, then a call reminder after 5 days if still New.',
    trigger: { type: 'contact_added', group: 'Parade sponsor' },
    steps: () => [{ type: 'email', template_id: tplId('Sponsor lead welcome', 'email') }, { type: 'wait', amount: 5, unit: 'days', if_stage: 'New' }, { type: 'task', title: 'Call {name} about sponsoring', due_days: 0 }] },
  { key: 'sponsor-paid', category: 'Parade', name: 'Sponsor paid: say thank you', about: 'A sponsor moves to "Paid / Done": thank-you task with the email ready, and a task to post a thank-you.',
    trigger: { type: 'stage_changed', stage: 'Paid / Done', group: 'Parade sponsor' },
    steps: () => [{ type: 'task', title: 'Send thank-you to {company}', due_days: 0, template_id: tplId('Sponsor thank you') }, { type: 'task', title: 'Make a thank-you post for {company}', due_days: 2 }] },
  { key: 'entry', category: 'Parade', name: 'Parade entry signed up', about: 'Someone fills out the parade entry form: review task, then a reminder text a week later if they are still New.',
    trigger: { type: 'form_filled', form: 'entry', group: 'Parade entry' },
    steps: () => [{ type: 'task', title: 'Review parade entry from {name}', due_days: 0 }, { type: 'wait', amount: 7, unit: 'days', if_stage: 'New' },
      { type: 'text', template_id: tplId('Parade entry reminder text', 'text') || firstTpl('text'), title: 'Text {name}: finish entry' }] },
  { key: 'volunteer', category: 'Parade', name: 'New volunteer: welcome', about: 'A new volunteer is added: a welcome text ready to send and a note in their history.',
    trigger: { type: 'contact_added', group: 'Volunteer' },
    steps: () => [{ type: 'text', template_id: tplId('Quick follow-up text', 'text') || firstTpl('text'), title: 'Welcome text to {name}' }, { type: 'note', note: 'New volunteer added' }] },
  { key: 'payment-check', category: 'Customers', name: 'Committed: check on payment', about: 'Someone says yes ("Committed"): after 7 days, if still Committed, a task to check on payment.',
    trigger: { type: 'stage_changed', stage: 'Committed' },
    steps: () => [{ type: 'wait', amount: 7, unit: 'days', if_stage: 'Committed' }, { type: 'task', title: 'Check on payment from {company}', due_days: 0 }] },
  { key: 'review', category: 'Customers', name: 'Done: ask for a review', about: 'Two days after a job is "Paid / Done", a task to ask for a Google review.',
    trigger: { type: 'stage_changed', stage: 'Paid / Done', group: 'Viral Attraction lead' },
    steps: () => [{ type: 'wait', amount: 2, unit: 'days' }, { type: 'task', title: 'Ask {name} for a Google review', due_days: 0 }] },
  { key: 'next-year', category: 'Customers', name: 'Not this year: ask again next year', about: 'Someone says "Not this year": in 300 days, a task to ask again.',
    trigger: { type: 'stage_changed', stage: 'Not this year' },
    steps: () => [{ type: 'wait', amount: 300, unit: 'days', if_stage: 'Not this year' }, { type: 'stage', stage: 'New' }, { type: 'task', title: 'Ask {company} again for this year', due_days: 0 }] },
  { key: 'welcome-series', category: 'Email', name: 'Welcome series for subscribers', about: 'Someone says yes to email: welcome email now, tips email 2 days later, free-call email 3 days after that.',
    trigger: { type: 'email_opt_in', group: 'Viral Attraction lead' },
    steps: () => [{ type: 'email', template_id: tplId('Viral Attraction welcome 1: hello', 'email') }, { type: 'wait', amount: 2, unit: 'days' },
      { type: 'email', template_id: tplId('Viral Attraction welcome 2: tips', 'email') }, { type: 'wait', amount: 3, unit: 'days' },
      { type: 'email', template_id: tplId('Viral Attraction welcome 3: free call', 'email') }] },
];

function library() {
  return LIBRARY.map(({ steps, ...w }) => ({ ...w, steps: steps() }));
}
function fromLibrary(key) {
  const w = LIBRARY.find((x) => x.key === key);
  if (!w) throw Object.assign(new Error('That ready-made workflow was not found.'), { status: 404 });
  return { name: w.name, trigger: { ...w.trigger }, steps: w.steps(), active: false };
}

// ---------- "Describe it" ----------
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fourteen: 14, thirty: 30 };
const n = (w) => (NUM[w] !== undefined ? NUM[w] : Number(w));

function findStage(text) {
  const t = text.toLowerCase();
  const alias = { paid: 'Paid / Done', done: 'Paid / Done', committed: 'Committed', interested: 'Interested', contacted: 'Contacted', 'not this year': 'Not this year', new: 'New' };
  const hit = crm.STAGES.find((s) => t.includes(s.toLowerCase())) || Object.entries(alias).find(([k]) => new RegExp(`\\b${k}\\b`).test(t))?.[1];
  return hit || null;
}
function findGroup(text) {
  const t = text.toLowerCase();
  const groups = [...new Set([...crm.GROUPS, ...db.prepare("SELECT DISTINCT group_name AS g FROM contacts WHERE group_name<>''").all().map((r) => r.g)])];
  const alias = { sponsor: 'Parade sponsor', volunteer: 'Volunteer', vendor: 'Vendor', donor: 'Donor', 'parade entr': 'Parade entry', 'viral attraction': 'Viral Attraction lead', 'website': 'Viral Attraction lead', 'auto customer': 'Auto customer', 'car': 'Auto customer' };
  return groups.find((g) => t.includes(g.toLowerCase())) || Object.entries(alias).find(([k]) => t.includes(k))?.[1] || null;
}
function findTemplate(text, channel) {
  const t = text.toLowerCase();
  const all = db.prepare('SELECT id, name FROM crm_templates WHERE channel=? ORDER BY id').all(channel);
  // a template whose name shares the most words with the sentence
  let best = null, score = 0;
  for (const x of all) {
    const words = x.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    const s = words.filter((w) => t.includes(w)).length;
    if (s > score) { best = x; score = s; }
  }
  return (best || all[0] || {}).id || null;
}

function suggest(text) {
  const raw = String(text || '').trim().slice(0, 1000);
  if (!raw) throw Object.assign(new Error('Write what you want to happen, like "When someone fills out a form, email them, wait 2 days, then remind me to call."'), { status: 400 });
  const t = raw.toLowerCase();
  // 1) What starts it: the part before the first action word.
  const startPart = t.split(/\b(?:then|send|email|text|sms|wait|remind|buzz|notify|alert|make a task|create a task|move them|put them)\b/)[0] || t;
  let trigger = { type: 'contact_added' };
  if (/\b(form|fills? out|signs? up on|registers?|submits?)\b/.test(startPart)) trigger = { type: 'form_filled', skip_newsletter: true };
  else if (/\b(books?|booked|appointment|call is scheduled|schedules?)\b/.test(startPart)) trigger = { type: 'appointment_booked' };
  else if (/\b(subscribes?|opts? in|says yes to email|newsletter|joins? (?:the|my) (?:email )?list)\b/.test(startPart)) trigger = { type: 'email_opt_in' };
  else if (/\b(moves? to|stage|becomes?|marked?|is now|pays?|paid|commits?)\b/.test(startPart)) trigger = { type: 'stage_changed', stage: findStage(startPart) || 'Interested' };
  const group = findGroup(startPart);
  if (group) trigger.group = group;
  if (trigger.type === 'form_filled') { const m = startPart.match(/(\w+) form/); if (m && !['a', 'the', 'my', 'any', 'out', 'website'].includes(m[1])) trigger.form = m[1]; }

  // 2) The steps, in the order written.
  const rest = t.slice(startPart.length);
  const parts = rest.split(/\s*(?:,|;|\.|\bthen\b|\band then\b|\bafter that\b|\band\b(?=\s+(?:send|email|text|wait|remind|buzz|notify|alert|make|create|move|put|add|set)))\s*/).map((x) => x.trim()).filter(Boolean);
  const steps = [];
  for (const p of parts) {
    let m;
    if ((m = p.match(/\bwait(?:s)?\s+(?:for\s+)?(\w+)\s+(hour|day|week)s?\b/)) || (m = p.match(/\b(\w+)\s+(hour|day|week)s?\s+later\b/)) || (m = p.match(/\bafter\s+(\w+)\s+(hour|day|week)s?\b/))) {
      let amount = n(m[1]) || 1, unit = m[2] === 'hour' ? 'hours' : 'days';
      if (m[2] === 'week') amount *= 7;
      const still = p.match(/\b(?:if|when|unless)\b.*?\b(still|not)\b.*$/) ? findStage(p) : null;
      steps.push({ type: 'wait', amount, unit, if_stage: still });
      const after = p.replace(m[0], '').trim();
      if (!after || !/\b(send|email|text|sms|remind|buzz|notify|alert|task|move|put|follow)/.test(after)) continue;
    }
    if (/\b(text|sms)\b/.test(p)) steps.push({ type: 'text', template_id: findTemplate(p, 'text'), title: 'Text {name}' });
    else if (/\b(e-?mail)\b/.test(p)) steps.push({ type: 'email', template_id: findTemplate(p, 'email') });
    else if (/\b(buzz|notify|alert|ping|let me know|tell me)\b/.test(p)) {
      const extra = p.replace(/^.*?\b(buzz|notify|alert|ping|let me know|tell me)\b\s*(my phone|me)?\s*/, '').replace(/^(that|about)\s+/, '').slice(0, 120);
      steps.push({ type: 'alert', title: 'Viral Touch CRM', message: extra ? `{name}: ${extra}` : '{name} needs you' });
    }
    else if (/\b(move|mark|change)\b.*\b(to|as)\b/.test(p) && findStage(p)) steps.push({ type: 'stage', stage: findStage(p) });
    else if (/\b(put|add|move)\b.*\bgroup\b/.test(p) && findGroup(p)) steps.push({ type: 'group', group: findGroup(p) });
    else if (/\bfollow[- ]?up\b/.test(p) && (m = p.match(/(\w+)\s+days?/))) steps.push({ type: 'follow_up', days: n(m[1]) || 1 });
    else if (/\bnote\b/.test(p) && !/\b(task|remind)/.test(p)) steps.push({ type: 'note', note: p.replace(/.*\bnote\b\s*(saying|that)?\s*/, '') || 'Automation ran' });
    else if (/\b(remind|task|call|follow|reach out|check)\b/.test(p)) {
      const said = p.match(/\b(?:task|remind me|reminder)\s+(?:to\s+)?(.{3,})$/);
      const what = said ? said[1].replace(/\b(them|him|her)\b/g, '{name}').replace(/^./, (c) => c.toUpperCase()) + (/\{name\}/.test(said[1].replace(/\b(them|him|her)\b/g, '{name}')) ? '' : ': {name}')
        : /\bcall\b/.test(p) ? 'Call {name}' : /\b(follow|reach out|check)\b/.test(p) ? 'Follow up with {name}' : 'Reach out to {name}';
      steps.push({ type: 'task', title: what, due_days: 0 });
    }
  }
  if (!steps.length) steps.push({ type: 'task', title: 'Reach out to {name}', due_days: 0 });
  if (steps[steps.length - 1].type === 'wait') steps.push({ type: 'task', title: 'Follow up with {name}', due_days: 0 });
  const START = { contact_added: 'New contact', form_filled: 'Form filled', appointment_booked: 'Appointment booked', email_opt_in: 'New subscriber', stage_changed: `Moved to ${trigger.stage}` };
  const DO = { email: 'email', text: 'text', alert: 'buzz phone', task: 'task', stage: 'move stage', group: 'set group', follow_up: 'follow-up', note: 'note' };
  const did = [...new Set(steps.filter((x) => x.type !== 'wait').map((x) => DO[x.type]))].slice(0, 3).join(', ');
  const name = `${START[trigger.type]}${trigger.group ? ` (${trigger.group})` : ''}: ${did}`;
  return { name: name.slice(0, 80), trigger, steps: steps.slice(0, 20), active: false };
}

module.exports = { library, fromLibrary, suggest, LIBRARY };
