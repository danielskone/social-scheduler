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
