// Automations tab of Viral Touch CRM, as a visual workflow builder: a list of workflows,
// a step-by-step flow (trigger card, steps with + between them, END) with a side panel to
// edit each one, ready-made workflows, "describe it" drafts, a safe test run, and history.
// crm.js calls window.VPWorkflows.render(meta) when the Automations tab opens.
(() => {
  const q$ = (s, el = document) => el.querySelector(s);
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function call(p, opts = {}) {
    if (opts.json) { opts.body = JSON.stringify(opts.json); opts.headers = { 'Content-Type': 'application/json' }; delete opts.json; }
    const bizQ = (u) => { let b = ''; try { b = JSON.parse(localStorage.getItem('vtcrm-biz') || '""'); } catch { /* private mode */ } return b ? `${u}${u.includes('?') ? '&' : '?'}biz=${encodeURIComponent(b)}` : u; }; // the business picked in the switcher
    const res = await fetch(bizQ(`/api/crm${p}`), opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  const when = (s) => {
    if (!s) return '';
    const d = new Date(/Z$|[+-]\d\d:\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  const P = {
    person: '<circle cx="10" cy="8" r="4"/><path d="M3 21c1-4 3.6-6 7-6 2 0 3.6.6 4.8 1.8M18 14v6M15 17h6"/>',
    form: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>', calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', chat: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 10h8M8 13h5"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>', check: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8 12 3 3 5-6"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.3-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2 .7 3.2 2.6 3.5 5.5"/>',
    repeat: '<path d="M17 3l3 3-3 3M20 6H8a4 4 0 0 0-4 4v1M7 21l-3-3 3-3M4 18h12a4 4 0 0 0 4-4v-1"/>', note: '<path d="M5 3h10l4 4v14H5z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', plus: '<path d="M12 5v14M5 12h14"/>', dots: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    back: '<path d="M15 5l-7 7 7 7"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    play: '<path d="M7 4v16l13-8z"/>', history: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v4l3 2"/>', chev: '<path d="m9 6 6 6-6 6"/>', warn: '<path d="M12 8v5M12 16.5v.01"/>',
    up: '<path d="m6 14 6-6 6 6"/>', down: '<path d="m6 10 6 6 6-6"/>', dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  };
  const ico = (k, cls = '') => `<svg class="wf-ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[k] || P.plus}</svg>`;

  // What starts a workflow, and each kind of step: name, one-line help, icon, colour.
  const TRIG = {
    contact_added: { name: 'Contact added', help: 'A new contact is added (by you, a form, the website or a booking).', icon: 'person' },
    form_filled: { name: 'Form filled out', help: 'Someone fills out one of your forms or the website form.', icon: 'form' },
    stage_changed: { name: 'Stage changed', help: 'A contact moves to a stage on your board, like "Interested" or "Paid / Done".', icon: 'flag' },
    appointment_booked: { name: 'Appointment booked', help: 'Someone books a call or meeting with you.', icon: 'calendar' },
    email_opt_in: { name: 'Subscribed to email', help: 'Someone says yes to getting your emails.', icon: 'mail' },
    plan_started: { name: 'Plan started', help: 'Someone signs up for one of your monthly plans and pays.', icon: 'person' },
    contract_signed: { name: 'Contract signed', help: 'Someone signs a contract you sent.', icon: 'form' },
    quote_signed: { name: 'Quote signed', help: 'Someone signs a quote you sent.', icon: 'form' },
  };
  const STEP = {
    email: { name: 'Send email', help: 'Goes out by itself from your email, only to people who contacted you or said yes to email.', icon: 'mail', color: 'green', group: 'Messages' },
    text: { name: 'Send a text', help: 'Gets a text ready on your task list. You tap Send in Messages (texts never go out by themselves).', icon: 'chat', color: 'teal', group: 'Messages' },
    alert: { name: 'Buzz my phone', help: 'Sends a notification to your iPhone.', icon: 'bell', color: 'orange', group: 'Messages' },
    task: { name: 'Make a task', help: 'Adds a to-do to your Tasks list.', icon: 'check', color: 'indigo', group: 'Contact' },
    stage: { name: 'Move to stage', help: 'Moves the contact to a stage on your board.', icon: 'flag', color: 'purple', group: 'Contact' },
    group: { name: 'Put in group', help: 'Changes the contact\'s group.', icon: 'users', color: 'pink', group: 'Contact' },
    follow_up: { name: 'Set follow-up date', help: 'Sets when you should get back to them next.', icon: 'repeat', color: 'blue', group: 'Contact' },
    note: { name: 'Add a note', help: 'Writes a note in the contact\'s history.', icon: 'note', color: 'gray', group: 'Contact' },
    wait: { name: 'Wait', help: 'Pauses for some hours or days before the next step. Can stop if they moved on.', icon: 'clock', color: 'violet', group: 'Timing' },
  };
  const FILL = ['{first_name}', '{name}', '{company}', '{phone}', '{email}', '{stage}', '{group}', '{form}', '{when}'];

  let meta = { groups: [], stages: [] };
  let tpls = [];
  const tplName = (id) => (tpls.find((t) => t.id === Number(id)) || {}).name;

  // Same checks the Mac makes before publishing, so problems show as an orange mark right away.
  function problem(s) {
    if (s.type === 'email') return !tpls.some((t) => t.id === Number(s.template_id) && t.channel === 'email') ? 'Pick an email to send.' : '';
    if (s.type === 'text') return !tplName(s.template_id) ? 'Pick a message to send.' : '';
    if (s.type === 'task') return !String(s.title || '').trim() ? 'Give the task a name.' : '';
    if (s.type === 'stage') return !meta.stages.includes(s.stage) ? 'Pick a stage.' : '';
    if (s.type === 'group') return !String(s.group || '').trim() ? 'Pick a group.' : '';
    if (s.type === 'note') return !String(s.note || '').trim() ? 'Write the note.' : '';
    if (s.type === 'wait') return !(Number(s.amount) > 0) ? 'How long should it wait?' : '';
    return '';
  }
  function stepSummary(s) {
    return ({
      email: () => (tplName(s.template_id) ? `"${tplName(s.template_id)}"` : 'Choose an email'),
      text: () => (tplName(s.template_id) ? `"${tplName(s.template_id)}" · you tap Send` : 'Choose a message'),
      alert: () => s.message || s.title || '',
      task: () => `${s.title || 'Name the task'}${Number(s.due_days) ? ` · due in ${plural(Number(s.due_days), 'day')}` : ' · due today'}`,
      stage: () => (s.stage ? `To "${s.stage}"` : 'Choose a stage'),
      group: () => (s.group ? `"${s.group}"` : 'Choose a group'),
      follow_up: () => (Number(s.days) ? `${plural(Number(s.days), 'day')} from then` : 'Same day'),
      note: () => s.note || 'Write a note',
      wait: () => (s.if_stage ? `Then only if still "${s.if_stage}"` : 'Then carry on no matter what'),
    }[s.type] || (() => ''))();
  }
  const stepTitle = (s) => (s.type === 'wait' ? (Number(s.amount) ? `Wait ${plural(Number(s.amount), (s.unit || 'days').replace(/s$/, ''))}` : 'Wait') : STEP[s.type]?.name || s.type);
  function triggerFilters(t) {
    const f = [];
    if (t.type === 'stage_changed') f.push(`Stage is "${t.stage || '?'}"`);
    if (t.group) f.push(`Group is ${t.group.split(',').map((g) => `"${g.trim()}"`).join(' or ')}`);
    if (t.type !== 'stage_changed' && t.stage) f.push(`While "${t.stage}"`);
    if (t.form) f.push(`Form name has "${t.form}"`);
    if (t.skip_newsletter) f.push('Not newsletter-only');
    return f;
  }
  const blankStep = (type) => ({
    email: { type, template_id: (tpls.find((t) => t.channel === 'email') || {}).id || null },
    text: { type, template_id: (tpls.find((t) => t.channel === 'text') || {}).id || null, title: 'Text {name}' },
    alert: { type, title: 'Viral Touch CRM', message: '{name} needs you' }, task: { type, title: 'Call {name}', due_days: 0 },
    stage: { type, stage: meta.stages[1] || meta.stages[0] }, group: { type, group: meta.groups[0] || '' }, follow_up: { type, days: 2 },
    note: { type, note: '' }, wait: { type, amount: 1, unit: 'days', if_stage: '' },
  }[type]);

  // ================= The list =================
  let listData = null;
  async function render(m) {
    meta = m || meta;
    const box = q$('#wf-root');
    const [data, t] = await Promise.all([call('/automations'), call('/templates')]);
    listData = data; tpls = t;
    const em = data.email;
    const rows = data.automations;
    box.innerHTML = `
      <section class="wf-hero">
        <div class="wf-hero-in">
          <span class="wf-kicker">${ico('spark')} Build it by describing it <b>FREE</b></span>
          <h2>What do you want to automate?</h2>
          <form id="wf-ask" class="wf-ask">
            <textarea name="text" rows="2" placeholder="e.g. When someone fills out a form, send them an email, wait 2 days, then remind me to call them"></textarea>
            <button class="btn primary">${ico('spark')} Build it</button>
          </form>
          <div class="wf-chips">
            <button data-say="When someone fills out a form, send them an email, wait 2 days, then remind me to call them">Lead follow-up</button>
            <button data-say="When someone books an appointment, move them to Interested, make a task to get ready and buzz my phone">Appointment booked</button>
            <button data-say="When a sponsor moves to Paid, make a task to send a thank you and buzz my phone">Sponsor thank-you</button>
            <button data-say="When someone subscribes to email, send them an email, wait 2 days, then send another email">Welcome emails</button>
            <button data-say="When a contact moves to Contacted, wait 3 days if still Contacted, then text them">No reply? Text them</button>
          </div>
          <div class="wf-or"><span>or</span></div>
          <div class="row"><button class="btn wf-light" id="wf-lib">${ico('grid')} Ready-made workflows</button><button class="btn wf-light" id="wf-new">${ico('plus')} Start from scratch</button></div>
        </div>
      </section>
      <div class="wf-email ${em.ready ? 'ok' : ''}">${ico('mail')}<div>${em.ready
        ? `<b>Emails are on.</b> "Send email" steps go out from ${h(em.from)}. ${em.sentToday} sent in the last day (limit ${em.limit}). Only to people who contacted you or said yes to email, with your address and an unsubscribe line.`
        : '<b>Emails are off</b> until you connect your email. In Terminal run <code>cd ~/social-scheduler && npm run email-setup</code>. Until then, "Send email" steps are skipped and everything else still runs.'}</div></div>
      <div class="wf-list-head"><h2>Workflows <small>${rows.length}</small></h2></div>
      <div class="wf-table" role="table">
        <div class="wf-tr wf-th" role="row"><span>Name</span><span>Status</span><span>Total enrolled</span><span>Waiting now</span><span>Last run</span><span></span></div>
        ${rows.map((a) => `<button class="wf-tr" data-open="${a.id}" role="row">
          <span class="wf-name"><span class="wf-tico">${ico(TRIG[a.trigger.type]?.icon || 'flag')}</span><span><b>${h(a.name)}</b><small>${h(TRIG[a.trigger.type]?.name || '')} · ${plural(a.steps.length, 'step')}${a.problems?.length ? ` · <em class="wf-warn-txt">${plural(a.problems.length, 'thing')} to finish</em>` : ''}</small></span></span>
          <span>${a.active ? '<span class="wf-pill pub">Published</span>' : '<span class="wf-pill draft">Draft</span>'}</span>
          <span data-label="Total enrolled">${a.runs}</span><span data-label="Waiting now">${a.waiting}</span>
          <span data-label="Last run" class="muted">${a.last_run_at ? h(when(a.last_run_at)) : 'Not yet'}</span>
          <span class="wf-chev">${ico('chev')}</span></button>`).join('') || '<p class="muted" style="padding:16px">No workflows yet. Describe one above or pick a ready-made one.</p>'}
      </div>
      <details class="wf-recent"><summary>${ico('history')} Recent activity</summary>
        <ul class="wf-log">${logItems(data.log, true)}</ul></details>`;
    box.onclick = async (e) => {
      const say = e.target.closest('[data-say]');
      if (say) { q$('#wf-ask textarea', box).value = say.dataset.say; q$('#wf-ask textarea', box).focus(); return; }
      const open = e.target.closest('[data-open]');
      if (open) return openBuilder(rows.find((a) => a.id === Number(open.dataset.open)));
      if (e.target.closest('#wf-lib')) return openLibrary();
      if (e.target.closest('#wf-new')) return openBuilder({ name: 'New workflow', active: false, trigger: { type: 'contact_added' }, steps: [] });
      const c = e.target.closest('[data-contact]');
      if (c) { e.preventDefault(); window.crmOpenContact?.(Number(c.dataset.contact)); }
    };
    q$('#wf-ask', box).onsubmit = async (e) => {
      e.preventDefault();
      const btn = q$('button', e.target);
      btn.disabled = true;
      try { openBuilder(await call('/automations/suggest', { method: 'POST', json: { text: e.target.text.value } }), { fresh: true }); }
      catch (err) { alert(err.message); } finally { btn.disabled = false; }
    };
  }
  const logItems = (log, withName) => log.map((l) => `<li><span class="wf-dot"></span><div><b>${withName ? h(l.automation_name || 'Deleted workflow') : ''}</b>${withName && l.contact_name ? ' · ' : ''}${l.contact_name ? `<a href="#" data-contact="${l.contact_id}">${h(l.contact_name)}</a>` : ''}
    <span class="muted"> · ${h(when(l.at))}</span><br><span class="muted">${h(l.summary)}</span></div></li>`).join('') || '<li class="muted">Nothing has run yet. Workflows start with the next new lead, form, stage change or booking.</li>';

  // ================= Ready-made workflows =================
  async function openLibrary() {
    const lib = await call('/automations/library');
    const dlg = q$('#wf-library');
    const cats = [...new Set(lib.map((w) => w.category))];
    let cat = '', search = '';
    dlg.innerHTML = `<div class="wf-lib-top"><h1>Ready-made workflows</h1><button class="wf-iconbtn" data-close aria-label="Close">${ico('x')}</button></div>
      <div class="wf-lib-body"><aside class="wf-lib-cats"><button class="on" data-cat="">All <small>${lib.length}</small></button>${cats.map((c) => `<button data-cat="${h(c)}">${h(c)} <small>${lib.filter((w) => w.category === c).length}</small></button>`).join('')}</aside>
      <div class="wf-lib-main"><label class="wf-search">${ico('search')}<input placeholder="Search" id="wf-lib-q"></label><div class="wf-lib-grid" id="wf-lib-grid"></div></div></div>`;
    const draw = () => {
      q$('#wf-lib-grid', dlg).innerHTML = lib.filter((w) => (!cat || w.category === cat) && (!search || `${w.name} ${w.about}`.toLowerCase().includes(search))).map((w) => `
        <div class="wf-lib-card"><div class="wf-mini">
          <span class="wf-mini-trig">${ico(TRIG[w.trigger.type]?.icon)}${h(TRIG[w.trigger.type]?.name)}</span>
          ${w.steps.map((s) => `<i></i><span class="wf-mini-step c-${STEP[s.type].color}">${ico(STEP[s.type].icon)}${h(stepTitle(s))}</span>`).join('')}<i></i><span class="wf-end">END</span></div>
          <div class="wf-lib-txt"><small class="wf-cat">${h(w.category)}</small><b>${h(w.name)}</b><p class="muted">${h(w.about)}</p>
          <button class="btn primary" data-use="${h(w.key)}">Use this</button></div></div>`).join('') || '<p class="muted">Nothing matches.</p>';
    };
    draw();
    dlg.onclick = async (e) => {
      if (e.target.closest('[data-close]') || e.target === dlg) return dlg.close();
      const c = e.target.closest('[data-cat]');
      if (c) { cat = c.dataset.cat; dlg.querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('on', b === c)); draw(); }
      const u = e.target.closest('[data-use]');
      if (u) {
        u.disabled = true;
        try { const a = await call(`/automations/library/${u.dataset.use}`, { method: 'POST' }); dlg.close(); await render(); openBuilder(a); }
        catch (err) { alert(err.message); u.disabled = false; }
      }
    };
    q$('#wf-lib-q', dlg).oninput = (e) => { search = e.target.value.toLowerCase(); draw(); };
    dlg.showModal();
  }

  // ================= The builder =================
  function openBuilder(src, { fresh } = {}) {
    const dlg = q$('#wf-builder');
    let wf = JSON.parse(JSON.stringify(src));
    wf.steps = wf.steps.map(({ problem: _, ...s }) => s);
    let saved = fresh || !wf.id ? null : JSON.stringify(wf);
    let sel = null; // 'trigger' | step index
    let tab = 'builder';
    const dirty = () => JSON.stringify(wf) !== saved;

    dlg.innerHTML = `
      <header class="wf-top">
        <button class="wf-iconbtn" data-close title="Back to workflows">${ico('back')}<span>Workflows</span></button>
        <input class="wf-title" id="wf-name" value="${h(wf.name)}" aria-label="Workflow name">
        <div class="wf-tabs"><button data-tab="builder" class="on">Builder</button><button data-tab="history">History</button></div>
        <div class="wf-top-right">
          <button class="btn ghost" id="wf-test">${ico('play')} Test</button>
          <label class="wf-pub"><span>Draft</span><input type="checkbox" id="wf-active" ${wf.active ? 'checked' : ''}><i></i><span>Publish</span></label>
          <button class="btn primary" id="wf-save">Save</button>
        </div>
      </header>
      <div class="wf-msg" id="wf-msg" hidden></div>
      <div class="wf-body">
        <div class="wf-canvas" id="wf-canvas"></div>
        <aside class="wf-panel" id="wf-panel" hidden></aside>
        <div class="wf-history" id="wf-history" hidden></div>
      </div>
      <div class="wf-pop" id="wf-pop" hidden></div>`;

    const msg = (text, bad) => { const m = q$('#wf-msg', dlg); m.textContent = text; m.className = `wf-msg${bad ? ' bad' : ''}`; m.hidden = !text; };
    const saveState = () => { const b = q$('#wf-save', dlg); b.textContent = dirty() ? 'Save' : 'Saved ✓'; b.classList.toggle('primary', dirty()); };

    function drawCanvas() {
      const t = wf.trigger, tr = TRIG[t.type] || TRIG.contact_added;
      const f = triggerFilters(t);
      const plus = (i) => `<div class="wf-link"><button class="wf-plus" data-add="${i}" title="Add a step here">${ico('plus')}</button></div>`;
      q$('#wf-canvas', dlg).innerHTML = `<div class="wf-flow">
        <button class="wf-trigger ${sel === 'trigger' ? 'sel' : ''}" data-sel="trigger">
          <span class="wf-node-ico c-blue">${ico(tr.icon)}</span>
          <span class="wf-node-txt"><small class="wf-kind">Trigger · When this happens</small><b>${h(tr.name)}</b></span>
          <span class="wf-filters">${f.length ? f.map((x) => `<span>${h(x)}</span>`).join('') : '<span class="muted">No filters: every contact</span>'}</span>
        </button>
        ${plus(0)}
        ${wf.steps.map((s, i) => {
          const p = problem(s), st = STEP[s.type] || STEP.task;
          return `<div class="wf-node ${sel === i ? 'sel' : ''} ${s.type === 'wait' ? 'is-wait' : ''}" data-sel="${i}" role="button" tabindex="0">
            <span class="wf-node-ico c-${st.color}">${ico(st.icon)}</span>
            <span class="wf-node-txt"><small class="wf-kind">Step ${i + 1}</small><b>${h(stepTitle(s))}</b><span class="muted">${h(stepSummary(s))}</span></span>
            <button class="wf-more" data-menu="${i}" title="More">${ico('dots')}</button>
            ${p ? `<span class="wf-bang" title="${h(p)}">!</span>` : ''}
          </div>${plus(i + 1)}`;
        }).join('')}
        <span class="wf-end">END</span>
        ${wf.steps.length ? '' : '<p class="muted wf-hint">Click <b>+</b> to add the first step.</p>'}
      </div>`;
      saveState();
    }

    // ----- side panel -----
    const groupOpts = (cur, any) => `${any ? `<option value="">${any}</option>` : ''}${meta.groups.map((g) => `<option${g === cur ? ' selected' : ''}>${h(g)}</option>`).join('')}`;
    const stageOpts = (cur, any) => `${any ? `<option value="">${any}</option>` : ''}${meta.stages.map((x) => `<option${x === cur ? ' selected' : ''}>${h(x)}</option>`).join('')}`;
    const tplOpts = (channel, cur) => `<option value="">Choose…</option>${tpls.filter((t) => !channel || t.channel === channel).map((t) => `<option value="${t.id}"${t.id === Number(cur) ? ' selected' : ''}>${h(t.name)}</option>`).join('')}`;
    const fills = (k) => `<div class="wf-fills" data-for="${k}">${FILL.map((f) => `<button type="button" data-fill="${f}">${f}</button>`).join('')}</div>`;
    const preview = (id) => { const t = tpls.find((x) => x.id === Number(id)); return t ? `<div class="wf-preview">${t.subject ? `<b>${h(t.subject)}</b>` : ''}<p>${h(t.body).slice(0, 400)}${t.body.length > 400 ? '…' : ''}</p></div>` : ''; };

    function drawPanel() {
      const pan = q$('#wf-panel', dlg);
      if (sel === null) { pan.hidden = true; return; }
      pan.hidden = false;
      if (sel === 'trigger') {
        const t = wf.trigger;
        pan.innerHTML = `<div class="wf-pan-head"><span class="wf-node-ico c-blue">${ico(TRIG[t.type].icon)}</span><div><b>Trigger</b><small>${h(TRIG[t.type].help)}</small></div><button class="wf-iconbtn" data-pclose>${ico('x')}</button></div>
          <div class="wf-pan-body">
            <div class="wf-f"><span>When this happens</span><div class="wf-choices">${Object.entries(TRIG).map(([k, v]) => `<label class="wf-choice ${k === t.type ? 'on' : ''}"><input type="radio" name="ttype" value="${k}" ${k === t.type ? 'checked' : ''}>${ico(v.icon)}<span><b>${h(v.name)}</b><small>${h(v.help)}</small></span></label>`).join('')}</div></div>
            ${t.type === 'stage_changed' ? `<label class="wf-f"><span>Moves to stage</span><select data-t="stage">${stageOpts(t.stage)}</select></label>` : ''}
            <div class="wf-f"><span>Only for these groups <small>(none ticked = every group)</small></span><div class="wf-checks">${meta.groups.map((g) => `<label><input type="checkbox" data-tg="${h(g)}" ${String(t.group || '').split(',').map((x) => x.trim()).includes(g) ? 'checked' : ''}> ${h(g)}</label>`).join('')}</div></div>
            ${t.type !== 'stage_changed' ? `<label class="wf-f"><span>Only while in stage <small>(optional)</small></span><select data-t="stage">${stageOpts(t.stage, 'Any stage')}</select></label>` : ''}
            ${t.type === 'form_filled' ? `<label class="wf-f"><span>Form name has <small>(optional)</small></span><input data-t="form" value="${h(t.form || '')}" placeholder="e.g. sponsor"></label>
              <label class="wf-check"><input type="checkbox" data-t="skip_newsletter" ${t.skip_newsletter ? 'checked' : ''}> Skip people who only signed up for the newsletter</label>` : ''}
          </div>`;
        return;
      }
      const s = wf.steps[sel], st = STEP[s.type];
      const inp = (k, ph = '', type = 'text', extra = '') => `<input data-k="${k}" type="${type}" value="${h(s[k] ?? '')}" placeholder="${h(ph)}" ${extra}>`;
      const body = {
        email: () => `<label class="wf-f"><span>Email to send</span><select data-k="template_id">${tplOpts('email', s.template_id)}</select></label>${preview(s.template_id)}
          <p class="muted small">Make or change emails in <a href="#contacts/templates">Templates</a> or <a href="#contacts/email">Email marketing</a>.</p>`,
        text: () => `<label class="wf-f"><span>Message</span><select data-k="template_id">${tplOpts('', s.template_id)}</select></label>${preview(s.template_id)}
          <label class="wf-f"><span>Task name</span>${inp('title', 'Text {name}')}</label>${fills('title')}
          <p class="muted small">You get a task with this message filled in. Tap it and press Send in Messages. Skipped for "Do not contact" or no phone number.</p>`,
        alert: () => `<label class="wf-f"><span>Title</span>${inp('title', 'Viral Touch CRM')}</label><label class="wf-f"><span>Message</span>${inp('message', '{name} needs a call')}</label>${fills('message')}`,
        task: () => `<label class="wf-f"><span>Task</span>${inp('title', 'Call {name}')}</label>${fills('title')}
          <label class="wf-f"><span>Due</span><span class="wf-inline">in ${inp('due_days', '0', 'number', 'min="0" max="365"')} days <small>(0 = today)</small></span></label>
          <label class="wf-f"><span>Message ready to send <small>(optional)</small></span><select data-k="template_id"><option value="">None</option>${tpls.map((t) => `<option value="${t.id}"${t.id === Number(s.template_id) ? ' selected' : ''}>${h(t.name)}</option>`).join('')}</select></label>`,
        stage: () => `<label class="wf-f"><span>Move to</span><select data-k="stage">${stageOpts(s.stage)}</select></label>`,
        group: () => `<label class="wf-f"><span>Group</span><select data-k="group">${groupOpts(s.group)}</select></label>`,
        follow_up: () => `<label class="wf-f"><span>Next follow-up</span><span class="wf-inline">${inp('days', '0', 'number', 'min="0" max="365"')} days from then</span></label>`,
        note: () => `<label class="wf-f"><span>Note</span><textarea data-k="note" rows="4" placeholder="e.g. Came from the website">${h(s.note || '')}</textarea></label>${fills('note')}`,
        wait: () => `<label class="wf-f"><span>Wait for</span><span class="wf-inline">${inp('amount', '1', 'number', 'min="1"')}<select data-k="unit"><option value="days"${s.unit !== 'hours' ? ' selected' : ''}>days</option><option value="hours"${s.unit === 'hours' ? ' selected' : ''}>hours</option></select></span></label>
          <label class="wf-f"><span>Then keep going</span><select data-k="if_stage">${stageOpts(s.if_stage, 'No matter what')}</select></label>
          <p class="muted small">Pick a stage to stop here if they moved on. Example: "only if still New" stops the reminder once you've reached out.</p>`,
      }[s.type]();
      const p = problem(s);
      pan.innerHTML = `<div class="wf-pan-head"><span class="wf-node-ico c-${st.color}">${ico(st.icon)}</span><div><b>${h(st.name)}</b><small>${h(st.help)}</small></div><button class="wf-iconbtn" data-pclose>${ico('x')}</button></div>
        ${p ? `<div class="wf-pan-warn">${ico('warn')} ${h(p)}</div>` : ''}
        <div class="wf-pan-body">${body}</div>
        <div class="wf-pan-foot"><button class="btn danger" data-del="${sel}">Delete step</button><button class="btn primary" data-pclose>Done</button></div>`;
    }

    // ----- add-step menu -----
    function openPicker(at, anchor) {
      const pop = q$('#wf-pop', dlg);
      const groups = ['Messages', 'Contact', 'Timing'];
      pop.innerHTML = `<div class="wf-pop-head"><b>Add a step</b><button class="wf-iconbtn" data-popclose>${ico('x')}</button></div>${groups.map((g) => `<small class="wf-pop-g">${g}</small>${Object.entries(STEP).filter(([, v]) => v.group === g).map(([k, v]) => `
        <button class="wf-pop-item" data-pick="${k}" data-at="${at}"><span class="wf-node-ico c-${v.color}">${ico(v.icon)}</span><span><b>${h(v.name)}</b><small>${h(v.help)}</small></span></button>`).join('')}`).join('')}`;
      pop.hidden = false;
      const r = anchor.getBoundingClientRect(), W = Math.min(340, window.innerWidth - 24);
      pop.style.width = `${W}px`;
      pop.style.left = `${Math.max(12, Math.min(window.innerWidth - W - 12, r.left + r.width / 2 - W / 2))}px`;
      const below = r.bottom + 8, H = Math.min(pop.scrollHeight, window.innerHeight - 24);
      pop.style.top = `${below + H > window.innerHeight - 12 ? Math.max(12, r.top - H - 8) : below}px`;
    }
    function openMenu(i, anchor) {
      const pop = q$('#wf-pop', dlg);
      pop.innerHTML = `<button class="wf-pop-item small" data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''}>${ico('up')} Move up</button>
        <button class="wf-pop-item small" data-act="down" data-i="${i}" ${i === wf.steps.length - 1 ? 'disabled' : ''}>${ico('down')} Move down</button>
        <button class="wf-pop-item small" data-act="dup" data-i="${i}">${ico('dup')} Duplicate</button>
        <button class="wf-pop-item small bad" data-act="del" data-i="${i}">${ico('trash')} Delete</button>`;
      pop.hidden = false;
      const r = anchor.getBoundingClientRect();
      pop.style.width = '190px';
      pop.style.left = `${Math.min(window.innerWidth - 202, r.right - 190)}px`;
      pop.style.top = `${Math.min(window.innerHeight - 200, r.bottom + 6)}px`;
    }
    const closePop = () => { q$('#wf-pop', dlg).hidden = true; };

    function redraw() { drawCanvas(); drawPanel(); }

    // ----- history -----
    async function drawHistory() {
      const el = q$('#wf-history', dlg);
      if (!wf.id) { el.innerHTML = '<p class="muted">Save this workflow first. Then you\'ll see everyone who went through it here.</p>'; return; }
      el.innerHTML = '<p class="muted">Loading…</p>';
      const d = await call(`/automations/${wf.id}/history`);
      el.innerHTML = `<div class="wf-hist-tiles"><div><small>Total enrolled</small><b>${src.runs || 0}</b></div><div><small>Waiting now</small><b>${d.waiting.length}</b></div><div><small>Last run</small><b class="sm">${src.last_run_at ? h(when(src.last_run_at)) : 'Not yet'}</b></div></div>
        <h3>Waiting now</h3>${d.waiting.length ? `<ul class="wf-log">${d.waiting.map((w) => `<li><span class="wf-dot violet"></span><div><a href="#" data-contact="${w.contact_id}">${h(w.contact_name)}</a> <span class="muted">· goes on to step ${w.next_step + 1} on ${h(when(w.run_at))}${w.if_stage ? ` if still "${h(w.if_stage)}"` : ''}</span></div></li>`).join('')}</ul>` : '<p class="muted">Nobody is waiting right now.</p>'}
        <h3>What happened</h3><ul class="wf-log">${logItems(d.log, false)}</ul>`;
    }

    // ----- test run -----
    async function openTest() {
      const tdlg = q$('#wf-test-dlg');
      tdlg.innerHTML = `<h1>Test this workflow</h1><p class="muted">Pick a contact. You'll see exactly what would happen for them. <b>Nothing is sent or changed.</b></p>
        <label class="wf-search">${ico('search')}<input id="wf-tq" placeholder="Search contacts"></label><div class="wf-tlist" id="wf-tlist"></div><div id="wf-tres"></div>
        <div class="row" style="margin-top:12px"><button class="btn ghost" data-tclose>Close</button></div>`;
      const search = async (q) => {
        const list = await call(`/contacts?q=${encodeURIComponent(q)}`).catch(() => []);
        q$('#wf-tlist', tdlg).innerHTML = (Array.isArray(list) ? list : list.contacts || []).slice(0, 8).map((c) => `<button data-tc="${c.id}"><b>${h(c.name)}</b> <small>${h(c.group_name || '')} · ${h(c.stage || '')}</small></button>`).join('') || '<p class="muted">No contacts found.</p>';
      };
      tdlg.onclick = async (e) => {
        if (e.target.closest('[data-tclose]')) return tdlg.close();
        const b = e.target.closest('[data-tc]');
        if (!b) return;
        try {
          const r = await call('/automations/test', { method: 'POST', json: { automation: wf, contact_id: Number(b.dataset.tc) } });
          q$('#wf-tres', tdlg).innerHTML = `<div class="wf-tres ${r.would_start ? 'ok' : 'no'}"><b>${r.would_start ? `This would start for ${h(r.contact)}.` : `This would not start for ${h(r.contact)}`}</b>${r.why.length ? `<br><span>${h(r.why.join('; '))}</span>` : ''}</div>
            <ol class="wf-tsteps">${r.steps.map((x) => `<li>${h(x)}</li>`).join('')}</ol>`;
        } catch (err) { q$('#wf-tres', tdlg).innerHTML = `<p class="wf-msg bad">${h(err.message)}</p>`; }
      };
      let tm; q$('#wf-tq', tdlg).oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => search(e.target.value), 200); };
      search('');
      tdlg.showModal();
    }

    async function save(active = wf.active) {
      wf.name = q$('#wf-name', dlg).value.trim() || 'New workflow';
      const json = { ...wf, active, steps: wf.steps.map((s) => ({ ...s, template_id: s.template_id ? Number(s.template_id) : null })) };
      try {
        const out = await call(wf.id ? `/automations/${wf.id}` : '/automations', { method: wf.id ? 'PUT' : 'POST', json });
        Object.assign(src, out);
        wf = { ...wf, id: out.id, active: out.active };
        saved = JSON.stringify(wf);
        q$('#wf-active', dlg).checked = out.active;
        msg(out.active ? 'Published. It will run for the next contacts that match.' : 'Saved as a draft. Nothing runs until you switch it to Publish.');
        setTimeout(() => msg(''), 3500);
        render().catch(() => {});
        return true;
      } catch (err) {
        q$('#wf-active', dlg).checked = wf.active;
        msg(err.message, true);
        return false;
      } finally { saveState(); }
    }

    // ----- events -----
    dlg.onclick = async (e) => {
      const t = e.target;
      if (!t.closest('#wf-pop') && !t.closest('[data-add]') && !t.closest('[data-menu]')) closePop();
      if (t.closest('[data-close]')) {
        if (dirty() && !confirm('Leave without saving your changes?')) return;
        return dlg.close();
      }
      const tb = t.closest('[data-tab]');
      if (tb) {
        tab = tb.dataset.tab;
        dlg.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b === tb));
        q$('#wf-canvas', dlg).hidden = tab !== 'builder';
        q$('#wf-panel', dlg).hidden = tab !== 'builder' || sel === null;
        q$('#wf-history', dlg).hidden = tab !== 'history';
        if (tab === 'history') drawHistory();
        return;
      }
      if (t.closest('[data-popclose]')) return closePop();
      const add = t.closest('[data-add]');
      if (add) return openPicker(Number(add.dataset.add), add);
      const menu = t.closest('[data-menu]');
      if (menu) { e.stopPropagation(); return openMenu(Number(menu.dataset.menu), menu); }
      const pick = t.closest('[data-pick]');
      if (pick) { const at = Number(pick.dataset.at); wf.steps.splice(at, 0, blankStep(pick.dataset.pick)); sel = at; closePop(); return redraw(); }
      const act = t.closest('[data-act]');
      if (act && !act.disabled) {
        const i = Number(act.dataset.i);
        if (act.dataset.act === 'up') { [wf.steps[i - 1], wf.steps[i]] = [wf.steps[i], wf.steps[i - 1]]; sel = i - 1; }
        if (act.dataset.act === 'down') { [wf.steps[i + 1], wf.steps[i]] = [wf.steps[i], wf.steps[i + 1]]; sel = i + 1; }
        if (act.dataset.act === 'dup') { wf.steps.splice(i + 1, 0, { ...wf.steps[i] }); sel = i + 1; }
        if (act.dataset.act === 'del') { wf.steps.splice(i, 1); sel = null; }
        closePop(); return redraw();
      }
      const del = t.closest('[data-del]');
      if (del) { wf.steps.splice(Number(del.dataset.del), 1); sel = null; return redraw(); }
      if (t.closest('[data-pclose]')) { sel = null; return redraw(); }
      const fill = t.closest('[data-fill]');
      if (fill) {
        const k = fill.closest('[data-for]').dataset.for;
        const field = q$(`[data-k="${k}"]`, dlg);
        const pos = field.selectionStart ?? field.value.length;
        field.value = field.value.slice(0, pos) + fill.dataset.fill + field.value.slice(field.selectionEnd ?? pos);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.focus();
        return;
      }
      const node = t.closest('[data-sel]');
      if (node) { sel = node.dataset.sel === 'trigger' ? 'trigger' : Number(node.dataset.sel); return redraw(); }
      if (t.closest('#wf-test')) return openTest();
      if (t.closest('#wf-save')) return save();
      const c = t.closest('[data-contact]');
      if (c) { e.preventDefault(); window.crmOpenContact?.(Number(c.dataset.contact)); }
    };
    const onField = (e) => {
      const t = e.target;
      if (t.id === 'wf-name') { wf.name = t.value; return saveState(); }
      if (t.id === 'wf-active') {
        const want = t.checked;
        save(want);
        return;
      }
      if (t.name === 'ttype') { wf.trigger = { type: t.value, group: wf.trigger.group, stage: t.value === 'stage_changed' ? (wf.trigger.stage || meta.stages[2]) : '' }; return redraw(); }
      if (t.dataset.tg !== undefined) {
        wf.trigger.group = [...dlg.querySelectorAll('[data-tg]:checked')].map((x) => x.dataset.tg).join(', ');
        return drawCanvas();
      }
      if (t.dataset.t) {
        wf.trigger[t.dataset.t] = t.type === 'checkbox' ? t.checked : t.value;
        return drawCanvas();
      }
      if (t.dataset.k && typeof sel === 'number') {
        const s = wf.steps[sel];
        s[t.dataset.k] = t.type === 'number' ? (t.value === '' ? '' : Number(t.value)) : t.value;
        drawCanvas();
        if (e.type === 'change') drawPanel(); // shows the email preview / clears the warning
      }
    };
    dlg.oninput = onField;
    dlg.onchange = onField;
    dlg.onkeydown = (e) => { if (e.key === 'Enter' && e.target.matches('.wf-node')) e.target.click(); };
    dlg.addEventListener('cancel', (e) => { if (dirty() && !confirm('Leave without saving your changes?')) e.preventDefault(); });

    redraw();
    if (fresh) msg('Here\'s a draft from your words. Click any box to change it, then Save. It stays a Draft until you switch on Publish.');
    dlg.showModal();
    q$('#wf-canvas', dlg).scrollTop = 0;
  }

  window.VPWorkflows = { render };
})();
