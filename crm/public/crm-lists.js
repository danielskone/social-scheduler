// Viral Touch CRM: smart lists (saved searches shown as chips above People) and bulk actions
// (tick people, then tag, move, set a follow-up, add a note or task, export or delete them at once).
// Loaded before crm.js; crm.js calls VTLists.params() and VTLists.after(rows) from renderList.
(() => {
  const q$ = (s, el = document) => el.querySelector(s);
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(`vtcrm-${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`vtcrm-${k}`, JSON.stringify(v)); } catch { /* fine */ } },
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
  const SHOW = { email_ok: 'Said yes to email', no_email: 'No email address', has_phone: 'Has a phone number', new30: 'Added in the last 30 days',
    quiet60: 'Quiet for 60+ days', no_follow_up: 'No follow-up date', dnc: 'Do not contact' };

  let rows = [], lists = [], active = null, rerender = () => {};
  const selected = new Set();
  const current = () => {
    const f = {};
    const v = (s) => (q$(s) ? q$(s).value.trim() : '');
    if (v('#crm-q')) f.q = v('#crm-q');
    if (v('#crm-group')) f.group = v('#crm-group');
    if (v('#crm-stage')) f.stage = v('#crm-stage');
    if (q$('#crm-due') && q$('#crm-due').checked) f.due = '1';
    if (v('#crm-tag')) f.tag = v('#crm-tag');
    if (v('#crm-show')) f.show = v('#crm-show');
    return f;
  };
  const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  function setFilters(f = {}) {
    q$('#crm-q').value = f.q || '';
    for (const [sel, k] of [['#crm-group', 'group'], ['#crm-stage', 'stage'], ['#crm-tag', 'tag'], ['#crm-show', 'show']]) {
      const el = q$(sel);
      if (f[k] && ![...el.options].some((o) => o.value === f[k])) el.insertAdjacentHTML('beforeend', `<option value="${h(f[k])}">${h(f[k])}</option>`);
      el.value = f[k] || '';
    }
    q$('#crm-due').checked = Boolean(f.due);
  }
  const params = () => new URLSearchParams(current()).toString();

  async function loadLists() {
    let d;
    try { d = await call('/lists'); } catch { return; }
    lists = d.lists;
    const tagSel = q$('#crm-tag'), cur = tagSel.value;
    tagSel.innerHTML = `<option value="">All tags</option>${d.tags.map((t) => `<option value="${h(t.name)}">${h(t.name)} (${t.count})</option>`).join('')}`;
    if (cur && ![...tagSel.options].some((o) => o.value === cur)) tagSel.insertAdjacentHTML('beforeend', `<option value="${h(cur)}">${h(cur)}</option>`);
    tagSel.value = cur;
    tagSel.hidden = !d.tags.length && !cur;
    drawChips();
  }
  function drawChips() {
    const f = current(), on = Object.keys(f).length > 0;
    const match = lists.find((l) => same(l.filters, f));
    active = match ? match.id : null;
    q$('#crm-lists').innerHTML = `<button type="button" class="sl-chip${on ? '' : ' on'}" data-sl="all">Everyone</button>
      ${lists.map((l) => `<span class="sl-chip${l.id === active ? ' on' : ''}"><button type="button" data-sl="${l.id}">${h(l.name)} <small>${l.count}</small></button>${l.id === active ? `<button type="button" class="sl-x" data-sl-edit="${l.id}" aria-label="Rename or delete ${h(l.name)}" title="Rename or delete">⋯</button>` : ''}</span>`).join('')}
      ${on && !match ? '<button type="button" class="sl-chip sl-save" data-sl-save>+ Save as smart list</button>' : ''}`;
  }
  q$('#crm-lists') && (q$('#crm-lists').onclick = async (e) => {
    const pick = e.target.closest('[data-sl]');
    if (pick) {
      const l = lists.find((x) => x.id === Number(pick.dataset.sl));
      setFilters(l ? l.filters : {});
      selected.clear();
      return rerender();
    }
    if (e.target.closest('[data-sl-save]')) {
      const f = current();
      const guess = [f.tag, f.show && SHOW[f.show], f.group, f.stage, f.q && `"${f.q}"`, f.due && 'Follow-ups due'].filter(Boolean).join(', ');
      const name = prompt('Name this smart list. It always shows everyone who matches, so new people join it by themselves.', guess.slice(0, 60));
      if (!name) return;
      try { await call('/lists', { method: 'POST', json: { name, filters: f } }); say(`Saved "${name}".`); loadLists(); } catch (err) { say(err.message, true); }
      return;
    }
    const ed = e.target.closest('[data-sl-edit]');
    if (ed) {
      const l = lists.find((x) => x.id === Number(ed.dataset.slEdit));
      const name = prompt('Rename the list. To delete it, clear the name and press OK.', l.name);
      if (name === null) return;
      try {
        if (name.trim()) await call(`/lists/${l.id}`, { method: 'PUT', json: { name } });
        else if (confirm(`Delete the smart list "${l.name}"? Nobody is deleted, only the saved list.`)) await call(`/lists/${l.id}`, { method: 'DELETE' });
        loadLists();
      } catch (err) { say(err.message, true); }
    }
  });

  // ---------- Picking people and bulk actions ----------
  function after(newRows, { render } = {}) {
    rows = newRows;
    if (render) rerender = render;
    const ids = new Set(rows.map((r) => r.id));
    [...selected].forEach((i) => { if (!ids.has(i)) selected.delete(i); });
    document.querySelectorAll('#crm-table [data-sel]').forEach((x) => { x.checked = selected.has(Number(x.closest('tr').dataset.id)); });
    drawBar();
    loadLists();
  }
  function drawBar() {
    const all = q$('#crm-all');
    if (all) { all.checked = rows.length > 0 && selected.size === rows.length; all.indeterminate = selected.size > 0 && selected.size < rows.length; }
    document.querySelectorAll('#crm-table tr[data-id]').forEach((tr) => tr.classList.toggle('picked', selected.has(Number(tr.dataset.id))));
    const bar = q$('#crm-bulk');
    bar.hidden = !selected.size;
    if (!selected.size) return;
    bar.innerHTML = `<div class="bulk-n"><b>${selected.size}</b> picked${selected.size < rows.length ? ` <button type="button" class="linkish" data-b="all">Pick all ${rows.length}</button>` : ''}</div>
      <div class="bulk-acts">${[['tag_add', 'Add tag'], ['tag_remove', 'Remove tag'], ['group', 'Move to group'], ['stage', 'Change step'], ['follow_up', 'Follow-up date'],
        ['note', 'Add note'], ['task', 'Add task'], ['dnc', 'Do not contact'], ['export', 'Export'], ['delete', 'Delete']].map(([a, l]) => `<button type="button" class="btn${a === 'delete' ? ' ghost danger' : ' ghost'}" data-b="${a}">${l}</button>`).join('')}
      <button type="button" class="btn ghost" data-b="clear" aria-label="Clear picks">✕</button></div>`;
  }
  document.addEventListener('change', (e) => {
    if (e.target.id === 'crm-all') { if (e.target.checked) rows.forEach((r) => selected.add(r.id)); else selected.clear(); after(rows); return; }
    if (e.target.matches('#crm-table [data-sel]')) {
      const id = Number(e.target.closest('tr').dataset.id);
      if (e.target.checked) selected.add(id); else selected.delete(id);
      drawBar();
    }
  });
  const opts = (sel) => [...q$(sel).options].map((o) => o.value).filter(Boolean);
  function ask(action) {
    const n = selected.size, who = `${n} ${n === 1 ? 'person' : 'people'}`;
    const d = q$('#crm-edit-dialog');
    d.classList.remove('wide');
    const tags = [...q$('#crm-tag').options].map((o) => o.value).filter(Boolean);
    const body = {
      tag_add: [`Add a tag to ${who}`, `<label class="field"><span>Tag</span><input name="value" list="bulk-tags" required maxlength="30" placeholder="VIP, 2026 sponsor..." style="width:100%"><datalist id="bulk-tags">${tags.map((t) => `<option value="${h(t)}">`).join('')}</datalist></label>`],
      tag_remove: [`Remove a tag from ${who}`, `<label class="field"><span>Tag</span><select name="value" required>${tags.map((t) => `<option>${h(t)}</option>`).join('')}</select></label>`],
      group: [`Move ${who} to a group`, `<label class="field"><span>Group</span><input name="value" list="bulk-groups" required style="width:100%"><datalist id="bulk-groups">${opts('#crm-group').map((g) => `<option value="${h(g)}">`).join('')}</datalist></label>`],
      stage: [`Move ${who} to a step`, `<label class="field"><span>Step</span><select name="value" required>${opts('#crm-stage').map((s) => `<option>${h(s)}</option>`).join('')}</select></label><p class="muted small">People in a pipeline without this step stay where they are.</p>`],
      follow_up: [`Follow-up date for ${who}`, '<label class="field"><span>Date <small>(leave empty to clear it)</small></span><input type="date" name="value"></label>'],
      note: [`Add a note to ${who}`, '<label class="field"><span>Note</span><textarea name="value" rows="3" required maxlength="500" style="width:100%"></textarea></label>'],
      task: [`Add a task for each of ${who}`, '<label class="field"><span>Task</span><input name="value" required maxlength="200" placeholder="Call to say thank you" style="width:100%"></label><label class="field"><span>Due <small>(optional)</small></span><input type="date" name="due"></label>'],
      dnc: [`Mark ${who} "Do not contact"?`, '<p>They are taken off your email list and automations stop messaging them. You can undo it on each person\'s card.</p>'],
      delete: [`Delete ${who}?`, `<p>This deletes them and all their notes and history. It can't be undone. Tip: press <b>Export</b> first to keep a copy.</p><label class="field"><span>Type DELETE to confirm</span><input name="confirm" required autocomplete="off" autocapitalize="characters"></label>`],
    }[action];
    d.innerHTML = `<form id="bulk-form"><h1>${body[0]}</h1>${body[1]}<div class="row"><button class="btn ${action === 'delete' ? 'danger' : 'primary'}">${action === 'delete' ? 'Delete' : 'Apply'}</button><button class="btn ghost" type="button" data-close>Cancel</button></div><p class="muted" id="bulk-msg"></p></form>`;
    q$('[data-close]', d).onclick = () => d.close();
    q$('#bulk-form', d).onsubmit = async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      try {
        const r = await call(`/lists/bulk/${action}`, { method: 'POST', json: { ...data, ids: [...selected] } });
        d.close();
        say(action === 'delete' ? `Deleted ${r.done}.` : `Done for ${r.done}${r.skipped ? `. Skipped ${r.skipped}.` : '.'}`);
        if (action === 'delete') selected.clear();
        rerender();
      } catch (err) { q$('#bulk-msg', d).textContent = err.message; }
    };
    d.showModal();
    const first = q$('input,select,textarea', d);
    if (first) first.focus();
  }
  q$('#crm-bulk') && (q$('#crm-bulk').onclick = async (e) => {
    const b = e.target.closest('[data-b]');
    if (!b) return;
    const a = b.dataset.b;
    if (a === 'clear') { selected.clear(); return after(rows); }
    if (a === 'all') { rows.forEach((r) => selected.add(r.id)); return after(rows); }
    if (a === 'tag_remove' && ![...q$('#crm-tag').options].some((o) => o.value)) return say('Nobody has a tag yet.', true);
    if (a === 'export') {
      try {
        const r = await call('/lists/bulk/export', { method: 'POST', json: { ids: [...selected] } });
        const url = URL.createObjectURL(new Blob([`﻿${r.csv}`], { type: 'text/csv;charset=utf-8' }));
        const link = Object.assign(document.createElement('a'), { href: url, download: `people-${new Date().toISOString().slice(0, 10)}.csv` });
        document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      } catch (err) { say(err.message, true); }
      return;
    }
    ask(a);
  });

  window.VTLists = { params, after, setFilters, SHOW };
})();
