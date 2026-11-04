const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Small platform logos shown next to accounts and posts.
const ICONS = {
  facebook: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#1877F2"/><path d="M13.4 19.5v-6.2h2.1l.3-2.4h-2.4V9.4c0-.7.2-1.2 1.2-1.2h1.3V6.1c-.2 0-1-.1-1.9-.1-1.9 0-3.2 1.2-3.2 3.3v1.8H8.7v2.4h2.1v6.2z" fill="#fff"/></svg>',
  instagram: '<svg viewBox="0 0 24 24"><defs><linearGradient id="igg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FEDA75"/><stop offset=".35" stop-color="#FA7E1E"/><stop offset=".6" stop-color="#D62976"/><stop offset=".8" stop-color="#962FBF"/><stop offset="1" stop-color="#4F5BD5"/></linearGradient></defs><rect width="24" height="24" rx="6" fill="url(#igg)"/><rect x="5.5" y="5.5" width="13" height="13" rx="4" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="12" cy="12" r="3.1" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="16.1" cy="7.9" r="1" fill="#fff"/></svg>',
  youtube: '<svg viewBox="0 0 24 24"><rect y="4" width="24" height="16" rx="4.5" fill="#FF0000"/><path d="M9.8 8.4v7.2l6.2-3.6z" fill="#fff"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#000"/><path d="M15.6 5h-2.4v9.6a2.1 2.1 0 1 1-1.6-2v-2.5a4.5 4.5 0 1 0 4 4.5V9.6a5.6 5.6 0 0 0 3.2 1V8.2A3.2 3.2 0 0 1 15.6 5z" fill="#25F4EE" transform="translate(-.5 -.4)"/><path d="M15.6 5h-2.4v9.6a2.1 2.1 0 1 1-1.6-2v-2.5a4.5 4.5 0 1 0 4 4.5V9.6a5.6 5.6 0 0 0 3.2 1V8.2A3.2 3.2 0 0 1 15.6 5z" fill="#FE2C55" transform="translate(.5 .4)"/><path d="M15.6 5h-2.4v9.6a2.1 2.1 0 1 1-1.6-2v-2.5a4.5 4.5 0 1 0 4 4.5V9.6a5.6 5.6 0 0 0 3.2 1V8.2A3.2 3.2 0 0 1 15.6 5z" fill="#fff"/></svg>',
};
const NAMES = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' };
let iconN = 0; // each Instagram logo needs its own gradient id, or hidden copies break it
const icon = (pl) => `<span class="picon" title="${NAMES[pl] || pl}">${(ICONS[pl] || '').replace(/igg/g, `igg${++iconN}`)}</span>`;

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, opts);
  if (res.status === 401) { location.href = '/login.html'; throw new Error('Please sign in.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let accounts = [];
let calMonth = startOfMonth(new Date());

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function dayKey(d) { return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
function fmtTime(iso) { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function fmtDateTime(iso) { return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function overallStatus(post) {
  const s = post.targets.map((t) => t.status);
  if (s.includes('failed')) return 'failed';
  if (s.every((x) => x === 'published')) return 'published';
  return 'scheduled';
}

function banner(msg, isError = false) {
  const b = $('#banner');
  if (!msg) { b.hidden = true; return; }
  b.textContent = msg;
  b.className = `banner${isError ? ' error' : ''}`;
  b.hidden = false;
}

// ---------- Routing ----------
async function route() {
  const [view, query] = (location.hash.slice(1) || 'calendar').split('?');
  const params = new URLSearchParams(query);
  banner(params.get('error') ? `Couldn't connect: ${params.get('error')}` : params.get('connected') ? `Connected ${params.get('connected')} account(s).` : '', Boolean(params.get('error')));
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  accounts = await api('/accounts');
  if (view === 'calendar') renderCalendar();
  if (view === 'compose') renderCompose(params.get('date'));
  if (view === 'analytics') renderAnalytics();
  if (view === 'accounts') renderAccounts();
}
window.addEventListener('hashchange', route);

// ---------- Calendar ----------
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const isPhone = () => matchMedia('(max-width: 800px)').matches;
let calMode = (() => { try { return localStorage.getItem('calMode') || 'month'; } catch { return 'month'; } })();
let calWeek = startOfWeek(new Date());
function startOfWeek(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const platformsOf = (p) => [...new Set(p.targets.map((t) => t.platform))];
const label = (p) => p.title || p.caption || (p.media_type === 'video' ? 'Video' : 'Photo');
const thumb = (p, cls) => (p.media_type && p.media_url
  ? (p.media_type === 'video'
    ? `<span class="${cls} vid"><video src="${p.media_url}#t=0.5" muted playsinline preload="metadata"></video></span>`
    : `<span class="${cls}"><img src="${p.media_url}" alt="" loading="lazy"></span>`)
  : `<span class="${cls} none">${p.media_type === 'video' ? '▶' : 'Aa'}</span>`);
const STATUS_WORD = { scheduled: 'Scheduled', published: 'Posted', failed: 'Needs attention' };

$('#cal-weekdays').innerHTML = WEEKDAYS.map((d) => `<div>${d}</div>`).join('');
$('#cal-prev').onclick = () => { if (mode() === 'week') calWeek = addDays(calWeek, -7); else calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCalendar(); };
$('#cal-next').onclick = () => { if (mode() === 'week') calWeek = addDays(calWeek, 7); else calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCalendar(); };
$('#cal-today').onclick = () => { calMonth = startOfMonth(new Date()); calWeek = startOfWeek(new Date()); renderCalendar(); };
$('#cal-mode').onclick = (e) => {
  const b = e.target.closest('button[data-mode]');
  if (!b) return;
  calMode = b.dataset.mode;
  try { localStorage.setItem('calMode', calMode); } catch { /* private mode */ }
  if (calMode === 'week') calWeek = startOfWeek(calMonth.getMonth() === new Date().getMonth() ? new Date() : calMonth);
  renderCalendar();
};
// On iPhone the month grid is too small to read, so it shows the list instead.
function mode() { return isPhone() && calMode === 'month' ? 'list' : calMode; }

async function renderOverview() {
  const now = new Date();
  const [upcoming, recent] = await Promise.all([
    api(`/posts?from=${now.toISOString()}&to=${addDays(now, 7).toISOString()}`),
    api(`/posts?from=${addDays(now, -30).toISOString()}&to=${now.toISOString()}`),
  ]);
  const next = upcoming.filter((p) => overallStatus(p) === 'scheduled').sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0];
  const failed = recent.filter((p) => overallStatus(p) === 'failed');
  const posted = recent.filter((p) => overallStatus(p) === 'published').length;
  const perPlatform = {};
  upcoming.forEach((p) => platformsOf(p).forEach((pl) => (perPlatform[pl] = (perPlatform[pl] || 0) + 1)));
  const until = (iso) => {
    const m = Math.round((new Date(iso) - now) / 60000);
    if (m < 60) return `in ${Math.max(m, 1)} min`;
    if (m < 24 * 60) return `in ${Math.round(m / 60)} h`;
    return new Date(iso).toLocaleDateString([], { weekday: 'long' });
  };
  $('#cal-overview').innerHTML = `
    ${next ? `<button class="ov-card ov-next" data-id="${next.id}">
      ${thumb(next, 'ov-thumb')}
      <span class="ov-body"><span class="ov-label">Up next · ${until(next.scheduled_at)}</span>
        <b class="ov-title">${esc(label(next))}</b>
        <span class="ov-meta">${fmtTime(next.scheduled_at)} <span class="ov-icons">${platformsOf(next).map(icon).join('')}</span></span></span>
    </button>` : `<div class="ov-card ov-next empty-next"><span class="ov-body"><span class="ov-label">Up next</span><b class="ov-title">Nothing scheduled this week</b><a href="#compose">+ New post</a></span></div>`}
    <div class="ov-card"><span class="ov-label">Next 7 days</span><b class="ov-num">${upcoming.length}</b>
      <span class="ov-icons wide">${Object.entries(perPlatform).map(([pl, n]) => `<span class="ov-pl">${icon(pl)}${n}</span>`).join('') || '<span class="muted">No posts</span>'}</span></div>
    <div class="ov-card"><span class="ov-label">Posted · last 30 days</span><b class="ov-num ok">${posted}</b><span class="muted small">Published everywhere</span></div>
    <button class="ov-card ${failed.length ? 'bad' : ''}" id="ov-failed" ${failed.length ? `data-id="${failed[0].id}"` : 'disabled'}>
      <span class="ov-label">Needs attention</span><b class="ov-num ${failed.length ? 'bad' : ''}">${failed.length}</b>
      <span class="muted small">${failed.length ? 'Tap to see the first one' : 'All good ✓'}</span></button>`;
  $('#cal-overview').onclick = (e) => { const c = e.target.closest('[data-id]'); if (c) openPost(c.dataset.id); };
}

function postCard(p) {
  const st = overallStatus(p);
  return `<button class="pcard ${st}" data-id="${p.id}">
    ${thumb(p, 'pc-thumb')}
    <span class="pc-body">
      <span class="pc-top"><b>${fmtTime(p.scheduled_at)}</b><span class="pc-icons">${platformsOf(p).map(icon).join('')}</span></span>
      <span class="pc-text">${esc(label(p))}</span>
      <span class="status ${st}">${STATUS_WORD[st]}</span>
    </span></button>`;
}

async function renderCalendar() {
  const m = mode();
  document.querySelectorAll('#cal-mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === (m === 'list' && isPhone() && calMode === 'month' ? 'month' : m)));
  $('#view-calendar').dataset.mode = m;
  renderOverview().catch(() => {});
  const today = dayKey(new Date());

  if (m === 'week') {
    const from = calWeek, to = addDays(calWeek, 7);
    const sameMonth = from.getMonth() === addDays(to, -1).getMonth();
    $('#cal-title').textContent = `${from.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${addDays(to, -1).toLocaleDateString([], sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}`;
    const posts = (await api(`/posts?from=${from.toISOString()}&to=${to.toISOString()}`)).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    const byDay = {};
    posts.forEach((p) => (byDay[dayKey(new Date(p.scheduled_at))] ||= []).push(p));
    $('#cal-week').innerHTML = [...Array(7)].map((_, i) => {
      const d = addDays(from, i);
      const list = byDay[dayKey(d)] || [];
      return `<div class="wk-col ${dayKey(d) === today ? 'today' : ''}">
        <div class="wk-head"><span>${d.toLocaleDateString([], { weekday: 'short' })}</span><b>${d.getDate()}</b><small>${list.length ? `${list.length} post${list.length > 1 ? 's' : ''}` : ''}</small></div>
        <div class="wk-list">${list.map(postCard).join('')}
          <a class="wk-add" href="#compose?date=${encodeURIComponent(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10).toISOString())}">+ Add</a></div>
      </div>`;
    }).join('');
    $('#cal-week').onclick = (e) => { const c = e.target.closest('.pcard'); if (c) openPost(c.dataset.id); };
    return;
  }

  $('#cal-title').textContent = calMonth.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const first = new Date(calMonth);
  first.setDate(1 - ((first.getDay() + 6) % 7)); // back to Monday
  const last = addDays(first, 42);
  const posts = (await api(`/posts?from=${first.toISOString()}&to=${last.toISOString()}`)).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const byDay = {};
  posts.forEach((p) => (byDay[dayKey(new Date(p.scheduled_at))] ||= []).push(p));

  if (m === 'month') {
    const MAX = 6;
    let html = '';
    for (let i = 0; i < 42; i++) {
      const d = addDays(first, i);
      const items = byDay[dayKey(d)] || [];
      html += `<div class="day ${d.getMonth() !== calMonth.getMonth() ? 'other' : ''} ${dayKey(d) === today ? 'today' : ''}" data-date="${d.toISOString()}">
        <div class="day-head"><span class="num">${d.getDate()}</span>${items.length ? `<span class="day-count">${items.length}</span>` : ''}</div>
        ${items.slice(0, MAX).map((p) => `<div class="chip ${overallStatus(p)}" data-id="${p.id}">
          ${thumb(p, 'chip-thumb')}
          <span class="chip-body"><span class="chip-top"><b>${fmtTime(p.scheduled_at)}</b><span class="chip-icons">${platformsOf(p).map(icon).join('')}</span></span>
          <span class="text">${esc(label(p))}</span></span>
        </div>`).join('')}
        ${items.length > MAX ? `<button class="more" data-day="${d.toISOString()}">+${items.length - MAX} more</button>` : ''}
      </div>`;
    }
    $('#cal-days').innerHTML = html;
    $('#cal-days').onclick = (e) => {
      const chip = e.target.closest('.chip');
      if (chip) return openPost(chip.dataset.id);
      const more = e.target.closest('.more');
      if (more) { calMode = 'week'; calWeek = startOfWeek(new Date(more.dataset.day)); return renderCalendar(); }
      const day = e.target.closest('.day');
      if (day) location.hash = `compose?date=${encodeURIComponent(day.dataset.date)}`;
    };
    attachHoverPreview(posts);
    return;
  }

  // List: this month's days that have posts.
  const inMonth = posts.filter((p) => new Date(p.scheduled_at).getMonth() === calMonth.getMonth());
  const groups = {};
  inMonth.forEach((p) => (groups[dayKey(new Date(p.scheduled_at))] ||= []).push(p));
  $('#cal-agenda').innerHTML = Object.values(groups).map((list) => {
    const d = new Date(list[0].scheduled_at);
    return `<div class="ag-day${dayKey(d) === today ? ' today' : ''}">
      <div class="ag-date"><span>${d.toLocaleDateString([], { weekday: 'short' })}</span><b>${d.getDate()}</b></div>
      <div class="ag-list">${list.map(postCard).join('')}</div></div>`;
  }).join('') || '<p class="empty">No posts this month yet.<br><a class="btn primary" href="#compose">+ New post</a></p>';
  $('#cal-agenda').onclick = (e) => { const it = e.target.closest('.pcard'); if (it) openPost(it.dataset.id); };
}

// Mac: hovering a post in the month view shows a bigger preview with the full caption.
function attachHoverPreview(posts) {
  const tip = $('#hover-card');
  const byId = Object.fromEntries(posts.map((p) => [p.id, p]));
  let timer;
  $('#cal-days').onmouseover = (e) => {
    const chip = e.target.closest('.chip');
    clearTimeout(timer);
    if (!chip) { tip.hidden = true; return; }
    timer = setTimeout(() => {
      const p = byId[chip.dataset.id];
      if (!p) return;
      const st = overallStatus(p);
      tip.innerHTML = `${p.media_url ? (p.media_type === 'video' ? `<video src="${p.media_url}#t=0.5" muted playsinline preload="metadata"></video>` : `<img src="${p.media_url}" alt="">`) : ''}
        <div class="hc-body"><div class="hc-top"><b>${fmtDateTime(p.scheduled_at)}</b><span class="status ${st}">${STATUS_WORD[st]}</span></div>
        ${p.title ? `<b class="hc-title">${esc(p.title)}</b>` : ''}
        <p>${esc(p.caption || '')}</p>
        <div class="hc-targets">${p.targets.map((t) => `<span>${icon(t.platform)}${esc(t.account_name)}</span>`).join('')}</div></div>`;
      const r = chip.getBoundingClientRect();
      tip.hidden = false;
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let x = r.right + 10; if (x + w > innerWidth - 10) x = r.left - w - 10;
      let y = Math.min(Math.max(10, r.top - 20), innerHeight - h - 10);
      tip.style.left = `${Math.max(10, x)}px`; tip.style.top = `${y}px`;
    }, 250);
  };
  $('#cal-days').onmouseleave = () => { clearTimeout(timer); tip.hidden = true; };
}
addEventListener('scroll', () => { const t = $('#hover-card'); if (t) t.hidden = true; }, { passive: true });
let wasPhone = isPhone();
addEventListener('resize', () => { if (isPhone() !== wasPhone) { wasPhone = isPhone(); if (!$('#view-calendar').hidden) renderCalendar(); } });

async function openPost(id) {
  const p = await api(`/posts/${id}`);
  const editable = p.targets.every((t) => t.status === 'scheduled' || t.status === 'failed') && !p.targets.some((t) => t.status === 'published');
  const dlg = $('#post-dialog');
  dlg.innerHTML = `
    <h2 style="margin-top:0">${fmtDateTime(p.scheduled_at)}</h2>
    ${p.media_url ? (p.media_type === 'video' ? `<video src="${p.media_url}" controls></video>` : `<img src="${p.media_url}" alt="">`) : ''}
    ${editable && p.targets.some((t) => t.platform === 'youtube') ? `<p><input type="text" id="dlg-title" maxlength="100" placeholder="YouTube title (optional)" value="${esc(p.title || '')}"></p>` : (p.title ? `<p><b>${esc(p.title)}</b></p>` : '')}
    ${editable ? `<textarea id="dlg-caption" rows="5">${esc(p.caption)}</textarea>
      <p><input type="datetime-local" id="dlg-when" value="${toLocalInput(new Date(p.scheduled_at))}"></p>`
      : `<p style="white-space:pre-wrap">${esc(p.caption)}</p>`}
    ${p.targets.map((t) => `<div class="target">${icon(t.platform)}${esc(t.account_name)}
      <span class="status ${t.status}">${t.status}</span>
      ${t.permalink ? `<a href="${esc(t.permalink)}" target="_blank" rel="noopener">View</a>` : ''}
      ${t.error ? `<small class="muted">${esc(t.error)}</small>` : ''}</div>`).join('')}
    <div class="row" style="margin-top:16px">
      ${editable ? '<button class="btn primary" id="dlg-save">Save</button>' : ''}
      ${p.targets.some((t) => t.status === 'failed') ? '<button class="btn" id="dlg-retry">Retry failed</button>' : ''}
      <button class="btn danger" id="dlg-delete">Delete</button>
      <button class="btn ghost" id="dlg-close">Close</button>
    </div>`;
  dlg.showModal(); dlg.scrollTop = 0; document.activeElement?.blur();
  $('#dlg-close').onclick = () => dlg.close();
  $('#dlg-delete').onclick = async () => {
    const msg = p.targets.some((t) => t.status === 'published')
      ? 'Remove this from your calendar? (Anything already posted stays online.)' : 'Delete this scheduled post?';
    if (!confirm(msg)) return;
    await api(`/posts/${id}`, { method: 'DELETE' });
    dlg.close(); renderCalendar();
  };
  if ($('#dlg-save')) $('#dlg-save').onclick = async () => {
    try {
      await api(`/posts/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption: $('#dlg-caption').value, scheduledAt: new Date($('#dlg-when').value).toISOString(), ...($('#dlg-title') ? { title: $('#dlg-title').value } : {}) }) });
      dlg.close(); renderCalendar();
    } catch (e) { alert(e.message); }
  };
  if ($('#dlg-retry')) $('#dlg-retry').onclick = async () => {
    await api(`/posts/${id}/retry`, { method: 'POST' });
    dlg.close(); setTimeout(renderCalendar, 1500);
  };
}

// ---------- Compose ----------
const form = $('#compose-form');

function renderCompose(dateIso) {
  const box = $('#compose-accounts');
  box.innerHTML = accounts.length
    ? accounts.map((a) => `<label><input type="checkbox" name="accountIds" value="${a.id}" data-platform="${a.platform}"${accounts.length === 1 ? ' checked' : ''}>
        ${icon(a.platform)}${esc(a.username ? '@' + a.username : a.name)}</label>`).join('')
    : `<span class="muted">No accounts yet. <a href="#accounts">Connect one first.</a></span>`;
  let when = dateIso ? new Date(dateIso) : new Date(Date.now() + 3600e3);
  if (dateIso) when.setHours(9, 0, 0, 0);
  form.scheduledAt.value = toLocalInput(when);
  $('#compose-msg').textContent = '';
  updatePreview();
}

function updatePreview() {
  const caption = form.caption.value;
  $('#preview-caption').textContent = caption || 'Your caption will appear here.';
  const checked = [...form.querySelectorAll('[name=accountIds]:checked')];
  const hasIg = checked.some((c) => c.dataset.platform === 'instagram');
  $('#title-field').hidden = !checked.some((c) => c.dataset.platform === 'youtube');
  $('#caption-count').textContent = `${caption.length}${hasIg ? ' / 2200' : ''}`;
  const first = accounts.find((a) => form.querySelector(`[name=accountIds][value="${a.id}"]:checked`));
  $('#preview-name').textContent = first ? (first.username ? '@' + first.username : first.name) : 'Your account';
  const file = form.media.files[0];
  const media = $('#preview-media');
  if (media.dataset.url) URL.revokeObjectURL(media.dataset.url);
  media.innerHTML = '';
  if (file) {
    const url = URL.createObjectURL(file);
    media.dataset.url = url;
    media.innerHTML = file.type.startsWith('video') ? `<video src="${url}" muted controls></video>` : `<img src="${url}" alt="">`;
  }
}
form.addEventListener('input', updatePreview);

async function submitPost(now) {
  const fd = new FormData(form);
  const when = now ? new Date() : new Date(form.scheduledAt.value);
  fd.set('scheduledAt', when.toISOString());
  if (!form.media.files[0]) fd.delete('media');
  const msg = $('#compose-msg');
  msg.textContent = 'Saving…';
  form.querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    await api('/posts', { method: 'POST', body: fd });
    form.reset();
    calMonth = startOfMonth(when);
    location.hash = 'calendar';
  } catch (e) {
    msg.textContent = e.message;
  } finally {
    form.querySelectorAll('button').forEach((b) => (b.disabled = false));
  }
}
form.addEventListener('submit', (e) => { e.preventDefault(); submitPost(false); });
$('#post-now').onclick = () => submitPost(true);

// ---------- Import ----------
$('#import-file').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  banner(`Importing ${file.name}…`);
  const fd = new FormData();
  fd.set('bundle', file);
  try {
    const r = await api('/import', { method: 'POST', body: fd });
    banner(`${r.updated ? `Updated ${r.updated} post(s). ` : ''}Imported ${r.imported} post(s)${r.skipped ? `, skipped ${r.skipped} already on the calendar` : ''}.`);
    if (r.first) calMonth = startOfMonth(new Date(r.first));
    renderCalendar();
  } catch (err) {
    banner(err.message, true);
  }
};

// ---------- Analytics ----------
$('#an-days').onchange = renderAnalytics;
$('#an-refresh').onclick = async (e) => {
  e.target.disabled = true; e.target.textContent = 'Refreshing…';
  try { await api('/analytics/refresh', { method: 'POST' }); await renderAnalytics(); }
  finally { e.target.disabled = false; e.target.textContent = 'Refresh stats'; }
};

function sparkline(values) {
  if (values.length < 2) return '';
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${48 - ((v - min) / span) * 44}`).join(' ');
  return `<svg viewBox="0 0 100 50" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

async function renderAnalytics() {
  const { posts, followers } = await api(`/analytics?days=${$('#an-days').value}`);
  const sum = (k) => posts.reduce((n, p) => n + (p[k] || 0), 0);
  $('#an-tiles').innerHTML = [
    ['Posts published', posts.length], ['Likes', sum('likes')], ['Comments', sum('comments')], ['Shares', sum('shares')], ['Views', sum('views')],
  ].map(([l, v]) => `<div class="tile"><div class="label">${l}</div><div class="value">${v.toLocaleString()}</div></div>`).join('');

  const byAcct = {};
  followers.forEach((f) => (byAcct[f.account_id] ||= { ...f, series: [] }).series.push(f.followers));
  $('#an-followers').innerHTML = Object.values(byAcct).map((a) => {
    const first = a.series[0], last = a.series[a.series.length - 1], diff = last - first;
    return `<div class="tile"><div class="label">${icon(a.platform)} ${esc(a.name)}</div>
      <div class="value">${last.toLocaleString()} <small class="muted" style="font-size:.85rem">${diff >= 0 ? '+' : ''}${diff}</small></div>${sparkline(a.series)}</div>`;
  }).join('') || '<p class="muted">No follower data yet. Click "Refresh stats", and it will also update automatically every few hours.</p>';

  $('#an-table tbody').innerHTML = posts.map((p) => `<tr>
    <td>${p.permalink ? `<a href="${esc(p.permalink)}" target="_blank" rel="noopener">${esc(p.caption || '(no caption)')}</a>` : esc(p.caption || '(no caption)')}</td>
    <td>${icon(p.platform)} ${esc(p.account_name)}</td>
    <td>${fmtDateTime(p.published_at)}</td>
    <td>${p.likes ?? '–'}</td><td>${p.comments ?? '–'}</td><td>${p.shares ?? '–'}</td><td>${p.views ?? '–'}</td></tr>`).join('')
    || '<tr><td colspan="7" class="muted">Nothing published in this period yet.</td></tr>';
}

// ---------- Accounts ----------
async function renderAccounts() {
  const status = await api('/status');
  const notes = [];
  if (!status.metaConfigured) notes.push('Add your <code>META_APP_ID</code> and <code>META_APP_SECRET</code> to the <code>.env</code> file, then restart the app.');
  notes.push(`In your Meta app, add <code>${esc(status.redirectUri)}</code> as a Valid OAuth Redirect URI (Facebook Login → Settings).`);
  if (!status.youtubeConfigured) notes.push('To add YouTube: in Terminal run <code>npm run youtube-keys</code>, then <code>npm run background:on</code>.');
  else notes.push(`In Google Cloud, your OAuth client's Authorized redirect URI must be <code>${esc(status.youtubeRedirectUri)}</code>.`);
  if (!status.tiktokConfigured) notes.push('To add TikTok: in Terminal run <code>npm run tiktok-keys</code>, then <code>npm run background:on</code>.');
  else notes.push(`TikTok mode: <b>${status.tiktokMode === 'direct' ? 'posts by itself' : 'sends to your TikTok inbox, then you tap Post'}</b>. TikTok redirect URI: <code>${esc(status.tiktokRedirectUri)}</code>.`);
  if (!status.instagramReady) notes.push('Instagram posting needs <code>PUBLIC_BASE_URL</code> to be a public https address. Facebook posts work without it.');
  $('#setup-notes').innerHTML = `<div class="note">${notes.map((n) => `<div>${n}</div>`).join('')}</div>`;

  $('#account-list').innerHTML = accounts.map((a) => `<div class="account">
      ${a.picture_url ? `<img src="${esc(a.picture_url)}" alt="">` : '<span class="avatar"></span>'}
      <div class="grow"><b>${esc(a.name)}</b><div class="muted">${icon(a.platform)} ${a.platform === 'facebook' ? 'Facebook Page' : ({ youtube: 'YouTube channel', tiktok: 'TikTok' }[a.platform] || 'Instagram') + (a.username ? ' · @' + esc(a.username) : '')}</div></div>
      <button class="btn danger" data-remove="${a.id}">Remove</button></div>`).join('')
    || '<p class="muted">No accounts connected yet.</p>';
  $('#account-list').onclick = async (e) => {
    const id = e.target.dataset.remove;
    if (id && confirm('Remove this account? Its scheduled posts to it will be cancelled.')) {
      await api(`/accounts/${id}`, { method: 'DELETE' });
      route();
    }
  };
}

route();
