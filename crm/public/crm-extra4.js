// Viral Touch CRM: Monthly plans and checkout reminders (Payments, Plans), Contracts to sign
// (Payments, Contracts and the Contract button on a contact), and the Blog (Sites, Blog).
// Loaded before crm.js, which calls window.VTExtra4.
(() => {
  const q$ = (s, el = document) => el.querySelector(s);
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => Number(n || 0).toLocaleString([], { style: 'currency', currency: 'USD' });
  const day = (iso) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso.replace(' ', 'T') + (iso.length === 19 ? 'Z' : '')).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(`vtcrm-${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`vtcrm-${k}`, JSON.stringify(v)); } catch { /* fine */ } },
  };
  async function call(path, opts = {}) {
    if (opts.json) { opts.body = JSON.stringify(opts.json); opts.headers = { 'Content-Type': 'application/json' }; delete opts.json; }
    const b = store.get('biz', '');
    const url = `/api/crm${path}`;
    const res = await fetch(b && !opts.noBiz ? `${url}${url.includes('?') ? '&' : '?'}biz=${encodeURIComponent(b)}` : url, opts);
    if (opts.raw) return res;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { data });
    return data;
  }
  const say = (msg, err) => { const el = q$('#banner'); el.textContent = msg; el.className = `banner${err ? ' error' : ''}`; el.hidden = !msg; if (msg && !err) setTimeout(() => { if (el.textContent === msg) el.hidden = true; }, 4000); };
  const I = {
    repeat: '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5"/>',
    people: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 19.5c.9-3.1 3.2-4.8 6-4.8s5.1 1.7 6 4.8"/><circle cx="17" cy="9.5" r="2.6"/><path d="M16.5 14.8c2.3.2 3.9 1.7 4.5 4.2"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.2M12 17h.01"/>',
    money: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.2c-.5-.8-1.5-1.3-2.8-1.3-1.6 0-2.7.8-2.7 2s1.1 1.7 2.7 2c1.7.3 2.9.9 2.9 2.2 0 1.3-1.2 2.1-2.9 2.1-1.4 0-2.5-.6-3-1.5M12 6.3v1.6M12 16.2v1.5"/>',
    bell: '<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.5h-15zM10 20.5a2.2 2.2 0 0 0 4 0"/>',
    doc: '<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4M9 12h6M9 15.5h6"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>', clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    news: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M7 8.5h10M7 12h4.5M7 15.5h4.5M14 12h3v3.5h-3z"/>', image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>',
  };
  const svg = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;
  const tile = (label, value, ico, c, sub) => `<div class="tile"><div class="tile-ico" style="--c:${c}">${svg(ico)}</div><div><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div></div>`;
  const dlg = (wide) => { const d = q$('#crm-edit-dialog'); d.classList.toggle('wide', Boolean(wide)); return d; };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); say('Link copied.'); } catch { prompt('Copy this:', text); } };
  const linkbox = (v) => `<div class="linkbox"><input readonly value="${h(v)}" aria-label="Link"><button class="btn" type="button" data-copy-val="${h(v)}">Copy link</button></div>`;
  const onCopy = (e) => { const b = e.target.closest('[data-copy-val]'); if (b) { copy(b.dataset.copyVal); return true; } return false; };
  const people = async () => (await call('/contacts')).map((c) => ({ id: c.id, name: c.name, email: c.email }));
  const PER = { week: 'a week', month: 'a month', year: 'a year' };

  // ======================= Monthly plans =======================
  const SST = { active: ['Active', '#16a34a'], past_due: ['Card declined', '#dc2626'], ending: ['Ending', '#d97706'], canceled: ['Cancelled', '#6b7280'] };
  async function renderPlans(root, modeBar) {
    const [d, ck, st] = await Promise.all([call('/plans'), call('/checkouts', { noBiz: true }), call('/invoices/settings', { noBiz: true })]);
    const t = d.totals;
    root.innerHTML = `${modeBar}<div class="tiles pay-tiles">${tile('Members paying', t.members, 'people', '#2563eb')}${tile('Monthly income', money(t.monthly), 'repeat', '#16a34a', 'From all active plans')}
      ${tile('Card declined', t.pastDue, 'alert', '#dc2626', t.pastDue ? 'Stripe tries again by itself' : 'All good')}</div>
      ${!st.stripe ? `<div class="pay-setup">${svg('money')}<div><b>Monthly plans need card payments</b><span>Turn on card payments with your own Stripe first (Invoices, Payment settings).</span></div></div>` : ''}
      <div class="row crm-filters"><button class="btn primary" data-new-plan>+ New plan</button>${d.subscriptions.length ? '<button class="btn ghost" data-sync>Check Stripe now</button>' : ''}</div>
      ${d.plans.length ? `<div class="prod-cards">${d.plans.map((p) => `<div class="prod-card${p.active ? '' : ' off'}" data-plan="${p.id}"><div class="prod-top"><div><b>${h(p.name)}</b>${p.active ? '' : ' <span class="pay-pill" style="--c:#6b7280">Off</span>'}
          ${p.description ? `<div class="muted small">${h(p.description)}</div>` : ''}${p.course ? `<div class="muted small">Includes the course ${h(p.course.title)}</div>` : ''}</div><div class="prod-price">${money(p.amount)}<small class="muted"> ${PER[p.every]}</small></div></div>
          ${p.active ? linkbox(p.link) : ''}<div class="muted small">${p.members} member${p.members === 1 ? '' : 's'}</div>
          <div class="row"><button class="btn" data-edit-plan>Edit</button>${p.active ? `<a class="btn ghost" href="${h(p.link)}" target="_blank" rel="noopener">Open</a>` : ''}</div></div>`).join('')}</div>`
      : `<div class="db-empty center pay-empty">${svg('repeat')}<b>No plans yet</b><span>A plan is something people pay for every month, like a <b>club, membership or monthly service</b>. They sign up on the plan's page and Stripe charges their card each month by itself. Every payment shows here.</span><button class="btn primary" data-new-plan>Make my first plan</button></div>`}
      ${d.subscriptions.length ? `<h2 class="small-h" style="margin-top:22px">Members</h2><div class="table-wrap"><table class="table pay-table"><thead><tr><th>Who</th><th>Plan</th><th>Price</th><th>Status</th><th>Next</th><th></th></tr></thead><tbody>
        ${d.subscriptions.map((s) => `<tr data-sub="${s.id}"><td><b>${h(s.contact_name)}</b>${s.email ? `<br><span class="muted small">${h(s.email)}</span>` : ''}</td><td>${h(s.name)}</td><td>${money(s.amount)} <span class="muted small">${PER[s.every]}</span></td>
          <td><span class="pay-pill" style="--c:${(SST[s.status] || SST.canceled)[1]}">${(SST[s.status] || SST.canceled)[0]}</span></td>
          <td>${s.status === 'canceled' ? `<span class="muted small">Ended ${day(s.canceled_at)}</span>` : s.renews_at ? `${s.status === 'ending' ? 'Ends' : 'Renews'} ${day(s.renews_at)}` : ''}</td>
          <td class="pay-act">${['active', 'past_due', 'ending'].includes(s.status) ? '<button class="btn ghost danger" data-cancel-sub>Cancel</button>' : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="card-box ck-box"><div class="row" style="justify-content:space-between"><h2>${svg('bell')} Reminders for unfinished checkouts</h2>
        <label class="switch"><input type="checkbox" id="ck-on" ${ck.on ? 'checked' : ''}><span>On</span></label></div>
        <p class="muted small">When someone starts paying on a Buy now page, a paid course or a plan, and doesn't finish, we email them once with a link to finish.</p>
        <label class="field inline"><span>Send it after</span><select id="ck-hours">${[1, 3, 12, 24].map((n) => `<option value="${n}"${ck.hours === n ? ' selected' : ''}>${n} hour${n > 1 ? 's' : ''}</option>`).join('')}</select></label>
        <div class="row ck-stats"><div><b>${ck.started}</b><span class="muted small">Started paying (30 days)</span></div><div><b>${ck.reminded}</b><span class="muted small">Got a reminder</span></div><div><b>${ck.saved}</b><span class="muted small">Paid after the reminder</span></div></div></div>`;
    const saveCk = async () => { try { await call('/checkouts', { method: 'PUT', noBiz: true, json: { on: q$('#ck-on', root).checked, hours: Number(q$('#ck-hours', root).value) } }); say('Saved.'); } catch (err) { say(err.message, true); } };
    q$('#ck-on', root).onchange = saveCk;
    q$('#ck-hours', root).onchange = saveCk;
    const again = () => renderPlans(root, modeBar);
    return async (e) => {
      if (onCopy(e)) return;
      if (e.target.closest('[data-new-plan]')) return editPlan(null, again);
      if (e.target.closest('[data-sync]')) { try { await call('/plans/sync', { method: 'POST' }); say('Up to date with Stripe.'); again(); } catch (err) { say(err.message, true); } return; }
      const card = e.target.closest('[data-plan]');
      if (card && e.target.closest('[data-edit-plan]')) return editPlan(d.plans.find((x) => x.id === Number(card.dataset.plan)), again);
      const row = e.target.closest('[data-sub]');
      if (row && e.target.closest('[data-cancel-sub]')) {
        const s = d.subscriptions.find((x) => x.id === Number(row.dataset.sub));
        if (!confirm(`Cancel ${s.contact_name}'s plan ${s.name} now? Stripe stops charging them right away.`)) return;
        try { await call(`/plans/subscriptions/${s.id}/cancel`, { method: 'POST', json: { now: true } }); say('Plan cancelled.'); again(); } catch (err) { say(err.message, true); }
      }
    };
  }
  async function editPlan(p, done) {
    const courses = (await call('/courses').catch(() => ({ courses: [] }))).courses || [];
    const d = dlg();
    d.innerHTML = `<form id="plan-form"><h1>${p ? 'Edit plan' : 'New plan'}</h1>
      <label class="field"><span>Name</span><input name="name" required maxlength="120" placeholder="Car care club, VIP members, Monthly coaching..." value="${h(p ? p.name : '')}"></label>
      <div class="biz-two"><label class="field"><span>Price</span><input name="amount" inputmode="decimal" required placeholder="$29" value="${h(p ? p.amount : '')}"></label>
        <label class="field"><span>Charged every</span><select name="every">${[['month', 'Month'], ['week', 'Week'], ['year', 'Year']].map(([v, l]) => `<option value="${v}"${(p ? p.every : 'month') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <label class="field"><span>What they get <small class="muted">(shows on the sign-up page)</small></span><textarea name="description" rows="3" maxlength="1000">${h(p ? p.description || '' : '')}</textarea></label>
      ${courses.length ? `<label class="field"><span>Include a course <small class="muted">(they keep it while they pay)</small></span><select name="course_id"><option value="">No course</option>${courses.map((c) => `<option value="${c.id}"${p && p.course && p.course.id === c.id ? ' selected' : ''}>${h(c.title)}</option>`).join('')}</select></label>` : ''}
      <label class="check"><input type="checkbox" name="active" ${!p || p.active ? 'checked' : ''}> Open for sign-ups</label>
      ${p ? '<p class="muted small">A new price is for new members. People already paying keep their price.</p>' : ''}
      <p class="muted small">Your Stripe key needs <b>Subscriptions: Write</b> and <b>Invoices: Read</b> for plans. See Invoices, Payment settings.</p>
      <div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Cancel</button>${p ? '<button class="btn ghost danger" type="button" data-del>Delete</button>' : ''}</div><p class="muted" id="plan-msg"></p></form>`;
    if (!d.open) d.showModal();
    const f = q$('#plan-form', d);
    f.onclick = async (e) => {
      if (e.target.closest('[data-close]')) d.close();
      if (e.target.closest('[data-del]') && confirm(`Delete the plan ${p.name}?`)) {
        try { await call(`/plans/${p.id}`, { method: 'DELETE' }); d.close(); done(); } catch (err) { q$('#plan-msg', d).textContent = err.message; }
      }
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = { name: f.name.value, amount: f.amount.value, every: f.every.value, description: f.description.value, active: f.active.checked };
      if (f.course_id) body.course_id = f.course_id.value;
      try { await call(p ? `/plans/${p.id}` : '/plans', { method: p ? 'PUT' : 'POST', json: body }); d.close(); say('Plan saved. Share its link so people can sign up.'); done(); }
      catch (err) { q$('#plan-msg', d).textContent = err.message; }
    };
  }

  // ======================= Contracts =======================
  const KST = { draft: ['Draft', '#6b7280'], sent: ['Waiting to sign', '#2563eb'], signed: ['Signed', '#16a34a'], void: ['Cancelled', '#9ca3af'] };
  const kpill = (s) => `<span class="pay-pill" style="--c:${KST[s][1]}">${KST[s][0]}</span>`;
  async function renderContracts(root, modeBar) {
    const d = await call('/contracts');
    const t = d.totals;
    root.innerHTML = `${modeBar}<div class="tiles pay-tiles">${tile('Waiting to sign', t.waiting, 'clock', '#2563eb')}${tile('Signed', t.signed, 'check', '#16a34a')}${tile('Drafts', t.drafts, 'doc', '#6b7280')}</div>
      <div class="row crm-filters"><button class="btn primary" data-new-k>+ New contract</button></div>
      ${d.contracts.length ? `<div class="table-wrap"><table class="table pay-table"><thead><tr><th>#</th><th>Contract</th><th>Who signs</th><th>Status</th><th></th></tr></thead><tbody>
        ${d.contracts.map((k) => `<tr data-k="${k.id}"><td>${k.number}</td><td><b>${h(k.title)}</b></td><td>${h(k.contact ? k.contact.name : 'Removed person')}</td>
          <td>${kpill(k.status)}${k.status === 'signed' ? `<br><span class="muted small">${day(k.signed_at)}</span>` : k.status === 'sent' && k.viewed_at ? '<br><span class="muted small">Opened</span>' : ''}</td>
          <td class="pay-act"><button class="btn ghost" data-open-k>Open</button></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="db-empty center pay-empty">${svg('pen')}<b>No contracts yet</b><span>Pick a ready-made agreement, like a <b>service agreement, photo release, sponsor agreement</b> or <b>keep-it-private (NDA)</b>, or write your own. People read it and sign with a finger on their phone. You get a buzz, they get a signed copy.</span><button class="btn primary" data-new-k>Make my first contract</button></div>`}`;
    const again = () => renderContracts(root, modeBar);
    return (e) => {
      if (e.target.closest('[data-new-k]')) return editContract(null, null, again);
      const r = e.target.closest('tr[data-k]');
      if (r) openContract(Number(r.dataset.k), again);
    };
  }
  async function editContract(k, contactId, done = () => {}) {
    const [list, templates] = await Promise.all([k ? Promise.resolve([]) : people(), k ? Promise.resolve([]) : call('/contracts/templates', { noBiz: true })]);
    const d = dlg(true);
    d.innerHTML = `<form id="k-form"><h1>${k ? `Contract #${k.number}` : 'New contract'}</h1>
      ${k ? `<p class="muted">For <b>${h(k.contact ? k.contact.name : '')}</b></p>` : `<label class="field"><span>Who signs it?</span><select name="contact_id" required><option value="">Pick a person</option>${list.map((c) => `<option value="${c.id}"${c.id === contactId ? ' selected' : ''}>${h(c.name)}${c.email ? ` (${h(c.email)})` : ''}</option>`).join('')}</select></label>
      <div class="field"><span>Start from</span><div class="k-tpls">${templates.map((t, i) => `<label class="k-tpl"><input type="radio" name="template" value="${t.key}" ${i ? '' : 'checked'}><span>${h(t.title)}</span></label>`).join('')}</div></div>`}
      <label class="field"><span>Name</span><input name="title" required maxlength="140" value="${h(k ? k.title : '')}"></label>
      <label class="field"><span>The words <small class="muted">({name}, {business} and {date} fill in by themselves)</small></span><textarea name="body" rows="14" class="k-body">${h(k ? k.body : '')}</textarea></label>
      <p class="muted small">Change anything in [square brackets]. These are plain-language starting points, not legal advice. Have a lawyer look at anything important.</p>
      <div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Cancel</button></div><p class="muted" id="k-msg"></p></form>`;
    if (!d.open) d.showModal();
    const f = q$('#k-form', d);
    const loadTpl = async () => {
      if (!f.template) return;
      const t = await call(`/contracts/templates/${f.template.value}`, { noBiz: true });
      f.title.value = t.key === 'blank' ? '' : t.title; f.body.value = t.body;
    };
    if (!k) { await loadTpl(); f.onchange = (e) => { if (e.target.name === 'template') loadTpl(); }; }
    f.onclick = (e) => { if (e.target.closest('[data-close]')) d.close(); };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = { title: f.title.value, body: f.body.value };
      if (!k) body.contact_id = f.contact_id.value;
      try { const out = await call(k ? `/contracts/${k.id}` : '/contracts', { method: k ? 'PUT' : 'POST', json: body }); done(); openContract(out.id, done); }
      catch (err) { q$('#k-msg', d).textContent = err.message; }
    };
  }
  async function openContract(id, done = () => {}) {
    const k = await call(`/contracts/${id}`);
    const d = dlg(true);
    const c = k.contact || {};
    d.innerHTML = `<div class="k-view"><h1>${h(k.title)} ${kpill(k.status)}</h1><p class="muted">Contract #${k.number} for <b>${h(c.name || 'Removed person')}</b>${k.sent_at ? ` · sent ${day(k.sent_at)}` : ''}${k.viewed_at ? ` · opened ${day(k.viewed_at)}` : ''}</p>
      ${k.status === 'signed' ? `<div class="k-signed">${svg('check')}<div><b>Signed by ${h(k.signed_name)}</b><div class="muted small">${new Date(k.signed_at).toLocaleString()}${k.signed_ip ? ` · from ${h(k.signed_ip)}` : ''}</div>${k.signature ? `<img src="${h(k.signature)}" alt="Signature">` : ''}</div></div>` : ''}
      ${k.status !== 'draft' && k.status !== 'void' ? linkbox(k.link) : ''}
      <div class="k-text">${h(k.body)}</div>
      <div class="row">${['draft', 'sent'].includes(k.status) ? `<button class="btn primary" data-send-k>${k.status === 'sent' ? 'Email it again' : 'Email it to sign'}</button><button class="btn ghost" data-mark-k>${k.status === 'sent' ? 'Copy link' : 'I will text the link'}</button><button class="btn ghost" data-edit-k>Edit</button>` : ''}
        ${k.status === 'signed' ? `<a class="btn primary" href="${h(k.link)}" target="_blank" rel="noopener">Open signed copy</a>` : ''}
        ${k.status === 'sent' ? '<button class="btn ghost danger" data-void-k>Cancel it</button>' : ''}${k.status === 'draft' || k.status === 'void' ? '<button class="btn ghost danger" data-del-k>Delete</button>' : ''}
        <button class="btn ghost" data-close>Close</button></div><p class="muted" id="kv-msg"></p></div>`;
    if (!d.open) d.showModal();
    q$('.k-view', d).onclick = async (e) => {
      if (onCopy(e)) return;
      const msg = q$('#kv-msg', d);
      try {
        if (e.target.closest('[data-close]')) return d.close();
        if (e.target.closest('[data-edit-k]')) return editContract(k, null, done);
        if (e.target.closest('[data-send-k]')) { await call(`/contracts/${k.id}/send`, { method: 'POST', json: { by: 'email' } }); say(`Sent to ${c.email}.`); done(); return openContract(k.id, done); }
        if (e.target.closest('[data-mark-k]')) { if (k.status === 'draft') await call(`/contracts/${k.id}/send`, { method: 'POST', json: { by: 'link' } }); copy(k.link); done(); return openContract(k.id, done); }
        if (e.target.closest('[data-void-k]') && confirm('Cancel this contract? The link stops working for signing.')) { await call(`/contracts/${k.id}/status`, { method: 'POST', json: { status: 'void' } }); done(); return openContract(k.id, done); }
        if (e.target.closest('[data-del-k]') && confirm('Delete this contract?')) { await call(`/contracts/${k.id}`, { method: 'DELETE' }); d.close(); done(); }
      } catch (err) { msg.textContent = err.message; }
    };
  }

  // ======================= Blog (inside Sites) =======================
  const basePath = () => location.pathname.replace(/[^/]*$/, '');
  const imgSrc = (v) => (/^media\//.test(v) ? `${basePath()}s/${v}` : v);
  async function renderBlog() {
    const root = q$('#site-root');
    const d = await call('/blog');
    const t = d.totals;
    root.innerHTML = `<div class="tiles pay-tiles">${tile('Published posts', t.published, 'news', '#2563eb')}${tile('Drafts', t.drafts, 'doc', '#6b7280')}${tile('Reads', t.views, 'eye', '#16a34a')}</div>
      <div class="row crm-filters"><button class="btn primary" data-new-post>+ New post</button>${t.published ? `<a class="btn ghost" href="${h(d.link)}" target="_blank" rel="noopener">See my blog</a>` : ''}</div>
      ${d.posts.length ? `<div class="blog-list">${d.posts.map((p) => `<div class="blog-row" data-post="${p.id}">${p.cover ? `<img src="${h(imgSrc(p.cover))}" alt="">` : `<span class="blog-noimg">${svg('news')}</span>`}
        <div class="blog-main"><b>${h(p.title)}</b> ${p.published ? '<span class="pay-pill" style="--c:#16a34a">Live</span>' : '<span class="pay-pill" style="--c:#6b7280">Draft</span>'}
          <div class="muted small">${p.published ? `${day(p.published_at)} · ${p.views} read${p.views === 1 ? '' : 's'}` : `${p.words} words`}</div><div class="muted small blog-sum">${h(p.summary)}</div></div>
        <div class="row"><button class="btn" data-edit-post>Edit</button>${p.published ? `<a class="btn ghost icon" href="${h(p.link)}" target="_blank" rel="noopener" aria-label="Open post">${svg('eye')}</a>` : ''}</div></div>`).join('')}</div>
        ${t.published ? `<p class="muted small" style="margin-top:14px">Your blog address:</p>${linkbox(d.link)}<p class="muted small">Tip: in Pages, add the <b>Latest blog posts</b> block to your website.</p>` : ''}`
      : `<div class="db-empty center pay-empty">${svg('news')}<b>No posts yet</b><span>Write tips, news and stories. Each post gets its own page that Google can find, and your website can show the newest ones. Good posts bring people to you for free.</span><button class="btn primary" data-new-post>Write my first post</button></div>`}`;
    root.onclick = (e) => {
      if (onCopy(e)) return;
      if (e.target.closest('[data-new-post]')) return editPost(null);
      const r = e.target.closest('[data-post]');
      if (r && e.target.closest('[data-edit-post]')) return editPost(d.posts.find((x) => x.id === Number(r.dataset.post)));
    };
  }
  function editPost(p) {
    const d = dlg(true);
    d.innerHTML = `<form id="post-form" class="post-form"><h1>${p ? 'Edit post' : 'New post'}</h1>
      <label class="field"><span>Title</span><input name="title" required maxlength="160" placeholder="5 ways to keep your car looking new" value="${h(p ? p.title : '')}"></label>
      <div class="field"><span>Cover photo <small class="muted">(optional)</small></span><div class="site-img" id="post-cover">${p && p.cover ? `<img src="${h(imgSrc(p.cover))}" alt="">` : `<span class="site-noimg">${svg('image')}</span>`}
        <input name="cover" value="${h(p ? p.cover || '' : '')}" placeholder="Paste a picture link, or upload"><label class="btn ghost">Upload<input type="file" accept="image/*" hidden data-up="cover"></label></div></div>
      <label class="field"><span>Your post</span><textarea name="body" rows="14" class="k-body" placeholder="Start writing...">${h(p ? p.body : '')}</textarea></label>
      <div class="row post-tools"><label class="btn ghost">${svg('image')} Add a photo in the post<input type="file" accept="image/*" hidden data-up="inline"></label>
        <span class="muted small">Blank line = new paragraph. ## Heading. - Bullet. **bold**. [words](https://link)</span></div>
      <details><summary class="muted">More: short summary and web address</summary>
        <label class="field"><span>Short summary <small class="muted">(for Google and the post list; empty = the start of the post)</small></span><textarea name="excerpt" rows="2" maxlength="300">${h(p ? p.excerpt || '' : '')}</textarea></label>
        <label class="field"><span>Web address ending</span><input name="slug" maxlength="60" value="${h(p ? p.slug : '')}" placeholder="made from the title"></label></details>
      <label class="check"><input type="checkbox" name="published" ${p && p.published ? 'checked' : ''}> Published (anyone with the link can read it)</label>
      <div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-preview>Preview</button><button class="btn ghost" type="button" data-close>Cancel</button>${p ? '<button class="btn ghost danger" type="button" data-del>Delete</button>' : ''}</div>
      <p class="muted" id="post-msg"></p></form>`;
    if (!d.open) d.showModal();
    const f = q$('#post-form', d);
    const msg = q$('#post-msg', d);
    f.onchange = async (e) => {
      const up = e.target.closest('[data-up]');
      if (!up || !up.files[0]) return;
      const file = up.files[0];
      msg.textContent = 'Uploading...';
      try {
        const r = await call('/sites/upload', { method: 'POST', body: file, headers: { 'Content-Type': file.type } });
        if (up.dataset.up === 'cover') { f.cover.value = r.url; q$('#post-cover', d).firstElementChild.outerHTML = `<img src="${h(imgSrc(r.url))}" alt="">`; }
        else { const ta = f.body, at = ta.selectionStart ?? ta.value.length; ta.value = `${ta.value.slice(0, at).replace(/\s*$/, '')}\n\n${r.url}\n\n${ta.value.slice(at).replace(/^\s*/, '')}`; }
        msg.textContent = '';
      } catch (err) { msg.textContent = err.message; }
      up.value = '';
    };
    f.onclick = async (e) => {
      if (e.target.closest('[data-close]')) return d.close();
      if (e.target.closest('[data-preview]')) {
        const r = await call('/blog/preview', { method: 'POST', raw: true, json: { title: f.title.value, body: f.body.value, cover: f.cover.value } });
        const html = (await r.text()).replace('<head>', `<head><base href="${location.origin}${basePath()}blog/">`);
        const w = window.open('', '_blank'); if (w) { w.document.open(); w.document.write(html); w.document.close(); }
        return;
      }
      if (e.target.closest('[data-del]') && confirm(`Delete the post "${p.title}"?`)) { await call(`/blog/${p.id}`, { method: 'DELETE' }); d.close(); renderBlog(); }
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = { title: f.title.value, body: f.body.value, cover: f.cover.value, excerpt: f.excerpt.value, published: f.published.checked };
      if (f.slug.value.trim() && (!p || f.slug.value.trim() !== p.slug)) body.slug = f.slug.value;
      try { const out = await call(p ? `/blog/${p.id}` : '/blog', { method: p ? 'PUT' : 'POST', json: body }); d.close(); say(out.published ? 'Post is live.' : 'Draft saved.'); renderBlog(); }
      catch (err) { msg.textContent = err.message; }
    };
  }

  window.VTExtra4 = { renderPlans, renderContracts, editContract, openContract, renderBlog };
})();
// On a phone the Payments menu scrolls sideways: keep the chosen part in view.
(() => {
  const keep = () => document.querySelectorAll('.pay-seg').forEach((seg) => {
    const on = seg.querySelector('.on');
    if (on && seg.scrollWidth > seg.clientWidth) seg.scrollLeft = Math.max(0, on.offsetLeft - seg.offsetLeft - 24);
  });
  const start = () => { const r = document.getElementById('pay-root'); if (r) new MutationObserver(keep).observe(r, { childList: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
