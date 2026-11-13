// Clips tab: upload a long video, get short vertical clips with captions, then schedule them.
// Uses $, esc, api and banner from app.js.
const clipState = { jobs: [], shown: new Map(), timer: null };
const fmtSec = (s) => { s = Math.max(0, Number(s) || 0); const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const fmtLen = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);
const FRAMING_NAMES = { center: 'Fill (center)', left: 'Fill (left side)', right: 'Fill (right side)', fit: 'Whole video' };
const CAPTION_NAMES = { bold: 'Bold captions', clean: 'Clean captions', none: 'No captions' };

async function renderClips() {
  await loadClipJobs();
  if (!clipState.timer) clipState.timer = setInterval(pollClips, 3000);
}

async function pollClips() {
  if ($('#view-clips').hidden) { clearInterval(clipState.timer); clipState.timer = null; return; }
  const busy = clipState.jobs.some((j) => ['queued', 'working'].includes(j.status) || j.clips.some((c) => ['pending', 'rendering'].includes(c.status)));
  if (busy) await loadClipJobs().catch(() => {});
}

async function loadClipJobs() {
  clipState.jobs = await api('/clips');
  drawClipJobs();
}

// Only parts that changed are redrawn, so a clip that is playing keeps playing.
function drawClipJobs() {
  const box = $('#clip-jobs');
  if (!clipState.jobs.length) {
    box.innerHTML = `<div class="empty-clips"><span>${CI.play}</span><b>No clips yet</b><p class="muted">Add a long video above. Your best moments will show up here, ready to schedule.</p></div>`;
    clipState.shown.clear();
    return;
  }
  box.querySelector('.empty-clips')?.remove();
  const ids = new Set(clipState.jobs.map((j) => `job-${j.id}`));
  [...box.children].forEach((el) => { if (!ids.has(el.id)) el.remove(); });
  clipState.jobs.forEach((job, i) => {
    let el = document.getElementById(`job-${job.id}`);
    if (!el) {
      el = document.createElement('div');
      el.id = `job-${job.id}`;
      el.className = 'panel clip-job';
      el.innerHTML = '<div class="clip-job-head"></div><div class="clip-grid"></div>';
    }
    if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null);
    const headHtml = jobHead(job);
    const head = el.querySelector('.clip-job-head');
    if (head.dataset.html !== headHtml) { head.innerHTML = headHtml; head.dataset.html = headHtml; }
    const grid = el.querySelector('.clip-grid');
    const keep = new Set(job.clips.map((c) => `clip-${c.id}`));
    [...grid.children].forEach((c) => { if (!keep.has(c.id)) c.remove(); });
    job.clips.forEach((c, ci) => {
      const html = clipCard(c);
      let card = document.getElementById(`clip-${c.id}`);
      if (!card) { card = document.createElement('article'); card.id = `clip-${c.id}`; card.className = 'clip-card'; }
      if (card.dataset.html !== html) { card.innerHTML = html; card.dataset.html = html; }
      if (grid.children[ci] !== card) grid.insertBefore(card, grid.children[ci] || null);
    });
  });
}

const CI = {
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>',
  flame: '<svg viewBox="0 0 24 24"><path d="M12 2.5c.6 3.2 4.8 5.3 4.8 10a4.8 4.8 0 0 1-9.6 0c0-2.2 1.2-3.6 2.2-4.6.2 1.6.9 2.6 1.9 2.9-.6-2.6-.1-5.6.7-8.3z"/></svg>',
  retry: '<svg viewBox="0 0 24 24"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4"/></svg>',
};

function jobHead(job) {
  const working = ['queued', 'working'].includes(job.status);
  const making = job.clips.filter((c) => ['pending', 'rendering'].includes(c.status)).length;
  const ready = job.clips.filter((c) => c.status === 'ready').length;
  const status = job.status === 'failed' ? `<span class="vchip bad">Didn't work</span>`
    : working ? `<span class="vchip live">${job.status === 'queued' ? 'Waiting its turn' : 'Finding clips'}</span>`
    : making ? `<span class="vchip live">Making clips · ${ready}/${job.clips.length}</span>`
    : `<span class="vchip ok">${job.clips.length} clip${job.clips.length === 1 ? '' : 's'} ready</span>`;
  const pct = working ? job.progress : Math.round((100 * ready) / Math.max(1, job.clips.length));
  const date = new Date(job.created_at.replace(' ', 'T') + 'Z').toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `<div class="clip-job-title">
      <div class="grow"><h2>${esc(job.name)}</h2>
        <span class="muted">${job.duration ? fmtLen(job.duration) + ' video · ' : ''}${esc(date)}</span></div>
      ${status}
      ${job.status === 'failed' ? `<button class="btn ghost" data-job-retry="${job.id}">${CI.retry}Try again</button>` : ''}
      <button class="iconbtn danger" data-job-del="${job.id}" title="Delete this video and its clips" aria-label="Delete this video and its clips">${CI.trash}</button>
    </div>
    ${working || making ? `<div class="clip-progress"><div class="bar"><i style="width:${Math.max(3, pct)}%"></i></div>
      <span class="muted">${esc(job.step || 'Waiting…')}</span></div>` : ''}
    ${job.error ? `<p class="banner error">${esc(job.error)}</p>` : ''}
    ${job.note ? `<p class="clip-note">${esc(job.note)}</p>` : ''}`;
}

function clipCard(c) {
  const ready = c.status === 'ready' && c.url;
  const hot = c.score >= 90 ? ' hot' : '';
  const media = ready
    ? `<button type="button" class="clip-thumb" data-clip-view="${c.id}" aria-label="Play clip">
        ${c.poster_url ? `<img src="${c.poster_url}" alt="" loading="lazy" decoding="async">` : ''}
        <span class="clip-play">${CI.play}</span></button>`
    : `<div class="clip-wait">${c.status === 'failed' ? `<b>Couldn't make this clip</b><small>${esc(c.error || '')}</small><button class="btn ghost" data-clip-remake="${c.id}">${CI.retry}Try again</button>` : `<span class="spinner"></span><small>${c.status === 'rendering' ? 'Making it now…' : 'Waiting its turn…'}</small>`}</div>`;
  return `<div class="clip-media">${media}
      <span class="clip-score${hot}" title="How likely this part is to grab attention, from what is said and how">${CI.flame}${c.score}</span>
      <span class="clip-len">${Math.round(c.length)}s</span></div>
    <div class="clip-body">
      <b class="clip-title" title="${esc(c.title)}">${esc(c.title)}</b>
      <span class="clip-meta">${esc(fmtSec(c.start))}–${esc(fmtSec(c.end))}${c.reason ? ` · ${esc(c.reason.split(' · ')[0])}` : ''}</span>
      ${ready && c.error ? `<span class="clip-warn">${esc(c.error)}</span>` : ''}
      <div class="clip-actions">
        <a class="btn primary${ready ? '' : ' disabled'}" ${ready ? `href="#compose?clip=${c.id}"` : 'aria-disabled="true" tabindex="-1"'}>Schedule</a>
        <button type="button" class="iconbtn" data-clip-edit="${c.id}" title="Edit" aria-label="Edit clip">${CI.edit}</button>
        ${ready ? `<a class="iconbtn" href="${c.url}?download=1" download title="Save to this device" aria-label="Save to this device">${CI.save}</a>` : ''}
        <button type="button" class="iconbtn danger" data-clip-del="${c.id}" title="Delete clip" aria-label="Delete clip">${CI.trash}</button>
      </div>
    </div>`;
}

// Hovering a clip plays a silent preview (computers only). The video is only loaded then,
// so a page full of clips stays light and quick.
const canHover = matchMedia('(hover: hover) and (pointer: fine)').matches;
$('#clip-jobs').addEventListener('mouseover', (e) => {
  if (!canHover) return;
  const thumb = e.target.closest('.clip-thumb');
  if (!thumb || thumb.querySelector('video')) return;
  const c = findClip(Number(thumb.dataset.clipView));
  if (!c?.url) return;
  const v = document.createElement('video');
  Object.assign(v, { src: c.preview_url || c.url, muted: true, loop: true, playsInline: true, preload: 'auto' });
  v.addEventListener('playing', () => v.classList.add('on'), { once: true });
  thumb.appendChild(v);
  v.play().catch(() => {});
  thumb.addEventListener('mouseleave', () => { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); }, { once: true });
});

const fmtSize = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(b >= 1e7 ? 0 : 1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

// If a clip can't start playing, say why instead of spinning forever.
function watchPlayback(video, note) {
  if (!video || !note) return;
  const say = (t) => { note.textContent = t; note.hidden = !t; };
  const slow = setTimeout(() => { if (video.readyState < 3) say('Still loading. The connection to your Mac is slow right now. On the Mac itself, clips open right away.'); }, 8000);
  video.addEventListener('playing', () => { clearTimeout(slow); say(''); });
  video.addEventListener('canplay', () => { clearTimeout(slow); say(''); });
  video.addEventListener('error', () => { clearTimeout(slow); say("This clip couldn't play here. Try Save to download it, or open Viral Clips on your Mac."); });
}

function findClip(id) {
  for (const j of clipState.jobs) { const c = j.clips.find((x) => x.id === id); if (c) return c; }
  return null;
}

// Clicking a clip opens it big, with sound, and the main buttons.
function openClipViewer(id) {
  const c = findClip(id);
  if (!c?.url) return;
  const dlg = $('#clip-dialog');
  dlg.className = 'clip-viewer';
  dlg.innerHTML = `<div class="cv-grid">
      <div class="cv-video"><video src="${c.preview_url || c.url}" poster="${c.poster_url || ''}" controls autoplay playsinline preload="auto"></video>
        <p class="cv-slow" hidden></p></div>
      <div class="cv-side">
        <button type="button" class="iconbtn cv-close" data-close aria-label="Close">✕</button>
        <span class="clip-score${c.score >= 90 ? ' hot' : ''} static">${CI.flame}${c.score}</span>
        <h2>${esc(c.title)}</h2>
        <p class="muted">${Math.round(c.length)} seconds · from ${esc(fmtSec(c.start))} to ${esc(fmtSec(c.end))}</p>
        ${c.reason ? `<div class="cv-tags">${c.reason.split(' · ').map((r) => `<span>${esc(r)}</span>`).join('')}</div>` : ''}
        ${c.text ? `<p class="cv-text">${esc(c.text)}</p>` : ''}
        <div class="cv-actions">
          <a class="btn primary" href="#compose?clip=${c.id}" data-close>Schedule this clip</a>
          <button type="button" class="btn ghost" data-edit>${CI.edit}Edit</button>
          <a class="btn ghost" href="${c.url}?download=1" download>${CI.save}Save${c.size ? ` (${fmtSize(c.size)})` : ''}</a>
        </div>
        <p class="muted small">You're watching a light copy so it starts fast. Save and Schedule use the full-quality clip.</p>
      </div>
    </div>`;
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); }; // tap outside to close
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  dlg.querySelector('[data-edit]').onclick = () => { dlg.close(); openClipEditor(id); };
  watchPlayback(dlg.querySelector('video'), dlg.querySelector('.cv-slow'));
  dlg.showModal();
}

// ---------- New video ----------
const clipForm = $('#clip-form');
const clipChoice = { length: 'medium', captions: 'bold' };
['length', 'captions'].forEach((k) => {
  $(`#clip-${k}`).onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    clipChoice[k] = b.dataset.v;
    $(`#clip-${k}`).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  };
});
clipForm.video.onchange = () => {
  const f = clipForm.video.files[0];
  $('#clip-file-name').textContent = f ? `${f.name} (${Math.round(f.size / 1e6).toLocaleString()} MB)` : 'Choose a long video';
  $('#clip-drop').classList.toggle('picked', Boolean(f));
};
const drop = $('#clip-drop');
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => {
  if (!e.dataTransfer.files.length) return;
  clipForm.video.files = e.dataTransfer.files;
  clipForm.video.onchange();
});

clipForm.onsubmit = (e) => {
  e.preventDefault();
  const file = clipForm.video.files[0];
  const msg = $('#clip-msg');
  if (!file) { msg.textContent = 'Choose a video first.'; return; }
  const fd = new FormData();
  fd.set('length', clipChoice.length);
  fd.set('captions', clipChoice.captions);
  fd.set('framing', clipForm.framing.value);
  fd.set('count', clipForm.count.value);
  fd.set('video', file);
  const bar = $('#clip-upload-bar');
  const btn = clipForm.querySelector('[type=submit]');
  btn.disabled = true;
  bar.hidden = false;
  // Uploading a big video can take a while, so show how far along it is.
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/clips');
  xhr.upload.onprogress = (ev) => {
    if (!ev.lengthComputable) return;
    const pct = Math.round((ev.loaded / ev.total) * 100);
    bar.firstElementChild.style.width = `${pct}%`;
    msg.textContent = pct < 100 ? `Uploading… ${pct}%` : 'Starting…';
  };
  xhr.onload = async () => {
    btn.disabled = false;
    bar.hidden = true;
    bar.firstElementChild.style.width = '0';
    if (xhr.status === 401) { location.href = '/login.html'; return; }
    let data = {};
    try { data = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status >= 400) { msg.textContent = data.error || `Upload failed (${xhr.status}).`; return; }
    msg.textContent = 'Got it! Finding your best clips…';
    setTimeout(() => { if (msg.textContent.startsWith('Got it')) msg.textContent = ''; }, 8000);
    clipForm.video.value = '';
    clipForm.video.onchange();
    await loadClipJobs();
    renderClips();
  };
  xhr.onerror = () => { btn.disabled = false; bar.hidden = true; msg.textContent = 'Upload failed. Check the connection to your Mac and try again.'; };
  xhr.send(fd);
};

// ---------- Buttons on clips and videos ----------
$('#clip-jobs').addEventListener('click', async (e) => {
  const t = e.target.closest('[data-job-del],[data-job-retry],[data-clip-edit],[data-clip-del],[data-clip-view],[data-clip-remake]');
  if (!t) return;
  if (t.dataset.clipView) { openClipViewer(Number(t.dataset.clipView)); return; }
  try {
    if (t.dataset.clipRemake) await api(`/clips/clip/${t.dataset.clipRemake}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (t.dataset.jobDel) {
      if (!confirm('Delete this video and all of its clips? Posts you already scheduled are not affected.')) return;
      await api(`/clips/${t.dataset.jobDel}`, { method: 'DELETE' });
    }
    if (t.dataset.jobRetry) await api(`/clips/${t.dataset.jobRetry}/retry`, { method: 'POST' });
    if (t.dataset.clipDel) {
      if (!confirm('Delete this clip?')) return;
      await api(`/clips/clip/${t.dataset.clipDel}`, { method: 'DELETE' });
    }
    if (t.dataset.clipEdit) { openClipEditor(Number(t.dataset.clipEdit)); return; }
    await loadClipJobs();
  } catch (err) { banner(err.message, true); }
});

function openClipEditor(id) {
  const c = findClip(id);
  if (!c) return;
  const dlg = $('#clip-dialog');
  dlg.className = 'clip-editor';
  dlg.onclick = null;
  dlg.innerHTML = `<form method="dialog" class="clip-edit">
    <h2>Edit clip</h2>
    ${c.url ? `<video src="${c.preview_url || c.url}" poster="${c.poster_url || ''}" controls playsinline preload="metadata"></video>` : ''}
    <div class="clip-times">
      <label class="field"><span>Starts at <small id="ce-start-f">${fmtSec(c.start)}</small></span>
        <div class="nudge"><button type="button" data-nudge="start" data-by="-1">−1s</button><input type="number" name="start" step="0.1" min="0" value="${c.start}"><button type="button" data-nudge="start" data-by="1">+1s</button></div></label>
      <label class="field"><span>Ends at <small id="ce-end-f">${fmtSec(c.end)}</small></span>
        <div class="nudge"><button type="button" data-nudge="end" data-by="-1">−1s</button><input type="number" name="end" step="0.1" min="0" value="${c.end}"><button type="button" data-nudge="end" data-by="1">+1s</button></div></label>
    </div>
    <p class="muted small" id="ce-len"></p>
    <div class="clip-times">
      <label class="field"><span>Framing</span><select name="framing">${Object.entries(FRAMING_NAMES).map(([k, v]) => `<option value="${k}"${k === c.framing ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field"><span>Captions</span><select name="captions">${Object.entries(CAPTION_NAMES).map(([k, v]) => `<option value="${k}"${k === c.captions ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    </div>
    <label class="field"><span>Words on screen <small>Fix any misheard words, like names.</small></span>
      <textarea name="text" rows="5">${esc(c.text)}</textarea></label>
    <label class="field"><span>Name <small>(also the suggested YouTube title)</small></span><input name="title" maxlength="100" value="${esc(c.title)}"></label>
    <div class="row"><button class="btn primary" value="save">Save and remake clip</button><button class="btn ghost" value="cancel" formnovalidate>Cancel</button><span class="muted" id="ce-msg"></span></div>
  </form>`;
  const f = dlg.querySelector('form');
  const showLen = () => {
    $('#ce-start-f').textContent = fmtSec(f.start.value);
    $('#ce-end-f').textContent = fmtSec(f.end.value);
    const len = f.end.value - f.start.value;
    $('#ce-len').textContent = `Clip length: ${len > 0 ? Math.round(len) : 0} seconds${len > 90 ? ' (over 90s: fine for YouTube Shorts and TikTok, too long for a Facebook Reel)' : ''}`;
  };
  showLen();
  f.addEventListener('input', showLen);
  f.querySelectorAll('[data-nudge]').forEach((b) => (b.onclick = () => {
    const input = f[b.dataset.nudge];
    input.value = Math.max(0, Math.round((Number(input.value) + Number(b.dataset.by)) * 10) / 10);
    showLen();
  }));
  f.onsubmit = async (e) => {
    if (e.submitter?.value !== 'save') return;
    e.preventDefault();
    try {
      await api(`/clips/clip/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: Number(f.start.value), end: Number(f.end.value), framing: f.framing.value, captions: f.captions.value, text: f.text.value, title: f.title.value }),
      });
      dlg.close();
      await loadClipJobs();
      renderClips();
    } catch (err) { $('#ce-msg').textContent = err.message; }
  };
  dlg.showModal();
}
$('#clip-dialog').addEventListener('close', () => { const d = $('#clip-dialog'); if (!d.open) d.innerHTML = ''; }); // stops a playing preview

// ---------- "Paste a link" helper ----------
// YouTube and TikTok don't let apps download videos, so for those (and for posts that aren't on
// a connected account) this shows the official way to get the file from each one.
function youtubeId(url) {
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/|studio\.youtube\.com\/video\/)([\w-]{11})/i);
  return m ? m[1] : null;
}

function linkSteps(raw) {
  const url = raw.trim();
  if (!url) return '';
  const last = '<li>Come back here, click <b>Choose a long video</b> above and pick the file you saved.</li>';
  const id = youtubeId(url);
  if (id) {
    return `<p>This is a YouTube video. If it's on <b>your</b> channel, YouTube lets you download it:</p>
      <ol><li><a class="btn primary" href="https://studio.youtube.com/video/${esc(id)}/edit" target="_blank" rel="noopener">Open this video in YouTube Studio</a>
        <br><small>Sign in with the account that owns the channel if it asks.</small></li>
      <li>At the top right, click <b>⋮</b> (three dots), then <b>Download</b>. The video saves to your Downloads folder.</li>
      ${last}</ol>
      <p class="muted small">If YouTube Studio says you don't have access, the video belongs to someone else. Ask them to send you the file and their OK to post clips from it.</p>`;
  }
  if (/youtube\.com|youtu\.be/i.test(url)) return '<p>That looks like a YouTube link, but not to a single video. Open the video itself and copy its link from the address bar or the Share button.</p>';
  if (/tiktok\.com/i.test(url)) {
    return `<p>This is a TikTok video. For your own videos:</p>
      <ol><li>In the TikTok app, open the video and tap <b>Share</b> (the arrow), then <b>Save video</b>. It goes to your phone's Photos.</li>
      <li>On your iPhone, open Viral Post, go to <b>Clips</b> and pick it from Photos. Or AirDrop it to your Mac.</li></ol>`;
  }
  if (/instagram\.com/i.test(url)) {
    return `<p>This is an Instagram video. The best copy is the original on your phone (Photos app). If you don't have it anymore:</p>
      <ol><li>In Instagram, go to your profile, tap <b>☰</b>, then <b>Your activity</b> → <b>Download your information</b>, and ask for your media.</li>
      <li>Instagram emails a link when the file is ready.</li>${last}</ol>`;
  }
  if (/^https?:\/\/([\w-]+\.)*(facebook\.com|fb\.watch)\//i.test(url)) {
    return `<p>This is a Facebook video. For videos you posted:</p>
      <ol><li><a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">Open it on Facebook</a></li>
      <li>Click <b>⋯</b> (three dots) on the post, then <b>Download video</b>.</li>${last}</ol>`;
  }
  return '<p>Use the original video file from your phone, camera or computer, then click <b>Choose a long video</b> above.</p>';
}
// "Get video": brings the video in through the official ways (see src/linkimport.js). If there
// is none for this link, the official steps to get the file are shown instead.
async function getLinkedVideo() {
  const input = $('#clip-link-input');
  const out = $('#clip-link-steps');
  const btn = $('#clip-link-go');
  const url = input.value.trim();
  if (!url) { out.innerHTML = '<p>Paste a link first.</p>'; return; }
  btn.disabled = true;
  out.innerHTML = '<p class="muted">Checking the link…</p>';
  try {
    const res = await fetch('/api/clips/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, length: clipChoice.length, captions: clipChoice.captions, framing: clipForm.framing.value, count: clipForm.count.value }),
    });
    if (res.status === 401) { location.href = '/login.html'; return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const steps = res.status === 422 && ['youtube', 'tiktok', 'instagram', 'facebook'].includes(data.platform) && !/connect your/i.test(data.error || '') ? linkSteps(url) : '';
      out.innerHTML = `<p class="why">${esc(data.error || `That didn't work (${res.status}).`)}</p>${steps}`;
      return;
    }
    input.value = '';
    out.innerHTML = `<p class="why">Got it! ${data.how === 'local' ? 'This video was posted by Viral Post, so the original file was already on your Mac.' : `Bringing it in from ${esc(data.from || 'your account')}.`} Your clips will show up below.</p>`;
    await loadClipJobs();
    renderClips();
  } catch {
    out.innerHTML = '<p class="why">Could not reach your Mac. Check the connection and try again.</p>';
  } finally { btn.disabled = false; }
}
$('#clip-link-go').onclick = getLinkedVideo;
$('#clip-link-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); getLinkedVideo(); } });
$('#clip-link-input').addEventListener('input', () => { $('#clip-link-steps').innerHTML = ''; });
