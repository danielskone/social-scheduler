// Viral Touch CRM: website chat settings, Products (inside Payments), the customer portal
// button, and Courses. Loaded before crm.js, which calls window.VTExtra2.
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
    const res = await fetch(b && !opts.noBiz ? `${url}${url.includes('?') ? '&' : '?'}biz=${encodeURIComponent(b)}` : url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { data });
    return data;
  }
  const say = (msg, err) => { const el = q$('#banner'); el.textContent = msg; el.className = `banner${err ? ' error' : ''}`; el.hidden = !msg; if (msg && !err) setTimeout(() => { if (el.textContent === msg) el.hidden = true; }, 4000); };
  const I = {
    chat: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17H6.5A2.5 2.5 0 0 1 4 14.5z"/>',
    tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.1 6.1a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.6"/>',
    cap: '<path d="M2.5 9 12 4.5 21.5 9 12 13.5z"/><path d="M6.5 11v4.5c1.5 1.5 3.4 2.2 5.5 2.2s4-.7 5.5-2.2V11M21.5 9v5"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="m10 8.5 5.5 3.5-5.5 3.5z"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
    up: '<path d="m6 14 6-6 6 6"/>', down: '<path d="m6 10 6 6 6-6"/>', trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
    people: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 19.5c.9-3.1 3.2-4.8 6-4.8s5.1 1.7 6 4.8"/><circle cx="17" cy="9.5" r="2.6"/><path d="M16.5 14.8c2.3.2 3.9 1.7 4.5 4.2"/>',
    money: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.2c-.5-.8-1.5-1.3-2.8-1.3-1.6 0-2.7.8-2.7 2s1.1 1.7 2.7 2c1.7.3 2.9.9 2.9 2.2 0 1.3-1.2 2.1-2.9 2.1-1.4 0-2.5-.6-3-1.5M12 6.3v1.6M12 16.2v1.5"/>',
    user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.8 4-5.8 7.5-5.8s6.3 2 7.5 5.8"/>',
  };
  const svg = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;
  const tile = (label, value, ico, c, sub) => `<div class="tile"><div class="tile-ico" style="--c:${c}">${svg(ico)}</div><div><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div></div>`;
  const dlg = (wide) => { const d = q$('#crm-edit-dialog'); d.classList.toggle('wide', Boolean(wide)); return d; };
  const copy = async (text, what = 'Link') => { try { await navigator.clipboard.writeText(text); say(`${what} copied.`); } catch { prompt('Copy this:', text); } };
  const linkbox = (v, label = 'Copy link') => `<div class="linkbox"><input readonly value="${h(v)}" aria-label="Link"><button class="btn" type="button" data-copy-val="${h(v)}">${label}</button></div>`;
  const onCopy = (e) => { const b = e.target.closest('[data-copy-val]'); if (b) { copy(b.dataset.copyVal, b.textContent.includes('code') ? 'Code' : 'Link'); return true; } return false; };

  // ======================= Website chat settings =======================
  async function chatSettings() {
    const s = await call('/chat/settings');
    const d = dlg();
    d.innerHTML = `<form id="chat-form" class="chat-set"><header class="view-head"><h1>${svg('chat')} Chat bubble for your website</h1><button class="btn ghost" type="button" data-close>Close</button></header>
      <p class="muted">A small chat button sits in the corner of your website. When someone writes, it shows up here in <b>Conversations</b> and your iPhone buzzes. Answer from here. If they already left, your answer goes to their email.</p>
      <label class="check big"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}> Chat is on for <b>${h(s.business.name)}</b></label>
      <label class="field"><span>Hello message they see first</span><textarea name="greeting" rows="2" maxlength="300">${h(s.greeting)}</textarea></label>
      <label class="field"><span>New chatters go in this group</span><select name="group_name"><option value="">${h(s.groups[0] || 'Other')} (first group)</option>${s.groups.map((g) => `<option${g === s.group_name ? ' selected' : ''}>${h(g)}</option>`).join('')}</select></label>
      <div class="row"><button class="btn primary">Save</button><a class="btn ghost" href="${h(s.testLink)}" target="_blank" rel="noopener">Try it yourself</a><span class="muted" id="chat-msg"></span></div>
      <h2>Put it on your website</h2>
      <p class="muted small"><b>Pages you make in Sites:</b> open the page, tick <b>Chat bubble</b> and save. Done.</p>
      <p class="muted small"><b>Any other website</b> (Hostinger, Wix, WordPress, Squarespace): copy this code and paste it where the site lets you add <b>custom code</b> to every page, often called <b>Header code</b> or <b>Embed code</b>.</p>
      ${linkbox(s.code, 'Copy code')}</form><div id="faq-box" class="chat-set"></div>`;
    if (!d.open) d.showModal();
    if (window.VTExtra7) window.VTExtra7.faqEditor(q$('#faq-box', d), s);
    const f = q$('#chat-form', d);
    f.onclick = (e) => { if (e.target.closest('[data-close]')) d.close(); onCopy(e); };
    f.onsubmit = async (e) => {
      e.preventDefault();
      try { await call('/chat/settings', { method: 'PUT', json: { enabled: f.enabled.checked, greeting: f.greeting.value, group_name: f.group_name.value } }); q$('#chat-msg', d).textContent = 'Saved.'; say('Chat settings saved.'); }
      catch (err) { q$('#chat-msg', d).textContent = err.message; }
    };
  }

  // ======================= Products (a mode of the Payments tab) =======================
  async function renderProducts(root, modeBar) {
    const d = await call('/products');
    const live = d.products.filter((p) => p.active);
    root.innerHTML = `${modeBar}<div class="tiles pay-tiles">${tile('Products for sale', live.length, 'tag', '#9333ea')}${tile('Sold with Buy now links', d.products.reduce((s, p) => s + p.sold, 0), 'money', '#16a34a', 'Counts people who went to pay')}</div>
      ${!d.stripe ? `<div class="pay-setup">${svg('money')}<div><b>Buy now links need card payments</b><span>Turn on card payments with your own Stripe first (Invoices, Payment settings). You can still use products on invoices and quotes.</span></div></div>` : ''}
      <div class="row crm-filters"><button class="btn primary" data-new-prod>+ New product</button></div>
      ${d.products.length ? `<div class="prod-cards">${d.products.map((p) => `<div class="prod-card${p.active ? '' : ' off'}" data-prod="${p.id}"><div class="prod-top"><div><b>${h(p.name)}</b>${p.active ? '' : ' <span class="pay-pill" style="--c:#6b7280">Hidden</span>'}
          ${p.description ? `<div class="muted small">${h(p.description)}</div>` : ''}</div><div class="prod-price">${money(p.price)}</div></div>
          ${p.active ? linkbox(p.link) : ''}<div class="muted small">${p.sold} sold${p.max_qty > 1 ? ` · up to ${p.max_qty} per order` : ''}</div>
          <div class="row"><button class="btn" data-edit-prod>Edit</button>${p.active ? `<a class="btn ghost" href="${h(p.link)}" target="_blank" rel="noopener">Open</a>` : ''}</div></div>`).join('')}</div>`
      : `<div class="db-empty center pay-empty">${svg('tag')}<b>No products yet</b><span>Save the things you sell once, with a price. Add them to invoices and quotes with one tap, or share a <b>Buy now</b> link so people pay by card on their own.</span><button class="btn primary" data-new-prod>Add my first product</button></div>`}`;
    return (e) => {
      if (onCopy(e)) return;
      if (e.target.closest('[data-new-prod]')) return editProduct(null, () => renderProducts(root, modeBar));
      const card = e.target.closest('[data-prod]');
      if (card && e.target.closest('[data-edit-prod]')) editProduct(d.products.find((x) => x.id === Number(card.dataset.prod)), () => renderProducts(root, modeBar));
    };
  }
  function editProduct(p, done) {
    const d = dlg();
    d.innerHTML = `<form id="prod-form"><h1>${p ? 'Edit product' : 'New product'}</h1>
      <label class="field"><span>Name</span><input name="name" required maxlength="120" placeholder="Gold sponsorship, 1-hour coaching, T-shirt..." value="${h(p ? p.name : '')}"></label>
      <div class="biz-two"><label class="field"><span>Price</span><input name="price" inputmode="decimal" required placeholder="$0.00" value="${h(p ? p.price : '')}"></label>
        <label class="field"><span>Most one person can buy</span><input name="max_qty" type="number" min="1" max="100" value="${h(p ? p.max_qty : 1)}"></label></div>
      <label class="field"><span>Short description <small class="muted">(shows on the Buy now page)</small></span><textarea name="description" rows="3" maxlength="600">${h(p ? p.description || '' : '')}</textarea></label>
      <label class="check"><input type="checkbox" name="active" ${!p || p.active ? 'checked' : ''}> For sale (the Buy now link works)</label>
      <div class="row"><button class="btn primary">Save</button><button class="btn ghost" type="button" data-close>Cancel</button>${p ? '<button class="btn ghost danger" type="button" data-del>Delete</button>' : ''}</div>
      <p class="muted" id="prod-msg"></p></form>`;
    if (!d.open) d.showModal();
    const f = q$('#prod-form', d);
    f.onclick = async (e) => {
      if (e.target.closest('[data-close]')) d.close();
      if (e.target.closest('[data-del]') && confirm(`Delete "${p.name}"? Its Buy now link stops working. Old invoices stay.`)) {
        try { await call(`/products/${p.id}`, { method: 'DELETE' }); d.close(); say('Product deleted.'); done && done(); } catch (err) { q$('#prod-msg', d).textContent = err.message; }
      }
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = { name: f.name.value, price: f.price.value, max_qty: f.max_qty.value, description: f.description.value, active: f.active.checked };
      try { await call(p ? `/products/${p.id}` : '/products', { method: p ? 'PUT' : 'POST', json: body }); d.close(); say('Product saved.'); done && done(); }
      catch (err) { q$('#prod-msg', d).textContent = err.message; }
    };
  }
  // "+ Add a product" on the invoice and quote editors.
  async function productButton(d, linesSel, row, sum) {
    const add = q$('[data-add]', d);
    if (!add) return;
    let list = [];
    try { list = (await call("/products")).products.filter((p) => p.active); } catch { return; }
    if (!list.length) return;
    const sel = document.createElement('select');
    sel.className = 'prod-pick'; sel.setAttribute('aria-label', 'Add a product');
    sel.innerHTML = `<option value="">+ Add a product</option>${list.map((p) => `<option value="${p.id}">${h(p.name)} · ${money(p.price)}</option>`).join('')}`;
    add.after(sel);
    sel.onchange = () => {
      const p = list.find((x) => x.id === Number(sel.value));
      sel.value = '';
      if (!p) return;
      const lines = q$(linesSel, d);
      const first = lines.querySelector('.inv-line');
      if (lines.children.length === 1 && first && !q$('[name=what]', first).value && !q$('[name=price]', first).value) first.remove();
      lines.insertAdjacentHTML('beforeend', row({ what: p.name, qty: 1, price: p.price }));
      sum();
    };
  }

  // ======================= Customer portal =======================
  async function portalLink(contactId, name) {
    const d = dlg();
    d.innerHTML = '<p class="muted">Making their link...</p>';
    if (!d.open) d.showModal();
    try {
      const r = await call(`/portal/${contactId}/link`, { method: 'POST', json: {} });
      d.innerHTML = `<div class="portal-box"><header class="view-head"><h1>${svg('user')} ${h(name || 'Their')} customer portal</h1><button class="btn ghost" type="button" data-close>Close</button></header>
        <p class="muted">One private page with their invoices, quotes, appointments and courses. No password. Send them this link by text or email. It works for 60 days, and they can get a new one any time by typing their email.</p>
        ${linkbox(r.link)}
        <div class="row"><button class="btn primary" data-email>Email it to them</button><a class="btn ghost" href="${h(r.link)}" target="_blank" rel="noopener">See what they see</a></div>
        <p class="muted small">Sign-in page for everyone: <a href="${h(r.link.replace(/\/portal\/.*$/, '/portal'))}" target="_blank" rel="noopener">${h(r.link.replace(/\/portal\/.*$/, '/portal'))}</a>. Put it on your website as <b>My account</b>.</p>
        <p class="muted" id="portal-msg"></p></div>`;
      d.onclick = async (e) => {
        if (e.target.closest('[data-close]')) return d.close();
        if (onCopy(e)) return;
        const b = e.target.closest('[data-email]');
        if (b) { b.disabled = true; try { await call(`/portal/${contactId}/link`, { method: 'POST', json: { send: true } }); q$('#portal-msg', d).textContent = 'Emailed.'; say('Portal link emailed.'); } catch (err) { q$('#portal-msg', d).textContent = err.message; b.disabled = false; } }
      };
    } catch (err) { d.innerHTML = `<p>${h(err.message)}</p><button class="btn" onclick="this.closest('dialog').close()">Close</button>`; }
  }

  // ======================= Courses =======================
  let courseOpen = null;
  async function renderCourses() {
    const root = q$('#course-root');
    if (courseOpen) return courseEditor(root, courseOpen);
    const d = await call('/courses');
    root.innerHTML = `<div class="row crm-filters"><button class="btn primary" data-new-course>+ New course</button></div>
      ${d.courses.length ? `<div class="prod-cards">${d.courses.map((c) => `<div class="prod-card course-card${c.active ? '' : ' off'}" data-course="${c.id}"><div class="prod-top"><div><b>${h(c.title)}</b>${c.active ? '' : ' <span class="pay-pill" style="--c:#6b7280">Hidden</span>'}
          <div class="muted small">${c.lessons} lesson${c.lessons === 1 ? '' : 's'} · ${c.members} member${c.members === 1 ? '' : 's'}</div></div><div class="prod-price">${c.price > 0 ? money(c.price) : 'Free'}</div></div>
          ${c.active ? linkbox(c.link) : ''}<div class="row"><button class="btn primary" data-edit-course>Open</button>${c.active ? `<a class="btn ghost" href="${h(c.link)}" target="_blank" rel="noopener">Sales page</a>` : ''}</div></div>`).join('')}</div>`
      : `<div class="db-empty center pay-empty">${svg('cap')}<b>No courses yet</b><span>Teach what you know. Add lessons with a YouTube or Vimeo link or your own video. Share the course page: free courses open right away, paid ones go through your Stripe. Members watch in their private customer portal.</span><button class="btn primary" data-new-course>Make my first course</button></div>`}`;
    root.onclick = async (e) => {
      if (onCopy(e)) return;
      if (e.target.closest('[data-new-course]')) {
        const title = prompt('Name of the course?', 'Getting started');
        if (!title) return;
        try { const c = await call('/courses', { method: 'POST', json: { title, price: 0 } }); courseOpen = c.id; renderCourses(); } catch (err) { say(err.message, true); }
        return;
      }
      const card = e.target.closest('[data-course]');
      if (card && e.target.closest('[data-edit-course]')) { courseOpen = Number(card.dataset.course); renderCourses(); }
    };
  }
  async function courseEditor(root, id) {
    let c;
    try { c = await call(`/courses/${id}`); } catch (err) { courseOpen = null; say(err.message, true); return renderCourses(); }
    const done = (m) => (c.lessons.length ? Math.round((m.done / c.lessons.length) * 100) : 0);
    root.innerHTML = `<div class="course-ed"><div class="row"><button class="btn ghost" data-back>&larr; All courses</button><a class="btn ghost" href="${h(c.link)}" target="_blank" rel="noopener">Open sales page</a></div>
      <form id="course-form" class="card-box"><h2>Course</h2>
        <label class="field"><span>Name</span><input name="title" required maxlength="120" value="${h(c.title)}"></label>
        <div class="biz-two"><label class="field"><span>Price <small class="muted">(0 = free)</small></span><input name="price" inputmode="decimal" value="${h(c.price)}"></label>
          <label class="field"><span>Web address</span><input name="slug" maxlength="50" value="${h(c.slug)}"></label></div>
        <label class="field"><span>What they will learn <small class="muted">(shows on the sales page)</small></span><textarea name="intro" rows="4" maxlength="4000">${h(c.intro || '')}</textarea></label>
        <label class="check"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> Open (people can join from the sales page)</label>
        ${c.active ? linkbox(c.link) : ''}
        <div class="row"><button class="btn primary">Save course</button><button class="btn ghost danger" type="button" data-del-course>Delete course</button><span class="muted" id="course-msg"></span></div></form>
      <div class="card-box"><div class="row" style="justify-content:space-between"><h2>Lessons</h2><button class="btn primary" data-add-lesson>+ Add a lesson</button></div>
        ${c.lessons.length ? `<ol class="lesson-list">${c.lessons.map((l, i) => `<li data-lesson="${l.id}"><span class="lesson-n">${i + 1}</span><div class="lesson-t"><b>${h(l.title)}</b><span class="muted small">${l.video_file ? 'Your video' : l.video_url ? (/youtu|vimeo/.test(l.video_url) ? 'Video link' : 'Link') : 'Text only'}${l.body ? ' · notes' : ''}</span></div>
          <button class="btn ghost icon" data-up ${i ? '' : 'disabled'} aria-label="Move up">${svg('up')}</button><button class="btn ghost icon" data-down ${i < c.lessons.length - 1 ? '' : 'disabled'} aria-label="Move down">${svg('down')}</button>
          <button class="btn" data-edit-lesson>Edit</button><button class="btn ghost icon danger" data-del-lesson aria-label="Delete lesson">${svg('trash')}</button></li>`).join('')}</ol>`
          : '<p class="muted">No lessons yet. Press <b>+ Add a lesson</b>.</p>'}</div>
      <div class="card-box" id="course-talk"></div>
      <div class="card-box"><div class="row" style="justify-content:space-between"><h2>Members (${c.members.length})</h2></div>
        <form id="member-form" class="row"><input name="who" list="course-people" placeholder="Give someone this course: type a name" autocomplete="off" style="flex:1;min-width:200px"><datalist id="course-people"></datalist><button class="btn">Give access</button></form>
        ${c.members.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>How</th><th>Progress</th><th></th></tr></thead><tbody>${c.members.map((m) => `<tr data-member="${m.id}"><td><b>${h(m.name)}</b><br><span class="muted small">${h(m.email || '')}</span></td><td>${h(m.via || '')}</td>
          <td><div class="mini-prog"><i style="width:${done(m)}%"></i></div><span class="muted small">${m.done} of ${c.lessons.length}</span></td><td class="pay-act"><button class="btn ghost" data-portal>Their link</button><button class="btn ghost danger" data-remove>Remove</button></td></tr>`).join('')}</tbody></table></div>`
          : '<p class="muted">Nobody yet. Share the sales page, or give someone access above.</p>'}</div></div>`;
    const reload = () => courseEditor(root, id);
    if (window.VTExtra3) window.VTExtra3.communityBox(q$('#course-talk', root), id, ((window.VTHome && window.VTHome.list && window.VTHome.list()) || []).find((b) => b.id === c.business_id)?.name).catch(() => {});
    const f = q$('#course-form', root);
    f.onsubmit = async (e) => {
      e.preventDefault();
      try { await call(`/courses/${id}`, { method: 'PUT', json: { title: f.title.value, price: f.price.value, slug: f.slug.value, intro: f.intro.value, active: f.active.checked } }); say('Course saved.'); reload(); }
      catch (err) { q$('#course-msg', root).textContent = err.message; }
    };
    const mf = q$('#member-form', root);
    let people = null;
    mf.who.onfocus = async () => { if (people) return; people = await call('/contacts?lite=1'); q$('#course-people', root).innerHTML = people.map((p) => `<option value="${h(p.name)}">${h(p.email || '')}</option>`).join(''); };
    mf.onsubmit = async (e) => {
      e.preventDefault();
      people ||= await call('/contacts?lite=1');
      const p = people.find((x) => x.name.toLowerCase() === mf.who.value.trim().toLowerCase());
      if (!p) return say('Pick someone from the list (add them on People first if they are new).', true);
      try { const r = await call(`/courses/${id}/members`, { method: 'POST', json: { contact_id: p.id } }); say(r.emailed ? `${p.name} is in. We emailed their link.` : `${p.name} is in. Press "Their link" to send it.`); reload(); }
      catch (err) { say(err.message, true); }
    };
    root.onclick = async (e) => {
      if (onCopy(e)) return;
      if (e.target.closest('[data-back]')) { courseOpen = null; return renderCourses(); }
      if (e.target.closest('[data-del-course]')) { if (confirm(`Delete "${c.title}" and all its lessons? Members lose access.`)) { await call(`/courses/${id}`, { method: 'DELETE' }); courseOpen = null; say('Course deleted.'); renderCourses(); } return; }
      if (e.target.closest('[data-add-lesson]')) return editLesson(c, null, reload);
      const li = e.target.closest('[data-lesson]');
      if (li) {
        const lid = Number(li.dataset.lesson), ids = c.lessons.map((l) => l.id), i = ids.indexOf(lid);
        if (e.target.closest('[data-edit-lesson]')) return editLesson(c, c.lessons[i], reload);
        if (e.target.closest('[data-del-lesson]')) { if (confirm(`Delete the lesson "${c.lessons[i].title}"?`)) { await call(`/courses/${id}/lessons/${lid}`, { method: 'DELETE' }); reload(); } return; }
        const dir = e.target.closest('[data-up]') ? -1 : e.target.closest('[data-down]') ? 1 : 0;
        if (dir) { [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]]; await call(`/courses/${id}/order`, { method: 'POST', json: { ids } }); reload(); }
        return;
      }
      const m = e.target.closest('[data-member]');
      if (m) {
        const mem = c.members.find((x) => x.id === Number(m.dataset.member));
        if (e.target.closest('[data-portal]')) return portalLink(mem.id, mem.name);
        if (e.target.closest('[data-remove]') && confirm(`Remove ${mem.name} from this course?`)) { await call(`/courses/${id}/members/${mem.id}`, { method: 'DELETE' }); reload(); }
      }
    };
  }
  function editLesson(c, l, done) {
    const d = dlg();
    let file = l ? l.video_file : null;
    d.innerHTML = `<form id="lesson-form"><h1>${l ? 'Edit lesson' : 'New lesson'}</h1>
      <label class="field"><span>Lesson name</span><input name="title" required maxlength="160" value="${h(l ? l.title : '')}" placeholder="Welcome, Step 1..."></label>
      <label class="field"><span>Video link <small class="muted">(YouTube or Vimeo. Tip: on YouTube pick Unlisted so only members find it)</small></span><input name="video_url" placeholder="https://youtu.be/..." value="${h(l ? l.video_url || '' : '')}"></label>
      <div class="field"><span>Or upload your own video <small class="muted">(MP4 or MOV, saved on your Mac, only members can watch)</small></span>
        <div class="row"><input type="file" id="lesson-file" accept="video/mp4,video/quicktime,video/x-m4v,video/webm"><span class="muted small" id="lesson-file-msg">${file ? 'A video is uploaded. <button type="button" class="linkish" data-rm-file>Remove it</button>' : ''}</span></div>
        <progress id="lesson-prog" max="100" value="0" hidden></progress></div>
      <label class="field"><span>Notes for this lesson <small class="muted">(optional, links work)</small></span><textarea name="body" rows="6" maxlength="20000">${h(l ? l.body || '' : '')}</textarea></label>
      <div class="row"><button class="btn primary">Save lesson</button><button class="btn ghost" type="button" data-close>Cancel</button></div>
      <p class="muted" id="lesson-msg"></p></form>`;
    if (!d.open) d.showModal();
    const f = q$('#lesson-form', d), msg = (t) => { q$('#lesson-msg', d).textContent = t; };
    let uploading = false;
    q$('#lesson-file', d).onchange = (e) => {
      const fl = e.target.files[0];
      if (!fl) return;
      uploading = true; msg('');
      const prog = q$('#lesson-prog', d); prog.hidden = false;
      const x = new XMLHttpRequest();
      const b = store.get('biz', '');
      x.open('POST', `/api/crm/courses/upload${b ? `?biz=${encodeURIComponent(b)}` : ''}`);
      x.setRequestHeader('Content-Type', fl.type || 'video/mp4');
      x.upload.onprogress = (ev) => { if (ev.lengthComputable) prog.value = Math.round((ev.loaded / ev.total) * 100); };
      x.onload = () => {
        uploading = false; prog.hidden = true;
        let r = {}; try { r = JSON.parse(x.responseText); } catch { /* fine */ }
        if (x.status >= 400) return msg(r.error || 'Upload failed.');
        file = r.file; q$('#lesson-file-msg', d).textContent = 'Video uploaded. Press Save lesson.';
      };
      x.onerror = () => { uploading = false; prog.hidden = true; msg('Upload failed. Check the connection and try again.'); };
      x.send(fl);
    };
    f.onclick = (e) => {
      if (e.target.closest('[data-close]')) d.close();
      if (e.target.closest('[data-rm-file]')) { file = null; q$('#lesson-file-msg', d).textContent = 'Video removed. Press Save lesson.'; }
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (uploading) return msg('Wait for the video to finish uploading.');
      const body = { title: f.title.value, video_url: f.video_url.value, video_file: file, body: f.body.value };
      try { await call(l ? `/courses/${c.id}/lessons/${l.id}` : `/courses/${c.id}/lessons`, { method: l ? 'PUT' : 'POST', json: body }); d.close(); say('Lesson saved.'); done(); }
      catch (err) { msg(err.message); }
    };
  }

  window.VTExtra2 = { chatSettings, renderProducts, editProduct, productButton, portalLink, renderCourses, resetCourses: () => { courseOpen = null; } };
})();
