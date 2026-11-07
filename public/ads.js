// Viral Ads Studio: describe an ad (or paste a script), pick a style, and get a finished video ad
// in every shape, ready to schedule. Uses $, esc, api and banner from app.js.
const AS = { opts: null, brands: [], products: [], media: [], ads: [], ad: null, picked: [], timer: null, saveTimer: null, sub: 'create', draft: null };

const AI = {
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/></svg>',
  img: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/></svg>',
  speaker: '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
};
const LOOK_NAMES = { bold: 'Bold', clean: 'Clean', cinematic: 'Cinematic' };
const LOOK_INFO = { bold: 'Big words, brand colour, punchy', clean: 'Simple white captions', cinematic: 'Moody, soft, story feel' };
const PACE_NAMES = { calm: 'Calm', normal: 'Normal', fast: 'Fast' };
const FORMAT_SHORT = { '9x16': '9:16', '4x5': '4:5', '1x1': '1:1', '16x9': '16:9' };

// Starter ideas (they only fill in the form; nothing is made until "Write my ad").
const AD_IDEAS = [
  { tag: 'Event promo', title: 'Parade sponsors wanted', recipe: 'event', look: 'bold', length: 30,
    details: { name: 'the Fuquay-Varina Christmas Parade', about: 'Put your business in front of thousands of families at the biggest holiday parade in town.', points: 'Your logo seen by thousands of families\nShout-outs on our social pages\nSupport a great local tradition', offer: 'Sponsor spots are open now', cta: 'Become a sponsor', website: 'fuquayvarinachristmasparade.org/parade/sponsorship' } },
  { tag: 'Event promo', title: 'Enter a float', recipe: 'question', look: 'bold', length: 15,
    details: { name: 'the Christmas Parade', about: 'Bring your group, club or business and ride in the parade this year.', points: 'Want your group in the parade this year\nFloats, cars, bands and walking groups welcome', offer: 'Registration is open', cta: 'Register today', website: 'fuquayvarinachristmasparade.org' } },
  { tag: 'Big offer', title: 'Weekend car sale', recipe: 'offer', look: 'bold', length: 30,
    details: { name: 'Daniel King Automotive', about: 'Quality used cars at fair prices, with easy financing.', points: 'Every car inspected before it is sold\nEasy financing, even with less than perfect credit\nTrade-ins welcome', offer: 'This weekend only: special pricing on every car', cta: 'Call us today', website: '' } },
  { tag: '3 reasons why', title: 'Get more customers', recipe: 'reasons', look: 'clean', length: 30,
    details: { name: 'Viral Attraction', about: 'We help local businesses get more customers from social media.', points: 'Scroll-stopping videos made for you\nPosts that go out on time, every day\nMore calls, more bookings, more sales', offer: 'Book a free intro call', cta: 'Book a call', website: 'viralattraction.com' } },
];

async function renderAds(sub) {
  AS.sub = sub || 'create';
  document.querySelectorAll('#ads-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.sub === (/^\d+$/.test(AS.sub) ? 'list' : AS.sub)));
  const body = $('#ads-body');
  if (!AS.opts) AS.opts = await api('/ads/options').catch(() => ({ formats: [], voices: [], recipes: {}, looks: [], paces: [], lengths: [], ctas: [] }));
  [AS.brands, AS.products, AS.media] = await Promise.all([api('/ads/brands'), api('/ads/products'), api('/ads/media')]);
  if (/^\d+$/.test(AS.sub)) return openAd(Number(AS.sub));
  AS.ad = null;
  if (AS.sub === 'list') { AS.ads = await api('/ads'); body.innerHTML = adList(); startAdPoll(); return; }
  if (AS.sub === 'brands') { body.innerHTML = brandsPage(); return; }
  if (AS.sub === 'products') { body.innerHTML = productsPage(); return; }
  if (AS.sub === 'media') { body.innerHTML = mediaPage(); return; }
  if (AS.sub === 'presenters') { body.innerHTML = presentersPage(); return; }
  if (AS.sub === 'voices') { body.innerHTML = voicesPage(); return; }
  AS.ads = await api('/ads');
  body.innerHTML = createPage();
  drawPicked();
}

// ---------- Create ----------
const opt = (v, label, sel) => `<option value="${esc(v)}"${String(sel ?? '') === String(v) ? ' selected' : ''}>${esc(label)}</option>`;
function voiceOptions(sel) {
  const vs = AS.opts.voices || [];
  if (!vs.length) return opt('', 'No voice on this computer');
  return vs.map((v) => opt(v.id, `${v.name}${v.lang && v.lang !== 'en_US' ? ` · ${v.lang.replace('en_', '')}` : ''}`, sel)).join('');
}
function createPage() {
  const d = AS.draft || {};
  const dd = d.details || {};
  const recent = AS.ads.slice(0, 4);
  return `<form id="ad-new" class="ads-hero panel">
      <div class="ads-hero-head">
        <span class="ads-badge">${AI.spark}Viral Ads Studio</span>
        <h2 class="ads-hero-title"><mark>Describe it, pick a style.</mark><br>We make the video ad.</h2>
      </div>
      <div class="ads-prompt">
        <label class="ads-add" title="Add photos or videos">
          <input type="file" id="ad-new-files" accept="image/*,video/*" multiple hidden>${AI.plus}<small>Photos <br>&amp; videos</small></label>
        <div class="ads-prompt-main">
          <textarea name="about" rows="3" placeholder="Describe your ad or paste a script. For example: “Weekend sale at Daniel King Automotive. Every car inspected, easy financing, trade-ins welcome.”">${esc(dd.about || '')}</textarea>
          <div id="ad-picked" class="ad-picked"></div>
          <div class="ads-chips">
            <label class="ads-chip"><span>Style</span><select name="recipe">${opt('auto', 'Auto', d.recipe)}${Object.entries(AS.opts.recipes).map(([k, v]) => opt(k, v, d.recipe)).join('')}</select></label>
            <label class="ads-chip"><span>Look</span><select name="look">${AS.opts.looks.map((l) => opt(l, LOOK_NAMES[l] || l, d.look || 'bold')).join('')}</select></label>
            <label class="ads-chip"><span>Brand</span><select name="brand_id">${opt('', 'None')}${AS.brands.map((b) => opt(b.id, b.name, d.brand_id)).join('')}</select></label>
            <label class="ads-chip"><span>Product</span><select name="product_id">${opt('', 'None')}${AS.products.map((p) => opt(p.id, p.name, d.product_id)).join('')}</select></label>
            <label class="ads-chip"><span>Voice</span><select name="voice">${voiceOptions(d.voice)}</select></label>
            <label class="ads-chip"><span>Length</span><select name="length">${AS.opts.lengths.map((l) => opt(l, `${l}s`, d.length || 30)).join('')}</select></label>
          </div>
        </div>
      </div>
      <div class="ads-row2">
        <div class="ads-formats" role="group" aria-label="Shapes">${AS.opts.formats.map((f) => `<label class="ads-format" title="${esc(f.for)}"><input type="checkbox" name="formats" value="${f.id}"${(d.formats || ['9x16']).includes(f.id) ? ' checked' : ''}><i class="shape s${f.id}"></i><span><b>${FORMAT_SHORT[f.id]}</b><small>${esc(f.for)}</small></span></label>`).join('')}</div>
        <button class="btn primary ads-go" type="submit">${AI.spark}Write my ad</button>
      </div>
      <details class="ads-more"${dd.name || dd.points ? ' open' : ''}>
        <summary>Add details for a better script <small>(what it is, selling points, offer, call to action)</small></summary>
        <div class="ads-more-grid">
          <label class="field"><span>What are you promoting?</span><input name="name" value="${esc(dd.name || '')}" placeholder="e.g. Daniel King Automotive"></label>
          <label class="field"><span>Offer or date <small>(optional)</small></span><input name="offer" value="${esc(dd.offer || '')}" placeholder="e.g. This weekend only: 0% financing"></label>
          <label class="field ads-span2"><span>Selling points <small>(one per line)</small></span><textarea name="points" rows="3" placeholder="Every car inspected&#10;Easy financing&#10;Trade-ins welcome">${esc(dd.points || '')}</textarea></label>
          <label class="field"><span>Call to action</span><input name="cta" list="ad-ctas" value="${esc(dd.cta || '')}" placeholder="Learn more"><datalist id="ad-ctas">${AS.opts.ctas.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
          <label class="field"><span>Website</span><input name="website" value="${esc(dd.website || '')}" placeholder="e.g. viralattraction.com"></label>
        </div>
      </details>
      <p id="ad-new-msg" class="clip-msg" aria-live="polite"></p>
    </form>
    <h2 class="ads-section-title">Ideas to start from</h2>
    <div class="ads-ideas">${AD_IDEAS.map((idea, i) => `<button type="button" class="ads-idea" data-idea="${i}">
        <span class="ads-idea-tag">${esc(idea.tag)}</span><b>${esc(idea.title)}</b><small>${esc(idea.details.about)}</small></button>`).join('')}</div>
    ${recent.length ? `<div class="ads-section-row"><h2 class="ads-section-title">Your latest ads</h2><a href="#ads/list" class="btn ghost">See all</a></div><div class="ads-grid">${recent.map(adCard).join('')}</div>` : ''}
    <p class="muted clip-fine">Everything runs on your Mac for free. The voice is your Mac's own. To use Siri, set Siri as the System voice in System Settings → Accessibility → Spoken Content, then pick “Siri” here. For more voices, add free “Premium” or “Enhanced” voices there with Manage Voices; they show up here on their own.</p>`;
}

function drawPicked() {
  const box = $('#ad-picked');
  if (!box) return;
  box.innerHTML = AS.picked.map((f) => {
    const m = AS.media.find((x) => x.file === f);
    return m ? `<span class="ad-pick">${adThumb(m)}<button type="button" data-unpick="${esc(f)}" aria-label="Remove">×</button></span>` : '';
  }).join('') + (AS.media.some((m) => m.kind !== 'audio' && !AS.picked.includes(m.file))
    ? `<button type="button" class="ad-pick-lib" data-pick-lib>${AI.img}From your media</button>` : '');
}
function adThumb(m, cls = '') {
  if (!m) return `<span class="ad-thumb empty ${cls}">${AI.img}</span>`;
  return `<span class="ad-thumb ${cls}">${m.thumb_url ? `<img src="${esc(m.thumb_url)}" alt="" loading="lazy">` : AI.img}${m.kind === 'video' ? `<i>${AI.play}</i>` : ''}</span>`;
}

async function uploadAdMedia(files, msgEl) {
  if (!files.length) return [];
  const fd = new FormData();
  [...files].forEach((f) => fd.append('files', f));
  if (msgEl) msgEl.textContent = `Adding ${files.length} file${files.length === 1 ? '' : 's'}…`;
  try {
    const added = await api('/ads/media', { method: 'POST', body: fd });
    AS.media = [...added, ...AS.media];
    if (msgEl) msgEl.textContent = '';
    return added;
  } catch (e) { if (msgEl) msgEl.textContent = e.message; return []; }
}

function formValues(form) {
  const v = (n) => form.elements[n]?.value ?? '';
  return {
    recipe: v('recipe'), look: v('look'), voice: v('voice'), length: Number(v('length')) || 30,
    brand_id: v('brand_id') || null, product_id: v('product_id') || null,
    formats: [...form.querySelectorAll('[name=formats]:checked')].map((c) => c.value),
    details: { about: v('about'), name: v('name'), points: v('points'), offer: v('offer'), cta: v('cta'), website: v('website') },
  };
}

// ---------- Ads list ----------
function adStatus(a) {
  if (a.status === 'failed') return '<span class="vchip bad">Didn\'t work</span>';
  if (a.status === 'queued') return '<span class="vchip live">Waiting its turn</span>';
  if (a.status === 'working') return `<span class="vchip live">Making · ${a.progress}%</span>`;
  if (a.status === 'ready') return '<span class="vchip ok">Ready</span>';
  return '<span class="vchip">Draft</span>';
}
function adCard(a) {
  const outs = Object.values(a.outputs);
  const first = outs[0];
  const media = a.media[0];
  const pic = first?.poster_url || media?.thumb_url;
  return `<a class="ads-card" href="#ads/${a.id}">
      <span class="ads-card-media">${pic ? `<img src="${esc(pic)}" alt="" loading="lazy">` : `<span class="ads-card-ph">${AI.spark}</span>`}
        ${first ? `<span class="clip-len">${Math.round(first.duration)}s</span>` : ''}</span>
      <span class="ads-card-body"><b>${esc(a.name)}</b>
        <span class="row">${adStatus(a)}<small>${(outs.length ? outs.map((o) => FORMAT_SHORT[o.format]) : a.formats.map((f) => FORMAT_SHORT[f])).join(' · ')}</small></span></span>
    </a>`;
}
function adList() {
  return AS.ads.length ? `<div class="ads-grid">${AS.ads.map(adCard).join('')}</div>`
    : `<div class="empty-clips"><span>${AI.spark}</span><b>No ads yet</b><p class="muted">Describe your first ad on the <a href="#ads">Create</a> page.</p></div>`;
}
function startAdPoll() {
  if (AS.timer) return;
  AS.timer = setInterval(async () => {
    if ($('#view-ads').hidden) { clearInterval(AS.timer); AS.timer = null; return; }
    if (AS.ad) {
      if (!['queued', 'working'].includes(AS.ad.status)) return;
      const a = await api(`/ads/${AS.ad.id}`).catch(() => null);
      if (a && AS.ad && a.id === AS.ad.id) { AS.ad.status = a.status; AS.ad.step = a.step; AS.ad.progress = a.progress; AS.ad.error = a.error; AS.ad.note = a.note; AS.ad.outputs = a.outputs; drawResults(); }
    } else if (AS.sub === 'list' && AS.ads.some((a) => ['queued', 'working'].includes(a.status))) {
      AS.ads = await api('/ads').catch(() => AS.ads);
      $('#ads-body').innerHTML = adList();
    }
  }, 2500);
}

// ---------- Ad editor ----------
async function openAd(id) {
  try { AS.ad = await api(`/ads/${id}`); } catch (e) { $('#ads-body').innerHTML = `<p class="banner error">${esc(e.message)}</p>`; return; }
  drawEditor();
  startAdPoll();
}

function drawEditor() {
  const a = AS.ad;
  const body = $('#ads-body');
  body.innerHTML = `<div class="ad-edit">
    <div class="ad-edit-head panel">
      <input class="ad-name" name="name" value="${esc(a.name)}" aria-label="Ad name">
      <span id="ad-status">${adStatus(a)}</span>
      <span class="grow"></span>
      <button type="button" class="iconbtn" data-ad-copy title="Make a copy" aria-label="Make a copy">${AI.copy}</button>
      <button type="button" class="iconbtn danger" data-ad-del title="Delete this ad" aria-label="Delete this ad">${AI.trash}</button>
      <button type="button" class="btn primary" data-ad-render>${AI.play}Make my video</button>
    </div>
    <div class="ad-cols">
      <div class="ad-left">
        <div id="ad-results"></div>
        <div class="panel">
          <div class="panel-head"><h2>Script</h2>
            <div class="row"><select id="ad-recipe" aria-label="Style">${Object.entries(AS.opts.recipes).filter(([k]) => k !== 'script').map(([k, v]) => opt(k, v, a.recipe)).join('')}</select>
            <button type="button" class="btn ghost" data-ad-rewrite>${AI.redo}Write it again</button>
            <button type="button" class="ad-ai-btn" data-ad-presenter>${AI.spark}AI presenter</button></div></div>
          <p class="muted ad-help">Each scene is one picture or video with a few big words on screen, while the voice says the line. Change anything you like.</p>
          <div id="ad-scenes"></div>
          <button type="button" class="btn ghost" data-scene-add>${AI.plus}Add a scene</button>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>Post caption</h2><small>Used when you schedule this ad</small></div>
          <textarea id="ad-caption" rows="7">${esc(a.caption || '')}</textarea>
        </div>
      </div>
      <div class="ad-right">
        <div class="panel ad-settings">
          <h2>Style</h2>
          <div class="field"><span>Look</span><div class="ad-looks">${AS.opts.looks.map((l) => `<button type="button" data-look="${l}" class="ad-look l-${l}${a.look === l ? ' on' : ''}"><i></i><b>${LOOK_NAMES[l]}</b><small>${LOOK_INFO[l]}</small></button>`).join('')}</div></div>
          <div class="field"><span>Voice</span><div class="row"><select id="ad-voice" class="grow">${voiceOptions(a.voice)}</select><button type="button" class="iconbtn" data-voice-test title="Hear this voice" aria-label="Hear this voice">${AI.speaker}</button></div>
            <div class="seg ad-pace">${AS.opts.paces.map((p) => `<button type="button" data-pace="${p}"${a.pace === p ? ' class="on"' : ''}>${PACE_NAMES[p] || p}</button>`).join('')}</div></div>
          <div class="field"><span>Shapes to make</span><div class="ads-formats compact">${AS.opts.formats.map((f) => `<label class="ads-format" title="${esc(f.for)}"><input type="checkbox" data-format value="${f.id}"${a.formats.includes(f.id) ? ' checked' : ''}><i class="shape s${f.id}"></i><span><b>${FORMAT_SHORT[f.id]}</b><small>${esc(f.for)}</small></span></label>`).join('')}</div></div>
          <label class="field"><span>Brand <small>(logo, colour, website)</small></span><select id="ad-brand">${opt('', 'None')}${AS.brands.map((b) => opt(b.id, b.name, a.brand_id)).join('')}</select>
            <small><a href="#ads/brands">Add or change brands</a></small></label>
          <div class="field"><span>Background music <small>(optional, your own or royalty-free)</small></span>
            <div class="row"><select id="ad-music" class="grow">${opt('', 'No music')}${AS.media.filter((m) => m.kind === 'audio').map((m) => opt(m.file, m.name || m.file, a.music?.file)).join('')}</select>
            <label class="btn ghost">${AI.plus}Add<input type="file" id="ad-music-file" accept="audio/*,.mp3,.m4a,.wav" hidden></label></div>
            <small>Free music: YouTube Studio → Audio Library. Never use songs you don't own.</small></div>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>Photos & videos</h2><label class="btn ghost">${AI.plus}Add<input type="file" id="ad-media-file" accept="image/*,video/*" multiple hidden></label></div>
          <div class="ad-media-strip">${a.media.length ? a.media.map((m) => `<span class="ad-pick">${adThumb(m)}<button type="button" data-ad-unmedia="${esc(m.file)}" aria-label="Remove">×</button></span>`).join('') : '<small class="muted">No photos or videos yet. Scenes without one get a moving background in your brand colour.</small>'}</div>
          ${AS.media.some((m) => m.kind !== 'audio' && !a.media.some((x) => x.file === m.file)) ? `<button type="button" class="ad-pick-lib" data-ad-lib>${AI.img}Pick from your media</button>` : ''}
        </div>
      </div>
    </div>
  </div>`;
  drawScenes();
  drawResults();
}

function sceneMediaOptions(sel) {
  const list = [...AS.ad.media, ...AS.media.filter((m) => m.kind !== 'audio' && !AS.ad.media.some((x) => x.file === m.file))];
  return opt('', 'Colour background', sel) + list.map((m, i) => opt(m.file, `${m.kind === 'video' ? 'Video' : 'Photo'} ${i + 1}${m.name ? ` · ${m.name.slice(0, 26)}` : ''}`, sel)).join('');
}
function drawScenes() {
  const scenes = AS.ad.scenes;
  $('#ad-scenes').innerHTML = scenes.map((s, i) => {
    const m = AS.media.find((x) => x.file === s.media) || AS.ad.media.find((x) => x.file === s.media);
    return `<div class="ad-scene${s.endCard ? ' end' : ''}" data-i="${i}">
      <div class="ad-scene-side"><span class="ad-scene-n">${i + 1}</span>${adThumb(m, 'big')}</div>
      <div class="ad-scene-main">
        <label class="ad-mini"><span>On screen</span><input data-k="headline" value="${esc(s.headline)}" maxlength="60" placeholder="A few big words (optional)"></label>
        <label class="ad-mini"><span>${s.sound === 'video' ? 'Captions' : 'Voice says'}</span><textarea data-k="say" rows="2" maxlength="400" placeholder="${s.sound === 'video' ? 'Optional' : 'What the voice says in this scene'}">${esc(s.say)}</textarea></label>
        <div class="ad-scene-opts">
          <select data-k="media" aria-label="Picture">${sceneMediaOptions(s.media)}</select>
          ${m?.kind === 'video' ? `<select data-k="sound" aria-label="Sound">${opt('voice', 'Voiceover', s.sound)}${m.has_audio ? opt('video', "Video's own sound", s.sound) : ''}</select>` : ''}
          ${m ? `<select data-k="framing" aria-label="Framing">${opt('auto', 'Auto fit', s.framing)}${opt('fill', 'Fill screen', s.framing)}${opt('fit', 'Show whole', s.framing)}</select>` : ''}
          <label class="ad-secs"><input data-k="seconds" type="number" min="1.5" max="60" step="0.5" value="${s.seconds || ''}" placeholder="auto">s</label>
          <label class="ad-endcard" title="Shows your logo and website big, like the end of a TV ad"><input type="checkbox" data-k="endCard"${s.endCard ? ' checked' : ''}>End card</label>
          ${s.endCard ? '' : `<button type="button" class="ad-ai-btn" data-scene-ai="${i}">${AI.spark}Make with AI (free)</button>`}
        </div>
      </div>
      <div class="ad-scene-tools">
        <button type="button" class="iconbtn" data-scene-up="${i}" aria-label="Move up"${i === 0 ? ' disabled' : ''}>${AI.up}</button>
        <button type="button" class="iconbtn" data-scene-down="${i}" aria-label="Move down"${i === scenes.length - 1 ? ' disabled' : ''}>${AI.down}</button>
        <button type="button" class="iconbtn danger" data-scene-del="${i}" aria-label="Remove scene">${AI.trash}</button>
      </div>
    </div>`;
  }).join('') || '<p class="muted">No scenes yet.</p>';
  const secs = scenes.reduce((t, s) => t + (Number(s.seconds) || Math.max(2.4, (s.say || '').split(/\s+/).filter(Boolean).length / 2.6 + 0.6)), 0);
  $('#ad-scenes').insertAdjacentHTML('beforeend', `<p class="muted ad-total">About ${Math.round(secs)} seconds · ${scenes.length} scene${scenes.length === 1 ? '' : 's'}</p>`);
}

function drawResults() {
  const a = AS.ad;
  const box = $('#ad-results');
  if (!box) return;
  $('#ad-status').innerHTML = adStatus(a);
  const busy = ['queued', 'working'].includes(a.status);
  const btn = document.querySelector('[data-ad-render]');
  if (btn) { btn.disabled = busy; btn.innerHTML = `${AI.play}${busy ? 'Making…' : Object.keys(a.outputs).length ? 'Make it again' : 'Make my video'}`; }
  const outs = Object.values(a.outputs);
  const key = JSON.stringify([a.status, a.progress, a.step, a.error, a.note, outs.map((o) => o.url)]);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = (busy ? `<div class="panel ad-progress"><b>Making your ad…</b><div class="bar"><i style="width:${Math.max(3, a.progress)}%"></i></div><span class="muted">${esc(a.step || 'Waiting…')}</span>
      <small class="muted">You can leave this page while it works.</small></div>` : '')
    + (a.error ? `<p class="banner error">${esc(a.error)}</p>` : '')
    + (a.note && !busy ? `<p class="clip-note">${esc(a.note)}</p>` : '')
    + (outs.length && !busy ? `<div class="panel"><div class="panel-head"><h2>Your ad</h2><small>${outs.length} shape${outs.length === 1 ? '' : 's'}</small></div>
      <div class="ad-outs">${outs.map((o) => `<div class="ad-out s${o.format}">
        <video src="${esc(o.url)}" poster="${esc(o.poster_url || '')}" controls playsinline preload="none"></video>
        <div class="ad-out-meta"><b>${esc(o.label)}</b><small>${esc(o.for)} · ${Math.round(o.duration)}s</small></div>
        <div class="row"><a class="btn primary" href="#compose?ad=${a.id}&f=${o.format}">Schedule</a>
          <a class="iconbtn" href="${esc(o.url)}?download=1" download title="Save to this device" aria-label="Save to this device">${AI.save}</a></div>
      </div>`).join('')}</div></div>` : '');
}

function saveAdSoon(fields, now = false) {
  Object.assign(AS.pending || (AS.pending = {}), fields);
  clearTimeout(AS.saveTimer);
  const go = async () => {
    const body = AS.pending; AS.pending = null;
    if (!body || !AS.ad) return;
    const id = AS.ad.id;
    try {
      const a = await api(`/ads/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (AS.ad?.id === id) { AS.ad.media = a.media; AS.ad.music = a.music; AS.ad.updated_at = a.updated_at; }
    } catch (e) { banner(e.message, true); }
  };
  if (now) return go();
  AS.saveTimer = setTimeout(go, 600);
}
const saveScenes = () => saveAdSoon({ scenes: AS.ad.scenes });

// ---------- Brands, products, media ----------
function brandsPage() {
  return `<div class="ads-lib-head"><p class="muted">A brand adds your logo, colour, website and usual call to action to every ad.</p></div>
  <div class="ads-lib-grid">${AS.brands.map((b) => `<form class="panel ads-lib-item" data-brand="${b.id}">${brandForm(b)}</form>`).join('')}
    <form class="panel ads-lib-item new" data-brand="new"><h2>New brand</h2>${brandForm({})}</form></div>`;
}
function brandForm(b) {
  return `<div class="ads-brand-top"><label class="ads-logo" title="Logo">${b.logo_url ? `<img src="${esc(b.logo_url)}" alt="">` : `${AI.img}<small>Logo</small>`}<input type="file" accept="image/png,image/jpeg,image/*" data-logo hidden></label>
      <input type="hidden" name="logo" value="${esc(b.logo || '')}">
      <label class="field grow"><span>Name</span><input name="name" value="${esc(b.name || '')}" required placeholder="e.g. Viral Attraction"></label></div>
    <div class="ads-more-grid">
      <label class="field"><span>Website</span><input name="website" value="${esc(b.website || '')}" placeholder="viralattraction.com"></label>
      <label class="field"><span>Call to action</span><input name="cta" list="ad-ctas-b" value="${esc(b.cta || '')}" placeholder="Book a call"><datalist id="ad-ctas-b">${(AS.opts.ctas || []).map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <label class="field"><span>Brand colour</span><input type="color" name="color" value="${esc(b.color || '#FFD60A')}"></label>
    </div>
    <div class="row"><button class="btn primary" type="submit">${b.id ? 'Save' : 'Add brand'}</button>${b.id ? `<button type="button" class="btn danger" data-brand-del="${b.id}">Delete</button>` : ''}<span class="muted" data-msg></span></div>`;
}
function productsPage() {
  return `<div class="ads-lib-head"><p class="muted">Save what you promote (a product, service, event or cause) once, then pick it when you make an ad.</p></div>
  <div class="ads-lib-grid">${AS.products.map((p) => `<form class="panel ads-lib-item" data-product="${p.id}">${productForm(p)}</form>`).join('')}
    <form class="panel ads-lib-item new" data-product="new"><h2>New product or service</h2>${productForm({ photos: [] })}</form></div>`;
}
function productForm(p) {
  return `<label class="field"><span>Name</span><input name="name" value="${esc(p.name || '')}" required placeholder="e.g. Christmas Parade sponsorship"></label>
    <label class="field"><span>Brand</span><select name="brand_id">${opt('', 'None')}${AS.brands.map((b) => opt(b.id, b.name, p.brand_id)).join('')}</select></label>
    <label class="field"><span>Describe it</span><textarea name="about" rows="2">${esc(p.about || '')}</textarea></label>
    <label class="field"><span>Selling points <small>(one per line)</small></span><textarea name="points" rows="3">${esc(p.points || '')}</textarea></label>
    <div class="ads-more-grid"><label class="field"><span>Offer <small>(optional)</small></span><input name="offer" value="${esc(p.offer || '')}"></label>
      <label class="field"><span>Link</span><input name="link" value="${esc(p.link || '')}"></label></div>
    <div class="field"><span>Photos</span><div class="ad-media-strip" data-photos="${esc(JSON.stringify(p.photos || []))}">${(p.photos || []).map((f) => `<span class="ad-pick">${adThumb(AS.media.find((m) => m.file === f))}<button type="button" data-photo-del="${esc(f)}" aria-label="Remove">×</button></span>`).join('')}
      <label class="ad-pick add">${AI.plus}<input type="file" accept="image/*,video/*" multiple data-photo-add hidden></label></div></div>
    <div class="row"><button class="btn primary" type="submit">${p.id ? 'Save' : 'Add'}</button>${p.id ? `<button type="button" class="btn ghost" data-product-ad="${p.id}">${AI.spark}Make an ad</button><button type="button" class="btn danger" data-product-del="${p.id}">Delete</button>` : ''}<span class="muted" data-msg></span></div>`;
}
function mediaPage() {
  return `<div class="ads-lib-head row"><p class="muted grow">Everything you've added to the studio: photos, videos, logos and music.</p>
    <label class="btn primary">${AI.plus}Add files<input type="file" id="ads-lib-file" accept="image/*,video/*,audio/*" multiple hidden></label></div>
    <p id="ads-lib-msg" class="clip-msg"></p>
    ${AS.media.some((m) => !m.presenter) ? `<div class="ads-media-grid">${AS.media.filter((m) => !m.presenter).map((m) => `<div class="ads-media-item">${m.kind === 'audio' ? `<span class="ad-thumb">${AI.speaker}</span>` : adThumb(m)}
      <small title="${esc(m.name || '')}">${esc(m.name || m.file)}</small>
      <button type="button" class="iconbtn danger" data-media-del="${m.id}" aria-label="Delete">${AI.trash}</button></div>`).join('')}</div>`
    : `<div class="empty-clips"><span>${AI.img}</span><b>Nothing here yet</b><p class="muted">Add photos and videos of your business, products or events.</p></div>`}`;
}

// Presenters: photos of people for talking-head ads (made to talk with a free AI site, or shown as a photo).
const presenters = () => AS.media.filter((m) => m.presenter).sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
function presentersPage() {
  const list = presenters();
  return `<div class="ads-lib-head row"><p class="muted grow">People to put in your ads. Pick one in an ad with <b>AI presenter</b>. Add several photos at once; a photo called <i>17_Malik.png</i> is named Malik.</p>
    <label class="btn primary">${AI.plus}Add presenters<input type="file" id="ads-presenter-file" accept="image/*" multiple hidden></label></div>
    <p id="ads-lib-msg" class="clip-msg"></p>
    ${list.length ? `<div class="ads-presenters">${list.map((m) => `<div class="ads-presenter">
      <img src="${esc(m.url)}" alt="" loading="lazy">
      <input value="${esc(m.presenter)}" data-presenter-name="${m.id}" aria-label="Name" maxlength="40">
      <button type="button" class="iconbtn danger" data-media-del="${m.id}" aria-label="Delete">${AI.trash}</button></div>`).join('')}</div>`
    : `<div class="empty-clips"><span>${AI.img}</span><b>No presenters yet</b><p class="muted">Add photos of the people you want in your ads. Use only photos you have the rights to.</p></div>`}`;
}

// Voices: hear every voice on this Mac with your own words, then use one for new ads.
const VOICE_SAMPLE = 'Hi! This is how your next ad could sound. Book your free call today.';
const voiceKind = (v) => (v.id === 'system' ? 'Siri' : /Premium/.test(v.name) ? 'Premium' : /Enhanced/.test(v.name) ? 'Enhanced' : '');
function voicesPage() {
  const vs = AS.opts.voices || [];
  const pace = AS.voicePace || 'normal';
  return `<div class="ads-lib-head"><p class="muted">Press play to hear each voice say your words. Pick one with <b>Use for new ads</b>. To add more (free), open System Settings → Accessibility → Spoken Content → System voice → <b>Manage Voices</b>; new voices show up here within a few minutes.</p></div>
    <div class="panel ads-voice-try"><label class="field"><span>Words to say</span><textarea id="ads-voice-text" rows="2" maxlength="200">${esc(AS.voiceText || VOICE_SAMPLE)}</textarea></label>
      <div class="field"><span>Pace</span><div class="seg">${(AS.opts.paces || ['calm', 'normal', 'fast']).map((p) => `<button type="button" data-voice-pace="${p}" class="${p === pace ? 'on' : ''}">${PACE_NAMES[p] || p}</button>`).join('')}</div></div></div>
    ${vs.length ? `<div class="ads-voices">${vs.map((v) => `<div class="ads-voice${AS.draft?.voice === v.id ? ' on' : ''}">
      <button type="button" class="iconbtn ads-voice-play" data-voice-play="${esc(v.id)}" aria-label="Play ${esc(v.name)}">${AI.play}</button>
      <div class="grow"><b>${esc(v.name.replace(/\s*\((Premium|Enhanced)\)/, ''))}</b><small class="muted">${esc([voiceKind(v), v.lang.replace('en_', 'English · ')].filter(Boolean).join(' · '))}</small></div>
      <button type="button" class="btn ghost sm" data-voice-use="${esc(v.id)}">${AS.draft?.voice === v.id ? 'Chosen' : 'Use for new ads'}</button></div>`).join('')}</div>`
    : `<div class="empty-clips"><span>${AI.speaker}</span><b>No voices found</b><p class="muted">Voices come from your Mac. Open Viral Post on your Mac to hear them.</p></div>`}`;
}
const voiceAudio = {};
async function playVoice(btn, voice) {
  const text = ($('#ads-voice-text')?.value || VOICE_SAMPLE).trim();
  const pace = AS.voicePace || 'normal';
  const key = `${voice}|${pace}|${text}`;
  Object.values(voiceAudio).forEach((a) => a.pause());
  document.querySelectorAll('.ads-voice.playing').forEach((x) => x.classList.remove('playing'));
  btn.disabled = true;
  try {
    if (!voiceAudio[key]) {
      const res = await fetch('/api/ads/voices/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voice, pace, text }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'That voice did not work.');
      voiceAudio[key] = new Audio(URL.createObjectURL(await res.blob()));
    }
    const a = voiceAudio[key]; a.currentTime = 0;
    const row = btn.closest('.ads-voice'); row.classList.add('playing');
    a.onended = () => row.classList.remove('playing');
    await a.play();
  } catch (err) { banner(err.message, true); }
  btn.disabled = false;
}

// ---------- Events ----------
$('#ads-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-sub]');
  if (b) location.hash = b.dataset.sub === 'create' ? 'ads' : `ads/${b.dataset.sub}`;
});

const adsBody = $('#ads-body');
adsBody.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (form.id === 'ad-new') {
    const msg = $('#ad-new-msg');
    const v = formValues(form);
    if (!v.details.about.trim() && !v.details.name.trim() && !v.product_id) { msg.textContent = 'Describe your ad, paste a script, or pick a product first.'; return; }
    if (!v.formats.length) { msg.textContent = 'Pick at least one shape.'; return; }
    msg.textContent = 'Writing your ad…';
    form.querySelector('.ads-go').disabled = true;
    try {
      const a = await api('/ads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...v, media: AS.picked }) });
      AS.picked = []; AS.draft = null;
      location.hash = `ads/${a.id}`;
    } catch (err) { msg.textContent = err.message; form.querySelector('.ads-go').disabled = false; }
    return;
  }
  const isBrand = form.dataset.brand, isProduct = form.dataset.product;
  if (!isBrand && !isProduct) return;
  const data = Object.fromEntries(new FormData(form));
  delete data.files;
  if (isProduct) data.photos = JSON.parse(form.querySelector('[data-photos]').dataset.photos);
  const id = isBrand || isProduct;
  const kind = isBrand ? 'brands' : 'products';
  try {
    await api(id === 'new' ? `/ads/${kind}` : `/ads/${kind}/${id}`, { method: id === 'new' ? 'POST' : 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    await renderAds(kind);
    banner('Saved.');
    setTimeout(() => banner(''), 1800);
  } catch (err) { form.querySelector('[data-msg]').textContent = err.message; }
});

adsBody.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.id === 'ad-new-files') {
    const added = await uploadAdMedia(t.files, $('#ad-new-msg'));
    AS.picked.push(...added.filter((m) => m.kind !== 'audio').map((m) => m.file));
    t.value = ''; drawPicked(); return;
  }
  if (t.name === 'product_id' && t.closest('#ad-new')) {
    // A product fills in the details it has.
    const p = AS.products.find((x) => String(x.id) === t.value);
    if (p) {
      const f = t.form;
      if (!f.elements.name.value) f.elements.name.value = p.name || '';
      if (!f.elements.about.value) f.elements.about.value = p.about || '';
      if (!f.elements.points.value) f.elements.points.value = p.points || '';
      if (!f.elements.offer.value) f.elements.offer.value = p.offer || '';
      if (!f.elements.website.value) f.elements.website.value = p.link || '';
      if (p.brand_id && !f.elements.brand_id.value) f.elements.brand_id.value = p.brand_id;
      p.photos.forEach((ph) => { if (!AS.picked.includes(ph)) AS.picked.push(ph); });
      drawPicked();
    }
    return;
  }
  if (t.id === 'ads-presenter-file') {
    const msg = $('#ads-lib-msg');
    const fd = new FormData(); [...t.files].forEach((f) => fd.append('files', f));
    msg.textContent = `Adding ${t.files.length} presenter${t.files.length === 1 ? '' : 's'}…`;
    try { const added = await api('/ads/presenters', { method: 'POST', body: fd }); AS.media = [...added, ...AS.media]; $('#ads-body').innerHTML = presentersPage(); }
    catch (err) { msg.textContent = err.message; }
    return;
  }
  if (t.dataset.presenterName) {
    try {
      const m = await api(`/ads/presenters/${t.dataset.presenterName}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: t.value }) });
      const x = AS.media.find((y) => y.id === m.id); if (x) x.presenter = m.presenter;
      t.value = m.presenter;
    } catch (err) { banner(err.message, true); }
    return;
  }
  if (t.id === 'ads-lib-file') { await uploadAdMedia(t.files, $('#ads-lib-msg')); $('#ads-body').innerHTML = mediaPage(); return; }
  if (t.matches('[data-logo]')) {
    const [m] = await uploadAdMedia(t.files, t.closest('form').querySelector('[data-msg]'));
    if (m) { const f = t.closest('form'); f.elements.logo.value = m.file; t.closest('.ads-logo').innerHTML = `<img src="${esc(m.url)}" alt="">`; t.closest('.ads-logo')?.appendChild(t); }
    return;
  }
  if (t.matches('[data-photo-add]')) {
    const added = await uploadAdMedia(t.files, t.closest('form').querySelector('[data-msg]'));
    const strip = t.closest('[data-photos]');
    const list = [...JSON.parse(strip.dataset.photos), ...added.filter((m) => m.kind !== 'audio').map((m) => m.file)];
    strip.dataset.photos = JSON.stringify(list);
    strip.querySelector('.add').insertAdjacentHTML('beforebegin', added.map((m) => `<span class="ad-pick">${adThumb(m)}<button type="button" data-photo-del="${esc(m.file)}" aria-label="Remove">×</button></span>`).join(''));
    return;
  }
  if (!AS.ad) return;
  // Editor
  const a = AS.ad;
  const scene = t.closest('.ad-scene');
  if (scene && t.dataset.k) {
    const s = a.scenes[Number(scene.dataset.i)];
    const k = t.dataset.k;
    s[k] = k === 'endCard' ? t.checked : k === 'seconds' ? (Number(t.value) || null) : t.value;
    if (k === 'media') { s.media = t.value || null; const m = AS.media.find((x) => x.file === t.value); if (m?.kind !== 'video') s.sound = 'voice'; drawScenes(); }
    if (k === 'sound') drawScenes();
    saveScenes(); return;
  }
  if (t.id === 'ad-voice') { a.voice = t.value; saveAdSoon({ voice: t.value }); return; }
  if (t.id === 'ad-brand') { a.brand_id = t.value || null; saveAdSoon({ brand_id: t.value || null }); return; }
  if (t.id === 'ad-music') { saveAdSoon({ music: t.value || null }); return; }
  if (t.id === 'ad-recipe') return;
  if (t.matches('[data-format]')) {
    a.formats = [...document.querySelectorAll('[data-format]:checked')].map((c) => c.value);
    if (!a.formats.length) { t.checked = true; a.formats = [t.value]; }
    saveAdSoon({ formats: a.formats }); return;
  }
  if (t.id === 'ad-music-file') {
    const [m] = await uploadAdMedia(t.files, null);
    if (m?.kind === 'audio') { await saveAdSoon({ music: m.file }, true); drawEditor(); } else if (m) banner('That file has no sound in it.', true);
    return;
  }
  if (t.id === 'ad-media-file') {
    const added = (await uploadAdMedia(t.files, null)).filter((m) => m.kind !== 'audio');
    if (added.length) {
      // New photos also go into scenes that have no picture yet.
      const free = a.scenes.filter((s) => !s.media && !s.endCard);
      added.forEach((m, i) => { if (free[i]) free[i].media = m.file; });
      await saveAdSoon({ media: [...a.media.map((m) => m.file), ...added.map((m) => m.file)], scenes: a.scenes }, true);
      drawEditor();
    }
  }
});

adsBody.addEventListener('input', (e) => {
  const t = e.target;
  if (!AS.ad) return;
  const scene = t.closest('.ad-scene');
  if (scene && (t.dataset.k === 'say' || t.dataset.k === 'headline')) { AS.ad.scenes[Number(scene.dataset.i)][t.dataset.k] = t.value; saveScenes(); return; }
  if (t.id === 'ad-caption') { AS.ad.caption = t.value; saveAdSoon({ caption: t.value }); return; }
  if (t.classList.contains('ad-name')) { AS.ad.name = t.value; if (t.value.trim()) saveAdSoon({ name: t.value }); }
});

adsBody.addEventListener('click', async (e) => {
  const t = e.target.closest('button, [data-idea]');
  if (!t) return;
  const a = AS.ad;
  if (t.dataset.idea != null) {
    const idea = AD_IDEAS[Number(t.dataset.idea)];
    AS.draft = { recipe: idea.recipe, look: idea.look, length: idea.length, details: idea.details, formats: [...document.querySelectorAll('#ad-new [name=formats]:checked')].map((c) => c.value) };
    const keepPicked = AS.picked;
    $('#ads-body').innerHTML = createPage();
    AS.picked = keepPicked; drawPicked();
    $('#ad-new').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (t.dataset.unpick) { AS.picked = AS.picked.filter((f) => f !== t.dataset.unpick); drawPicked(); return; }
  if (t.hasAttribute('data-pick-lib')) { pickFromLibrary(AS.picked, (files) => { AS.picked = files; drawPicked(); }); return; }
  if (t.dataset.mediaDel) {
    if (!confirm('Delete this file from the studio? Ads already made keep their copy.')) return;
    await api(`/ads/media/${t.dataset.mediaDel}`, { method: 'DELETE' });
    AS.media = AS.media.filter((m) => String(m.id) !== t.dataset.mediaDel);
    $('#ads-body').innerHTML = AS.sub === 'presenters' ? presentersPage() : mediaPage(); return;
  }
  if (t.dataset.voicePlay !== undefined) return playVoice(t, t.dataset.voicePlay);
  if (t.dataset.voicePace) { AS.voicePace = t.dataset.voicePace; AS.voiceText = $('#ads-voice-text').value; $('#ads-body').innerHTML = voicesPage(); return; }
  if (t.dataset.voiceUse !== undefined) {
    AS.draft = { ...(AS.draft || {}), voice: t.dataset.voiceUse };
    AS.voiceText = $('#ads-voice-text').value;
    $('#ads-body').innerHTML = voicesPage();
    banner('Chosen. New ads will use this voice (you can still change it in each ad).'); setTimeout(() => banner(''), 2500); return;
  }
  if (t.dataset.brandDel) { if (confirm('Delete this brand?')) { await api(`/ads/brands/${t.dataset.brandDel}`, { method: 'DELETE' }); renderAds('brands'); } return; }
  if (t.dataset.productDel) { if (confirm('Delete this product?')) { await api(`/ads/products/${t.dataset.productDel}`, { method: 'DELETE' }); renderAds('products'); } return; }
  if (t.dataset.productAd) {
    const p = AS.products.find((x) => String(x.id) === t.dataset.productAd);
    AS.draft = { product_id: p.id, brand_id: p.brand_id, details: { name: p.name, about: p.about, points: p.points, offer: p.offer, website: p.link } };
    AS.picked = [...p.photos];
    location.hash = 'ads'; return;
  }
  if (t.dataset.photoDel) {
    const strip = t.closest('[data-photos]');
    strip.dataset.photos = JSON.stringify(JSON.parse(strip.dataset.photos).filter((f) => f !== t.dataset.photoDel));
    t.closest('.ad-pick').remove(); return;
  }
  if (!a) return;
  // Editor buttons
  if (t.hasAttribute('data-ad-render')) {
    t.disabled = true;
    await saveAdSoon({}, true);
    try { AS.ad = { ...a, ...(await api(`/ads/${a.id}/render`, { method: 'POST' })) }; drawResults(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    catch (err) { banner(err.message, true); t.disabled = false; }
    return;
  }
  if (t.hasAttribute('data-ad-rewrite')) {
    if (!confirm('Write the script again? Your changes to the scenes will be replaced.')) return;
    await saveAdSoon({}, true);
    AS.ad = await api(`/ads/${a.id}/rewrite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recipe: $('#ad-recipe').value }) });
    drawEditor(); return;
  }
  if (t.hasAttribute('data-ad-copy')) { await saveAdSoon({}, true); const c = await api(`/ads/${a.id}/copy`, { method: 'POST' }); location.hash = `ads/${c.id}`; return; }
  if (t.hasAttribute('data-ad-del')) {
    if (!confirm('Delete this ad? Posts you already scheduled with it are kept.')) return;
    await api(`/ads/${a.id}`, { method: 'DELETE' }); AS.ad = null; location.hash = 'ads/list'; return;
  }
  if (t.dataset.look) { a.look = t.dataset.look; document.querySelectorAll('[data-look]').forEach((b) => b.classList.toggle('on', b === t)); saveAdSoon({ look: a.look }); return; }
  if (t.dataset.pace) { a.pace = t.dataset.pace; document.querySelectorAll('[data-pace]').forEach((b) => b.classList.toggle('on', b === t)); saveAdSoon({ pace: a.pace }); return; }
  if (t.hasAttribute('data-voice-test')) {
    t.disabled = true;
    try {
      const res = await fetch('/api/ads/voices/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voice: $('#ad-voice').value, pace: a.pace, text: a.scenes[0]?.say }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'The voice did not work.');
      const audio = new Audio(URL.createObjectURL(await res.blob()));
      audio.play();
    } catch (err) { banner(err.message, true); }
    t.disabled = false; return;
  }
  if (t.hasAttribute('data-scene-add')) { a.scenes.push({ say: '', headline: '', media: null, sound: 'voice', framing: 'auto', seconds: null, endCard: false }); drawScenes(); saveScenes(); return; }
  const move = (from, to) => { const [s] = a.scenes.splice(from, 1); a.scenes.splice(to, 0, s); drawScenes(); saveScenes(); };
  if (t.dataset.sceneUp) return move(Number(t.dataset.sceneUp), Number(t.dataset.sceneUp) - 1);
  if (t.dataset.sceneDown) return move(Number(t.dataset.sceneDown), Number(t.dataset.sceneDown) + 1);
  if (t.dataset.sceneAi) return openAiScene(Number(t.dataset.sceneAi));
  if (t.hasAttribute('data-ad-presenter')) { await saveAdSoon({}, true); return openPresenter(); }
  if (t.dataset.sceneDel) { a.scenes.splice(Number(t.dataset.sceneDel), 1); drawScenes(); saveScenes(); return; }
  if (t.dataset.adUnmedia) {
    const files = a.media.map((m) => m.file).filter((f) => f !== t.dataset.adUnmedia);
    a.scenes.forEach((s) => { if (s.media === t.dataset.adUnmedia) s.media = null; });
    await saveAdSoon({ media: files, scenes: a.scenes }, true); drawEditor(); return;
  }
  if (t.hasAttribute('data-ad-lib')) {
    pickFromLibrary(a.media.map((m) => m.file), async (files) => {
      const added = files.filter((f) => !a.media.some((m) => m.file === f));
      const free = a.scenes.filter((s) => !s.media && !s.endCard);
      added.forEach((f, i) => { if (free[i]) free[i].media = f; });
      await saveAdSoon({ media: files, scenes: a.scenes }, true); drawEditor();
    });
  }
});

// ---------- AI scenes (free, on the AI sites themselves) ----------
// None of the AI video makers has a free API, so this writes the prompt for a scene, copies it
// and opens the free website. The downloaded clip is then dropped onto the scene.
const AI_SITES = [
  { name: 'VideoExpress', url: 'https://app.videoexpress.ai/', note: 'Your account · no watermark · text or photo to video' },
  { name: 'Google Flow', url: 'https://labs.google/fx/tools/flow', note: 'Veo 3.1 · about 50 free credits a day · 8-second clips' },
  { name: 'Dreamina', url: 'https://dreamina.capcut.com/ai-tool/video/generate', note: 'Seedance · free credits every day' },
  { name: 'Meta AI', url: 'https://www.meta.ai/', note: 'Free · ask it to "make a video of…"' },
];
const LOOK_PROMPT = {
  bold: 'bright, colorful and energetic, punchy commercial style',
  clean: 'clean, bright and natural, simple modern commercial style',
  cinematic: 'cinematic, warm moody lighting, shallow depth of field, film look',
};
function aiPrompt(scene) {
  const a = AS.ad;
  const shape = a.formats.includes('9x16') || !a.formats.length ? 'vertical 9:16' : a.formats.includes('16x9') ? 'wide 16:9' : 'square 1:1';
  const subject = a.details?.name ? ` for ${a.details.name}` : '';
  const about = a.details?.about ? ` Context: ${a.details.about}` : '';
  return `An 8-second ${shape} video for an ad${subject}. Show this moment: ${scene.headline ? `${scene.headline}. ` : ''}${scene.say || ''}${about} `
    + `Style: ${LOOK_PROMPT[a.look] || LOOK_PROMPT.bold}. Real people and places, smooth camera movement. `
    + 'No words, captions, logos or watermarks on screen. No famous people or cartoon characters.';
}
function openAiScene(i) {
  const scene = AS.ad.scenes[i];
  const dlg = $('#ads-dialog');
  dlg.innerHTML = `<form method="dialog" class="ad-ai">
    <h2>${AI.spark}Make scene ${i + 1} with AI, free</h2>
    <ol class="ad-ai-steps"><li>Check the idea below (change anything you like).</li><li>Click a site: the idea is copied, paste it there and press Generate.</li><li>Download the video, then add it here (or drag it onto the scene).</li></ol>
    <textarea id="ad-ai-prompt" rows="6">${esc(aiPrompt(scene))}</textarea>
    <div class="ad-ai-sites">${AI_SITES.map((s, k) => `<button type="button" class="btn ghost" data-ai-site="${k}"><b>${esc(s.name)}</b><small>${esc(s.note)}</small></button>`).join('')}</div>
    <p id="ad-ai-msg" class="clip-msg"></p>
    <div class="row"><label class="btn primary">${AI.plus}Add the downloaded clip<input type="file" id="ad-ai-file" accept="video/*,image/*" hidden></label><button class="btn ghost" value="close">Close</button></div>
    <p class="muted clip-fine">Free credits run out each day, so make the scenes that matter most first. Only use clips you made yourself.</p>
  </form>`;
  dlg.dataset.scene = String(i);
  dlg.showModal();
}
$('#ads-dialog').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-ai-site]');
  if (!b) return;
  const site = AI_SITES[Number(b.dataset.aiSite)];
  const text = $('#ad-ai-prompt').value;
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch {
    const t = $('#ad-ai-prompt'); t.select(); try { copied = document.execCommand('copy'); } catch {}
  }
  window.open(site.url, '_blank', 'noopener');
  $('#ad-ai-msg').textContent = copied ? `Idea copied. Paste it into ${site.name} and press Generate.` : `Copy the idea above, then paste it into ${site.name}.`;
});
$('#ads-dialog').addEventListener('change', async (e) => {
  if (e.target.id !== 'ad-ai-file') return;
  const i = Number($('#ads-dialog').dataset.scene);
  $('#ad-ai-msg').textContent = 'Adding your clip…';
  if (await putClipInScene(i, e.target.files)) $('#ads-dialog').close();
  else $('#ad-ai-msg').textContent = 'That file could not be added. Use an MP4 or MOV video.';
});

// ---------- AI presenter (HumanPal) ----------
// HumanPal has no API: the whole script is copied, HumanPal opens, and the finished presenter
// video comes back here. It is then cut into the scenes (by how many words each scene has), using
// the presenter's own voice, with the headlines, captions, logo and end card on top.
const presenterScript = () => AS.ad.scenes.map((s) => (s.say || '').trim()).filter(Boolean).join('\n\n');
const TALK_SITES = [
  { name: 'Dreamina AI Avatar', url: 'https://dreamina.capcut.com/ai-tool/home', note: 'Free daily credits · photo + voice → talking video' },
  { name: 'Hedra', url: 'https://www.hedra.com/app/characters', note: 'Free plan · photo + voice → talking video' },
];
const presenterKey = () => `adPresenter:${AS.ad?.id}`;
function chosenPresenter() {
  let f = null; try { f = localStorage.getItem(presenterKey()); } catch {}
  return presenters().find((m) => m.file === f) || null;
}
function openPresenter() {
  const dlg = $('#ads-dialog');
  const list = presenters();
  const p = chosenPresenter();
  dlg.innerHTML = `<form method="dialog" class="ad-ai">
    <h2>${AI.spark}AI presenter for this ad</h2>
    ${list.length ? `<div class="field"><span>Pick your presenter</span><div class="ad-presenter-pick">${list.map((m) => `<button type="button" class="${p?.file === m.file ? 'on' : ''}" data-presenter-pick="${esc(m.file)}" title="${esc(m.presenter)}"><img src="${esc(m.url)}" alt="" loading="lazy"><small>${esc(m.presenter)}</small></button>`).join('')}</div></div>`
      : `<p class="muted">Add photos of people in the <a href="#ads/presenters">Presenters</a> tab to pick one here, or use a HumanPal presenter.</p>`}
    ${p ? `<div class="ad-presenter-how"><b>Make ${esc(p.presenter)} talk (free)</b>
      <ol class="ad-ai-steps"><li>Save ${esc(p.presenter)}'s photo and the voiceover: <a class="btn ghost sm" href="${esc(p.url)}" download="${esc(p.presenter)}.png">${AI.save}Photo</a> <a class="btn ghost sm" href="/api/ads/${AS.ad.id}/voiceover">${AI.save}Voiceover</a></li>
      <li>Open a site below, add the photo and the voiceover, and make the video (vertical if it asks).</li>
      <li>Download it and press <b>Add the presenter video</b>. Each scene gets its part, with your captions, logo and end card on top.</li></ol>
      <div class="ad-ai-sites">${TALK_SITES.map((x) => `<a class="btn ghost" href="${esc(x.url)}" target="_blank" rel="noopener"><b>Open ${esc(x.name)}</b><small>${esc(x.note)}</small></a>`).join('')}</div>
      <p class="muted clip-fine">No AI? <button type="button" class="linkbtn" data-presenter-photo>Show ${esc(p.presenter)}'s photo</button> at the start and end of the ad, with your Mac voice.</p></div>` : ''}
    <details class="ad-presenter-hp"${p ? '' : ' open'}><summary><b>Or use a HumanPal presenter</b></summary>
    <ol class="ad-ai-steps"><li>Click <b>Copy script & open HumanPal</b>.</li><li>In HumanPal pick a presenter and voice, paste the script, choose <b>vertical 9:16</b>, and make the video.</li><li>Download it and add it here.</li></ol>
    <div class="ad-ai-sites"><button type="button" class="btn ghost" data-presenter-open="https://app.humanpal.io/dashboard"><b>Copy script & open HumanPal</b><small>Your account · AI presenters · 1 minute per video on the Commercial plan</small></button></div></details>
    <label class="field"><span>Script <small>(one paragraph per scene)</small></span><textarea id="ad-presenter-script" rows="6">${esc(presenterScript())}</textarea></label>
    <p id="ad-ai-msg" class="clip-msg"></p>
    <div class="row"><label class="btn primary">${AI.plus}Add the presenter video<input type="file" id="ad-presenter-file" accept="video/*" hidden></label><button class="btn ghost" value="close">Close</button></div>
    <p class="muted clip-fine">Change the script here first if you like, before you copy it or save the voiceover. Keep the paragraphs in the same order as the scenes.</p>
  </form>`;
  if (!dlg.open) dlg.showModal();
}
// The photo, with the Mac voice, in the first scene and the last talking scene (no AI needed).
async function presenterPhoto(p) {
  const a = AS.ad;
  const talking = a.scenes.map((s, i) => (!s.endCard && (s.say || '').trim() ? i : -1)).filter((i) => i >= 0);
  [...new Set([talking[0], talking[talking.length - 1]])].filter((i) => i !== undefined).forEach((i) => Object.assign(a.scenes[i], { media: p.file, sound: 'voice', framing: 'auto', start: 0 }));
  await saveAdSoon({ media: [...new Set([...a.media.map((x) => x.file), p.file])], scenes: a.scenes }, true);
  $('#ads-dialog').close();
  drawEditor();
  banner(`${p.presenter} added. Press Make my video.`);
  setTimeout(() => banner(''), 3000);
}
$('#ads-dialog').addEventListener('click', async (e) => {
  const pick = e.target.closest('[data-presenter-pick]');
  if (pick) {
    try { localStorage.setItem(presenterKey(), pick.dataset.presenterPick); } catch {}
    const script = $('#ad-presenter-script').value;
    openPresenter();
    $('#ad-presenter-script').value = script;
    return;
  }
  if (e.target.closest('[data-presenter-photo]')) { const p = chosenPresenter(); if (p) presenterPhoto(p); return; }
  if (e.target.closest('a[href$="/voiceover"]')) {
    // Save script edits first so the voiceover says them.
    e.preventDefault();
    const a = AS.ad;
    const parts = $('#ad-presenter-script').value.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
    const spoken = a.scenes.filter((s) => (s.say || '').trim());
    if (parts.length === spoken.length) { spoken.forEach((s, k) => { s.say = parts[k]; }); await saveAdSoon({ scenes: a.scenes }, true); }
    $('#ad-ai-msg').textContent = 'Making the voiceover…';
    location.href = `/api/ads/${a.id}/voiceover`;
    setTimeout(() => { $('#ad-ai-msg').textContent = 'Voiceover saved to your Downloads.'; }, 2500);
  }
});
$('#ads-dialog').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-presenter-open]');
  if (!b) return;
  const text = $('#ad-presenter-script').value;
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch {
    const t = $('#ad-presenter-script'); t.select(); try { copied = document.execCommand('copy'); } catch {}
  }
  window.open(b.dataset.presenterOpen, '_blank', 'noopener');
  $('#ad-ai-msg').textContent = copied ? 'Script copied. Paste it into HumanPal.' : 'Copy the script above, then paste it into HumanPal.';
});
$('#ads-dialog').addEventListener('change', async (e) => {
  if (e.target.id !== 'ad-presenter-file') return;
  const msg = $('#ad-ai-msg');
  msg.textContent = 'Adding the presenter video…';
  const [m] = (await uploadAdMedia([...e.target.files].slice(0, 1), null)).filter((x) => x.kind === 'video');
  if (!m || !m.duration) { msg.textContent = 'That file could not be added. Use an MP4 or MOV video.'; return; }
  // If the script was changed here, those words become the scenes' words.
  const parts = $('#ad-presenter-script').value.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  const a = AS.ad;
  const spoken = a.scenes.filter((s) => (s.say || '').trim());
  if (parts.length === spoken.length) spoken.forEach((s, k) => { s.say = parts[k]; });
  splitPresenter(a.scenes, m);
  await saveAdSoon({ media: [...a.media.map((x) => x.file), m.file], scenes: a.scenes }, true);
  $('#ads-dialog').close();
  drawEditor();
  banner('Presenter added to every scene. Press Make my video.');
  setTimeout(() => banner(''), 3000);
});
// Each scene gets a stretch of the presenter video sized by how many words it has.
function splitPresenter(scenes, m) {
  const weight = (s) => Math.max(1, (s.say || '').split(/\s+/).filter(Boolean).length);
  const total = scenes.reduce((t, s) => t + weight(s), 0);
  let at = 0;
  scenes.forEach((s, k) => {
    const len = k === scenes.length - 1 ? Math.max(1.5, m.duration - at) : (m.duration * weight(s)) / total;
    Object.assign(s, { media: m.file, sound: 'video', framing: 'auto', start: +at.toFixed(2), seconds: +Math.max(1.5, len).toFixed(2) });
    at += len;
  });
  return scenes;
}

// A photo or video dropped on a scene (or picked for it) becomes that scene's picture.
async function putClipInScene(i, files) {
  const a = AS.ad;
  const [m] = (await uploadAdMedia([...files].slice(0, 1), null)).filter((x) => x.kind !== 'audio');
  if (!m || !a || !a.scenes[i]) return false;
  a.scenes[i].media = m.file;
  a.scenes[i].framing = 'auto';
  await saveAdSoon({ media: [...a.media.map((x) => x.file), m.file], scenes: a.scenes }, true);
  drawEditor();
  banner(`Added to scene ${i + 1}.`);
  setTimeout(() => banner(''), 2000);
  return true;
}
adsBody.addEventListener('dragover', (e) => {
  const sc = e.target.closest('.ad-scene');
  if (!sc || !AS.ad || !e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault();
  document.querySelectorAll('.ad-scene.drop').forEach((x) => x !== sc && x.classList.remove('drop'));
  sc.classList.add('drop');
});
adsBody.addEventListener('dragleave', (e) => {
  const sc = e.target.closest('.ad-scene');
  if (sc && !sc.contains(e.relatedTarget)) sc.classList.remove('drop');
});
adsBody.addEventListener('drop', async (e) => {
  const sc = e.target.closest('.ad-scene');
  if (!sc || !AS.ad || !e.dataTransfer?.files?.length) return;
  e.preventDefault();
  sc.classList.remove('drop');
  sc.classList.add('busy');
  await putClipInScene(Number(sc.dataset.i), e.dataTransfer.files);
});

// A simple picker for photos and videos already in the studio.
function pickFromLibrary(selected, done) {
  const dlg = $('#ads-dialog');
  const chosen = new Set(selected);
  const items = AS.media.filter((m) => m.kind !== 'audio');
  dlg.innerHTML = `<form method="dialog"><h2>Pick photos and videos</h2>
    <div class="ads-media-grid pick">${items.map((m) => `<label class="ads-media-item"><input type="checkbox" value="${esc(m.file)}"${chosen.has(m.file) ? ' checked' : ''}>${adThumb(m)}<small>${esc(m.name || '')}</small></label>`).join('')}</div>
    <div class="row"><button class="btn primary" value="ok">Use these</button><button class="btn ghost" value="cancel">Cancel</button></div></form>`;
  dlg.onclose = () => {
    if (dlg.returnValue === 'ok') done([...dlg.querySelectorAll('input:checked')].map((c) => c.value));
    dlg.onclose = null;
  };
  dlg.showModal();
}
