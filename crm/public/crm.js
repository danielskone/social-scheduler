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
    const bizQ = (u) => { let b = ''; try { b = JSON.parse(localStorage.getItem('vtcrm-biz') || '""'); } catch { /* private mode */ } return b ? `${u}${u.includes('?') ? '&' : '?'}biz=${encodeURIComponent(b)}` : u; }; // the business picked in the switcher
    const res = await fetch(bizQ(`/api/crm${path}`), opts);
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
  // Each pipeline names its own steps: won steps are green, lost ones gray, open ones take colors in order.
  const OPEN_C = ['var(--st-new)', 'var(--st-contacted)', 'var(--st-interested)', 'var(--st-committed)', '#0891b2', '#c2410c', '#2563eb', '#db2777'];
  let stageColors = {};
  function buildStageColors(pipelines) {
    stageColors = {};
    (pipelines || []).forEach((pl) => {
      let i = 0;
      pl.stages.forEach((st) => {
        if (!stageColors[st.name]) stageColors[st.name] = st.kind === 'won' ? 'var(--st-paid)' : st.kind === 'lost' ? 'var(--st-no)' : OPEN_C[i % OPEN_C.length];
        if (st.kind === 'open') i++;
      });
    });
  }
  const stageC = (st) => stageColors[st] || STAGE_C[st] || 'var(--accent)';
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
    launchpad: ['check', 'Start here', 'A short list of things to set up once. <b>Green means done.</b> Press the button next to anything that isn\'t done yet.'],
    dashboard: ['pipeline', 'How things are going', 'Your numbers at a glance: new people, money still open, money won and what\'s coming up. Pick a date range at the top right. Use the <b>business switcher</b> at the top of the menu to see one business or all of them.'],
    conversations: ['email', 'Your email inbox, inside the CRM', 'When someone in your CRM emails you, it shows up here, on their card, and <b>your iPhone buzzes</b>. Click a name to read it and <b>answer right here</b>. Your reply goes out from your own email address. Mail from strangers and newsletters stays in your normal inbox.'],
    sites: ['forms', 'A simple website, no coding', 'Make a one-page website for a business or an event. Pick a design, change the words and pictures, and press <b>Save</b> with <b>Live</b> ticked. Put your <b>booking page</b> and <b>forms</b> right on it, so every visitor who books or signs up lands in People by itself. <b>Funnels</b> put pages in order: sign-up, then thank-you, then an offer.'],
    courses: ['check', 'Teach and sell courses', 'Make a course with lessons: a <b>YouTube or Vimeo link</b> or your own video, plus notes. Share the <b>sales page</b>. Free courses open right away, paid ones go through your Stripe. Members watch in their private <b>customer portal</b> and tick lessons done. You see everyone\'s progress here.'],
    events: ['appointments', 'Events and tickets', 'Make a page for an event with <b>free or paid tickets</b>. Paid tickets go through your own Stripe. Each person gets their tickets by <b>email with a QR code</b>. At the door, scan the code with any phone camera, type the <b>door code</b> once, and press <b>Check in</b>. You see who came right here.'],
    reports: ['pipeline', 'Your month in numbers', 'New people, deals won, money paid, appointments and more, compared with last month. <b>Email it</b> to yourself or a client, or tick the box and it goes out by itself on the 1st of every month. Pick a business at the top of the menu for its own report.'],
    payments: ['email', 'Get paid', 'Send a <b>quote</b> people sign on their phone, then an <b>invoice</b> they pay by card. Make an invoice, then <b>email it</b> or copy its link. People open it on their phone and <b>pay by card</b> with your own Stripe (the money goes straight to you), or by cash, check or Zelle, which you mark as paid. Your iPhone buzzes when a card payment comes in.'],
    reviews: ['check', 'More 5-star reviews', 'Ask people who just bought or donated for a review. Press <b>Ask</b> to email them, or text it from your phone. The link takes them straight to your review page, and you can see who opened it. Each person is asked at most once every 90 days.'],
    settings: ['check', 'Your businesses', 'Add each business you run, like an agency and a nonprofit. Each one gets its own people, pipeline and forms. Switch between them at the top of the menu.'],
    list: ['people', 'Your address book', 'Everyone you work with lives here: leads, customers, partners and more. <b>Click a name</b> to see their notes, history and next follow-up. Use the search box and menus to find people. <b>Save as smart list</b> keeps a search one tap away. <b>Tick the boxes</b> to tag, move or update many people at once.',
      'This app never bulk-sends texts, so your accounts can\'t get flagged for spam. Tick "OK to email" only when someone said yes.'],
    pipeline: ['pipeline', 'Where every deal stands', 'Each column is a step, from <b>New</b> to <b>Paid / Done</b>. <b>Drag a card</b> to the next column as things move along. The total under each column adds up the money at that step.',
      'Moving a card can start an automation, like a thank-you task when someone reaches "Paid / Done".'],
    tasks: ['tasks', 'Your to-do board', 'Start each day here. Drag a task from <b>To do</b> to <b>Doing</b> to <b>Done</b>, or tick the circle. Give a task to someone on your team and they get an email, plus one every morning at 7 with what is due. Red dates are late, orange ones are due today. When a task has a <b>Write</b> button, it opens a ready-made message in your Mail or Messages app, and you just press Send.'],
    appointments: ['appointments', 'Calls and meetings people booked', 'Your week at a glance. When someone books a time, it shows up here, they\'re added to People, they get a confirmation and a reminder email, and <b>your iPhone buzzes</b>. Click an appointment to move or cancel it. Use <b>Time off</b> for vacations. Share a booking link below in a post, your bio or a text.'],
    forms: ['forms', 'Your own form builder', 'Make any form: sign-ups, RSVPs, surveys, quotes, releases with a signature. <b>Describe it</b> or pick a ready-made one, then drag questions around. Share it as a link, a QR code or website code. Every response is saved, people become contacts, and your iPhone gets a ping.'],
    templates: ['templates', 'Messages you send a lot', 'Write a message once, use it again and again. Put <b>{first_name}</b>, <b>{name}</b> or <b>{company}</b> in it and the right details fill in for each person. They open in your own Mail or Messages, one person at a time.'],
    email: ['email', 'Newsletters and email blasts', 'Send one email to many people at once. A <b>campaign</b> is the email, a <b>segment</b> is who gets it, and a <b>design</b> is how it looks. Only people who said yes to email ever get one, and your mailing address and an unsubscribe line are added for you.'],
    automations: ['automations', 'Your helper that works while you\'re busy', 'Each workflow starts with a <b>trigger</b> (a new lead, a form, a stage change, a booking) and then runs its <b>steps</b> in order, top to bottom, like sending an email, making a task or waiting 2 days. Click one to see it as a flow. <b>Draft</b> means it\'s off; switch on <b>Publish</b> to run it. Not sure? Describe what you want at the top, or pick a ready-made one.',
      'Texts are never sent automatically: a "Send a text" step puts the message one tap away. Emails go out only through "Send email" steps.'],
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
    { tab: 'dashboard', ico: 'wave', title: 'Welcome to Viral Touch CRM', text: 'This is where you keep track of everyone you work with and what to do next with each of them. This quick tour shows you each part. It takes about a minute.', tryIt: 'Use <b>Next</b> to move along. You can stop any time.' },
    { tab: 'launchpad', ico: 'check', title: 'Launchpad', text: 'Start here. It lists the few things to set up once, like phone alerts and your email. Green means done.' },
    { tab: 'dashboard', ico: 'pipeline', title: 'Dashboard', text: 'Your numbers at a glance: new people, money still open, money won and what\'s coming up.', tryIt: 'The <b>business switcher</b> at the top of the menu picks which business you\'re looking at.' },
    { tab: 'conversations', ico: 'email', title: 'Conversations', text: 'Emails from people in your CRM land here, and your iPhone buzzes. Read them and answer right here, from your own email address.' },
    { tab: 'list', ico: 'people', title: 'People', text: 'Your address book. Click anyone to open their card with notes, history and their next follow-up date.', tryIt: 'Try it: press <b>+ Add contact</b> at the top right to add someone new.' },
    { tab: 'pipeline', ico: 'pipeline', title: 'Pipeline', text: 'See where every deal stands, from New to Paid / Done. Drag a card to the next column when things move along.', tryIt: 'Try it: drag someone from "Committed" to "Paid / Done" once they pay.' },
    { tab: 'tasks', ico: 'tasks', title: 'Tasks', text: 'Your to-do list. Many tasks are made for you by automations. Tick the circle when one is done.', tryIt: 'Good habit: check this tab first thing every morning.' },
    { tab: 'appointments', ico: 'appointments', title: 'Appointments', text: 'Calls people booked with you show up here, and your iPhone buzzes when a new one comes in.' },
    { tab: 'payments', ico: 'email', title: 'Payments', text: 'Send invoices. People pay by card with your own Stripe, or by cash, check or Zelle.' },
    { tab: 'sites', ico: 'forms', title: 'Sites', text: 'Make a simple one-page website with your booking page and forms on it. No coding.' },
    { tab: 'courses', ico: 'check', title: 'Courses', text: 'Teach what you know. Add lessons, share the course page, and members watch in their private portal.' },
    { tab: 'events', ico: 'appointments', title: 'Events', text: 'Sell or give away tickets to your events. People get a QR ticket by email, and you check them in at the door with your phone.' },
    { tab: 'reports', ico: 'pipeline', title: 'Reports', text: 'Your month in numbers. Email it to yourself or a client, by hand or every month by itself.' },
    { tab: 'forms', ico: 'forms', title: 'Forms', text: 'Build any form by dragging questions around: sign-ups, RSVPs, surveys, quotes. Each response is saved and becomes a contact by itself.', tryIt: 'Try it: pick a ready-made form, press <b>Save</b>, then <b>Share</b>.' },
    { tab: 'templates', ico: 'templates', title: 'Message templates', text: 'Messages you send often, written once. {first_name} fills in each person\'s name for you.' },
    { tab: 'email', ico: 'email', title: 'Email marketing', text: 'Send a newsletter to everyone who said yes to email. Pick a design, pick who gets it, then press Send or pick a time.' },
    { tab: 'reviews', ico: 'check', title: 'Reviews', text: 'Ask happy customers for a review with one press, and see who opened the link.' },
    { tab: 'automations', ico: 'automations', title: 'Automations', text: 'Your helper. When a new lead comes in, it can make a task, buzz your phone or send a welcome email, all by itself. These are already switched on for you.' },
    { tab: 'settings', ico: 'people', title: 'Settings', text: 'Add your businesses here, with their phone, email, website and color. Each one keeps its own people and pipeline.' },
    { tab: 'dashboard', ico: 'party', title: 'You\'re all set!', text: 'Each tab has a short tip at the top if you forget what it\'s for. You can replay this tour any time with <b>How it works</b> at the top.' },
  ];
  const TABS = ['launchpad', 'dashboard', 'conversations', 'list', 'pipeline', 'tasks', 'appointments', 'payments', 'forms', 'templates', 'automations', 'email', 'reviews', 'sites', 'courses', 'events', 'reports', 'settings'];
  // #contacts on its own opens the Dashboard; #contacts/people (or the old #contacts/list) is People.
  const tabFor = (sub) => (sub === 'people' || sub === 'list' ? 'list' : TABS.includes(sub) ? sub : 'dashboard');
  window.crmTabFor = tabFor;
  const TAB_ROUTE = (t) => (t === 'list' ? '#contacts/people' : `#contacts/${t}`);
  let tourAt = -1;
  function showTour(i) {
    tourAt = i;
    const box = q$('#crm-coach');
    document.querySelectorAll('#crm-tabs a, .sidebar nav a').forEach((a) => a.classList.remove('tour-glow'));
    if (i < 0 || i >= TOUR.length) { box.hidden = true; tourAt = -1; store.set('tour-done', true); return; }
    const st = TOUR[i];
    if (tabFor((location.hash.split('/')[1] || '').split('?')[0]) !== st.tab) location.hash = TAB_ROUTE(st.tab);
    // The CRM's own app shows its sections in the side menu on a Mac and as tabs on an iPhone.
    const side = q$(`.sidebar nav a[data-tab="${st.tab}"]`);
    const link = side && side.offsetParent && getComputedStyle(q$('#crm-tabs')).display === 'none' ? side : q$(`#crm-tabs a[data-tab="${st.tab}"]`);
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
    const moved = (meta.summary.moved || 0) > 0;
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
  let tab = 'dashboard';
  let homeReady = null;
  const HEADS = {
    launchpad: ['Launchpad', 'Set these up once and the CRM works by itself.'],
    dashboard: ['Dashboard', 'How things are going, at a glance.'],
    conversations: ['Conversations', 'Emails, website chats and Facebook and Instagram messages, all in one place. Read and answer them here.'],
    list: ['People', 'Everyone you work with, what\'s next with each of them, and who to follow up with today.'],
    pipeline: ['Pipeline', 'Where every deal stands. Drag a card to move it along.'],
    tasks: ['Tasks', 'Your to-do list. Tick things off as you go.'],
    appointments: ['Appointments', 'Calls and meetings people booked with you.'],
    forms: ['Forms', 'Sign-up forms, surveys and more, shared as a link or QR code.'],
    templates: ['Templates', 'Messages you send a lot, written once.'],
    email: ['Email', 'Newsletters and email blasts to people who said yes.'],
    automations: ['Automations', 'Your helper that works while you\'re busy.'],
    payments: ['Payments', 'Invoices, quotes, products, coupons, referrals, plans, contracts, gift cards and points.'],
    sites: ['Sites', 'Simple websites, and funnels that lead people from one page to the next.'],
    courses: ['Courses', 'Lessons people watch in their private members area.'],
    events: ['Events', 'Event pages, free or paid tickets, and check-in at the door.'],
    reports: ['Reports', 'Your month in numbers, ready to email.'],
    reviews: ['Reviews', 'Ask happy customers for a review, and see who opened the link.'],
    settings: ['Settings', 'Your businesses, custom fields, payments and team.'],
  };
  let timer;

  async function renderContacts(sub) {
    tab = tabFor(sub);
    document.querySelectorAll('#crm-tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
    document.querySelectorAll('.crm-panel').forEach((p) => (p.hidden = p.dataset.panel !== tab));
    if (!homeReady) { homeReady = window.VTHome.init(refresh); }
    await homeReady;
    const [title, sub2] = HEADS[tab];
    const biz = window.VTHome.current();
    q$('#crm-title').textContent = title;
    q$('#crm-sub').innerHTML = `${biz ? `<span class="biz-dot" style="--c:${h(biz.color)}"></span><b>${h(biz.name)}</b> · ` : ''}${sub2}`;
    // The number tiles belong to the people pages; Launchpad, Dashboard and Settings have their own.
    q$('#crm-tiles').style.display = ['launchpad', 'dashboard', 'settings', 'conversations', 'payments', 'reviews', 'sites', 'courses', 'events', 'reports', 'appointments'].includes(tab) ? 'none' : '';
    meta = await call('/meta');
    buildStageColors(meta.pipelines);
    const fill = (sel, items, label) => {
      const el = q$(sel), cur = el.value;
      el.innerHTML = `<option value="">${label}</option>` + items.map((g) => `<option${g === cur ? ' selected' : ''}>${h(g)}</option>`).join('');
    };
    fill('#crm-group', meta.groups, 'All groups');
    fill('#pipe-group', meta.groups, 'All groups');
    fill('#crm-stage', meta.stages, 'All stages');
    const s = meta.summary;
    q$('#crm-tiles').innerHTML = [
      ['Contacts', s.total, 'people', '#4f46e5'], ['To-dos due', s.due + s.tasksDue, 'bell', '#d97706'], ['Open deals', money(s.pledged), 'pipeline', '#9333ea'],
      ['Won', money(s.paid), 'money', '#16a34a'], ['OK to email', s.emailable, 'email', '#db2777'],
    ].map(([l, v, ico, c]) => `<div class="tile"><div class="tile-ico" style="--c:${c}">${svg(ico)}</div><div><div class="label">${l}</div><div class="value">${v ?? 0}</div></div></div>`).join('');
    renderTip(tab);
    if (!store.get('tour-done', false) && tourAt < 0) setTimeout(() => showTour(0), 400);
    await ({ launchpad: () => window.VTHome.renderLaunchpad(), dashboard: () => window.VTHome.renderDashboard(), conversations: () => window.VTInbox.render({ openContact }), payments: () => window.VTMore.renderPayments(), reviews: () => window.VTMore.renderReviews(), sites: () => window.VTExtra3.renderSitesTab(), courses: () => window.VTExtra2.renderCourses(), events: () => window.VTExtra5.renderEvents(), reports: () => window.VTExtra.renderReports(), settings: () => window.VTHome.renderSettings(meta), list: renderList, pipeline: renderBoard, tasks: renderTasks, appointments: renderAppointments, forms: renderForms, templates: renderTemplates, automations: renderAutomations, email: renderEmail }[tab])();
  }
  window.renderContacts = renderContacts;
  window.addEventListener('load', () => setTimeout(() => window.VTInbox.badge(), 500));
  const refresh = () => renderContacts(tab);

  // ---------- People ----------
  // Big lists draw 200 rows at a time so the page stays quick; "Show more" draws the next ones.
  const PAGE = 200;
  let listShown = PAGE, listKey = '';
  async function renderList(more) {
    const key = window.VTLists.params();
    if (more !== true && key !== listKey) listShown = PAGE;
    listKey = key;
    const rows = await call(`/contacts?lite=1&${key}`);
    const page = rows.slice(0, listShown);
    q$('#crm-table tbody').innerHTML = (page.map((c) => `<tr data-id="${c.id}">
      <td class="sel"><input type="checkbox" data-sel aria-label="Pick ${h(c.name)}"></td>
      <td><div class="crm-person">${avatar(c.name)}<div class="who"><b>${h(c.name)}</b>${c.company && c.company !== c.name ? `<div class="muted">${h(c.company)}</div>` : ''}${c.do_not_contact || (c.tag_list || []).length ? `<div class="tag-row">${c.do_not_contact ? '<span class="pill off">Do not contact</span>' : ''}${(c.tag_list || []).map((t) => `<span class="tag">${h(t)}</span>`).join('')}</div>` : ''}</div></div></td>
      <td>${groupPill(c.group_name)}</td>
      <td>${stageBadge(c.stage)}</td>
      <td><b>${money(c.amount)}</b></td>
      <td><div class="crm-acts">${c.phone ? `<a class="crm-act" href="tel:${h(c.phone)}" title="Call ${h(c.phone)}">${svg('phone')}<span>${h(c.phone)}</span></a>` : ''}${c.email ? `<a class="crm-act" href="mailto:${h(c.email)}" title="${c.email_ok ? 'Said yes to email' : 'Email'}">${svg('email')}<span>${h(c.email)}</span>${c.email_ok ? '<span class="ok">✓</span>' : ''}</a>` : ''}</div></td>
      <td><span class="due ${dueClass(c.next_follow_up)}">${c.next_follow_up ? (dueClass(c.next_follow_up) === 'overdue' ? 'Late · ' : dueClass(c.next_follow_up) === 'due-today' ? 'Today · ' : '') + niceDate(c.next_follow_up) : '<span class="muted">—</span>'}</span></td>
    </tr>`).join('') || `<tr><td colspan="7" class="crm-empty muted">${meta.summary.total ? '<span class="big">🔍</span>Nobody matches that search. Try fewer words or pick "All groups".' : '<span class="big">👋</span><b>No contacts yet.</b><br>Press "+ Add contact", bring in a spreadsheet with "Import CSV", or share a sign-up form.'}</td></tr>`)
      + (rows.length > page.length ? `<tr class="crm-more-row"><td colspan="7"><button type="button" class="btn ghost" data-more>Show ${Math.min(PAGE, rows.length - page.length)} more</button> <span class="muted small">Showing ${page.length} of ${rows.length}. Search to find someone fast.</span></td></tr>` : '');
    renderStart();
    window.VTLists.after(rows, { render: renderList });
  }
  q$('#crm-q').oninput = () => { clearTimeout(timer); timer = setTimeout(renderList, 200); };
  ['#crm-group', '#crm-stage', '#crm-due', '#crm-tag', '#crm-show'].forEach((s) => (q$(s).onchange = renderList));
  q$('#crm-table tbody').onclick = (e) => { if (e.target.closest('[data-more]')) { listShown += PAGE; renderList(true); return; } const tr = e.target.closest('tr[data-id]'); if (tr && !e.target.closest('a') && !e.target.closest('td.sel')) openContact(Number(tr.dataset.id)); };
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
  // The pipeline picked on the board, remembered for each business.
  const pipeKey = () => `pipe-${window.VTHome.current() ? window.VTHome.current().id : 'all'}`;
  // With nothing picked yet, a business opens on its own pipeline before the shared one.
  const curPipe = () => { const b = window.VTHome.current();
    return meta.pipelines.find((x) => x.id === Number(store.get(pipeKey(), 0))) || (b && meta.pipelines.find((x) => x.business_id === b.id)) || meta.pipelines[0]; };
  const boardOpen = new Set(); // steps with every card shown (big steps show 50 at first)
  async function renderBoard() {
    const pl = curPipe();
    q$('#pipe-pick').innerHTML = meta.pipelines.map((x) => `<option value="${x.id}"${x.id === pl.id ? ' selected' : ''}>${h(x.name)}</option>`).join('');
    q$('#pipe-pick').hidden = meta.pipelines.length < 2;
    const group = q$('#pipe-group').value;
    const rows = await call(`/contacts?lite=1&pipeline=${pl.id}${group ? `&group=${encodeURIComponent(group)}` : ''}`);
    const open = rows.filter((c) => c.stage_kind === 'open').reduce((n, c) => n + (c.amount || 0), 0);
    q$('#pipe-total').textContent = `${rows.length} ${rows.length === 1 ? 'person' : 'people'} · ${money(open)} still open`;
    q$('#pipe-board').innerHTML = pl.stages.map(({ name: st, kind }) => {
      const cards = rows.filter((c) => c.stage === st);
      const total = cards.reduce((n, c) => n + (c.amount || 0), 0);
      const cap = boardOpen.has(st) ? cards.length : 50, extra = cards.length - cap;
      return `<div class="col ${kind}" data-stage="${h(st)}" style="--c:${stageC(st)}"><h3>${h(st)}${kind !== 'open' ? ` <small class="kind">${kind === 'won' ? 'Won' : 'Lost'}</small>` : ''}</h3><div class="muted">${cards.length} ${cards.length === 1 ? 'person' : 'people'} · ${money(total)}</div>
        ${cards.slice(0, cap).map((c) => `<div class="card" draggable="true" data-id="${c.id}"><div class="top">${avatar(c.company || c.name, 'sm')}<div><b>${h(c.company || c.name)}</b>
          ${c.company && c.company !== c.name ? `<div class="muted small">${h(c.name)}</div>` : ''}</div></div>
          ${c.amount ? `<div class="amt">${money(c.amount)}</div>` : ''}
          <div class="meta">${groupPill(c.group_name)}${c.next_follow_up ? ` <span class="${dueClass(c.next_follow_up)}">${niceDate(c.next_follow_up)}</span>` : ''}</div></div>`).join('') || '<div class="empty-col">Drag a card here</div>'}
        ${extra > 0 ? `<button type="button" class="btn ghost col-more" data-col-more="${h(st)}">Show ${extra} more</button>` : ''}
      </div>`;
    }).join('');
  }
  q$('#pipe-pick').onchange = (e) => { store.set(pipeKey(), Number(e.target.value)); renderBoard(); };
  q$('#pipe-edit').onclick = () => editPipeline(curPipe());
  q$('#pipe-new').onclick = () => editPipeline(null);

  // Name your own steps: rename, add, remove, move up or down, and say which ones mean won or lost.
  function editPipeline(pl) {
    const dlg = q$('#crm-edit-dialog');
    const biz = window.VTHome.current();
    let steps = pl ? pl.stages.map((x) => ({ ...x, from: x.name })) : [{ name: 'New', kind: 'open' }, { name: 'Contacted', kind: 'open' }, { name: 'Interested', kind: 'open' }, { name: 'Won', kind: 'won' }, { name: 'Lost', kind: 'lost' }];
    const KIND = [['open', 'Still open'], ['won', 'Won (money counts)'], ['lost', 'Lost']];
    const draw = () => {
      q$('#pl-steps', dlg).innerHTML = steps.map((x, i) => `<li data-i="${i}" style="--c:${x.kind === 'won' ? 'var(--st-paid)' : x.kind === 'lost' ? 'var(--st-no)' : OPEN_C[i % OPEN_C.length]}">
        <span class="pl-num">${i + 1}</span><input data-name value="${h(x.name)}" maxlength="40" aria-label="Step ${i + 1} name" placeholder="Step name">
        <select data-kind aria-label="What this step means">${KIND.map(([v, l]) => `<option value="${v}"${v === x.kind ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <button type="button" class="x" data-up title="Move up" aria-label="Move up"${i === 0 ? ' disabled' : ''}>↑</button><button type="button" class="x" data-down title="Move down" aria-label="Move down"${i === steps.length - 1 ? ' disabled' : ''}>↓</button>
        <button type="button" class="x" data-rm title="Remove step" aria-label="Remove step">×</button></li>`).join('');
    };
    const sync = () => q$('#pl-steps', dlg).querySelectorAll('li').forEach((li) => { const x = steps[li.dataset.i]; x.name = q$('[data-name]', li).value; x.kind = q$('[data-kind]', li).value; });
    dlg.innerHTML = `<form id="pl-form"><h1>${pl ? 'Edit pipeline' : 'New pipeline'}</h1>
      <p class="muted" style="margin-top:0">Steps go left to right on the board. Mark the step that means you got paid as <b>Won</b>, and one for deals that fell through as <b>Lost</b>.</p>
      <label class="field"><span>Pipeline name</span><input name="name" required maxlength="60" value="${h(pl ? pl.name : '')}" placeholder="e.g. Sponsors, New members, Car sales" style="width:100%"></label>
      ${!pl && biz ? `<label class="check" style="margin:4px 0 12px"><input type="checkbox" name="mine" checked> Only for ${h(biz.name)} <small class="muted">(untick to share it with every business)</small></label>` : ''}
      <ol class="pl-steps" id="pl-steps"></ol>
      <button type="button" class="btn ghost" data-add>+ Add a step</button>
      <p class="muted small">Renaming a step keeps everyone in it. People in a step you remove move to the first step.</p>
      <div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Cancel</button>
        ${pl && meta.pipelines.length > 1 ? '<button class="btn ghost danger" type="button" data-del style="margin-left:auto">Delete pipeline</button>' : ''}</div>
      <p class="muted" id="pl-msg"></p></form>`;
    draw();
    q$('[data-close]', dlg).onclick = () => dlg.close();
    q$('[data-add]', dlg).onclick = () => { sync(); const won = steps.findIndex((x) => x.kind !== 'open'); steps.splice(won < 0 ? steps.length : won, 0, { name: '', kind: 'open' }); draw(); q$(`li[data-i="${won < 0 ? steps.length - 1 : won}"] [data-name]`, dlg).focus(); };
    q$('#pl-steps', dlg).onclick = (e) => {
      const li = e.target.closest('li'); if (!li) return;
      const i = Number(li.dataset.i); sync();
      if ('up' in e.target.dataset && i > 0) [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
      else if ('down' in e.target.dataset && i < steps.length - 1) [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]];
      else if ('rm' in e.target.dataset) steps.splice(i, 1);
      else return;
      draw();
    };
    const del = q$('[data-del]', dlg);
    if (del) del.onclick = async () => {
      if (!confirm(`Delete the "${pl.name}" pipeline? Nobody is deleted. Its people move to another pipeline.`)) return;
      try { await call(`/pipelines/${pl.id}`, { method: 'DELETE' }); store.set(pipeKey(), 0); dlg.close(); refresh(); } catch (err) { q$('#pl-msg', dlg).textContent = err.message; }
    };
    q$('#pl-form', dlg).onsubmit = async (e) => {
      e.preventDefault(); sync();
      const f = e.target;
      const body = { name: f.name.value, stages: steps.filter((x) => x.name.trim()) };
      if (!pl) body.business_id = f.mine && !f.mine.checked ? '' : (biz ? biz.id : '');
      try {
        const saved = await call(pl ? `/pipelines/${pl.id}` : '/pipelines', { method: pl ? 'PUT' : 'POST', json: body });
        store.set(pipeKey(), saved.id); dlg.close(); say(pl ? 'Pipeline saved.' : `Made the "${saved.name}" pipeline.`); refresh();
      } catch (err) { q$('#pl-msg', dlg).textContent = err.message; }
    };
    dlg.showModal();
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
    try { await call(`/contacts/${id}`, { method: 'PUT', json: { stage: col.dataset.stage, pipeline_id: curPipe().id } }); } catch (err) { say(err.message, true); }
    refresh();
  });
  board.addEventListener('click', (e) => { const m = e.target.closest('[data-col-more]'); if (m) { boardOpen.add(m.dataset.colMore); renderBoard(); return; } const c = e.target.closest('.card'); if (c) openContact(Number(c.dataset.id)); });

  // ---------- Tasks ----------
  const taskRow = (t, showWho = true) => `<li class="${t.done_at ? 'done' : ''}" data-task="${t.id}">
    <input type="checkbox" data-done ${t.done_at ? 'checked' : ''} title="Mark done">
    <span class="title">${h(t.title)}${showWho && t.contact_name ? ` <a href="#" data-open="${t.contact_id}" class="muted">· ${h(t.contact_name)}</a>` : ''}</span>
    ${t.template_id && t.contact_id && !t.done_at ? `<button class="btn ghost" data-write title="Opens a filled-in message for just this person in your Mail or Messages app. You press Send." style="padding:3px 10px;font-size:.85rem">Write "${h(t.template_name)}"</button>` : ''}
    <span class="when-chip ${t.done_at ? 'muted' : dueClass(t.due_on)}">${!t.done_at && dueClass(t.due_on) === 'overdue' ? `Late · ${niceDate(t.due_on)}` : !t.done_at && dueClass(t.due_on) === 'due-today' ? 'Today' : niceDate(t.due_on)}</span>
    <button class="x" data-edit title="Edit">✎</button><button class="x" data-del title="Delete">×</button></li>`;
  async function renderTasks() {
    // The board (To do, Doing, Done) is the main view; the simple list is one tap away.
    if (window.VTExtra7) {
      const board = await window.VTExtra7.renderBoard({ editTask, openContact, after: renderTasks });
      q$('#task-list').hidden = board; q$('#task-list-tools').hidden = board;
      if (board) return;
    }
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
    const [people, team] = await Promise.all([call('/contacts?lite=1'), call('/taskboard/people').catch(() => [])]);
    const dlg = q$('#crm-edit-dialog');
    dlg.innerHTML = `<form id="task-form"><h1>${t.id ? 'Edit task' : 'New task'}</h1>
      <label class="field"><span>To do</span><input name="title" required value="${h(t.title)}" placeholder="e.g. Call about their invoice" style="width:100%"></label>
      <label class="field"><span>Due</span><input type="date" name="due_on" value="${h(t.due_on || todayStr())}"></label>
      <label class="field"><span>About which person</span><select name="contact_id" style="width:100%"><option value="">(nobody in particular)</option>
        ${people.map((p) => `<option value="${p.id}"${p.id === t.contact_id ? ' selected' : ''}>${h(p.name)}${p.company && p.company !== p.name ? ` (${h(p.company)})` : ''}</option>`).join('')}</select></label>
      ${team.length > 1 ? `<label class="field"><span>Who does it</span><select name="assigned_to" style="width:100%">${team.map((m) => `<option value="${m.id || ''}"${(m.id || null) === (t.assigned_to || null) ? ' selected' : ''}>${h(m.name)}</option>`).join('')}</select></label>` : ''}
      <label class="field"><span>Column</span><select name="status"><option value="todo">To do</option><option value="doing"${t.status === 'doing' ? ' selected' : ''}>Doing</option><option value="done"${t.status === 'done' || t.done_at ? ' selected' : ''}>Done</option></select></label>
      <label class="check"><input type="checkbox" name="priority" ${t.priority ? 'checked' : ''}> Important (shows first, with a red flag)</label>
      <label class="field"><span>Notes</span><textarea name="notes" rows="3" style="width:100%" placeholder="Anything that helps, like a phone number or what to say">${h(t.notes || '')}</textarea></label>
      <div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Cancel</button><span class="muted" id="task-msg"></span></div></form>`;
    q$('[data-close]', dlg).onclick = () => dlg.close();
    q$('#task-form', dlg).onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      body.priority = e.target.priority.checked ? 1 : 0;
      try { await call(t.id ? `/tasks/${t.id}` : '/tasks', { method: t.id ? 'PUT' : 'POST', json: body }); dlg.close(); after(); }
      catch (err) { q$('#task-msg', dlg).textContent = err.message; }
    };
    dlg.showModal();
  }

  // ---------- Forms (the form builder lives in forms.js) ----------
  const renderForms = () => window.VPForms.render(meta);

  // ---------- Appointments ----------
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let bookingTz = 'America/New_York';
  const apptWhen = (iso) => new Date(iso).toLocaleString([], { timeZone: bookingTz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  async function renderAppointments() {
    window.VTExtra.renderCalendar(q$('#cal-root'), { openContact, onChange: refresh }).catch((e) => say(e.message, true));
    const [{ pages, timezone }, appts] = await Promise.all([call('/booking/pages'), call(`/booking/appointments${q$('#appt-past').checked ? '?past=1' : ''}`)]);
    bookingTz = timezone;
    q$('#appt-list').innerHTML = appts.map((a) => `<li data-appt="${a.id}" class="${a.status === 'cancelled' ? 'done' : ''}">
      <span class="title"><b>${h(apptWhen(a.starts_at))}</b> · ${a.contact_id ? `<a href="#" data-open="${a.contact_id}">${h(a.contact_name)}</a>` : 'Deleted contact'}${a.staff_name ? ` <span class="muted">· with ${h(a.staff_name)}</span>` : ''}
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

  async function editBookingPage(p) {
    const dlg = q$('#crm-edit-dialog');
    const team = await call('/taskboard/people').catch(() => []);
    const onTeam = (() => { try { return JSON.parse(p.team || '[]').map(Number); } catch { return []; } })();
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
      <div class="row">
        <label class="field"><span>Break between (minutes)</span><input type="number" name="buffer_minutes" min="0" max="240" step="5" value="${h(p.buffer_minutes || 0)}" style="width:110px"></label>
        <label class="field"><span>Most per day <small>(0 = no limit)</small></span><input type="number" name="max_per_day" min="0" max="100" value="${h(p.max_per_day || 0)}" style="width:110px"></label>
        <label class="field"><span>Reminder email</span><select name="remind_hours">${[[24, '1 day before'], [48, '2 days before'], [12, '12 hours before'], [3, '3 hours before'], [1, '1 hour before'], [0, 'No reminder']].map(([v, l]) => `<option value="${v}"${Number(p.remind_hours ?? 24) === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      ${team.length > 1 ? `<div class="field"><span>Who takes these appointments?</span><p class="muted small" style="margin:0 0 6px">Tick more than one and the page takes turns: each booking goes to whoever is free and has had the fewest. Each person's own hours are set in Settings, Your team.</p>
        <div class="row">${team.map((m) => `<label class="check"><input type="checkbox" name="team" value="${m.id || 0}" ${(onTeam.length ? onTeam.includes(m.id || 0) : !m.id) ? 'checked' : ''}> ${h(m.name)}</label>`).join('')}</div></div>` : ''}
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
      if (f.querySelector('[name=team]')) data.team = [...f.querySelectorAll('[name=team]:checked')].map((x) => Number(x.value));
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
      <div class="muted small">${s.groups.length ? `Groups: ${h(s.groups.join(', '))}` : 'All groups'}${s.stages.length ? ` · Stages: ${h(s.stages.join(', '))}` : ''}${s.tag ? ` · Tag: ${h(s.tag)}` : ''}${s.joined_days ? ` · Said yes in the last ${s.joined_days} days` : ''}</div>
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
      <label class="field"><span>Only people with this tag <small>(optional)</small></span><input name="tag" maxlength="30" value="${h(s.tag || '')}" style="width:200px"></label>
      <label class="field"><span>Only people who said yes in the last … days <small>(optional)</small></span><input type="number" name="joined_days" min="1" value="${h(s.joined_days || '')}" style="width:110px"></label>
      <div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Cancel</button><span class="muted" id="seg-msg"></span></div></form>`;
    q$('[data-close]', dlg).onclick = () => dlg.close();
    q$('#seg-form', dlg).onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const json = { name: q$('[name=name]', f).value, joined_days: q$('[name=joined_days]', f).value, tag: q$('[name=tag]', f).value,
        groups: [...f.querySelectorAll('[name=g]:checked')].map((x) => x.value), stages: [...f.querySelectorAll('[name=st]:checked')].map((x) => x.value) };
      try { await call(s.id ? `/email/segments/${s.id}` : '/email/segments', { method: s.id ? 'PUT' : 'POST', json }); dlg.close(); refresh(); }
      catch (err) { q$('#seg-msg', dlg).textContent = err.message; }
    };
    dlg.showModal();
  }

  // ---------- Automations (the workflow builder lives in workflows.js) ----------
  const renderAutomations = () => window.VPWorkflows.render(meta);

  // ---------- One contact ----------
  window.crmOpenContact = (id) => openContact(id);
  // The business's own boxes (Settings > Custom fields), shown on every person's card.
  function customFieldsHtml(c) {
    const defs = meta.fields || [];
    if (!defs.length) return '';
    const v = (f) => (c.custom || {})[f.key] ?? '';
    const input = (f) => {
      const n = `cf:${f.key}`;
      if (f.type === 'long') return `<textarea name="${n}" rows="2">${h(v(f))}</textarea>`;
      if (f.type === 'choice') return `<select name="${n}"><option value="">Pick one</option>${f.options.map((o) => `<option${o === v(f) ? ' selected' : ''}>${h(o)}</option>`).join('')}</select>`;
      if (f.type === 'yesno') return `<label class="check"><input type="checkbox" name="${n}"${v(f) === 'Yes' ? ' checked' : ''}> Yes</label>`;
      const type = { number: 'number', money: 'text', date: 'date', link: 'url' }[f.type] || 'text';
      return `<input type="${type}" name="${n}" value="${h(v(f))}"${f.type === 'money' ? ' inputmode="decimal" placeholder="$"' : f.type === 'number' ? ' step="any"' : ''}>`;
    };
    return `<div class="cf-head full"><b>More details</b><a class="small" href="#contacts/settings" data-cf-edit>Add or change these boxes</a></div>
      ${defs.map((f) => `<label class="field${f.type === 'long' ? ' full' : ''}"><span>${h(f.label)}</span>${input(f)}</label>`).join('')}`;
  }

  async function openContact(id) {
    const c = id ? await call(`/contacts/${id}`) : { group_name: q$('#crm-group').value || meta.groups[0] || 'Other', stage: 'New', activities: [], tasks: [] };
    const templates = id ? await call('/templates') : [];
    const dlg = q$('#contact-dialog');
    const field = (name, label, type = 'text', extra = '') => `<label class="field"><span>${label}</span><input type="${type}" name="${name}" value="${h(c[name])}" ${extra}></label>`;
    const usable = templates.filter((t) => (t.channel === 'email' ? c.email : c.phone));
    // Their pipeline (new people start in the pipeline picked on the board).
    const cPipe = meta.pipelines.find((x) => x.id === (c.pipeline || c.pipeline_id)) || (id ? meta.pipelines[0] : curPipe()) || meta.pipelines[0];
    if (!id) c.stage = cPipe.stages[0].name;
    dlg.innerHTML = `<form method="dialog" id="contact-form">
      <header class="view-head"><h1>${id ? h(c.name) : 'New contact'}</h1><div class="row c-actions">${id && c.email ? '<button class="btn ghost" type="button" id="c-emails" title="Read and answer their emails">Emails</button>' : ''}${id ? '<button class="btn ghost" type="button" id="c-quote" title="Send them a quote to sign">Quote</button><button class="btn ghost" type="button" id="c-contract" title="Send them a contract to sign">Contract</button><button class="btn ghost" type="button" id="c-invoice" title="Make an invoice for them">Invoice</button><button class="btn ghost" type="button" id="c-book" title="Add an appointment with them">Book</button><button class="btn ghost" type="button" id="c-review" title="Ask them for a review">Review</button><button class="btn ghost" type="button" id="c-portal" title="Their private page with invoices, quotes, appointments and courses">Portal</button>' : ''}<button class="btn ghost" value="cancel" formnovalidate>Close</button></div></header>
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
        ${meta.pipelines.length > 1 ? `<label class="field"><span>Pipeline</span><select name="pipeline_id">${meta.pipelines.map((x) => `<option value="${x.id}"${x.id === cPipe.id ? ' selected' : ''}>${h(x.name)}</option>`).join('')}</select></label>` : ''}
        <label class="field"><span>Step</span><select name="stage">${opt(cPipe.stages.map((x) => x.name), c.stage)}</select></label>
        ${field('amount', 'Amount ($) <small>pledged, paid or spent</small>', 'text', 'inputmode="decimal"')}
        ${field('next_follow_up', 'Next follow-up', 'date')}
        <label class="field full"><span>Notes</span><textarea name="notes" rows="3">${h(c.notes)}</textarea></label>
        <label class="field full"><span>Tags <small>separate with commas, like VIP, 2026 sponsor</small></span><input name="tags" maxlength="400" value="${h((c.tag_list || []).join(', '))}" placeholder="VIP, 2026 sponsor"></label>
        ${customFieldsHtml(c)}
        <div class="consent full">
          <label class="check"><input type="checkbox" name="email_ok" ${c.email_ok ? 'checked' : ''}> <b>OK to email</b> <small class="muted">only if they said yes</small></label>
          <input type="text" name="email_ok_source" placeholder="How they said yes, e.g. signed up on my website" value="${h(c.email_ok_source)}" style="width:100%;margin-top:8px">
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
    const ci = q$('#c-invoice', dlg), cr = q$('#c-review', dlg);
    if (ci) ci.onclick = () => { dlg.close(); window.VTMore.editInvoice(null, id); };
    const cq = q$('#c-quote', dlg), cb = q$('#c-book', dlg);
    if (cq) cq.onclick = () => { dlg.close(); window.VTExtra.editQuote(null, id); };
    const ck = q$('#c-contract', dlg);
    if (ck) ck.onclick = () => { dlg.close(); window.VTExtra4.editContract(null, id, () => { if (tab === 'payments') refresh(); }); };
    if (cb) cb.onclick = () => { dlg.close(); window.VTExtra.addAppointment({ contactId: id, onChange: refresh }); };
    if (cr) cr.onclick = () => { dlg.close(); window.VTMore.askReview(id, () => openContact(id)); };
    const cp = q$('#c-portal', dlg);
    if (cp) cp.onclick = () => { dlg.close(); window.VTExtra2.portalLink(id, c.name); };
    const cfe = q$('[data-cf-edit]', dlg);
    if (cfe) cfe.onclick = () => dlg.close();
    const em = q$('#c-emails', dlg);
    if (em) em.onclick = () => { dlg.close(); window.VTInbox.show(id); if (tab === 'conversations') refresh(); };
    const form = q$('#contact-form', dlg);
    if (form.pipeline_id) form.pipeline_id.onchange = () => {
      const pl = meta.pipelines.find((x) => x.id === Number(form.pipeline_id.value));
      form.stage.innerHTML = opt(pl.stages.map((x) => x.name), pl.stages.some((x) => x.name === form.stage.value) ? form.stage.value : pl.stages[0].name);
    };
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
      // Custom fields go in one "custom" box; an unticked yes/no box means No.
      data.custom = {};
      for (const k of Object.keys(data).filter((x) => x.startsWith('cf:'))) { data.custom[k.slice(3)] = data[k]; delete data[k]; }
      form.querySelectorAll('input[type=checkbox][name^="cf:"]').forEach((x) => { data.custom[x.name.slice(3)] = x.checked ? 'Yes' : ''; });
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
