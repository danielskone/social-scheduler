// Viral Touch CRM: Facebook & Instagram messages settings (Conversations), the chat answer bot
// (Chat bubble settings), the Tasks board (To do, Doing, Done) and Business templates (Settings).
(() => {
  const q$ = (s, el = document) => el.querySelector(s);
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(`vtcrm-${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`vtcrm-${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  async function call(path, opts = {}) {
    if (opts.json) { opts.body = JSON.stringify(opts.json); opts.headers = { 'Content-Type': 'application/json' }; delete opts.json; }
    const b = opts.noBiz ? '' : store.get('biz', '');
    const url = `/api/crm${path}`;
    const res = await fetch(b ? `${url}${url.includes('?') ? '&' : '?'}biz=${encodeURIComponent(b)}` : url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { data });
    return data;
  }
  const say = (msg, err) => { const el = q$('#banner'); el.textContent = msg; el.className = `banner${err ? ' error' : ''}`; el.hidden = !msg; if (msg && !err) setTimeout(() => { if (el.textContent === msg) el.hidden = true; }, 4000); };
  const I = {
    fb: '<circle cx="12" cy="12" r="8.5"/><path d="M13.2 20.4v-6.2h2.3l.4-2.7h-2.7V9.8c0-.8.3-1.3 1.4-1.3h1.4V6.1c-.3 0-1.1-.1-2.1-.1-2.1 0-3.4 1.2-3.4 3.5v2h-2.3v2.7h2.3v6.2"/>',
    ig: '<rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.8" cy="7.2" r=".6"/>',
    bot: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V5M9.5 13h.01M14.5 13h.01M9.5 16h5"/><circle cx="12" cy="4.3" r="1"/>',
    copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15V6a1 1 0 0 1 1-1h9"/>',
    flag: '<path d="M6 21V4M6 4h10l-2 4 2 4H6"/>',
    note: '<path d="M6 4h12v16H6zM9 9h6M9 13h6M9 17h3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    down: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    up: '<path d="M12 15V4M7 9l5-5 5 5M5 20h14"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  };
  const svg = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;
  const dlg = () => { const d = q$('#crm-edit-dialog'); d.classList.remove('wide'); d.onclick = null; return d; };
  const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not yet');
  const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

  // ======================= Facebook & Instagram messages =======================
  async function socialSettings(onDone) {
    const s = await call('/social');
    const d = dlg();
    d.innerHTML = `<div class="chat-set soc-set"><header class="view-head"><h1>${svg('fb')} Facebook &amp; Instagram messages</h1><button class="btn ghost" type="button" data-close>Close</button></header>
      <p class="muted">Messages people send to your Facebook Pages and Instagram accounts show up in <b>Conversations</b>, and your iPhone buzzes. Answer from here within 24 hours of their last message (Facebook's rule). New people become contacts by themselves.</p>
      ${s.accounts.length ? `<div class="soc-list">${s.accounts.map((a) => `<div class="soc-row" data-acc="${a.id}">
          <span class="soc-ico ${a.platform}">${svg(a.platform === 'instagram' ? 'ig' : 'fb')}</span>
          <div class="soc-info"><b>${h(a.platform === 'instagram' ? `@${a.username || a.name}` : a.name)}</b>
            <span class="muted small">${a.platform === 'instagram' ? `Instagram, through ${h(a.page_name || 'its Page')}` : 'Facebook Page (Messenger)'} · checked ${h(when(a.last_check))}</span>
            ${a.last_error ? `<span class="soc-err">${h(a.last_error)}</span>` : ''}
            ${a.can ? '' : '<span class="soc-err">This Instagram account is not linked to a Facebook Page you connected.</span>'}
            <label class="soc-group"><span class="muted small">New people go in</span><select data-group>${['', ...s.groups].map((g) => `<option value="${h(g)}"${g === (a.group_name || '') ? ' selected' : ''}>${g ? h(g) : 'the first group'}</option>`).join('')}</select></label></div>
          <label class="check soc-on" title="Read messages for this account"><input type="checkbox" data-on ${a.enabled ? 'checked' : ''}> On</label></div>`).join('')}</div>`
        : `<div class="pay-setup">${svg('fb')}<div><b>No Facebook Page connected yet</b><span>Connect Facebook &amp; Instagram in Viral Post first. Then come back here.</span></div></div>`}
      <h2>One-time steps</h2>
      <ol class="soc-steps">
        <li>After installing this update, open Viral Post and press <b>Reconnect</b> on Facebook &amp; Instagram, so Facebook asks you to allow messages.</li>
        <li>On Instagram, open <b>Settings, Messages and story replies, Message controls</b>, and turn on <b>Allow access to messages</b> (it is under Connected tools).</li>
        <li>While your Meta app is in Development mode, Facebook only shows messages from people who have a role on the app (you and your testers). Messages from everyone show up after Meta approves the app in App Review.</li>
      </ol>
      <div class="row"><button class="btn primary" type="button" data-check>Check for messages now</button><span class="muted" id="soc-msg"></span></div></div>`;
    if (!d.open) d.showModal();
    d.onclick = async (e) => {
      if (e.target.closest('[data-close]')) { d.close(); if (onDone) onDone(); return; }
      if (e.target.closest('[data-check]')) {
        const m = q$('#soc-msg', d); m.textContent = 'Checking...';
        try { const r = await call('/social/check', { method: 'POST' }); m.textContent = r.added ? `${r.added} new message${r.added === 1 ? '' : 's'}.` : r.ok ? 'No new messages.' : 'Some accounts could not be read. See the red notes.'; setTimeout(() => socialSettings(onDone), 900); }
        catch (err) { m.textContent = err.message; }
      }
    };
    d.querySelectorAll('.soc-row').forEach((row) => {
      const id = row.dataset.acc;
      q$('[data-on]', row).onchange = (e) => call(`/social/accounts/${id}`, { method: 'PUT', json: { enabled: e.target.checked } }).then(() => say('Saved.')).catch((err) => say(err.message, true));
      q$('[data-group]', row).onchange = (e) => call(`/social/accounts/${id}`, { method: 'PUT', json: { group_name: e.target.value } }).then(() => say('Saved.')).catch((err) => say(err.message, true));
    });
  }

  // ======================= Chat answer bot (inside Chat bubble settings) =======================
  function faqEditor(box, s) {
    const draw = (st) => {
      box.innerHTML = `<h2>${svg('bot')} Answer bot <span class="pay-pill" style="--c:#16a34a">Free</span></h2>
        <p class="muted small">Answers common questions by itself, any time of day, from your own list below. When it doesn't know, it tells them a person will answer soon. It goes quiet for 30 minutes after you answer someone yourself.</p>
        <label class="check"><input type="checkbox" id="bot-on" ${st.bot_on ? 'checked' : ''}> The answer bot is on</label>
        <label class="field"><span>When it doesn't know the answer</span><input id="bot-fallback" maxlength="300" value="${h(st.bot_fallback)}" style="width:100%"></label>
        <div class="faq-list">${st.faq.map((f) => `<div class="faq-row" data-faq="${f.id}"><div><b>${h(f.question)}</b><p>${h(f.answer)}</p>${f.keywords ? `<span class="muted small">Also matches: ${h(f.keywords)}</span>` : ''}</div>
            <span class="muted small faq-hits">${f.hits ? `Answered ${f.hits}×` : ''}</span><button class="btn ghost" type="button" data-faq-edit>Edit</button></div>`).join('')
          || '<p class="muted small">No questions yet. Add the ones people ask you most, like your hours, prices and where you are.</p>'}</div>
        <div class="row"><button class="btn" type="button" data-faq-new>${svg('plus')}<span>Add a question</span></button><button class="btn ghost" type="button" data-bot-save>Save bot settings</button></div>
        <div class="faq-try"><label class="field"><span>Try it: type a question like a customer would</span><input id="faq-try" placeholder="e.g. when are you open?" style="width:100%"></label><div id="faq-try-out" class="muted small"></div></div>`;
    };
    draw(s);
    const editOne = (f) => {
      const row = f ? q$(`[data-faq="${f.id}"]`, box) : null;
      const html = `<form class="faq-form"><label class="field"><span>Question people ask</span><input name="question" required maxlength="200" value="${h(f ? f.question : '')}" placeholder="e.g. What are your hours?" style="width:100%"></label>
        <label class="field"><span>Your answer</span><textarea name="answer" required maxlength="1500" rows="3" style="width:100%">${h(f ? f.answer : '')}</textarea></label>
        <label class="field"><span>Other words people might use <small class="muted">(optional, with commas)</small></span><input name="keywords" maxlength="300" value="${h(f ? f.keywords || '' : '')}" placeholder="open, close, hours" style="width:100%"></label>
        <div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-cancel>Cancel</button>${f ? '<button class="btn ghost danger" type="button" data-del style="margin-left:auto">Delete</button>' : ''}<span class="muted" data-msg></span></div></form>`;
      const holder = document.createElement('div');
      holder.innerHTML = html;
      const form = holder.firstElementChild;
      if (row) row.replaceWith(form); else q$('.faq-list', box).append(form);
      form.question.focus();
      form.onsubmit = async (e) => {
        e.preventDefault();
        try { const st = await call(f ? `/chat/faq/${f.id}` : '/chat/faq', { method: f ? 'PUT' : 'POST', json: Object.fromEntries(new FormData(form)) }); s = st; draw(st); say('Saved.'); }
        catch (err) { q$('[data-msg]', form).textContent = err.message; }
      };
      q$('[data-cancel]', form).onclick = () => draw(s);
      const del = q$('[data-del]', form);
      if (del) del.onclick = async () => { if (!confirm('Delete this question?')) return; s = await call(`/chat/faq/${f.id}`, { method: 'DELETE' }); draw(s); };
    };
    box.onclick = async (e) => {
      if (e.target.closest('[data-faq-new]')) return editOne(null);
      const r = e.target.closest('[data-faq]');
      if (r && e.target.closest('[data-faq-edit]')) return editOne(s.faq.find((f) => f.id === Number(r.dataset.faq)));
      if (e.target.closest('[data-bot-save]')) {
        try { s = await call('/chat/settings', { method: 'PUT', json: { bot_on: q$('#bot-on', box).checked, bot_fallback: q$('#bot-fallback', box).value } }); draw(s); say('Answer bot saved.'); }
        catch (err) { say(err.message, true); }
      }
    };
    let t;
    box.oninput = (e) => {
      if (e.target.id !== 'faq-try') return;
      clearTimeout(t);
      t = setTimeout(async () => {
        const out = q$('#faq-try-out', box), v = e.target.value.trim();
        if (!v) { out.textContent = ''; return; }
        const r = await call('/chat/faq-test', { method: 'POST', json: { text: v } }).catch(() => ({}));
        out.innerHTML = r.answer ? `${svg('check')} <b>It would answer</b> (${h(r.question)}): ${h(r.answer)}` : 'No match. It would say a person will answer soon. Add a question or more words to match this.';
      }, 300);
    };
  }

  // ======================= Tasks board =======================
  let boardCtx = null;
  const COLS = [['todo', 'To do', '#4f46e5'], ['doing', 'Doing', '#d97706'], ['done', 'Done', '#16a34a']];
  const today = () => new Date().toLocaleDateString('en-CA');
  const niceDay = (s) => new Date(`${s}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
  async function renderBoard(ctx) {
    boardCtx = ctx;
    const root = q$('#task-board');
    const view = store.get('task-view', 'board');
    const who = store.get('task-who', '');
    const d = await call(`/taskboard/board${who ? `?who=${encodeURIComponent(who)}` : ''}`);
    const admin = window.VTMore && window.VTMore.isAdmin ? window.VTMore.isAdmin() : true;
    const sum = d.summary;
    const team = d.people.length > 1;
    const top = `<div class="tb-top">
        <div class="seg" role="group" aria-label="View"><button type="button" data-view="board" class="${view === 'board' ? 'on' : ''}">Board</button><button type="button" data-view="list" class="${view === 'list' ? 'on' : ''}">List</button></div>
        ${team ? `<select id="tb-who" aria-label="Whose tasks"><option value="">Everyone's tasks</option><option value="me"${who === 'me' ? ' selected' : ''}>My tasks</option>
          ${d.people.filter((p) => p.id).map((p) => `<option value="${p.id}"${String(p.id) === String(who) ? ' selected' : ''}>${h(p.name)}</option>`).join('')}</select>` : ''}
        <span class="tb-sum"><b>${sum.open}</b> open${sum.late ? ` · <b class="overdue">${sum.late}</b> late` : ''}${sum.today ? ` · <b class="due-today">${sum.today}</b> today` : ''} · <b>${sum.doneWeek}</b> done this week</span>
        ${admin ? `<label class="check tb-mail" title="${d.settings.emailReady ? '' : 'Set up email on Launchpad first'}"><input type="checkbox" id="tb-daily" ${d.settings.daily ? 'checked' : ''} ${d.settings.emailReady ? '' : 'disabled'}> Email ${team ? 'everyone their' : 'me my'} tasks at 7 AM</label>` : ''}
      </div>`;
    if (view !== 'board') { root.innerHTML = top; wireTop(root); return false; }
    const day = today();
    const card = (t) => {
      const late = !t.done_at && t.due_on && t.due_on < day, now = !t.done_at && t.due_on === day;
      return `<article class="tb-card${t.priority ? ' important' : ''}${t.done_at ? ' done' : ''}" draggable="true" data-task="${t.id}">
        <div class="tb-row1"><button class="tb-tick" type="button" data-tick aria-label="${t.done_at ? 'Mark not done' : 'Mark done'}">${svg('check')}</button><b class="tb-title">${h(t.title)}</b>${t.priority ? `<span class="tb-flag" title="Important">${svg('flag')}</span>` : ''}</div>
        ${t.contact_name ? `<a href="#" class="tb-who-link" data-open="${t.contact_id}">${h(t.contact_name)}</a>` : ''}
        <div class="tb-row2">${t.due_on ? `<span class="when-chip ${late ? 'overdue' : now ? 'due-today' : ''}">${late ? `Late · ${niceDay(t.due_on)}` : now ? 'Today' : niceDay(t.due_on)}</span>` : '<span class="muted small">No date</span>'}
          ${t.notes ? `<span class="tb-note" title="${h(t.notes)}">${svg('note')}</span>` : ''}
          ${team ? `<span class="tb-av" title="${h(t.assigned_name || 'You (owner)')}">${h(initials(t.assigned_name || 'Me'))}</span>` : ''}</div>
        <div class="tb-move">${COLS.filter(([k]) => k !== t.status).map(([k, n]) => `<button type="button" data-move="${k}">${k === 'done' ? svg('check') : ''}${n}</button>`).join('')}</div>
      </article>`;
    };
    root.innerHTML = `${top}<div class="tb">${COLS.map(([k, n, c]) => {
      const list = d.tasks.filter((t) => t.status === k);
      return `<section class="tb-col" data-col="${k}" style="--c:${c}"><header><span class="tb-dot"></span><b>${n}</b><span class="tb-count">${list.length}</span>
          ${k !== 'done' ? `<button class="btn ghost tb-add" type="button" data-add="${k}" aria-label="Add a task to ${n}">${svg('plus')}</button>` : ''}</header>
        <div class="tb-cards">${list.map(card).join('') || `<p class="tb-empty">${k === 'todo' ? 'Nothing to do. Nice!' : k === 'doing' ? 'Drag a task here when you start it.' : 'Finished tasks from the last 2 weeks.'}</p>`}</div></section>`;
    }).join('')}</div>`;
    wireTop(root);
    const all = d.tasks;
    const move = async (id, status) => { try { await call(`/tasks/${id}`, { method: 'PUT', json: { status } }); renderBoard(ctx); } catch (err) { say(err.message, true); } };
    root.querySelector('.tb').onclick = (e) => {
      const open = e.target.closest('[data-open]');
      if (open) { e.preventDefault(); return ctx.openContact(Number(open.dataset.open)); }
      const add = e.target.closest('[data-add]');
      if (add) return ctx.editTask({ status: add.dataset.add, assigned_to: who && who !== 'me' ? Number(who) : null }, () => renderBoard(ctx));
      const c = e.target.closest('[data-task]');
      if (!c) return;
      const t = all.find((x) => x.id === Number(c.dataset.task));
      if (e.target.closest('[data-tick]')) return move(t.id, t.done_at ? 'todo' : 'done');
      const m = e.target.closest('[data-move]');
      if (m) return move(t.id, m.dataset.move);
      ctx.editTask(t, () => renderBoard(ctx));
    };
    // Drag and drop between columns (mouse); on a phone, use the buttons on each card.
    let dragId = null;
    root.querySelectorAll('.tb-card').forEach((c) => {
      c.ondragstart = (e) => { dragId = c.dataset.task; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); };
      c.ondragend = () => { c.classList.remove('dragging'); root.querySelectorAll('.tb-col').forEach((x) => x.classList.remove('over')); };
    });
    root.querySelectorAll('.tb-col').forEach((col) => {
      col.ondragover = (e) => { if (!dragId) return; e.preventDefault(); col.classList.add('over'); };
      col.ondragleave = (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); };
      col.ondrop = (e) => { e.preventDefault(); col.classList.remove('over'); const t = all.find((x) => String(x.id) === String(dragId)); dragId = null; if (t && t.status !== col.dataset.col) move(t.id, col.dataset.col); };
    });
    return true;
  }
  function wireTop(root) {
    root.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => { store.set('task-view', b.dataset.view); boardCtx.after(); }));
    const w = q$('#tb-who', root); if (w) w.onchange = () => { store.set('task-who', w.value); boardCtx.after(); };
    const m = q$('#tb-daily', root); if (m) m.onchange = () => call('/taskboard/settings', { method: 'PUT', json: { daily: m.checked } }).then(() => say(m.checked ? 'Daily task email is on.' : 'Daily task email is off.')).catch((err) => say(err.message, true));
  }

  // ======================= Business templates (Settings) =======================
  const WHAT = [['groups', 'group'], ['pipelines', 'pipeline'], ['fields', 'custom field'], ['forms', 'form'], ['booking', 'booking page'], ['sites', 'web page'], ['products', 'product'], ['templates', 'email'], ['automations', 'automation'], ['smart_lists', 'smart list'], ['faq', 'bot answer']];
  const inside = (c) => WHAT.filter(([k]) => c[k]).map(([k, n]) => `${c[k]} ${n}${c[k] === 1 ? '' : 's'}`).join(' · ') || 'Empty';
  async function templatesSection(box, onDone) {
    if (!box) return;
    const admin = window.VTMore && window.VTMore.isAdmin ? window.VTMore.isAdmin() : true;
    if (!admin) { box.innerHTML = ''; return; }
    const list = await call('/biztemplates', { noBiz: true });
    const cur = window.VTHome && window.VTHome.current ? window.VTHome.current() : null;
    box.innerHTML = `<div class="set-head" style="margin-top:26px"><div><h2>Business templates</h2><p class="muted">Copy a whole setup (groups, pipeline, forms, booking pages, web pages, products, emails, automations and the answer bot) into a new business in one click. People and payments are never copied. Great for a new customer.</p></div>
        <div class="row"><button class="btn" type="button" data-up>${svg('up')}<span>Load a template file</span></button>${cur ? `<button class="btn primary" type="button" data-capture>Save ${h(cur.name)} as a template</button>` : ''}</div></div>
      <input type="file" id="tpl-file" accept=".json,application/json" hidden>
      <div class="set-list">${list.map((t) => `<div class="set-biz tpl-row" data-tpl="${h(t.id)}"><span class="set-ico">${svg(t.starter ? 'bot' : 'copy')}</span>
          <div class="set-info"><b>${h(t.name)}</b>${t.starter ? ' <span class="pay-pill" style="--c:#0d9488">Ready-made</span>' : ''}<span class="muted small">${h(t.description || '')}</span><span class="muted small">${h(inside(t.counts))}</span></div>
          <a class="btn ghost" href="/api/crm/biztemplates/${encodeURIComponent(t.id)}/download" download title="Download as a file for a customer's own copy">${svg('down')}<span class="tpl-dl">File</span></a>
          ${t.starter ? '' : '<button class="btn ghost" type="button" data-del aria-label="Delete template">×</button>'}
          <button class="btn primary" type="button" data-use>Use</button></div>`).join('')}</div>`;
    box.onclick = async (e) => {
      if (e.target.closest('[data-capture]')) {
        const name = prompt('Name this template', `${cur.name} setup`);
        if (!name) return;
        try { await call('/biztemplates/capture', { method: 'POST', json: { business_id: cur.id, name }, noBiz: true }); say('Template saved.'); templatesSection(box, onDone); } catch (err) { say(err.message, true); }
        return;
      }
      if (e.target.closest('[data-up]')) return q$('#tpl-file', box).click();
      const row = e.target.closest('[data-tpl]');
      if (!row) return;
      const t = list.find((x) => String(x.id) === row.dataset.tpl);
      if (e.target.closest('[data-del]')) {
        if (!confirm(`Delete the template "${t.name}"? Businesses already made from it stay.`)) return;
        await call(`/biztemplates/${t.id}`, { method: 'DELETE', noBiz: true }); return templatesSection(box, onDone);
      }
      if (e.target.closest('[data-use]')) useTemplate(t, onDone);
    };
    q$('#tpl-file', box).onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        await call('/biztemplates/upload', { method: 'POST', json: { data }, noBiz: true });
        say('Template loaded. Press Use to start a business from it.'); templatesSection(box, onDone);
      } catch (err) { say(err instanceof SyntaxError ? 'That file is not a Viral Touch template.' : err.message, true); }
    };
  }
  async function useTemplate(t, onDone) {
    const info = await call(`/biztemplates/${encodeURIComponent(t.id)}`, { noBiz: true });
    const d = dlg();
    const li = (label, arr) => (arr && arr.length ? `<li><b>${label}:</b> ${arr.map(h).join(', ')}</li>` : '');
    d.innerHTML = `<form id="tpl-use"><h1>Start a business from "${h(info.name)}"</h1>
      <p class="muted">${h(info.description || '')}</p>
      <ul class="tpl-what">${li('Groups', info.groups)}${li('Pipelines', info.pipelines)}${li('Forms', info.forms)}${li('Booking pages', info.booking)}${li('Automations', info.automations)}</ul>
      <label class="field"><span>New business name</span><input name="name" required maxlength="80" placeholder="e.g. Shine Detailing" style="width:100%"></label>
      <p class="muted small">Automations start as <b>Draft</b>, so nothing is sent until you look them over and press Publish. Web pages start unpublished. If a group name is already used, the business name is added after it.</p>
      <div class="row"><button class="btn primary">Make the business</button><button class="btn ghost" type="button" data-close>Cancel</button><span class="muted" id="tpl-msg"></span></div></form>`;
    if (!d.open) d.showModal();
    q$('[data-close]', d).onclick = () => d.close();
    q$('#tpl-use', d).onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await call('/biztemplates/apply', { method: 'POST', json: { id: t.id, name: e.target.name.value }, noBiz: true });
        d.close();
        store.set('biz', r.business.id);
        say(`Made ${r.business.name}. You're now looking at it.`);
        if (onDone) onDone(r);
      } catch (err) { q$('#tpl-msg', d).textContent = err.message; }
    };
  }

  window.VTExtra7 = { socialSettings, faqEditor, renderBoard, templatesSection };
})();
