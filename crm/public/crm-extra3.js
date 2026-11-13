// Viral Touch CRM: Funnels (inside Sites), Coupons and Referral partners (inside Payments),
// and the course Community box. Loaded before crm.js, which calls window.VTExtra3.
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
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { data });
    return data;
  }
  const say = (msg, err) => { const el = q$('#banner'); el.textContent = msg; el.className = `banner${err ? ' error' : ''}`; el.hidden = !msg; if (msg && !err) setTimeout(() => { if (el.textContent === msg) el.hidden = true; }, 4000); };
  const I = {
    funnel: '<path d="M3.5 5h17l-6.5 8v6l-4 1.5V13z"/>',
    tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.1 6.1a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.6"/>',
    hand: '<path d="M8 12.5 11 9.5a2 2 0 0 1 2.8 0l.7.7M3 11l4-4 3 1M21 11l-4-4-3 1"/><path d="m7 15 2 2m1-4 3 3m0-4 3 3M3 11l5 5.5a2 2 0 0 0 2.8.2L17 11"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    up: '<path d="m6 14 6-6 6 6"/>', down: '<path d="m6 10 6 6 6-6"/>', left: '<path d="m14 6-6 6 6 6"/>', right: '<path d="m10 6 6 6-6 6"/>', trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
    money: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.2c-.5-.8-1.5-1.3-2.8-1.3-1.6 0-2.7.8-2.7 2s1.1 1.7 2.7 2c1.7.3 2.9.9 2.9 2.2 0 1.3-1.2 2.1-2.9 2.1-1.4 0-2.5-.6-3-1.5M12 6.3v1.6M12 16.2v1.5"/>',
    people: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 19.5c.9-3.1 3.2-4.8 6-4.8s5.1 1.7 6 4.8"/><circle cx="17" cy="9.5" r="2.6"/><path d="M16.5 14.8c2.3.2 3.9 1.7 4.5 4.2"/>',
    pin: '<path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7"/>', chat: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17H6.5A2.5 2.5 0 0 1 4 14.5z"/>',
  };
  const svg = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;
  const tile = (label, value, ico, c, sub) => `<div class="tile"><div class="tile-ico" style="--c:${c}">${svg(ico)}</div><div><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div></div>`;
  const dlg = (wide) => { const d = q$('#crm-edit-dialog'); d.classList.toggle('wide', Boolean(wide)); return d; };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); say('Link copied.'); } catch { prompt('Copy this:', text); } };
  const linkbox = (v) => `<div class="linkbox"><input readonly value="${h(v)}" aria-label="Link"><button class="btn" type="button" data-copy-val="${h(v)}">Copy link</button></div>`;
  const onCopy = (e) => { const b = e.target.closest('[data-copy-val]'); if (b) { copy(b.dataset.copyVal); return true; } return false; };
  const people = async () => (await call('/contacts')).map((c) => ({ id: c.id, name: c.name, email: c.email }));

  // ======================= Sites tab: Pages or Funnels =======================
  let siteMode = store.get('site-mode', 'pages');
  async function renderSitesTab() {
    const bar = q$('#site-mode');
    if (window.VTExtra.isEditing()) { bar.hidden = true; return window.VTExtra.renderSites(); }
    bar.hidden = false;
    bar.innerHTML = `<div class="seg pay-seg" role="group" aria-label="Show"><button type="button" data-smode="pages" class="${siteMode === 'pages' ? 'on' : ''}">Pages</button><button type="button" data-smode="funnels" class="${siteMode === 'funnels' ? 'on' : ''}">Funnels</button></div>`;
    bar.onclick = (e) => { const b = e.target.closest('[data-smode]'); if (b) { siteMode = b.dataset.smode; store.set('site-mode', siteMode); renderSitesTab(); } };
    return siteMode === 'funnels' ? renderFunnels() : window.VTExtra.renderSites();
  }
  async function renderFunnels() {
    const root = q$('#site-root');
    const d = await call('/funnels');
    root.innerHTML = `<div class="row crm-filters"><button class="btn primary" data-new-fun>+ New funnel</button></div>
      ${d.funnels.length ? d.funnels.map((f) => `<div class="card-box fun" data-fun="${f.id}"><div class="row" style="justify-content:space-between"><h2>${svg('funnel')} ${h(f.name)}</h2>
          <div class="row"><button class="btn ghost" data-rename>Rename</button><button class="btn ghost danger" data-del-fun>Delete</button></div></div>
        <div class="fun-steps">${f.steps.map((st, i) => `${i ? `<div class="fun-arrow" aria-hidden="true">→${st.went_on != null ? `<span>${st.went_on}%</span>` : ''}</div>` : ''}
          <div class="fun-step" data-step="${st.id}" data-site="${st.site_id}"><div class="fun-n">Step ${i + 1}</div><b>${h(st.title)}</b>
            <div class="muted small">${st.views} visit${st.views === 1 ? '' : 's'}${st.published ? '' : ' · <span style="color:#d97706">Draft</span>'}</div>
            <div class="row fun-act"><button class="btn primary" data-edit-page>Edit page</button><a class="btn ghost icon" href="${h(st.link)}" target="_blank" rel="noopener" aria-label="Open page">${svg('eye')}</a>
              <button class="btn ghost icon" data-left ${i ? '' : 'disabled'} aria-label="Move earlier">${svg('left')}</button><button class="btn ghost icon" data-right ${i < f.steps.length - 1 ? '' : 'disabled'} aria-label="Move later">${svg('right')}</button>
              <button class="btn ghost icon danger" data-rm-step aria-label="Take out of funnel">${svg('trash')}</button></div></div>`).join('')}
          <button class="fun-add" data-add-step>+ Add a step</button></div>
        ${f.steps[0] ? `<p class="muted small" style="margin:12px 0 6px">Share the first step:</p>${linkbox(f.steps[0].link)}` : ''}</div>`).join('')
      : `<div class="db-empty center pay-empty">${svg('funnel')}<b>No funnels yet</b><span>A funnel is a few pages in order. For example a sign-up page, then a thank-you page, then an offer. Buttons set to <b>#next</b> go to the next page, and after someone fills in your form they move on by themselves. You see how many people reach each step.</span><button class="btn primary" data-new-fun>Make my first funnel</button></div>`}`;
    root.onclick = async (e) => {
      if (onCopy(e)) return;
      if (e.target.closest('[data-new-fun]')) return newFunnel(d.templates);
      const box = e.target.closest('[data-fun]');
      if (!box) return;
      const f = d.funnels.find((x) => x.id === Number(box.dataset.fun));
      const st = e.target.closest('[data-step]');
      try {
        if (e.target.closest('[data-rename]')) { const n = prompt('New name for the funnel?', f.name); if (n) { await call(`/funnels/${f.id}`, { method: 'PUT', json: { name: n } }); renderFunnels(); } return; }
        if (e.target.closest('[data-del-fun]')) { if (confirm(`Delete the funnel "${f.name}"? Its pages stay in Pages.`)) { await call(`/funnels/${f.id}`, { method: 'DELETE' }); renderFunnels(); } return; }
        if (e.target.closest('[data-add-step]')) return addStep(f);
        if (!st) return;
        const ids = f.steps.map((x) => x.id), i = ids.indexOf(Number(st.dataset.step));
        if (e.target.closest('[data-edit-page]')) return window.VTExtra.editSite(Number(st.dataset.site));
        if (e.target.closest('[data-rm-step]')) { if (confirm('Take this page out of the funnel? The page itself stays in Pages.')) { await call(`/funnels/${f.id}/steps/${ids[i]}`, { method: 'DELETE' }); renderFunnels(); } return; }
        const dir = e.target.closest('[data-left]') ? -1 : e.target.closest('[data-right]') ? 1 : 0;
        if (dir) { [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]]; await call(`/funnels/${f.id}/order`, { method: 'POST', json: { ids } }); renderFunnels(); }
      } catch (err) { say(err.message, true); }
    };
  }
  function newFunnel(templates) {
    const d = dlg();
    d.innerHTML = `<form id="fun-form"><h1>New funnel</h1>
      <label class="field"><span>Name</span><input name="name" required maxlength="80" placeholder="Free guide, Spring sale, Free call..."></label>
      <div class="field"><span>Start from</span><div class="fun-pick">${Object.entries(templates).map(([k, t], i) => `<label class="fun-tpl"><input type="radio" name="template" value="${k}" ${i ? '' : 'checked'}><b>${h(t.name)}</b><span class="muted small">${h(t.about)}</span></label>`).join('')}</div></div>
      <p class="muted small">We make the pages for you. Then change the words and pictures.</p>
      <div class="row"><button class="btn primary">Make it</button><button class="btn ghost" type="button" data-close>Cancel</button></div><p class="muted" id="fun-msg"></p></form>`;
    if (!d.open) d.showModal();
    const f = q$('#fun-form', d);
    f.onclick = (e) => { if (e.target.closest('[data-close]')) d.close(); };
    f.onsubmit = async (e) => {
      e.preventDefault();
      try { await call('/funnels', { method: 'POST', json: { name: f.name.value, template: f.template.value } }); d.close(); say('Funnel made. Press Edit page on each step to change the words.'); renderFunnels(); }
      catch (err) { q$('#fun-msg', d).textContent = err.message; }
    };
  }
  async function addStep(f) {
    const pages = (await call('/sites')).sites;
    const inFun = new Set((await call('/funnels')).funnels.flatMap((x) => x.steps.map((s) => s.site_id)));
    const free = pages.filter((p) => !inFun.has(p.id));
    const d = dlg();
    d.innerHTML = `<form id="step-form"><h1>Add a step to ${h(f.name)}</h1>
      <label class="field"><span>Which page?</span><select name="site"><option value="">A new empty page</option>${free.map((p) => `<option value="${p.id}">${h(p.title)}</option>`).join('')}</select></label>
      <div class="row"><button class="btn primary">Add step</button><button class="btn ghost" type="button" data-close>Cancel</button></div><p class="muted" id="step-msg"></p></form>`;
    if (!d.open) d.showModal();
    const fm = q$('#step-form', d);
    fm.onclick = (e) => { if (e.target.closest('[data-close]')) d.close(); };
    fm.onsubmit = async (e) => {
      e.preventDefault();
      try { await call(`/funnels/${f.id}/steps`, { method: 'POST', json: { site_id: fm.site.value || null } }); d.close(); renderFunnels(); }
      catch (err) { q$('#step-msg', d).textContent = err.message; }
    };
  }

  // ======================= Coupons =======================
  const CST = { live: ['Live', '#16a34a'], ended: ['Ended', '#6b7280'], 'used up': ['Used up', '#d97706'], off: ['Off', '#9ca3af'] };
  async function renderCoupons(root, modeBar) {
    const d = await call('/coupons');
    const draw = () => {
      root.innerHTML = `${modeBar}<div class="row crm-filters"><button class="btn primary" data-new-cp>+ New coupon</button></div>
      ${d.coupons.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Code</th><th>Discount</th><th>Works on</th><th>Used</th><th>Ends</th><th>Status</th><th></th></tr></thead><tbody>
        ${d.coupons.map((c) => `<tr data-cp="${c.id}"><td><b class="cp-code">${h(c.code)}</b></td><td>${h(c.label)}</td><td>${{ all: 'Everything', products: 'Products', courses: 'Courses' }[c.applies]}</td>
          <td>${c.uses}${c.max_uses ? ` of ${c.max_uses}` : ''}</td><td>${c.ends_on ? day(c.ends_on) : '<span class="muted">Never</span>'}</td><td><span class="pay-pill" style="--c:${CST[c.state][1]}">${CST[c.state][0]}</span></td>
          <td class="pay-act"><button class="btn ghost" data-edit-cp>Edit</button></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="db-empty center pay-empty">${svg('tag')}<b>No coupons yet</b><span>Make a code like <b>SAVE20</b> for 20% off. People type it on a Buy now page or a paid course page. You can set an end date and how many times it can be used.</span><button class="btn primary" data-new-cp>Make a coupon</button></div>`}`;
    };
    draw();
    return (e) => {
      if (e.target.closest('[data-new-cp]')) return editCoupon(null, () => renderCoupons(root, modeBar));
      const r = e.target.closest('[data-cp]');
      if (r && e.target.closest('[data-edit-cp]')) editCoupon(d.coupons.find((x) => x.id === Number(r.dataset.cp)), () => renderCoupons(root, modeBar));
    };
  }
  function editCoupon(c, done) {
    const d = dlg();
    d.innerHTML = `<form id="cp-form"><h1>${c ? 'Edit coupon' : 'New coupon'}</h1>
      <label class="field"><span>Code people type</span><input name="code" required maxlength="30" placeholder="SAVE20" value="${h(c ? c.code : '')}" style="text-transform:uppercase"></label>
      <div class="biz-two"><label class="field"><span>Discount</span><input name="value" inputmode="decimal" required placeholder="20" value="${h(c ? c.percent || c.amount : '')}"></label>
        <label class="field"><span>Type</span><select name="kind"><option value="percent"${!c || c.percent ? ' selected' : ''}>% off</option><option value="amount"${c && c.amount ? ' selected' : ''}>$ off</option></select></label></div>
      <div class="biz-two"><label class="field"><span>Works on</span><select name="applies">${[['all', 'Products and courses'], ['products', 'Products only'], ['courses', 'Courses only']].map(([v, l]) => `<option value="${v}"${(c ? c.applies : 'all') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>How many times <small class="muted">(empty = no limit)</small></span><input name="max_uses" type="number" min="1" value="${h(c ? c.max_uses || '' : '')}"></label></div>
      <label class="field"><span>Last day it works <small class="muted">(empty = never ends)</small></span><input name="ends_on" type="date" value="${h(c ? c.ends_on || '' : '')}"></label>
      <label class="check"><input type="checkbox" name="active" ${!c || c.active ? 'checked' : ''}> On</label>
      <div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Cancel</button>${c ? '<button class="btn ghost danger" type="button" data-del>Delete</button>' : ''}</div><p class="muted" id="cp-msg"></p></form>`;
    if (!d.open) d.showModal();
    const f = q$('#cp-form', d);
    f.onclick = async (e) => {
      if (e.target.closest('[data-close]')) d.close();
      if (e.target.closest('[data-del]') && confirm(`Delete the coupon ${c.code}?`)) { await call(`/coupons/${c.id}`, { method: 'DELETE' }); d.close(); done(); }
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = { code: f.code.value, value: f.value.value, kind: f.kind.value, applies: f.applies.value, max_uses: f.max_uses.value, ends_on: f.ends_on.value, active: f.active.checked };
      try { await call(c ? `/coupons/${c.id}` : '/coupons', { method: c ? 'PUT' : 'POST', json: body }); d.close(); say('Coupon saved.'); done(); }
      catch (err) { q$('#cp-msg', d).textContent = err.message; }
    };
  }

  // ======================= Referral partners =======================
  async function renderReferrals(root, modeBar) {
    const d = await call('/referrals');
    const s = d.settings, ps = d.partners;
    const sum = (k) => ps.reduce((n, p) => n + p[k], 0);
    root.innerHTML = `${modeBar}<div class="tiles pay-tiles">${tile('Partners', ps.filter((p) => p.active).length, 'people', '#2563eb')}${tile('Sales from partners', money(sum('sold')), 'money', '#16a34a', `${sum('sales')} sale${sum('sales') === 1 ? '' : 's'}`)}
        ${tile('You owe partners', money(sum('owed')), 'hand', '#d97706', 'Pay them, then press Mark paid')}</div>
      <div class="card-box ref-set"><h2>How it works</h2><p class="muted small">Each partner gets their own link. When someone opens it, we remember who sent them for 60 days. When that person pays an invoice (a Buy now link, a course, any invoice), the partner earns their percent. You pay them yourself, by Zelle or check, then press <b>Mark paid</b>. Partners see their link and earnings in their customer portal.</p>
        <div class="biz-two"><label class="field"><span>Partner links go to</span><select id="ref-landing"><option value="">The customer portal sign-in</option>${s.choices.map((c) => `<option value="${h(c.path)}"${c.path === s.landing ? ' selected' : ''}>${h(c.name)}</option>`).join('')}</select></label>
          <label class="field"><span>New partners earn (%)</span><input id="ref-pct" type="number" min="0" max="90" step="any" value="${h(s.percent)}"></label></div>
        <div class="row"><button class="btn" data-save-ref>Save</button></div></div>
      <form class="row crm-filters" id="ref-add"><input name="who" list="ref-people" placeholder="Make someone a partner: type a name" autocomplete="off" style="flex:1;min-width:220px"><datalist id="ref-people"></datalist><button class="btn primary">Add partner</button></form>
      ${ps.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Partner</th><th>Code</th><th>Visits</th><th>People</th><th>Sales</th><th>Owed</th><th>Paid</th><th></th></tr></thead><tbody>
        ${ps.map((p) => `<tr data-ref="${p.id}"${p.active ? '' : ' class="muted"'}><td><b>${h(p.name)}</b><br><span class="muted small">${p.percent}% of each sale</span></td><td><b class="cp-code">${h(p.code)}</b></td><td>${p.clicks}</td><td>${p.people}</td><td>${money(p.sold)}</td>
          <td><b>${money(p.owed)}</b></td><td>${money(p.paid)}</td><td class="pay-act"><button class="btn ghost" data-copy-val="${h(p.link)}">Copy link</button>${p.owed ? '<button class="btn" data-paid>Mark paid</button>' : ''}<button class="btn ghost" data-edit-ref>Edit</button></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="db-empty center pay-empty">${svg('hand')}<b>No partners yet</b><span>Happy customers, friends and other businesses can send you buyers. Add them above and send them their link.</span></div>`}`;
    const form = q$('#ref-add', root);
    let list = null;
    form.who.onfocus = async () => { if (list) return; list = await people(); q$('#ref-people', root).innerHTML = list.map((p) => `<option value="${h(p.name)}">${h(p.email || '')}</option>`).join(''); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      list ||= await people();
      const p = list.find((x) => x.name.toLowerCase() === form.who.value.trim().toLowerCase());
      if (!p) return say('Pick someone from the list (add them on People first if they are new).', true);
      try { await call('/referrals', { method: 'POST', json: { contact_id: p.id } }); say(`${p.name} is a partner now. Copy their link and send it to them.`); renderReferrals(root, modeBar); } catch (err) { say(err.message, true); }
    };
    return async (e) => {
      if (onCopy(e)) return;
      try {
        if (e.target.closest('[data-save-ref]')) { await call('/referrals/settings', { method: 'PUT', json: { landing: q$('#ref-landing', root).value, percent: q$('#ref-pct', root).value } }); say('Saved.'); return renderReferrals(root, modeBar); }
        const r = e.target.closest('[data-ref]');
        if (!r) return;
        const p = ps.find((x) => x.id === Number(r.dataset.ref));
        if (e.target.closest('[data-paid]')) { if (confirm(`Did you pay ${p.name} ${money(p.owed)}? This marks it as paid.`)) { await call(`/referrals/${p.id}/paid`, { method: 'POST' }); say('Marked as paid.'); renderReferrals(root, modeBar); } return; }
        if (e.target.closest('[data-edit-ref]')) editPartner(p, () => renderReferrals(root, modeBar));
      } catch (err) { say(err.message, true); }
    };
  }
  async function editPartner(p, done) {
    const d = dlg();
    const sales = (await call(`/referrals/${p.id}/sales`)).sales;
    d.innerHTML = `<form id="ref-form"><h1>${h(p.name)}</h1>${linkbox(p.link)}
      <div class="biz-two"><label class="field"><span>Code in their link</span><input name="code" maxlength="20" value="${h(p.code)}" style="text-transform:uppercase"></label>
        <label class="field"><span>They earn (%)</span><input name="percent" type="number" min="0" max="90" step="any" value="${h(p.percent)}"></label></div>
      <label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Link works</label>
      <h2>People they sent</h2>${sales.length ? `<ul class="ref-sales">${sales.map((x) => `<li><b>${h(x.name)}</b> <span class="muted small">${day(x.created_at)}</span> ${x.invoice_id ? `· bought ${money(x.amount)} · earned ${money(x.commission)} <span class="pay-pill" style="--c:${x.status === 'paid' ? '#16a34a' : '#d97706'}">${x.status === 'paid' ? 'Paid' : 'Owed'}</span>` : '· <span class="muted">signed up</span>'}</li>`).join('')}</ul>` : '<p class="muted">Nobody yet.</p>'}
      <div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Close</button><button class="btn ghost danger" type="button" data-del>Remove partner</button></div><p class="muted" id="ref-msg"></p></form>`;
    if (!d.open) d.showModal();
    const f = q$('#ref-form', d);
    f.onclick = async (e) => {
      if (onCopy(e)) return;
      if (e.target.closest('[data-close]')) d.close();
      if (e.target.closest('[data-del]') && confirm(`Remove ${p.name} as a partner? Their link stops working and their history is removed.`)) { await call(`/referrals/${p.id}`, { method: 'DELETE' }); d.close(); done(); }
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      try { await call(`/referrals/${p.id}`, { method: 'PUT', json: { code: f.code.value, percent: f.percent.value, active: f.active.checked } }); d.close(); say('Saved.'); done(); }
      catch (err) { q$('#ref-msg', d).textContent = err.message; }
    };
  }

  // ======================= Course community (inside the course editor) =======================
  async function communityBox(box, courseId, bizName) {
    const draw = (posts) => {
      box.innerHTML = `<div class="row" style="justify-content:space-between"><h2>${svg('chat')} Community (${posts.length} post${posts.length === 1 ? '' : 's'})</h2></div>
        <p class="muted small">Members talk here, inside their portal. Your posts and replies show as <b>${h(bizName || 'Team')}</b>. Your iPhone buzzes when a member posts.</p>
        <form class="row talk-new"><textarea name="body" rows="2" placeholder="Post to all members: a welcome, a tip, a live call link..." required style="flex:1;min-width:220px"></textarea><button class="btn primary">Post</button></form>
        ${posts.map((p) => `<div class="talk-post" data-post="${p.id}"><div class="talk-head"><b>${h(p.contact_id ? p.name : bizName || 'Team')}</b>${p.contact_id ? '' : ' <span class="pay-pill" style="--c:#16a34a">You</span>'}${p.pinned ? ' <span class="pay-pill" style="--c:#2563eb">Pinned</span>' : ''} <span class="muted small">${day(p.created_at)}</span>
          <span class="talk-tools"><button class="btn ghost icon" data-pin aria-label="${p.pinned ? 'Unpin' : 'Pin to top'}" title="${p.pinned ? 'Unpin' : 'Pin to top'}">${svg('pin')}</button><button class="btn ghost icon danger" data-del-post aria-label="Delete post">${svg('trash')}</button></span></div>
          <div class="talk-body">${h(p.body)}</div>
          ${p.comments.map((c) => `<div class="talk-cmt" data-cmt="${c.id}"><b>${h(c.contact_id ? c.name : bizName || 'Team')}</b> ${h(c.body)} <button class="linkish" data-del-cmt>Delete</button></div>`).join('')}
          <form class="row talk-reply"><input name="body" placeholder="Reply" required style="flex:1"><button class="btn">Reply</button></form></div>`).join('') || '<p class="muted">No posts yet. Start with a welcome post!</p>'}`;
    };
    draw((await call(`/community/${courseId}`)).posts);
    box.onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, post = f.closest('[data-post]');
      try { draw((await call(post ? `/community/posts/${post.dataset.post}/comments` : `/community/${courseId}`, { method: 'POST', json: { body: f.body.value } })).posts); } catch (err) { say(err.message, true); }
    };
    box.onclick = async (e) => {
      const post = e.target.closest('[data-post]');
      if (!post) return;
      try {
        if (e.target.closest('[data-pin]')) draw((await call(`/community/posts/${post.dataset.post}`, { method: 'PUT', json: { pinned: !post.querySelector('.talk-head').textContent.includes('Pinned') } })).posts);
        else if (e.target.closest('[data-del-post]')) { if (confirm('Delete this post and its replies?')) draw((await call(`/community/posts/${post.dataset.post}`, { method: 'DELETE' })).posts); }
        else if (e.target.closest('[data-del-cmt]')) { if (confirm('Delete this reply?')) draw((await call(`/community/comments/${e.target.closest('[data-cmt]').dataset.cmt}`, { method: 'DELETE' })).posts); }
      } catch (err) { say(err.message, true); }
    };
  }

  window.VTExtra3 = { renderSitesTab, renderFunnels, renderCoupons, renderReferrals, communityBox };
})();
