// A members community for each course: members post questions and wins, and comment on
// each other's posts, right inside their customer portal. You answer as the business from
// the course page in the CRM, pin the best posts, and remove anything that doesn't belong.
const express = require('express');
const db = require('../../src/db');
const notify = require('../../src/notify');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_posts (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES crm_courses(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,  -- empty = you (the business)
  body TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_post_comments (
  id INTEGER PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES crm_posts(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const crm = () => require('./crm');
const hits = new Map();
const tooFast = (id) => { const now = Date.now(), l = (hits.get(id) || []).filter((t) => now - t < 3600e3); l.push(now); hits.set(id, l); return l.length > 30; };
const clean = (t) => { t = String(t || '').trim().slice(0, 4000); if (!t) throw err('Write something first.'); return t; };

function posts(courseId) {
  const rows = db.prepare(`SELECT p.*, c.name FROM crm_posts p LEFT JOIN contacts c ON c.id=p.contact_id WHERE p.course_id=? ORDER BY p.pinned DESC, p.id DESC LIMIT 200`).all(Number(courseId));
  const com = db.prepare('SELECT x.*, c.name FROM crm_post_comments x LEFT JOIN contacts c ON c.id=x.contact_id WHERE x.post_id=? ORDER BY x.id');
  return rows.map((p) => ({ ...p, pinned: Boolean(p.pinned), comments: com.all(p.id) }));
}
const course = (id) => db.prepare('SELECT * FROM crm_courses WHERE id=?').get(Number(id));
const isMember = (courseId, contactId) => Boolean(db.prepare('SELECT 1 FROM crm_course_access WHERE course_id=? AND contact_id=?').get(Number(courseId), Number(contactId)));
function buzz(who, what, c) { notify.send(`Community: ${c.title}`, `${who} ${what}`.slice(0, 220), { tags: 'busts_in_silhouette' }).catch(() => {}); }

// Members (from the portal).
function memberPost(contactId, courseId, text) {
  const c = course(courseId);
  if (!c || !isMember(c.id, contactId)) throw err('Not found', 404);
  if (tooFast(contactId)) throw err('Slow down a little, please.', 429);
  text = clean(text);
  const id = db.prepare('INSERT INTO crm_posts (course_id, contact_id, body) VALUES (?,?,?)').run(c.id, Number(contactId), text).lastInsertRowid;
  const p = crm().getContact(Number(contactId));
  buzz(p.name, `posted: ${text}`, c);
  return { id, course: c.id };
}
function memberComment(contactId, postId, text) {
  const p = db.prepare('SELECT * FROM crm_posts WHERE id=?').get(Number(postId));
  if (!p || !isMember(p.course_id, contactId)) throw err('Not found', 404);
  if (tooFast(contactId)) throw err('Slow down a little, please.', 429);
  text = clean(text).slice(0, 2000);
  db.prepare('INSERT INTO crm_post_comments (post_id, contact_id, body) VALUES (?,?,?)').run(p.id, Number(contactId), text);
  buzz(crm().getContact(Number(contactId)).name, `commented: ${text}`, course(p.course_id));
  return { course: p.course_id, post: p.id };
}
function memberDelete(contactId, kind, id) {
  if (kind === 'post') db.prepare('DELETE FROM crm_posts WHERE id=? AND contact_id=?').run(Number(id), Number(contactId));
  else db.prepare('DELETE FROM crm_post_comments WHERE id=? AND contact_id=?').run(Number(id), Number(contactId));
}

// You (from the CRM).
function ownerPost(courseId, text) {
  if (!course(courseId)) throw err('Course not found', 404);
  db.prepare('INSERT INTO crm_posts (course_id, contact_id, body) VALUES (?,NULL,?)').run(Number(courseId), clean(text));
  return { posts: posts(courseId) };
}
function ownerComment(postId, text) {
  const p = db.prepare('SELECT * FROM crm_posts WHERE id=?').get(Number(postId));
  if (!p) throw err('Post not found', 404);
  db.prepare('INSERT INTO crm_post_comments (post_id, contact_id, body) VALUES (?,NULL,?)').run(p.id, clean(text).slice(0, 2000));
  return { posts: posts(p.course_id) };
}
function pin(postId, on) {
  const p = db.prepare('SELECT * FROM crm_posts WHERE id=?').get(Number(postId));
  if (!p) throw err('Post not found', 404);
  db.prepare('UPDATE crm_posts SET pinned=? WHERE id=?').run(on ? 1 : 0, p.id);
  return { posts: posts(p.course_id) };
}
function removePost(postId) {
  const p = db.prepare('SELECT * FROM crm_posts WHERE id=?').get(Number(postId));
  if (!p) throw err('Post not found', 404);
  db.prepare('DELETE FROM crm_posts WHERE id=?').run(p.id);
  return { posts: posts(p.course_id) };
}
function removeComment(id) {
  const x = db.prepare('SELECT p.course_id FROM crm_post_comments x JOIN crm_posts p ON p.id=x.post_id WHERE x.id=?').get(Number(id));
  if (!x) throw err('Comment not found', 404);
  db.prepare('DELETE FROM crm_post_comments WHERE id=?').run(Number(id));
  return { posts: posts(x.course_id) };
}

// ---------- The community page in the portal ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const nl = (v) => esc(v).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener nofollow">$1</a>').replace(/\n/g, '<br>');
const ago = (iso) => {
  const s = (Date.now() - Date.parse(iso.replace(' ', 'T') + (iso.length === 19 ? 'Z' : ''))) / 1000;
  return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};
const initials = (n) => String(n || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
function html(contact, token, courseId, bizName) {
  const base = esc(token);
  const who = (x) => (x.contact_id ? x.name || 'Member' : bizName || 'Team');
  const av = (x) => `<span class="av${x.contact_id ? '' : ' team'}">${esc(initials(who(x)))}</span>`;
  const list = posts(courseId);
  return `<form method="post" action="${base}/post" class="card"><input type="hidden" name="course" value="${Number(courseId)}">
<label for="np" style="margin-top:0">Share a question or a win</label><textarea id="np" name="body" rows="3" maxlength="4000" required style="width:100%;font:inherit;color:inherit;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:11px"></textarea>
<p style="margin:10px 0 0"><button class="btn">Post</button></p></form>
${list.length ? list.map((p) => `<div class="card post" id="p${p.id}"><div class="who">${av(p)}<div><b>${esc(who(p))}</b>${p.contact_id ? '' : ' <span class="pill ok">Team</span>'}${p.pinned ? ' <span class="pill">📌 Pinned</span>' : ''}<div class="muted small">${ago(p.created_at)}</div></div>
${p.contact_id === contact.id ? `<form method="post" action="${base}/unpost" class="del"><input type="hidden" name="course" value="${Number(courseId)}"><input type="hidden" name="post" value="${p.id}"><button aria-label="Delete my post" title="Delete my post">×</button></form>` : ''}</div>
<div class="body">${nl(p.body)}</div>
${p.comments.map((x) => `<div class="cmt">${av(x)}<div><b>${esc(who(x))}</b> <span class="muted small">${ago(x.created_at)}</span><div>${nl(x.body)}</div></div></div>`).join('')}
<form method="post" action="${base}/comment" class="reply"><input type="hidden" name="course" value="${Number(courseId)}"><input type="hidden" name="post" value="${p.id}"><input name="body" placeholder="Write a comment" maxlength="2000" required aria-label="Comment"><button class="btn ghost">Reply</button></form></div>`).join('')
    : '<div class="empty">No posts yet. Say hi and tell everyone what you want to learn!</div>'}`;
}
const CSS = `.tabs{display:flex;gap:6px;margin:4px 0 16px}.tabs a{padding:8px 16px;border-radius:999px;text-decoration:none;font-weight:700;border:1px solid var(--line);color:var(--text)}.tabs a.on{background:var(--c);color:#fff;border-color:var(--c)}
.post .who,.cmt{display:flex;gap:10px;align-items:flex-start}.post .who{position:relative}.av{width:36px;height:36px;flex:none;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:.8rem;background:var(--line)}
.av.team{background:var(--c);color:#fff}.post .body{margin:10px 0 6px;white-space:normal}.cmt{padding:10px 0 0 14px;border-left:3px solid var(--line);margin:8px 0 0 16px}.cmt .av{width:28px;height:28px;font-size:.7rem}
.reply{display:flex;gap:8px;margin-top:12px}.reply input{flex:1}.del{position:absolute;right:0;top:0}.del button{border:0;background:none;color:var(--muted);font-size:1.3rem;cursor:pointer}`;

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/:courseId', wrap((req) => ({ posts: posts(req.params.courseId) })));
router.post('/:courseId', wrap((req) => ownerPost(req.params.courseId, (req.body || {}).body)));
router.post('/posts/:pid/comments', wrap((req) => ownerComment(req.params.pid, (req.body || {}).body)));
router.put('/posts/:pid', wrap((req) => pin(req.params.pid, (req.body || {}).pinned)));
router.delete('/posts/:pid', wrap((req) => removePost(req.params.pid)));
router.delete('/comments/:cid', wrap((req) => removeComment(req.params.cid)));

module.exports = { posts, memberPost, memberComment, memberDelete, ownerPost, ownerComment, pin, removePost, removeComment, html, CSS, router };
