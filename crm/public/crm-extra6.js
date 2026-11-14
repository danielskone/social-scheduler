// Viral Touch CRM: Gift cards and loyalty Points (Payments tab).
// Loaded before crm.js; crm-more.js calls VTExtra6.renderGiftCards / renderPoints.
(() => {
  const q$ = (s, el = document) => el.querySelector(s);
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => Number(n || 0).toLocaleString([], { style: 'currency', currency: 'USD' });
  const day = (iso) => (iso ? new Date(iso.replace(' ', 'T') + (iso.length === 19 ? 'Z' : '')).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  const store = { get(k, d) { try { const v = localStorage.getItem(`vtcrm-${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } } };
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
    gift: '<rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M5 12.5v8h14v-8M12 8.5v12M12 8.5S10.5 4 8 4.3C6 4.6 6.3 7.6 8.3 8.2 9.6 8.6 12 8.5 12 8.5zM12 8.5s1.5-4.5 4-4.2c2 .3 1.7 3.3-.3 3.9-1.3.4-3.7.3-3.7.3z"/>',
    money: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.2c-.5-.8-1.5-1.3-2.8-1.3-1.6 0-2.7.8-2.7 2s1.1 1.7 2.7 2c1.7.3 2.9.9 2.9 2.2 0 1.3-1.2 2.1-2.9 2.1-1.4 0-2.5-.6-3-1.5M12 6.3v1.6M12 16.2v1.5"/>',
    star: '<path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
    people: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 19.5c.9-3.1 3.2-4.8 6-4.8s5.1 1.7 6 4.8"/><circle cx="17" cy="9.5" r="2.6"/><path d="M16.5 14.8c2.3.2 3.9 1.7 4.5 4.2"/>',
  };
  const svg = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;
  const tile = (label, value, ico, c, sub) => `<div class="tile"><div class="tile-ico" style="--c:${c}">${svg(ico)}</div><div><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div></div>`;
  const dlg = () => { const d = q$('#crm-edit-dialog'); d.classList.remove('wide'); d.onclick = null; return d; };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); say('Copied.'); } catch { prompt('Copy this:', text); } };
  const linkbox = (v) => `<div class="linkbox"><input readonly value="${h(v)}" aria-label="Link"><button class="btn" type="button" data-copy-val="${h(v)}">Copy link</button></div>`;
  const SRC = { sold: ['Sold', '#16a34a'], given: ['Given', '#2563eb'], points: ['Points reward', '#d97706'] };
  let people = null;
  const pickPerson = async (name) => { people ||= await call('/contacts?lite=1'); return people.find((x) => x.name.toLowerCase() === String(name).trim().toLowerCase()); };
  const peopleList = async (el) => { people ||= await call('/contacts?lite=1'); el.innerHTML = people.map((p) => `<option value="${h(p.name)}">${h(p.email || '')}</option>`).join(''); };

  // ---------- Gift cards ----------
  async function renderGiftCards(root, modeBar) {
    const d = await call('/giftcards');
    const s = d.settings, t = d.totals;
    root.innerHTML = `${modeBar}<div class="tiles pay-tiles">${tile('Gift cards sold', money(t.sold), 'money', '#16a34a')}${tile('Not spent yet', money(t.outstanding), 'gift', '#db2777', `On ${t.count} card${t.count === 1 ? '' : 's'}`)}</div>
      ${!s.stripe ? `<div class="pay-setup">${svg('money')}<div><b>Selling gift cards needs card payments</b><span>Turn on card payments with your own Stripe first (Invoices, Payment settings). You can still give cards away.</span></div></div>` : ''}
      <div class="card-box"><div class="row" style="justify-content:space-between"><div><b>Your gift card page</b> ${s.on ? '<span class="pay-pill" style="--c:#16a34a">On</span>' : '<span class="pay-pill" style="--c:#6b7280">Off</span>'}<div class="muted small">People pick ${s.amounts.map((a) => money(a).replace('.00', '')).join(', ')}${s.custom ? ` or any amount from ${money(s.min).replace('.00', '')} to ${money(s.max).replace('.00', '')}` : ''}, pay by card, and the code is emailed.</div></div>
        <div class="row"><button class="btn ghost" data-gc-set>Settings</button>${s.on ? `<a class="btn ghost" href="${h(s.link)}" target="_blank" rel="noopener">Open page</a>` : ''}</div></div>${s.on ? linkbox(s.link) : ''}</div>
      <div class="row crm-filters"><button class="btn primary" data-gc-give>+ Give a gift card</button><form id="gc-find" class="row" style="flex:1;min-width:220px"><input name="code" placeholder="Look up a code: ABCD-EFGH-JKMN" autocapitalize="characters" style="flex:1"><button class="btn ghost">Look up</button></form></div>
      ${d.cards.length ? `<div class="table-wrap"><table class="table pay-table"><thead><tr><th>Code</th><th>For</th><th>How</th><th>Started</th><th>Left</th><th>Made</th><th></th></tr></thead><tbody>
        ${d.cards.map((c) => `<tr data-gc="${c.id}"${c.status === 'void' ? ' class="off"' : ''}><td><b class="cp-code">${h(c.code)}</b></td><td>${h(c.owner_name || '')}${c.buyer_name && c.buyer_name !== c.owner_name ? `<br><span class="muted small">From ${h(c.buyer_name)}</span>` : ''}</td>
          <td><span class="pay-pill" style="--c:${SRC[c.source][1]}">${SRC[c.source][0]}</span>${c.status === 'void' ? ' <span class="pay-pill" style="--c:#6b7280">Cancelled</span>' : ''}</td><td>${money(c.amount)}</td><td><b>${money(c.status === 'void' ? 0 : c.balance)}</b></td><td>${day(c.created_at)}</td>
          <td class="pay-act"><button class="btn ghost" data-gc-open>Open</button></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="db-empty center pay-empty">${svg('gift')}<b>No gift cards yet</b><span>Share your gift card page and people can buy cards for themselves or as presents. The code is emailed, and it works on any invoice or Buy now page. You can also give cards away as prizes or thank-yous.</span><button class="btn primary" data-gc-give>Give a gift card</button></div>`}`;
    const again = () => renderGiftCards(root, modeBar);
    q$('#gc-find', root).onsubmit = async (e) => {
      e.preventDefault();
      try { openCard((await call(`/giftcards/lookup?code=${encodeURIComponent(e.target.code.value)}`)).id, again); } catch (err) { say(err.message, true); }
    };
    return (e) => {
      const c = e.target.closest('[data-copy-val]');
      if (c) return copy(c.dataset.copyVal);
      if (e.target.closest('[data-gc-give]')) return giveCard(again);
      if (e.target.closest('[data-gc-set]')) return giftSettings(s, again);
      const r = e.target.closest('[data-gc]');
      if (r && e.target.closest('[data-gc-open]')) openCard(Number(r.dataset.gc), again);
    };
  }
  function giveCard(done) {
    const d = dlg();
    d.innerHTML = `<form id="gc-form"><h1>Give a gift card</h1><p class="muted" style="margin-top:0">For a prize, a thank-you, or store credit. It costs them nothing.</p>
      <label class="field"><span>Who is it for?</span><input name="who" list="gc-people" required autocomplete="off" placeholder="Type a name from People" style="width:100%"><datalist id="gc-people"></datalist></label>
      <label class="field"><span>Amount</span><input name="amount" inputmode="decimal" required placeholder="25" style="width:140px"></label>
      <label class="field"><span>A note to them <small class="muted">(optional, goes in the email)</small></span><textarea name="message" rows="2" maxlength="500" style="width:100%"></textarea></label>
      <label class="check"><input type="checkbox" name="send" checked> Email them the code now</label>
      <div class="row"><button class="btn primary">Give it</button><button class="btn ghost" type="button" data-close>Cancel</button></div><p class="muted" id="gc-msg"></p></form>`;
    if (!d.open) d.showModal();
    peopleList(q$('#gc-people', d)).catch(() => {});
    q$('[data-close]', d).onclick = () => d.close();
    q$('#gc-form', d).onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, p = await pickPerson(f.who.value);
      if (!p) { q$('#gc-msg', d).textContent = 'Pick someone from the list (add them on People first if they are new).'; return; }
      try { const r = await call('/giftcards', { method: 'POST', json: { contact_id: p.id, amount: f.amount.value, message: f.message.value, send: f.send.checked } }); d.close(); say(`Gift card ${r.code} made${r.emailed ? ' and emailed' : ''}.`); done(); }
      catch (err) { q$('#gc-msg', d).textContent = err.message; }
    };
  }
  function giftSettings(s, done) {
    const d = dlg();
    d.innerHTML = `<form id="gs-form"><h1>Gift card page</h1>
      <label class="check"><input type="checkbox" name="on" ${s.on ? 'checked' : ''}> On (people can buy gift cards)</label>
      <label class="field"><span>Amounts to pick from <small class="muted">(separate with commas)</small></span><input name="amounts" value="${h(s.amounts.join(', '))}" style="width:100%"></label>
      <label class="check"><input type="checkbox" name="custom" ${s.custom ? 'checked' : ''}> Let people type their own amount</label>
      <div class="biz-two"><label class="field"><span>Smallest</span><input name="min" inputmode="decimal" value="${h(s.min)}"></label><label class="field"><span>Biggest</span><input name="max" inputmode="decimal" value="${h(s.max)}"></label></div>
      <div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Cancel</button></div><p class="muted" id="gs-msg"></p></form>`;
    if (!d.open) d.showModal();
    q$('[data-close]', d).onclick = () => d.close();
    q$('#gs-form', d).onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try { await call('/giftcards/settings', { method: 'PUT', json: { on: f.on.checked, custom: f.custom.checked, amounts: f.amounts.value, min: f.min.value, max: f.max.value } }); d.close(); say('Saved.'); done(); }
      catch (err) { q$('#gs-msg', d).textContent = err.message; }
    };
  }
  async function openCard(id, done) {
    const c = await call(`/giftcards/${id}`);
    const d = dlg();
    d.innerHTML = `<div><h1 class="cp-code" style="letter-spacing:.06em">${h(c.code)}</h1>
      <p><b style="font-size:1.4rem">${money(c.status === 'void' ? 0 : c.balance)}</b> left of ${money(c.amount)}${c.status === 'void' ? ' · <b>Cancelled</b>' : ''}</p>
      <p class="muted">For ${h(c.owner_name || 'someone')}${c.to_email ? ` (${h(c.to_email)})` : ''}${c.buyer_name && c.buyer_name !== c.owner_name ? `, from ${h(c.buyer_name)}` : ''}. Made ${day(c.created_at)}.</p>
      ${c.message ? `<p>"${h(c.message)}"</p>` : ''}
      <h2 class="small-h">Where it was used</h2>${c.uses.length ? `<ul class="gc-uses">${c.uses.map((u) => `<li><span>${h(u.note || (u.number ? `Invoice #${u.number}` : ''))}</span><b>${u.amount > 0 ? '-' : '+'}${money(Math.abs(u.amount))}</b><span class="muted small">${day(u.created_at)}</span></li>`).join('')}</ul>` : '<p class="muted">Not used yet.</p>'}
      ${linkbox(c.link)}
      <div class="row">${c.status === 'active' && c.to_email ? '<button class="btn" data-resend>Email it again</button>' : ''}${c.status === 'active' ? '<button class="btn ghost danger" data-void>Cancel this card</button>' : ''}<button class="btn ghost" data-close>Close</button></div></div>`;
    if (!d.open) d.showModal();
    d.onclick = async (e) => {
      const cp = e.target.closest('[data-copy-val]');
      if (cp) return copy(cp.dataset.copyVal);
      if (e.target.closest('[data-close]')) return d.close();
      try {
        if (e.target.closest('[data-resend]')) { const r = await call(`/giftcards/${id}/resend`, { method: 'POST' }); say(r.emailed ? 'Emailed again.' : 'Could not email it. Is your email set up?', !r.emailed); }
        if (e.target.closest('[data-void]') && confirm(`Cancel ${c.code}? The ${money(c.balance)} left on it stops working. If they paid for it, refund them in Stripe.`)) { await call(`/giftcards/${id}/void`, { method: 'POST' }); d.close(); done(); }
      } catch (err) { say(err.message, true); }
    };
  }

  // ---------- Points ----------
  async function renderPoints(root, modeBar) {
    const d = await call('/loyalty');
    const s = d.settings, t = d.totals;
    root.innerHTML = `${modeBar}<div class="tiles pay-tiles">${tile('People with points', t.members, 'people', '#2563eb')}${tile('Ready for a reward', t.ready, 'star', '#d97706')}${tile('Rewards given', t.rewarded, 'gift', '#db2777')}</div>
      <div class="card-box"><div class="row" style="justify-content:space-between"><div><b>Loyalty points</b> ${s.on ? '<span class="pay-pill" style="--c:#16a34a">On</span>' : '<span class="pay-pill" style="--c:#6b7280">Off</span>'}
        <div class="muted small">${s.on ? `People earn <b>${s.per_dollar}</b> point${s.per_dollar === 1 ? '' : 's'} for every $1 they pay. <b>${s.reward_points}</b> points turn into a <b>${money(s.reward_value)}</b> gift card, with one tap in their customer portal.${s.welcome ? ` New members get ${s.welcome} welcome points.` : ''}` : 'Turn it on and people earn points every time they pay you. Points turn into gift cards.'}</div></div>
        <button class="btn ${s.on ? 'ghost' : 'primary'}" data-pt-set>${s.on ? 'Settings' : 'Turn on points'}</button></div></div>
      <div class="row crm-filters"><button class="btn ghost" data-pt-add>+ Add or take away points</button></div>
      ${d.people.length ? `<div class="table-wrap"><table class="table pay-table"><thead><tr><th>Who</th><th>Points</th><th>Last change</th><th></th></tr></thead><tbody>
        ${d.people.map((p) => `<tr data-pt="${p.id}"><td><b>${h(p.name)}</b><br><span class="muted small">${h(p.email || '')}</span></td><td><b>${p.points}</b>${p.ready ? ' <span class="pay-pill" style="--c:#d97706">Reward ready</span>' : ''}</td><td>${day(p.last)}</td>
          <td class="pay-act"><button class="btn ghost" data-pt-hist>History</button>${p.ready ? '<button class="btn" data-pt-redeem>Give reward</button>' : ''}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="db-empty center pay-empty">${svg('star')}<b>Nobody has points yet</b><span>${s.on ? 'Points show up here as soon as someone pays an invoice, a Buy now link, tickets or a plan.' : 'Turn on points to reward people who come back. It is free and runs by itself.'}</span></div>`}`;
    const again = () => renderPoints(root, modeBar);
    return async (e) => {
      if (e.target.closest('[data-pt-set]')) return pointSettings(s, again);
      if (e.target.closest('[data-pt-add]')) return adjust(null, again);
      const r = e.target.closest('[data-pt]');
      if (!r) return;
      const p = d.people.find((x) => x.id === Number(r.dataset.pt));
      if (e.target.closest('[data-pt-hist]')) return history(p, again);
      if (e.target.closest('[data-pt-redeem]') && confirm(`Turn ${s.reward_points} of ${p.name}'s points into a ${money(s.reward_value)} gift card and email it to them?`)) {
        try { const g = await call(`/loyalty/contacts/${p.id}/redeem`, { method: 'POST' }); say(`Gift card ${g.code} made${g.emailed ? ' and emailed' : ''}.`); again(); } catch (err) { say(err.message, true); }
      }
    };
  }
  function pointSettings(s, done) {
    const d = dlg();
    d.innerHTML = `<form id="pt-form"><h1>Loyalty points</h1>
      <label class="check"><input type="checkbox" name="on" checked> On (people earn points when they pay)</label>
      <div class="biz-two"><label class="field"><span>Points for every $1 paid</span><input name="per_dollar" inputmode="decimal" value="${h(s.per_dollar)}"></label>
        <label class="field"><span>Welcome bonus <small class="muted">(first time they earn)</small></span><input name="welcome" inputmode="numeric" value="${h(s.welcome)}"></label></div>
      <div class="biz-two"><label class="field"><span>Points needed for a reward</span><input name="reward_points" inputmode="numeric" value="${h(s.reward_points)}"></label>
        <label class="field"><span>Reward: a gift card worth</span><input name="reward_value" inputmode="decimal" value="${h(s.reward_value)}"></label></div>
      <p class="muted small" id="pt-ex"></p>
      <div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Cancel</button></div><p class="muted" id="pt-msg"></p></form>`;
    if (!d.open) d.showModal();
    const f = q$('#pt-form', d);
    const ex = () => { const per = Number(f.per_dollar.value) || 0, need = Number(f.reward_points.value) || 0, val = Number(f.reward_value.value) || 0;
      q$('#pt-ex', d).textContent = per && need ? `Example: someone who spends ${money(need / per)} gets a ${money(val)} gift card. That is ${((val / (need / per)) * 100).toFixed(1)}% back.` : ''; };
    f.oninput = ex; ex();
    q$('[data-close]', d).onclick = () => d.close();
    f.onsubmit = async (e) => {
      e.preventDefault();
      try { await call('/loyalty/settings', { method: 'PUT', json: { on: f.on.checked, per_dollar: f.per_dollar.value, welcome: f.welcome.value || 0, reward_points: f.reward_points.value, reward_value: f.reward_value.value } }); d.close(); say('Saved.'); done(); }
      catch (err) { q$('#pt-msg', d).textContent = err.message; }
    };
  }
  function adjust(p, done) {
    const d = dlg();
    d.innerHTML = `<form id="pa-form"><h1>Add or take away points</h1>
      <label class="field"><span>Who</span><input name="who" list="pa-people" required autocomplete="off" value="${h(p ? p.name : '')}" style="width:100%"><datalist id="pa-people"></datalist></label>
      <label class="field"><span>Points <small class="muted">(use a minus sign to take away, like -50)</small></span><input name="points" inputmode="numeric" required style="width:140px"></label>
      <label class="field"><span>Why <small class="muted">(they see this)</small></span><input name="note" maxlength="200" placeholder="Thanks for the referral" style="width:100%"></label>
      <div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Cancel</button></div><p class="muted" id="pa-msg"></p></form>`;
    if (!d.open) d.showModal();
    peopleList(q$('#pa-people', d)).catch(() => {});
    q$('[data-close]', d).onclick = () => d.close();
    q$('#pa-form', d).onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, who = await pickPerson(f.who.value);
      if (!who) { q$('#pa-msg', d).textContent = 'Pick someone from the list.'; return; }
      try { const r = await call(`/loyalty/contacts/${who.id}`, { method: 'POST', json: { points: f.points.value, note: f.note.value } }); d.close(); say(`${who.name} now has ${r.points} points.`); done(); }
      catch (err) { q$('#pa-msg', d).textContent = err.message; }
    };
  }
  async function history(p, done) {
    const r = await call(`/loyalty/contacts/${p.id}`);
    const d = dlg();
    d.innerHTML = `<div><h1>${h(p.name)}: ${r.points} points</h1>
      ${r.history.length ? `<ul class="gc-uses">${r.history.map((x) => `<li><span>${h(x.note || '')}</span><b style="color:${x.points > 0 ? '#16a34a' : '#dc2626'}">${x.points > 0 ? '+' : ''}${x.points}</b><span class="muted small">${day(x.created_at)}</span></li>`).join('')}</ul>` : '<p class="muted">No points yet.</p>'}
      <div class="row"><button class="btn" data-adj>Add or take away</button><button class="btn ghost" data-close>Close</button></div></div>`;
    if (!d.open) d.showModal();
    d.onclick = (e) => { if (e.target.closest('[data-close]')) d.close(); if (e.target.closest('[data-adj]')) { d.onclick = null; adjust(p, done); } };
  }

  window.VTExtra6 = { renderGiftCards, renderPoints };
})();
