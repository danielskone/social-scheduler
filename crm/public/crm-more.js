// Viral Touch CRM: Payments (invoices), Reviews, and the extra Settings sections
// (custom fields, payments, team). Loaded before crm.js, which calls window.VTMore.
(() => {
  const q$ = (s, el = document) => el.querySelector(s);
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => Number(n || 0).toLocaleString([], { style: 'currency', currency: 'USD' });
  const day = (iso) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '');
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
  const say = (msg, err) => { const el = q$('#banner'); el.textContent = msg; el.className = `banner${err ? ' error' : ''}`; el.hidden = !msg; if (msg && !err) setTimeout(() => { if (el.textContent === msg) el.hidden = true; }, 4000); };
  const I = {
    money: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.2c-.5-.8-1.5-1.3-2.8-1.3-1.6 0-2.7.8-2.7 2s1.1 1.7 2.7 2c1.7.3 2.9.9 2.9 2.2 0 1.3-1.2 2.1-2.9 2.1-1.4 0-2.5-.6-3-1.5M12 6.3v1.6M12 16.2v1.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
    alert: '<path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.1"/>',
    doc: '<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4M9 12h6M9 15.5h6"/>',
    star: '<path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
    send: '<path d="M4 12 20 4l-5 16-3.5-6.5z"/><path d="m11.5 13.5 3-3"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
    team: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 19.5c.9-3.1 3.2-4.8 6-4.8s5.1 1.7 6 4.8"/><circle cx="17" cy="9.5" r="2.6"/><path d="M16.5 14.8c2.3.2 3.9 1.7 4.5 4.2"/>',
    box: '<rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M8 10h8M8 14h5"/>',
  };
  const svg = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;
  const tile = (label, value, ico, c, sub) => `<div class="tile"><div class="tile-ico" style="--c:${c}">${svg(ico)}</div><div><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div></div>`;
  const dlg = () => { const d = q$('#crm-edit-dialog'); d.classList.remove('wide'); return d; };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); say('Link copied.'); } catch { prompt('Copy this link:', text); } };

  let me = null;
  const who = async () => (me ||= await call('/me', { noBiz: true }).catch(() => ({ role: 'owner' })));
  const isAdmin = () => !me || !me.team || me.role === 'admin';

  // ======================= Payments (invoices) =======================
  const LABEL = { draft: ['Draft', '#6b7280'], sent: ['Waiting', '#2563eb'], overdue: ['Overdue', '#dc2626'], paid: ['Paid', '#16a34a'], void: ['Cancelled', '#9ca3af'] };
  const pill = (l) => `<span class="pay-pill" style="--c:${LABEL[l][1]}">${LABEL[l][0]}</span>`;
  let payFilter = '';
  let payMode = store.get('pay-mode', 'invoices');
  const modeBar = () => `<div class="seg pay-seg" role="group" aria-label="Show"><button type="button" data-mode="invoices" class="${payMode === 'invoices' ? 'on' : ''}">Invoices</button><button type="button" data-mode="quotes" class="${payMode === 'quotes' ? 'on' : ''}">Quotes</button><button type="button" data-mode="products" class="${payMode === 'products' ? 'on' : ''}">Products</button><button type="button" data-mode="coupons" class="${payMode === 'coupons' ? 'on' : ''}">Coupons</button><button type="button" data-mode="referrals" class="${payMode === 'referrals' ? 'on' : ''}">Referrals</button><button type="button" data-mode="plans" class="${payMode === 'plans' ? 'on' : ''}">Plans</button><button type="button" data-mode="contracts" class="${payMode === 'contracts' ? 'on' : ''}">Contracts</button></div>`;
  async function renderPayments(opts = {}) {
    const root = q$('#pay-root');
    const switchMode = (e) => { const m = e.target.closest('[data-mode]'); if (!m) return false; payMode = m.dataset.mode; store.set('pay-mode', payMode); renderPayments(); return true; };
    if (opts.quoteFor) { payMode = 'quotes'; store.set('pay-mode', payMode); }
    if (opts.contractFor) { payMode = 'contracts'; store.set('pay-mode', payMode); }
    if (payMode === 'plans' || payMode === 'contracts') {
      const handle = await window.VTExtra4[payMode === 'plans' ? 'renderPlans' : 'renderContracts'](root, modeBar());
      root.onclick = (e) => { if (!switchMode(e)) handle(e); };
      if (opts.contractFor) window.VTExtra4.editContract(null, opts.contractFor, () => renderPayments());
      return;
    }
    if (payMode === 'coupons' || payMode === 'referrals') {
      const handle = await window.VTExtra3[payMode === 'coupons' ? 'renderCoupons' : 'renderReferrals'](root, modeBar());
      root.onclick = (e) => { if (!switchMode(e)) handle(e); };
      return;
    }
    if (payMode === 'products') {
      const handle = await window.VTExtra2.renderProducts(root, modeBar());
      root.onclick = (e) => { if (!switchMode(e)) handle(e); };
      return;
    }
    if (payMode === 'quotes') {
      const handle = await window.VTExtra.renderQuotes(root, modeBar());
      root.onclick = (e) => { if (!switchMode(e)) handle(e); };
      if (opts.quoteFor) window.VTExtra.editQuote(null, opts.quoteFor);
      return;
    }
    const d = await call(`/invoices${payFilter ? `?status=${payFilter}` : ''}`);
    const t = d.totals, st = d.settings;
    root.innerHTML = `${modeBar()}<div class="tiles pay-tiles">${tile('Waiting to be paid', money(t.unpaid), 'clock', '#2563eb')}${tile('Overdue', money(t.overdue), 'alert', '#dc2626')}
        ${tile('Paid, last 30 days', money(t.paid30), 'money', '#16a34a')}${tile('Drafts', t.drafts, 'doc', '#6b7280')}</div>
      ${!st.stripe ? `<div class="pay-setup">${svg('money')}<div><b>Get paid by card</b><span>Connect your own Stripe account and every invoice gets a <b>Pay with card</b> button. The money goes straight to you.${isAdmin() ? '' : ' Ask the owner to set it up.'}</span></div>${isAdmin() ? '<button class="btn" data-stripe>Set up</button>' : ''}</div>` : ''}
      <div class="row crm-filters"><button class="btn primary" data-new>+ New invoice</button>
        <select id="pay-filter" aria-label="Show">${[['', 'All invoices'], ['unpaid', 'Waiting and overdue'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['draft', 'Drafts'], ['void', 'Cancelled']].map(([v, l]) => `<option value="${v}"${v === payFilter ? ' selected' : ''}>${l}</option>`).join('')}</select>
        ${isAdmin() ? '<button class="btn ghost" data-stripe>Payment settings</button>' : ''}</div>
      ${d.invoices.length ? `<div class="table-wrap"><table class="table pay-table"><thead><tr><th>#</th><th>For</th><th>Total</th><th>Status</th><th>Due</th><th></th></tr></thead><tbody>
        ${d.invoices.map((i) => `<tr data-id="${i.id}"><td>${i.number}</td><td><b>${h(i.contact ? i.contact.name : 'Removed person')}</b>${i.business ? `<br><span class="muted small">${h(i.business.name)}</span>` : ''}</td>
          <td><b>${money(i.total)}</b></td><td>${pill(i.label)}${i.status === 'paid' ? `<br><span class="muted small">${h(i.paid_how)} · ${day(i.paid_at)}</span>` : ''}</td>
          <td>${i.due_date ? day(i.due_date) : '<span class="muted">On receipt</span>'}</td><td class="pay-act"><button class="btn ghost" data-open>Open</button></td></tr>`).join('')}
      </tbody></table></div>` : `<div class="db-empty center pay-empty">${svg('doc')}<b>No invoices${payFilter ? ' here' : ' yet'}</b><span>Press <b>+ New invoice</b>, or open a person's card and press <b>Invoice</b>.</span></div>`}`;
    q$('#pay-filter', root).onchange = (e) => { payFilter = e.target.value; renderPayments(); };
    root.onclick = (e) => {
      if (switchMode(e)) return;
      if (e.target.closest('[data-new]')) return editInvoice(null, null);
      if (e.target.closest('[data-stripe]')) return paySettings();
      const row = e.target.closest('tr[data-id]');
      if (row) openInvoice(Number(row.dataset.id));
    };
    if (opts.contact) editInvoice(null, opts.contact);
  }

  async function editInvoice(inv, contactId) {
    const people = inv ? [] : (await call('/contacts')).map((c) => ({ id: c.id, name: c.name, email: c.email }));
    const items = inv ? inv.items : [{ what: '', qty: 1, price: '' }];
    const d = dlg();
    const row = (i) => `<div class="inv-line"><input name="what" placeholder="What it's for, e.g. Gold sponsorship" value="${h(i.what)}" required>
      <input name="qty" type="number" min="0.01" step="any" value="${h(i.qty ?? 1)}" aria-label="Quantity" title="Quantity">
      <input name="price" inputmode="decimal" placeholder="$0.00" value="${h(i.price)}" aria-label="Price" required><button type="button" class="btn ghost" data-rm aria-label="Remove line">×</button></div>`;
    d.innerHTML = `<form id="inv-form"><h1>${inv ? `Invoice #${inv.number}` : 'New invoice'}</h1>
      ${inv ? `<p class="muted">For <b>${h(inv.contact ? inv.contact.name : '')}</b></p>` : `<label class="field"><span>Who is it for?</span><input name="who" list="inv-people" placeholder="Start typing a name" required autocomplete="off" value="${h((people.find((p) => p.id === contactId) || {}).name || '')}">
        <datalist id="inv-people">${people.map((p) => `<option value="${h(p.name)}">${h(p.email || '')}</option>`).join('')}</datalist></label>`}
      <div class="inv-head"><span>What</span><span>Qty</span><span>Price</span><span></span></div>
      <div id="inv-lines">${items.map(row).join('')}</div>
      <button type="button" class="btn ghost" data-add>+ Add a line</button>
      <div class="biz-two"><label class="field"><span>Tax % <small class="muted">(leave 0 if none)</small></span><input name="tax_rate" type="number" min="0" max="50" step="any" value="${h(inv ? inv.tax_rate : 0)}"></label>
        <label class="field"><span>Due date <small class="muted">(empty = on receipt)</small></span><input name="due_date" type="date" value="${h(inv ? inv.due_date || '' : '')}"></label></div>
      <label class="field"><span>Note for them <small class="muted">(optional)</small></span><textarea name="note" rows="2" placeholder="Thank you for sponsoring the parade!">${h(inv ? inv.note || '' : '')}</textarea></label>
      <p class="inv-total">Total <b id="inv-sum">$0.00</b></p>
      <div class="row"><button class="btn primary">${inv ? 'Save' : 'Save draft'}</button><button class="btn ghost" type="button" data-close>Cancel</button></div>
      <p class="muted" id="inv-msg"></p></form>`;
    if (!d.open) d.showModal();
    const f = q$('#inv-form', d);
    const sum = () => {
      const lines = [...f.querySelectorAll('.inv-line')].map((l) => Number(q$('[name=qty]', l).value || 0) * Number(String(q$('[name=price]', l).value).replace(/[$,\s]/g, '') || 0));
      const sub = lines.reduce((a, b) => a + b, 0);
      q$('#inv-sum', d).textContent = money(sub * (1 + Number(f.tax_rate.value || 0) / 100));
    };
    sum();
    f.oninput = sum;
    if (window.VTExtra2) window.VTExtra2.productButton(d, '#inv-lines', row, sum);
    f.onclick = (e) => {
      if (e.target.closest('[data-close]')) d.close();
      if (e.target.closest('[data-add]')) { q$('#inv-lines', d).insertAdjacentHTML('beforeend', row({ what: '', qty: 1, price: '' })); q$('#inv-lines .inv-line:last-child input', d).focus(); }
      const rm = e.target.closest('[data-rm]');
      if (rm && f.querySelectorAll('.inv-line').length > 1) { rm.parentElement.remove(); sum(); }
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = { items: [...f.querySelectorAll('.inv-line')].map((l) => ({ what: q$('[name=what]', l).value, qty: q$('[name=qty]', l).value, price: q$('[name=price]', l).value })),
        tax_rate: f.tax_rate.value, due_date: f.due_date.value, note: f.note.value };
      if (!inv) {
        const p = people.find((x) => x.name.toLowerCase() === f.who.value.trim().toLowerCase());
        if (!p) { q$('#inv-msg', d).textContent = 'Pick someone from the list (add them on People first if they are new).'; return; }
        body.contact_id = p.id;
      }
      try {
        const saved = await call(inv ? `/invoices/${inv.id}` : '/invoices', { method: inv ? 'PUT' : 'POST', json: body });
        openInvoice(saved.id);
        if (q$('#pay-root') && !q$('.crm-panel[data-panel="payments"]').hidden) renderPayments();
      } catch (err) { q$('#inv-msg', d).textContent = err.message; }
    };
  }

  async function openInvoice(id) {
    const inv = await call(`/invoices/${id}`);
    const d = dlg();
    const open = ['draft', 'sent'].includes(inv.status);
    d.innerHTML = `<div class="inv-view"><header class="view-head"><h1>Invoice #${inv.number} ${pill(inv.label)}</h1><button class="btn ghost" data-close>Close</button></header>
      <p><b>${h(inv.contact ? inv.contact.name : '')}</b>${inv.contact && inv.contact.email ? ` · <span class="muted">${h(inv.contact.email)}</span>` : ''}${inv.business ? `<br><span class="muted small">${h(inv.business.name)}</span>` : ''}</p>
      <table class="table inv-items"><thead><tr><th>What</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead><tbody>
        ${inv.items.map((i) => `<tr><td>${h(i.what)}</td><td>${i.qty}</td><td>${money(i.price)}</td><td>${money(i.qty * i.price)}</td></tr>`).join('')}</tbody></table>
      <p class="inv-total">${inv.tax ? `<span class="muted small">Subtotal ${money(inv.subtotal)} + tax ${money(inv.tax)}</span><br>` : ''}Total <b>${money(inv.total)}</b></p>
      <p class="muted small">${inv.due_date ? `Due ${day(inv.due_date)}` : 'Due on receipt'}${inv.sent_at ? ` · Sent ${day(inv.sent_at)}` : ''}${inv.paid_at ? ` · Paid ${day(inv.paid_at)} (${h(inv.paid_how)})` : ''}</p>
      ${inv.status !== 'draft' ? `<div class="inv-link"><code>${h(inv.link)}</code><button class="btn ghost" data-copy>${svg('link')}<span>Copy link</span></button><a class="btn ghost" href="${h(inv.link)}" target="_blank" rel="noopener">${svg('eye')}<span>View</span></a></div>` : ''}
      <div class="inv-actions">
        ${open ? `<button class="btn primary" data-send ${inv.contact && inv.contact.email ? '' : 'disabled title="This person has no email address"'}>${svg('send')}<span>${inv.status === 'sent' ? 'Email it again' : 'Email it'}</span></button>` : ''}
        ${inv.status === 'draft' ? '<button class="btn" data-mark-sent>I\'ll send the link myself</button>' : ''}
        ${open ? '<button class="btn" data-edit>Edit</button>' : ''}
        ${inv.status === 'sent' ? '<button class="btn" data-paid>Mark as paid</button>' : ''}
        ${inv.status === 'paid' ? '<button class="btn ghost" data-unpaid>Mark as not paid</button>' : ''}
        ${inv.status === 'sent' ? '<button class="btn ghost danger" data-void>Cancel invoice</button>' : ''}
        ${inv.status === 'draft' ? '<button class="btn ghost danger" data-del>Delete draft</button>' : ''}
      </div><p class="muted" id="inv-msg"></p></div>`;
    if (!d.open) d.showModal();
    const msg = (t) => { q$('#inv-msg', d).textContent = t; };
    const after = (t) => { say(t); openInvoice(inv.id); if (!q$('.crm-panel[data-panel="payments"]').hidden) renderPayments(); };
    d.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      try {
        if (b.matches('[data-close]')) d.close();
        else if (b.matches('[data-copy]')) copy(inv.link);
        else if (b.matches('[data-edit]')) editInvoice(inv);
        else if (b.matches('[data-send]')) { b.disabled = true; msg('Sending...'); await call(`/invoices/${inv.id}/send`, { method: 'POST', json: { by: 'email' } }); after(`Invoice #${inv.number} emailed to ${inv.contact.name}.`); }
        else if (b.matches('[data-mark-sent]')) { await call(`/invoices/${inv.id}/send`, { method: 'POST', json: { by: 'link' } }); after('Ready. Copy the link and send it by text or email.'); }
        else if (b.matches('[data-paid]')) { const how = prompt('How did they pay? (for example Cash, Check, Zelle, Venmo)', 'Check'); if (how) { await call(`/invoices/${inv.id}/paid`, { method: 'POST', json: { how } }); after('Marked as paid.'); } }
        else if (b.matches('[data-unpaid]')) { await call(`/invoices/${inv.id}/status`, { method: 'POST', json: { status: 'sent' } }); after('Marked as not paid.'); }
        else if (b.matches('[data-void]')) { if (confirm('Cancel this invoice? The link will show it as cancelled.')) { await call(`/invoices/${inv.id}/status`, { method: 'POST', json: { status: 'void' } }); after('Invoice cancelled.'); } }
        else if (b.matches('[data-del]')) { if (confirm('Delete this draft?')) { await call(`/invoices/${inv.id}`, { method: 'DELETE' }); d.close(); say('Draft deleted.'); if (!q$('.crm-panel[data-panel="payments"]').hidden) renderPayments(); } }
      } catch (err) { msg(err.message); b.disabled = false; }
    };
  }

  async function paySettings() {
    const st = await call('/invoices/settings', { noBiz: true });
    const d = dlg();
    d.innerHTML = `<form id="pay-set"><h1>Payment settings</h1>
      <h2 class="small-h">Card payments with your own Stripe</h2>
      ${st.stripe ? `<p class="ok-line">${svg('money')} Connected${st.stripeAccount ? `: <b>${h(st.stripeAccount)}</b>` : ''} <span class="muted small">(${h(st.stripeKey)})</span></p>` : ''}
      <ol class="lp-steps">
        <li>Open <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener">your Stripe API keys page</a> (make a free Stripe account first if you don't have one).</li>
        <li>Press <b>Create restricted key</b>. Name it Viral Touch. Set <b>Checkout Sessions</b> to <b>Write</b>. For monthly plans, also set <b>Subscriptions</b> to <b>Write</b> and <b>Invoices</b> to <b>Read</b>. Leave the rest as None, and press Create key.</li>
        <li>Copy the key (it starts with rk_live_) and paste it here.</li></ol>
      <label class="field"><span>Stripe restricted key</span><input name="stripeKey" autocomplete="off" placeholder="${st.stripe ? 'Saved. Paste a new key to replace it.' : 'rk_live_...'}"></label>
      ${st.stripe ? '<label class="check"><input type="checkbox" name="remove"> Disconnect Stripe</label>' : ''}
      <p class="muted small">Stripe charges its normal card fee. Viral Touch adds nothing and never holds your money.</p>
      <h2 class="small-h">Other ways to pay</h2>
      <label class="field"><span>Shown on every invoice <small class="muted">(optional)</small></span><textarea name="payNote" rows="3" placeholder="Zelle: you@business.com&#10;Checks to: Your Business, PO Box 1, Town, ST 12345">${h(st.payNote)}</textarea></label>
      <div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Cancel</button></div><p class="muted" id="ps-msg"></p></form>`;
    if (!d.open) d.showModal();
    q$('[data-close]', d).onclick = () => d.close();
    q$('#pay-set', d).onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, body = { payNote: f.payNote.value };
      if (f.remove && f.remove.checked) body.stripeKey = '';
      else if (f.stripeKey.value.trim()) body.stripeKey = f.stripeKey.value.trim();
      q$('#ps-msg', d).textContent = 'Checking...';
      try { await call('/invoices/settings', { method: 'PUT', json: body, noBiz: true }); d.close(); say('Payment settings saved.'); if (!q$('.crm-panel[data-panel="payments"]').hidden) renderPayments(); }
      catch (err) { q$('#ps-msg', d).textContent = err.message; }
    };
  }

  // ======================= Reviews =======================
  async function renderReviews() {
    const root = q$('#rev-root');
    const d = await call('/reviews');
    const missing = d.businesses.filter((b) => !b.review_url);
    root.innerHTML = `<div class="tiles rev-tiles">${tile('Asked, last 30 days', d.totals.sent, 'send', '#d97706')}${tile('Opened the link', d.totals.opened, 'eye', '#16a34a', d.totals.sent ? `${Math.round(d.totals.opened / d.totals.sent * 100)}% of them` : '')}${tile('Asked in total', d.totals.allTime, 'star', '#db2777')}</div>
      ${missing.length ? `<div class="pay-setup">${svg('star')}<div><b>Add your review link</b><span>${missing.map((b) => h(b.name)).join(', ')} ${missing.length === 1 ? 'has' : 'have'} no review link yet. Find yours on your Google Business Profile: <b>Ask for reviews</b>, then copy the link. Paste it in Settings, Edit the business.</span></div><a class="btn" href="#contacts/settings">Open Settings</a></div>` : ''}
      <div class="rev-grid"><section class="db-card"><header><h3>Good people to ask</h3><span class="muted small">They reached a "won" step and were never asked</span></header>
        ${d.suggest.length ? `<ul class="rev-list">${d.suggest.map((c) => `<li><span><b>${h(c.name)}</b><span class="muted small">${h(c.stage)} · ${h(c.group_name)}</span></span><button class="btn" data-ask="${c.id}">${svg('star')}<span>Ask</span></button></li>`).join('')}</ul>`
          : '<p class="db-empty">Nobody right now. When someone reaches a won step (like Paid or Sold), they show up here.</p>'}</section>
      <section class="db-card"><header><h3>Asked</h3></header>
        ${d.requests.length ? `<ul class="rev-list">${d.requests.slice(0, 50).map((r) => `<li><span><b>${h(r.name)}</b><span class="muted small">${r.channel === 'email' ? 'Email' : 'Text'} · ${day(r.sent_at)}</span></span>${r.clicked_at ? `<span class="rev-ok">${svg('eye')} Opened</span>` : '<span class="muted small">Not opened yet</span>'}</li>`).join('')}</ul>`
          : '<p class="db-empty">Nobody asked yet. Press Ask next to someone, or use <b>Review</b> on a person\'s card.</p>'}</section></div>`;
    root.onclick = (e) => { const b = e.target.closest('[data-ask]'); if (b) askReview(Number(b.dataset.ask), renderReviews); };
  }

  async function askReview(contactId, done) {
    let ctx;
    try { ctx = await call(`/reviews/contact/${contactId}`); } catch (e) { say(e.message, true); return; }
    const c = ctx.contact, b = ctx.business, d = dlg();
    const msgText = ctx.message.replace('{business}', b ? b.name : 'us');
    d.innerHTML = `<form id="rev-form"><h1>Ask ${h(String(c.name).split(' ')[0])} for a review</h1>
      ${!b || !b.review_url ? `<p class="err-line">Add a review link for ${h(b ? b.name : 'this business')} first: Settings, Edit the business, "Review link".</p>` : `<p class="muted small">Goes to: ${h(b.review_url)}</p>`}
      ${ctx.tooSoon ? `<p class="err-line">You already asked on ${day(ctx.last.sent_at)}. Asking again so soon can annoy people.</p>` : ''}
      <label class="field"><span>Message</span><textarea name="message" rows="5">${h(msgText)}</textarea></label>
      <p class="muted small">{first_name} and {link} fill in by themselves. The link counts when they open it.</p>
      <div class="row">${ctx.canEmail ? '<button class="btn primary" value="email">Send email</button>' : ''}${ctx.canText ? '<button class="btn" value="text">Text it (opens Messages)</button>' : ''}<button class="btn ghost" type="button" data-close>Cancel</button></div>
      ${!ctx.canEmail && !ctx.canText ? '<p class="err-line">Add an email address or phone number on their card first.</p>' : ''}
      <p class="muted" id="rev-msg"></p></form>`;
    if (!d.open) d.showModal();
    q$('[data-close]', d).onclick = () => d.close();
    q$('#rev-form', d).onsubmit = async (e) => {
      e.preventDefault();
      const channel = e.submitter?.value || 'email';
      try {
        const r = await call(`/reviews/contact/${contactId}`, { method: 'POST', json: { channel, message: e.target.message.value, force: ctx.tooSoon } });
        d.close();
        if (r.sms) location.href = r.sms; else say(`Review request emailed to ${c.name}.`);
        if (done) done();
      } catch (err) { q$('#rev-msg', d).textContent = err.message; }
    };
  }

  // ======================= Settings: custom fields, team =======================
  const TYPE_NAMES = { text: 'Short text', long: 'Long text', number: 'Number', money: 'Money ($)', date: 'Date', choice: 'Pick from a list', yesno: 'Yes / no', link: 'Web link' };
  async function settingsSections(meta, refresh) {
    await who();
    const box = q$('#set-more');
    if (!box) return;
    const [fields, team] = await Promise.all([call('/fields'), isAdmin() && !me.customerCopy ? call('/team', { noBiz: true }).catch(() => []) : Promise.resolve(null)]);
    const bizNames = new Map((window.VTHome.list ? window.VTHome.list() : []).map((b) => [b.id, b.name]));
    box.innerHTML = `<div class="set-head" style="margin-top:26px"><div><h2>Custom fields</h2><p class="muted">Your own boxes on every person's card, like "Car model", "Shirt size" or "Birthday". Use them in messages too: {Car model}.</p></div>
        ${isAdmin() ? '<button class="btn primary" data-field-new>+ Add a field</button>' : ''}</div>
      <div class="set-list">${fields.map((f, i) => `<div class="set-biz" data-field="${f.id}"><span class="set-ico">${svg('box')}</span><div class="set-info"><b>${h(f.label)}</b>
          <span class="muted small">${TYPE_NAMES[f.type]}${f.type === 'choice' ? `: ${h(f.options.join(', '))}` : ''} · ${f.business_id ? `only ${h(bizNames.get(f.business_id) || 'one business')}` : 'every business'}</span></div>
          ${isAdmin() ? `<span class="set-move"><button class="btn ghost" data-up ${i ? '' : 'disabled'} aria-label="Move up">↑</button><button class="btn ghost" data-down ${i < fields.length - 1 ? '' : 'disabled'} aria-label="Move down">↓</button></span><button class="btn ghost" data-field-edit>Edit</button>` : ''}</div>`).join('')
        || '<p class="muted">No custom fields yet.</p>'}</div>
      <div class="set-head" style="margin-top:26px"><div><h2>Payments</h2><p class="muted">Send invoices people can pay by card with your own Stripe, or by Zelle, cash or check.</p></div>${isAdmin() ? '<button class="btn" data-pay>Payment settings</button>' : ''}</div>
      <div class="set-head" style="margin-top:26px"><div><h2>Your team</h2><p class="muted">${me.customerCopy ? 'Add the people who help you on your <a href="/account">Account page</a>. Each one gets their own login.' : 'People who help you sign in with their own email and password. <b>Helpers</b> can work with people, tasks, emails and invoices, but can\'t change settings or delete people.'}</p></div>
        ${team ? '<button class="btn primary" data-team-new>+ Add a person</button>' : ''}</div>
      ${team ? `<div class="set-list">${team.map((m) => `<div class="set-biz" data-member="${m.id}"><span class="set-ico">${svg('team')}</span><div class="set-info"><b>${h(m.name)}</b>
          <span class="muted small">${h(m.email)} · ${m.role === 'admin' ? 'Admin' : 'Helper'}${m.role !== 'admin' && m.businesses.length ? ` · only ${h(m.businesses.map((id) => bizNames.get(id) || '?').join(', '))}` : ''} · ${m.last_login_at ? `last in ${day(m.last_login_at.replace(' ', 'T') + 'Z')}` : 'not signed in yet'}</span></div>
          <button class="btn ghost" data-member-edit>Edit</button></div>`).join('') || '<p class="muted">Just you so far.</p>'}</div>
        ${team.length ? `<p class="muted small">They sign in at the CRM address on your phone or Mac, with "On the team? Sign in with your email".</p>` : ''}` : ''}`;
    box.onclick = async (e) => {
      const fRow = e.target.closest('[data-field]');
      if (e.target.closest('[data-field-new]')) return editField(null, refresh);
      if (fRow && e.target.closest('[data-field-edit]')) return editField(fields.find((f) => f.id === Number(fRow.dataset.field)), refresh);
      if (fRow && e.target.closest('[data-up],[data-down]')) { await call(`/fields/${fRow.dataset.field}/move`, { method: 'POST', json: { dir: e.target.closest('[data-up]') ? 'up' : 'down' } }); return refresh(); }
      if (e.target.closest('[data-pay]')) return paySettings();
      if (e.target.closest('[data-team-new]')) return editMember(null, refresh);
      const mRow = e.target.closest('[data-member]');
      if (mRow) editMember(team.find((m) => m.id === Number(mRow.dataset.member)), refresh);
    };
  }

  function editField(f, refresh) {
    const d = dlg(), cur = window.VTHome.current();
    d.innerHTML = `<form id="cf-form"><h1>${f ? `Edit "${h(f.label)}"` : 'Add a field'}</h1>
      <label class="field"><span>Name</span><input name="label" required maxlength="50" value="${h(f ? f.label : '')}" placeholder="e.g. Car model"></label>
      <label class="field"><span>Kind of answer</span><select name="type">${Object.entries(TYPE_NAMES).map(([k, v]) => `<option value="${k}"${(f ? f.type : 'text') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field" id="cf-opts"><span>Choices, one per line</span><textarea name="options" rows="4" placeholder="Small&#10;Medium&#10;Large">${h(f ? f.options.join('\n') : '')}</textarea></label>
      ${cur || (f && f.business_id) ? `<label class="check"><input type="checkbox" name="only"${f ? (f.business_id ? ' checked' : '') : ''}> Only for ${h(f && f.business_id ? ((window.VTHome.list() || []).find((b) => b.id === f.business_id) || {}).name || 'this business' : cur.name)}</label>` : ''}
      <div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Cancel</button>
        ${f ? '<button class="btn ghost danger" type="button" data-del style="margin-left:auto">Remove field</button>' : ''}</div><p class="muted" id="cf-msg"></p></form>`;
    if (!d.open) d.showModal();
    const form = q$('#cf-form', d);
    const showOpts = () => { q$('#cf-opts', d).hidden = form.type.value !== 'choice'; };
    showOpts(); form.type.onchange = showOpts;
    q$('[data-close]', d).onclick = () => d.close();
    const del = q$('[data-del]', d);
    if (del) del.onclick = async () => { if (confirm(`Remove "${f.label}"? Answers already saved stay hidden on cards.`)) { await call(`/fields/${f.id}`, { method: 'DELETE' }); d.close(); refresh(); } };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = { label: form.label.value, type: form.type.value, options: form.options.value };
      if (form.only) body.business_id = form.only.checked ? (f && f.business_id ? f.business_id : cur.id) : null;
      try { await call(f ? `/fields/${f.id}` : '/fields', { method: f ? 'PUT' : 'POST', json: body, noBiz: true }); d.close(); say('Saved.'); refresh(); }
      catch (err) { q$('#cf-msg', d).textContent = err.message; }
    };
  }

  function editMember(m, refresh) {
    const d = dlg(), bizes = window.VTHome.list ? window.VTHome.list() : [];
    d.innerHTML = `<form id="tm-form"><h1>${m ? `Edit ${h(m.name)}` : 'Add a person to your team'}</h1>
      <div class="biz-two"><label class="field"><span>Name</span><input name="name" required value="${h(m ? m.name : '')}"></label>
        <label class="field"><span>Email (they sign in with it)</span><input name="email" type="email" required value="${h(m ? m.email : '')}"></label></div>
      <label class="field"><span>${m ? 'New password <small class="muted">(leave empty to keep)</small>' : 'Password <small class="muted">(at least 8 characters, give it to them)</small>'}</span><input name="password" type="text" minlength="8" autocomplete="new-password" ${m ? '' : 'required'}></label>
      <div class="field"><span>What can they do?</span>
        <label class="check"><input type="radio" name="role" value="helper"${!m || m.role === 'helper' ? ' checked' : ''}> <b>Helper</b>: people, tasks, emails, invoices. No settings, no deleting people.</label>
        <label class="check"><input type="radio" name="role" value="admin"${m && m.role === 'admin' ? ' checked' : ''}> <b>Admin</b>: everything, like you.</label></div>
      ${bizes.length > 1 ? `<div class="field" id="tm-biz"><span>Which businesses can a helper see?</span><p class="muted small" style="margin:0 0 6px">Tick none for all of them.</p>
        <div class="biz-groups">${bizes.map((b) => `<label class="bg-row"><input type="checkbox" name="biz" value="${b.id}"${m && m.businesses.includes(b.id) ? ' checked' : ''}><span>${h(b.name)}</span></label>`).join('')}</div></div>` : ''}
      <div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Cancel</button>
        ${m ? '<button class="btn ghost danger" type="button" data-del style="margin-left:auto">Remove from team</button>' : ''}</div><p class="muted" id="tm-msg"></p></form>`;
    if (!d.open) d.showModal();
    const form = q$('#tm-form', d);
    q$('[data-close]', d).onclick = () => d.close();
    const del = q$('[data-del]', d);
    if (del) del.onclick = async () => { if (confirm(`Remove ${m.name}? They can't sign in anymore.`)) { await call(`/team/${m.id}`, { method: 'DELETE', noBiz: true }); d.close(); refresh(); } };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const body = { name: fd.get('name'), email: fd.get('email'), role: fd.get('role'), businesses: fd.getAll('biz').map(Number) };
      if (fd.get('password')) body.password = fd.get('password');
      try { await call(m ? `/team/${m.id}` : '/team', { method: m ? 'PUT' : 'POST', json: body, noBiz: true }); d.close(); say(m ? 'Saved.' : `${body.name} can now sign in.`); refresh(); }
      catch (err) { q$('#tm-msg', d).textContent = err.message; }
    };
  }

  window.VTMore = { renderPayments, renderReviews, editInvoice, openInvoice, askReview, settingsSections, who, isAdmin };
})();
