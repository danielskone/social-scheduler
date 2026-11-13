// Viral Touch CRM, GoHighLevel-style parts made simple: the business switcher, Launchpad,
// Dashboard and Settings. Loaded before crm.js, which calls window.VTHome.
(() => {
  const q$ = (s, el = document) => el.querySelector(s);
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => Number(n || 0).toLocaleString([], { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const store = {
    get(k, d) { try { const v = localStorage.getItem(`vtcrm-${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`vtcrm-${k}`, JSON.stringify(v)); } catch { /* private mode: fine */ } },
  };
  async function call(path, opts = {}) {
    if (opts.json) { opts.body = JSON.stringify(opts.json); opts.headers = { 'Content-Type': 'application/json' }; delete opts.json; }
    const b = store.get('biz', '');
    const url = `/api/crm${path}`;
    const res = await fetch(b && !opts.noBiz ? `${url}${url.includes('?') ? '&' : '?'}biz=${encodeURIComponent(b)}` : url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  const say = (msg, err) => { const el = q$('#banner'); el.textContent = msg; el.className = `banner${err ? ' error' : ''}`; el.hidden = !msg; };
  const I = {
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.8 2.8 5.2-5.6"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    email: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    website: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
    business: '<path d="M4 20V8l8-4 8 4v12"/><path d="M9 20v-5h6v5M4 20h16"/>',
    contact: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
    form: '<rect x="5" y="4.5" width="14" height="16" rx="2.5"/><path d="M9 3.5h6v3H9zM8.5 11h7M8.5 15h5"/>',
    booking: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4"/>',
    automation: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
    chev: '<path d="m8 10 4-4 4 4M8 14l4 4 4-4"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  };
  const svg = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;
  const initials = (name) => String(name || '?').trim().split(/\s+/).filter((w) => /\w/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

  // ---------- Business switcher (GoHighLevel calls these sub-accounts) ----------
  let list = [];
  let onSwitch = () => {};
  const current = () => list.find((b) => String(b.id) === String(store.get('biz', ''))) || null;
  const badge = (b) => (b ? `<span class="biz-badge" style="--c:${h(b.color)}">${h(initials(b.name))}</span>` : `<span class="biz-badge all">${svg('grid')}</span>`);

  async function loadBusinesses() {
    list = await call('/businesses', { noBiz: true }).catch(() => []);
    // A business that was removed (or a new device) falls back to "All businesses".
    if (store.get('biz', '') && !current()) store.set('biz', '');
    drawSwitcher();
    return list;
  }
  function drawSwitcher() {
    const b = current();
    const html = `<button type="button" class="biz-btn" data-biz-open aria-haspopup="true">${badge(b)}
      <span class="biz-txt"><b>${h(b ? b.name : 'All businesses')}</b><small>Switch business</small></span>${svg('chev')}</button>`;
    ['#biz-slot', '#biz-slot-m'].forEach((s) => { const el = q$(s); if (el) el.innerHTML = html; });
    document.body.style.setProperty('--biz-c', b ? b.color : '');
  }
  function openSwitcher(anchor) {
    let pop = q$('#biz-pop');
    if (!pop) { pop = document.createElement('div'); pop.id = 'biz-pop'; pop.className = 'biz-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Switch business'); document.body.append(pop); }
    const cur = store.get('biz', '');
    const row = (b) => `<button type="button" data-pick="${b ? b.id : ''}" class="${String(cur) === String(b ? b.id : '') ? 'on' : ''}">${badge(b)}
      <span class="biz-txt"><b>${h(b ? b.name : 'All businesses')}</b><small>${b ? `${b.contacts} ${b.contacts === 1 ? 'person' : 'people'}` : 'See everything together'}</small></span></button>`;
    const draw = (needle = '') => {
      const shown = list.filter((b) => b.name.toLowerCase().includes(needle.toLowerCase()));
      q$('.biz-list', pop).innerHTML = (needle ? '' : row(null)) + (shown.map(row).join('') || '<p class="muted small" style="padding:8px 12px">No business with that name.</p>');
    };
    pop.innerHTML = `<label class="biz-search">${svg('search')}<input type="search" placeholder="Search your businesses" aria-label="Search your businesses"></label>
      <div class="biz-list"></div>
      <div class="biz-foot"><a href="#contacts/settings" data-add>${svg('plus')} Add a business</a></div>`;
    draw();
    const r = anchor.getBoundingClientRect();
    const phone = matchMedia('(max-width: 800px)').matches;
    pop.style.top = `${Math.round(r.bottom + 6)}px`;
    pop.style.left = phone ? '12px' : `${Math.round(r.left)}px`;
    pop.style.width = phone ? 'calc(100vw - 24px)' : `${Math.max(280, Math.round(r.width))}px`;
    pop.hidden = false;
    const input = q$('input', pop);
    input.oninput = () => draw(input.value.trim());
    if (!phone) input.focus();
    pop.onclick = (e) => {
      const pick = e.target.closest('[data-pick]');
      if (pick) { pop.hidden = true; switchTo(pick.dataset.pick); }
      if (e.target.closest('[data-add]')) { pop.hidden = true; store.set('add-biz', true); }
    };
  }
  function switchTo(id) {
    store.set('biz', id ? Number(id) : '');
    drawSwitcher();
    const b = current();
    say(b ? `Now showing ${b.name}.` : 'Now showing all your businesses together.');
    setTimeout(() => say(''), 2500);
    onSwitch();
  }
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-biz-open]');
    const pop = q$('#biz-pop');
    if (btn) { e.stopPropagation(); if (pop && !pop.hidden) pop.hidden = true; else openSwitcher(btn); return; }
    if (pop && !pop.hidden && !e.target.closest('#biz-pop')) pop.hidden = true;
  });
  document.addEventListener('keydown', (e) => { const pop = q$('#biz-pop'); if (e.key === 'Escape' && pop && !pop.hidden) pop.hidden = true; });

  // ---------- Launchpad ----------
  async function renderLaunchpad() {
    const root = q$('#lp-root');
    const [lp] = await Promise.all([call('/launchpad'), loadBusinesses()]);
    const done = lp.items.filter((x) => x.done).length;
    root.innerHTML = `<div class="lp-head"><div><h2>Let's get you set up</h2><p class="muted">Each item below is one thing that makes the CRM work for you. Green ones are done.</p></div>
        <div class="lp-progress" role="img" aria-label="${done} of ${lp.items.length} done"><b>${done} of ${lp.items.length}</b><span class="bar"><i style="width:${Math.round((done / lp.items.length) * 100)}%"></i></span></div></div>
      <div class="lp-list">${lp.items.map((x) => `<div class="lp-item ${x.done ? 'done' : ''}">
        <div class="lp-ico">${svg(x.key in I ? x.key : 'check')}</div>
        <div class="lp-body"><b>${h(x.title)}</b><p>${h(x.text)}</p></div>
        ${x.done ? `<span class="lp-ok">${svg('check')} Done</span>`
          : x.go ? `<a class="btn primary" href="${h(x.go)}">Do it</a>`
            : x.href ? `<a class="btn primary" href="${h(x.href)}">Open settings</a>`
              : x.phone ? '<button class="btn primary" data-phone>Turn on</button>'
                : `<button class="btn primary" data-how="${h(x.key)}">Connect</button>`}
      </div>`).join('')}</div>`;
    root.onclick = (e) => {
      if (e.target.closest('[data-phone]')) return phoneSetup();
      const b = e.target.closest('[data-how]');
      if (!b) return;
      const x = lp.items.find((i) => i.key === b.dataset.how);
      howTo(x);
    };
  }
  // Phone alerts: the free ntfy app listens to a private channel made just for you.
  async function phoneSetup() {
    const dlg = q$('#crm-edit-dialog');
    let r;
    try { r = await call('/phone-alerts', { method: 'POST' }); } catch (err) { return say(err.message, true); }
    dlg.innerHTML = `<h1>Turn on phone alerts</h1><p>Your phone buzzes when a new lead, form or booking comes in. It's free.</p>
      <ol class="lp-steps"><li>Get the free ntfy app: <a href="${h(r.app)}" target="_blank" rel="noopener">iPhone</a> or <a href="${h(r.android)}" target="_blank" rel="noopener">Android</a>. Allow notifications when it asks.</li>
        <li>In the app, tap <b>+</b> and type this name exactly (it's your private channel):<div class="lp-cmd"><code>${h(r.topic)}</code><button class="btn ghost" data-copy>Copy</button></div></li>
        <li>Tap <b>Subscribe</b>, then press the button below to test it.</li></ol>
      <div class="row"><button class="btn primary" data-test>Send a test buzz</button><button class="btn ghost" data-close>Done</button><span class="muted" id="ph-msg"></span></div>`;
    q$('[data-close]', dlg).onclick = () => { dlg.close(); renderLaunchpad(); };
    q$('[data-copy]', dlg).onclick = async (e) => { try { await navigator.clipboard.writeText(r.topic); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Select it and copy'; } };
    q$('[data-test]', dlg).onclick = async () => {
      const m = q$('#ph-msg', dlg); m.textContent = 'Sending…';
      try { const t = await call('/phone-alerts?test=1', { method: 'POST' }); m.textContent = t.sent ? 'Sent! Check your phone.' : 'Could not send right now. Try again in a minute.'; } catch (err) { m.textContent = err.message; }
    };
    dlg.showModal();
  }
  // The few things that need your Mac's Terminal: show the exact steps.
  function howTo(x) {
    const dlg = q$('#crm-edit-dialog');
    const cmd = x.how.replace(/^In Terminal on your Mac run: /, '');
    dlg.innerHTML = `<h1>Connect: ${h(x.title)}</h1><p>${h(x.text)}</p>
      <ol class="lp-steps"><li>On your iMac, open <b>Terminal</b>.</li>
        <li>Copy this line, paste it into Terminal and press Return:<div class="lp-cmd"><code>cd ~/social-scheduler && ${h(cmd)}</code><button class="btn ghost" data-copy>Copy</button></div></li>
        <li>Answer the questions it asks. When it's done, run <code>npm run background:on</code> so the CRM picks it up.</li>
        ${x.link ? `<li>On your iPhone, get the app here: <a href="${h(x.link)}" target="_blank" rel="noopener">${h(x.link)}</a></li>` : ''}</ol>
      <div class="row"><button class="btn primary" data-close>Got it</button></div>`;
    q$('[data-close]', dlg).onclick = () => dlg.close();
    q$('[data-copy]', dlg).onclick = async (e) => {
      try { await navigator.clipboard.writeText(`cd ~/social-scheduler && ${cmd}`); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Select it and copy'; }
    };
    dlg.showModal();
  }

  // ---------- Dashboard ----------
  const RANGES = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months'], ['all', 'All time']];
  const shortDay = (key, unit) => {
    if (unit === 'month') return new Date(`${key}-15T12:00`).toLocaleDateString([], { month: 'short' });
    return new Date(`${key}T12:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
  };
  function barsH(rows, { value = (r) => r.count, label = (r) => r.stage, text = (r) => String(value(r)), cls = '' } = {}) {
    const max = Math.max(1, ...rows.map(value));
    return `<div class="hbars ${cls}">${rows.map((r) => `<div class="hbar" title="${h(label(r))}: ${h(text(r))}">
      <span class="hb-label">${h(label(r))}</span><span class="hb-track"><i style="width:${value(r) ? Math.max(2, (value(r) / max) * 100) : 0}%"></i></span><span class="hb-val">${h(text(r))}</span></div>`).join('')}</div>`;
  }
  function columns(rows, unit) {
    const max = Math.max(1, ...rows.map((r) => r.count));
    const every = Math.ceil(rows.length / (matchMedia('(max-width: 800px)').matches ? 5 : 8));
    return `<div class="cols" style="--n:${rows.length}">${rows.map((r, i) => `<div class="col-c" title="${h(shortDay(r.key, unit))}: ${r.count} new ${r.count === 1 ? 'person' : 'people'}">
      <span class="cbar" style="height:${r.count ? Math.max(3, (r.count / max) * 100) : 0}%"></span>
      <span class="clabel">${i % every === 0 ? h(shortDay(r.key, unit)) : ''}</span></div>`).join('')}</div>
      <div class="cols-axis muted small"><span>0</span><span>Most in one ${unit}: ${max}</span></div>`;
  }
  function ring(pct) {
    const r = 52, c = 2 * Math.PI * r, v = pct == null ? 0 : pct;
    return `<svg viewBox="0 0 130 130" class="ring" role="img" aria-label="${pct == null ? 'No decided deals yet' : `${pct} percent won`}">
      <circle cx="65" cy="65" r="${r}" class="ring-bg"/><circle cx="65" cy="65" r="${r}" class="ring-fg" stroke-dasharray="${(v / 100) * c} ${c}" transform="rotate(-90 65 65)"/>
      <text x="65" y="72" text-anchor="middle">${pct == null ? '–' : `${pct}%`}</text></svg>`;
  }
  async function renderDashboard() {
    const root = q$('#db-root');
    const days = store.get('dash-days', '30');
    const d = await call(`/dashboard?days=${days}`);
    const t = d.totals;
    const b = current();
    const when = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    root.innerHTML = `<div class="db-bar"><span class="muted small">${b ? `Showing <b>${h(b.name)}</b>` : 'Showing <b>all businesses</b>'}</span>
        <label class="db-range">${svg('calendar')}<select id="db-days" aria-label="Date range">${RANGES.map(([v, l]) => `<option value="${v}"${v === String(days) ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <div class="tiles db-tiles">
        <div class="tile"><div class="label">New people</div><div class="value">${t.newPeople}</div><div class="muted small">${t.allPeople} in total</div></div>
        <div class="tile"><div class="label">Money still open</div><div class="value">${money(t.openValue)}</div><div class="muted small">${t.openCount} ${t.openCount === 1 ? 'deal' : 'deals'} not paid yet</div></div>
        <div class="tile"><div class="label">Money won</div><div class="value">${money(t.wonValue)}</div><div class="muted small">${t.wonCount} paid or done</div></div>
        <div class="tile"><div class="label">Booked calls</div><div class="value">${t.appointments}</div><div class="muted small">${t.formsFilled} forms filled · ${t.tasksDone} tasks done</div></div>
      </div>
      <div class="db-grid">
        <section class="db-card"><header><h3>Where people are</h3><span class="muted small">How many people are at each step</span></header>
          ${t.newPeople ? barsH(d.byStage) : '<p class="db-empty">Nobody was added in this time. Try a longer range at the top.</p>'}</section>
        <section class="db-card"><header><h3>Money at each step</h3><span class="muted small">Amounts added up for each step</span></header>
          ${d.byStage.some((s) => s.value) ? barsH(d.byStage, { value: (r) => r.value, text: (r) => money(r.value), cls: 'money' }) : '<p class="db-empty">No amounts yet. Add an amount on a person\'s card to see it here.</p>'}</section>
        <section class="db-card db-win"><header><h3>Win rate</h3><span class="muted small">Of the deals that are decided</span></header>
          ${ring(t.winRate)}<p class="muted small center">${t.wonCount} won · ${t.lostCount} not this year</p></section>
        <section class="db-card db-wide"><header><h3>New people over time</h3><span class="muted small">One bar for each ${d.unit}</span></header>
          ${t.newPeople ? columns(d.overTime, d.unit) : '<p class="db-empty">No new people in this time.</p>'}</section>
        <section class="db-card"><header><h3>Funnel</h3><span class="muted small">How many got to each step or further</span></header>
          ${t.newPeople ? barsH(d.funnel, { text: (r) => `${r.count} · ${d.funnel[0].count ? Math.round((r.count / d.funnel[0].count) * 100) : 0}%`, cls: 'funnel' }) : '<p class="db-empty">The funnel fills in as people come in.</p>'}</section>
        <section class="db-card"><header><h3>Where they came from</h3><span class="muted small">New people by group</span></header>
          ${d.byGroup.length ? barsH(d.byGroup, { label: (r) => r.group }) : '<p class="db-empty">No new people in this time.</p>'}</section>
        <section class="db-card"><header><h3>Coming up</h3><a href="#contacts/appointments" class="small">All appointments</a></header>
          ${d.upcoming.length ? `<ul class="db-list">${d.upcoming.map((a) => `<li><b>${h(when(a.starts_at))}</b><span>${h(a.contact_name || a.title)}</span></li>`).join('')}</ul>` : '<p class="db-empty">No calls booked yet.</p>'}
          <header style="margin-top:14px"><h3>To do today</h3><a href="#contacts/tasks" class="small">All tasks</a></header>
          ${d.due.length ? `<ul class="db-list">${d.due.map((x) => `<li><b>${h(x.title)}</b><span>${h(x.contact_name || '')}</span></li>`).join('')}</ul>` : '<p class="db-empty">Nothing due. Nice work!</p>'}</section>
      </div>`;
    q$('#db-days', root).onchange = (e) => { store.set('dash-days', e.target.value); renderDashboard(); };
  }

  // ---------- Settings ----------
  async function renderSettings(meta) {
    const root = q$('#set-root');
    await loadBusinesses();
    const allGroups = [...new Set([...(meta.allGroups || meta.groups || []), ...list.flatMap((b) => b.allGroups || [])])];
    root.innerHTML = `<div class="set-head"><div><h2>Your businesses</h2><p class="muted">Each business keeps its own people, pipeline, tasks, forms and appointments. Pick one with the switcher at the top of the menu.
        Email designs, templates and automations are shared by all of them.</p></div><button class="btn primary" data-new>+ Add a business</button></div>
      <div class="set-list">${list.map((b) => `<div class="set-biz" data-id="${b.id}">${badge(b)}
        <div class="set-info"><b>${h(b.name)}</b><span class="muted small">${b.contacts} ${b.contacts === 1 ? 'person' : 'people'} · groups: ${h((b.allGroups || []).join(', ') || 'none yet')}</span>
          <span class="muted small">${[b.phone, b.email, b.website].filter(Boolean).map(h).join(' · ') || 'No phone, email or website yet'}</span></div>
        <button class="btn ghost" data-edit>Edit</button></div>`).join('')}</div>
      <h2 style="margin-top:26px">Connections</h2>
      <p class="muted">Phone alerts, your email, Google Calendar and website forms are all on the <a href="#contacts/launchpad">Launchpad</a>, with a button for each one.</p>`;
    root.onclick = (e) => {
      if (e.target.closest('[data-new]')) return editBusiness(null, allGroups);
      const row = e.target.closest('.set-biz');
      if (row && e.target.closest('[data-edit]')) editBusiness(list.find((b) => b.id === Number(row.dataset.id)), allGroups);
    };
    if (store.get('add-biz', false)) { store.set('add-biz', false); editBusiness(null, allGroups); }
  }
  function editBusiness(b, allGroups) {
    const dlg = q$('#crm-edit-dialog');
    const mine = b ? (b.allGroups || b.groups) : [];
    const owner = (g) => list.find((x) => x !== b && (x.allGroups || x.groups).includes(g));
    const COLORS = ['#4f46e5', '#dc2626', '#0d9488', '#d97706', '#db2777', '#2563eb', '#16a34a', '#9333ea'];
    const color = b ? b.color : COLORS[list.length % COLORS.length];
    dlg.innerHTML = `<form id="biz-form"><h1>${b ? `Edit ${h(b.name)}` : 'Add a business'}</h1>
      <label class="field"><span>Business name</span><input name="name" required maxlength="80" value="${h(b ? b.name : '')}" placeholder="e.g. Viral Attraction" style="width:100%"></label>
      <div class="field"><span>Color</span><div class="biz-colors">${COLORS.map((c) => `<label><input type="radio" name="color" value="${c}"${c === color ? ' checked' : ''}><i style="--c:${c}" title="${c}"></i></label>`).join('')}</div></div>
      <div class="biz-two"><label class="field"><span>Phone</span><input name="phone" type="tel" value="${h(b ? b.phone || '' : '')}"></label>
        <label class="field"><span>Email</span><input name="email" type="email" value="${h(b ? b.email || '' : '')}"></label></div>
      <label class="field"><span>Website</span><input name="website" value="${h(b ? b.website || '' : '')}" placeholder="https://" style="width:100%"></label>
      <label class="field"><span>Address</span><input name="address" value="${h(b ? b.address || '' : '')}" style="width:100%"></label>
      <div class="field"><span>Which groups of people belong to this business?</span>
        <p class="muted small" style="margin:0 0 6px">People, forms and booking pages in these groups show up under this business. A group can only belong to one business.</p>
        <div class="biz-groups">${allGroups.map((g) => `<label class="bg-row"><input type="checkbox" name="groups" value="${h(g)}"${mine.includes(g) ? ' checked' : ''}><span>${h(g)}${owner(g) && !mine.includes(g) ? `<small class="muted">Now in ${h(owner(g).name)}</small>` : ''}</span></label>`).join('')}</div>
        <input name="newgroup" placeholder="Add a new group, e.g. Car wash customer" style="width:100%;margin-top:6px"></div>
      <div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Cancel</button>
        ${b && list.length > 1 ? '<button class="btn ghost danger" type="button" data-del style="margin-left:auto">Remove business</button>' : ''}</div>
      <p class="muted" id="biz-msg"></p></form>`;
    q$('[data-close]', dlg).onclick = () => dlg.close();
    const del = q$('[data-del]', dlg);
    if (del) del.onclick = async () => {
      if (!confirm(`Remove ${b.name}? Nobody is deleted. Its people and groups move to another business.`)) return;
      try { const r = await call(`/businesses/${b.id}`, { method: 'DELETE', noBiz: true }); dlg.close(); say(`Removed. Its people are now under ${r.movedTo}.`); onSwitch(); }
      catch (err) { q$('#biz-msg', dlg).textContent = err.message; }
    };
    q$('#biz-form', dlg).onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const groups = f.getAll('groups');
      const extra = String(f.get('newgroup') || '').trim();
      if (extra) groups.push(extra);
      const body = { name: f.get('name'), color: f.get('color'), phone: f.get('phone'), email: f.get('email'), website: f.get('website'), address: f.get('address'), groups };
      try {
        const saved = await call(b ? `/businesses/${b.id}` : '/businesses', { method: b ? 'PUT' : 'POST', json: body, noBiz: true });
        dlg.close();
        if (!b) { store.set('biz', saved.id); say(`Added ${saved.name}. You're now looking at it.`); }
        onSwitch();
      } catch (err) { q$('#biz-msg', dlg).textContent = err.message; }
    };
    dlg.showModal();
  }

  window.VTHome = {
    init(fn) { onSwitch = fn; return loadBusinesses(); },
    current, loadBusinesses, renderLaunchpad, renderDashboard, renderSettings,
  };
})();
