const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, opts);
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
$('#cal-weekdays').innerHTML = WEEKDAYS.map((d) => `<div>${d}</div>`).join('');
$('#cal-prev').onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCalendar(); };
$('#cal-next').onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCalendar(); };
$('#cal-today').onclick = () => { calMonth = startOfMonth(new Date()); renderCalendar(); };

async function renderCalendar() {
  $('#cal-title').textContent = calMonth.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const first = new Date(calMonth);
  first.setDate(1 - ((first.getDay() + 6) % 7)); // back to Monday
  const last = new Date(first);
  last.setDate(first.getDate() + 42);
  const posts = await api(`/posts?from=${first.toISOString()}&to=${last.toISOString()}`);
  const byDay = {};
  posts.forEach((p) => (byDay[dayKey(new Date(p.scheduled_at))] ||= []).push(p));

  const today = dayKey(new Date());
  let html = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    const items = byDay[dayKey(d)] || [];
    html += `<div class="day ${d.getMonth() !== calMonth.getMonth() ? 'other' : ''} ${dayKey(d) === today ? 'today' : ''}" data-date="${d.toISOString()}">
      <span class="num">${d.getDate()}</span>
      ${items.map((p) => `<div class="chip ${overallStatus(p)}" data-id="${p.id}" title="${esc(p.caption)}">
        ${[...new Set(p.targets.map((t) => t.platform))].map((pl) => `<span class="dot ${pl}"></span>`).join('')}
        <b>${fmtTime(p.scheduled_at)}</b> <span class="text">${esc(p.caption || (p.media_type === 'video' ? 'Video' : 'Photo'))}</span>
      </div>`).join('')}
    </div>`;
  }
  $('#cal-days').innerHTML = html;
  $('#cal-days').onclick = (e) => {
    const chip = e.target.closest('.chip');
    if (chip) return openPost(chip.dataset.id);
    const day = e.target.closest('.day');
    if (day) location.hash = `compose?date=${encodeURIComponent(day.dataset.date)}`;
  };
}

async function openPost(id) {
  const p = await api(`/posts/${id}`);
  const editable = p.targets.every((t) => t.status === 'scheduled' || t.status === 'failed') && !p.targets.some((t) => t.status === 'published');
  const dlg = $('#post-dialog');
  dlg.innerHTML = `
    <h2 style="margin-top:0">${fmtDateTime(p.scheduled_at)}</h2>
    ${p.media_url ? (p.media_type === 'video' ? `<video src="${p.media_url}" controls></video>` : `<img src="${p.media_url}" alt="">`) : ''}
    ${editable ? `<textarea id="dlg-caption" rows="5">${esc(p.caption)}</textarea>
      <p><input type="datetime-local" id="dlg-when" value="${toLocalInput(new Date(p.scheduled_at))}"></p>`
      : `<p style="white-space:pre-wrap">${esc(p.caption)}</p>`}
    ${p.targets.map((t) => `<div class="target"><span class="dot ${t.platform}"></span>${esc(t.account_name)}
      <span class="status ${t.status}">${t.status}</span>
      ${t.permalink ? `<a href="${esc(t.permalink)}" target="_blank" rel="noopener">View</a>` : ''}
      ${t.error ? `<small class="muted">${esc(t.error)}</small>` : ''}</div>`).join('')}
    <div class="row" style="margin-top:16px">
      ${editable ? '<button class="btn primary" id="dlg-save">Save</button>' : ''}
      ${p.targets.some((t) => t.status === 'failed') ? '<button class="btn" id="dlg-retry">Retry failed</button>' : ''}
      <button class="btn danger" id="dlg-delete">Delete</button>
      <button class="btn ghost" id="dlg-close">Close</button>
    </div>`;
  dlg.showModal();
  $('#dlg-close').onclick = () => dlg.close();
  $('#dlg-delete').onclick = async () => {
    const msg = p.targets.some((t) => t.status === 'published')
      ? 'Remove this from your calendar? (It stays on Facebook/Instagram.)' : 'Delete this scheduled post?';
    if (!confirm(msg)) return;
    await api(`/posts/${id}`, { method: 'DELETE' });
    dlg.close(); renderCalendar();
  };
  if ($('#dlg-save')) $('#dlg-save').onclick = async () => {
    try {
      await api(`/posts/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption: $('#dlg-caption').value, scheduledAt: new Date($('#dlg-when').value).toISOString() }) });
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
    ? accounts.map((a) => `<label><input type="checkbox" name="accountIds" value="${a.id}" data-platform="${a.platform}" checked>
        <span class="dot ${a.platform}"></span>${esc(a.username ? '@' + a.username : a.name)}</label>`).join('')
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
  const hasIg = [...form.querySelectorAll('[name=accountIds]:checked')].some((c) => c.dataset.platform === 'instagram');
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
    return `<div class="tile"><div class="label"><span class="dot ${a.platform}"></span> ${esc(a.name)}</div>
      <div class="value">${last.toLocaleString()} <small class="muted" style="font-size:.85rem">${diff >= 0 ? '+' : ''}${diff}</small></div>${sparkline(a.series)}</div>`;
  }).join('') || '<p class="muted">No follower data yet. Click "Refresh stats", and it will also update automatically every few hours.</p>';

  $('#an-table tbody').innerHTML = posts.map((p) => `<tr>
    <td>${p.permalink ? `<a href="${esc(p.permalink)}" target="_blank" rel="noopener">${esc(p.caption || '(no caption)')}</a>` : esc(p.caption || '(no caption)')}</td>
    <td><span class="dot ${p.platform}"></span> ${esc(p.account_name)}</td>
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
  if (!status.instagramReady) notes.push('Instagram posting needs <code>PUBLIC_BASE_URL</code> to be a public https address. Facebook posts work without it.');
  $('#setup-notes').innerHTML = `<div class="note">${notes.map((n) => `<div>${n}</div>`).join('')}</div>`;

  $('#account-list').innerHTML = accounts.map((a) => `<div class="account">
      ${a.picture_url ? `<img src="${esc(a.picture_url)}" alt="">` : '<span class="avatar"></span>'}
      <div class="grow"><b>${esc(a.name)}</b><div class="muted"><span class="dot ${a.platform}"></span> ${a.platform === 'facebook' ? 'Facebook Page' : 'Instagram' + (a.username ? ' · @' + esc(a.username) : '')}</div></div>
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
