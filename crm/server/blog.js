// A simple blog for each business. Write a post (title, cover photo, words), press Publish, and
// it shows at /blog/<name-of-post>. All posts are listed at /blog/ and Google and news readers
// can follow /blog/feed.xml. Put a "Latest blog posts" block on any website page in Sites.
//
// Writing is plain: a blank line starts a new paragraph. A line starting with "## " is a heading,
// "- " is a bullet, **words** are bold, [words](https://link) is a link, and a line with only a
// photo address (from the photo button) shows the photo.
const express = require('express');
const db = require('../../src/db');
const config = require('../../src/config');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_blog_posts (
  id INTEGER PRIMARY KEY,
  business_id INTEGER,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  excerpt TEXT,
  body TEXT NOT NULL DEFAULT '',
  cover TEXT,
  published INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
const businesses = () => require('./businesses');
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slugify = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'post';
const RESERVED = new Set(['feed.xml', 'feed', 'media']);
function uniqueSlug(want, id = 0) {
  let s = slugify(want), n = 1;
  while (RESERVED.has(s) || db.prepare('SELECT 1 FROM crm_blog_posts WHERE slug=? AND id != ?').get(s, id)) s = `${slugify(want)}-${++n}`;
  return s;
}
const get = (id) => db.prepare('SELECT * FROM crm_blog_posts WHERE id=?').get(Number(id));
const bySlug = (s) => db.prepare('SELECT * FROM crm_blog_posts WHERE slug=?').get(String(s));
const linkFor = (p) => `${config.publicBaseUrl}/blog/${p.slug}`;
const cleanImg = (u) => { u = String(u || '').trim().slice(0, 500); return /^(https:\/\/|media\/)/i.test(u) ? u : ''; };
// A short summary for lists and Google: the excerpt they wrote, or the start of the post.
const plain = (t) => String(t || '').replace(/^\s*(##\s+|-\s+)/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/^\s*(media\/\S+|https:\/\/\S+\.(jpe?g|png|webp|gif))\s*$/gim, '').replace(/\s+/g, ' ').trim();
const summary = (p) => p.excerpt || (plain(p.body).length > 180 ? `${plain(p.body).slice(0, 177).replace(/\s\S*$/, '')}...` : plain(p.body));
const shape = (p) => p && { ...p, published: Boolean(p.published), link: linkFor(p), summary: summary(p), words: plain(p.body).split(' ').filter(Boolean).length };

function save(body = {}, id, biz) {
  const old = id ? get(id) : null;
  if (id && !old) throw err('Post not found', 404);
  const title = String(body.title ?? old?.title ?? '').trim().slice(0, 160);
  if (!title) throw err('Give the post a title.');
  const text = String(body.body ?? old?.body ?? '').replace(/\r\n/g, '\n').slice(0, 60000);
  const publish = 'published' in body ? Boolean(body.published) : Boolean(old?.published);
  if (publish && plain(text).length < 20) throw err('Write a little more before you publish (at least one sentence).');
  const bizId = 'business_id' in body ? (businesses().get(body.business_id) ? Number(body.business_id) : null)
    : old ? old.business_id : (businesses().get(biz) ? Number(biz) : businesses().all()[0]?.id || null);
  const row = { title, body: text, business_id: bizId,
    slug: 'slug' in body && String(body.slug || '').trim() ? uniqueSlug(body.slug, old?.id || 0) : old ? old.slug : uniqueSlug(title),
    excerpt: 'excerpt' in body ? String(body.excerpt || '').trim().slice(0, 300) || null : old?.excerpt ?? null,
    cover: 'cover' in body ? cleanImg(body.cover) || null : old?.cover ?? null,
    published: publish ? 1 : 0,
    published_at: publish ? (old?.published_at || new Date().toISOString()) : old?.published_at ?? null };
  if (old) {
    db.prepare(`UPDATE crm_blog_posts SET title=@title, body=@body, business_id=@business_id, slug=@slug, excerpt=@excerpt, cover=@cover,
      published=@published, published_at=@published_at, updated_at=datetime('now') WHERE id=@id`).run({ ...row, id: old.id });
    return shape(get(old.id));
  }
  const r = db.prepare(`INSERT INTO crm_blog_posts (title, body, business_id, slug, excerpt, cover, published, published_at)
    VALUES (@title,@body,@business_id,@slug,@excerpt,@cover,@published,@published_at)`).run(row);
  return shape(get(r.lastInsertRowid));
}
function list(biz) {
  const posts = db.prepare('SELECT * FROM crm_blog_posts ORDER BY published ASC, COALESCE(published_at, created_at) DESC').all()
    .filter((p) => !biz || biz === 'all' || !p.business_id || p.business_id === Number(biz)).map(shape);
  return { posts, link: `${config.publicBaseUrl}/blog/`, feed: `${config.publicBaseUrl}/blog/feed.xml`,
    totals: { published: posts.filter((p) => p.published).length, drafts: posts.filter((p) => !p.published).length, views: posts.reduce((n, p) => n + p.views, 0) } };
}
function remove(id) { db.prepare('DELETE FROM crm_blog_posts WHERE id=?').run(Number(id)); return { ok: true }; }
// For the "Latest blog posts" block on website pages.
function latest(bizId, n = 3) {
  return db.prepare('SELECT * FROM crm_blog_posts WHERE published=1 ORDER BY published_at DESC').all()
    .filter((p) => !bizId || !p.business_id || p.business_id === Number(bizId)).slice(0, Math.max(1, Math.min(12, Number(n) || 3))).map(shape);
}

// ---------- Turning the words into a page ----------
function inline(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:|\/|#)[^)\s]*)\)/g, (m, t, u) => `<a href="${u}"${/^https?:/.test(u) ? ' rel="noopener"' : ''}>${t}</a>`);
}
function toHtml(text, img = (u) => u) {
  const out = [];
  for (const chunk of String(text || '').split(/\n{2,}/)) {
    const lines = chunk.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.length === 1 && /^(media\/\S+|https:\/\/\S+\.(jpe?g|png|webp|gif)(\?\S*)?)$/i.test(lines[0].trim())) { out.push(`<img src="${esc(img(lines[0].trim()))}" alt="" loading="lazy">`); continue; }
    if (lines.every((l) => /^\s*-\s+/.test(l))) { out.push(`<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*-\s+/, ''))}</li>`).join('')}</ul>`); continue; }
    if (/^##\s+/.test(lines[0])) {
      out.push(`<h2>${inline(lines[0].replace(/^##\s+/, ''))}</h2>`);
      if (lines.length > 1) out.push(`<p>${lines.slice(1).map(inline).join('<br>')}</p>`);
      continue;
    }
    out.push(`<p>${lines.map(inline).join('<br>')}</p>`);
  }
  return out.join('\n');
}

const longDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');
function shell({ b, title, description, image, body, canonical }) {
  const color = b?.color || '#4f46e5';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>${description ? `<meta name="description" content="${esc(description)}">` : ''}
<meta property="og:title" content="${esc(title)}">${description ? `<meta property="og:description" content="${esc(description)}">` : ''}${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}<link rel="alternate" type="application/rss+xml" title="${esc(b?.name || 'Blog')}" href="feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">
<style>
:root{--c:${esc(color)};--bg:#fff;--alt:#f6f7fb;--text:#151821;--muted:#5d6475;--line:#e6e8ef;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#0e1016;--alt:#161922;--text:#eef0f5;--muted:#a3a9b8;--line:#262a35;--card:#1b1e28}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:17px/1.7 "Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
a{color:var(--c)}.top{border-bottom:1px solid var(--line)}.top .in{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-top:16px;padding-bottom:16px}
.brand{font-weight:800;color:var(--text);text-decoration:none;font-size:1.1rem}.brand i{display:inline-block;width:12px;height:12px;border-radius:4px;background:var(--c);margin-right:8px}
.in{max-width:1040px;margin:0 auto;padding:0 20px}.narrow{max-width:720px}h1{font-size:clamp(1.9rem,5vw,2.8rem);line-height:1.15;margin:34px 0 10px;font-weight:800}
.muted{color:var(--muted)}.small{font-size:.9rem}.cover{width:100%;max-height:440px;object-fit:cover;border-radius:18px;margin:22px 0 8px;display:block}
article{font-family:"Source Serif 4",Georgia,serif;font-size:1.13rem}article h2{font-family:"Inter",sans-serif;font-size:1.45rem;margin:32px 0 8px;line-height:1.25}
article img{max-width:100%;border-radius:14px;margin:10px 0}article ul{padding-left:22px}article p{margin:0 0 18px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:22px;margin:26px 0 50px}.post{display:block;text-decoration:none;color:var(--text);background:var(--card);border:1px solid var(--line);border-radius:18px;overflow:hidden}
.post img,.post .ph{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:color-mix(in srgb,var(--c) 14%,var(--alt))}.post div{padding:16px 18px 20px}.post h2{font-size:1.15rem;margin:4px 0 6px;line-height:1.3}
.post p{color:var(--muted);margin:0;font-size:.95rem}.post:hover{border-color:var(--c)}.back{display:inline-block;margin:28px 0 50px;font-weight:600}
footer{padding:26px 0;text-align:center;color:var(--muted);font-size:.85rem;border-top:1px solid var(--line)}
</style></head><body>${body}
<footer><div class="in">© ${new Date().getFullYear()} ${esc(b?.name || '')} · <a href="feed.xml">RSS feed</a></div></footer></body></html>`;
}
const mediaUp = (u) => (/^media\//.test(u) ? `../s/${u}` : u);
const absImg = (u) => (/^media\//.test(u) ? `${config.publicBaseUrl}/s/${u}` : u);
const homeLink = (b) => {
  const s = b && db.prepare('SELECT slug FROM crm_sites WHERE business_id=? AND published=1 ORDER BY id LIMIT 1').get(b.id);
  return s ? `../s/${s.slug}` : '';
};
function header(b, { onPost } = {}) {
  const home = homeLink(b);
  return `<div class="top"><div class="in"><a class="brand" href="${onPost ? './' : '#'}"><i></i>${esc(b?.name || 'Blog')}</a>${home ? `<a href="${esc(home)}">Our website</a>` : ''}</div></div>`;
}
function indexPage(bizId) {
  const all = businesses().all();
  const b = (bizId && businesses().get(bizId)) || all[0] || null;
  const posts = latest(bizId, 12 * 4);
  return shell({ b, title: `${b?.name || 'Our'} blog`, description: `News, tips and stories from ${b?.name || 'us'}.`, canonical: `${config.publicBaseUrl}/blog/`,
    body: `${header(b)}<main class="in"><h1>Blog</h1><p class="muted">News, tips and stories from ${esc(b?.name || 'us')}.</p>
<div class="grid">${posts.map((p) => `<a class="post" href="${esc(p.slug)}${bizId ? `?b=${Number(bizId)}` : ''}">${p.cover ? `<img src="${esc(mediaUp(p.cover))}" alt="" loading="lazy">` : '<span class="ph"></span>'}
<div><span class="muted small">${longDate(p.published_at)}</span><h2>${esc(p.title)}</h2><p>${esc(p.summary)}</p></div></a>`).join('') || '<p class="muted">No posts yet. Check back soon.</p>'}</div></main>` });
}
function postPage(p) {
  const b = (p.business_id && businesses().get(p.business_id)) || businesses().all()[0] || null;
  const minutes = Math.max(1, Math.round(shape(p).words / 220));
  return shell({ b, title: p.title, description: summary(p), image: p.cover ? absImg(p.cover) : '', canonical: linkFor(p),
    body: `${header(b, { onPost: true })}<main class="in narrow"><h1>${esc(p.title)}</h1><div class="muted small">${longDate(p.published_at)} · ${minutes} min read</div>
${p.cover ? `<img class="cover" src="${esc(mediaUp(p.cover))}" alt="">` : ''}<article>${toHtml(p.body, mediaUp)}</article>
<a class="back" href="./${p.business_id ? `?b=${p.business_id}` : ''}">← All posts</a></main>` });
}
const xml = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
function feed(bizId) {
  const b = (bizId && businesses().get(bizId)) || businesses().all()[0] || null;
  const items = latest(bizId, 30);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>${xml(`${b?.name || 'Our'} blog`)}</title><link>${xml(`${config.publicBaseUrl}/blog/`)}</link><description>${xml(`News from ${b?.name || 'us'}`)}</description>
${items.map((p) => `<item><title>${xml(p.title)}</title><link>${xml(p.link)}</link><guid>${xml(p.link)}</guid><pubDate>${new Date(p.published_at).toUTCString()}</pubDate><description>${xml(p.summary)}</description></item>`).join('\n')}
</channel></rss>`;
}

const notFound = (res) => res.status(404).send('<meta name="viewport" content="width=device-width, initial-scale=1"><p style="font:18px system-ui;padding:20px">This post is not available.</p>');
function publicRouter() {
  const r = express.Router({ strict: true });
  const biz = (req) => (businesses().get(req.query.b) ? Number(req.query.b) : null);
  r.get('/', (req, res) => {
    // Always use /blog/ (with the slash) so the links inside work through any web address.
    if (!/\/$/.test(String(req.originalUrl || '').split('?')[0])) return res.redirect(301, `blog/${req.url.slice(1)}`);
    res.set('Cache-Control', 'no-cache').type('html').send(indexPage(biz(req)));
  });
  r.get('/feed.xml', (req, res) => res.set('Cache-Control', 'no-cache').type('application/rss+xml').send(feed(biz(req))));
  r.get('/:slug', (req, res) => {
    const p = bySlug(req.params.slug);
    if (!p || !p.published) return notFound(res);
    db.prepare('UPDATE crm_blog_posts SET views=views+1 WHERE id=?').run(p.id);
    res.set('Cache-Control', 'no-cache').type('html').send(postPage(p));
  });
  return r;
}

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req) => list(req.query.biz)));
router.get('/:id', wrap((req) => { const p = shape(get(req.params.id)); if (!p) throw err('Post not found', 404); return p; }));
router.post('/', wrap((req) => save(req.body || {}, null, req.query.biz)));
router.put('/:id', wrap((req) => save(req.body || {}, Number(req.params.id))));
router.delete('/:id', wrap((req) => remove(req.params.id)));
router.post('/preview', express.json({ limit: '1mb' }), (req, res) => {
  const p = { ...(req.body || {}), slug: 'preview', published_at: new Date().toISOString(), views: 0 };
  res.type('html').send(postPage({ ...p, title: String(p.title || 'Your title'), body: String(p.body || '') }));
});

module.exports = { save, list, remove, latest, toHtml, indexPage, postPage, feed, publicRouter, router, uniqueSlug };
