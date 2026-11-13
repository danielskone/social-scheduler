// Forms tab of Viral Touch CRM: a drag-and-drop form builder (templates, question types,
// design, show-if logic), sharing (link, QR code, website code) and the responses inbox.
// crm.js calls window.VPForms.render(meta) when the Forms tab opens.
(() => {
  const q$ = (s, el = document) => el.querySelector(s);
  const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function call(p, opts = {}) {
    if (opts.json) { opts.body = JSON.stringify(opts.json); opts.headers = { 'Content-Type': 'application/json' }; delete opts.json; }
    const bizQ = (u) => { let b = ''; try { b = JSON.parse(localStorage.getItem('vtcrm-biz') || '""'); } catch { /* private mode */ } return b ? `${u}${u.includes('?') ? '&' : '?'}biz=${encodeURIComponent(b)}` : u; }; // the business picked in the switcher
    const res = await fetch(bizQ(`/api/crm${p}`), opts);
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json().catch(() => ({})) : await res.text();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  const when = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  const copy = async (text, btn) => { await navigator.clipboard.writeText(text).catch(() => {}); if (btn) { const t = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => (btn.textContent = t), 1500); } };

  // Small line icons (same style as the rest of the CRM).
  const P = {
    plus: '<path d="M12 5v14M5 12h14"/>', chat: '<path d="M4 5h16v11H8l-4 4z"/>', calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    star: '<path d="m12 3.5 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>', flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
    hand: '<path d="M8 13V6a1.5 1.5 0 0 1 3 0v6m0-7a1.5 1.5 0 0 1 3 0v7m0-5a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3 13a1.6 1.6 0 0 1 2.6-1.8L8 14"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', sign: '<path d="M3 17c3-1 4-6 6-6s0 6 3 6 3-3 5-3 2 2 4 2M14 4l6 6-8 8H6v-6z"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>', car: '<path d="M5 16V11l2-5h10l2 5v5M3 16h18v3H3zM7 19v1M17 19v1M5 11h14"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>', mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
    up: '<path d="m6 14 6-6 6 6"/>', down: '<path d="m6 10 6 6 6-6"/>', dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
    inbox: '<path d="M3 13h5l1 3h6l1-3h5M5 5h14l2 8v6H3v-6z"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    // question types
    heading: '<path d="M6 4v16M18 4v16M6 12h12"/>', paragraph: '<path d="M4 6h16M4 10h16M4 14h16M4 18h10"/>', name: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
    email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    company: '<path d="M4 21V5l8-2v18M12 9h8v12M8 8v.01M8 12v.01M8 16v.01M16 13v.01M16 17v.01M2 21h20"/>', address: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    short: '<path d="M4 9h16v6H4zM7 12h5"/>', long: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h4"/>', number: '<path d="M9 4 7 20M17 4l-2 16M4 9h16M3 15h16"/>',
    url: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    date: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>', time: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    dropdown: '<rect x="4" y="7" width="16" height="10" rx="2"/><path d="m13 11 2 2 2-2"/>', radio: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    checkboxes: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>', rating: '<path d="m12 3.5 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
    scale: '<path d="M4 18h16M6 18v-4M10 18v-7M14 18v-9M18 18V5"/>', file: '<path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4"/>', signature: '<path d="M3 17c3-1 4-6 6-6s0 6 3 6 3-3 5-3 2 2 4 2M14 4l6 6-8 8H6v-6z"/>',
    agree: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>', consent: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  };
  const ico = (k, cls = '') => `<svg class="fb-ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[k] || P.plus}</svg>`;

  let kit = null;
  const loadKit = async () => (kit = kit || (await call('/forms/kit')));
  let meta = { groups: [] };

  // ---------- The Forms tab ----------
  async function render(m) {
    meta = m || meta;
    const box = q$('#form-list');
    const [forms, site] = await Promise.all([call('/forms'), call('/website').catch(() => null), loadKit()]);
    const url = forms[0]?.url || '';
    const note = /localhost|127\.0\.0\.1/.test(url) ? 'Form links only work for other people when the app has a public web address (the same one Instagram uses). Right now it only has this computer\'s address, so wait a minute and refresh. Or use <b>Share &gt; Website code</b>, which is always on.'
      : /trycloudflare\.com/.test(url) ? 'Heads up: form links change whenever your Mac restarts. Copy a fresh link here each time you share one. For a form that never changes and works even when the Mac is off, use <b>Share &gt; Website code</b>.' : '';
    box.innerHTML = `
      <section class="fb-hero">
        <div class="fb-hero-text"><span class="fb-kicker">Your own form builder <b>FREE</b></span><h2>Create a form</h2>
          <p>Describe it in a few words, or pick a ready-made one below. You can change everything after.</p></div>
        <form class="fb-describe" id="fb-describe"><textarea name="text" rows="2" placeholder="e.g. RSVP form for our holiday party with a phone number and a photo upload"></textarea>
          <button class="btn primary">Create form</button></form>
        <div class="fb-label">Ready-made forms</div>
        <div class="fb-templates">${kit.templates.map((t) => `<button class="fb-tpl" data-tpl="${t.key}" style="--c:${t.color}"><span class="fb-tpl-ico">${ico(t.icon)}</span><b>${h(t.name)}</b><span>${h(t.desc)}</span></button>`).join('')}</div>
      </section>
      ${note ? `<div class="note fb-note">${note}</div>` : ''}
      <div class="fb-label">Your forms <span class="muted">(${forms.length})</span></div>
      <div class="fb-forms">${forms.map((f) => {
        const th = kit.themes.find((t) => t.key === f.style.theme) || kit.themes[0];
        return `<article class="fb-card" data-form="${f.id}">
          <div class="fb-card-top" style="background:${th.bg}"><div class="fb-mini" style="--a:${f.style.color || th.accent};background:${th.card}"><i></i><i></i><i></i><b></b></div></div>
          <div class="fb-card-body"><h3>${h(f.title)}</h3>
            <div class="muted small">${f.active ? '<span class="fb-dot on"></span>Taking responses' : '<span class="fb-dot"></span>Off'} · adds people to <b>${h(f.group_name)}</b></div>
            <div class="fb-stats"><span><b>${f.submissions}</b> response${f.submissions === 1 ? '' : 's'}</span><span>${f.fields.filter((x) => !['heading', 'paragraph'].includes(x.type)).length} questions</span>${f.last ? `<span>Last ${h(when(f.last))}</span>` : ''}</div>
            <div class="fb-actions"><button class="btn primary" data-act="edit">${ico('edit')}Edit</button><button class="btn" data-act="entries">${ico('inbox')}Responses</button><button class="btn" data-act="share">${ico('share')}Share</button>
              <details class="fb-more"><summary class="btn ghost" aria-label="More">⋯</summary><div><a href="${h(f.url)}" target="_blank" rel="noopener">Open the form</a><button data-act="copy">Make a copy</button><button data-act="toggle">${f.active ? 'Turn off' : 'Turn on'}</button><button data-act="del" class="danger">Delete</button></div></details></div>
          </div></article>`;
      }).join('') || '<p class="muted">No forms yet. Pick a ready-made one above to start.</p>'}</div>
      ${siteCard(site)}`;
    q$('#fb-describe').onsubmit = async (e) => {
      e.preventDefault();
      const text = e.target.text.value;
      if (!text.trim()) { e.target.text.focus(); return; }
      openBuilder(await call('/forms/suggest', { method: 'POST', json: { text } }));
    };
    box.onclick = async (e) => {
      const tpl = e.target.closest('[data-tpl]');
      if (tpl) return openBuilder(await call(`/forms/template/${tpl.dataset.tpl}`));
      if ('siteCopy' in e.target.dataset) return copy(site.snippet, e.target);
      if ('siteCheck' in e.target.dataset) {
        e.target.disabled = true;
        const r = await call('/website/check', { method: 'POST' }).catch((err) => ({ error: err.message }));
        q$('[data-site-msg]').textContent = r.error ? r.error : `Done: ${r.added || 0} new, ${r.updated || 0} updated, ${r.booked || 0} new bookings.`;
        e.target.disabled = false; return;
      }
      const btn = e.target.closest('[data-act]'), card = e.target.closest('[data-form]');
      if (!btn || !card) return;
      const f = forms.find((x) => x.id === Number(card.dataset.form));
      const act = btn.dataset.act;
      if (act === 'edit') openBuilder(f);
      if (act === 'entries') openEntries(f);
      if (act === 'share') openBuilder(f, 'share');
      if (act === 'copy') { await call(`/forms/${f.id}/copy`, { method: 'POST' }); render(); }
      if (act === 'toggle') { await call(`/forms/${f.id}`, { method: 'PUT', json: { active: !f.active } }); render(); }
      if (act === 'del' && confirm(`Delete the form "${f.title}"? The link stops working and its responses are removed. People who signed up stay in your contacts.`)) { await call(`/forms/${f.id}`, { method: 'DELETE' }); render(); }
    };
  }

  function siteCard(site) {
    if (!site) return '';
    const cal = site.calendar;
    const calLine = !cal ? '' : cal.connected
      ? `<div class="muted" style="margin-top:6px">📅 <b>Google Calendar bookings</b> also come in (events named "${h(cal.match)}"), with an alert. ${cal.imported} so far.${cal.lastError ? ` <span style="color:var(--bad)">${h(cal.lastError)}</span>` : ''}</div>`
      : '<div class="muted" style="margin-top:6px">📅 Using a Google Calendar booking page? Run <b>npm run calendar</b> so bookings land here too.</div>';
    return `<div class="item fb-site">
        <b>Your website's own forms</b> ${site.connected ? (site.lastError ? '<span class="pill" style="color:var(--bad)">Problem</span>' : '<span class="pill">Connected</span>') : '<span class="pill">Not set up</span>'}
        ${site.connected
          ? `<div class="muted">Sign-ups from forms already on your website land in <b>${h(site.group)}</b> within about 2 minutes, and your phone gets an alert. ${site.imported} so far.${site.lastCheck ? ` Last checked ${h(when(site.lastCheck))}.` : ''}</div>
            ${site.lastError ? `<div class="muted" style="color:var(--bad)">${h(site.lastError)}</div>` : ''}
            <details style="margin-top:6px"><summary>Code for your website</summary><p class="muted">Paste this once into your website's "custom code" spot for every page (or before &lt;/body&gt;). Your forms keep working as before; this just copies each sign-up here.</p>
            <textarea readonly rows="6" style="width:100%;font:12px ui-monospace,monospace">${h(site.snippet)}</textarea>
            <div class="row"><button class="btn" data-site-copy>Copy code</button></div></details>
            ${calLine}
            <div class="row"><button class="btn ghost" data-site-check>Check now</button><span class="muted" data-site-msg></span></div>`
          : '<div class="muted">Want sign-ups from your website (like viralattraction.com) to show up here by themselves? Follow the steps in <b>crm/website-inbox/README.md</b>, then run <b>npm run website</b> in Terminal. This also makes the always-on <b>Website code</b> for your forms work.</div>'}
      </div>`;
  }

  // ---------- The builder ----------
  let st = null; // { form, sel, tab, dirty }
  const dlg = () => q$('#form-builder');
  const uid = () => 'f_' + Math.random().toString(16).slice(2, 10);
  const hasOptions = (t) => ['dropdown', 'radio', 'checkboxes'].includes(t);
  const typeName = (t) => kit.types.find((x) => x.key === t)?.name || t;

  async function openBuilder(form, tab = 'build') {
    await loadKit();
    st = { form: JSON.parse(JSON.stringify(form)), sel: null, tab: form.id ? tab : 'build', dirty: !form.id };
    st.form.style = st.form.style || { theme: 'clean', button: 'Send' };
    const d = dlg();
    d.innerHTML = `<div class="fb-top">
        <button class="btn ghost fb-close" data-close aria-label="Close">${ico('x')}</button>
        <input class="fb-title" value="${h(st.form.title)}" aria-label="Form title" maxlength="200">
        <nav class="fb-tabs">${[['build', 'Build'], ['design', 'Design'], ['settings', 'Settings'], ['share', 'Share']].map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}</nav>
        <div class="fb-top-right"><span class="muted small" id="fb-status"></span><button class="btn" data-preview>${ico('eye')}<span>Preview</span></button><button class="btn primary" data-save>Save</button></div>
      </div>
      <div class="fb-body" id="fb-body"></div>`;
    d.showModal();
    q$('.fb-title', d).oninput = (e) => { st.form.title = e.target.value; touch(); };
    d.onclick = (e) => {
      const t = e.target.closest('[data-tab]'); if (t) { st.tab = t.dataset.tab; draw(); return; }
      if (e.target.closest('[data-close]')) { if (!st.dirty || confirm('Close without saving your changes?')) d.close(); return; }
      if (e.target.closest('[data-save]')) { save(); return; }
      if (e.target.closest('[data-preview]')) preview();
    };
    d.onclose = () => { if (st && st.saved) render(); st = null; };
    d.oncancel = (e) => { if (st && st.dirty && !confirm('Close without saving your changes?')) e.preventDefault(); };
    draw();
  }
  function touch() { st.dirty = true; status(''); }
  function status(msg, bad) { const s = q$('#fb-status'); if (s) { s.textContent = msg || (st.dirty ? 'Not saved yet' : 'All changes saved'); s.style.color = bad ? 'var(--bad)' : ''; } }

  async function save() {
    const f = st.form;
    const body = { title: f.title, intro: f.intro, group_name: f.group_name, thank_you: f.thank_you, active: f.active ?? 1, fields: f.fields, style: f.style };
    try {
      status('Saving…');
      const saved = await call(f.id ? `/forms/${f.id}` : '/forms', { method: f.id ? 'PUT' : 'POST', json: body });
      const firstSave = !f.id;
      st.form = { ...saved, fields: saved.fields }; st.dirty = false; st.saved = true;
      // Keep the same question selected (ids are kept).
      if (firstSave) { st.tab = 'share'; draw(); }
      status();
    } catch (e) { status(e.message, true); }
  }

  function draw() {
    const d = dlg();
    d.querySelectorAll('.fb-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === st.tab));
    const body = q$('#fb-body', d);
    body.className = `fb-body fb-mode-${st.tab}`;
    ({ build: drawBuild, design: drawDesign, settings: drawSettings, share: drawShare })[st.tab](body);
    status();
  }

  // Build: palette | canvas | question settings
  function drawBuild(body) {
    const groups = [...new Set(kit.types.map((t) => t.group))];
    body.innerHTML = `<aside class="fb-palette"><div class="fb-pal-head">Add a question <span class="muted small">click or drag</span></div>
        ${groups.map((g) => `<div class="fb-pal-group"><div class="fb-pal-title">${g}</div><div class="fb-pal-items">${kit.types.filter((t) => t.group === g).map((t) => `<button draggable="true" data-add="${t.key}">${ico(t.key)}<span>${h(t.name)}</span></button>`).join('')}</div></div>`).join('')}
      </aside>
      <section class="fb-canvas-wrap"><div class="fb-canvas" id="fb-canvas"></div></section>
      <aside class="fb-props" id="fb-props"></aside>`;
    drawCanvas();
    const pal = q$('.fb-palette', body);
    pal.onclick = (e) => { const b = e.target.closest('[data-add]'); if (b) addField(b.dataset.add); };
    pal.ondragstart = (e) => { const b = e.target.closest('[data-add]'); if (b) { e.dataTransfer.setData('text/plain', `add:${b.dataset.add}`); e.dataTransfer.effectAllowed = 'copy'; } };
  }

  function mock(f) {
    const ph = (t) => `<div class="fb-mock">${h(f.placeholder || t)}</div>`;
    switch (f.type) {
      case 'heading': return `<h2 class="fb-mh">${h(f.label)}</h2>${f.help ? `<div class="muted small">${h(f.help)}</div>` : ''}`;
      case 'paragraph': return `<p class="fb-mp">${h(f.label)}</p>`;
      case 'long': case 'address': return `<div class="fb-mock tall">${h(f.placeholder || '')}</div>`;
      case 'dropdown': return `<div class="fb-mock sel">Choose one</div>`;
      case 'radio': case 'checkboxes': return `<div class="fb-mopts">${(f.options || []).slice(0, 6).map((o) => `<span><i class="${f.type}"></i>${h(o)}</span>`).join('')}${(f.options || []).length > 6 ? `<span class="muted">+${f.options.length - 6} more</span>` : ''}</div>`;
      case 'rating': return '<div class="fb-mstars">★★★★★</div>';
      case 'scale': return `<div class="fb-mscale">${Array.from({ length: 11 }, (_, n) => `<span>${n}</span>`).join('')}</div>`;
      case 'file': return '<div class="fb-mock drop">⬆ Tap to add files</div>';
      case 'signature': return '<div class="fb-mock sig">Sign here</div>';
      case 'agree': case 'consent': return '';
      case 'date': return ph('mm/dd/yyyy');
      case 'time': return ph('--:-- --');
      case 'url': return ph('https://');
      default: return ph('');
    }
  }

  function cardInner(x, i) {
    const f = st.form;
    const label = ['agree', 'consent'].includes(x.type)
      ? `<label class="fb-mcheck"><i></i><span>${h(x.label)}${x.required ? '<b class="req">*</b>' : ''}</span></label>`
      : ['heading', 'paragraph'].includes(x.type) ? '' : `<div class="fb-ml">${h(x.label)}${x.required ? '<b class="req">*</b>' : ''}</div>${x.help ? `<div class="fb-mhelp">${h(x.help)}</div>` : ''}`;
    const p = x.show_if && f.fields.find((o) => o.id === x.show_if.field);
    const logic = x.show_if ? `<div class="fb-logic">Shows only if <b>${h(p ? p.label : '?')}</b> is <b>${h((p && (p.type === 'agree' || p.type === 'consent') ? 'ticked' : x.show_if.value.split('|').join(' or ')) || 'answered')}</b></div>` : '';
    return `<div class="fb-tools"><span class="fb-type">${ico(x.type)}${h(typeName(x.type))}</span><span class="fb-grip" title="Drag to move">${ico('grip')}</span>
        <button data-move="-1" title="Move up"${i === 0 ? ' disabled' : ''}>${ico('up')}</button><button data-move="1" title="Move down"${i === f.fields.length - 1 ? ' disabled' : ''}>${ico('down')}</button>
        <button data-dup title="Duplicate">${ico('dup')}</button><button data-del title="Delete">${ico('trash')}</button></div>
      ${logic}${label}${mock(x)}`;
  }

  function drawCanvas() {
    const c = q$('#fb-canvas'); if (!c) return;
    const f = st.form, th = kit.themes.find((t) => t.key === f.style.theme) || kit.themes[0];
    const wrap = q$('.fb-canvas-wrap');
    wrap.style.background = th.bg;
    c.style.setProperty('--a', f.style.color || th.accent);
    c.innerHTML = `<div class="fb-form-head">${f.style.logo ? `<img src="${h(f.style.logo)}" alt="" class="fb-logo">` : ''}<h1>${h(f.title || 'Untitled form')}</h1>${f.intro ? `<p>${h(f.intro)}</p>` : '<p class="muted small fb-add-intro" data-goto="settings">+ Add a short intro (Settings)</p>'}</div>
      <div class="fb-list" id="fb-list">${f.fields.map((x, i) => `<div class="fb-field${st.sel === x.id ? ' sel' : ''}" data-id="${x.id}" draggable="true" tabindex="0">${cardInner(x, i)}</div>`).join('')}
        <div class="fb-drop-end" data-end>${f.fields.length ? 'Drop a question here, or click one on the left' : 'Click a question type on the left to add it'}</div>
      </div>
      <button class="fb-mbtn" type="button" tabindex="-1">${h(f.style.button || 'Send')}</button>
      <button class="btn fb-add-mobile" data-add-mobile>+ Add a question</button>`;
    drawProps();
    const list = q$('#fb-list');
    c.onclick = (e) => {
      if (e.target.closest('[data-goto]')) { st.tab = 'settings'; draw(); return; }
      if (e.target.closest('[data-add-mobile]')) { q$('.fb-palette').classList.toggle('open'); q$('.fb-palette').scrollIntoView({ behavior: 'smooth' }); return; }
      const el = e.target.closest('[data-id]'); if (!el) return;
      const i = f.fields.findIndex((x) => x.id === el.dataset.id);
      const mv = e.target.closest('[data-move]');
      if (mv) { move(i, i + Number(mv.dataset.move)); return; }
      if (e.target.closest('[data-dup]')) { const copyF = { ...JSON.parse(JSON.stringify(f.fields[i])), id: uid() }; if (copyF.type === 'consent') return alert('A form can have only one email permission box.'); f.fields.splice(i + 1, 0, copyF); st.sel = copyF.id; touch(); drawCanvas(); return; }
      if (e.target.closest('[data-del]')) { const gone = f.fields.splice(i, 1)[0]; f.fields.forEach((x) => { if (x.show_if && x.show_if.field === gone.id) delete x.show_if; }); if (st.sel === gone.id) st.sel = null; touch(); drawCanvas(); return; }
      st.sel = el.dataset.id; drawCanvas();
    };
    // Drag and drop: from the palette (add) or within the list (move).
    let dragId = null;
    list.ondragstart = (e) => { const el = e.target.closest('[data-id]'); if (!el) return; dragId = el.dataset.id; e.dataTransfer.setData('text/plain', `move:${dragId}`); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); };
    list.ondragend = () => { dragId = null; list.querySelectorAll('.dragging,.over').forEach((x) => x.classList.remove('dragging', 'over')); };
    list.ondragover = (e) => { e.preventDefault(); list.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); const t = e.target.closest('[data-id],[data-end]'); if (t) t.classList.add('over'); };
    list.ondragleave = (e) => { if (!list.contains(e.relatedTarget)) list.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); };
    list.ondrop = (e) => {
      e.preventDefault();
      const data = e.dataTransfer.getData('text/plain');
      const t = e.target.closest('[data-id]');
      let at = t ? f.fields.findIndex((x) => x.id === t.dataset.id) : f.fields.length;
      if (data.startsWith('add:')) { addField(data.slice(4), at); return; }
      if (data.startsWith('move:')) { const from = f.fields.findIndex((x) => x.id === data.slice(5)); if (from >= 0) move(from, from < at ? at - 1 : at); }
    };
  }
  function move(from, to) {
    const f = st.form.fields;
    if (to < 0 || to >= f.length || from === to) return;
    const [x] = f.splice(from, 1); f.splice(to, 0, x);
    // A "show only if" must point at a question above it.
    f.forEach((q, i) => { if (q.show_if && !f.slice(0, i).some((o) => o.id === q.show_if.field)) delete q.show_if; });
    touch(); drawCanvas();
  }
  const DEFAULTS = {
    heading: { label: 'Section title' }, paragraph: { label: 'Write anything here: instructions, rules or a note.' },
    name: { label: 'Full name', required: true }, email: { label: 'Email', required: true }, phone: { label: 'Phone' }, company: { label: 'Business name' }, address: { label: 'Address' },
    short: { label: 'Short answer' }, long: { label: 'Long answer' }, number: { label: 'Number' }, url: { label: 'Website link' }, date: { label: 'Date' }, time: { label: 'Time' },
    dropdown: { label: 'Pick one', options: ['Option 1', 'Option 2', 'Option 3'] }, radio: { label: 'Pick one', options: ['Option 1', 'Option 2'] }, checkboxes: { label: 'Pick all that apply', options: ['Option 1', 'Option 2', 'Option 3'] },
    rating: { label: 'How would you rate it?' }, scale: { label: 'How likely are you to recommend us?' }, file: { label: 'Upload a file' }, signature: { label: 'Signature', required: true },
    agree: { label: 'I agree to the terms.', required: true }, consent: { label: 'Yes, email me news and updates. I can unsubscribe any time.' },
  };
  function addField(type, at) {
    const f = st.form.fields;
    if (type === 'consent' && f.some((x) => x.type === 'consent')) { alert('A form can have only one email permission box.'); return; }
    const x = { id: uid(), type, required: false, ...JSON.parse(JSON.stringify(DEFAULTS[type] || { label: typeName(type) })) };
    f.splice(at == null ? f.length : at, 0, x);
    st.sel = x.id; touch(); drawCanvas();
    q$('.fb-palette')?.classList.remove('open');
    setTimeout(() => { const el = q$(`.fb-field[data-id="${x.id}"]`); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); q$('#fb-props [name="label"]')?.focus(); }, 30);
  }

  function drawProps() {
    const p = q$('#fb-props'); if (!p) return;
    const f = st.form.fields.find((x) => x.id === st.sel);
    // On a phone the settings open right under the chosen question.
    const narrow = matchMedia('(max-width: 980px)').matches;
    if (narrow && f) q$(`.fb-field[data-id="${f.id}"]`)?.after(p); else if (narrow) q$('.fb-canvas-wrap').after(p);
    if (!f) {
      p.innerHTML = `<div class="fb-props-empty">${ico('edit')}<b>Click a question to change it</b><p class="muted small">Change its wording, make it required, edit the choices, or show it only when someone picks a certain answer.</p>
        <div class="fb-tipbox"><b>Good to know</b><ul><li>A <b>Full name</b> plus an <b>Email</b> or <b>Phone</b> question makes each person a contact.</li><li>The <b>Email permission</b> box is the only way someone joins your email list.</li><li>File uploads and signatures only work on your form link, not in website code.</li></ul></div></div>`;
      return;
    }
    const idx = st.form.fields.indexOf(f);
    const earlier = st.form.fields.slice(0, idx).filter((x) => !['heading', 'paragraph', 'file', 'signature'].includes(x.type));
    const src = f.show_if && earlier.find((x) => x.id === f.show_if.field);
    const layout = ['heading', 'paragraph'].includes(f.type);
    const textish = ['short', 'long', 'name', 'email', 'phone', 'company', 'address', 'number', 'url'].includes(f.type);
    const contactNote = { name: 'Fills in the contact\'s name.', email: 'Fills in the contact\'s email. Each email is one contact, never a duplicate.', phone: 'Fills in the contact\'s phone.', company: 'Fills in the contact\'s business.', address: 'Fills in the contact\'s address.',
      consent: 'Left unticked. Only people who tick it are marked OK to email, with the date and this wording saved as proof.', file: 'Up to 5 files, 25 MB each: photos, videos, PDF or Office files. Files stay private on your Mac.', signature: 'People sign with a finger or mouse. Saved as a picture with the response.' }[f.type];
    p.innerHTML = `<div class="fb-props-head">${ico(f.type)}<b>${h(typeName(f.type))}</b><button class="btn ghost small" data-done>Done</button></div>
      <label class="field"><span>${f.type === 'paragraph' ? 'Text' : f.type === 'heading' ? 'Heading' : ['agree', 'consent'].includes(f.type) ? 'Box wording' : 'Question'}</span><textarea name="label" rows="${f.type === 'paragraph' ? 5 : 2}">${h(f.label)}</textarea></label>
      ${f.type === 'paragraph' ? '' : `<label class="field"><span>${layout ? 'Smaller text under it' : 'Help text'} <small>(optional)</small></span><input name="help" value="${h(f.help)}"></label>`}
      ${textish ? `<label class="field"><span>Example text inside the box <small>(optional)</small></span><input name="placeholder" value="${h(f.placeholder)}"></label>` : ''}
      ${hasOptions(f.type) ? `<label class="field"><span>Choices <small>(one per line)</small></span><textarea name="options" rows="${Math.min(10, (f.options || []).length + 2)}">${h((f.options || []).join('\n'))}</textarea></label>` : ''}
      ${layout || f.type === 'consent' ? '' : `<label class="fb-switch"><input type="checkbox" name="required"${f.required ? ' checked' : ''}><span></span>Required</label>`}
      ${contactNote ? `<p class="muted small fb-cnote">${contactNote}</p>` : ''}
      <div class="fb-logic-box"><div class="fb-pal-title">Show this only if…</div>
        ${earlier.length ? `<select name="sif"><option value="">Always show it</option>${earlier.map((x) => `<option value="${x.id}"${src && src.id === x.id ? ' selected' : ''}>${h(x.label.slice(0, 60))}</option>`).join('')}</select>
        ${src ? (hasOptions(src.type) || ['rating', 'scale', 'agree', 'consent'].includes(src.type)
          ? `<div class="fb-sif-vals">${(hasOptions(src.type) ? src.options : src.type === 'rating' ? ['1', '2', '3', '4', '5'] : src.type === 'scale' ? Array.from({ length: 11 }, (_, n) => String(n)) : ['Yes']).map((o) => { const v = src.type === 'agree' || src.type === 'consent' ? '1' : o; return `<label class="check"><input type="checkbox" name="sifv" value="${h(v)}"${f.show_if.value.split('|').map((s) => s.trim()).includes(v) ? ' checked' : ''}> ${h(o)}</label>`; }).join('')}<span class="muted small">Shows when any ticked answer is picked.</span></div>`
          : `<input name="sift" value="${h(f.show_if.value)}" placeholder="Answer to match (leave empty for: any answer)">`) : ''}`
        : '<p class="muted small">Add a choice question above this one to show it only for certain answers.</p>'}
      </div>`;
    const set = () => {
      const v = (n) => q$(`[name="${n}"]`, p);
      f.label = v('label').value;
      if (v('help')) f.help = v('help').value; else delete f.help;
      if (v('placeholder')) f.placeholder = v('placeholder').value;
      if (v('options')) f.options = v('options').value.split('\n').map((s) => s.trim()).filter(Boolean);
      if (v('required')) f.required = v('required').checked;
      const sif = v('sif')?.value;
      if (!sif) delete f.show_if;
      else if (!f.show_if || f.show_if.field !== sif) f.show_if = { field: sif, value: '' };
      else if (p.querySelector('[name="sifv"]')) f.show_if.value = [...p.querySelectorAll('[name="sifv"]:checked')].map((x) => x.value).join('|');
      else if (v('sift')) f.show_if.value = v('sift').value.trim();
      touch();
    };
    p.oninput = () => {
      set();
      // Redraw only this question's card, so typing stays smooth.
      const card = q$(`.fb-field[data-id="${f.id}"]`);
      if (card) card.innerHTML = cardInner(f, st.form.fields.indexOf(f));
    };
    p.onchange = (e) => { if (e.target.name === 'sif') { set(); drawCanvas(); } };
    q$('[data-done]', p).onclick = () => { st.sel = null; drawCanvas(); };
  }
  // Design: theme, color, button, logo + live preview
  function drawDesign(body) {
    const s = st.form.style;
    body.innerHTML = `<div class="fb-side">
        <div class="fb-pal-title">Theme</div>
        <div class="fb-themes">${kit.themes.map((t) => `<button data-theme="${t.key}" class="${s.theme === t.key ? 'on' : ''}"><span style="background:${t.bg}"><i style="background:${t.card}"><b style="background:${t.accent}"></b></i></span>${h(t.name)}</button>`).join('')}</div>
        <label class="field"><span>Main color <small>(buttons and highlights)</small></span><div class="row"><input type="color" name="color" value="${h(s.color || (kit.themes.find((t) => t.key === s.theme) || kit.themes[0]).accent)}"><button class="btn ghost small" data-color-reset>Use theme color</button></div></label>
        <label class="field"><span>Button wording</span><input name="button" value="${h(s.button || 'Send')}" maxlength="40"></label>
        <div class="field"><span>Logo <small>(optional)</small></span>${s.logo ? `<div class="row"><img src="${h(s.logo)}" alt="" class="fb-logo-prev"><button class="btn ghost small" data-logo-remove>Remove</button></div>` : ''}<input type="file" name="logo" accept="image/png,image/jpeg,image/gif,image/webp"></div>
      </div>
      <div class="fb-preview"><div class="fb-device"><iframe id="fb-frame" title="Preview"></iframe></div></div>`;
    const refresh = async () => { q$('#fb-frame').srcdoc = await previewHtml(); };
    body.onclick = (e) => {
      const t = e.target.closest('[data-theme]');
      if (t) { s.theme = t.dataset.theme; delete s.color; touch(); drawDesign(body); return; }
      if (e.target.closest('[data-color-reset]')) { delete s.color; touch(); drawDesign(body); return; }
      if (e.target.closest('[data-logo-remove]')) { s.logo = ''; touch(); drawDesign(body); }
    };
    body.oninput = (e) => {
      if (e.target.name === 'color') s.color = e.target.value;
      if (e.target.name === 'button') s.button = e.target.value;
      touch(); clearTimeout(body._t); body._t = setTimeout(refresh, 250);
    };
    body.onchange = async (e) => {
      if (e.target.name !== 'logo' || !e.target.files[0]) return;
      const fd = new FormData(); fd.append('logo', e.target.files[0]);
      try { const r = await call('/forms/logo', { method: 'POST', body: fd }); s.logo = r.logo; touch(); drawDesign(body); } catch (err) { alert(err.message); }
    };
    refresh();
  }
  const previewHtml = (thanks) => call('/forms/preview', { method: 'POST', json: { ...st.form, thanks } });

  function drawSettings(body) {
    const f = st.form;
    body.innerHTML = `<div class="fb-side wide">
      <label class="field"><span>Short intro under the title <small>(optional)</small></span><textarea name="intro" rows="3">${h(f.intro)}</textarea></label>
      <label class="field"><span>Put new people in this CRM group</span><input name="group_name" list="fb-groups" value="${h(f.group_name)}"><datalist id="fb-groups">${(meta.groups || []).map((g) => `<option value="${h(g)}">`).join('')}</datalist></label>
      <label class="field"><span>Thank-you message <small>(shown after they press the button)</small></span><textarea name="thank_you" rows="3" placeholder="We got your answers and we'll be in touch soon.">${h(f.thank_you)}</textarea></label>
      <label class="fb-switch"><input type="checkbox" name="active"${f.active ?? 1 ? ' checked' : ''}><span></span>Taking responses (turn off to close the form)</label>
      <div class="fb-tipbox"><b>What happens with each response</b><ul>
        <li>It is saved under <b>Responses</b> on this form, with any files.</li>
        <li>If they gave a name and an email or phone, they are added to (or updated in) your contacts, in the group above.</li>
        <li>Your iPhone gets an alert, and your <b>Automations</b> for "A form is filled in" run.</li></ul></div>
    </div>`;
    body.oninput = (e) => {
      const n = e.target.name; if (!n) return;
      f[n] = n === 'active' ? (e.target.checked ? 1 : 0) : e.target.value; touch();
    };
  }

  async function drawShare(body) {
    const f = st.form;
    if (!f.id) { body.innerHTML = '<div class="fb-side wide"><p>Save the form first, then you can share it.</p><button class="btn primary" data-save>Save</button></div>'; return; }
    body.innerHTML = '<div class="fb-side wide"><p class="muted">Loading…</p></div>';
    const [list, emb] = await Promise.all([call('/forms'), call(`/forms/${f.id}/embed`)]);
    const url = (list.find((x) => x.id === f.id) || {}).url || '';
    const local = /localhost|127\.0\.0\.1/.test(url), tunnel = /trycloudflare\.com/.test(url);
    body.innerHTML = `<div class="fb-share">
      ${st.dirty ? '<div class="note">You have changes that are not saved yet. Press <b>Save</b> so people see the newest version.</div>' : ''}
      <section class="fb-share-card"><div class="fb-share-ico">${ico('link')}</div><div><h3>Form link</h3>
        <p class="muted small">Put it in a post, a text, an email or your link in bio.${tunnel ? ' This link works while your Mac is on and <b>changes when the Mac restarts</b>, so copy a fresh one each time.' : ''}${local ? ' Your Mac has no public address right now. Wait a minute and come back, or use the website code below.' : ''}</p>
        <div class="linkbox"><input readonly value="${h(url)}"><button class="btn" data-copy-link>Copy link</button></div>
        <div class="row"><a class="btn ghost" href="${h(url)}" target="_blank" rel="noopener">Open the form</a></div></div></section>
      <section class="fb-share-card"><div class="fb-qr"><img src="/api/crm/forms/${f.id}/qr.svg?u=${encodeURIComponent(url)}" alt="QR code for the form"></div><div><h3>QR code</h3>
        <p class="muted small">For flyers, posters and the parade table. People point their phone camera at it to open the form.${tunnel ? ' Because the link changes when the Mac restarts, print it only for short-term use.' : ''}</p>
        <a class="btn" href="/api/crm/forms/${f.id}/qr.png" download>Download QR code</a></div></section>
      <section class="fb-share-card wide"><div class="fb-share-ico">${ico('company')}</div><div><h3>Website code <span class="pill">Always on</span></h3>
        ${emb.ready ? `<p class="muted small">Paste this into your website (in Hostinger: add a "Custom code" or "Embed" block where the form should go). It works even when your Mac is off: answers wait in your Google Sheet inbox and arrive here within about 2 minutes.${emb.skipped.length ? ` <b>Not included:</b> ${h(emb.skipped.join(', '))} (uploads and signatures need the form link).` : ''}</p>
          <textarea readonly rows="7" class="fb-code">${h(emb.code)}</textarea><div class="row"><button class="btn" data-copy-code>Copy website code</button></div>`
        : '<p class="muted small">Connect your free Google Sheet website inbox first (see the "Your website\'s own forms" card on the Forms tab, then run <b>npm run website</b>). After that, this gives you code that works on any website even when your Mac is off.</p>'}
        <details><summary class="muted small">Or show the Mac-hosted form in a frame</summary><p class="muted small">Only works while your Mac is on, and must be updated when the link changes.</p><textarea readonly rows="3" class="fb-code">${h(emb.frame)}</textarea><div class="row"><button class="btn ghost" data-copy-frame>Copy</button></div></details>
      </div></section></div>`;
    body.onclick = (e) => {
      if (e.target.closest('[data-copy-link]')) copy(url, e.target);
      if (e.target.closest('[data-copy-code]')) copy(emb.code, e.target);
      if (e.target.closest('[data-copy-frame]')) copy(emb.frame, e.target);
    };
  }

  async function preview() {
    const pv = document.createElement('dialog');
    pv.className = 'fb-pv';
    pv.innerHTML = `<div class="fb-pv-bar"><b>Preview</b><div class="seg"><button data-w="phone" class="on">Phone</button><button data-w="desk">Computer</button><button data-w="thanks">Thank-you page</button></div><span class="muted small">Answers are not saved in preview.</span><button class="btn ghost" data-x>${ico('x')}Close</button></div><div class="fb-pv-stage phone"><iframe title="Form preview"></iframe></div>`;
    document.body.append(pv); pv.showModal();
    const frame = q$('iframe', pv);
    frame.srcdoc = await previewHtml();
    frame.onload = () => { try { q$('form', frame.contentDocument)?.addEventListener('submit', (e) => { e.preventDefault(); alert('Looks good! (Preview only, nothing was sent.)'); }); } catch { /* ignore */ } };
    pv.onclick = async (e) => {
      if (e.target.closest('[data-x]') || e.target === pv) pv.close();
      const b = e.target.closest('[data-w]'); if (!b) return;
      pv.querySelectorAll('[data-w]').forEach((x) => x.classList.toggle('on', x === b));
      q$('.fb-pv-stage', pv).className = `fb-pv-stage ${b.dataset.w === 'desk' ? 'desk' : 'phone'}`;
      frame.srcdoc = await previewHtml(b.dataset.w === 'thanks');
    };
    pv.onclose = () => pv.remove();
  }

  // ---------- Responses ----------
  async function openEntries(f) {
    const d = q$('#crm-edit-dialog');
    const { entries } = await call(`/forms/${f.id}/entries`);
    const fileUrl = (x) => `/api/crm/forms/file/${x.file}`;
    const isImg = (x) => /\.(jpe?g|png|gif|webp)$/i.test(x.file);
    d.className = 'wide fb-entries';
    d.innerHTML = `<header class="view-head"><div><h1>${h(f.title)}</h1><p class="muted small">${entries.length} response${entries.length === 1 ? '' : 's'}${entries.length < f.submissions ? ` here (${f.submissions - entries.length} older sign-ups are in each contact's history)` : ''}</p></div>
      <div class="row"><a class="btn" href="/api/crm/forms/${f.id}/entries.csv" download>Download spreadsheet (CSV)</a><button class="btn ghost" data-close>Close</button></div></header>
      <input type="search" placeholder="Search responses" class="fb-esearch">
      <div class="fb-elist">${entries.map((e) => `<article class="fb-entry" data-entry="${e.id}" data-text="${h(JSON.stringify(e.answers).toLowerCase())}">
        <header><b>${e.contact_name ? `<a href="#" data-contact="${e.contact_id}">${h(e.contact_name)}</a>` : 'No contact details'}</b><span class="muted small">${h(when(e.created_at))} · ${e.source === 'website' ? 'from website code' : 'from form link'}</span><button class="btn ghost small danger" data-edel>Delete</button></header>
        <dl>${e.answers.filter((a) => a.type !== 'file' && a.type !== 'signature').map((a) => `<dt>${h(a.label)}</dt><dd>${a.type === 'rating' ? `<span class="fb-stars">${'★'.repeat(a.value)}${'☆'.repeat(5 - a.value)}</span>` : h(a.value)}</dd>`).join('')}</dl>
        ${e.files.length ? `<div class="fb-efiles">${e.files.map((x) => `<a href="${fileUrl(x)}" target="_blank" rel="noopener" title="${h(x.label)}">${isImg(x) ? `<img src="${fileUrl(x)}" alt="${h(x.name)}" loading="lazy">` : `${ico('file')}<span>${h(x.name)}</span>`}</a>`).join('')}</div>` : ''}
      </article>`).join('') || '<p class="muted">No responses yet. Share the form from the <b>Share</b> button.</p>'}</div>`;
    d.showModal();
    d.onclose = () => { d.className = ''; };
    q$('.fb-esearch', d).oninput = (e) => { const t = e.target.value.toLowerCase(); d.querySelectorAll('.fb-entry').forEach((x) => (x.hidden = t && !x.dataset.text.includes(t) && !x.textContent.toLowerCase().includes(t))); };
    d.onclick = async (e) => {
      if (e.target.closest('[data-close]')) d.close();
      const c = e.target.closest('[data-contact]');
      if (c) { e.preventDefault(); d.close(); window.crmOpenContact?.(Number(c.dataset.contact)); }
      const del = e.target.closest('[data-edel]');
      if (del && confirm('Delete this response and its files? The contact stays.')) {
        const art = del.closest('[data-entry]');
        await call(`/forms/${f.id}/entries/${art.dataset.entry}`, { method: 'DELETE' }); art.remove();
      }
    };
  }

  window.VPForms = { render, openBuilder, openEntries };
})();
