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

  let meta = { groups: [], stages: [] };
  let tab = 'list';
  let timer;

  async function renderContacts(sub) {
    tab = ['pipeline', 'tasks', 'appointments', 'forms', 'templates', 'automations'].includes(sub) ? sub : 'list';
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
      ['Contacts', s.total], ['To-dos due', s.due + s.tasksDue], ['Committed (not paid yet)', money(s.pledged)], ['Paid', money(s.paid)], ['OK to email', s.emailable],
    ].map(([l, v]) => `<div class="tile"><div class="label">${l}</div><div class="value">${v ?? 0}</div></div>`).join('');
    await ({ list: renderList, pipeline: renderBoard, tasks: renderTasks, appointments: renderAppointments, forms: renderForms, templates: renderTemplates, automations: renderAutomations }[tab])();
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
      <td><b>${h(c.name)}</b>${c.company && c.company !== c.name ? `<div class="muted">${h(c.company)}</div>` : ''}${c.do_not_contact ? ' <span class="pill" style="color:var(--bad)">Do not contact</span>' : ''}</td>
      <td><span class="pill">${h(c.group_name)}</span></td>
      <td>${h(c.stage)}</td>
      <td>${money(c.amount)}</td>
      <td>${c.phone ? `<a href="tel:${h(c.phone)}">${h(c.phone)}</a><br>` : ''}${c.email ? `<a href="mailto:${h(c.email)}">${h(c.email)}</a>${c.email_ok ? ' ✓' : ''}` : ''}</td>
      <td class="${dueClass(c.next_follow_up)}">${niceDate(c.next_follow_up)}</td>
    </tr>`).join('') || `<tr><td colspan="6" class="muted">${meta.summary.total ? 'No contacts match.' : 'No contacts yet. Click "+ Add contact", import a spreadsheet saved as CSV, or share a sign-up form.'}</td></tr>`;
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
      return `<div class="col" data-stage="${h(st)}"><h3>${h(st)}</h3><div class="muted">${cards.length} · ${money(total)}</div>
        ${cards.map((c) => `<div class="card" draggable="true" data-id="${c.id}"><b>${h(c.company || c.name)}</b>
          ${c.company && c.company !== c.name ? `<div>${h(c.name)}</div>` : ''}
          ${c.amount ? `<div class="amt">${money(c.amount)}</div>` : ''}
          <div class="meta"><span class="pill">${h(c.group_name)}</span>${c.next_follow_up ? ` <span class="${dueClass(c.next_follow_up)}">${niceDate(c.next_follow_up)}</span>` : ''}</div></div>`).join('')}
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
    <span class="${t.done_at ? 'muted' : dueClass(t.due_on)}">${niceDate(t.due_on)}</span>
    <button class="x" data-edit title="Edit">✎</button><button class="x" data-del title="Delete">×</button></li>`;
  async function renderTasks() {
    const tasks = await call(`/tasks${q$('#task-show-done').checked ? '' : '?open=1'}`);
    q$('#task-list').innerHTML = tasks.map((t) => taskRow(t)).join('') || '<li class="muted">No tasks. Click "+ Task" to add one.</li>';
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
    const siteCard = !site ? '' : `<div class="item" style="grid-column:1/-1">
        <b>Your website's forms</b> ${site.connected ? (site.lastError ? '<span class="pill" style="color:var(--bad)">Problem</span>' : '<span class="pill">Connected</span>') : '<span class="pill">Not set up</span>'}
        ${site.connected
          ? `<div class="muted">Sign-ups from your website land in <b>${h(site.group)}</b> within about 2 minutes, and your phone gets an alert. ${site.imported} so far.${site.lastCheck ? ` Last checked ${h(new Date(site.lastCheck.replace(' ', 'T') + 'Z').toLocaleString())}.` : ''}</div>
            ${site.lastError ? `<div class="muted" style="color:var(--bad)">${h(site.lastError)}</div>` : ''}
            <details style="margin-top:6px"><summary>Code for your website</summary><p class="muted">Paste this once into your website's "custom code" spot for every page (or before &lt;/body&gt;). Your forms keep working as before; this just copies each sign-up here.</p>
            <textarea readonly rows="6" style="width:100%;font:12px ui-monospace,monospace">${h(site.snippet)}</textarea>
            <div class="row"><button class="btn" data-site-copy>Copy code</button></div></details>
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
        q$('[data-site-msg]').textContent = r.error ? r.error : `Done: ${r.added || 0} new, ${r.updated || 0} updated.`;
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
    dlg.innerHTML = `<form id="tpl-form"><h1>${t.id ? 'Edit template' : 'New template'}</h1>
      <label class="field"><span>Name</span><input name="name" required value="${h(t.name)}" style="width:100%"></label>
      <label class="field"><span>Type</span><select name="channel"><option value="email"${t.channel !== 'text' ? ' selected' : ''}>Email</option><option value="text"${t.channel === 'text' ? ' selected' : ''}>Text message</option></select></label>
      <label class="field"><span>Subject <small>(email only)</small></span><input name="subject" value="${h(t.subject)}" style="width:100%"></label>
      <label class="field"><span>Message <small>{first_name}, {name}, {company} are filled in for you</small></span><textarea name="body" rows="8" required>${h(t.body)}</textarea></label>
      <div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Cancel</button><span class="muted" id="tpl-msg"></span></div></form>`;
    q$('[data-close]', dlg).onclick = () => dlg.close();
    q$('#tpl-form', dlg).onsubmit = async (e) => {
      e.preventDefault();
      try { await call(t.id ? `/templates/${t.id}` : '/templates', { method: t.id ? 'PUT' : 'POST', json: Object.fromEntries(new FormData(e.target)) }); dlg.close(); refresh(); }
      catch (err) { q$('#tpl-msg', dlg).textContent = err.message; }
    };
    dlg.showModal();
  }

  // ---------- Automations ----------
  const STEP_NAMES = { alert: 'Buzz my phone', task: 'Make a task', stage: 'Move to stage', group: 'Put in group', follow_up: 'Set next follow-up', note: 'Add a note', wait: 'Wait' };
  const stepText = (s, tpls) => ({
    alert: () => `Buzz my phone: "${s.title}"`,
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
    q$('#auto-list').innerHTML = data.automations.map((a) => `<div class="item" data-auto="${a.id}">
      <b>${h(a.name)}</b> ${a.active ? '<span class="pill">On</span>' : '<span class="pill" style="color:var(--bad)">Off</span>'}
      <div class="muted"><b>When:</b> ${h(triggerText(a.trigger, data.triggers))}</div>
      <ol style="margin:6px 0 6px 18px;padding:0">${a.steps.map((s) => `<li>${h(stepText(s, tpls))}</li>`).join('')}</ol>
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
        <label class="field"><span>In group</span><input name="group" list="auto-groups" value="${h(a.trigger.group || '')}" placeholder="any group"></label>
        <label class="field"><span id="auto-stage-label">Stage</span><select name="stage"></select></label>
        <label class="field" id="auto-form-field"><span>Form name has <small>(optional)</small></span><input name="form" value="${h(a.trigger.form || '')}" placeholder="e.g. sponsor"></label>
      </div>
      <datalist id="auto-groups">${meta.groups.map((g) => `<option value="${h(g)}">`).join('')}</datalist>
      <div class="field"><span>Then do these steps, in order</span><ol id="auto-steps" style="list-style:none;padding:0;margin:0"></ol>
        <div class="row"><select id="auto-step-type">${Object.entries(STEP_NAMES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><button type="button" class="btn ghost" id="auto-step-add">+ Add step</button></div></div>
      <p class="muted small">Fill-ins: {first_name}, {name}, {company}, {email}, {phone}, {group}, {stage}, {form}, {when} (appointment time). Nothing is ever emailed or texted automatically.</p>
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
      steps.push({ alert: { type, title: 'Viral Touch CRM', message: '{name}' }, task: { type, title: '', due_days: 0 }, stage: { type, stage: meta.stages[1] }, group: { type, group: '' },
        follow_up: { type, days: 1 }, note: { type, note: '' }, wait: { type, amount: 1, unit: 'days', if_stage: '' } }[type]);
      drawSteps();
    };
    q$('[data-close]', dlg).onclick = () => dlg.close();
    q$('#auto-form', dlg).onsubmit = async (e) => {
      e.preventDefault();
      const v = (n) => q$(`[name=${n}]`, e.target);
      const json = { name: v('name').value, active: v('active').checked, steps: steps.map((s) => ({ ...s, template_id: s.template_id ? Number(s.template_id) : null })),
        trigger: { type: v('type').value, group: v('group').value, stage: v('stage').value, form: v('form').value } };
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
