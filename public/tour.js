// First-time tutorial for Viral Post and Viral Clips: a short guided tour, a "Get started"
// list and a "How it works" button to replay the tour. Same look as Viral Touch CRM's tour
// (crm.css: .crm-coach, .crm-start). Loaded after app.js; uses $, esc, api, THIS_APP and VP.
//
// It starts by itself the first time someone opens a customer or beta tester copy. What each
// person finished is saved in their own copy (/api/tutorial), so every new tester starts fresh.
// On the owner's own Mac it never pops up by itself; "How it works" is there to replay it.
(() => {
  const APP = THIS_APP.key;
  if (APP !== 'scheduler' && APP !== 'clips') return;

  const ICON = {
    wave: '<path d="M7.5 12.5 5 10a1.6 1.6 0 0 1 2.3-2.3l4.2 4.2M9.5 8.5 7.6 6.6a1.6 1.6 0 0 1 2.3-2.3l5.2 5.2M12.3 6.5a1.6 1.6 0 0 1 2.3-2.3l4.1 4.1a6.5 6.5 0 0 1-9.2 9.2L5.8 13.8"/>',
    party: '<path d="M4 20 8.5 7.5l8 8zM14 4.5c.4 1.4 0 2.4-1 3M19.5 10c-1.4-.4-2.4 0-3 1M17 3.5v1.5M20.5 6.5H19"/>',
    person: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
    plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    chart: '<path d="M5 20V12M10 20V6M15 20v-9M20 20V9"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    clips: '<circle cx="6.5" cy="6.5" r="2.8"/><circle cx="6.5" cy="17.5" r="2.8"/><path d="M8.6 8.3 20 18M8.6 15.7 20 6"/>',
    upload: '<path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9"/><path d="M4.5 14.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/>',
    spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2.1-2.4 3.7M12 17.2v.1"/>',
    share: '<path d="M12 14.5V3.5M8 7l4-4 4 4"/><path d="M8 10.5H6.5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H16"/>',
  };
  const svg = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`;
  const NAME = THIS_APP.name;
  const clipsApp = VP.apps.find((a) => a.key === 'clips');
  const isIphone = /iPhone|iPod/.test(navigator.userAgent);
  const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const link = (url, text) => `<a href="${url}" target="_blank" rel="noopener">${text}</a>`;

  let info = { saas: false, metaTestersOnly: false, youtube: true, tiktok: true, done: {} };
  const isDone = (k) => Boolean(info.done[`${APP}-${k}`]);
  function mark(k, value = true) {
    const key = `${APP}-${k}`;
    if (value) info.done[key] = new Date().toISOString(); else delete info.done[key];
    fetch('/api/tutorial', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value }) }).catch(() => {});
  }

  // ---------- The tour ----------
  function tourSteps() {
    const later = [!info.youtube && 'YouTube', !info.tiktok && 'TikTok'].filter(Boolean);
    const platforms = ['Facebook', 'Instagram', info.youtube && 'YouTube', info.tiktok && 'TikTok'].filter(Boolean);
    const list = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a.at(-1)}` : a[0]);
    const homeScreen = {
      ico: 'phone', title: 'Use it on your iPhone',
      text: `${NAME} works on your iPhone too. Open this site in Safari and sign in. Tap the Share button, then tap <b>Add to Home Screen</b>. Now it opens like an app.`,
      tryIt: isIphone ? 'You are on an iPhone now, so you can do it right after this tour.' : `The address to open on your iPhone is <b>${esc(location.origin)}</b>`,
    };
    if (APP === 'clips') {
      return [
        { view: 'clips', ico: 'wave', title: 'Welcome to Viral Clips', text: 'Viral Clips turns one long video into short vertical clips with captions. They are ready for Reels, Shorts and TikTok. This quick tour takes about a minute.', tryIt: 'Use <b>Next</b> to move along. You can stop any time.' },
        { view: 'clips', ico: 'upload', title: 'Add a long video', text: 'Drop a video in the box at the top, or click the box to pick one. Talking videos work best, like a talk, a podcast or a live video.' },
        { view: 'clips', ico: 'spark', title: 'Find your best clips', text: 'Pick how long the clips should be and the caption style. Then press <b>Find my best clips</b>. A long video can take a while. You can leave the page while it works.' },
        { view: 'clips', ico: 'calendar', title: 'Use your clips', text: 'Your clips show up below the box. Tap one to watch it. Download it, or press <b>Schedule</b> to post it with Viral Post.' },
        homeScreen,
        { view: 'clips', ico: 'party', title: 'You\'re all set!', text: 'The Get started list shows what to do next. You can replay this tour any time with <b>How it works</b> at the top.' },
      ];
    }
    return [
      { view: 'calendar', ico: 'wave', title: info.saas ? 'Welcome to Viral Post!' : 'Welcome to Viral Post', text: `Viral Post puts your posts on ${list(platforms)} for you, at the time you pick. This quick tour shows you each part. It takes about a minute.`, tryIt: 'Use <b>Next</b> to move along. You can stop any time.' },
      { view: 'accounts', ico: 'person', title: 'First, connect your accounts', text: 'Click <b>Connect Facebook &amp; Instagram</b> and sign in. Then pick the Pages and Instagram accounts Viral Post may post to. Your Instagram must be a Business or Creator account linked to a Facebook Page.',
        tryIt: info.metaTestersOnly ? `During the beta, Facebook only lets you connect after we add you as a Tester. Reply to your welcome message with the name on your Facebook profile. Then accept the invite at ${link('https://developers.facebook.com/requests/', 'developers.facebook.com/requests')}.` : '' },
      ...(info.saas && later.length ? [{ view: 'accounts', ico: 'clock', title: `${list(later)} are coming`, text: `During the beta you can post to Facebook and Instagram. ${list(later)} ${later.length > 1 ? 'are' : 'is'} hidden for now. We will turn ${later.length > 1 ? 'them' : 'it'} on after the beta.` }] : []),
      { view: 'compose', ico: 'plus', title: 'Make a post', text: 'Tick the accounts to post to. Write your caption. Add a photo or video. Pick the day and time, then press <b>Schedule</b>. Or press <b>Post now</b>.', tryIt: 'Instagram always needs a photo or video.' },
      { view: 'calendar', ico: 'calendar', title: 'Your calendar', text: 'Every post you schedule shows up here. Tap a post to see it, change it or delete it. Each post says Scheduled, Posted, or Needs attention. If one needs attention, tap it and press Retry.' },
      { view: 'analytics', ico: 'chart', title: 'See how you did', text: 'After your posts go out, likes, comments, shares and views show up here. Press <b>Refresh stats</b> for the newest numbers. Tap a top post to see who commented.' },
      ...(clipsApp ? [{ view: 'calendar', ico: 'clips', glow: 'apps', title: 'Viral Clips', text: 'Have a long video? Viral Clips cuts it into short clips with captions. Open it from <b>Your apps</b>. On a computer it is at the bottom of the menu. On an iPhone, tap the squares button at the top.' }] : []),
      homeScreen,
      { view: 'calendar', ico: 'party', title: 'You\'re all set!', text: 'The Get started list on your Calendar shows what to do next. You can replay this tour any time with <b>How it works</b> at the top of the Calendar.' },
    ];
  }

  let steps = [];
  let at = -1;
  const clearGlow = () => document.querySelectorAll('.tour-glow').forEach((el) => el.classList.remove('tour-glow'));
  function glowFor(st) {
    if (st.glow === 'apps') {
      const btn = $('#app-switch-btn');
      return btn && btn.offsetParent ? btn : $('#app-switch');
    }
    return st.view && $(`.sidebar nav a[data-view="${st.view}"]`);
  }
  function show(i) {
    at = i;
    const box = $('#crm-coach');
    clearGlow();
    if (i < 0 || i >= steps.length) { box.hidden = true; at = -1; if (!isDone('tour')) { mark('tour'); drawStart(); } return; }
    const st = steps[i];
    const last = i === steps.length - 1;
    if (st.view && !location.hash.startsWith(`#${st.view}`)) location.hash = `#${st.view}`;
    const el = i > 0 && !last && glowFor(st);
    if (el && el.offsetParent) el.classList.add('tour-glow');
    box.innerHTML = `<button class="skip" data-skip>${last ? 'Close' : 'Skip tour'}</button>
      <div class="crm-coach-head"><div class="crm-coach-ico">${svg(st.ico)}</div><div><div class="step">${i === 0 ? 'Quick tour' : last ? 'Done' : `Step ${i} of ${steps.length - 2}`}</div><h3>${st.title}</h3></div></div>
      <p>${st.text}</p>${st.tryIt ? `<div class="try">${st.tryIt}</div>` : ''}
      <div class="nav"><div class="dots">${steps.map((_, n) => `<i class="${n === i ? 'on' : ''}"></i>`).join('')}</div>
        ${i > 0 ? '<button class="btn ghost" data-back>Back</button>' : ''}<button class="btn primary" data-next>${i === 0 ? 'Show me' : last ? 'Got it' : 'Next'}</button></div>`;
    box.hidden = false;
    $('[data-next]', box).onclick = () => show(last ? -1 : i + 1);
    $('[data-skip]', box).onclick = () => show(-1);
    const back = $('[data-back]', box); if (back) back.onclick = () => show(i - 1);
    $('[data-next]', box).focus({ preventScroll: true });
  }
  const startTour = () => { steps = tourSteps(); show(0); };
  document.addEventListener('keydown', (e) => { if (at >= 0 && e.key === 'Escape') show(-1); });

  // ---------- Add to Home Screen help ----------
  function homeScreenHelp() {
    let dlg = $('#home-screen-dlg');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'home-screen-dlg'; document.body.append(dlg); }
    dlg.innerHTML = `<h2 style="margin-top:0">Put ${esc(NAME)} on your iPhone</h2>
      <ol class="auto-steps">
        <li>On your iPhone, open Safari and go to <b>${esc(location.origin)}</b></li>
        <li>Sign in with your email and password.</li>
        <li>Tap the Share button ${svg('share').replace('<svg', '<svg style="width:18px;height:18px;vertical-align:-3px;fill:none;stroke:currentColor;stroke-width:1.9"')} at the bottom of the screen.</li>
        <li>Scroll down and tap <b>Add to Home Screen</b>. Then tap <b>Add</b>.</li>
        <li>Open ${esc(NAME)} from its new icon on your Home Screen.</li>
      </ol>
      <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-close>Close</button><button class="btn primary" data-did>I did it</button></div>`;
    $('[data-close]', dlg).onclick = () => dlg.close();
    $('[data-did]', dlg).onclick = () => { mark('home-screen'); dlg.close(); drawStart(); };
    dlg.showModal();
  }

  // ---------- Get started list ----------
  const holder = () => (APP === 'clips' ? $('#vp-start-clips') : $('#vp-start'));
  async function startSteps() {
    const iphone = ['Put it on your iPhone home screen', isDone('home-screen'), homeScreenHelp];
    if (APP === 'clips') {
      const jobs = await api('/clips').catch(() => []);
      return [
        ['Take the 1-minute tour', isDone('tour'), startTour],
        ['Add your first long video', jobs.length > 0, () => { $('#clip-drop').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#clip-drop').classList.add('tour-glow'); setTimeout(clearGlow, 3000); }],
        iphone,
      ];
    }
    const [accts, posts, jobs] = await Promise.all([
      api('/accounts').catch(() => []),
      api(`/posts?from=2000-01-01T00:00:00.000Z&to=2100-01-01T00:00:00.000Z`).catch(() => []),
      clipsApp ? fetch('/api/clips').then((r) => (r.ok ? r.json() : [])).catch(() => []) : [],
    ]);
    return [
      ['Take the 1-minute tour', isDone('tour'), startTour],
      ['Connect Facebook or Instagram', accts.some((a) => a.platform === 'facebook' || a.platform === 'instagram'), () => { location.hash = '#accounts'; }],
      ['Schedule your first post', posts.length > 0, () => { location.hash = '#compose'; }],
      iphone,
      ...(clipsApp ? [['Try Viral Clips with a long video', Array.isArray(jobs) && jobs.length > 0, () => { location.href = `${appHref(clipsApp)}#clips`; }]] : []),
    ];
  }
  async function drawStart() {
    const box = holder();
    if (!box) return;
    if (!info.saas || isDone('start-hidden')) { box.innerHTML = ''; return; }
    const list = await startSteps();
    const done = list.filter((x) => x[1]).length;
    if (done === list.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="crm-start"><header><b>Get started</b><div class="bar"><i style="width:${Math.round((done / list.length) * 100)}%"></i></div>
      <span class="muted small">${done} of ${list.length} done</span><button class="x" data-hide>Hide</button></header>
      <ul>${list.map(([lbl, ok], n) => `<li class="${ok ? 'done' : ''}"><button data-step="${n}"><span class="dot">${ok ? '✓' : ''}</span><span class="lbl">${lbl}</span></button></li>`).join('')}</ul></div>`;
    box.onclick = (e) => {
      if (e.target.closest('[data-hide]')) { mark('start-hidden'); box.innerHTML = ''; return; }
      const b = e.target.closest('[data-step]'); if (b) list[Number(b.dataset.step)][2]();
    };
  }

  // ---------- Put it on the page ----------
  const helpBtn = () => `<button type="button" class="btn ghost crm-help-btn vp-help-btn" title="A quick walk-through of ${esc(NAME)}">${svg('help')}<span>How it works</span></button>`;
  if (APP === 'clips') {
    $('#view-clips > .view-head').insertAdjacentHTML('beforeend', helpBtn());
    $('#clip-jobs').insertAdjacentHTML('beforebegin', '<div id="vp-start-clips"></div>');
  } else {
    $('#view-calendar .view-head .row').insertAdjacentHTML('afterbegin', helpBtn());
    $('#cal-overview').insertAdjacentHTML('beforebegin', '<div id="vp-start"></div>');
  }
  // On an iPhone the button sits in the top bar, next to Your apps, as a small "?".
  $('.appbar').insertAdjacentHTML('beforeend', `<button type="button" class="app-switch-btn vp-help-btn vp-help-top" aria-label="How it works">${svg('help')}</button>`);
  document.querySelectorAll('.vp-help-btn').forEach((b) => (b.onclick = startTour));
  window.addEventListener('hashchange', () => {
    const view = (location.hash.slice(1) || THIS_APP.home).split(/[/?]/)[0];
    if (view === THIS_APP.home && at < 0) drawStart();
  });

  fetch('/api/tutorial').then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d) return;
    info = { ...info, ...d, done: d.done || {} };
    // Opened from the Home Screen icon: that step is done.
    if (info.saas && standalone() && !isDone('home-screen')) mark('home-screen');
    drawStart();
    if (info.saas && !isDone('tour')) setTimeout(startTour, 600);
  }).catch(() => {});
})();
