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
    box.innerHTML = '<p class="muted empty-clips">Your clips will show up here.</p>';
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

function jobHead(job) {
  const working = ['queued', 'working'].includes(job.status);
  const making = job.clips.filter((c) => ['pending', 'rendering'].includes(c.status)).length;
  const status = job.status === 'failed' ? `<span class="pill bad">Didn't work</span>`
    : working ? `<span class="pill">${job.status === 'queued' ? 'Waiting its turn' : 'Working'}</span>`
    : making ? `<span class="pill">Making ${making} clip${making > 1 ? 's' : ''}</span>`
    : `<span class="pill ok">${job.clips.length} clip${job.clips.length === 1 ? '' : 's'}</span>`;
  return `<div class="row clip-job-title">
      <div class="grow"><h2>${esc(job.name)}</h2>
        <span class="muted small">${job.duration ? fmtLen(job.duration) + ' video · ' : ''}${esc(new Date(job.created_at.replace(' ', 'T') + 'Z').toLocaleDateString([], { month: 'short', day: 'numeric' }))}</span></div>
      ${status}
      ${job.status === 'failed' ? `<button class="btn ghost" data-job-retry="${job.id}">Try again</button>` : ''}
      <button class="btn ghost danger" data-job-del="${job.id}" title="Delete this video and its clips">Delete</button>
    </div>
    ${working || making ? `<div class="bar"><i style="width:${working ? job.progress : Math.round(100 * (1 - making / Math.max(1, job.clips.length)))}%"></i></div><p class="muted small">${esc(job.step || 'Waiting…')}</p>` : ''}
    ${job.error ? `<p class="banner error">${esc(job.error)}</p>` : ''}
    ${job.note ? `<p class="muted small">${esc(job.note)}</p>` : ''}`;
}

function clipCard(c) {
  const ready = c.status === 'ready' && c.url;
  const media = ready
    ? `<video src="${c.url}" poster="${c.poster_url || ''}" preload="none" controls playsinline></video>`
    : `<div class="clip-wait">${c.status === 'failed' ? `<b>Couldn't make this clip</b><small>${esc(c.error || '')}</small>` : `<span class="spinner"></span><small>${c.status === 'rendering' ? 'Making it now…' : 'Waiting its turn…'}</small>`}</div>`;
  return `<div class="clip-media">${media}
      <span class="clip-score" title="How likely this part is to grab attention, from what is said and how">${c.score}</span>
      <span class="clip-len">${Math.round(c.length)}s</span></div>
    <div class="clip-body">
      <b class="clip-title">${esc(c.title)}</b>
      <span class="muted small">${esc(fmtSec(c.start))}–${esc(fmtSec(c.end))} · ${esc(c.reason || '')}</span>
      ${ready && c.error ? `<span class="small warn-text">${esc(c.error)}</span>` : ''}
      <div class="row clip-actions">
        <a class="btn primary${ready ? '' : ' disabled'}" ${ready ? `href="#compose?clip=${c.id}"` : 'aria-disabled="true"'}>Schedule</a>
        <button class="btn ghost" data-clip-edit="${c.id}">Edit</button>
        ${ready ? `<a class="btn ghost" href="${c.url}?download=1" download title="Save to this device">Save</a>` : ''}
        <button class="btn ghost icon-btn" data-clip-del="${c.id}" title="Delete clip" aria-label="Delete clip">✕</button>
      </div>
    </div>`;
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
  const t = e.target.closest('[data-job-del],[data-job-retry],[data-clip-edit],[data-clip-del]');
  if (!t) return;
  try {
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
  const job = clipState.jobs.find((j) => j.clips.some((c) => c.id === id));
  const c = job.clips.find((x) => x.id === id);
  const dlg = $('#clip-dialog');
  dlg.innerHTML = `<form method="dialog" class="clip-edit">
    <h2>Edit clip</h2>
    ${c.url ? `<video src="${c.url}" poster="${c.poster_url || ''}" controls playsinline></video>` : ''}
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
$('#clip-dialog').addEventListener('close', () => { $('#clip-dialog').innerHTML = ''; }); // stops a playing preview

// ---------- "Paste a link" helper ----------
// Viral Post never downloads from YouTube, TikTok, Instagram or Facebook (their rules don't allow
// it). For your own videos, this shows the official way to get the file from each one.
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
$('#clip-link-input').addEventListener('input', (e) => { $('#clip-link-steps').innerHTML = linkSteps(e.target.value); });
