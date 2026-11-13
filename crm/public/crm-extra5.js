// Viral Touch CRM: Events and tickets (the Events tab). Make an event with free or paid ticket
// types, share its page, see who got tickets, and check people in at the door.
// Loaded before crm.js, which calls window.VTExtra5.renderEvents().
(() => {
  const q$ = (s, el = document) => el.querySelector(s);
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => Number(n || 0).toLocaleString([], { style: 'currency', currency: 'USD' });
  const store = {
    get(k, d) { try { const v = localStorage.getItem(`vtcrm-${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  };
  async function call(path, opts = {}) {
    if (opts.json) { opts.body = JSON.stringify(opts.json); opts.headers = { 'Content-Type': 'application/json' }; delete opts.json; }
    const b = store.get('biz', '');
    const url = `/api/crm${path}`;
    const res = await fetch(b ? `${url}${url.includes('?') ? '&' : '?'}biz=${encodeURIComponent(b)}` : url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { data });
    return data;
  }
  const say = (msg, err) => { const el = q$('#banner'); el.textContent = msg; el.className = `banner${err ? ' error' : ''}`; el.hidden = !msg; if (msg && !err) setTimeout(() => { if (el.textContent === msg) el.hidden = true; }, 4000); };
  const I = {
    ticket: '<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h14a1.5 1.5 0 0 1 1.5 1.5v2.2a2.3 2.3 0 0 0 0 4.6v2.2A1.5 1.5 0 0 1 19 18H5a1.5 1.5 0 0 1-1.5-1.5v-2.2a2.3 2.3 0 0 0 0-4.6z"/><path d="M14.5 6.5v11" stroke-dasharray="1.6 2"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    door: '<path d="M5 20.5V4.5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v16"/><path d="M3 20.5h18M15 12.5h.01"/>',
    money: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.2c-.5-.8-1.5-1.3-2.8-1.3-1.6 0-2.7.8-2.7 2s1.1 1.7 2.7 2c1.7.3 2.9.9 2.9 2.2 0 1.3-1.2 2.1-2.9 2.1-1.4 0-2.5-.6-3-1.5M12 6.3v1.6M12 16.2v1.5"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  };
  const svg = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;
  const tile = (label, value, ico, c) => `<div class="tile"><div class="tile-ico" style="--c:${c}">${svg(ico)}</div><div><div class="label">${label}</div><div class="value">${value}</div></div></div>`;
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); say('Link copied.'); } catch { prompt('Copy this:', text); } };
  const linkbox = (v) => `<div class="linkbox"><input readonly value="${h(v)}" aria-label="Link"><button class="btn" type="button" data-copy-val="${h(v)}">Copy link</button></div>`;
  const imgSrc = (u) => (/^media\//.test(u || '') ? `/s/${u}` : u);
  const nextSat = () => { const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); return `${d.toISOString().slice(0, 10)}T18:00`; };

  let open = null; // event id being edited
  let find = '';
  async function renderEvents() {
    const root = q$('#ev-root');
    if (open) return editor(root, open);
    const d = await call('/events');
    const up = d.events.filter((e) => !e.past), past = d.events.filter((e) => e.past);
    const card = (e) => `<div class="prod-card ev-card${e.active && !e.past ? '' : ' off'}" data-ev="${e.id}">
      ${e.cover ? `<img class="ev-cover" src="${h(imgSrc(e.cover))}" alt="">` : ''}
      <div class="prod-top"><div><b>${h(e.title)}</b>${e.active ? '' : ' <span class="pay-pill" style="--c:#6b7280">Off</span>'}${e.past ? ' <span class="pay-pill" style="--c:#6b7280">Over</span>' : ''}
      <div class="muted small">${h(e.when)}</div></div></div>
      <div class="ev-nums"><span><b>${e.sold}</b> tickets</span><span><b>${e.checkedIn}</b> checked in</span>${e.revenue ? `<span><b>${money(e.revenue)}</b></span>` : ''}</div>
      ${e.active && !e.past ? linkbox(e.link) : ''}<div class="row"><button class="btn primary" data-edit>Open</button>${e.active ? `<a class="btn ghost" href="${h(e.link)}" target="_blank" rel="noopener">See page</a>` : ''}</div></div>`;
    root.innerHTML = `<div class="tiles">${tile('Coming up', d.totals.upcoming, 'cal', '#4f46e5')}${tile('Tickets out', d.totals.sold, 'ticket', '#0d9488')}${tile('Ticket money', money(d.totals.revenue), 'money', '#16a34a')}</div>
      <div class="row crm-filters"><button class="btn primary" data-new>+ New event</button></div>
      ${d.events.length ? `${up.length ? `<div class="prod-cards">${up.map(card).join('')}</div>` : '<p class="muted">No upcoming events.</p>'}
        ${past.length ? `<h2 class="ev-h">Past events</h2><div class="prod-cards">${past.map(card).join('')}</div>` : ''}`
      : `<div class="db-empty center pay-empty">${svg('ticket')}<b>No events yet</b><span>Make a page for a parade, a class, a car show or a party. Add free or paid tickets. People get their tickets by email with a code to scan. At the door, open a ticket on your phone and press Check in.</span><button class="btn primary" data-new>Make my first event</button></div>`}`;
    root.onclick = async (e) => {
      const c = e.target.closest('[data-copy-val]');
      if (c) return copy(c.dataset.copyVal);
      if (e.target.closest('[data-new]')) {
        const title = prompt('Name of the event?', 'Open house');
        if (!title) return;
        try { const ev = await call('/events', { method: 'POST', json: { title, starts_at: nextSat(), types: [{ name: 'General admission', price: 0 }] } }); open = ev.id; renderEvents(); }
        catch (err) { say(err.message, true); }
        return;
      }
      const cd = e.target.closest('[data-ev]');
      if (cd && e.target.closest('[data-edit]')) { open = Number(cd.dataset.ev); find = ''; renderEvents(); }
    };
  }

  const typeRow = (t = {}) => `<tr data-type="${t.id || ''}"><td><input name="tname" required maxlength="60" value="${h(t.name || '')}" placeholder="General, VIP, Kids..."></td>
    <td><input name="tprice" inputmode="decimal" value="${h(t.price ?? 0)}" aria-label="Price"></td><td><input name="tcap" inputmode="numeric" value="${h(t.capacity ?? '')}" placeholder="No limit" aria-label="How many"></td>
    <td class="muted small">${t.id ? `${t.sold} out` : 'New'}</td><td><button class="btn ghost icon danger" type="button" data-del-type aria-label="Remove ticket type">${svg('trash')}</button></td></tr>`;

  async function editor(root, id) {
    let e;
    try { e = await call(`/events/${id}`); } catch (err) { open = null; say(err.message, true); return renderEvents(); }
    const shown = e.tickets.filter((t) => !find || `${t.contact_name} ${t.email} ${t.type_name}`.toLowerCase().includes(find.toLowerCase()));
    root.innerHTML = `<div class="course-ed"><div class="row"><button class="btn ghost" data-back>&larr; All events</button><a class="btn ghost" href="${h(e.link)}" target="_blank" rel="noopener">Open event page</a></div>
      <div class="tiles">${tile('Tickets out', e.sold, 'ticket', '#0d9488')}${tile('Checked in', `${e.checkedIn} of ${e.sold}`, 'door', '#4f46e5')}${tile('Ticket money', money(e.revenue), 'money', '#16a34a')}</div>
      <form id="ev-form" class="card-box"><h2>Event</h2>
        <label class="field"><span>Name</span><input name="title" required maxlength="140" value="${h(e.title)}"></label>
        <div class="biz-two"><label class="field"><span>Starts</span><input type="datetime-local" name="starts_at" required value="${h(e.starts_at)}"></label>
          <label class="field"><span>Ends <small class="muted">(optional)</small></span><input type="datetime-local" name="ends_at" value="${h(e.ends_at || '')}"></label></div>
        <label class="field"><span>Where <small class="muted">(an address opens in Maps)</small></span><input name="location" maxlength="200" value="${h(e.location || '')}" placeholder="123 Main St, Fuquay-Varina, NC"></label>
        <label class="field"><span>About the event <small class="muted">(shows on the page)</small></span><textarea name="description" rows="4" maxlength="4000">${h(e.description || '')}</textarea></label>
        <div class="field"><span>Photo at the top <small class="muted">(optional)</small></span><div class="row"><span id="ev-cover">${e.cover ? `<img class="ev-thumb" src="${h(imgSrc(e.cover))}" alt="">` : ''}</span><input type="file" accept="image/*" id="ev-file"><input type="hidden" name="cover" value="${h(e.cover || '')}">${e.cover ? '<button class="btn ghost" type="button" data-nocover>Remove photo</button>' : ''}</div></div>
        <h2 style="margin-top:18px">Tickets</h2><p class="muted small">Price 0 means free. Leave "How many" empty for no limit. People can get up to 10 at a time.</p>
        <div class="table-wrap"><table class="table ev-types"><thead><tr><th>Ticket</th><th>Price</th><th>How many</th><th></th><th></th></tr></thead><tbody>${e.types.map(typeRow).join('')}</tbody></table></div>
        <button class="btn ghost" type="button" data-add-type>+ Add a ticket type</button>
        <div class="biz-two" style="margin-top:14px"><label class="field"><span>Web address</span><input name="slug" maxlength="50" value="${h(e.slug)}"></label>
          <label class="field"><span>Door code <small class="muted">(4 to 8 numbers, for your helpers at the door)</small></span><input name="door_code" inputmode="numeric" maxlength="8" value="${h(e.door_code)}"></label></div>
        <label class="check"><input type="checkbox" name="active" ${e.active ? 'checked' : ''}> On (people can get tickets)</label>
        ${e.active ? linkbox(e.link) : ''}
        <div class="row"><button class="btn primary">Save event</button><a class="btn ghost" href="/api/crm/events/${e.id}/qr" download="event-qr.svg">QR code for flyers</a><button class="btn ghost danger" type="button" data-del>Delete event</button><span class="muted" id="ev-msg"></span></div></form>
      <div class="card-box ev-door"><h2>At the door</h2><p>Scan a ticket's QR code with any phone camera. The ticket opens. The first time, tap <b>Staff: check in</b> and type the door code <b>${h(e.door_code)}</b>. After that, each ticket you scan has a big <b>Check in</b> button. A ticket used twice shows a warning. You can also check people in from the list below.</p></div>
      <div class="card-box"><div class="row" style="justify-content:space-between"><h2>Who's coming (${e.tickets.filter((t) => t.status === 'valid').length})</h2></div>
        <div class="row"><input id="ev-find" type="search" placeholder="Find a name or email" value="${h(find)}" style="flex:1;min-width:180px">
          <form id="guest-form" class="row" style="flex:1;min-width:240px"><input name="who" list="ev-people" placeholder="Add a guest: type a name" autocomplete="off" style="flex:1"><datalist id="ev-people"></datalist><button class="btn">Add</button></form></div>
        ${shown.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Ticket</th><th>Door</th><th></th></tr></thead><tbody>${shown.map((t) => `<tr data-t="${t.id}"${t.status === 'canceled' ? ' class="off"' : ''}><td><b>${h(t.contact_name || 'Unknown')}</b><br><span class="muted small">${h(t.email || '')}</span></td>
          <td>${h(t.type_name)}${t.price ? ` <span class="muted small">${money(t.price)}</span>` : ''}${t.status === 'canceled' ? ' <span class="pay-pill" style="--c:#6b7280">Cancelled</span>' : ''}</td>
          <td>${t.status !== 'valid' ? '' : t.checked_in_at ? `<button class="btn ghost ev-in" data-undo title="Undo">✓ ${new Date(t.checked_in_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</button>` : '<button class="btn" data-in>Check in</button>'}</td>
          <td class="pay-act">${t.status === 'valid' ? `<a class="btn ghost" href="/e/ticket/${h(t.code)}" target="_blank" rel="noopener">Ticket</a>${t.email ? '<button class="btn ghost" data-resend>Email again</button>' : ''}<button class="btn ghost danger" data-cancel>Cancel</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
          : `<p class="muted">${find ? 'Nobody matches.' : 'Nobody yet. Share the event page, or add a guest above.'}</p>`}</div></div>`;
    const reload = () => editor(root, id);
    const f = q$('#ev-form', root);
    const types = () => [...f.querySelectorAll('tr[data-type]')].map((tr) => ({ id: Number(tr.dataset.type) || null, name: q$('[name=tname]', tr).value, price: q$('[name=tprice]', tr).value, capacity: q$('[name=tcap]', tr).value }));
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        await call(`/events/${id}`, { method: 'PUT', json: { title: f.title.value, starts_at: f.starts_at.value, ends_at: f.ends_at.value, location: f.location.value, description: f.description.value,
          cover: f.cover.value, slug: f.slug.value, door_code: f.door_code.value, active: f.active.checked, types: types() } });
        say('Event saved.'); reload();
      } catch (err) { q$('#ev-msg', root).textContent = err.message; }
    };
    q$('#ev-file', root).onchange = async (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      q$('#ev-msg', root).textContent = 'Uploading...';
      try { const r = await call('/sites/upload', { method: 'POST', body: file, headers: { 'Content-Type': file.type } }); f.cover.value = r.url; q$('#ev-cover', root).innerHTML = `<img class="ev-thumb" src="${h(imgSrc(r.url))}" alt="">`; q$('#ev-msg', root).textContent = 'Photo added. Press Save event.'; }
      catch (err) { q$('#ev-msg', root).textContent = err.message; }
    };
    const fi = q$('#ev-find', root);
    fi.oninput = () => { find = fi.value; clearTimeout(fi.t); fi.t = setTimeout(() => { reload().then(() => { const n = q$('#ev-find', root); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 250); };
    const gf = q$('#guest-form', root);
    let people = null;
    gf.who.onfocus = async () => { if (people) return; people = await call('/contacts'); q$('#ev-people', root).innerHTML = people.map((p) => `<option value="${h(p.name)}">${h(p.email || '')}</option>`).join(''); };
    gf.onsubmit = async (ev) => {
      ev.preventDefault();
      people ||= await call('/contacts');
      const p = people.find((x) => x.name.toLowerCase() === gf.who.value.trim().toLowerCase());
      if (!p) return say('Pick someone from the list (add them on People first if they are new).', true);
      try { const r = await call(`/events/${id}/guests`, { method: 'POST', json: { contact_id: p.id } }); say(r.emailed ? `${p.name} is on the list. We emailed their ticket.` : `${p.name} is on the list.`); reload(); }
      catch (err) { say(err.message, true); }
    };
    root.onclick = async (ev) => {
      const c = ev.target.closest('[data-copy-val]');
      if (c) return copy(c.dataset.copyVal);
      if (ev.target.closest('[data-back]')) { open = null; return renderEvents(); }
      if (ev.target.closest('[data-add-type]')) { q$('.ev-types tbody', root).insertAdjacentHTML('beforeend', typeRow()); return; }
      if (ev.target.closest('[data-del-type]')) { ev.target.closest('tr').remove(); return; }
      if (ev.target.closest('[data-nocover]')) { f.cover.value = ''; q$('#ev-cover', root).innerHTML = ''; q$('#ev-msg', root).textContent = 'Press Save event.'; return; }
      if (ev.target.closest('[data-del]')) {
        if (!confirm(`Delete "${e.title}" and its ticket list?`)) return;
        try { await call(`/events/${id}`, { method: 'DELETE' }); open = null; say('Event deleted.'); renderEvents(); } catch (err) { say(err.message, true); }
        return;
      }
      const row = ev.target.closest('[data-t]');
      if (!row) return;
      const tid = row.dataset.t, t = e.tickets.find((x) => x.id === Number(tid));
      try {
        if (ev.target.closest('[data-in]')) { await call(`/events/tickets/${tid}/checkin`, { method: 'POST', json: {} }); say(`${t.contact_name} is checked in.`); return reload(); }
        if (ev.target.closest('[data-undo]')) { if (confirm(`Undo check-in for ${t.contact_name}?`)) { await call(`/events/tickets/${tid}/checkin`, { method: 'POST', json: { undo: true } }); reload(); } return; }
        if (ev.target.closest('[data-resend]')) { const r = await call(`/events/tickets/${tid}/resend`, { method: 'POST', json: {} }); say(r.emailed ? 'Ticket emailed again.' : 'Could not email it. Is your email set up?', !r.emailed); return; }
        if (ev.target.closest('[data-cancel]')) { if (confirm(`Cancel this ${t.type_name} ticket for ${t.contact_name}?${t.price ? ' If they paid, refund them in Stripe.' : ''}`)) { await call(`/events/tickets/${tid}/cancel`, { method: 'POST', json: {} }); reload(); } }
      } catch (err) { say(err.message, true); }
    };
  }

  window.VTExtra5 = { renderEvents };
})();
