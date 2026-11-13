// Viral Touch CRM: Quotes (inside Payments), the appointment calendar, Sites (simple website
// pages) and Reports. Loaded before crm.js, which calls window.VTExtra.
(() => {
  const q$ = (s, el = document) => el.querySelector(s);
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n, whole) => Number(n || 0).toLocaleString([], { style: 'currency', currency: 'USD', ...(whole ? { maximumFractionDigits: 0 } : {}) });
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
    if (opts.raw) return res;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { data });
    return data;
  }
  const say = (msg, err) => { const el = q$('#banner'); el.textContent = msg; el.className = `banner${err ? ' error' : ''}`; el.hidden = !msg; if (msg && !err) setTimeout(() => { if (el.textContent === msg) el.hidden = true; }, 4000); };
  const I = {
    doc: '<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4M9 12h6M9 15.5h6"/>',
    pen: '<path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z"/><path d="M13.5 7l3 3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.8 2.8 5.2-5.6"/>',
    pct: '<circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/><path d="M18 6 6 18"/>',
    send: '<path d="M4 12 20 4l-5 16-3.5-6.5z"/><path d="m11.5 13.5 3-3"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
    up: '<path d="m6 14 6-6 6 6"/>', down: '<path d="m6 10 6 6 6-6"/>', trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', people: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 19.5c.9-3.1 3.2-4.8 6-4.8s5.1 1.7 6 4.8"/><circle cx="17" cy="9.5" r="2.6"/><path d="M16.5 14.8c2.3.2 3.9 1.7 4.5 4.2"/>',
    money: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.2c-.5-.8-1.5-1.3-2.8-1.3-1.6 0-2.7.8-2.7 2s1.1 1.7 2.7 2c1.7.3 2.9.9 2.9 2.2 0 1.3-1.2 2.1-2.9 2.1-1.4 0-2.5-.6-3-1.5M12 6.3v1.6M12 16.2v1.5"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    star: '<path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
    mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
    form: '<rect x="5" y="4.5" width="14" height="16" rx="2.5"/><path d="M9 3.5h6v3H9zM8.5 11h7M8.5 15h5"/>',
    off: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>', phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>',
    print: '<path d="M7 8V3.5h10V8M7 17H4.5V9.5a1.5 1.5 0 0 1 1.5-1.5h12a1.5 1.5 0 0 1 1.5 1.5V17H17"/><path d="M7 14h10v6.5H7z"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
  };
  const svg = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;
  const tile = (label, value, ico, c, sub) => `<div class="tile"><div class="tile-ico" style="--c:${c}">${svg(ico)}</div><div><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div></div>`;
  const dlg = (wide) => { const d = q$('#crm-edit-dialog'); d.classList.toggle('wide', Boolean(wide)); return d; };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); say('Link copied.'); } catch { prompt('Copy this link:', text); } };
  const people = async () => (await call('/contacts')).map((c) => ({ id: c.id, name: c.name, email: c.email }));
  const pickPerson = (list, name) => list.find((x) => x.name.toLowerCase() === String(name || '').trim().toLowerCase());

  // ======================= Quotes (a mode of the Payments tab) =======================
  const QL = { draft: ['Draft', '#6b7280'], sent: ['Waiting', '#2563eb'], expired: ['Expired', '#d97706'], accepted: ['Signed', '#16a34a'], declined: ['Declined', '#9ca3af'], void: ['Cancelled', '#9ca3af'] };
  const qpill = (l) => `<span class="pay-pill" style="--c:${QL[l][1]}">${QL[l][0]}</span>`;
  let quoteFilter = '';
  async function renderQuotes(root, modeBar) {
    const d = await call(`/quotes${quoteFilter ? `?status=${quoteFilter}` : ''}`);
    const t = d.totals;
    root.innerHTML = `${modeBar}<div class="tiles pay-tiles">${tile('Waiting for a signature', money(t.waiting), 'clock', '#2563eb', `${t.waitingCount} quote${t.waitingCount === 1 ? '' : 's'}`)}
        ${tile('Signed, last 30 days', money(t.signed30), 'pen', '#16a34a')}${tile('Win rate', t.winRate == null ? '–' : `${t.winRate}%`, 'pct', '#9333ea', 'Signed out of signed + declined')}${tile('Drafts', t.drafts, 'doc', '#6b7280')}</div>
      <div class="row crm-filters"><button class="btn primary" data-new-quote>+ New quote</button>
        <select id="quote-filter" aria-label="Show">${[['', 'All quotes'], ['sent', 'Waiting'], ['accepted', 'Signed'], ['declined', 'Declined'], ['expired', 'Expired'], ['draft', 'Drafts'], ['void', 'Cancelled']].map(([v, l]) => `<option value="${v}"${v === quoteFilter ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      ${d.quotes.length ? `<div class="table-wrap"><table class="table pay-table"><thead><tr><th>#</th><th>For</th><th>Total</th><th>Status</th><th>Good until</th><th></th></tr></thead><tbody>
        ${d.quotes.map((x) => `<tr data-qid="${x.id}"><td>${x.number}</td><td><b>${h(x.contact ? x.contact.name : 'Removed person')}</b>${x.title ? `<br><span class="muted small">${h(x.title)}</span>` : ''}</td>
          <td><b>${money(x.total)}</b></td><td>${qpill(x.label)}${x.status === 'accepted' ? `<br><span class="muted small">${day(x.signed_at)}${x.invoice ? ` · Invoice #${x.invoice.number}` : ''}</span>` : x.viewed_at && x.status === 'sent' ? '<br><span class="muted small">Opened</span>' : ''}</td>
          <td>${x.valid_until ? day(x.valid_until) : '<span class="muted">No end</span>'}</td><td class="pay-act"><button class="btn ghost" data-open>Open</button></td></tr>`).join('')}
      </tbody></table></div>` : `<div class="db-empty center pay-empty">${svg('pen')}<b>No quotes${quoteFilter ? ' here' : ' yet'}</b><span>Press <b>+ New quote</b>. People sign it on their phone, and it turns into an invoice by itself.</span></div>`}`;
    q$('#quote-filter', root).onchange = (e) => { quoteFilter = e.target.value; window.VTMore.renderPayments(); };
    return (e) => {
      if (e.target.closest('[data-new-quote]')) { editQuote(null, null); return true; }
      const row = e.target.closest('tr[data-qid]');
      if (row) { openQuote(Number(row.dataset.qid)); return true; }
      return false;
    };
  }
  const refreshPay = () => { if (!q$('.crm-panel[data-panel="payments"]').hidden) window.VTMore.renderPayments(); };

  async function editQuote(qt, contactId) {
    const list = qt ? [] : await people();
    const items = qt ? qt.items : [{ what: '', qty: 1, price: '' }];
    const d = dlg();
    const row = (i) => `<div class="inv-line"><input name="what" placeholder="What's included, e.g. Website design" value="${h(i.what)}" required>
      <input name="qty" type="number" min="0.01" step="any" value="${h(i.qty ?? 1)}" aria-label="Quantity" title="Quantity">
      <input name="price" inputmode="decimal" placeholder="$0.00" value="${h(i.price)}" aria-label="Price" required><button type="button" class="btn ghost" data-rm aria-label="Remove line">×</button></div>`;
    const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    d.innerHTML = `<form id="q-form"><h1>${qt ? `Quote #${qt.number}` : 'New quote'}</h1>
      ${qt ? `<p class="muted">For <b>${h(qt.contact ? qt.contact.name : '')}</b></p>` : `<label class="field"><span>Who is it for?</span><input name="who" list="q-people" placeholder="Start typing a name" required autocomplete="off" value="${h((list.find((p) => p.id === contactId) || {}).name || '')}">
        <datalist id="q-people">${list.map((p) => `<option value="${h(p.name)}">${h(p.email || '')}</option>`).join('')}</datalist></label>`}
      <label class="field"><span>Title <small class="muted">(optional)</small></span><input name="title" placeholder="New website, Gold sponsorship..." value="${h(qt ? qt.title || '' : '')}"></label>
      <div class="inv-head"><span>What</span><span>Qty</span><span>Price</span><span></span></div>
      <div id="q-lines">${items.map(row).join('')}</div>
      <button type="button" class="btn ghost" data-add>+ Add a line</button>
      <div class="biz-two"><label class="field"><span>Tax % <small class="muted">(0 if none)</small></span><input name="tax_rate" type="number" min="0" max="50" step="any" value="${h(qt ? qt.tax_rate : 0)}"></label>
        <label class="field"><span>Good until</span><input name="valid_until" type="date" value="${h(qt ? qt.valid_until || '' : in30)}"></label></div>
      <label class="field"><span>Note for them <small class="muted">(optional)</small></span><textarea name="note" rows="2">${h(qt ? qt.note || '' : '')}</textarea></label>
      <label class="field"><span>Terms <small class="muted">(they agree to these when they sign)</small></span><textarea name="terms" rows="3">${h(qt ? qt.terms || '' : 'This quote is good until the date shown. Work starts once it is signed. The final invoice matches this quote unless we both agree to changes.')}</textarea></label>
      <label class="check"><input type="checkbox" name="auto_invoice" ${!qt || qt.auto_invoice ? 'checked' : ''}> When they sign, make the invoice and email it to them</label>
      <p class="inv-total">Total <b id="q-sum">$0.00</b></p>
      <div class="row"><button class="btn primary">${qt ? 'Save' : 'Save draft'}</button><button class="btn ghost" type="button" data-close>Cancel</button></div>
      <p class="muted" id="q-msg"></p></form>`;
    if (!d.open) d.showModal();
    const f = q$('#q-form', d);
    const sum = () => {
      const sub = [...f.querySelectorAll('.inv-line')].reduce((n, l) => n + Number(q$('[name=qty]', l).value || 0) * Number(String(q$('[name=price]', l).value).replace(/[$,\s]/g, '') || 0), 0);
      q$('#q-sum', d).textContent = money(sub * (1 + Number(f.tax_rate.value || 0) / 100));
    };
    sum();
    f.oninput = sum;
    if (window.VTExtra2) window.VTExtra2.productButton(d, '#q-lines', row, sum);
    f.onclick = (e) => {
      if (e.target.closest('[data-close]')) d.close();
      if (e.target.closest('[data-add]')) { q$('#q-lines', d).insertAdjacentHTML('beforeend', row({ what: '', qty: 1, price: '' })); q$('#q-lines .inv-line:last-child input', d).focus(); }
      const rm = e.target.closest('[data-rm]');
      if (rm && f.querySelectorAll('.inv-line').length > 1) { rm.parentElement.remove(); sum(); }
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = { items: [...f.querySelectorAll('.inv-line')].map((l) => ({ what: q$('[name=what]', l).value, qty: q$('[name=qty]', l).value, price: q$('[name=price]', l).value })),
        title: f.title.value, tax_rate: f.tax_rate.value, valid_until: f.valid_until.value, note: f.note.value, terms: f.terms.value, auto_invoice: f.auto_invoice.checked };
      if (!qt) {
        const p = pickPerson(list, f.who.value);
        if (!p) { q$('#q-msg', d).textContent = 'Pick someone from the list (add them on People first if they are new).'; return; }
        body.contact_id = p.id;
      }
      try { const saved = await call(qt ? `/quotes/${qt.id}` : '/quotes', { method: qt ? 'PUT' : 'POST', json: body }); openQuote(saved.id); refreshPay(); }
      catch (err) { q$('#q-msg', d).textContent = err.message; }
    };
  }

  async function openQuote(id) {
    const qt = await call(`/quotes/${id}`);
    const d = dlg();
    const open = ['draft', 'sent'].includes(qt.status);
    d.innerHTML = `<div class="inv-view"><header class="view-head"><h1>Quote #${qt.number} ${qpill(qt.label)}</h1><button class="btn ghost" data-close>Close</button></header>
      <p><b>${h(qt.contact ? qt.contact.name : '')}</b>${qt.contact && qt.contact.email ? ` · <span class="muted">${h(qt.contact.email)}</span>` : ''}${qt.title ? `<br>${h(qt.title)}` : ''}</p>
      <table class="table inv-items"><thead><tr><th>What</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead><tbody>
        ${qt.items.map((i) => `<tr><td>${h(i.what)}</td><td>${i.qty}</td><td>${money(i.price)}</td><td>${money(i.qty * i.price)}</td></tr>`).join('')}</tbody></table>
      <p class="inv-total">${qt.tax ? `<span class="muted small">Subtotal ${money(qt.subtotal)} + tax ${money(qt.tax)}</span><br>` : ''}Total <b>${money(qt.total)}</b></p>
      <p class="muted small">${qt.valid_until ? `Good until ${day(qt.valid_until)}` : 'No end date'}${qt.sent_at ? ` · Sent ${day(qt.sent_at)}` : ''}${qt.viewed_at ? ` · Opened ${day(qt.viewed_at)}` : ''}</p>
      ${qt.status === 'accepted' ? `<div class="q-signed"><div><b>Signed by ${h(qt.signed_name)}</b><div class="muted small">${new Date(qt.signed_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}${qt.signed_ip ? ` · from ${h(qt.signed_ip)}` : ''}</div></div>${qt.signature ? `<img src="${h(qt.signature)}" alt="Signature">` : ''}</div>` : ''}
      ${qt.status === 'declined' ? `<p class="note">They said no${qt.declined_reason ? `: "${h(qt.declined_reason)}"` : '.'}</p>` : ''}
      ${qt.status !== 'draft' ? `<div class="inv-link"><code>${h(qt.link)}</code><button class="btn ghost" data-copy>${svg('link')}<span>Copy link</span></button><a class="btn ghost" href="${h(qt.link)}" target="_blank" rel="noopener">${svg('eye')}<span>View</span></a></div>` : ''}
      <div class="inv-actions">
        ${open ? `<button class="btn primary" data-send ${qt.contact && qt.contact.email ? '' : 'disabled title="This person has no email address"'}>${svg('send')}<span>${qt.status === 'sent' ? 'Email it again' : 'Email it'}</span></button>` : ''}
        ${qt.status === 'draft' ? '<button class="btn" data-mark-sent>I\'ll send the link myself</button>' : ''}
        ${open ? '<button class="btn" data-edit>Edit</button>' : ''}
        ${qt.status === 'accepted' && !qt.invoice ? '<button class="btn primary" data-invoice>Make the invoice</button>' : ''}
        ${qt.invoice ? `<button class="btn" data-open-inv>Open invoice #${qt.invoice.number}</button>` : ''}
        ${['declined', 'void'].includes(qt.status) ? '<button class="btn ghost" data-reopen>Open it again</button>' : ''}
        ${qt.status === 'sent' ? '<button class="btn ghost danger" data-void>Cancel quote</button>' : ''}
        ${qt.status === 'draft' ? '<button class="btn ghost danger" data-del>Delete draft</button>' : ''}
      </div><p class="muted" id="q-msg"></p></div>`;
    if (!d.open) d.showModal();
    const msg = (t) => { q$('#q-msg', d).textContent = t; };
    const after = (t) => { say(t); openQuote(qt.id); refreshPay(); };
    d.onclick = async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      try {
        if (b.matches('[data-close]')) d.close();
        else if (b.matches('[data-copy]')) copy(qt.link);
        else if (b.matches('[data-edit]')) editQuote(qt);
        else if (b.matches('[data-send]')) { b.disabled = true; msg('Sending...'); await call(`/quotes/${qt.id}/send`, { method: 'POST', json: { by: 'email' } }); after(`Quote #${qt.number} emailed to ${qt.contact.name}.`); }
        else if (b.matches('[data-mark-sent]')) { await call(`/quotes/${qt.id}/send`, { method: 'POST', json: { by: 'link' } }); after('Ready. Copy the link and send it by text or email.'); }
        else if (b.matches('[data-invoice]')) { const r = await call(`/quotes/${qt.id}/invoice`, { method: 'POST', json: {} }); window.VTMore.openInvoice(r.invoice.id); refreshPay(); }
        else if (b.matches('[data-open-inv]')) window.VTMore.openInvoice(qt.invoice.id);
        else if (b.matches('[data-reopen]')) { await call(`/quotes/${qt.id}/status`, { method: 'POST', json: { status: 'sent' } }); after('The quote can be signed again.'); }
        else if (b.matches('[data-void]')) { if (confirm('Cancel this quote? The link will show it as cancelled.')) { await call(`/quotes/${qt.id}/status`, { method: 'POST', json: { status: 'void' } }); after('Quote cancelled.'); } }
        else if (b.matches('[data-del]')) { if (confirm('Delete this draft?')) { await call(`/quotes/${qt.id}`, { method: 'DELETE' }); d.close(); say('Draft deleted.'); refreshPay(); } }
      } catch (err) { msg(err.message); b.disabled = false; }
    };
  }

  // ======================= Appointment calendar (top of the Appointments tab) =======================
  let tz = 'America/New_York';
  const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const tzHM = (iso) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return +p.hour * 60 + +p.minute; };
  const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  const keyPlus = (key, n) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  let weekStart = null;
  async function renderCalendar(root, { openContact, onChange }) {
    if (!weekStart) { const k = dayKey(new Date()); const wd = new Date(`${k}T12:00:00Z`).getUTCDay(); weekStart = keyPlus(k, -((wd + 6) % 7)); }
    const days = Array.from({ length: 7 }, (_, i) => keyPlus(weekStart, i));
    const from = new Date(`${keyPlus(weekStart, -1)}T00:00:00Z`).toISOString(), to = new Date(`${keyPlus(weekStart, 8)}T00:00:00Z`).toISOString();
    const cal = await call(`/booking/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    tz = cal.timezone;
    const byDay = Object.fromEntries(days.map((k) => [k, []]));
    cal.appointments.forEach((a) => { const k = dayKey(new Date(a.starts_at)); if (byDay[k]) byDay[k].push(a); });
    const offDay = (k) => cal.timeOff.filter((t) => dayKey(new Date(t.starts_at)) <= k && dayKey(new Date(t.ends_at)) >= k);
    // Hours shown: 8am to 6pm, stretched to fit anything earlier or later.
    let lo = 8 * 60, hi = 18 * 60;
    cal.appointments.forEach((a) => { if (byDay[dayKey(new Date(a.starts_at))]) { lo = Math.min(lo, Math.floor(tzHM(a.starts_at) / 60) * 60); hi = Math.max(hi, Math.ceil((tzHM(a.starts_at) + (Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60e3) / 60) * 60); } });
    hi = Math.min(hi, 24 * 60);
    const PX = 60; // pixels per hour
    const today = dayKey(new Date());
    const label = (k, o) => new Date(`${k}T12:00:00Z`).toLocaleDateString([], { timeZone: 'UTC', ...o });
    const block = (a) => {
      const top = (tzHM(a.starts_at) - lo) / 60 * PX, len = Math.max(40, (Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 36e5 * PX - 2);
      return `<button class="cal-appt" data-appt="${a.id}" style="top:${top}px;height:${len}px;--c:${colorFor(a.group_name)}" title="${h(`${timeOf(a.starts_at)} ${a.contact_name || ''}: ${a.title}`)}"><b>${h(timeOf(a.starts_at))}</b> ${h(a.contact_name || 'Someone')}<span>${h(a.title)}</span></button>`;
    };
    root.innerHTML = `<div class="cal-bar"><div class="row"><button class="btn ghost" data-wk="-7" aria-label="Last week">‹</button><button class="btn ghost" data-wk="0">This week</button><button class="btn ghost" data-wk="7" aria-label="Next week">›</button>
        <b class="cal-title">${h(label(days[0], { month: 'short', day: 'numeric' }))} – ${h(label(days[6], { month: 'short', day: 'numeric', year: 'numeric' }))}</b></div>
        <div class="row"><button class="btn primary" data-add-appt>${svg('plus')}<span>Add appointment</span></button><button class="btn ghost" data-time-off>${svg('off')}<span>Time off</span></button></div></div>
      <div class="cal-week" style="--rows:${(hi - lo) / 60}">
        <div class="cal-hours"><div class="cal-dh"></div>${Array.from({ length: (hi - lo) / 60 }, (_, i) => `<div class="cal-h">${new Date(2000, 0, 1, lo / 60 + i).toLocaleTimeString([], { hour: 'numeric' })}</div>`).join('')}</div>
        ${days.map((k) => `<div class="cal-day${k === today ? ' today' : ''}"><div class="cal-dh"><span>${h(label(k, { weekday: 'short' }))}</span><b>${h(label(k, { day: 'numeric' }))}</b></div>
          <div class="cal-col" style="height:${(hi - lo) / 60 * PX}px">${offDay(k).map((t) => { const s = dayKey(new Date(t.starts_at)) < k ? lo : Math.max(lo, tzHM(t.starts_at)); const e = dayKey(new Date(t.ends_at)) > k ? hi : Math.min(hi, tzHM(t.ends_at)); return e > s ? `<div class="cal-off" style="top:${(s - lo) / 60 * PX}px;height:${(e - s) / 60 * PX}px" title="${h(t.note || 'Time off')}"><span>${h(t.note || 'Time off')}</span></div>` : ''; }).join('')}
          ${byDay[k].map(block).join('')}</div></div>`).join('')}
      </div>
      <div class="cal-agenda">${days.map((k) => `<div class="cal-aday${k === today ? ' today' : ''}"><h4>${h(label(k, { weekday: 'long', month: 'short', day: 'numeric' }))}</h4>
        ${offDay(k).map((t) => `<div class="cal-aoff">${svg('off')} ${h(t.note || 'Time off')}</div>`).join('')}
        ${byDay[k].map((a) => `<button class="cal-arow" data-appt="${a.id}" style="--c:${colorFor(a.group_name)}"><b>${h(timeOf(a.starts_at))}</b><span>${h(a.contact_name || 'Someone')}<small>${h(a.title)}</small></span></button>`).join('') || (offDay(k).length ? '' : '<p class="muted small">Nothing booked</p>')}</div>`).join('')}</div>`;
    root.onclick = (e) => {
      const wk = e.target.closest('[data-wk]');
      if (wk) { const n = Number(wk.dataset.wk); if (!n) weekStart = null; else weekStart = keyPlus(weekStart, n); return renderCalendar(root, { openContact, onChange }); }
      if (e.target.closest('[data-add-appt]')) return addAppointment({ onChange });
      if (e.target.closest('[data-time-off]')) return timeOff({ onChange });
      const ap = e.target.closest('[data-appt]');
      if (ap) showAppointment(cal.appointments.find((a) => a.id === Number(ap.dataset.appt)), { openContact, onChange });
    };
  }
  const PALETTE = ['#4f46e5', '#db2777', '#0891b2', '#d97706', '#16a34a', '#9333ea', '#dc2626', '#0d9488', '#2563eb', '#c2410c'];
  const colorFor = (str) => { let n = 0; for (const ch of String(str || '')) n = (n * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[n % PALETTE.length]; };

  function showAppointment(a, { openContact, onChange }) {
    const d = dlg();
    const k = dayKey(new Date(a.starts_at)), m = tzHM(a.starts_at);
    const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    d.innerHTML = `<form id="ap-form"><header class="view-head"><h1>${h(a.title)}</h1><button class="btn ghost" type="button" data-close>Close</button></header>
      <p><b>${h(new Date(a.starts_at).toLocaleString([], { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</b> to ${h(timeOf(a.ends_at))}</p>
      <p>${a.contact_id ? `<a href="#" data-person>${h(a.contact_name)}</a>` : 'Removed person'}${a.phone ? ` · <a href="tel:${h(a.phone)}">${h(a.phone)}</a>` : ''}${a.email ? ` · ${h(a.email)}` : ''}</p>
      ${a.location ? `<p class="muted">📍 ${h(a.location)}</p>` : ''}${a.note ? `<p class="note">"${h(a.note)}"</p>` : ''}
      <h2 class="small-h">Move it</h2>
      <div class="row"><label class="field"><span>Date</span><input type="date" name="date" value="${k}" required></label><label class="field"><span>Time</span><input type="time" name="time" value="${hhmm}" step="300" required></label></div>
      ${a.email ? '<label class="check"><input type="checkbox" name="email_them" checked> Email them the new time</label>' : ''}
      <div class="row" style="margin-top:12px"><button class="btn primary">Move</button><button class="btn ghost danger" type="button" data-cancel>Cancel appointment</button></div><p class="muted" id="ap-msg"></p></form>`;
    if (!d.open) d.showModal();
    const f = q$('#ap-form', d);
    f.onclick = async (e) => {
      if (e.target.closest('[data-close]')) d.close();
      if (e.target.closest('[data-person]')) { e.preventDefault(); d.close(); openContact(a.contact_id); }
      if (e.target.closest('[data-cancel]') && confirm('Cancel this appointment? The time opens up again. Remember to let them know.')) {
        await call(`/booking/appointments/${a.id}/cancel`, { method: 'POST' }); d.close(); say('Appointment cancelled.'); onChange();
      }
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      try { await call(`/booking/appointments/${a.id}`, { method: 'PUT', json: { date: f.date.value, time: f.time.value, email_them: f.email_them ? f.email_them.checked : false } }); d.close(); say('Appointment moved.'); onChange(); }
      catch (err) { q$('#ap-msg', d).textContent = err.message; }
    };
  }

  async function addAppointment({ onChange, contactId } = {}) {
    const [list, { pages }] = await Promise.all([people(), call('/booking/pages')]);
    const d = dlg();
    d.innerHTML = `<form id="aa-form"><h1>Add an appointment</h1>
      <label class="field"><span>With</span><input name="who" list="aa-people" required autocomplete="off" placeholder="Start typing a name" value="${h((list.find((p) => p.id === contactId) || {}).name || '')}"><datalist id="aa-people">${list.map((p) => `<option value="${h(p.name)}">${h(p.email || '')}</option>`).join('')}</datalist></label>
      <label class="field"><span>What</span><input name="title" placeholder="Call, visit, test drive..." value="${h(pages[0] ? pages[0].title : 'Appointment')}" required></label>
      <div class="row"><label class="field"><span>Date</span><input type="date" name="date" required value="${dayKey(new Date())}"></label><label class="field"><span>Time</span><input type="time" name="time" required step="300" value="10:00"></label>
        <label class="field"><span>Minutes</span><input type="number" name="minutes" min="5" max="720" step="5" value="${pages[0] ? pages[0].minutes : 30}" style="width:100px"></label></div>
      <label class="field"><span>Where <small class="muted">(optional)</small></span><input name="location" value="${h(pages[0] ? pages[0].location || '' : '')}"></label>
      <label class="field"><span>Note <small class="muted">(optional)</small></span><textarea name="note" rows="2"></textarea></label>
      <label class="check"><input type="checkbox" name="email_them" checked> Email them a confirmation (if they have an email)</label>
      <div class="row" style="margin-top:12px"><button class="btn primary">Add</button><button class="btn ghost" type="button" data-close>Cancel</button></div><p class="muted" id="aa-msg"></p></form>`;
    if (!d.open) d.showModal();
    const f = q$('#aa-form', d);
    q$('[data-close]', d).onclick = () => d.close();
    f.onsubmit = async (e, force) => {
      if (e) e.preventDefault();
      const p = pickPerson(list, f.who.value);
      if (!p) { q$('#aa-msg', d).textContent = 'Pick someone from the list (add them on People first if they are new).'; return; }
      const body = { contact_id: p.id, title: f.title.value, date: f.date.value, time: f.time.value, minutes: f.minutes.value, location: f.location.value, note: f.note.value, email_them: f.email_them.checked && Boolean(p.email), force };
      try { await call('/booking/appointments', { method: 'POST', json: body }); d.close(); say('Appointment added.'); if (onChange) onChange(); }
      catch (err) {
        if (err.data && err.data.clash && confirm(`${err.message}\nAdd it anyway?`)) return f.onsubmit(null, true);
        q$('#aa-msg', d).textContent = err.message;
      }
    };
  }

  async function timeOff({ onChange }) {
    const list = await call('/booking/time-off');
    const d = dlg();
    const when = (t) => `${new Date(t.starts_at).toLocaleString([], { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} – ${new Date(t.ends_at).toLocaleString([], { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
    d.innerHTML = `<form id="to-form"><header class="view-head"><h1>Time off</h1><button class="btn ghost" type="button" data-close>Close</button></header>
      <p class="muted">Nobody can book you during time off, on any booking page. Good for vacations, holidays and busy afternoons.</p>
      <ul class="rev-list">${list.map((t) => `<li><span><b>${h(t.note || 'Time off')}</b><span class="muted small">${h(when(t))}</span></span><button class="btn ghost" type="button" data-del="${t.id}">Remove</button></li>`).join('') || '<li class="muted">No time off coming up.</li>'}</ul>
      <h2 class="small-h">Add time off</h2>
      <label class="field"><span>What for <small class="muted">(only you see this)</small></span><input name="note" placeholder="Vacation, Thanksgiving..."></label>
      <label class="check"><input type="checkbox" name="all_day" checked> Whole days</label>
      <div class="row"><label class="field"><span>From</span><input type="date" name="from_date" required value="${dayKey(new Date())}"></label><label class="field to-time" hidden><span>at</span><input type="time" name="from_time" value="12:00"></label>
        <label class="field"><span>To</span><input type="date" name="to_date" required value="${dayKey(new Date())}"></label><label class="field to-time" hidden><span>at</span><input type="time" name="to_time" value="17:00"></label></div>
      <div class="row"><button class="btn primary">Add time off</button></div><p class="muted" id="to-msg"></p></form>`;
    if (!d.open) d.showModal();
    const f = q$('#to-form', d);
    f.all_day.onchange = () => f.querySelectorAll('.to-time').forEach((x) => { x.hidden = f.all_day.checked; });
    f.onclick = async (e) => {
      if (e.target.closest('[data-close]')) d.close();
      const del = e.target.closest('[data-del]');
      if (del) { await call(`/booking/time-off/${del.dataset.del}`, { method: 'DELETE' }); timeOff({ onChange }); onChange(); }
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      try { await call('/booking/time-off', { method: 'POST', json: Object.fromEntries([...new FormData(f)].concat([['all_day', f.all_day.checked ? '1' : '']])) }); say('Time off added.'); timeOff({ onChange }); onChange(); }
      catch (err) { q$('#to-msg', d).textContent = err.message; }
    };
  }

  // ======================= Sites (simple website pages) =======================
  const FIELD = {
    heading: ['Heading', 'text'], text: ['Text', 'area'], button_text: ['Button words', 'text', 'Book a time'], button_link: ['Button goes to', 'link'], image: ['Picture', 'image'],
    booking: ['Booking page', 'booking'], form: ['Form', 'form'], show_map: ['Show a map of the address', 'check'], product: ['Product to sell', 'product'], count: ['How many posts to show', 'count'],
    title: ['Name', 'text'], price: ['Price', 'text', '$49 or Free'], caption: ['Caption', 'text'], quote: ['What they said', 'area'], name: ['Who said it', 'text'], q: ['Question', 'text'], a: ['Answer', 'area'],
  };
  const LISTS = { services: ['title', 'text', 'price'], gallery: ['image', 'caption'], reviews: ['quote', 'name'], faq: ['q', 'a'] };
  const FIELDS = { hero: ['heading', 'text', 'button_text', 'button_link', 'image'], text: ['heading', 'text', 'image'], services: ['heading', 'text'], gallery: ['heading'], reviews: ['heading'],
    booking: ['heading', 'text', 'booking'], form: ['heading', 'text', 'form'], faq: ['heading'], cta: ['heading', 'text', 'button_text', 'button_link'], contact: ['heading', 'text', 'show_map'], buy: ['heading', 'text', 'product', 'button_text'], blog: ['heading', 'text', 'count'] };
  const ITEM_NAME = { services: 'service', gallery: 'photo', reviews: 'review', faq: 'question' };
  let siteData = null, editing = null, previewTimer = null, dirty = false;

  async function renderSites() {
    const root = q$('#site-root');
    if (editing) return siteEditor(root, editing);
    siteData = await call('/sites');
    root.innerHTML = `<div class="row crm-filters"><button class="btn primary" data-new-site>+ New page</button></div>
      ${siteData.sites.length ? `<div class="site-cards">${siteData.sites.map((s) => `<div class="site-card" data-site="${s.id}">
        <div class="site-thumb"><iframe tabindex="-1" loading="lazy" title="" src="about:blank" data-thumb="${s.id}"></iframe></div>
        <div class="site-info"><b>${h(s.title)}</b> ${s.published ? '<span class="pay-pill" style="--c:#16a34a">Live</span>' : '<span class="pay-pill" style="--c:#6b7280">Draft</span>'}
          <div class="muted small">${s.blocks} blocks · ${s.views} visit${s.views === 1 ? '' : 's'}</div>
          ${s.published ? `<div class="linkbox"><input readonly value="${h(s.link)}"><button class="btn" data-copy>Copy link</button></div>` : ''}
          <div class="row"><button class="btn primary" data-edit>Edit</button>${s.published ? `<a class="btn ghost" href="${h(s.link)}" target="_blank" rel="noopener">Open</a>` : ''}<button class="btn ghost danger" data-del>Delete</button></div></div></div>`).join('')}</div>`
      : `<div class="db-empty center pay-empty">${svg('globe')}<b>No pages yet</b><span>Make a simple one-page website for a business or an event. Pick a design, fill in the words, press <b>Publish</b>. Forms and booking go right on it.</span><button class="btn primary" data-new-site>Make my first page</button></div>`}`;
    // Little live previews of each page.
    root.querySelectorAll('[data-thumb]').forEach(async (fr) => {
      try { const r = await call(`/sites/${fr.dataset.thumb}/preview`, { method: 'POST', json: { base: basePath() }, raw: true }); fr.srcdoc = await r.text(); } catch { /* fine */ }
    });
    root.onclick = async (e) => {
      if (e.target.closest('[data-new-site]')) return newSite();
      const card = e.target.closest('[data-site]');
      if (!card) return;
      const s = siteData.sites.find((x) => x.id === Number(card.dataset.site));
      if (e.target.closest('[data-copy]')) return copy(s.link);
      if (e.target.closest('[data-del]')) { if (confirm(`Delete "${s.title}"? Its link stops working.`)) { await call(`/sites/${s.id}`, { method: 'DELETE' }); say('Page deleted.'); renderSites(); } return; }
      if (e.target.closest('[data-edit]') || e.target.closest('.site-thumb')) { editing = s.id; renderSites(); }
    };
  }
  const basePath = () => location.pathname.replace(/[^/]*$/, '');

  function newSite() {
    const d = dlg(true);
    const t = siteData.templates;
    d.innerHTML = `<div><header class="view-head"><h1>Pick a starting design</h1><button class="btn ghost" data-close>Cancel</button></header>
      <p class="muted">You can change every word and picture after. Nothing goes live until you press Publish.</p>
      <div class="site-tpls">${Object.entries(t).map(([k, v]) => `<button class="site-tpl" data-tpl="${k}"><b>${h(v.name)}</b><span class="muted small">${h(v.about)}</span></button>`).join('')}</div></div>`;
    if (!d.open) d.showModal();
    d.onclick = async (e) => {
      if (e.target.closest('[data-close]')) return d.close();
      const b = e.target.closest('[data-tpl]');
      if (!b) return;
      const s = await call('/sites', { method: 'POST', json: { template: b.dataset.tpl } });
      d.close(); d.onclick = null; editing = s.id; renderSites();
    };
  }

  async function siteEditor(root, id) {
    const s = await call(`/sites/${id}`);
    if (!siteData) siteData = await call('/sites');
    dirty = false;
    const sections = s.sections;
    const businesses = (window.VTHome && window.VTHome.list && window.VTHome.list()) || [];
    const fieldHtml = (k, v, path) => {
      const [label, kind, ph] = FIELD[k];
      const at = `data-path="${path}" data-k="${k}"`;
      if (kind === 'area') return `<label class="field"><span>${label}</span><textarea rows="${k === 'text' ? 3 : 2}" ${at}>${h(v)}</textarea></label>`;
      if (kind === 'check') return `<label class="check"><input type="checkbox" ${at} ${v ? 'checked' : ''}> ${label}</label>`;
      if (kind === 'booking') return `<label class="field"><span>${label}</span><select ${at}><option value="">The first booking page</option>${siteData.pages.map((p) => `<option value="${p.id}"${String(p.id) === String(v) ? ' selected' : ''}>${h(p.title)}${p.active ? '' : ' (off)'}</option>`).join('')}</select></label>`;
      if (kind === 'form') return `<label class="field"><span>${label}</span><select ${at}><option value="">Pick a form</option>${siteData.forms.map((f) => `<option value="${h(f.slug)}"${f.slug === v ? ' selected' : ''}>${h(f.title)}${f.active ? '' : ' (off)'}</option>`).join('')}</select></label>`;
      if (kind === 'product') return `<label class="field"><span>${label}</span><select ${at}><option value="">Pick a product</option>${(siteData.products || []).map((p) => `<option value="${p.id}"${String(p.id) === String(v) ? ' selected' : ''}>${h(p.name)} · ${money(p.price)}${p.active ? '' : ' (hidden)'}</option>`).join('')}</select>${(siteData.products || []).length ? '' : '<small class="muted">Add products in Payments, Products first.</small>'}</label>`;
      if (kind === 'count') return `<label class="field"><span>${label}</span><select ${at}>${[3, 6, 9].map((n) => `<option value="${n}"${String(n) === String(v || 3) ? ' selected' : ''}>${n}</option>`).join('')}</select><small class="muted">Write posts in Sites, then Blog.</small></label>`;
      if (kind === 'link') return `<label class="field"><span>${label}</span><input list="site-links" ${at} value="${h(v)}" placeholder="#book, #signup, #contact or a web address"></label>`;
      if (kind === 'image') return `<div class="field"><span>${label} <small class="muted">(optional)</small></span><div class="site-img">${v ? `<img src="${h(/^media\//.test(v) ? `${basePath()}s/${v}` : v)}" alt="">` : `<span class="site-noimg">${svg('image')}</span>`}
        <input ${at} value="${h(v)}" placeholder="Paste a picture link, or upload"><label class="btn ghost">Upload<input type="file" accept="image/*" hidden data-upload="${path}" data-uk="${k}"></label>${v ? `<button type="button" class="btn ghost" data-clear-img="${path}" data-uk="${k}">Remove</button>` : ''}</div></div>`;
      return `<label class="field"><span>${label}</span><input ${at} value="${h(v)}"${ph ? ` placeholder="${h(ph)}"` : ''}></label>`;
    };
    const blockHtml = (b, i) => `<details class="site-blk" data-i="${i}"${b._open ? ' open' : ''}><summary><span class="site-blk-name">${h(siteData.blocks[b.type])}</span><span class="muted small site-blk-sum">${h(b.heading || '')}</span>
        <span class="site-blk-tools"><button type="button" class="icon-btn" data-mv="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${svg('up')}</button><button type="button" class="icon-btn" data-mv="1" aria-label="Move down" ${i === sections.length - 1 ? 'disabled' : ''}>${svg('down')}</button><button type="button" class="icon-btn" data-rm-blk aria-label="Remove block">${svg('trash')}</button></span></summary>
      <div class="site-blk-body">${FIELDS[b.type].map((k) => fieldHtml(k, b[k], `${i}`)).join('')}
        ${LISTS[b.type] ? `<div class="site-items">${(b.items || []).map((it, j) => `<div class="site-item"><div class="site-item-head"><b>${ITEM_NAME[b.type][0].toUpperCase() + ITEM_NAME[b.type].slice(1)} ${j + 1}</b><button type="button" class="icon-btn" data-rm-item="${i}.${j}" aria-label="Remove">${svg('trash')}</button></div>${LISTS[b.type].map((k) => fieldHtml(k, it[k], `${i}.${j}`)).join('')}</div>`).join('')}
          <button type="button" class="btn ghost" data-add-item="${i}">+ Add a ${ITEM_NAME[b.type]}</button></div>` : ''}</div></details>`;
    root.innerHTML = `<div class="site-ed">
      <div class="site-ed-bar"><button class="btn ghost" data-back>‹ All pages</button><b class="site-ed-title">${h(s.title)}</b>
        <div class="row"><div class="seg" role="group" aria-label="Preview size"><button type="button" data-view="desk" class="on">Computer</button><button type="button" data-view="phone">Phone</button></div>
        <label class="check site-pub"><input type="checkbox" id="site-pub" ${s.published ? 'checked' : ''}> Live</label><button class="btn primary" data-save>Save</button></div></div>
      ${s.published ? `<div class="inv-link"><code>${h(s.link)}</code><button class="btn ghost" data-copy>${svg('link')}<span>Copy link</span></button><a class="btn ghost" href="${h(s.link)}" target="_blank" rel="noopener">${svg('eye')}<span>Open</span></a></div>` : '<p class="muted small">This page is a draft. Tick <b>Live</b> and press <b>Save</b> to put it online.</p>'}
      <div class="site-ed-cols"><div class="site-ed-left">
        <details class="site-blk" open><summary><span class="site-blk-name">Page settings</span></summary><div class="site-blk-body">
          <label class="field"><span>Page title <small class="muted">(shows in Google and the browser tab)</small></span><input id="site-title" value="${h(s.title)}" maxlength="120"></label>
          <label class="field"><span>Short description <small class="muted">(for Google and link previews)</small></span><textarea id="site-desc" rows="2" maxlength="300">${h(s.description || '')}</textarea></label>
          <label class="field"><span>Web address</span><div class="site-slug"><span class="muted small">${h(s.link.replace(/[^/]+$/, ''))}</span><input id="site-slug" value="${h(s.slug)}"></div></label>
          <div class="biz-two"><label class="field"><span>Letters</span><select id="site-font">${[['modern', 'Modern'], ['classic', 'Classic'], ['friendly', 'Friendly']].map(([v, l]) => `<option value="${v}"${s.font === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="field"><span>Background</span><select id="site-look"><option value="light"${s.look === 'light' ? ' selected' : ''}>Light</option><option value="dark"${s.look === 'dark' ? ' selected' : ''}>Dark</option></select></label></div>
          <div class="biz-two">${businesses.length > 1 ? `<label class="field"><span>Business <small class="muted">(name, color, phone)</small></span><select id="site-biz">${businesses.map((b) => `<option value="${b.id}"${b.id === s.business_id ? ' selected' : ''}>${h(b.name)}</option>`).join('')}</select></label>` : ''}
            <div class="field"><span>Color</span><div class="row site-color"><input type="color" id="site-color" aria-label="Color" value="${h(s.color || (businesses.find((b) => b.id === s.business_id) || {}).color || '#4f46e5')}"><label class="check"><input type="checkbox" id="site-own-color" ${s.color ? 'checked' : ''}> Use this color instead of the business color</label></div></div></div>
          <label class="check"><input type="checkbox" id="site-chat" ${s.chat ? 'checked' : ''}> Chat bubble on this page <small class="muted">(chats land in Conversations)</small></label>
        </div></details>
        <div id="site-blocks">${sections.map(blockHtml).join('')}</div>
        <div class="row site-add"><select id="site-new-type" aria-label="Block to add">${Object.entries(siteData.blocks).map(([k, v]) => `<option value="${k}">${h(v)}</option>`).join('')}</select><button class="btn" data-add-blk>+ Add block</button></div>
        <datalist id="site-links"><option value="#book">The booking block</option><option value="#signup">The form block</option><option value="#contact">Contact details</option><option value="#buy">The Buy button block</option><option value="#next">The next page of the funnel</option></datalist>
      </div>
      <div class="site-ed-right"><div class="site-frame desk"><iframe id="site-prev" title="Preview of your page"></iframe></div></div></div>
      <p class="muted" id="site-msg"></p></div>`;
    const prev = q$('#site-prev', root);
    const state = () => ({ title: q$('#site-title', root).value, description: q$('#site-desc', root).value, slug: q$('#site-slug', root).value, font: q$('#site-font', root).value, look: q$('#site-look', root).value,
      color: q$('#site-own-color', root).checked ? q$('#site-color', root).value : '', ...(q$('#site-biz', root) ? { business_id: Number(q$('#site-biz', root).value) } : {}),
      sections: sections.map(({ _open, ...b }) => b), published: q$('#site-pub', root).checked, chat: q$('#site-chat', root).checked });
    const preview = () => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(async () => {
        try {
          const r = await call(`/sites/${id}/preview`, { method: 'POST', json: { ...state(), base: basePath() }, raw: true });
          const y = prev.contentWindow ? prev.contentWindow.scrollY : 0;
          prev.srcdoc = await r.text();
          prev.onload = () => { try { prev.contentWindow.scrollTo(0, y); } catch { /* fine */ } };
        } catch { /* keep the last preview */ }
      }, 350);
    };
    const redraw = () => { q$('#site-blocks', root).innerHTML = sections.map(blockHtml).join(''); preview(); };
    preview();
    const setVal = (path, k, v) => { const [i, j] = path.split('.').map(Number); if (Number.isInteger(j)) sections[i].items[j][k] = v; else sections[i][k] = v; dirty = true; };
    root.oninput = (e) => {
      const el = e.target;
      if (el.dataset.path) setVal(el.dataset.path, el.dataset.k, el.type === 'checkbox' ? (el.checked ? '1' : '') : el.value);
      if (el.dataset.path && el.dataset.k === 'heading') { const sm = el.closest('.site-blk') && q$('.site-blk-sum', el.closest('.site-blk')); if (sm) sm.textContent = el.value; }
      dirty = true; preview();
    };
    root.onchange = async (e) => {
      const up = e.target.dataset.upload != null ? e.target : null;
      if (!up || !up.files[0]) return;
      const file = up.files[0];
      q$('#site-msg', root).textContent = 'Uploading...';
      try {
        const r = await call('/sites/upload', { method: 'POST', body: file, headers: { 'Content-Type': file.type } });
        setVal(up.dataset.upload, up.dataset.uk, r.url); keepOpen(); redraw(); q$('#site-msg', root).textContent = '';
      } catch (err) { q$('#site-msg', root).textContent = err.message; }
    };
    const keepOpen = () => root.querySelectorAll('#site-blocks .site-blk').forEach((el) => { sections[Number(el.dataset.i)]._open = el.open; });
    const save = async () => {
      q$('#site-msg', root).textContent = 'Saving...';
      try { const r = await call(`/sites/${id}`, { method: 'PUT', json: state() }); dirty = false; say(r.published ? 'Saved. Your page is live.' : 'Saved as a draft.'); keepOpen(); siteEditor(root, id); }
      catch (err) { q$('#site-msg', root).textContent = err.message; }
    };
    root.onclick = async (e) => {
      const t = e.target;
      if (t.closest('[data-back]')) { if (dirty && !confirm('Leave without saving your changes?')) return; editing = null; return window.VTExtra3 ? window.VTExtra3.renderSitesTab() : renderSites(); }
      if (t.closest('[data-save]')) return save();
      if (t.closest('[data-copy]')) return copy(s.link);
      const v = t.closest('[data-view]');
      if (v) { root.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b === v)); q$('.site-frame', root).className = `site-frame ${v.dataset.view}`; return; }
      if (t.closest('[data-add-blk]')) { keepOpen(); const type = q$('#site-new-type', root).value; const b = { type, _open: true, ...Object.fromEntries(FIELDS[type].map((k) => [k, ''])) }; if (LISTS[type]) b.items = [Object.fromEntries(LISTS[type].map((k) => [k, '']))]; b.heading = siteData.blocks[type]; sections.push(b); dirty = true; redraw(); return; }
      const blk = t.closest('.site-blk[data-i]');
      const i = blk ? Number(blk.dataset.i) : -1;
      const mv = t.closest('[data-mv]');
      if (mv) { e.preventDefault(); keepOpen(); const j = i + Number(mv.dataset.mv); [sections[i], sections[j]] = [sections[j], sections[i]]; dirty = true; return redraw(); }
      if (t.closest('[data-rm-blk]')) { e.preventDefault(); if (confirm(`Remove the "${siteData.blocks[sections[i].type]}" block?`)) { keepOpen(); sections.splice(i, 1); dirty = true; redraw(); } return; }
      const ai = t.closest('[data-add-item]');
      if (ai) { keepOpen(); const b = sections[Number(ai.dataset.addItem)]; b.items.push(Object.fromEntries(LISTS[b.type].map((k) => [k, '']))); dirty = true; return redraw(); }
      const ri = t.closest('[data-rm-item]');
      if (ri) { keepOpen(); const [a, b] = ri.dataset.rmItem.split('.').map(Number); sections[a].items.splice(b, 1); dirty = true; return redraw(); }
      const ci = t.closest('[data-clear-img]');
      if (ci) { keepOpen(); setVal(ci.dataset.clearImg, ci.dataset.uk, ''); return redraw(); }
    };
  }

  // ======================= Reports =======================
  let repMonth = null;
  async function renderReports() {
    const root = q$('#rep-root');
    const r = await call(`/reports${repMonth ? `?month=${repMonth}` : ''}`);
    repMonth = r.month;
    const n = r.numbers, p = r.before;
    const months = [];
    { const d = new Date(); let y = d.getFullYear(), m = d.getMonth() + 1; for (let i = 0; i < 13; i++) { months.push(`${y}-${String(m).padStart(2, '0')}`); m--; if (!m) { m = 12; y--; } } }
    if (!months.includes(r.month)) months.push(r.month);
    const change = (a, b, isMoney) => {
      if (a === b || (!a && !b)) return '<span class="rep-ch same">Same as last month</span>';
      const up = a > b;
      return `<span class="rep-ch ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${isMoney ? money(Math.abs(a - b), true) : Math.abs(a - b)} vs last month</span>`;
    };
    const card = (label, value, ico, c, ch, sub) => `<div class="tile rep-tile"><div class="tile-ico" style="--c:${c}">${svg(ico)}</div><div><div class="label">${label}</div><div class="value">${value}</div>${ch || ''}${sub ? `<div class="muted small">${sub}</div>` : ''}</div></div>`;
    const biz = r.business;
    const accent = (biz && biz.color) || '#4f46e5';
    root.innerHTML = `<div class="row crm-filters rep-bar"><select id="rep-month" aria-label="Month">${months.map((m) => `<option value="${m}"${m === r.month ? ' selected' : ''}>${new Date(`${m}-15T12:00:00Z`).toLocaleDateString([], { month: 'long', year: 'numeric', timeZone: 'UTC' })}</option>`).join('')}</select>
        <button class="btn ghost" data-print>${svg('print')}<span>Print or save as PDF</span></button></div>
      <div class="rep-sheet"><div class="rep-head" style="--c:${accent}"><div><h2>${h(biz ? biz.name : 'All businesses')}</h2><p class="muted">${h(r.label)}${r.isCurrent ? ' so far' : ''}</p></div></div>
      <div class="tiles rep-tiles">
        ${card('New people', n.people, 'people', '#4f46e5', change(n.people, p.people))}
        ${card('Deals won', n.won, 'trophy', '#16a34a', change(n.won, p.won), n.wonValue ? `Worth ${money(n.wonValue, true)}` : '')}
        ${card('Money paid', money(n.paid, true), 'money', '#0d9488', change(n.paid, p.paid, true), `${n.paidCount} invoice${n.paidCount === 1 ? '' : 's'}`)}
        ${card('Waiting to be paid', money(r.unpaidNow, true), 'clock', '#2563eb', '', 'Right now')}
        ${card('Quotes signed', n.quotesSigned, 'pen', '#9333ea', change(n.quotesSigned, p.quotesSigned), n.quotesValue ? `Worth ${money(n.quotesValue, true)}` : '')}
        ${card('Appointments', n.appointments, 'cal', '#d97706', change(n.appointments, p.appointments))}
        ${card('Form sign-ups', n.forms, 'form', '#db2777', change(n.forms, p.forms))}
        ${card('Review requests', n.reviewsAsked, 'star', '#ca8a04', '', `${n.reviewsOpened} opened the link`)}
        ${card('Emails sent', n.emails, 'mail', '#64748b', change(n.emails, p.emails))}
      </div>
      <div class="rep-charts">${barChart('New people, last 6 months', r.series.map((s) => ({ label: s.label, v: s.people, text: String(s.people) })), accent)}
        ${barChart('Money paid, last 6 months', r.series.map((s) => ({ label: s.label, v: s.paid, text: money(s.paid, true) })), accent)}</div></div>
      <section class="db-card rep-send"><header><h3>Send this report</h3></header>
        <div class="row"><input type="email" id="rep-to" placeholder="name@example.com" value="${h((biz && biz.report_email) || '')}" aria-label="Email address"><button class="btn primary" data-send>${svg('send')}<span>Email it now</span></button></div>
        ${biz ? `<label class="check"><input type="checkbox" id="rep-auto" ${biz.report_email ? 'checked' : ''}> Email last month's report to this address on the 1st of every month</label>` : '<p class="muted small">Pick one business at the top of the menu to send its report every month by itself.</p>'}
        <p class="muted small" id="rep-msg"></p></section>`;
    q$('#rep-month', root).onchange = (e) => { repMonth = e.target.value; renderReports(); };
    const tip = q$('#rep-tip') || Object.assign(document.body.appendChild(document.createElement('div')), { id: 'rep-tip', className: 'rep-tip', hidden: true });
    root.onmouseover = (e) => { const b = e.target.closest('[data-tip]'); if (!b) { tip.hidden = true; return; } tip.textContent = b.dataset.tip; tip.hidden = false; const r2 = b.getBoundingClientRect(); tip.style.left = `${r2.left + r2.width / 2}px`; tip.style.top = `${r2.top + window.scrollY - 8}px`; };
    root.onmouseleave = () => { tip.hidden = true; };
    root.onclick = async (e) => {
      if (e.target.closest('[data-print]')) return window.print();
      const msg = (t) => { q$('#rep-msg', root).textContent = t; };
      if (e.target.closest('[data-send]')) {
        msg('Sending...');
        try { const out = await call('/reports/email', { method: 'POST', json: { month: r.month, to: q$('#rep-to', root).value } }); msg(`Sent to ${out.to}.`); } catch (err) { msg(err.message); }
      }
    };
    const auto = q$('#rep-auto', root);
    if (auto) auto.onchange = async () => {
      try { await call('/reports/settings', { method: 'PUT', json: { report_email: auto.checked ? q$('#rep-to', root).value : '' } }); say(auto.checked ? 'Done. The report goes out on the 1st of every month.' : 'Monthly report turned off.'); }
      catch (err) { auto.checked = !auto.checked; q$('#rep-msg', root).textContent = err.message; }
    };
  }
  // A small bar chart: one measure, one color, value on the newest bar, hover for the rest.
  function barChart(title, pts, color) {
    const W = 360, H = 170, padL = 8, padB = 24, padT = 22, bw = 30;
    const max = Math.max(1, ...pts.map((p) => p.v));
    const step = (W - padL * 2) / pts.length;
    const bars = pts.map((p, i) => {
      const bh = Math.round((p.v / max) * (H - padB - padT));
      const x = padL + i * step + (step - bw) / 2, y = H - padB - bh;
      const r = Math.min(4, bh);
      const path = bh ? `M${x},${H - padB} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${H - padB} Z` : '';
      const last = i === pts.length - 1;
      return `<g data-tip="${h(`${p.label}: ${p.text}`)}"><rect x="${padL + i * step}" y="${padT - 10}" width="${step}" height="${H - padT + 10}" fill="transparent"/>
        ${path ? `<path d="${path}" fill="${color}" opacity="${last ? 1 : 0.55}"/>` : `<rect x="${x}" y="${H - padB - 2}" width="${bw}" height="2" fill="var(--line)"/>`}
        ${last ? `<text x="${x + bw / 2}" y="${y - 6}" text-anchor="middle" class="rep-val">${h(p.text)}</text>` : ''}
        <text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" class="rep-axis">${h(p.label)}</text></g>`;
    }).join('');
    return `<figure class="db-card rep-chart"><figcaption><h3>${h(title)}</h3></figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${h(`${title}: ${pts.map((p) => `${p.label} ${p.text}`).join(', ')}`)}">
      <line x1="${padL}" x2="${W - padL}" y1="${H - padB}" y2="${H - padB}" stroke="var(--line)"/>${bars}</svg></figure>`;
  }

  window.VTExtra = { renderQuotes, editQuote, openQuote, renderCalendar, addAppointment, renderSites, renderReports, resetSites: () => { editing = null; }, editSite: (id) => { editing = id; siteData = null; const m = q$('#site-mode'); if (m) m.hidden = true; return renderSites(); }, isEditing: () => Boolean(editing) };
})();
