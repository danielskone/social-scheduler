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
  if (res.status === 401) { const p = location.pathname; location.href = p.length > 1 ? `/login.html?next=${encodeURIComponent(p)}` : '/login.html'; throw new Error('Please sign in.'); }
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

// ---------- Which app this is ----------
// Viral Post, Viral Touch CRM and Viral Clips are separate apps, each at its
// own address (/, /crm/, /clips/) with its own menu. The server says which one this is.
const VP = window.VP_APPS || { app: 'scheduler', apps: [{ key: 'scheduler', name: 'Viral Post', path: '/', home: 'calendar', views: ['calendar', 'compose', 'analytics', 'accounts'], icon: 'icon' }] };
const THIS_APP = VP.apps.find((a) => a.key === VP.app) || VP.apps[0];
const appForView = (view) => VP.apps.find((a) => a.views.includes(view));
const appIcon = (a) => `/icons/${a.icon}-192.png`;
// On the Mac each app is its own program on its own port (same computer, same address).
const appHref = (a) => (a.port ? `${location.protocol}//${location.hostname}:${a.port}/` : a.path);

function buildAppMenu() {
  const nav = $('.sidebar nav');
  // The scheduler's menu is in the page. The other apps show their own sections instead.
  if (THIS_APP.key === 'crm') {
    nav.innerHTML = [...document.querySelectorAll('#crm-tabs a')].map((a) => {
      const svgEl = a.querySelector('svg');
      return `<a href="${a.getAttribute('href')}" data-tab="${a.dataset.tab}"><span class="nav-ico">${svgEl ? svgEl.outerHTML : ''}</span><span>${esc(a.textContent.trim())}</span></a>`;
    }).join('');
  } else if (THIS_APP.key === 'clips') {
    nav.innerHTML = '<a href="#clips" data-view="clips"><span class="nav-ico"><svg viewBox="0 0 24 24"><circle cx="6.5" cy="6.5" r="2.8"/><circle cx="6.5" cy="17.5" r="2.8"/><path d="M8.6 8.3 20 18M8.6 15.7 20 6"/></svg></span><span>Make clips</span></a>';
  }
  // Switching between apps: a list at the bottom of the menu (Mac) and a button at the top (iPhone).
  // Viral Touch CRM is kept apart: it isn't listed in the other apps and doesn't list them.
  if (THIS_APP.standalone) return;
  const linked = VP.apps.filter((a) => !a.standalone);
  if (linked.length < 2) return;
  const list = linked.map((a) => `<a href="${appHref(a)}#${a.home}" class="${a.key === THIS_APP.key ? 'on' : ''}"${a.key === THIS_APP.key ? ' aria-current="page"' : ''}><img src="${appIcon(a)}" alt=""><span>${esc(a.name)}</span></a>`).join('');
  const box = $('#app-switch');
  box.innerHTML = `<div class="app-switch-title">Your apps</div>${list}`;
  box.hidden = false;
  const pop = $('#app-switch-pop');
  pop.innerHTML = `<div class="app-switch-title">Your apps</div>${list}`;
  const btn = $('#app-switch-btn');
  btn.hidden = false;
  btn.onclick = (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; };
  document.addEventListener('click', (e) => { if (!pop.hidden && !e.target.closest('#app-switch-pop')) pop.hidden = true; });
}
document.body.dataset.app = THIS_APP.key;
buildAppMenu();

// ---------- Routing ----------
let lastView = '';
async function route() {
  const [path, query] = (location.hash.slice(1) || THIS_APP.home).split('?');
  const [view, sub] = path.split('/');
  // A link to a page of another app (e.g. "Schedule this clip" goes to Viral Post) opens that app.
  const owner = appForView(view);
  if (!owner || owner.key !== THIS_APP.key) {
    if (owner) { location.href = `${appHref(owner)}#${location.hash.slice(1)}`; return; }
    history.replaceState(null, '', `#${THIS_APP.home}`);
    return route();
  }
  const params = new URLSearchParams(query);
  banner(params.get('error') ? `Couldn't connect: ${params.get('error')}` : params.get('connected') ? `Connected ${params.get('connected')} account(s).` : '', Boolean(params.get('error')));
  document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  const crmTab = ['pipeline', 'tasks', 'appointments', 'forms', 'templates', 'automations', 'email'].includes(sub) ? sub : 'list';
  document.querySelectorAll('.sidebar nav a').forEach((a) => a.classList.toggle('active',
    a.dataset.tab ? a.dataset.tab === crmTab : a.dataset.view === view));
  const acctLoad = api('/accounts').then((a) => (accounts = a));
  if (view === 'calendar' && lastView && lastView !== 'calendar') goToToday(); // coming back to the Calendar tab
  lastView = view;
  if (view === 'calendar') { renderCalendar(); return; } // the calendar doesn't need the account list
  await acctLoad;
  if (view === 'compose') renderCompose(params.get('date'), params.get('clip'));
  if (view === 'clips') renderClips();
  if (view === 'analytics') renderAnalytics();
  if (view === 'contacts') renderContacts(sub);
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
// Small preview picture. Uses the little /thumb/ version so the phone doesn't download whole videos.
const thumb = (p, cls) => {
  if (!p.media_type || !(p.thumb_url || p.media_url)) return `<span class="${cls} none">Aa</span>`;
  const vid = p.media_type === 'video';
  return `<span class="${cls}${vid ? ' vid' : ''}"><img src="${p.thumb_url || p.media_url}" alt="" loading="lazy" decoding="async" onerror="this.remove()"></span>`;
};
const STATUS_WORD = { scheduled: 'Scheduled', published: 'Posted', failed: 'Needs attention' };

$('#cal-weekdays').innerHTML = WEEKDAYS.map((d) => `<div>${d}</div>`).join('');
$('#cal-prev').onclick = () => { if (mode() === 'week') calWeek = addDays(calWeek, -7); else calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCalendar(); };
$('#cal-next').onclick = () => { if (mode() === 'week') calWeek = addDays(calWeek, 7); else calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCalendar(); };
$('#cal-today').onclick = () => { goToToday(); renderCalendar(); };
// Opening the app (or tapping Today) always lands on today's posts, no scrolling needed.
let jumpToToday = true;
function goToToday() { calMonth = startOfMonth(new Date()); calWeek = startOfWeek(new Date()); jumpToToday = true; }
// Coming back to the app later (e.g. reopening it on the iPhone the next morning) jumps to today again.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (!hiddenAt || Date.now() - hiddenAt < 10 * 60 * 1000) return;
  goToToday();
  if (!$('#view-calendar').hidden) renderCalendar();
});
// Scrolls so today's day (or, if today has no posts, the next day that does) sits at the top.
// The Month/Week header stays at the top while you scroll (below the app bar on iPhone).
const stickyTop = () => (isPhone() ? ($('.appbar')?.offsetHeight || 0) : 0);
function updateStickyHead() {
  const head = $('#view-calendar > .view-head');
  if (!head || $('#view-calendar').hidden) return;
  const top = stickyTop();
  document.documentElement.style.setProperty('--sticky-top', `${top}px`);
  document.documentElement.style.setProperty('--cal-head-h', `${head.offsetHeight}px`);
  head.classList.toggle('stuck', scrollY > 4 && head.getBoundingClientRect().top <= top + 1);
}
let stickyQueued = false;
const queueSticky = () => { if (!stickyQueued) { stickyQueued = true; requestAnimationFrame(() => { stickyQueued = false; updateStickyHead(); }); } };
addEventListener('scroll', queueSticky, { passive: true });
addEventListener('resize', queueSticky);
if (window.ResizeObserver) new ResizeObserver(queueSticky).observe($('#view-calendar > .view-head'));

function scrollToToday(m) {
  if (!jumpToToday) return;
  jumpToToday = false;
  const box = { list: '#cal-agenda', week: '#cal-week', month: '#cal-days' }[m];
  let target = $(`${box} .today`);
  if (m === 'list' && !target) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    target = [...document.querySelectorAll('#cal-agenda .ag-day')].find((el) => new Date(el.dataset.day) >= now);
  }
  if (!target) { window.scrollTo(0, 0); return; }
  // Leave room for the header that stays at the top (and the app bar on iPhone).
  const bar = stickyTop() + $('#view-calendar > .view-head').offsetHeight + (m === 'month' ? $('#cal-weekdays').offsetHeight : 0);
  const r = target.getBoundingClientRect();
  // On the Mac, leave the page alone if today and its first posts are already on screen.
  if (!isPhone() && r.top >= bar && r.top + Math.min(r.height, 320) <= innerHeight) return;
  window.scrollTo({ top: Math.max(0, scrollY + r.top - bar - 10), behavior: 'auto' });
}
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
  queueSticky();
  const overview = renderOverview().catch(() => {});
  // Wait for the cards at the top so they don't push today down after we've scrolled to it.
  const jump = async () => { if (jumpToToday) { await overview; requestAnimationFrame(() => scrollToToday(m)); } };
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
    jump();
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
    jump();
    return;
  }

  // List: this month's days that have posts.
  const inMonth = posts.filter((p) => new Date(p.scheduled_at).getMonth() === calMonth.getMonth());
  const groups = {};
  inMonth.forEach((p) => (groups[dayKey(new Date(p.scheduled_at))] ||= []).push(p));
  $('#cal-agenda').innerHTML = Object.values(groups).map((list) => {
    const d = new Date(list[0].scheduled_at);
    return `<div class="ag-day${dayKey(d) === today ? ' today' : ''}" data-day="${new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString()}">
      <div class="ag-date"><span>${d.toLocaleDateString([], { weekday: 'short' })}</span><b>${d.getDate()}</b></div>
      <div class="ag-list">${list.map(postCard).join('')}</div></div>`;
  }).join('') || '<p class="empty">No posts this month yet.<br><a class="btn primary" href="#compose">+ New post</a></p>';
  $('#cal-agenda').onclick = (e) => { const it = e.target.closest('.pcard'); if (it) openPost(it.dataset.id); };
  jump();
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
      tip.innerHTML = `${p.thumb_url ? `<img src="${p.thumb_url}" alt="" onerror="this.remove()">` : ''}
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
    ${p.media_url ? (p.media_type === 'video' ? `<video src="${p.media_url}" ${p.thumb_url ? `poster="${p.thumb_url}"` : ''} controls playsinline preload="none"></video>` : `<img src="${p.media_url}" alt="">`) : ''}
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

let composeClip = null; // a clip from the Clips tab, used instead of an uploaded video

async function renderCompose(dateIso, clipId) {
  const box = $('#compose-accounts');
  box.innerHTML = accounts.length
    ? accounts.map((a) => `<label><input type="checkbox" name="accountIds" value="${a.id}" data-platform="${a.platform}"${accounts.length === 1 ? ' checked' : ''}>
        ${icon(a.platform)}${esc(a.username ? '@' + a.username : a.name)}</label>`).join('')
    : `<span class="muted">No accounts yet. <a href="#accounts">Connect one first.</a></span>`;
  let when = dateIso ? new Date(dateIso) : new Date(Date.now() + 3600e3);
  if (dateIso) when.setHours(9, 0, 0, 0);
  form.scheduledAt.value = toLocalInput(when);
  $('#compose-msg').textContent = '';
  composeClip = null;
  if (clipId) {
    try {
      composeClip = await api(`/clips/clip/${clipId}`);
      form.media.value = '';
      if (!form.caption.value.trim()) form.caption.value = composeClip.caption || composeClip.title || '';
      if (!form.title.value.trim()) form.title.value = (composeClip.title || '').slice(0, 100);
    } catch (e) { $('#compose-msg').textContent = e.message; }
  }
  showComposeClip();
  updatePreview();
}

function showComposeClip() {
  const box = $('#compose-clip');
  box.hidden = !composeClip;
  $('#media-field').hidden = Boolean(composeClip);
  if (!composeClip) return;
  box.querySelector('img').src = composeClip.poster_url || '';
  box.querySelector('b').textContent = composeClip.title;
  box.querySelector('small').textContent = `Clip · ${Math.round(composeClip.length)} seconds · vertical 9:16`;
}
form.media.addEventListener('change', () => { if (form.media.files[0] && composeClip) { composeClip = null; showComposeClip(); } });
$('#compose-clip-remove').onclick = () => { composeClip = null; showComposeClip(); updatePreview(); };

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
  const clipKey = composeClip ? String(composeClip.id) : '';
  if (!file && composeClip && media.dataset.clip === clipKey) return; // keep the clip playing while typing
  media.dataset.clip = '';
  if (media.dataset.url) URL.revokeObjectURL(media.dataset.url);
  media.dataset.url = '';
  media.innerHTML = '';
  if (file) {
    const url = URL.createObjectURL(file);
    media.dataset.url = url;
    media.innerHTML = file.type.startsWith('video') ? `<video src="${url}" muted controls></video>` : `<img src="${url}" alt="">`;
  } else if (composeClip) {
    media.dataset.clip = clipKey;
    media.innerHTML = `<video src="${esc(composeClip.url)}" poster="${esc(composeClip.poster_url || '')}" controls playsinline></video>`;
  }
}
form.addEventListener('input', updatePreview);

async function submitPost(now) {
  const fd = new FormData(form);
  const when = now ? new Date() : new Date(form.scheduledAt.value);
  fd.set('scheduledAt', when.toISOString());
  if (!form.media.files[0]) fd.delete('media');
  if (!form.media.files[0] && composeClip) fd.set('clipId', composeClip.id);
  const msg = $('#compose-msg');
  msg.textContent = 'Saving…';
  form.querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    await api('/posts', { method: 'POST', body: fd });
    form.reset();
    composeClip = null;
    showComposeClip();
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
    banner(`${r.removed ? `Removed ${r.removed} old post(s). ` : ''}${r.updated ? `Updated ${r.updated} post(s). ` : ''}Imported ${r.imported} post(s)${r.skipped ? `, skipped ${r.skipped} already on the calendar` : ''}.`);
    if (r.first) calMonth = startOfMonth(new Date(r.first));
    renderCalendar();
  } catch (err) {
    banner(err.message, true);
  }
};

// ---------- Analytics ----------
const PL_COLOR = { facebook: '#1877F2', instagram: '#D6249F', youtube: '#FF0000', tiktok: 'var(--tiktok)' };
let anDays = (() => { try { return Number(localStorage.getItem('anDays')) || 30; } catch { return 30; } })();
let anPlatform = 'all';
let anSort = { key: 'published_at', dir: -1 };
let anData = null;
let anShowAll = false;
let anTopBy = (() => { try { return localStorage.getItem('anTopBy') || 'views'; } catch { return 'views'; } })();

$('#an-range').onclick = (e) => {
  const b = e.target.closest('button[data-days]');
  if (!b) return;
  anDays = Number(b.dataset.days);
  try { localStorage.setItem('anDays', anDays); } catch { /* private mode */ }
  renderAnalytics();
};
$('#an-filter').onclick = (e) => { const b = e.target.closest('button[data-pl]'); if (b) { anPlatform = b.dataset.pl; drawAnalytics(); } };
$('#an-top-by').onclick = (e) => {
  const b = e.target.closest('button[data-by]');
  if (!b) return;
  anTopBy = b.dataset.by;
  try { localStorage.setItem('anTopBy', anTopBy); } catch { /* private mode */ }
  drawAnalytics();
};
// Tapping a post (top list or table) opens its numbers and the comments.
$('#an-top').onclick = (e) => { const r = e.target.closest('[data-tid]'); if (r) { e.preventDefault(); openPostStats(r.dataset.tid); } };
$('#an-table tbody').onclick = (e) => { const r = e.target.closest('tr[data-tid]'); if (r && !e.target.closest('a')) openPostStats(r.dataset.tid); };
// Tapping the Engagement or Comments tile shows the posts behind that number.
$('#an-tiles').onclick = (e) => {
  const t = e.target.closest('[data-tile]');
  if (!t) return;
  anTopBy = t.dataset.tile === 'views' ? 'views' : 'eng';
  drawAnalytics();
  $('#an-top-head').scrollIntoView({ behavior: 'smooth', block: 'center' });
};
$('#an-table thead').onclick = (e) => {
  const th = e.target.closest('th[data-sort]');
  if (!th) return;
  anSort = { key: th.dataset.sort, dir: anSort.key === th.dataset.sort ? -anSort.dir : (['caption', 'account_name'].includes(th.dataset.sort) ? 1 : -1) };
  drawAnalytics();
};
$('#an-refresh').onclick = async (e) => {
  e.target.disabled = true; e.target.textContent = 'Refreshing…';
  try { await api('/analytics/refresh', { method: 'POST' }); await renderAnalytics(); }
  finally { e.target.disabled = false; e.target.textContent = 'Refresh stats'; }
};

function sparkline(values) {
  if (values.length < 2) return '';
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${46 - ((v - min) / span) * 40}`).join(' ');
  return `<svg viewBox="0 0 100 50" preserveAspectRatio="none"><defs><linearGradient id="spk" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".25"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    <polygon points="0,50 ${pts} 100,50" fill="url(#spk)"/><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

const eng = (p) => (p.likes || 0) + (p.comments || 0) + (p.shares || 0);
const fmtN = (n) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : Math.round(n).toLocaleString());
function change(now, before) {
  if (!before && !now) return '';
  if (!before) return '<span class="chg up">new</span>';
  const pct = Math.round(((now - before) / before) * 100);
  return `<span class="chg ${pct > 0 ? 'up' : pct < 0 ? 'down' : ''}">${pct > 0 ? '▲' : pct < 0 ? '▼' : ''} ${Math.abs(pct)}%</span>`;
}

async function renderAnalytics() {
  document.querySelectorAll('#an-range button').forEach((b) => b.classList.toggle('on', Number(b.dataset.days) === anDays));
  anData = await api(`/analytics?days=${anDays}`);
  drawAnalytics();
}

function drawAnalytics() {
  const { posts: allPosts, previous: allPrev, followers, days, failed } = anData;
  const platforms = [...new Set([...allPosts.map((p) => p.platform), ...accounts.map((a) => a.platform)])];
  $('#an-filter').innerHTML = ['all', ...platforms].map((pl) => `<button type="button" data-pl="${pl}" class="${anPlatform === pl ? 'on' : ''}">${pl === 'all' ? 'All platforms' : `${icon(pl)}${NAMES[pl]}`}</button>`).join('');
  const pick = (list) => (anPlatform === 'all' ? list : list.filter((p) => p.platform === anPlatform));
  const posts = pick(allPosts), prev = pick(allPrev);
  const sum = (list, k) => list.reduce((n, p) => n + (k === 'eng' ? eng(p) : (p[k] || 0)), 0);

  // Tiles
  const tiles = [
    ['Posts', posts.length, prev.length, '📣'],
    ['Engagement', sum(posts, 'eng'), sum(prev, 'eng'), '🔥'],
    ['Likes', sum(posts, 'likes'), sum(prev, 'likes'), '❤️'],
    ['Comments', sum(posts, 'comments'), sum(prev, 'comments'), '💬'],
    ['Shares', sum(posts, 'shares'), sum(prev, 'shares'), '🔁'],
    ['Views', sum(posts, 'views'), sum(prev, 'views'), '👀'],
    ['Avg. per post', posts.length ? sum(posts, 'eng') / posts.length : 0, prev.length ? sum(prev, 'eng') / prev.length : 0, '⭐'],
  ];
  const tapTile = { Engagement: 'eng', Comments: 'eng', Views: 'views' };
  $('#an-tiles').innerHTML = tiles.map(([l, v, b, e]) => `<div class="tile${tapTile[l] ? ' tap' : ''}" ${tapTile[l] ? `data-tile="${tapTile[l]}" role="button" tabindex="0" title="See the posts behind this number"` : ''}><div class="label"><span class="emo">${e}</span>${l}</div>
    <div class="value">${fmtN(v)}</div><div class="sub">${change(v, b)} <span class="muted">vs last ${days} days</span></div></div>`).join('')
    + (failed ? `<a class="tile bad" href="#calendar"><div class="label"><span class="emo">⚠️</span>Failed posts</div><div class="value">${failed}</div><div class="sub muted">Open the calendar to retry</div></a>` : '');

  // Engagement by day, stacked by platform
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - days + 1);
  const buckets = [...Array(days)].map(() => ({}));
  const postsPerDay = Array(days).fill(0);
  posts.forEach((p) => {
    const i = Math.floor((new Date(p.published_at) - start) / 864e5);
    if (i < 0 || i >= days) return;
    buckets[i][p.platform] = (buckets[i][p.platform] || 0) + eng(p);
    postsPerDay[i]++;
  });
  const totals = buckets.map((b) => Object.values(b).reduce((a, c) => a + c, 0));
  const max = Math.max(1, ...totals);
  const W = 100 / days;
  const bars = buckets.map((b, i) => {
    let y = 100;
    const d = new Date(start); d.setDate(start.getDate() + i);
    const tip = `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}: ${totals[i]} engagement, ${postsPerDay[i]} post(s)`;
    const segs = Object.entries(b).map(([pl, v]) => { const h = (v / max) * 92; y -= h; return `<rect x="${i * W + W * 0.15}" y="${y}" width="${W * 0.7}" height="${h}" fill="${PL_COLOR[pl]}" rx="${Math.min(W * 0.2, 1)}"/>`; }).join('');
    const dot = postsPerDay[i] && !totals[i] ? `<rect x="${i * W + W * 0.15}" y="98" width="${W * 0.7}" height="2" fill="var(--line)"/>` : '';
    return `<g><title>${tip}</title><rect x="${i * W}" y="0" width="${W}" height="100" fill="transparent"/>${segs}${dot}</g>`;
  }).join('');
  const lbl = (i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
  $('#an-chart').innerHTML = posts.length
    ? `<div class="chart"><div class="chart-max">${fmtN(max)}</div><svg viewBox="0 0 100 100" preserveAspectRatio="none">${bars}</svg></div>
       <div class="chart-x"><span>${lbl(0)}</span><span>${lbl(Math.floor(days / 2))}</span><span>Today</span></div>
       <div class="legend">${[...new Set(posts.map((p) => p.platform))].map((pl) => `<span><i style="background:${PL_COLOR[pl]}"></i>${NAMES[pl]}</span>`).join('')}</div>`
    : '<p class="empty small">No published posts in this period yet.</p>';
  $('#an-chart-note').textContent = posts.length ? `Best day: ${lbl(totals.indexOf(Math.max(...totals)))}` : '';

  // By platform
  const byPl = {};
  allPosts.forEach((p) => { const x = (byPl[p.platform] ||= { posts: 0, likes: 0, comments: 0, shares: 0, views: 0, eng: 0 }); x.posts++; ['likes', 'comments', 'shares', 'views'].forEach((k) => (x[k] += p[k] || 0)); x.eng += eng(p); });
  const maxEng = Math.max(1, ...Object.values(byPl).map((x) => x.eng));
  $('#an-platforms').innerHTML = Object.entries(byPl).sort((a, b) => b[1].eng - a[1].eng).map(([pl, x]) => `
    <div class="plrow ${anPlatform !== 'all' && anPlatform !== pl ? 'dim' : ''}">
      <div class="plrow-head">${icon(pl)}<b>${NAMES[pl]}</b><span class="muted small">${x.posts} post${x.posts === 1 ? '' : 's'}</span><b class="plrow-eng">${fmtN(x.eng)}</b></div>
      <div class="bar"><i style="width:${(x.eng / maxEng) * 100}%;background:${PL_COLOR[pl]}"></i></div>
      <div class="plrow-stats"><span>❤️ ${fmtN(x.likes)}</span><span>💬 ${fmtN(x.comments)}</span><span>🔁 ${fmtN(x.shares)}</span>${x.views ? `<span>👀 ${fmtN(x.views)}</span>` : ''}<span class="muted">avg ${fmtN(x.eng / x.posts)}/post</span></div>
    </div>`).join('') || '<p class="empty small">Nothing published yet.</p>';

  // Top posts: most views (falls back to engagement when a platform gives no view count)
  document.querySelectorAll('#an-top-by button').forEach((b) => b.classList.toggle('on', b.dataset.by === anTopBy));
  const score = (p) => (anTopBy === 'views' ? (p.views || 0) : eng(p));
  const top = [...posts].sort((a, b) => score(b) - score(a) || eng(b) - eng(a)).slice(0, 5);
  $('#an-top').innerHTML = top.map((p, i) => `<button type="button" class="top-post" data-tid="${p.id}">
    <span class="rank">${i + 1}</span>${thumb(p, 'tp-thumb')}
    <span class="tp-body"><span class="tp-text">${esc(p.title || p.caption || '(no caption)')}</span>
      <span class="tp-meta">${icon(p.platform)} ${esc(p.account_name)} · ${new Date(p.published_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
      <span class="tp-chips"><span>👀 ${p.views == null ? '–' : fmtN(p.views)}</span><span>❤️ ${fmtN(p.likes || 0)}</span><span class="tp-com">💬 ${fmtN(p.comments || 0)}</span></span></span>
    <span class="tp-nums"><b>${anTopBy === 'views' ? (p.views == null ? '–' : fmtN(p.views)) : fmtN(eng(p))}</b><span class="muted small">${anTopBy === 'views' ? 'views' : 'engagement'}</span></span>
    <span class="tp-go" aria-hidden="true">›</span></button>`).join('') || '<p class="empty small">No published posts in this period yet.</p>';

  // Best weekday + best hours
  const wd = [...Array(7)].map(() => ({ n: 0, e: 0 })), hr = {};
  posts.forEach((p) => {
    const d = new Date(p.published_at);
    const w = (d.getDay() + 6) % 7; wd[w].n++; wd[w].e += eng(p);
    const h = d.getHours(); (hr[h] ||= { n: 0, e: 0 }); hr[h].n++; hr[h].e += eng(p);
  });
  const avg = wd.map((x) => (x.n ? x.e / x.n : 0));
  const maxAvg = Math.max(1, ...avg), best = avg.indexOf(Math.max(...avg));
  $('#an-days-chart').innerHTML = posts.length ? `<div class="wd">${WEEKDAYS.map((d, i) => `<div class="wd-col ${i === best && avg[i] ? 'best' : ''}" title="${wd[i].n} post(s), avg ${fmtN(avg[i])}">
      <span class="wd-val">${avg[i] ? fmtN(avg[i]) : ''}</span><div class="wd-bar"><i style="height:${(avg[i] / maxAvg) * 100}%"></i></div><span>${d}</span></div>`).join('')}</div>` : '<p class="empty small">Post a few times and this fills in.</p>';
  const hours = Object.entries(hr).map(([h, x]) => ({ h: Number(h), avg: x.e / x.n, n: x.n })).sort((a, b) => b.avg - a.avg).slice(0, 3);
  const hName = (h) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });
  $('#an-hours').innerHTML = hours.map((x, i) => `<div class="hour"><span class="medal">${['🥇', '🥈', '🥉'][i]}</span><b>${hName(x.h)}</b><span class="muted small">${x.n} post${x.n === 1 ? '' : 's'}</span><b class="hour-avg">${fmtN(x.avg)} avg</b></div>`).join('') || '<p class="muted small">Not enough posts yet.</p>';

  // Followers
  const since = anData.since.slice(0, 10);
  const byAcct = {};
  followers.filter((f) => anPlatform === 'all' || f.platform === anPlatform)
    .forEach((f) => (byAcct[f.account_id] ||= { ...f, series: [], prior: null }).series.push(f));
  const lastOf = (a) => a.series[a.series.length - 1].followers;
  $('#an-followers').innerHTML = Object.values(byAcct).sort((x, y) => lastOf(y) - lastOf(x)).map((a) => {
    const inRange = a.series.filter((f) => f.taken_on >= since).map((f) => f.followers);
    const all = a.series.map((f) => f.followers);
    const last = all[all.length - 1], first = inRange[0] ?? last, diff = last - first;
    const series = inRange.length > 1 ? inRange : all;
    const flat = Math.min(...series) === Math.max(...series);
    const pic = a.picture_url ? `<img class="f-pic" src="${esc(a.picture_url)}" alt="" onerror="this.style.visibility='hidden'">` : '<span class="f-pic"></span>';
    return `<div class="tile follower"><div class="label"><span class="f-avatar">${pic}${icon(a.platform)}</span><span class="f-name">${esc(a.name)}</span></div>
      <div class="value">${last.toLocaleString()} <span class="chg ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}">${diff > 0 ? '+' : ''}${diff ? diff.toLocaleString() : 'no change'}</span></div>
      ${flat ? '<div class="f-flat">Steady this period</div>' : sparkline(series)}</div>`;
  }).join('') || '<p class="muted">No follower data yet. Click "Refresh stats", and it will also update automatically every few hours.</p>';

  // Table
  const k = anSort.key;
  const rows = [...posts].sort((a, b) => {
    const va = k === 'eng' ? eng(a) : a[k] ?? -1, vb = k === 'eng' ? eng(b) : b[k] ?? -1;
    return (va > vb ? 1 : va < vb ? -1 : 0) * anSort.dir;
  });
  document.querySelectorAll('#an-table th').forEach((th) => { th.classList.toggle('sorted', th.dataset.sort === k); th.dataset.dir = anSort.dir > 0 ? '▲' : '▼'; });
  $('#an-count').textContent = `(${posts.length})`;
  const LIMIT = 20;
  $('#an-more').innerHTML = rows.length > LIMIT ? `<button class="btn ghost show-all" type="button">${anShowAll ? 'Show fewer' : `Show all ${rows.length} posts`}</button>` : '';
  $('#an-more').onclick = () => { anShowAll = !anShowAll; drawAnalytics(); };
  $('#an-table tbody').innerHTML = (anShowAll ? rows : rows.slice(0, LIMIT)).map((p) => `<tr data-tid="${p.id}" title="Tap to see the comments">
    <td><div class="t-post">${thumb(p, 't-thumb')}${p.permalink ? `<a href="${esc(p.permalink)}" target="_blank" rel="noopener">${esc(p.title || p.caption || '(no caption)')}</a>` : `<span>${esc(p.title || p.caption || '(no caption)')}</span>`}</div></td>
    <td><span class="t-acct">${icon(p.platform)} ${esc(p.account_name)}</span></td>
    <td>${new Date(p.published_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
    <td>${p.likes ?? '–'}</td><td>${p.comments ?? '–'}</td><td>${p.shares ?? '–'}</td><td>${p.views ?? '–'}</td><td><b>${eng(p)}</b></td></tr>`).join('')
    || '<tr><td colspan="8" class="muted">Nothing published in this period yet.</td></tr>';
}

// One post's numbers plus its comments: who wrote them and what they said.
const ago = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (!(s >= 0)) return '';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
};
function commentHtml(c, reply = false) {
  const who = c.name || 'Someone';
  const initials = who.replace(/^@/, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  const pic = `<span>${esc(initials)}</span>${c.picture ? `<img src="${esc(c.picture)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}`;
  const name = c.profile ? `<a href="${esc(c.profile)}" target="_blank" rel="noopener">${esc(who)}</a>` : esc(who);
  return `<div class="cmt${reply ? ' reply' : ''}"><span class="cmt-pic">${pic}</span>
    <div class="cmt-body"><div class="cmt-bubble"><b>${name}</b><p>${esc(c.text)}</p></div>
      <div class="cmt-meta">${ago(c.time)}${c.likes ? ` · ❤️ ${c.likes}` : ''}${c.replies?.length ? ` · ${c.replies.length} repl${c.replies.length === 1 ? 'y' : 'ies'}` : ''}</div>
      ${(c.replies || []).map((r) => commentHtml(r, true)).join('')}</div></div>`;
}
async function openPostStats(tid) {
  const p = anData.posts.find((x) => String(x.id) === String(tid));
  if (!p) return;
  const dlg = $('#an-dialog');
  const media = p.media_url ? (p.media_type === 'video'
    ? `<video src="${esc(p.media_url)}" ${p.thumb_url ? `poster="${esc(p.thumb_url)}"` : ''} controls playsinline preload="none"></video>`
    : `<img src="${esc(p.media_url)}" alt="">`) : '';
  dlg.innerHTML = `<div class="and-head">${icon(p.platform)}<div><b>${esc(p.account_name)}</b><small>${fmtDateTime(p.published_at)}</small></div>
      <button class="btn ghost and-x" type="button" aria-label="Close">✕</button></div>
    <div class="and-post">${media}<p>${esc(p.title || p.caption || '(no caption)')}</p></div>
    <div class="and-stats">
      <div><b>${p.views == null ? '–' : fmtN(p.views)}</b><span>👀 Views</span></div>
      <div><b>${fmtN(p.likes || 0)}</b><span>❤️ Likes</span></div>
      <div><b>${fmtN(p.comments || 0)}</b><span>💬 Comments</span></div>
      <div><b>${p.shares == null ? '–' : fmtN(p.shares)}</b><span>🔁 Shares</span></div>
    </div>
    <h3 class="and-h">Comments</h3>
    <div class="and-comments" id="and-comments"><p class="muted">Loading comments…</p></div>
    <div class="row and-actions">${p.permalink ? `<a class="btn primary" href="${esc(p.permalink)}" target="_blank" rel="noopener">Open post on ${NAMES[p.platform]}</a>` : ''}<button class="btn ghost and-close" type="button">Close</button></div>`;
  dlg.showModal(); dlg.scrollTop = 0; document.activeElement?.blur();
  dlg.querySelectorAll('.and-x, .and-close').forEach((b) => (b.onclick = () => dlg.close()));
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
  let r;
  try { r = await api(`/analytics/comments/${tid}`); } catch (e) { r = { comments: [], note: e.message }; }
  if (!dlg.open) return;
  const box = $('#and-comments');
  const list = r.comments || [];
  box.innerHTML = (r.note ? `<p class="and-note">${esc(r.note)}</p>` : '')
    + (list.length
      ? `<p class="muted small and-count">${list.length}${r.more ? '+' : ''} comment${list.length === 1 ? '' : 's'} · newest first</p>${list.map((c) => commentHtml(c)).join('')}`
      : (r.note ? '' : '<p class="muted and-empty">No comments on this post yet.</p>'));
}

// ---------- Accounts ----------
async function renderAccounts() {
  const status = await api('/status');
  const notes = [];
  if (status.saas) {
    // A customer of the sellable version: no technical setup, just their plan and sign out.
    if (!$('#saas-links')) $('#view-accounts .view-head .row').insertAdjacentHTML('beforeend', '<span id="saas-links"><a class="btn" href="/account">Plan &amp; settings</a> <a class="btn" href="/logout">Sign out</a></span>');
    // YouTube and TikTok are only offered once the owner switches them on for customers.
    $('#view-accounts a[href="/auth/youtube"]').style.display = status.youtubeConfigured ? '' : 'none';
    $('#view-accounts a[href="/auth/tiktok"]').style.display = status.tiktokConfigured ? '' : 'none';
    const names = ['Facebook', status.youtubeConfigured && 'Google', status.tiktokConfigured && 'TikTok'].filter(Boolean);
    notes.push(`Click a Connect button and sign in to ${names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : 'Facebook'}. You choose which Pages, profiles and channels Viral Post may post to, and you can remove them here any time.`);
    if (status.metaTestersOnly) notes.push('<b>Facebook and Instagram during the beta:</b> Facebook only lets you connect after we add you as a Tester. Reply to your welcome message with the name on your Facebook profile. You will get an invite. Accept it at <a href="https://developers.facebook.com/requests/" target="_blank" rel="noopener">developers.facebook.com/requests</a>, then come back here and click Connect. Instagram must be a Business or Creator account linked to your Facebook Page.');
    if (!status.youtubeConfigured || !status.tiktokConfigured) notes.push(`${[!status.youtubeConfigured && 'YouTube', !status.tiktokConfigured && 'TikTok'].filter(Boolean).join(' and ')} will be added after the beta.`);
    if (status.tiktokConfigured && status.tiktokMode !== 'direct') notes.push('TikTok videos go to your TikTok inbox at the scheduled time; open TikTok and tap Post to finish.');
  }
  if (status.saas) { $('#setup-notes').innerHTML = `<div class="note">${notes.map((n) => `<div>${n}</div>`).join('')}</div>`; }
  else {
  if (!status.metaConfigured) notes.push('Add your <code>META_APP_ID</code> and <code>META_APP_SECRET</code> to the <code>.env</code> file, then restart the app.');
  notes.push(`In your Meta app, add <code>${esc(status.redirectUri)}</code> as a Valid OAuth Redirect URI (Facebook Login → Settings).`);
  if (!status.youtubeConfigured) notes.push('To add YouTube: in Terminal run <code>npm run youtube-keys</code>, then <code>npm run background:on</code>.');
  else notes.push(`In Google Cloud, your OAuth client's Authorized redirect URI must be <code>${esc(status.youtubeRedirectUri)}</code>.`);
  if (!status.tiktokConfigured) notes.push('To add TikTok: in Terminal run <code>npm run tiktok-keys</code>, then <code>npm run background:on</code>.');
  else notes.push(`TikTok mode: <b>${status.tiktokMode === 'direct' ? 'posts by itself' : 'sends to your TikTok inbox, then you tap Post'}</b>. TikTok redirect URI: <code>${esc(status.tiktokRedirectUri)}</code>.`);
  if (!status.instagramReady) notes.push('Instagram posting needs <code>PUBLIC_BASE_URL</code> to be a public https address. Facebook posts work without it.');
  $('#setup-notes').innerHTML = `<div class="note">${notes.map((n) => `<div>${n}</div>`).join('')}</div>`;
  }

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

// Keep the app's files on the phone so it opens instantly.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
