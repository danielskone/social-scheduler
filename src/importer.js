// Imports a "post bundle": one JSON file holding many posts and their pictures, so a
// whole batch can be prepared elsewhere and added to the calendar in one click.
//
// {
//   "posts": [{
//     "caption": "Text…",
//     "title": "Video title",                          // optional, YouTube only (max 100)
//     "when": "2026-11-03T18:00:00-05:00",            // any ISO date with timezone
//     "accounts": [{ "platform": "facebook", "name": "My Page" },
//                  { "platform": "instagram", "username": "myhandle" }],
//     "media": { "name": "pic.jpg", "data": "<base64>" }   // optional for Facebook-only posts
//        or { "url": "https://…/clip.mp4" }                 // downloaded by the app before posting
//   }]
// }
//
// With "replace": true at the top of the bundle, a post that is already on the calendar
// at the same time for the same accounts (and not yet posted) gets the new caption instead
// of being added again. Used to fix captions on posts imported earlier.
//
// Everything is checked first; if any post has a problem nothing is imported. Posts that
// already exist (same caption, time and accounts) are skipped, so importing twice is safe.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');

const norm = (s) => String(s || '').toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]/g, '');

function findAccount(all, ref) {
  const platform = String(ref.platform || '').toLowerCase();
  const pool = all.filter((a) => a.platform === platform);
  if (ref.id) return pool.find((a) => a.external_id === String(ref.id));
  if (ref.username) return pool.find((a) => norm(a.username) === norm(ref.username));
  if (ref.name) return pool.find((a) => norm(a.name) === norm(ref.name) || norm(a.username) === norm(ref.name));
  return undefined;
}

function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return { type: 'image', ext: '.jpg', jpg: true };
  if (buf.slice(0, 4).toString('hex') === '89504e47') return { type: 'image', ext: '.png', jpg: false };
  if (buf.slice(4, 8).toString() === 'ftyp') {
    return { type: 'video', ext: buf.slice(8, 10).toString() === 'qt' ? '.mov' : '.mp4' };
  }
  return null;
}

function importBundle(json, { now = Date.now() } = {}) {
  let bundle;
  try { bundle = typeof json === 'string' ? JSON.parse(json) : json; } catch {
    return { error: "That file isn't a post bundle (it couldn't be read)." };
  }
  if (!bundle || !Array.isArray(bundle.posts) || !bundle.posts.length) {
    return { error: "That file isn't a post bundle (no posts found)." };
  }
  const all = db.prepare('SELECT * FROM accounts').all();
  const problems = [];
  const ready = [];

  bundle.posts.forEach((p, i) => {
    const label = `Post ${i + 1}${p.caption ? ` ("${String(p.caption).slice(0, 30)}…")` : ''}`;
    const when = Date.parse(p.when);
    if (isNaN(when)) return problems.push(`${label}: missing or invalid date.`);
    if (when < now - 5 * 60e3) return problems.push(`${label}: the time ${p.when} is in the past.`);
    const refs = Array.isArray(p.accounts) ? p.accounts : [];
    if (!refs.length) return problems.push(`${label}: no accounts picked.`);
    const accts = [];
    for (const ref of refs) {
      const a = findAccount(all, ref);
      if (!a) return problems.push(`${label}: no connected ${ref.platform || ''} account called "${ref.username || ref.name || ref.id}".`);
      if (!accts.includes(a)) accts.push(a);
    }
    let media = null;
    if (p.media && p.media.url) {
      let u;
      try { u = new URL(p.media.url); } catch { return problems.push(`${label}: the media link isn't valid.`); }
      if (u.protocol !== 'https:') return problems.push(`${label}: the media link must start with https://.`);
      const ext = path.extname(u.pathname).toLowerCase();
      const type = p.media.type || (['.mp4', '.mov'].includes(ext) ? 'video' : ['.jpg', '.jpeg', '.png'].includes(ext) ? 'image' : null);
      if (!type) return problems.push(`${label}: can't tell if the media link is a photo or video.`);
      // Photos from links are converted to an Instagram-friendly JPG after download.
      media = { url: u.toString(), type, jpg: true };
    } else if (p.media && p.media.data) {
      const buf = Buffer.from(p.media.data, 'base64');
      const kind = sniff(buf);
      if (!kind) return problems.push(`${label}: the picture/video isn't a JPG, PNG, MP4 or MOV.`);
      media = { buf, ...kind };
    }
    const hasIg = accts.some((a) => a.platform === 'instagram');
    const caption = String(p.caption || '').trim();
    if (hasIg && !media) return problems.push(`${label}: Instagram posts need a photo or video.`);
    if (hasIg && media.type === 'image' && !media.jpg) return problems.push(`${label}: Instagram needs a JPG photo, not PNG.`);
    if (accts.some((a) => a.platform === 'youtube') && (!media || media.type !== 'video')) return problems.push(`${label}: YouTube posts need a video.`);
    if (hasIg && caption.length > 2200) return problems.push(`${label}: Instagram captions are limited to 2,200 characters.`);
    if (!caption && !media) return problems.push(`${label}: empty post.`);
    ready.push({ caption, title: String(p.title || '').trim() || null, when: new Date(when).toISOString(), accts, media });
  });

  if (problems.length) return { error: `Nothing was imported. Please fix: ${problems.join(' ')}`, problems };

  const exists = db.prepare(`
    SELECT p.id FROM posts p WHERE p.caption=? AND p.scheduled_at=?
      AND (SELECT group_concat(account_id) FROM (SELECT account_id FROM post_targets WHERE post_id=p.id ORDER BY account_id)) = ?`);
  const sameSlot = db.prepare(`
    SELECT p.id FROM posts p WHERE p.scheduled_at=?
      AND (SELECT group_concat(account_id) FROM (SELECT account_id FROM post_targets WHERE post_id=p.id ORDER BY account_id)) = ?
      AND NOT EXISTS (SELECT 1 FROM post_targets WHERE post_id=p.id AND status <> 'scheduled')`);
  const setCaption = db.prepare('UPDATE posts SET caption=?, title=COALESCE(?, title) WHERE id=?');
  const insPost = db.prepare('INSERT INTO posts (caption, media_file, media_type, scheduled_at, media_source_url, title) VALUES (?,?,?,?,?,?)');
  const insTarget = db.prepare('INSERT INTO post_targets (post_id, account_id) VALUES (?,?)');
  const written = [];
  let imported = 0, skipped = 0, updated = 0;
  try {
    db.transaction(() => {
      for (const r of ready) {
        const ids = r.accts.map((a) => a.id).sort((x, y) => x - y);
        if (exists.get(r.caption, r.when, ids.join(','))) { skipped++; continue; }
        if (bundle.replace) {
          const old = sameSlot.all(r.when, ids.join(','));
          if (old.length) { old.forEach((o) => setCaption.run(r.caption, r.title, o.id)); updated++; continue; }
        }
        let file = null;
        if (r.media && r.media.buf) {
          file = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${r.media.ext}`;
          fs.writeFileSync(path.join(config.mediaDir, file), r.media.buf);
          written.push(file);
        }
        const { lastInsertRowid } = insPost.run(r.caption, file, r.media ? r.media.type : null, r.when, r.media && r.media.url ? r.media.url : null, r.title);
        ids.forEach((id) => insTarget.run(lastInsertRowid, id));
        imported++;
      }
    })();
  } catch (err) {
    written.forEach((f) => fs.rmSync(path.join(config.mediaDir, f), { force: true }));
    throw err;
  }
  const first = ready.map((r) => r.when).sort()[0];
  return { imported, skipped, updated, first };
}

module.exports = { importBundle };
