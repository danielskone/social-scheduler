// Courses and a members area. Make a course with lessons (a YouTube or Vimeo link, or a video
// you upload, plus notes). Share its page: free courses open right away, paid ones go through
// your Stripe. Members watch inside their customer portal, tick lessons done, and see progress.
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../../src/db');
const config = require('../../src/config');
const notify = require('../../src/notify');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_courses (
  id INTEGER PRIMARY KEY,
  business_id INTEGER,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  intro TEXT,
  price REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_lessons (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES crm_courses(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  body TEXT,
  video_url TEXT,
  video_file TEXT
);
CREATE TABLE IF NOT EXISTS crm_course_access (
  course_id INTEGER NOT NULL REFERENCES crm_courses(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  via TEXT,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (course_id, contact_id)
);
CREATE TABLE IF NOT EXISTS crm_lesson_done (
  lesson_id INTEGER NOT NULL REFERENCES crm_lessons(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  done_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (lesson_id, contact_id)
);
CREATE TABLE IF NOT EXISTS crm_course_orders (
  invoice_id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL,
  contact_id INTEGER NOT NULL
);
`);
const MEDIA = path.join(config.dataDir, 'course-media');
const businesses = () => require('./businesses');
const crm = () => require('./crm');
const portal = () => require('./portal');
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const nl = (v) => esc(v).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
const money = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'course';
const get = (id) => db.prepare('SELECT * FROM crm_courses WHERE id=?').get(Number(id));
const lessonsOf = (id) => db.prepare('SELECT * FROM crm_lessons WHERE course_id=? ORDER BY position, id').all(Number(id));
const hasAccess = (courseId, contactId) => Boolean(db.prepare('SELECT 1 FROM crm_course_access WHERE course_id=? AND contact_id=?').get(Number(courseId), Number(contactId)));
const linkFor = (c) => `${config.publicBaseUrl}/learn/${c.slug}`;

function list(biz) {
  return db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM crm_lessons l WHERE l.course_id=c.id) AS lessons,
    (SELECT COUNT(*) FROM crm_course_access a WHERE a.course_id=c.id) AS members FROM crm_courses c ORDER BY c.id DESC`).all()
    .filter((c) => !biz || biz === 'all' || !c.business_id || c.business_id === Number(biz))
    .map((c) => ({ ...c, active: Boolean(c.active), link: linkFor(c) }));
}
function full(id) {
  const c = get(id);
  if (!c) throw err('Course not found', 404);
  const lessons = lessonsOf(c.id);
  const members = db.prepare(`SELECT p.id, p.name, p.email, a.via, a.granted_at,
    (SELECT COUNT(*) FROM crm_lesson_done d JOIN crm_lessons l ON l.id=d.lesson_id WHERE l.course_id=a.course_id AND d.contact_id=p.id) AS done
    FROM crm_course_access a JOIN contacts p ON p.id=a.contact_id WHERE a.course_id=? ORDER BY a.granted_at DESC`).all(c.id);
  return { ...c, active: Boolean(c.active), link: linkFor(c), lessons, members };
}
function uniqueSlug(base, id) {
  let s = slugify(base), n = 2;
  while (db.prepare('SELECT id FROM crm_courses WHERE slug=? AND id<>?').get(s, Number(id) || 0)) s = `${slugify(base).slice(0, 46)}-${n++}`;
  return s;
}
function save(body = {}, id, biz) {
  const old = id ? get(id) : null;
  if (id && !old) throw err('Course not found', 404);
  const title = String(body.title ?? old?.title ?? '').trim().slice(0, 120);
  if (!title) throw err('Give the course a name.');
  const price = Math.round(Number(String(body.price ?? old?.price ?? 0).replace(/[$,\s]/g, '')) * 100) / 100;
  if (!Number.isFinite(price) || price < 0 || price > 99999) throw err('Price looks wrong. Use 0 for a free course.');
  const row = { title, price, intro: 'intro' in body ? String(body.intro || '').trim().slice(0, 4000) || null : (old ? old.intro : null),
    active: 'active' in body ? (body.active ? 1 : 0) : (old ? old.active : 1),
    slug: body.slug ? uniqueSlug(body.slug, id) : old ? old.slug : uniqueSlug(title),
    business_id: 'business_id' in body ? (businesses().get(body.business_id) ? Number(body.business_id) : null) : (old ? old.business_id : (biz && biz !== 'all' && businesses().get(biz) ? Number(biz) : null)) };
  if (old) {
    db.prepare('UPDATE crm_courses SET title=@title, price=@price, intro=@intro, active=@active, slug=@slug, business_id=@business_id WHERE id=@id').run({ ...row, id: old.id });
    return full(old.id);
  }
  const newId = db.prepare('INSERT INTO crm_courses (title, price, intro, active, slug, business_id) VALUES (@title,@price,@intro,@active,@slug,@business_id)').run(row).lastInsertRowid;
  if (Array.isArray(body.lessons)) body.lessons.forEach((l) => saveLesson(newId, l));
  return full(newId);
}
function remove(id) { db.prepare('DELETE FROM crm_courses WHERE id=?').run(Number(id)); return { ok: true }; }

function cleanVideo(u) {
  u = String(u || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try { new URL(u); } catch { throw err('That video link does not look right.'); }
  return u.slice(0, 500);
}
function saveLesson(courseId, body = {}, lessonId) {
  const old = lessonId ? db.prepare('SELECT * FROM crm_lessons WHERE id=?').get(Number(lessonId)) : null;
  if (lessonId && !old) throw err('Lesson not found', 404);
  if (!old && !get(courseId)) throw err('Course not found', 404);
  const title = String(body.title ?? old?.title ?? '').trim().slice(0, 160);
  if (!title) throw err('Give the lesson a name.');
  const file = 'video_file' in body ? (body.video_file && /^[a-f0-9]{16}\.(mp4|mov|m4v|webm)$/.test(body.video_file) ? body.video_file : null) : old?.video_file || null;
  const row = { title, body: 'body' in body ? String(body.body || '').trim().slice(0, 20000) || null : old?.body || null,
    video_url: 'video_url' in body ? cleanVideo(body.video_url) : old?.video_url || null, video_file: file };
  if (old) {
    db.prepare('UPDATE crm_lessons SET title=@title, body=@body, video_url=@video_url, video_file=@video_file WHERE id=@id').run({ ...row, id: old.id });
    return db.prepare('SELECT * FROM crm_lessons WHERE id=?').get(old.id);
  }
  const pos = (db.prepare('SELECT MAX(position) AS m FROM crm_lessons WHERE course_id=?').get(Number(courseId)).m ?? -1) + 1;
  const id = db.prepare('INSERT INTO crm_lessons (course_id, position, title, body, video_url, video_file) VALUES (?,?,?,?,?,?)')
    .run(Number(courseId), pos, row.title, row.body, row.video_url, row.video_file).lastInsertRowid;
  return db.prepare('SELECT * FROM crm_lessons WHERE id=?').get(id);
}
function removeLesson(id) { db.prepare('DELETE FROM crm_lessons WHERE id=?').run(Number(id)); return { ok: true }; }
function reorder(courseId, ids = []) {
  const st = db.prepare('UPDATE crm_lessons SET position=? WHERE id=? AND course_id=?');
  db.transaction(() => ids.forEach((id, i) => st.run(i, Number(id), Number(courseId))))();
  return full(courseId);
}

// Gives someone a course. Emails them their link the first time, unless quiet.
async function grant(courseId, contactId, { via = 'Added by you', email = true } = {}) {
  const c = get(courseId), p = crm().getContact(Number(contactId));
  if (!c || !p) throw err('Course or person not found', 404);
  const fresh = db.prepare('INSERT OR IGNORE INTO crm_course_access (course_id, contact_id, via) VALUES (?,?,?)').run(c.id, p.id, String(via).slice(0, 60)).changes > 0;
  let emailed = false;
  if (fresh) {
    crm().logActivity(p.id, { kind: 'Note', note: `Joined the course "${c.title}" (${via})` });
    crm().emit('course_joined', { contact: p, form: c.title });
    if (email && p.email && require('./email').provider()) {
      try { await portal().emailLink(p.id, { why: `You are in! "${c.title}" is ready for you` }); emailed = true; }
      catch (e) { console.error(`[courses] ${e.message}`); }
    }
  }
  return { ok: true, fresh, emailed };
}
function revoke(courseId, contactId) {
  db.prepare('DELETE FROM crm_course_access WHERE course_id=? AND contact_id=?').run(Number(courseId), Number(contactId));
  return { ok: true };
}
// Called when any invoice is paid: if it was for a course, open the course.
function onPaid(invoiceId) {
  const o = db.prepare('SELECT * FROM crm_course_orders WHERE invoice_id=?').get(Number(invoiceId));
  if (!o) return;
  grant(o.course_id, o.contact_id, { via: 'Paid' }).catch((e) => console.error(`[courses] ${e.message}`));
  const c = get(o.course_id), p = crm().getContact(o.contact_id);
  if (c && p) notify.send('New course member', `${p.name} bought "${c.title}".`, { tags: 'mortar_board' }).catch(() => {});
}
// The "Start your course" button on a paid course invoice.
function invoiceExtra(inv) {
  const o = inv && inv.status === 'paid' && db.prepare('SELECT * FROM crm_course_orders WHERE invoice_id=?').get(inv.id);
  if (!o) return '';
  const c = get(o.course_id);
  return c ? `<a class="pay" style="text-align:center;text-decoration:none" href="../portal/${esc(portal().tokenFor(o.contact_id))}?course=${c.id}">Start your course: ${esc(c.title)}</a>` : '';
}

function forContact(contactId) {
  return db.prepare(`SELECT c.id, c.title, (SELECT COUNT(*) FROM crm_lessons l WHERE l.course_id=c.id) AS lessons,
    (SELECT COUNT(*) FROM crm_lesson_done d JOIN crm_lessons l ON l.id=d.lesson_id WHERE l.course_id=c.id AND d.contact_id=a.contact_id) AS done
    FROM crm_course_access a JOIN crm_courses c ON c.id=a.course_id WHERE a.contact_id=? ORDER BY a.granted_at DESC`).all(Number(contactId));
}
function markDone(contactId, lessonId, undo) {
  const l = db.prepare('SELECT * FROM crm_lessons WHERE id=?').get(Number(lessonId));
  if (!l || !hasAccess(l.course_id, contactId)) return { course: l ? l.course_id : 0 };
  if (undo) { db.prepare('DELETE FROM crm_lesson_done WHERE lesson_id=? AND contact_id=?').run(l.id, Number(contactId)); return { course: l.course_id, lesson: l.id }; }
  db.prepare('INSERT OR IGNORE INTO crm_lesson_done (lesson_id, contact_id) VALUES (?,?)').run(l.id, Number(contactId));
  const all = lessonsOf(l.course_id), i = all.findIndex((x) => x.id === l.id);
  const next = all[i + 1];
  if (!next) {
    const left = db.prepare('SELECT COUNT(*) AS n FROM crm_lessons l WHERE l.course_id=? AND l.id NOT IN (SELECT lesson_id FROM crm_lesson_done WHERE contact_id=?)').get(l.course_id, Number(contactId)).n;
    if (!left) { const c = get(l.course_id); crm().logActivity(Number(contactId), { kind: 'Note', note: `Finished the course "${c.title}"` }); crm().emit('course_finished', { contact: crm().getContact(Number(contactId)), form: c.title }); }
  }
  return { course: l.course_id, lesson: next ? next.id : l.id };
}
function mediaFor(contactId, file) {
  if (!/^[a-f0-9]{16}\.(mp4|mov|m4v|webm)$/.test(String(file))) return null;
  const l = db.prepare('SELECT course_id FROM crm_lessons WHERE video_file=?').all(String(file));
  if (!l.some((x) => hasAccess(x.course_id, contactId))) return null;
  const f = path.join(MEDIA, file);
  return fs.existsSync(f) ? f : null;
}

// YouTube and Vimeo links become a player. Anything else becomes a button.
function embed(u) {
  try {
    const x = new URL(u), h = x.hostname.replace(/^www\.|^m\./, '');
    let id = null;
    if (h === 'youtu.be') id = x.pathname.slice(1);
    else if (h === 'youtube.com' || h === 'youtube-nocookie.com') id = x.searchParams.get('v') || (x.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/) || [])[1];
    if (id && /^[\w-]{6,20}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
    if (h === 'vimeo.com' || h === 'player.vimeo.com') { const v = (x.pathname.match(/(\d{5,})/) || [])[1]; if (v) return `https://player.vimeo.com/video/${v}`; }
  } catch {}
  return null;
}
function coursePage(contact, token, courseId, lessonId) {
  const c = get(courseId);
  if (!c || !hasAccess(c.id, contact.id)) return null;
  const lessons = lessonsOf(c.id);
  const done = new Set(db.prepare('SELECT lesson_id FROM crm_lesson_done WHERE contact_id=?').all(contact.id).map((r) => r.lesson_id));
  const l = lessons.find((x) => x.id === Number(lessonId)) || lessons.find((x) => !done.has(x.id)) || lessons[0];
  const base = esc(token), n = lessons.filter((x) => done.has(x.id)).length;
  const biz = (c.business_id && businesses().get(c.business_id)) || businesses().ownerOf(contact.group_name);
  const player = !l ? '' : l.video_file ? `<div class="video"><video controls playsinline preload="metadata" src="${base}/media/${esc(l.video_file)}"></video></div>`
    : l.video_url ? (embed(l.video_url) ? `<div class="video"><iframe src="${esc(embed(l.video_url))}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen title="${esc(l.title)}"></iframe></div>`
      : `<p><a class="btn" href="${esc(l.video_url)}" target="_blank" rel="noopener">Open the video</a></p>`) : '';
  const isDone = l && done.has(l.id);
  const body = `<p><a href="${base}">&larr; Your account</a></p><h1>${esc(c.title)}</h1><div class="muted small">${n} of ${lessons.length} lessons done</div>
<div class="prog" style="margin-bottom:18px"><i style="width:${lessons.length ? Math.round(n / lessons.length * 100) : 0}%"></i></div>
${n === lessons.length && lessons.length ? '<div class="note"><b>🎉 You finished this course.</b> Great work!</div>' : ''}
<div class="course"><div class="card side lessons">${lessons.map((x, i) => `<a href="${base}?course=${c.id}&amp;lesson=${x.id}"${l && x.id === l.id ? ' class="on" aria-current="page"' : ''}><span class="tick${done.has(x.id) ? ' done' : ''}">${done.has(x.id) ? '✓' : ''}</span><span>${i + 1}. ${esc(x.title)}</span></a>`).join('') || '<div class="empty" style="padding:14px">Lessons are coming soon.</div>'}</div>
<div>${l ? `<div class="card"><h2 style="margin-top:4px">${esc(l.title)}</h2>${player}${l.body ? `<div>${nl(l.body)}</div>` : ''}
<form method="post" action="${base}/done" style="margin-top:16px"><input type="hidden" name="lesson" value="${l.id}">${isDone ? '<input type="hidden" name="undo" value="1"><button class="btn ghost">✓ Done (tap to undo)</button>' : '<button class="btn">Mark done and go on</button>'}</form></div>` : ''}</div></div>`;
  return portal().shell({ title: c.title, biz, body, wide: true });
}

// ---------- Public sales page /learn/:slug ----------
function salesPage(c, { error, values = {}, sent } = {}) {
  const lessons = lessonsOf(c.id);
  const biz = (c.business_id && businesses().get(c.business_id)) || businesses().all()[0];
  const stripeOn = require('./invoices').settings().stripe;
  const body = `<h1>${esc(c.title)}</h1><div style="font-size:1.4rem;font-weight:800;color:var(--c)">${c.price > 0 ? money(c.price) : 'Free'}</div>
${c.intro ? `<p>${nl(c.intro)}</p>` : ''}
${lessons.length ? `<div class="card"><b>What is inside</b><ol class="muted" style="margin:8px 0 0;padding-left:20px">${lessons.map((l) => `<li>${esc(l.title)}</li>`).join('')}</ol></div>` : ''}
${sent ? '<div class="note"><b>You are in!</b> Check your email for your private link to start. It can take a minute.</div>' : `
${error ? `<div class="err">${esc(error)}</div>` : ''}
<form method="post" class="card"><b>${c.price > 0 ? 'Get the course' : 'Join for free'}</b>
<label for="n">Your name</label><input id="n" name="name" required maxlength="80" autocomplete="name" value="${esc(values.name)}">
<label for="e">Email</label><input id="e" name="email" type="email" required maxlength="200" autocomplete="email" value="${esc(values.email)}">
<input name="website" style="position:absolute;left:-9999px" tabindex="-1" autocomplete="off" aria-hidden="true">
<p><button class="btn" type="submit"${c.price > 0 && !stripeOn ? ' disabled' : ''} style="width:100%;padding:14px">${c.price > 0 ? `Pay ${money(c.price)} with card` : 'Start now'}</button></p>
${c.price > 0 ? `<p class="muted small" style="text-align:center">${stripeOn ? '🔒 You pay on a secure Stripe page.' : 'Card payments are not set up yet. Please contact us.'}</p>` : ''}
<p class="muted small" style="text-align:center">Already a member? <a href="../portal">Get your link</a></p></form>`}`;
  return portal().shell({ title: c.title, biz, body });
}
async function join(slug, body = {}) {
  const c = db.prepare('SELECT * FROM crm_courses WHERE slug=? AND active=1').get(String(slug));
  if (!c) throw err('This course is not available.', 404);
  const email = String(body.email || '').trim().toLowerCase();
  const isNew = !db.prepare('SELECT 1 FROM contacts WHERE lower(email)=?').get(email);
  const products = require('./products');
  if (c.price > 0 && !require('./invoices').settings().stripe) throw err('Card payments are not set up yet. Please contact us.');
  const p = products.buyer(body, c.business_id, c.price > 0 ? `Started buying the course "${c.title}" (${money(c.price)})` : `Signed up for the free course "${c.title}"`);
  if (c.price > 0) {
    const r = await products.startPayment({ contact: p, items: [{ what: `Course: ${c.title}`, qty: 1, price: c.price }] });
    db.prepare('INSERT OR REPLACE INTO crm_course_orders (invoice_id, course_id, contact_id) VALUES (?,?,?)').run(r.invoice.id, c.id, p.id);
    return { redirect: r.url };
  }
  await grant(c.id, p.id, { via: 'Free sign-up' });
  notify.send('New course member', `${p.name} joined "${c.title}" (free).`, { tags: 'mortar_board' }).catch(() => {});
  // Someone brand new can go straight in. For an email we already had, the link goes by email only,
  // so nobody can open another person's account by typing their address.
  if (isNew) return { redirect: `../portal/${portal().tokenFor(p.id)}?course=${c.id}` };
  return { sent: true };
}
function publicRouter() {
  const r = express.Router();
  r.use(express.urlencoded({ extended: false, limit: '20kb' }));
  const course = (s) => db.prepare('SELECT * FROM crm_courses WHERE slug=? AND active=1').get(String(s));
  const notFound = (res) => res.status(404).send('<meta name="viewport" content="width=device-width, initial-scale=1"><p style="font:18px system-ui;padding:20px">This course is not available.</p>');
  r.get('/:slug', (req, res) => { const c = course(req.params.slug); if (!c) return notFound(res); res.set('Cache-Control', 'no-store').type('html').send(salesPage(c)); });
  r.post('/:slug', async (req, res) => {
    const c = course(req.params.slug);
    if (!c) return notFound(res);
    if (req.body.website) return res.type('html').send(salesPage(c, { sent: true }));
    if (crm().tooMany(String(req.get('cf-connecting-ip') || req.ip))) return res.status(429).type('html').send(salesPage(c, { error: 'Too many tries. Please wait a bit.', values: req.body }));
    try {
      const out = await join(c.slug, req.body);
      if (out.redirect) return res.redirect(303, out.redirect);
      res.type('html').send(salesPage(c, { sent: true }));
    } catch (e) { res.status(e.status || 500).type('html').send(salesPage(c, { error: e.message, values: req.body })); }
  });
  return r;
}

// Uploading a lesson video: streamed straight to disk (big files are fine).
function uploadVideo(req) {
  return new Promise((resolve, reject) => {
    const ext = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/x-m4v': 'm4v', 'video/webm': 'webm' }[String(req.get('content-type') || '').split(';')[0]];
    if (!ext) return reject(err('Pick a video file (MP4, MOV or WebM).'));
    if (Number(req.get('content-length') || 0) > 4e9) return reject(err('That video is over 4 GB. Try a shorter one, or put it on YouTube as Unlisted and paste the link.'));
    fs.mkdirSync(MEDIA, { recursive: true });
    const name = `${crypto.randomBytes(8).toString('hex')}.${ext}`, file = path.join(MEDIA, name);
    const out = fs.createWriteStream(file);
    req.pipe(out);
    out.on('finish', () => resolve({ file: name }));
    out.on('error', (e) => { fs.rm(file, () => {}); reject(e); });
    req.on('aborted', () => { out.destroy(); fs.rm(file, () => {}); reject(err('Upload stopped.')); });
  });
}

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.post('/upload', wrap((req) => uploadVideo(req)));
router.get('/', wrap((req) => ({ courses: list(req.query.biz), stripe: require('./invoices').settings().stripe })));
router.post('/', express.json(), wrap((req) => save(req.body || {}, null, req.query.biz)));
router.get('/:id', wrap((req) => full(req.params.id)));
router.put('/:id', express.json(), wrap((req) => save(req.body || {}, req.params.id)));
router.delete('/:id', wrap((req) => remove(req.params.id)));
router.post('/:id/lessons', express.json(), wrap((req) => saveLesson(req.params.id, req.body || {})));
router.put('/:id/lessons/:lid', express.json(), wrap((req) => saveLesson(req.params.id, req.body || {}, req.params.lid)));
router.delete('/:id/lessons/:lid', wrap((req) => removeLesson(req.params.lid)));
router.post('/:id/order', express.json(), wrap((req) => reorder(req.params.id, (req.body || {}).ids)));
router.post('/:id/members', express.json(), wrap((req) => grant(req.params.id, (req.body || {}).contact_id, { via: 'Added by you', email: (req.body || {}).email !== false })));
router.delete('/:id/members/:cid', wrap((req) => revoke(req.params.id, req.params.cid)));

module.exports = { list, full, save, remove, saveLesson, removeLesson, reorder, grant, revoke, onPaid, invoiceExtra, forContact, markDone, mediaFor, embed, coursePage, salesPage, join, publicRouter, router, uploadVideo };
