// Conversations (email inbox inside the CRM). Loaded before crm.js, which calls window.VTInbox.
// List of people who emailed on the left, the emails with one person on the right, and a reply box.
(() => {
  const q$ = (s, el = document) => el.querySelector(s);
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PALETTE = ['#4f46e5', '#db2777', '#0891b2', '#d97706', '#16a34a', '#9333ea', '#dc2626', '#0d9488', '#2563eb', '#c2410c'];
  const colorFor = (str) => { let n = 0; for (const ch of String(str || '')) n = (n * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[n % PALETTE.length]; };
  const initials = (name) => String(name || '?').trim().split(/\s+/).filter((w) => /\w/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  const avatar = (name, cls = '') => `<span class="avatar ${cls}" style="--c:${colorFor(name)}">${h(initials(name))}</span>`;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(`vtcrm-${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`vtcrm-${k}`, JSON.stringify(v)); } catch { /* private mode: fine */ } },
  };
  async function call(path, opts = {}) {
    if (opts.json) { opts.body = JSON.stringify(opts.json); opts.headers = { 'Content-Type': 'application/json' }; delete opts.json; }
    const b = store.get('biz', '');
    const url = `/api/crm/inbox${path}`;
    const res = await fetch(b ? `${url}${url.includes('?') ? '&' : '?'}biz=${encodeURIComponent(b)}` : url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  const say = (msg, err) => { const el = q$('#banner'); el.textContent = msg; el.className = `banner${err ? ' error' : ''}`; el.hidden = !msg; };
  const I = {
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
    back: '<path d="m14 6-6 6 6 6"/>',
    send: '<path d="M4 12 20 4l-5 16-3.5-6.5z"/><path d="m11.5 13.5 3-3"/>',
    card: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
    bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
    chat: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17H6.5A2.5 2.5 0 0 1 4 14.5z"/>',
    dot: '<circle cx="12" cy="12" r="4"/>',
  };
  const svg = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;
  I.social = '<circle cx="12" cy="12" r="8.5"/><path d="M13.2 20.4v-6.2h2.3l.4-2.7h-2.7V9.8c0-.8.3-1.3 1.4-1.3h1.4V6.1c-.3 0-1.1-.1-2.1-.1-2.1 0-3.4 1.2-3.4 3.5v2h-2.3v2.7h2.3v6.2"/>';
  // Where a message came from: email (no chip), website chat, Facebook Messenger or Instagram.
  const CH = { chat: 'Chat', facebook: 'Facebook', instagram: 'Instagram' };
  const chip = (ch) => (CH[ch] ? `<span class="ib-chip ${ch}">${CH[ch]}</span> ` : '');
  // "2:15 PM" today, "Yesterday", "Tue", or "Nov 3".
  function when(iso, long) {
    const d = new Date(iso), now = new Date();
    const days = Math.floor((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (long) return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
    return days <= 0 ? time : days === 1 ? 'Yesterday' : days < 7 ? d.toLocaleDateString([], { weekday: 'short' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  let picked = null; // the person whose emails are open
  let filter = { q: '', unread: false };
  let openCard = () => {};

  // ---------- Unread count on the menu ----------
  async function badge() {
    let n = 0;
    try { n = (await call('/unread')).unread; } catch { return; }
    document.querySelectorAll('.sidebar nav a[data-tab="conversations"], #crm-tabs a[data-tab="conversations"]').forEach((a) => {
      let b = q$('.nav-badge', a);
      if (!n) { if (b) b.remove(); return; }
      if (!b) { b = document.createElement('span'); b.className = 'nav-badge'; a.append(b); }
      b.textContent = n > 99 ? '99+' : n;
      b.title = `${n} unread`;
    });
  }

  // ---------- The page ----------
  async function render(opts = {}) {
    openCard = opts.openContact || openCard;
    const root = q$('#inbox-root');
    if (!q$('.ib', root)) {
      root.innerHTML = `<div class="ib">
        <aside class="ib-list">
          <div class="ib-tools">
            <label class="ib-search">${svg('search')}<input type="search" id="ib-q" placeholder="Search people" aria-label="Search people"></label>
            <button class="btn ghost ib-icon" id="ib-check" title="Check for new emails now" aria-label="Check for new emails now">${svg('refresh')}</button>
          </div>
          <div class="ib-tools ib-tools2">
            <button class="btn ghost ib-chatset" id="ib-chat" title="Chat bubble for your website">${svg('chat')}<span>Chat bubble</span></button>
            <button class="btn ghost ib-chatset" id="ib-social" title="Facebook and Instagram messages">${svg('social')}<span>Facebook &amp; Instagram</span></button>
          </div>
          <div class="ib-filter" role="tablist"><button type="button" data-u="0">All</button><button type="button" data-u="1">Unread</button></div>
          <div id="ib-note"></div>
          <ul id="ib-rows" class="ib-rows"></ul>
        </aside>
        <section class="ib-thread" id="ib-thread"></section>
      </div>`;
      let t;
      q$('#ib-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { filter.q = e.target.value.trim(); list(); }, 250); };
      root.querySelectorAll('.ib-filter button').forEach((b) => (b.onclick = () => { filter.unread = b.dataset.u === '1'; list(); }));
      q$('#ib-chat').onclick = () => window.VTExtra2.chatSettings();
      q$('#ib-social').onclick = () => window.VTExtra7.socialSettings(() => list());
      q$('#ib-check').onclick = async (e) => {
        const btn = e.currentTarget; btn.classList.add('spin'); btn.disabled = true;
        try {
          const [r, s] = await Promise.all([call('/check', { method: 'POST' }), fetch('/api/crm/social/check', { method: 'POST' }).then((x) => x.json()).catch(() => ({ added: 0 }))]);
          if (s.added) r.added = (r.added || 0) + s.added;
          say(r.ok || r.added ? (r.added ? `${r.added} new ${r.added === 1 ? 'message' : 'messages'}.` : 'No new messages.') : r.error, !r.ok && !r.added);
          setTimeout(() => say(''), 4000);
        } catch (err) { say(err.message, true); }
        btn.classList.remove('spin'); btn.disabled = false;
        await list(); if (picked) await open(picked);
      };
    }
    if (opts.contact) picked = Number(opts.contact);
    await list();
    if (picked) await open(picked); else emptyThread();
  }

  async function list() {
    const p = new URLSearchParams();
    if (filter.q) p.set('q', filter.q);
    if (filter.unread) p.set('unread', '1');
    const d = await call(`/?${p}`);
    document.querySelectorAll('.ib-filter button').forEach((b) => b.classList.toggle('on', (b.dataset.u === '1') === filter.unread));
    const st = d.status;
    q$('#ib-note').innerHTML = !st.canReceive
      ? `<div class="ib-warn"><b>${st.canSend ? 'Reading your inbox is off' : 'Email is not set up yet'}</b>${h(st.why)} <a href="#contacts/launchpad">Set it up on Launchpad</a>.</div>`
      : st.lastError ? `<div class="ib-warn"><b>Couldn't check your inbox</b>${h(st.lastError)}</div>`
        : `<p class="muted small ib-checked">Checks ${h(st.from)} every 2 minutes. Only people in your CRM show here.</p>`;
    const rows = q$('#ib-rows');
    rows.innerHTML = d.conversations.map((c) => `<li><button type="button" class="ib-row${c.id === picked ? ' on' : ''}${c.unread ? ' unread' : ''}" data-id="${c.id}">
        ${avatar(c.name)}
        <span class="ib-main"><span class="ib-top"><b>${h(c.name)}</b><time>${when(c.sent_at)}</time></span>
          <span class="ib-subj">${chip(c.channel)}${c.direction === 'out' ? '<span class="muted">You: </span>' : ''}${h(c.channel && c.channel !== 'email' ? '' : c.subject)}</span>
          <span class="ib-snip">${h(c.snippet)}</span></span>
        ${c.unread ? `<span class="ib-count" title="${c.unread} unread">${c.unread}</span>` : ''}
      </button></li>`).join('')
      || `<li class="ib-none">${svg('chat')}<b>${filter.q || filter.unread ? 'Nothing matches.' : 'No messages yet'}</b>${filter.q || filter.unread ? '' : 'Emails, website chats and Facebook and Instagram messages show up here, and your iPhone buzzes.'}</li>`;
    rows.querySelectorAll('.ib-row').forEach((b) => (b.onclick = () => open(Number(b.dataset.id))));
    badge();
  }

  function emptyThread() {
    q$('#ib-thread').innerHTML = `<div class="ib-empty">${svg('chat')}<b>Pick someone on the left</b><span>Read what they wrote and answer them right here. Your reply goes out from your own email address.</span></div>`;
    q$('.ib').classList.remove('show-thread');
  }

  async function open(id) {
    picked = id;
    let d;
    try { d = await call(`/${id}`); } catch (e) { say(e.message, true); return; }
    const c = d.contact, st = d.status;
    const box = q$('#ib-thread');
    const draftKey = `ib-draft-${c.id}`;
    const msgHtml = (m) => (m.kind === 'auto'
      ? `<div class="ib-auto">${svg('bolt')}<span><b>${h(m.via)}</b> sent "${h(m.subject)}" · ${when(m.sent_at, true)}</span></div>`
      : `<div class="ib-msg ${m.direction}">
          <div class="ib-meta">${m.direction === 'in' ? h(c.name) : m.subject === 'Answer bot' ? 'Answer bot' : 'You'} · ${CH[m.channel] ? `${CH[m.channel]} · ` : ''}${when(m.sent_at, true)}</div>
          <div class="ib-bubble${CH[m.channel] ? ` chat ${m.channel}` : ''}">${CH[m.channel] ? '' : `<div class="ib-s">${h(m.subject)}</div>`}<div class="ib-b">${h(m.body)}</div>
          ${m.more ? `<button type="button" class="ib-more" data-mid="${m.id}">Show the whole email</button>` : ''}</div>
        </div>`);
    const social = d.social;
    const chatMode = !social && Boolean(d.chat && d.chat.last);
    shown = { id: c.id, n: d.messages.length, chat: Boolean(d.chat || social) };
    const canWrite = social ? social.open && social.connected : chatMode || (st.canSend && c.email);
    const socialName = social ? CH[social.channel] : '';
    box.innerHTML = `<header class="ib-head">
        <button class="btn ghost ib-icon ib-back" type="button" aria-label="Back to the list">${svg('back')}</button>
        ${avatar(c.name)}<div class="ib-who"><b>${h(c.name)}</b><span class="muted small">${h(c.email || 'No email address')}${c.company ? ` · ${h(c.company)}` : ''}</span></div>
        <button class="btn ghost ib-unread" type="button" title="Mark as unread">Mark unread</button>
        <button class="btn ghost" type="button" id="ib-card">${svg('card')}<span>Open card</span></button>
      </header>
      <div class="ib-msgs" id="ib-msgs">${d.messages.map(msgHtml).join('') || '<p class="muted ib-first">No emails with this person yet. Write the first one below.</p>'}</div>
      ${c.do_not_contact ? '<p class="ib-dnc">Marked "Do not contact". You can still answer them for 30 days after they write to you.</p>' : ''}
      <form class="ib-reply" id="ib-reply">
        ${!st.canSend && !chatMode && !social ? '<p class="muted small">Set up email on <a href="#contacts/launchpad">Launchpad</a> to answer from here.</p>' : ''}
        ${social && !social.open ? `<p class="ib-dnc">Facebook only lets apps answer within 24 hours of their last message. Answer ${h(String(c.name).split(' ')[0])} in the ${socialName} app${c.email ? ', or email them from their card' : ''}.</p>` : ''}
        <textarea name="text" rows="3" placeholder="${social ? (canWrite ? `Answer on ${socialName}...` : 'The 24 hours are over') : chatMode || c.email ? `Write to ${h(String(c.name).split(' ')[0])}...` : 'Add an email address on their card first'}" ${canWrite ? '' : 'disabled'}>${h(store.get(draftKey, ''))}</textarea>
        <div class="ib-send-row"><span class="muted small">${social ? `Goes to their ${socialName} inbox from ${h(social.account || 'your Page')}.${social.open ? ` You can answer until ${when(social.closesAt, true)}.` : ''}` : chatMode ? (d.chat.online ? '<span class="ib-online"></span>On your website now. Your answer shows in their chat.' : `They left the chat.${c.email ? ' Your answer is also emailed to them.' : ' They gave no email, so they see it if they come back.'}`) : `Sent from ${h(st.from || 'your email')}, under their last email.`}</span>
          <button class="btn primary" ${canWrite ? '' : 'disabled'}>${svg('send')}<span>Send</span></button></div>
      </form>`;
    q$('.ib').classList.add('show-thread');
    const msgs = q$('#ib-msgs');
    msgs.scrollTop = msgs.scrollHeight;
    if (matchMedia('(max-width: 800px)').matches) q$('.ib').scrollIntoView({ block: 'start' });
    q$('.ib-back', box).onclick = () => { picked = null; q$('.ib').classList.remove('show-thread'); list(); };
    q$('#ib-card').onclick = () => openCard(c.id);
    q$('.ib-unread', box).onclick = async () => { await call(`/${c.id}/unread`, { method: 'POST' }); picked = null; emptyThread(); list(); };
    box.querySelectorAll('.ib-more').forEach((b) => (b.onclick = async () => {
      const r = await call(`/message/${b.dataset.mid}`);
      b.previousElementSibling.textContent = r.text; b.remove();
    }));
    const form = q$('#ib-reply'), ta = q$('textarea', form);
    ta.oninput = () => store.set(draftKey, ta.value);
    ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); } };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = q$('button', form);
      btn.disabled = true;
      try {
        if (social || chatMode) {
          const r = await fetch(`/api/crm/${social ? 'social' : 'chat'}/${c.id}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: ta.value }) });
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not send');
        } else await call(`/${c.id}/reply`, { method: 'POST', json: { text: ta.value } });
        store.set(draftKey, '');
        say('Sent.'); setTimeout(() => say(''), 2500);
        await open(c.id); await list();
      } catch (err) { say(err.message, true); btn.disabled = false; }
    };
    document.querySelectorAll('.ib-row').forEach((b) => b.classList.toggle('on', Number(b.dataset.id) === c.id));
    const row = q$(`.ib-row[data-id="${c.id}"]`);
    if (row) { row.classList.remove('unread'); const n = q$('.ib-count', row); if (n) n.remove(); }
    badge();
  }

  // From a person's card: jump straight to their emails.
  function show(contactId) { picked = Number(contactId); location.hash = '#contacts/conversations'; }

  setInterval(() => { if (document.visibilityState === 'visible') badge(); }, 60000);
  // An open chat updates by itself while you look at it.
  let shown = null;
  setInterval(async () => {
    const panel = q$('.crm-panel[data-panel="conversations"]');
    if (document.visibilityState !== 'visible' || !panel || panel.hidden || !shown || !shown.chat || shown.id !== picked) return;
    const d = await call(`/${picked}`).catch(() => null);
    if (!d || d.messages.length === shown.n) return;
    const ta = q$('#ib-reply textarea'), focused = ta && document.activeElement === ta;
    await open(picked);
    if (focused) { const t = q$('#ib-reply textarea'); if (t) { t.focus(); t.selectionStart = t.value.length; } }
    list();
  }, 5000);
  window.VTInbox = { render, badge, show };
})();
