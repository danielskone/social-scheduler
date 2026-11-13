// Viral Touch CRM: Backups and Activity history (Settings), and Find duplicates (People).
(() => {
  const q$ = (s, el = document) => el.querySelector(s);
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const biz = () => { try { return JSON.parse(localStorage.getItem('vtcrm-biz') || '""'); } catch { return ''; } };
  async function call(path, opts = {}) {
    if (opts.json) { opts.body = JSON.stringify(opts.json); opts.headers = { 'Content-Type': 'application/json' }; delete opts.json; }
    const b = opts.biz ? biz() : '';
    const url = `/api/crm${path}`;
    const res = await fetch(b ? `${url}${url.includes('?') ? '&' : '?'}biz=${encodeURIComponent(b)}` : url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  const say = (msg, err) => { const el = q$('#banner'); el.textContent = msg; el.className = `banner${err ? ' error' : ''}`; el.hidden = !msg; if (msg && !err) setTimeout(() => { if (el.textContent === msg) el.hidden = true; }, 5000); };
  const admin = () => (window.VTMore && window.VTMore.isAdmin ? window.VTMore.isAdmin() : true);
  const dlg = () => { const d = q$('#crm-edit-dialog'); d.classList.remove('wide'); d.onclick = null; return d; };
  const size = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
  const when = (iso) => new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const KIND_COLOR = { Nightly: '#0d9488', 'Made by you': '#4f46e5', 'Before a restore': '#d97706', 'Loaded from a file': '#64748b' };

  // ======================= Backups (Settings) =======================
  async function backupsSection(box) {
    if (!box) return;
    if (!admin()) { box.innerHTML = ''; return; }
    const { backups, keep } = await call('/backups');
    box.innerHTML = `<div class="set-head" style="margin-top:26px"><div><h2>Backups</h2><p class="muted">Every night at 2:30 AM a full copy of the CRM is saved on this Mac. The last ${keep} nights are kept.
        Press <b>File</b> to download one and keep it somewhere safe, like iCloud Drive or a USB stick. <b>Put back</b> only changes the CRM. Your Viral Post posts stay as they are.</p></div>
        <div class="row"><button class="btn" type="button" data-up>Load a backup file</button><button class="btn primary" type="button" data-make>Make a backup now</button></div></div>
      <input type="file" id="bk-file" accept=".db" hidden>
      <div class="set-list bk-list">${backups.length ? backups.slice(0, 25).map((b) => `<div class="set-biz bk-row" data-name="${h(b.name)}">
          <div class="set-info"><b>${h(when(b.at))}</b> <span class="pay-pill" style="--c:${KIND_COLOR[b.kind] || '#64748b'}">${h(b.kind)}</span><span class="muted small">${size(b.size)}</span></div>
          <a class="btn ghost" href="/api/crm/backups/${encodeURIComponent(b.name)}/download" download>File</a>
          <button class="btn ghost" type="button" data-del aria-label="Delete backup">×</button>
          <button class="btn" type="button" data-restore>Put back</button></div>`).join('') : '<p class="muted">No backups yet. The first one is made tonight, or press Make a backup now.</p>'}</div>`;
    box.onclick = async (e) => {
      if (e.target.closest('[data-make]')) {
        e.target.closest('button').disabled = true;
        try { await call('/backups', { method: 'POST' }); say('Backup saved.'); } catch (err) { say(err.message, true); }
        return backupsSection(box);
      }
      if (e.target.closest('[data-up]')) return q$('#bk-file', box).click();
      const row = e.target.closest('[data-name]');
      if (!row) return;
      const name = row.dataset.name;
      if (e.target.closest('[data-del]')) {
        if (!confirm('Delete this backup? It cannot be undone.')) return;
        try { await call(`/backups/${encodeURIComponent(name)}`, { method: 'DELETE' }); } catch (err) { say(err.message, true); }
        return backupsSection(box);
      }
      if (e.target.closest('[data-restore]')) confirmRestore(name, row.querySelector('b').textContent, box);
    };
    q$('#bk-file', box).onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      say('Loading the file...');
      try {
        const r = await fetch('/api/crm/backups/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'That file could not be loaded.');
        say(`Loaded. It has ${data.people} people. Press Put back on it to use it.`);
        backupsSection(box);
      } catch (err) { say(err.message, true); }
    };
  }
  async function confirmRestore(name, label, box) {
    const d = dlg();
    d.innerHTML = '<p class="muted">Checking the backup...</p>';
    if (!d.open) d.showModal();
    let info;
    try { info = await call(`/backups/${encodeURIComponent(name)}/check`); } catch (err) { d.innerHTML = `<p>${h(err.message)}</p><div class="row"><button class="btn" data-close>Close</button></div>`; q$('[data-close]', d).onclick = () => d.close(); return; }
    d.innerHTML = `<form id="bk-restore"><h1>Put back the backup from ${h(label)}?</h1>
      <p>It has <b>${info.people}</b> people, <b>${info.tasks}</b> tasks, <b>${info.invoices}</b> invoices and <b>${info.appointments}</b> appointments.</p>
      <p class="muted">Everything in the CRM goes back to how it was then, for every business. Changes made since then are replaced. Your Viral Post posts and accounts are not changed.</p>
      <p class="muted">Before it starts, a copy of how things are right now is saved, so you can undo this.</p>
      <label class="field"><span>Type PUT BACK to confirm</span><input name="confirm" required autocomplete="off" autocapitalize="characters"></label>
      <div class="row"><button class="btn primary">Put it back</button><button class="btn ghost" type="button" data-close>Cancel</button><span class="muted" id="bk-msg"></span></div></form>`;
    q$('[data-close]', d).onclick = () => d.close();
    q$('#bk-restore', d).onsubmit = async (e) => {
      e.preventDefault();
      if (e.target.confirm.value.trim().toUpperCase() !== 'PUT BACK') { q$('#bk-msg', d).textContent = 'Type PUT BACK first.'; return; }
      e.submitter.disabled = true; q$('#bk-msg', d).textContent = 'Working...';
      try {
        await call(`/backups/${encodeURIComponent(name)}/restore`, { method: 'POST' });
        d.close(); say('Done. The backup is back. To undo it, put back the newest "Before a restore" copy.');
        backupsSection(box);
      } catch (err) { q$('#bk-msg', d).textContent = err.message; e.submitter.disabled = false; }
    };
  }

  // ======================= Activity history (Settings) =======================
  async function auditSection(box, opts = {}) {
    if (!box) return;
    if (!admin()) { box.innerHTML = ''; return; }
    const params = new URLSearchParams();
    if (opts.who) params.set('who', opts.who);
    if (opts.q) params.set('q', opts.q);
    params.set('limit', String(opts.limit || 50));
    const data = await call(`/audit?${params}`);
    const people = data.people.reduce((m, p) => { const k = p.member_id == null ? 'owner' : String(p.member_id); if (!m.some((x) => x[0] === k)) m.push([k, p.member_id == null ? 'You (owner)' : p.who]); return m; }, []);
    const day = (iso) => new Date(`${iso.replace(' ', 'T')}Z`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    let last = '';
    const rows = data.rows.map((r) => {
      const d = day(r.at), head = d !== last ? `<div class="au-day">${h(d)}</div>` : '';
      last = d;
      const t = new Date(`${r.at.replace(' ', 'T')}Z`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return `${head}<div class="au-row"><span class="au-time muted small">${h(t)}</span><span class="au-who">${h(r.member_id == null ? 'You' : r.who)}</span><span class="au-what">${h(r.action)}${r.detail ? `: <b>${h(r.detail)}</b>` : ''}</span></div>`;
    }).join('');
    box.innerHTML = `<div class="set-head" style="margin-top:26px"><div><h2>Activity history</h2><p class="muted">Who changed what, and when. Only you and admins can see this. Kept for 6 months.</p></div></div>
      <div class="row au-filters"><select id="au-who" aria-label="Who"><option value="">Everyone</option>${people.map(([k, n]) => `<option value="${h(k)}"${opts.who === k ? ' selected' : ''}>${h(n)}</option>`).join('')}</select>
        <input id="au-q" type="search" placeholder="Search, like invoice or a name" value="${h(opts.q || '')}" aria-label="Search the history"></div>
      <div class="au-list">${rows || '<p class="muted">Nothing yet. Changes show up here as soon as anyone makes them.</p>'}</div>
      ${data.more ? '<button class="btn ghost" type="button" data-more style="margin-top:10px">Show more</button>' : ''}`;
    q$('#au-who', box).onchange = (e) => auditSection(box, { ...opts, who: e.target.value, limit: 50 });
    let tm;
    q$('#au-q', box).oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => auditSection(box, { ...opts, q: e.target.value, limit: 50 }).then(() => { const i = q$('#au-q', box); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 350); };
    const more = q$('[data-more]', box);
    if (more) more.onclick = () => auditSection(box, { ...opts, limit: (opts.limit || 50) + 100 });
  }

  // ======================= Find duplicates (People) =======================
  async function findDuplicates(after) {
    const d = dlg();
    d.classList.add('wide');
    d.innerHTML = '<p class="muted">Looking for people entered more than once...</p>';
    if (!d.open) d.showModal();
    const { groups } = await call('/duplicates', { biz: true });
    if (!groups.length) {
      d.innerHTML = '<h1>No duplicates found</h1><p class="muted">Nobody shares an email, a phone number or a full name. Nice and tidy.</p><div class="row"><button class="btn primary" data-close>Close</button></div>';
      q$('[data-close]', d).onclick = () => d.close();
      return;
    }
    const busy = (p) => [p.email, p.phone, p.company].filter(Boolean).map(h).join(' · ') || '<i>No email or phone</i>';
    d.innerHTML = `<h1>Find duplicates</h1>
      <p class="muted">These people look like the same person entered more than once. Pick the card to keep and press <b>Merge</b>. Notes, emails, deals, tasks, appointments and invoices all move onto the kept card, and its empty boxes are filled in from the others.</p>
      <div class="dup-list">${groups.map((g, i) => `<div class="dup-group" data-g="${i}">
        <div class="dup-why">${g.reasons.map((r) => `<span class="pay-pill" style="--c:#d97706">${h(r)}</span>`).join(' ')}</div>
        ${g.people.map((p, j) => `<label class="dup-person"><input type="radio" name="keep-${i}" value="${p.id}"${j === 0 ? ' checked' : ''}>
          <span><b>${h(p.name)}</b> <span class="muted small">${h(p.group_name || '')}${p.stage ? ` · ${h(p.stage)}` : ''}</span><br><span class="muted small">${busy(p)} · ${p.notes} ${p.notes === 1 ? 'note' : 'notes'} · added ${h(when(p.created_at))}</span></span></label>`).join('')}
        <div class="row"><button class="btn primary" type="button" data-merge>Merge into the picked card</button><button class="btn ghost" type="button" data-skip>Not the same person</button><span class="muted small" data-msg></span></div></div>`).join('')}</div>
      <div class="row" style="margin-top:12px"><button class="btn" type="button" data-close>Done</button></div>`;
    q$('[data-close]', d).onclick = () => { d.close(); if (after) after(); };
    d.onclick = async (e) => {
      const box = e.target.closest('[data-g]');
      if (!box) return;
      const g = groups[Number(box.dataset.g)], msg = q$('[data-msg]', box);
      const ids = g.people.map((p) => p.id);
      try {
        if (e.target.closest('[data-merge]')) {
          const keep = Number(q$('input[type=radio]:checked', box).value);
          const name = g.people.find((p) => p.id === keep).name;
          if (!confirm(`Merge ${ids.length - 1} other ${ids.length === 2 ? 'card' : 'cards'} into ${name}? This cannot be undone, but a nightly backup is kept.`)) return;
          await call('/duplicates/merge', { method: 'POST', json: { keep, merge: ids.filter((x) => x !== keep) } });
          box.innerHTML = `<p class="dup-done">Merged into <b>${h(name)}</b>.</p>`;
        } else if (e.target.closest('[data-skip]')) {
          await call('/duplicates/not-same', { method: 'POST', json: { ids } });
          box.innerHTML = '<p class="dup-done muted">Got it. These won\'t be shown again.</p>';
        }
      } catch (err) { if (msg) msg.textContent = err.message; }
    };
  }
  function hookPeople() {
    const btn = q$('#crm-dupes');
    if (!btn) return;
    btn.hidden = !admin();
    btn.onclick = () => findDuplicates(() => window.renderContacts && window.renderContacts('people')).catch((e) => say(e.message, true));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hookPeople); else hookPeople();
  setTimeout(hookPeople, 1500); // after sign-in info has loaded

  window.VTExtra8 = { backupsSection, auditSection, findDuplicates };
})();
