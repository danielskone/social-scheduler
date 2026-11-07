// Viral Touch CRM tab (personal CRM). Loaded before app.js; app.js calls renderContacts(subTab) on #contacts.
(() => {
  const q$ = (s, el = document) => el.querySelector(s);
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (n == null ? '' : Number(n).toLocaleString([], { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
  const todayStr = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const niceDate = (s) => (s ? new Date(`${s}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  const dueClass = (d) => (!d ? '' : d < todayStr() ? 'overdue' : d === todayStr() ? 'due-today' : '');
  async function call(path, opts = {}) {
    if (opts.json) { opts.body = JSON.stringify(opts.json); opts.headers = { 'Content-Type': 'application/json' }; delete opts.json; }
    const res = await fetch(`/api/crm${path}`, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  const say = (msg, err) => { const b = q$('#banner'); b.textContent = msg; b.className = `banner${err ? ' error' : ''}`; b.hidden = !msg; };
  const opt = (list, cur) => list.map((x) => `<option${x === cur ? ' selected' : ''}>${h(x)}</option>`).join('');

  // ---------- Look helpers: icons, avatars, colors ----------
  const ICON = {
    people: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 19.5c.9-3.1 3.2-4.8 6-4.8s5.1 1.7 6 4.8"/><circle cx="17" cy="9.5" r="2.6"/><path d="M16.5 14.8c2.3.2 3.9 1.7 4.5 4.2"/>',
    pipeline: '<rect x="3.5" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="16.5" y="4" width="4" height="7" rx="1.5"/>',
    tasks: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8.5 12 2.5 2.5 5-5"/>',
    appointments: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    forms: '<rect x="5" y="4.5" width="14" height="16" rx="2.5"/><path d="M9 3.5h6v3H9zM8.5 11h7M8.5 15h5"/>',
    templates: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17H6.5A2.5 2.5 0 0 1 4 14.5z"/>',
    email: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
    automations: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
    phone: '<path d="M6.5 3.5h3l1.5 4.2-2 1.3a11 11 0 0 0 6 6l1.3-2 4.2 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2z"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/>',
    money: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.2c-.5-.9-1.6-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2.1 0 3 5.8 1.5 5.8 4.3 0 1.3-1.3 2.1-3 2.1-1.3 0-2.5-.6-3-1.6M12 6v1.8M12 16.3V18"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.8 2.8 5.2-5.6"/>',
    wave: '<path d="M7.5 12.5 5 10a1.6 1.6 0 0 1 2.3-2.3l4.2 4.2M9.5 8.5 7.6 6.6a1.6 1.6 0 0 1 2.3-2.3l5.2 5.2M12.3 6.5a1.6 1.6 0 0 1 2.3-2.3l4.1 4.1a6.5 6.5 0 0 1-9.2 9.2L5.8 13.8"/>',
    party: '<path d="M4 20 8.5 7.5l8 8zM14 4.5c.4 1.4 0 2.4-1 3M19.5 10c-1.4-.4-2.4 0-3 1M17 3.5v1.5M20.5 6.5H19"/>',
  };
  const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name] || ''}</svg>`;
  const STAGE_C = { New: 'var(--st-new)', Contacted: 'var(--st-contacted)', Interested: 'var(--st-interested)', Committed: 'var(--st-committed)', 'Paid / Done': 'var(--st-paid)', 'Not this year': 'var(--st-no)' };
  const stageC = (st) => STAGE_C[st] || 'var(--accent)';
  const stageBadge = (st) => `<span class="stage" style="--c:${stageC(st)}">${h(st)}</span>`;
  const PALETTE = ['#4f46e5', '#db2777', '#0891b2', '#d97706', '#16a34a', '#9333ea', '#dc2626', '#0d9488', '#2563eb', '#c2410c'];
  const colorFor = (str) => { let n = 0; for (const ch of String(str || '')) n = (n * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[n % PALETTE.length]; };
  const groupPill = (g) => `<span class="gpill" style="--c:${colorFor(g)}">${h(g)}</span>`;
  const initials = (name) => String(name || '?').trim().split(/\s+/).filter((w) => /\w/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  const avatar = (name, cls = '') => `<span class="avatar ${cls}" style="--c:${colorFor(name)}">${h(initials(name))}</span>`;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(`vtcrm-${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`vtcrm-${k}`, JSON.stringify(v)); } catch { /* private mode: fine */ } },
  };

  // ---------- Friendly tips (one per tab) ----------
  const TIPS = {
    list: ['people', 'Your address book', 'Everyone you work with lives here: sponsors, parade entries, volunteers and Viral Attraction leads. <b>Click a name</b> to see their notes, history and next follow-up. Use the search box and the group and stage menus to find people fast.',
      'This app never bulk-sends texts, so your accounts can\'t get flagged for spam. Tick "OK to email" only when someone said yes.'],
    pipeline: ['pipeline', 'Where every deal stands', 'Each column is a step, from <b>New</b> to <b>Paid / Done</b>. <b>Drag a card</b> to the next column as things move along. The total under each column adds up the money at that step.',
      'Moving a card can start an automation, like a thank-you task when a sponsor reaches "Paid / Done".'],
    tasks: ['tasks', 'Your to-do list', 'Start each day here. <b>Tick the circle</b> when something is done. Red dates are late, orange ones are due today. When a task has a <b>Write</b> button, it opens a ready-made message in your Mail or Messages app, and you just press Send.'],
    appointments: ['appointments', 'Calls and meetings people booked', 'When someone books a time with you (from your Google booking page or a booking page made here), it shows up here, they\'re added to People, and <b>your iPhone buzzes</b>. Share a booking link below in a post, your bio or a text.'],
    forms: ['forms', 'Sign-up forms', 'A form is a little web page people fill in, like "Become a parade sponsor". <b>Copy its link</b> and put it on a post, your website or a QR code. Every sign-up becomes a contact here and pings your iPhone.'],
    templates: ['templates', 'Messages you send a lot', 'Write a message once, use it again and again. Put <b>{first_name}</b>, <b>{name}</b> or <b>{company}</b> in it and the right details fill in for each person. They open in your own Mail or Messages, one person at a time.'],
    email: ['email', 'Newsletters and email blasts', 'Send one email to many people at once. A <b>campaign</b> is the email, a <b>segment</b> is who gets it, and a <b>design</b> is how it looks. Only people who said yes to email ever get one, and your mailing address and an unsubscribe line are added for you.'],
    automations: ['automations', 'Your helper that works while you\'re busy', 'Each card says <b>When</b> something happens (a new lead, a form, a stage change, a booking) and the <b>steps</b> that follow, like making a task, buzzing your phone or sending a welcome email. They\'re already set up and switched on. Use <b>Turn off</b> to pause one.',
      'Texts are never sent automatically. Emails go out only through "Send email now" steps.'],
  };
  function renderTip(t) {
    const panel = q$(`.crm-panel[data-panel="${t}"]`);
    let el = q$(':scope > .crm-tip', panel);
    const hidden = store.get('tips-hidden', []);
    if (hidden.includes(t)) { if (el) el.remove(); return; }
    if (el) return;
    const [ico, title, text, extra] = TIPS[t];
    el = document.createElement('div');
    el.className = 'crm-tip';
    el.innerHTML = `<div class="crm-tip-ico">${svg(ico)}</div><div class="crm-tip-body"><b class="t">${title}</b>${text}${extra ? `<div class="muted small" style="margin-top:4px">${extra}</div>` : ''}</div>
      <button class="x" title="Hide this tip (bring it back with How it works)" aria-label="Hide tip">×</button>`;
    q$('.x', el).onclick = () => { store.set('tips-hidden', [...new Set([...store.get('tips-hidden', []), t])]); el.remove(); };
    panel.prepend(el);
  }

  // ---------- Guided tour ----------
  const TOUR = [
    { tab: 'list', ico: 'wave', title: 'Welcome to Viral Touch CRM', text: 'This is where you keep track of everyone you work with and what to do next with each of them. This quick tour shows you each part. It takes about a minute.', tryIt: 'Use <b>Next</b> to move along. You can stop any time.' },
    { tab: 'list', ico: 'people', title: 'People', text: 'Your address book. Click anyone to open their card with notes, history and their next follow-up date.', tryIt: 'Try it: press <b>+ Add contact</b> at the top right to add someone new.' },
    { tab: 'pipeline', ico: 'pipeline', title: 'Pipeline', text: 'See where every deal stands, from New to Paid / Done. Drag a card to the next column when things move along.', tryIt: 'Try it: drag a sponsor from "Committed" to "Paid / Done" once they pay.' },
    { tab: 'tasks', ico: 'tasks', title: 'Tasks', text: 'Your to-do list. Many tasks are made for you by automations. Tick the circle when one is done.', tryIt: 'Good habit: check this tab first thing every morning.' },
    { tab: 'appointments', ico: 'appointments', title: 'Appointments', text: 'Calls people booked with you show up here, and your iPhone buzzes when a new one comes in.' },
    { tab: 'forms', ico: 'forms', title: 'Sign-up forms', text: 'Forms people fill in from your posts, website or a QR code. Each sign-up becomes a contact by itself.', tryIt: 'Try it: press <b>Copy link</b> on a form and paste it into your next post.' },
    { tab: 'templates', ico: 'templates', title: 'Message templates', text: 'Messages you send often, written once. {first_name} fills in each person\'s name for you.' },
    { tab: 'email', ico: 'email', title: 'Email marketing', text: 'Send a newsletter to everyone who said yes to email. Pick a design, pick who gets it, then press Send or pick a time.' },
    { tab: 'automations', ico: 'automations', title: 'Automations', text: 'Your helper. When a new lead comes in, it can make a task, buzz your phone or send a welcome email, all by itself. These are already switched on for you.' },
    { tab: 'list', ico: 'party', title: 'You\'re all set!', text: 'Each tab has a short tip at the top if you forget what it\'s for. You can replay this tour any time with <b>How it works</b> at the top.' },
  ];
  const TAB_ROUTE = (t) => (t === 'list' ? '#contacts' : `#contacts/${t}`);
  let tourAt = -1;
  function showTour(i) {
    tourAt = i;
    const box = q$('#crm-coach');
    document.querySelectorAll('#crm-tabs a').forEach((a) => a.classList.remove('tour-glow'));
    if (i < 0 || i >= TOUR.length) { box.hidden = true; tourAt = -1; store.set('tour-done', true); return; }
    const st = TOUR[i];
    if (location.hash !== TAB_ROUTE(st.tab) && !(st.tab === 'list' && location.hash === '#contacts/list')) location.hash = TAB_ROUTE(st.tab);
    const link = q$(`#crm-tabs a[data-tab="${st.tab}"]`);
    if (i > 0 && i < TOUR.length - 1 && link) { link.classList.add('tour-glow'); link.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); }
    const last = i === TOUR.length - 1;
    box.innerHTML = `<button class="skip" data-skip>${last ? 'Close' : 'Skip tour'}</button>
      <div class="crm-coach-head"><div class="crm-coach-ico">${svg(st.ico)}</div><div><div class="step">${i === 0 ? 'Quick tour' : last ? 'Done' : `Step ${i} of ${TOUR.length - 2}`}</div><h3>${st.title}</h3></div></div>
      <p>${st.text}</p>${st.tryIt ? `<div class="try">${st.tryIt}</div>` : ''}
      <div class="nav"><div class="dots">${TOUR.map((_, n) => `<i class="${n === i ? 'on' : ''}"></i>`).join('')}</div>
        ${i > 0 ? '<button class="btn ghost" data-back>Back</button>' : ''}<button class="btn primary" data-next>${i === 0 ? 'Show me' : last ? 'Got it' : 'Next'}</button></div>`;
    box.hidden = false;
    q$('[data-next]', box).onclick = () => showTour(last ? -1 : i + 1);
    q$('[data-skip]', box).onclick = () => showTour(-1);
    const back = q$('[data-back]', box); if (back) back.onclick = () => showTour(i - 1);
    q$('[data-next]', box).focus({ preventScroll: true });
  }
  const startTour = () => { store.set('tips-hidden', []); document.querySelectorAll('.crm-panel').forEach((p) => p.dataset.panel in TIPS && renderTip(p.dataset.panel)); showTour(0); };
  q$('#crm-tour').onclick = startTour;
  document.addEventListener('keydown', (e) => { if (tourAt >= 0 && e.key === 'Escape') showTour(-1); });
  window.addEventListener('hashchange', () => { if (tourAt >= 0 && !location.hash.startsWith('#contacts')) { q$('#crm-coach').hidden = true; tourAt = -1; } });

  // ---------- Getting started checklist (People tab) ----------
  async function renderStart() {
    const box = q$('#crm-start');
    if (store.get('start-hidden', false)) { box.innerHTML = ''; return; }
    const [tasks, email] = await Promise.all([call('/tasks').catch(() => []), call('/email').catch(() => null)]);
    const people = meta.summary.total || 0;
    const moved = people && (await call('/contacts').catch(() => [])).some((c) => c.stage !== 'New');
    const steps = [
      ['Take the 1-minute tour', store.get('tour-done', false), startTour],
      ['Add your first contact', people > 0, () => openContact(null)],
      ['Make a task for yourself', tasks.length > 0, () => editTask({})],
      ['Move someone along the pipeline', !!moved, () => { location.hash = '#contacts/pipeline'; }],
      ['Connect your email', !!(email && email.email && email.email.ready), () => { location.hash = '#contacts/email'; }],
    ];
    const done = steps.filter((x) => x[1]).length;
    if (done === steps.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="crm-start"><header><b>Get started</b><div class="bar"><i style="width:${Math.round((done / steps.length) * 100)}%"></i></div>
      <span class="muted small">${done} of ${steps.length} done</span><button class="x" data-hide>Hide</button></header>
      <ul>${steps.map(([label, ok], n) => `<li class="${ok ? 'done' : ''}"><button data-step="${n}"><span class="dot">${ok ? '✓' : ''}</span><span class="lbl">${label}</span></button></li>`).join('')}</ul></div>`;
    box.onclick = (e) => {
      if (e.target.closest('[data-hide]')) { store.set('start-hidden', true); box.innerHTML = ''; return; }
      const b = e.target.closest('[data-step]'); if (b) steps[Number(b.dataset.step)][2]();
    };
  }

  let meta = { groups: [], stages: [] };
  let tab = 'list';
  let timer;

  async function renderContacts(sub) {
    tab = ['pipeline', 'tasks', 'appointments', 'forms', 'templates', 'automations', 'email'].includes(sub) ? sub : 'list';
    document.querySelectorAll('#crm-tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
    document.querySelectorAll('.crm-panel').forEach((p) => (p.hidden = p.dataset.panel !== tab));
    meta = await call('/meta');
    const fill = (sel, items, label) => {
      const el = q$(sel), cur = el.value;
      el.innerHTML = `<option value="">${label}</option>` + items.map((g) => `<option${g === cur ? ' selected' : ''}>${h(g)}</option>`).join('');
    };
    fill('#crm-group', meta.groups, 'All groups');
    fill('#pipe-group', meta.groups, 'All groups');
    fill('#crm-stage', meta.stages, 'All stages');
    const s = meta.summary;
    q$('#crm-tiles').innerHTML = [
      ['Contacts', s.total, 'people', '#4f46e5'], ['To-dos due', s.due + s.tasksDue, 'bell', '#d97706'], ['Committed (not paid yet)', money(s.pledged), 'pipeline', '#9333ea'],
      ['Paid', money(s.paid), 'money', '#16a34a'], ['OK to email', s.emailable, 'email', '#db2777'],
    ].map(([l, v, ico, c]) => `<div class="tile"><div class="tile-ico" style="--c:${c}">${svg(ico)}</div><div><div class="label">${l}</div><div class="value">${v ?? 0}</div></div></div>`).join('');
    renderTip(tab);
    if (!store.get('tour-done', false) && tourAt < 0) setTimeout(() => showTour(0), 400);
    await ({ list: renderList, pipeline: renderBoard, tasks: renderTasks, appointments: renderAppointments, forms: renderForms, templates: renderTemplates, automations: renderAutomations, email: renderEmail }[tab])();
  }
  window.renderContacts = renderContacts;
  const refresh = () => renderContacts(tab);

  // ---------- People ----------
  async function renderList() {
    const p = new URLSearchParams();
    if (q$('#crm-q').value.trim()) p.set('q', q$('#crm-q').value.trim());
    if (q$('#crm-group').value) p.set('group', q$('#crm-group').value);
    if (q$('#crm-stage').value) p.set('stage', q$('#crm-stage').value);
    if (q$('#crm-due').checked) p.set('due', '1');
    const rows = await call(`/contacts?${p}`);
    q$('#crm-table tbody').innerHTML = rows.map((c) => `<tr data-id="${c.id}">
      <td><div class="crm-person">${avatar(c.name)}<div class="who"><b>${h(c.name)}</b>${c.company && c.company !== c.name ? `<div class="muted">${h(c.company)}</div>` : ''}${c.do_not_contact ? '<div><span class="pill off">Do not contact</span></div>' : ''}</div></div></td>
      <td>${groupPill(c.group_name)}</td>
      <td>${stageBadge(c.stage)}</td>
      <td><b>${money(c.amount)}</b></td>
      <td><div class="crm-acts">${c.phone ? `<a class="crm-act" href="tel:${h(c.phone)}" title="Call ${h(c.phone)}">${svg('phone')}<span>${h(c.phone)}</span></a>` : ''}${c.email ? `<a class="crm-act" href="mailto:${h(c.email)}" title="${c.email_ok ? 'Said yes to email' : 'Email'}">${svg('email')}<span>${h(c.email)}</span>${c.email_ok ? '<span class="ok">✓</span>' : ''}</a>` : ''}</div></td>
      <td><span class="due ${dueClass(c.next_follow_up)}">${c.next_follow_up ? (dueClass(c.next_follow_up) === 'overdue' ? 'Late · ' : dueClass(c.next_follow_up) === 'due-today' ? 'Today · ' : '') + niceDate(c.next_follow_up) : '<span class="muted">—</span>'}</span></td>
    </tr>`).join('') || `<tr><td colspan="6" class="crm-empty muted">${meta.summary.total ? '<span class="big">🔍</span>Nobody matches that search. Try fewer words or pick "All groups".' : '<span class="big">👋</span><b>No contacts yet.</b><br>Press "+ Add contact", bring in a spreadsheet with "Import CSV", or share a sign-up form.'}</td></tr>`;
    renderStart();
  }
  q$('#crm-q').oninput = () => { clearTimeout(timer); timer = setTimeout(renderList, 200); };
  ['#crm-group', '#crm-stage', '#crm-due'].forEach((s) => (q$(s).onchange = renderList));
  q$('#crm-table tbody').onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && !e.target.closest('a')) openContact(Number(tr.dataset.id)); };
  q$('#crm-add').onclick = () => openContact(null);
  q$('#crm-task-add').onclick = () => editTask({});

  q$('#crm-import').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    say(`Importing ${file.name}…`);
    try {
      const r = await call('/import', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: await file.text() });
      say(`Imported ${r.imported} contact(s)${r.skipped ? `, skipped ${r.skipped} already here (same email)` : ''}.${r.errors.length ? ' Problems: ' + r.errors.join('; ') : ''}`, r.errors.length > 0);
      refresh();
    } catch (err) { say(err.message, true); }
  };

  // ---------- Pipeline board ----------
  async function renderBoard() {
    const group = q$('#pipe-group').value;
    const rows = await call(`/contacts${group ? `?group=${encodeURIComponent(group)}` : ''}`);
    q$('#pipe-board').innerHTML = meta.stages.map((st) => {
      const cards = rows.filter((c) => c.stage === st);
      const total = cards.reduce((n, c) => n + (c.amount || 0), 0);
      return `<div class="col" data-stage="${h(st)}" style="--c:${stageC(st)}"><h3>${h(st)}</h3><div class="muted">${cards.length} ${cards.length === 1 ? 'person' : 'people'} · ${money(total)}</div>
        ${cards.map((c) => `<div class="card" draggable="true" data-id="${c.id}"><div class="top">${avatar(c.company || c.name, 'sm')}<div><b>${h(c.company || c.name)}</b>
          ${c.company && c.company !== c.name ? `<div class="muted small">${h(c.name)}</div>` : ''}</div></div>
          ${c.amount ? `<div class="amt">${money(c.amount)}</div>` : ''}
          <div class="meta">${groupPill(c.group_name)}${c.next_follow_up ? ` <span class="${dueClass(c.next_follow_up)}">${niceDate(c.next_follow_up)}</span>` : ''}</div></div>`).join('') || '<div class="empty-col">Drag a card here</div>'}
      </div>`;
    }).join('');
  }
  q$('#pipe-group').onchange = renderBoard;
  const board = q$('#pipe-board');
  board.addEventListener('dragstart', (e) => { const c = e.target.closest('.card'); if (c) e.dataTransfer.setData('text/plain', c.dataset.id); });
  board.addEventListener('dragover', (e) => { const col = e.target.closest('.col'); if (col) { e.preventDefault(); col.classList.add('over'); } });
  board.addEventListener('dragleave', (e) => { const col = e.target.closest('.col'); if (col && !col.contains(e.relatedTarget)) col.classList.remove('over'); });
  board.addEventListener('drop', async (e) => {
    const col = e.target.closest('.col');
    if (!col) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    try { await call(`/contacts/${id}`, { method: 'PUT', json: { stage: col.dataset.stage } }); } catch (err) { say(err.message, true); }
    refresh();
  });
  board.addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) openContact(Number(c.dataset.id)); });

  // ---------- Tasks ----------
  const taskRow = (t, showWho = true) => `<li class="${t.done_at ? 'done' : ''}" data-task="${t.id}">
    <input type="checkbox" data-done ${t.done_at ? 'checked' : ''} title="Mark done">
    <span class="title">${h(t.title)}${showWho && t.contact_name ? ` <a href="#" data-open="${t.contact_id}" class="muted">· ${h(t.contact_name)}</a>` : ''}</span>
    ${t.template_id && t.contact_id && !t.done_at ? `<button class="btn ghost" data-write title="Opens a filled-in message for just this person in your Mail or Messages app. You press Send." style="padding:3px 10px;font-size:.85rem">Write "${h(t.template_name)}"</button>` : ''}
    <span class="when-chip ${t.done_at ? 'muted' : dueClass(t.due_on)}">${!t.done_at && dueClass(t.due_on) === 'overdue' ? `Late · ${niceDate(t.due_on)}` : !t.done_at && dueClass(t.due_on) === 'due-today' ? 'Today' : niceDate(t.due_on)}</span>
    <button class="x" data-edit title="Edit">✎</button><button class="x" data-del title="Delete">×</button></li>`;
  async function renderTasks() {
    const tasks = await call(`/tasks${q$('#task-show-done').checked ? '' : '?open=1'}`);
    q$('#task-list').innerHTML = tasks.map((t) => taskRow(t)).join('') || '<li class="muted crm-empty" style="display:block"><span class="big">🎉</span>All caught up! Nothing to do right now. Press "+ Task" at the top to add something.</li>';
  }
  q$('#task-show-done').onchange = renderTasks;
  async function taskClick(e, after) {
    const li = e.target.closest('li[data-task]');
    if (e.target.dataset.open) { e.preventDefault(); return openContact(Number(e.target.dataset.open)); }
    if (!li) return;
    const id = Number(li.dataset.task);
    if ('done' in e.target.dataset) { await call(`/tasks/${id}`, { method: 'PUT', json: { done: e.target.checked } }); after(); }
    if ('del' in e.target.dataset && confirm('Delete this task?')) { await call(`/tasks/${id}`, { method: 'DELETE' }); after(); }
    if ('edit' in e.target.dataset) { const t = (await call('/tasks')).find((x) => x.id === id); editTask(t, after); }
    if ('write' in e.target.dataset) {
      const t = (await call('/tasks')).find((x) => x.id === id);
      try { const m = await call(`/contacts/${t.contact_id}/message`, { method: 'POST', json: { template_id: t.template_id } }); location.href = m.link; }
      catch (err) { say(err.message, true); }
    }
  }
  q$('#task-list').onclick = (e) => taskClick(e, refresh);

  async function editTask(t, after = refresh) {
    const people = await call('/contacts');
    const dlg = q$('#crm-edit-dialog');
    dlg.innerHTML = `<form id="task-form"><h1>${t.id ? 'Edit task' : 'New task'}</h1>
      <label class="field"><span>To do</span><input name="title" required value="${h(t.title)}" placeholder="e.g. Call about sponsor invoice" style="width:100%"></label>
      <label class="field"><span>Due</span><input type="date" name="due_on" value="${h(t.due_on || todayStr())}"></label>
      <label class="field"><span>For</span><select name="contact_id" style="width:100%"><option value="">(nobody in particular)</option>
        ${people.map((p) => `<option value="${p.id}"${p.id === t.contact_id ? ' selected' : ''}>${h(p.name)}${p.company && p.company !== p.name ? ` (${h(p.company)})` : ''}</option>`).join('')}</select></label>
      <div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Cancel</button><span class="muted" id="task-msg"></span></div></form>`;
    q$('[data-close]', dlg).onclick = () => dlg.close();
    q$('#task-form', dlg).onsubmit = async (e) => {
      e.preventDefault();
      try { await call(t.id ? `/tasks/${t.id}` : '/tasks', { method: t.id ? 'PUT' : 'POST', json: Object.fromEntries(new FormData(e.target)) }); dlg.close(); after(); }
      catch (err) { q$('#task-msg', dlg).textContent = err.message; }
    };
    dlg.showModal();
  }

  // ---------- Sign-up forms ----------
  async function renderForms() {
    const [forms, site] = await Promise.all([call('/forms'), call('/website').catch(() => null)]);
    const url = forms[0]?.url || '';
    const note = /localhost|127\.0\.0\.1/.test(url) ? 'Forms only work for other people when the app has a public web address (the same one Instagram uses). Right now it only has this computer\'s address, so wait a minute and refresh.'
      : /trycloudflare\.com/.test(url) ? 'Heads up: these links change whenever your Mac restarts. Copy a fresh link here each time you share one, and update any old posts that use it.' : '';
    const cal = site && site.calendar;
    const calLine = !cal ? '' : cal.connected
      ? `<div class="muted" style="margin-top:6px">📅 <b>Google Calendar bookings</b> also come in (events named "${h(cal.match)}"), with an alert. ${cal.imported} so far.${cal.lastError ? ` <span style="color:var(--bad)">${h(cal.lastError)}</span>` : ''}</div>`
      : '<div class="muted" style="margin-top:6px">📅 Using a Google Calendar booking page? Run <b>npm run calendar</b> so bookings land here too.</div>';
    const siteCard = !site ? '' : `<div class="item" style="grid-column:1/-1">
        <b>Your website's forms</b> ${site.connected ? (site.lastError ? '<span class="pill" style="color:var(--bad)">Problem</span>' : '<span class="pill">Connected</span>') : '<span class="pill">Not set up</span>'}
        ${site.connected
          ? `<div class="muted">Sign-ups from your website land in <b>${h(site.group)}</b> within about 2 minutes, and your phone gets an alert. ${site.imported} so far.${site.lastCheck ? ` Last checked ${h(new Date(site.lastCheck.replace(' ', 'T') + 'Z').toLocaleString())}.` : ''}</div>
            ${site.lastError ? `<div class="muted" style="color:var(--bad)">${h(site.lastError)}</div>` : ''}
            <details style="margin-top:6px"><summary>Code for your website</summary><p class="muted">Paste this once into your website's "custom code" spot for every page (or before &lt;/body&gt;). Your forms keep working as before; this just copies each sign-up here.</p>
            <textarea readonly rows="6" style="width:100%;font:12px ui-monospace,monospace">${h(site.snippet)}</textarea>
            <div class="row"><button class="btn" data-site-copy>Copy code</button></div></details>
            ${calLine}
            <div class="row"><button class="btn ghost" data-site-check>Check now</button><span class="muted" data-site-msg></span></div>`
          : '<div class="muted">Want sign-ups from your website (like viralattraction.com) to show up here by themselves? Follow the steps in <b>website-inbox/README.md</b>, then run <b>npm run website</b> in Terminal.</div>'}
      </div>`;
    q$('#form-list').innerHTML = siteCard + (note ? `<div class="note" style="grid-column:1/-1;max-width:none">${note}</div>` : '')
      + (forms.map((f) => `<div class="item" data-form="${f.id}">
        <b>${h(f.title)}</b> ${f.active ? '' : '<span class="pill" style="color:var(--bad)">Off</span>'}
        <div class="muted">Adds people to <b>${h(f.group_name)}</b> · ${f.submissions} sign-up${f.submissions === 1 ? '' : 's'}</div>
        <div class="linkbox"><input readonly value="${h(f.url)}"><button class="btn" data-copy>Copy link</button></div>
        <div class="row"><a class="btn ghost" href="${h(f.url)}" target="_blank" rel="noopener">Open</a><button class="btn ghost" data-edit>Edit</button><button class="btn danger" data-del>Delete</button></div>
      </div>`).join('') || '<p class="muted">No forms yet. Try one for "Become a parade sponsor" or "Register a parade entry".</p>');
    q$('#form-list').onclick = async (e) => {
      if ('siteCopy' in e.target.dataset) { await navigator.clipboard.writeText(site.snippet).catch(() => {}); e.target.textContent = 'Copied'; return; }
      if ('siteCheck' in e.target.dataset) {
        e.target.disabled = true;
        const r = await call('/website/check', { method: 'POST' }).catch((err) => ({ error: err.message }));
        q$('[data-site-msg]').textContent = r.error ? r.error : `Done: ${r.added || 0} new, ${r.updated || 0} updated, ${r.booked || 0} new bookings.`;
        e.target.disabled = false; return;
      }
      const el = e.target.closest('[data-form]');
      if (!el) return;
      const f = forms.find((x) => x.id === Number(el.dataset.form));
      if ('copy' in e.target.dataset) { await navigator.clipboard.writeText(f.url).catch(() => {}); e.target.textContent = 'Copied'; }
      if ('edit' in e.target.dataset) editForm(f);
      if ('del' in e.target.dataset && confirm(`Delete the form "${f.title}"? The link will stop working. People who already signed up stay in your contacts.`)) { await call(`/forms/${f.id}`, { method: 'DELETE' }); refresh(); }
    };
  }
  q$('#form-add').onclick = () => editForm({ group_name: 'Parade sponsor', ask_company: 1, ask_phone: 1, ask_message: 1, active: 1,
    email_checkbox: 'Yes, email me parade news and updates. I can unsubscribe any time.' });

  function editForm(f) {
    const dlg = q$('#crm-edit-dialog');
    const box = (name, label) => `<label class="check" style="margin:4px 0"><input type="checkbox" name="${name}" ${f[name] ? 'checked' : ''}> ${label}</label>`;
    dlg.innerHTML = `<form id="form-form"><h1>${f.id ? 'Edit form' : 'New sign-up form'}</h1>
      <label class="field"><span>Title</span><input name="title" required value="${h(f.title)}" placeholder="Become a parade sponsor" style="width:100%"></label>
      <label class="field"><span>Short intro <small>(optional)</small></span><textarea name="intro" rows="3">${h(f.intro)}</textarea></label>
      <label class="field"><span>Put new people in group</span><input name="group_name" list="form-groups" value="${h(f.group_name)}" style="width:100%"><datalist id="form-groups">${meta.groups.map((g) => `<option value="${h(g)}">`).join('')}</datalist></label>
      <div class="field"><span>Also ask for</span>${box('ask_company', 'Business or organization')}${box('ask_phone', 'Phone')}${box('ask_message', 'Message')}</div>
      <label class="field"><span>Email permission box <small>(left unchecked for them to tick; leave empty for no box)</small></span><input name="email_checkbox" value="${h(f.email_checkbox)}" style="width:100%"></label>
      <label class="field"><span>Thank-you message <small>(optional)</small></span><textarea name="thank_you" rows="2">${h(f.thank_you)}</textarea></label>
      ${box('active', 'Form is on (people can fill it in)')}
      <div class="row" style="margin-top:12px"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Cancel</button><span class="muted" id="form-msg"></span></div></form>`;
    q$('[data-close]', dlg).onclick = () => dlg.close();
    q$('#form-form', dlg).onsubmit = async (e) => {
      e.preventDefault();
      const fm = e.target, data = Object.fromEntries(new FormData(fm));
      ['ask_company', 'ask_phone', 'ask_message', 'active'].forEach((k) => (data[k] = fm[k].checked));
      try { await call(f.id ? `/forms/${f.id}` : '/forms', { method: f.id ? 'PUT' : 'POST', json: data }); dlg.close(); refresh(); }
      catch (err) { q$('#form-msg', dlg).textContent = err.message; }
    };
    dlg.showModal();
  }

  // ---------- Appointments ----------
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let bookingTz = 'America/New_York';
  const apptWhen = (iso) => new Date(iso).toLocaleString([], { timeZone: bookingTz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  async function renderAppointments() {
    const [{ pages, timezone }, appts] = await Promise.all([call('/booking/pages'), call(`/booking/appointments${q$('#appt-past').checked ? '?past=1' : ''}`)]);
    bookingTz = timezone;
    q$('#appt-list').innerHTML = appts.map((a) => `<li data-appt="${a.id}" class="${a.status === 'cancelled' ? 'done' : ''}">
      <span class="title"><b>${h(apptWhen(a.starts_at))}</b> · ${a.contact_id ? `<a href="#" data-open="${a.contact_id}">${h(a.contact_name)}</a>` : 'Deleted contact'}
        ${a.phone ? ` · <a href="tel:${h(a.phone)}">${h(a.phone)}</a>` : ''}<br><span class="muted">${h(a.title)}${a.note ? ` · "${h(a.note)}"` : ''}${a.status === 'cancelled' ? ' · Cancelled' : ''}</span></span>
      ${a.status === 'booked' && !q$('#appt-past').checked ? '<button class="btn ghost" data-cancel>Cancel</button>' : ''}</li>`).join('')
      || `<li class="muted">${q$('#appt-past').checked ? 'No past appointments.' : 'No upcoming appointments yet. Share a booking link below.'}</li>`;
    q$('#appt-list').onclick = async (e) => {
      if (e.target.dataset.open) { e.preventDefault(); return openContact(Number(e.target.dataset.open)); }
      const li = e.target.closest('[data-appt]');
      if (li && 'cancel' in e.target.dataset && confirm('Cancel this appointment? The time opens up again. Remember to let them know.')) {
        await call(`/booking/appointments/${li.dataset.appt}/cancel`, { method: 'POST' }); refresh();
      }
    };
    const local = /localhost|127\.0\.0\.1/.test(pages[0]?.url || '');
    q$('#bp-list').innerHTML = (local ? '<div class="note" style="grid-column:1/-1;max-width:none">Booking links only work for other people when the app has its public web address. Wait a minute and refresh.</div>'
      : /trycloudflare\.com/.test(pages[0]?.url || '') ? '<div class="note" style="grid-column:1/-1;max-width:none">Heads up: these links change whenever your Mac restarts. Copy a fresh link each time you share one.</div>' : '')
      + (pages.map((p) => `<div class="item" data-bp="${p.id}"><b>${h(p.title)}</b> ${p.active ? '' : '<span class="pill" style="color:var(--bad)">Off</span>'}
        <div class="muted">${p.minutes} min · ${p.days.split(',').map((d) => DAYS[d]).join(', ')} · ${h(p.start_time)}–${h(p.end_time)} · ${p.upcoming} upcoming</div>
        <div class="linkbox"><input readonly value="${h(p.url)}"><button class="btn" data-copy>Copy link</button></div>
        <div class="row"><a class="btn ghost" href="${h(p.url)}" target="_blank" rel="noopener">Open</a><button class="btn ghost" data-edit>Edit</button><button class="btn danger" data-del>Delete</button></div></div>`).join('')
      || '<p class="muted">No booking pages yet.</p>');
    q$('#bp-list').onclick = async (e) => {
      const el = e.target.closest('[data-bp]');
      if (!el) return;
      const p = pages.find((x) => x.id === Number(el.dataset.bp));
      if ('copy' in e.target.dataset) { await navigator.clipboard.writeText(p.url).catch(() => {}); e.target.textContent = 'Copied'; }
      if ('edit' in e.target.dataset) editBookingPage(p);
      if ('del' in e.target.dataset && confirm(`Delete "${p.title}"? The link stops working. Booked appointments stay.`)) { await call(`/booking/pages/${p.id}`, { method: 'DELETE' }); refresh(); }
    };
  }
  q$('#appt-past').onchange = renderAppointments;
  q$('#bp-add').onclick = () => editBookingPage({ minutes: 30, days: '1,2,3,4,5', start_time: '09:00', end_time: '17:00', days_ahead: 30, notice_hours: 2, active: 1, group_name: 'Other',
    email_checkbox: 'Yes, email me updates. I can unsubscribe any time.' });

  function editBookingPage(p) {
    const dlg = q$('#crm-edit-dialog');
    const on = p.days.split(',');
    dlg.innerHTML = `<form id="bp-form"><h1>${p.id ? 'Edit booking page' : 'New booking page'}</h1>
      <label class="field"><span>Title</span><input name="title" required value="${h(p.title)}" placeholder="Book a test drive" style="width:100%"></label>
      <label class="field"><span>Short intro <small>(optional)</small></span><textarea name="intro" rows="3">${h(p.intro)}</textarea></label>
      <label class="field"><span>Where <small>(address or "Phone call"; optional)</small></span><input name="location" value="${h(p.location)}" style="width:100%"></label>
      <div class="field"><span>Days open</span><div class="row">${DAYS.map((d, i) => `<label class="check"><input type="checkbox" name="day" value="${i}" ${on.includes(String(i)) ? 'checked' : ''}> ${d}</label>`).join('')}</div></div>
      <div class="row">
        <label class="field"><span>Opens</span><input type="time" name="start_time" value="${h(p.start_time)}" required></label>
        <label class="field"><span>Closes</span><input type="time" name="end_time" value="${h(p.end_time)}" required></label>
        <label class="field"><span>Length (minutes)</span><input type="number" name="minutes" min="5" max="480" step="5" value="${h(p.minutes)}" required style="width:110px"></label>
      </div>
      <div class="row">
        <label class="field"><span>Book up to (days ahead)</span><input type="number" name="days_ahead" min="1" max="365" value="${h(p.days_ahead)}" style="width:110px"></label>
        <label class="field"><span>Earliest booking (hours from now)</span><input type="number" name="notice_hours" min="0" max="720" value="${h(p.notice_hours)}" style="width:110px"></label>
      </div>
      <label class="field"><span>Put new people in group</span><input name="group_name" list="bp-groups" value="${h(p.group_name)}" style="width:100%"><datalist id="bp-groups">${meta.groups.map((g) => `<option value="${h(g)}">`).join('')}</datalist></label>
      <label class="field"><span>Email permission box <small>(starts unticked; leave empty for no box)</small></span><input name="email_checkbox" value="${h(p.email_checkbox)}" style="width:100%"></label>
      <label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Page is on (people can book)</label>
      <div class="row" style="margin-top:12px"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Cancel</button><span class="muted" id="bp-msg"></span></div></form>`;
    q$('[data-close]', dlg).onclick = () => dlg.close();
    q$('#bp-form', dlg).onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, data = Object.fromEntries(new FormData(f));
      data.days = [...f.querySelectorAll('[name=day]:checked')].map((x) => x.value).join(',');
      delete data.day;
      data.active = f.active.checked;
      try { await call(p.id ? `/booking/pages/${p.id}` : '/booking/pages', { method: p.id ? 'PUT' : 'POST', json: data }); dlg.close(); refresh(); }
      catch (err) { q$('#bp-msg', dlg).textContent = err.message; }
    };
    dlg.showModal();
  }

  // ---------- Message templates ----------
  async function renderTemplates() {
    const list = await call('/templates');
    q$('#tpl-list').innerHTML = list.map((t) => `<div class="item" data-tpl="${t.id}">
      <b>${h(t.name)}</b> <span class="pill">${t.channel === 'text' ? 'Text' : 'Email'}</span>
      ${t.subject ? `<div class="muted">Subject: ${h(t.subject)}</div>` : ''}<p>${h(t.body)}</p>
      <div class="row"><button class="btn ghost" data-edit>Edit</button><button class="btn danger" data-del>Delete</button></div></div>`).join('') || '<p class="muted">No templates yet.</p>';
    q$('#tpl-list').onclick = async (e) => {
      const el = e.target.closest('[data-tpl]');
      if (!el) return;
      const t = list.find((x) => x.id === Number(el.dataset.tpl));
      if ('edit' in e.target.dataset) editTemplate(t);
      if ('del' in e.target.dataset && confirm(`Delete "${t.name}"?`)) { await call(`/templates/${t.id}`, { method: 'DELETE' }); refresh(); }
    };
  }
  q$('#tpl-add').onclick = () => editTemplate({ channel: 'email' });

  function editTemplate(t) {
    const dlg = q$('#crm-edit-dialog');
    dlg.classList.add('wide');
    dlg.innerHTML = `<form id="tpl-form"><h1>${t.id ? 'Edit template' : 'New template'}</h1>
      <div class="tpl-grid"><div>
      <label class="field"><span>Name</span><input name="name" required value="${h(t.name)}" style="width:100%"></label>
      <label class="field"><span>Type</span><select name="channel"><option value="email"${t.channel !== 'text' ? ' selected' : ''}>Email</option><option value="text"${t.channel === 'text' ? ' selected' : ''}>Text message</option></select></label>
      <label class="field" data-em><span>Subject</span><input name="subject" value="${h(t.subject)}" style="width:100%"></label>
      <label class="field" data-em><span>Preview line <small>(shown next to the subject in the inbox; optional)</small></span><input name="preheader" value="${h(t.preheader)}" style="width:100%"></label>
      <label class="field" data-em><span>Big heading <small>(optional)</small></span><input name="heading" value="${h(t.heading)}" style="width:100%"></label>
      <label class="field" data-em><span>Picture web address <small>(https://…, optional; right-click a picture on your website > Copy image address)</small></span><input name="image_url" value="${h(t.image_url)}" style="width:100%"></label>
      <label class="field"><span>Message <small>{first_name}, {name}, {company} are filled in. **bold** works. Leave a blank line between paragraphs.</small></span><textarea name="body" rows="9" required>${h(t.body)}</textarea></label>
      <div class="row" data-em>
        <label class="field"><span>Button text <small>(optional)</small></span><input name="button_text" value="${h(t.button_text)}" placeholder="Book a free call"></label>
        <label class="field" style="flex:1"><span>Button link</span><input name="button_url" value="${h(t.button_url)}" placeholder="https://viralattraction.com" style="width:100%"></label>
      </div>
      </div><div data-em><div class="muted small">Preview (with a sample name)</div><iframe id="tpl-preview" title="Email preview" style="width:100%;height:520px;border:1px solid var(--line);border-radius:10px;background:#f3f4f8"></iframe></div></div>
      <div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Cancel</button><span class="muted" id="tpl-msg"></span></div></form>`;
    const form = q$('#tpl-form', dlg);
    let pt;
    const preview = () => {
      const data = Object.fromEntries(new FormData(form));
      dlg.querySelectorAll('[data-em]').forEach((el) => (el.hidden = data.channel !== 'email'));
      if (data.channel !== 'email') return;
      clearTimeout(pt);
      pt = setTimeout(async () => {
        const res = await fetch('/api/crm/email/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).catch(() => null);
        if (res && res.ok) q$('#tpl-preview', dlg).srcdoc = await res.text();
      }, 250);
    };
    form.addEventListener('input', preview); preview();
    q$('[data-close]', dlg).onclick = () => dlg.close();
    dlg.onclose = () => dlg.classList.remove('wide');
    form.onsubmit = async (e) => {
      e.preventDefault();
      try { await call(t.id ? `/templates/${t.id}` : '/templates', { method: t.id ? 'PUT' : 'POST', json: Object.fromEntries(new FormData(e.target)) }); dlg.close(); refresh(); }
      catch (err) { q$('#tpl-msg', dlg).textContent = err.message; }
    };
    dlg.showModal();
  }

  // ---------- Email marketing ----------
  const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
  const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  const STATUS = { draft: 'Draft', sending: 'Sending…', scheduled: 'Scheduled', sent: 'Sent', failed: 'Problem' };
  async function renderEmail() {
    const [d, tpls, autos] = await Promise.all([call('/email'), call('/templates'), call('/automations')]);
    const o = d.overview, em = d.email;
    q$('#em-tiles').innerHTML = [['Subscribers', o.subscribers], ['New in 30 days', o.newSubs], ['Campaigns sent', o.campaignsSent], ['Flow emails (30 days)', o.flowEmails],
      ['Open rate', pct(o.openRate)], ['Click rate', pct(o.clickRate)], ['Unsubscribes', o.unsubscribed]]
      .map(([l, v]) => `<div class="tile"><div class="label">${l}</div><div class="value">${v ?? 0}</div></div>`).join('');
    q$('#em-setup').innerHTML = !em.ready ? `<div class="note" style="max-width:none">Email is not connected yet, so nothing can be sent. To send from your own email (like your viralattraction.com address), run this in Terminal: <b>cd ~/social-scheduler && npm run email-setup</b>. You can still build designs, segments and campaigns now.</div>`
      : `<p class="muted small">Sending from <b>${h(em.from)}</b>${em.provider === 'mailbox' ? ` (your own mailbox). Up to ${em.limit} emails a day; bigger campaigns carry on the next day by themselves. Your Mac needs to be on while a campaign goes out. "Unsubscribe" replies are turned into "Do not contact" every hour.` : ' through Brevo.'} ${em.sentToday} sent in the last day.</p>`;
    const emailTpls = tpls.filter((t) => t.channel === 'email');
    const statBar = (c) => (c.mailbox ? `<div class="muted small">Sent ${c.mailbox.sent} of ${c.recipients}${c.mailbox.failed ? ` · ${c.mailbox.failed} failed` : ''}${c.status === 'sending' ? ' · still going out' : ''}</div>` : c.stats ? `<div class="muted small">Delivered ${c.stats.delivered} · Opened ${c.stats.opened} (${pct(c.stats.delivered ? c.stats.opened / c.stats.delivered : null)}) · Clicked ${c.stats.clicked} (${pct(c.stats.delivered ? c.stats.clicked / c.stats.delivered : null)}) · Unsubscribed ${c.stats.unsubscribed}${c.stats.bounced ? ` · Bounced ${c.stats.bounced}` : ''}</div>` : '');
    q$('#em-campaigns').innerHTML = d.campaigns.map((c) => `<div class="item" data-camp="${c.id}">
      <b>${h(c.name)}</b> <span class="pill"${c.status === 'failed' ? ' style="color:var(--bad)"' : ''}>${STATUS[c.status] || h(c.status)}</span>
      <div class="muted">${h(c.template_name || 'No design yet')} → ${h(c.segment_name || 'nobody picked yet')}</div>
      <div class="muted small">${c.status === 'sent' ? `Sent ${when(c.sent_at)} to ${c.recipients}` : c.status === 'scheduled' ? `Goes out ${when(c.send_at)} to ${c.recipients}` : c.send_at ? `Will go out ${when(c.send_at)}` : 'Sends as soon as you press Send'}</div>
      ${statBar(c)}${c.error ? `<div class="muted small" style="color:var(--bad)">${h(c.error)}</div>` : ''}
      <div class="row">${['draft', 'failed'].includes(c.status) ? `<button class="btn primary" data-send>${c.send_at ? 'Schedule' : 'Send'}</button><button class="btn ghost" data-edit>Edit</button>` : ''}
        <button class="btn ghost" data-copy>Copy</button>${['draft', 'failed'].includes(c.status) ? '<button class="btn danger" data-del>Delete</button>' : ''}</div></div>`).join('')
      || '<p class="muted">No campaigns yet. Click "+ New campaign".</p>';
    const flows = autos.automations.filter((a) => a.steps.some((s) => s.type === 'email'));
    q$('#em-flows').innerHTML = flows.map((a) => `<div class="item"><b>${h(a.name)}</b> ${a.active ? '<span class="pill">On</span>' : '<span class="pill" style="color:var(--bad)">Off</span>'}
      <div class="muted small">${a.steps.filter((s) => s.type === 'email').length} email${a.steps.filter((s) => s.type === 'email').length === 1 ? '' : 's'} · ran ${a.runs} time${a.runs === 1 ? '' : 's'}</div>
      <ol style="margin:6px 0 0 18px;padding:0">${a.steps.filter((s) => s.type === 'email' || s.type === 'wait').map((s) => `<li class="small">${s.type === 'wait' ? `wait ${s.amount} ${s.unit}` : h((tpls.find((t) => t.id === s.template_id) || {}).subject || 'email')}</li>`).join('')}</ol></div>`).join('')
      || '<p class="muted">No email flows yet.</p>';
    q$('#em-segments').innerHTML = d.segments.map((s) => `<div class="item" data-seg="${s.id}"><b>${h(s.name)}</b> <span class="pill">${s.count} ${s.count === 1 ? 'person' : 'people'}</span>
      <div class="muted small">${s.groups.length ? `Groups: ${h(s.groups.join(', '))}` : 'All groups'}${s.stages.length ? ` · Stages: ${h(s.stages.join(', '))}` : ''}${s.joined_days ? ` · Said yes in the last ${s.joined_days} days` : ''}</div>
      <div class="row"><button class="btn ghost" data-people>See who</button><button class="btn ghost" data-edit>Edit</button><button class="btn danger" data-del>Delete</button></div><div data-list></div></div>`).join('');
    q$('#em-designs').innerHTML = emailTpls.map((t) => `<div class="item" data-tpl="${t.id}"><b>${h(t.name)}</b><div class="muted small">Subject: ${h(t.subject || t.name)}</div>
      <iframe loading="lazy" src="/api/crm/email/preview/${t.id}" title="Preview" style="width:100%;height:220px;border:1px solid var(--line);border-radius:8px;pointer-events:none;background:#f3f4f8"></iframe>
      <div class="row"><button class="btn ghost" data-edit>Edit</button></div></div>`).join('');

    q$('#em-campaigns').onclick = async (e) => {
      const el = e.target.closest('[data-camp]'); if (!el) return;
      const c = d.campaigns.find((x) => x.id === Number(el.dataset.camp));
      try {
        if ('edit' in e.target.dataset) editCampaign(c, d, emailTpls);
        if ('copy' in e.target.dataset) { await call(`/email/campaigns/${c.id}/copy`, { method: 'POST' }); refresh(); }
        if ('del' in e.target.dataset && confirm(`Delete "${c.name}"?`)) { await call(`/email/campaigns/${c.id}`, { method: 'DELETE' }); refresh(); }
        if ('send' in e.target.dataset) {
          const seg = d.segments.find((s) => s.id === c.segment_id);
          if (!confirm(`${c.send_at ? `Schedule "${c.name}" for ${when(c.send_at)}` : `Send "${c.name}" now`} to ${seg ? `${seg.count} people in "${seg.name}"` : 'this segment'}? This can't be undone.`)) return;
          e.target.disabled = true; e.target.textContent = 'Sending…';
          await call(`/email/campaigns/${c.id}/send`, { method: 'POST' }); say(em.provider === 'mailbox' ? (c.send_at ? 'Scheduled. It goes out at that time (keep your Mac on).' : 'Sending now, a few seconds apart. Refresh to see progress.') : c.send_at ? 'Scheduled. Brevo will send it at that time, even if your Mac is off.' : 'Sent! Stats show up within an hour (or press Refresh stats).'); refresh();
        }
      } catch (err) { say(err.message, true); refresh(); }
    };
    q$('#em-segments').onclick = async (e) => {
      const el = e.target.closest('[data-seg]'); if (!el) return;
      const s = d.segments.find((x) => x.id === Number(el.dataset.seg));
      if ('edit' in e.target.dataset) editSegment(s, d);
      if ('del' in e.target.dataset && confirm(`Delete the segment "${s.name}"? Nobody is removed from your contacts.`)) { await call(`/email/segments/${s.id}`, { method: 'DELETE' }); refresh(); }
      if ('people' in e.target.dataset) {
        const people = await call(`/email/segments/${s.id}/people`);
        q$('[data-list]', el).innerHTML = `<ul class="history">${people.slice(0, 50).map((p) => `<li><a href="#" data-open="${p.id}">${h(p.name)}</a> · ${h(p.email)}</li>`).join('') || '<li class="muted">Nobody yet.</li>'}${people.length > 50 ? `<li class="muted">…and ${people.length - 50} more</li>` : ''}</ul>`;
      }
      if (e.target.dataset.open) { e.preventDefault(); openContact(Number(e.target.dataset.open)); }
    };
    q$('#em-designs').onclick = (e) => { const el = e.target.closest('[data-tpl]'); if (el && 'edit' in e.target.dataset) editTemplate(tpls.find((t) => t.id === Number(el.dataset.tpl))); };
    q$('#em-camp-add').onclick = () => editCampaign({ name: '', template_id: emailTpls[0]?.id, segment_id: d.segments[0]?.id }, d, emailTpls);
    q$('#em-seg-add').onclick = () => editSegment({ name: '', groups: [], stages: [] }, d);
    q$('#em-tpl-add').onclick = () => editTemplate({ channel: 'email', name: '', subject: '', body: 'Hi {first_name},\n\n' });
    q$('#em-refresh').onclick = async () => { try { await call('/email/refresh', { method: 'POST' }); refresh(); } catch (err) { say(err.message, true); } };
  }

  function editCampaign(c, d, emailTpls) {
    const dlg = q$('#crm-edit-dialog');
    const local = (iso) => { if (!iso) return ''; const t = new Date(iso); t.setMinutes(t.getMinutes() - t.getTimezoneOffset()); return t.toISOString().slice(0, 16); };
    dlg.innerHTML = `<form id="camp-form"><h1>${c.id ? 'Edit campaign' : 'New campaign'}</h1>
      <label class="field"><span>Name <small>(just for you)</small></span><input name="name" required value="${h(c.name)}" placeholder="e.g. December newsletter" style="width:100%"></label>
      <label class="field"><span>Email design</span><select name="template_id">${emailTpls.map((t) => `<option value="${t.id}"${t.id === c.template_id ? ' selected' : ''}>${h(t.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Send to</span><select name="segment_id">${d.segments.map((s) => `<option value="${s.id}"${s.id === c.segment_id ? ' selected' : ''}>${h(s.name)} (${s.count})</option>`).join('')}</select></label>
      <label class="field"><span>When <small>(leave empty to send when you press Send)</small></span><input type="datetime-local" name="send_at" value="${local(c.send_at)}"></label>
      <p class="muted small">Only people who said yes to email get it. Your mailing address and a way to unsubscribe are at the bottom of every email.</p>
      <div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Cancel</button><span class="muted" id="camp-msg"></span></div></form>`;
    q$('[data-close]', dlg).onclick = () => dlg.close();
    q$('#camp-form', dlg).onsubmit = async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      data.send_at = data.send_at ? new Date(data.send_at).toISOString() : null;
      try { await call(c.id ? `/email/campaigns/${c.id}` : '/email/campaigns', { method: c.id ? 'PUT' : 'POST', json: data }); dlg.close(); refresh(); }
      catch (err) { q$('#camp-msg', dlg).textContent = err.message; }
    };
    dlg.showModal();
  }

  function editSegment(s, d) {
    const dlg = q$('#crm-edit-dialog');
    const groups = [...new Set([...meta.groups, ...s.groups])];
    dlg.innerHTML = `<form id="seg-form"><h1>${s.id ? 'Edit segment' : 'New segment'}</h1>
      <label class="field"><span>Name</span><input name="name" required value="${h(s.name)}" style="width:100%"></label>
      <div class="field"><span>Groups <small>(none ticked = all groups)</small></span><div class="row">${groups.map((g) => `<label class="check"><input type="checkbox" name="g" value="${h(g)}" ${s.groups.includes(g) ? 'checked' : ''}> ${h(g)}</label>`).join('')}</div></div>
      <div class="field"><span>Stages <small>(none ticked = all stages)</small></span><div class="row">${d.stages.map((g) => `<label class="check"><input type="checkbox" name="st" value="${h(g)}" ${s.stages.includes(g) ? 'checked' : ''}> ${h(g)}</label>`).join('')}</div></div>
      <label class="field"><span>Only people who said yes in the last … days <small>(optional)</small></span><input type="number" name="joined_days" min="1" value="${h(s.joined_days || '')}" style="width:110px"></label>
      <div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Cancel</button><span class="muted" id="seg-msg"></span></div></form>`;
    q$('[data-close]', dlg).onclick = () => dlg.close();
    q$('#seg-form', dlg).onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const json = { name: q$('[name=name]', f).value, joined_days: q$('[name=joined_days]', f).value,
        groups: [...f.querySelectorAll('[name=g]:checked')].map((x) => x.value), stages: [...f.querySelectorAll('[name=st]:checked')].map((x) => x.value) };
      try { await call(s.id ? `/email/segments/${s.id}` : '/email/segments', { method: s.id ? 'PUT' : 'POST', json }); dlg.close(); refresh(); }
      catch (err) { q$('#seg-msg', dlg).textContent = err.message; }
    };
    dlg.showModal();
  }

  // ---------- Automations ----------
  const STEP_NAMES = { alert: 'Buzz my phone', email: 'Send email now', task: 'Make a task', stage: 'Move to stage', group: 'Put in group', follow_up: 'Set next follow-up', note: 'Add a note', wait: 'Wait' };
  const stepText = (s, tpls) => ({
    alert: () => `Buzz my phone: "${s.title}"`,
    email: () => `Send email now: "${(tpls.find((t) => t.id === s.template_id) || {}).name || 'deleted template'}"`,
    task: () => `Make a task: "${s.title}"${s.due_days ? `, due in ${s.due_days} day${s.due_days === 1 ? '' : 's'}` : ''}${s.template_id ? ` with "${(tpls.find((t) => t.id === s.template_id) || {}).name || 'a template'}" ready to send` : ''}`,
    stage: () => `Move to "${s.stage}"`,
    group: () => `Put in group "${s.group}"`,
    follow_up: () => `Set next follow-up ${s.days ? `${s.days} day${s.days === 1 ? '' : 's'} later` : 'for today'}`,
    note: () => `Add a note: "${s.note}"`,
    wait: () => `Wait ${s.amount} ${s.unit}${s.if_stage ? `, then keep going only if still "${s.if_stage}"` : ''}`,
  }[s.type] || (() => s.type))();
  const triggerText = (t, triggers) => `${t.type === 'stage_changed' ? `A contact moves to "${t.stage}"` : triggers[t.type]}${t.group ? ` in group "${t.group}"` : ''}${t.type !== 'stage_changed' && t.stage ? ` while "${t.stage}"` : ''}${t.form ? ` (form name has "${t.form}")` : ''}`;

  async function renderAutomations() {
    const [data, tpls] = await Promise.all([call('/automations'), call('/templates')]);
    const em = data.email;
    const emailCard = `<div class="item" style="grid-column:1/-1"><b>Automatic emails</b> ${em.ready ? '<span class="pill">Connected</span>' : '<span class="pill">Not set up</span>'}
      <div class="muted">${em.ready
        ? `"Send email now" steps go out from <b>${h(em.from)}</b> ${em.provider === 'mailbox' ? '(your own mailbox)' : 'through Brevo'}. ${em.sentToday} sent in the last day (limit ${em.limit}). Emails only go to people who just contacted you or said yes to email, never to "Do not contact", and each one has your address and an unsubscribe line. ${em.provider === 'mailbox' ? '"Unsubscribe" replies are turned into "Do not contact" every hour.' : 'If someone replies "unsubscribe", open them and tick "Do not contact".'}`
        : 'Emails are switched off until you connect your email (like your viralattraction.com address). In Terminal run: <b>cd ~/social-scheduler && npm run email-setup</b>. Until then those steps are skipped and everything else still runs.'}</div>
      ${em.recent.length ? `<details style="margin-top:6px"><summary>Recent emails</summary><ul class="history">${em.recent.map((e) => `<li><b>${h(e.status === 'sent' ? 'Sent' : e.status === 'failed' ? 'Failed' : 'Sending')}</b> · ${h(e.contact_name || e.to_email)} · ${h(e.subject || '')}${e.error ? `<br><span style="color:var(--bad)">${h(e.error)}</span>` : ''}</li>`).join('')}</ul></details>` : ''}</div>`;
    q$('#auto-list').innerHTML = emailCard + data.automations.map((a) => `<div class="item" data-auto="${a.id}">
      <b>${h(a.name)}</b> <div>${a.active ? '<span class="pill on">● On</span>' : '<span class="pill off">Off</span>'}</div>
      <div class="auto-when">${svg('automations')}<div><b>When</b> ${h(triggerText(a.trigger, data.triggers))}</div></div>
      <ol class="auto-steps">${a.steps.map((s) => `<li>${h(stepText(s, tpls))}</li>`).join('')}</ol>
      <div class="muted small">Ran ${a.runs} time${a.runs === 1 ? '' : 's'}${a.waiting ? ` · ${a.waiting} waiting` : ''}${a.last_run_at ? ` · last ${h(new Date(a.last_run_at.replace(' ', 'T') + 'Z').toLocaleString())}` : ''}</div>
      <div class="row"><button class="btn ghost" data-toggle>${a.active ? 'Turn off' : 'Turn on'}</button><button class="btn ghost" data-edit>Edit</button><button class="btn danger" data-del>Delete</button></div>
    </div>`).join('') || '<p class="muted">No automations yet. Click "+ New automation".</p>';
    q$('#auto-log').innerHTML = data.log.map((l) => `<li><b>${h(l.automation_name || 'Deleted automation')}</b>${l.contact_name ? ` · <a href="#" data-open="${l.contact_id}">${h(l.contact_name)}</a>` : ''}
      <span class="muted"> · ${h(new Date(l.at.replace(' ', 'T') + 'Z').toLocaleString())}</span><br>${h(l.summary)}</li>`).join('') || '<li class="muted">Nothing has run yet. Automations start with the next new lead, form, stage change or booking.</li>';
    q$('#auto-log').onclick = (e) => { if (e.target.dataset.open) { e.preventDefault(); openContact(Number(e.target.dataset.open)); } };
    q$('#auto-list').onclick = async (e) => {
      const el = e.target.closest('[data-auto]');
      if (!el) return;
      const a = data.automations.find((x) => x.id === Number(el.dataset.auto));
      try {
        if ('toggle' in e.target.dataset) { await call(`/automations/${a.id}`, { method: 'PUT', json: { active: !a.active } }); refresh(); }
        if ('edit' in e.target.dataset) editAutomation(a, data.triggers, tpls);
        if ('del' in e.target.dataset && confirm(`Delete "${a.name}"? Anything it was waiting to do is cancelled. Tasks it already made stay.`)) { await call(`/automations/${a.id}`, { method: 'DELETE' }); refresh(); }
      } catch (err) { say(err.message, true); }
    };
    q$('#auto-add').onclick = () => editAutomation({ name: '', active: true, trigger: { type: 'contact_added' }, steps: [{ type: 'task', title: 'Call {name}', due_days: 0 }] }, data.triggers, tpls);
  }

  function editAutomation(a, triggers, tpls) {
    const dlg = q$('#crm-edit-dialog');
    let steps = a.steps.map((s) => ({ ...s }));
    const stageOpts = (cur, blank) => (blank ? `<option value="">${blank}</option>` : '') + meta.stages.map((x) => `<option${x === cur ? ' selected' : ''}>${h(x)}</option>`).join('');
    const stepFields = (s, i) => {
      const inp = (k, ph = '', type = 'text', extra = '') => `<input data-i="${i}" data-k="${k}" type="${type}" value="${h(s[k] ?? '')}" placeholder="${h(ph)}" ${extra}>`;
      return {
        email: () => `<select data-i="${i}" data-k="template_id">${tpls.filter((t) => t.channel === 'email').map((t) => `<option value="${t.id}"${t.id === Number(s.template_id) ? ' selected' : ''}>${h(t.name)}</option>`).join('')}</select>
          <span class="muted small">Goes out by itself, only to people who contacted you or said yes to email.</span>`,
        alert: () => `${inp('title', 'Alert title', 'text', 'style="width:160px"')} ${inp('message', 'Message, e.g. {name} needs a call', 'text', 'style="flex:1;min-width:180px"')}`,
        task: () => `${inp('title', 'e.g. Call {name}', 'text', 'style="flex:1;min-width:180px"')} <label class="muted">due in ${inp('due_days', '0', 'number', 'min="0" max="365" style="width:64px"')} days</label>
          <select data-i="${i}" data-k="template_id"><option value="">No message</option>${tpls.map((t) => `<option value="${t.id}"${t.id === Number(s.template_id) ? ' selected' : ''}>With message: ${h(t.name)}</option>`).join('')}</select>`,
        stage: () => `<select data-i="${i}" data-k="stage">${stageOpts(s.stage)}</select>`,
        group: () => `<input data-i="${i}" data-k="group" list="auto-groups" value="${h(s.group || '')}" placeholder="Group">`,
        follow_up: () => `<label class="muted">${inp('days', '0', 'number', 'min="0" max="365" style="width:64px"')} days from now</label>`,
        note: () => inp('note', 'Note for their history', 'text', 'style="flex:1;min-width:200px"'),
        wait: () => `${inp('amount', '1', 'number', 'min="1" style="width:64px"')} <select data-i="${i}" data-k="unit"><option value="days"${s.unit !== 'hours' ? ' selected' : ''}>days</option><option value="hours"${s.unit === 'hours' ? ' selected' : ''}>hours</option></select>
          <label class="muted">then keep going <select data-i="${i}" data-k="if_stage">${stageOpts(s.if_stage, 'no matter what')}</select></label>`,
      }[s.type]();
    };
    const drawSteps = () => {
      q$('#auto-steps', dlg).innerHTML = steps.map((s, i) => `<li class="row" style="align-items:center;gap:6px;margin:6px 0">
        <b style="min-width:130px">${i + 1}. ${STEP_NAMES[s.type]}</b> ${stepFields(s, i)}
        <button type="button" class="x" data-up="${i}" title="Move up">↑</button><button type="button" class="x" data-rm="${i}" title="Remove">×</button></li>`).join('');
    };
    const drawTrigger = () => {
      const type = q$('[name=type]', dlg).value;
      q$('#auto-stage-label', dlg).textContent = type === 'stage_changed' ? 'Moves to stage' : 'Only while in stage';
      q$('[name=stage]', dlg).innerHTML = stageOpts(q$('[name=stage]', dlg).value || a.trigger.stage, type === 'stage_changed' ? '' : 'any stage');
      q$('#auto-form-field', dlg).hidden = type !== 'form_filled';
    };
    dlg.innerHTML = `<form id="auto-form"><h1>${a.id ? 'Edit automation' : 'New automation'}</h1>
      <label class="field"><span>Name</span><input name="name" required value="${h(a.name)}" placeholder="e.g. New volunteer: welcome call" style="width:100%"></label>
      <div class="row">
        <label class="field"><span>When</span><select name="type">${Object.entries(triggers).map(([k, v]) => `<option value="${k}"${k === a.trigger.type ? ' selected' : ''}>${h(v)}</option>`).join('')}</select></label>
         <label class="field"><span>In group <small>(several: separate with commas)</small></span><input name="group" list="auto-groups" value="${h(a.trigger.group || '')}" placeholder="any group"></label>
        <label class="field"><span id="auto-stage-label">Stage</span><select name="stage"></select></label>
        <label class="field" id="auto-form-field"><span>Form name has <small>(optional)</small></span><input name="form" value="${h(a.trigger.form || '')}" placeholder="e.g. sponsor">
          <label class="check" style="font-weight:400"><input type="checkbox" name="skip_newsletter" ${a.trigger.skip_newsletter ? 'checked' : ''}> Skip newsletter-only sign-ups</label></label>
      </div>
      <datalist id="auto-groups">${meta.groups.map((g) => `<option value="${h(g)}">`).join('')}</datalist>
      <div class="field"><span>Then do these steps, in order</span><ol id="auto-steps" style="list-style:none;padding:0;margin:0"></ol>
        <div class="row"><select id="auto-step-type">${Object.entries(STEP_NAMES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><button type="button" class="btn ghost" id="auto-step-add">+ Add step</button></div></div>
      <p class="muted small">Fill-ins: {first_name}, {name}, {company}, {email}, {phone}, {group}, {stage}, {form}, {when} (appointment time). Email templates use {first_name}, {name}, {company}. Texts are never sent automatically.</p>
      <label class="check"><input type="checkbox" name="active" ${a.active ? 'checked' : ''}> Automation is on</label>
      <div class="row" style="margin-top:12px"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Cancel</button><span class="muted" id="auto-msg"></span></div></form>`;
    drawTrigger(); drawSteps();
    q$('[name=type]', dlg).onchange = drawTrigger;
    q$('#auto-steps', dlg).addEventListener('input', (e) => { const { i, k } = e.target.dataset; if (k) steps[i][k] = e.target.value; });
    q$('#auto-steps', dlg).addEventListener('change', (e) => { const { i, k } = e.target.dataset; if (k) steps[i][k] = e.target.value; });
    q$('#auto-steps', dlg).onclick = (e) => {
      const { rm, up } = e.target.dataset;
      if (rm != null) { steps.splice(Number(rm), 1); drawSteps(); }
      if (up != null && Number(up) > 0) { const i = Number(up); [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; drawSteps(); }
    };
    q$('#auto-step-add', dlg).onclick = () => {
      const type = q$('#auto-step-type', dlg).value;
      steps.push({ email: { type, template_id: (tpls.find((t) => t.channel === 'email') || {}).id }, alert: { type, title: 'Viral Touch CRM', message: '{name}' }, task: { type, title: '', due_days: 0 }, stage: { type, stage: meta.stages[1] }, group: { type, group: '' },
        follow_up: { type, days: 1 }, note: { type, note: '' }, wait: { type, amount: 1, unit: 'days', if_stage: '' } }[type]);
      drawSteps();
    };
    q$('[data-close]', dlg).onclick = () => dlg.close();
    q$('#auto-form', dlg).onsubmit = async (e) => {
      e.preventDefault();
      const v = (n) => q$(`[name=${n}]`, e.target);
      const json = { name: v('name').value, active: v('active').checked, steps: steps.map((s) => ({ ...s, template_id: s.template_id ? Number(s.template_id) : null })),
        trigger: { type: v('type').value, group: v('group').value, stage: v('stage').value, form: v('form').value, skip_newsletter: v('skip_newsletter').checked } };
      try { await call(a.id ? `/automations/${a.id}` : '/automations', { method: a.id ? 'PUT' : 'POST', json }); dlg.close(); refresh(); }
      catch (err) { q$('#auto-msg', dlg).textContent = err.message; }
    };
    dlg.showModal();
  }

  // ---------- One contact ----------
  async function openContact(id) {
    const c = id ? await call(`/contacts/${id}`) : { group_name: q$('#crm-group').value || 'Parade sponsor', stage: 'New', activities: [], tasks: [] };
    const templates = id ? await call('/templates') : [];
    const dlg = q$('#contact-dialog');
    const field = (name, label, type = 'text', extra = '') => `<label class="field"><span>${label}</span><input type="${type}" name="${name}" value="${h(c[name])}" ${extra}></label>`;
    const usable = templates.filter((t) => (t.channel === 'email' ? c.email : c.phone));
    dlg.innerHTML = `<form method="dialog" id="contact-form">
      <header class="view-head"><h1>${id ? h(c.name) : 'New contact'}</h1><button class="btn ghost" value="cancel" formnovalidate>Close</button></header>
      ${id && !c.do_not_contact && usable.length ? `<div class="send-row"><select id="send-tpl">${usable.map((t) => `<option value="${t.id}">${t.channel === 'text' ? 'Text' : 'Email'}: ${h(t.name)}</option>`).join('')}</select>
        <button class="btn" type="button" id="send-go">Open in Mail / Messages</button><span class="muted small" style="margin:0">Opens a filled-in message for just this person. You press Send.</span></div>` : ''}
      <div class="form-grid">
        ${field('name', 'Name')}
        ${field('company', 'Company / organization')}
        ${field('phone', 'Phone', 'tel')}
        ${field('email', 'Email', 'email')}
        ${field('website', 'Website')}
        ${field('address', 'Address')}
        <label class="field"><span>Group</span><input name="group_name" list="crm-groups" value="${h(c.group_name)}"><datalist id="crm-groups">${meta.groups.map((g) => `<option value="${h(g)}">`).join('')}</datalist></label>
        <label class="field"><span>Stage</span><select name="stage">${opt(meta.stages, c.stage)}</select></label>
        ${field('amount', 'Amount ($) <small>pledged, paid or spent</small>', 'text', 'inputmode="decimal"')}
        ${field('next_follow_up', 'Next follow-up', 'date')}
        <label class="field full"><span>Notes</span><textarea name="notes" rows="3">${h(c.notes)}</textarea></label>
        <div class="consent full">
          <label class="check"><input type="checkbox" name="email_ok" ${c.email_ok ? 'checked' : ''}> <b>OK to email</b> <small class="muted">only if they said yes</small></label>
          <input type="text" name="email_ok_source" placeholder="How they said yes, e.g. signed up on parade website" value="${h(c.email_ok_source)}" style="width:100%;margin-top:8px">
          ${c.email_ok_at ? `<div class="muted small" style="margin-top:6px">Agreed on ${new Date(c.email_ok_at).toLocaleDateString()}</div>` : ''}
          <label class="check" style="margin-top:8px"><input type="checkbox" name="do_not_contact" ${c.do_not_contact ? 'checked' : ''}> Do not contact <small class="muted">(asked to be left alone or unsubscribed)</small></label>
        </div>
      </div>
      <div class="row">
        <button class="btn primary" value="save">Save</button>
        ${id ? '<button class="btn danger" value="delete" formnovalidate>Delete contact</button>' : ''}
        <span id="contact-msg" class="muted"></span>
      </div>
    </form>
    ${id ? `<h2>Tasks <button class="btn ghost" id="c-task-add" style="padding:3px 10px;font-size:.85rem">+ Task</button></h2>
      <ul class="tasklist" id="c-tasks">${c.tasks.map((t) => taskRow(t, false)).join('') || '<li class="muted">No tasks for this person.</li>'}</ul>
      <h2>History</h2>
      <form id="activity-form" class="row">
        <select name="kind">${opt(['Note', 'Call', 'Text', 'Email', 'Meeting', 'Payment'], 'Call')}</select>
        <input type="date" name="happened_on" value="${todayStr()}">
        <input type="text" name="note" placeholder="What happened?" style="flex:1;min-width:200px" required>
        <button class="btn">Add</button>
      </form>
      <ul class="history">${c.activities.map((a) => `<li><button title="Delete" data-del="${a.id}">×</button><b>${h(a.kind)} · ${niceDate(a.happened_on)}</b><br>${h(a.note)}</li>`).join('') || '<li class="muted">Nothing logged yet.</li>'}</ul>` : ''}`;

    const reopen = () => { openContact(id); refresh(); };
    const form = q$('#contact-form', dlg);
    form.onsubmit = async (e) => {
      const action = e.submitter?.value;
      if (action === 'cancel') return;
      e.preventDefault();
      if (action === 'delete') {
        if (!confirm(`Delete ${c.name} and all their history?`)) return;
        await call(`/contacts/${id}`, { method: 'DELETE' });
        dlg.close(); refresh(); return;
      }
      const data = Object.fromEntries(new FormData(form));
      data.email_ok = form.email_ok.checked; data.do_not_contact = form.do_not_contact.checked;
      try {
        const saved = await call(id ? `/contacts/${id}` : '/contacts', { method: id ? 'PUT' : 'POST', json: data });
        refresh();
        if (id) dlg.close(); else openContact(saved.id);
      } catch (err) { q$('#contact-msg', dlg).textContent = err.message; }
    };
    const go = q$('#send-go', dlg);
    if (go) go.onclick = async () => {
      try { const m = await call(`/contacts/${id}/message`, { method: 'POST', json: { template_id: Number(q$('#send-tpl', dlg).value) } }); location.href = m.link; setTimeout(reopen, 800); }
      catch (err) { q$('#contact-msg', dlg).textContent = err.message; }
    };
    const act = q$('#activity-form', dlg);
    if (act) {
      act.onsubmit = async (e) => {
        e.preventDefault();
        await call(`/contacts/${id}/activities`, { method: 'POST', json: Object.fromEntries(new FormData(act)) });
        openContact(id);
      };
      q$('.history', dlg).onclick = async (e) => {
        const del = e.target.dataset.del;
        if (del && confirm('Delete this history entry?')) { await call(`/activities/${del}`, { method: 'DELETE' }); openContact(id); }
      };
      q$('#c-tasks', dlg).onclick = (e) => taskClick(e, reopen);
      q$('#c-task-add', dlg).onclick = () => editTask({ contact_id: id }, reopen);
    }
    if (!dlg.open) dlg.showModal();
  }
})();
