// Downloads media for posts imported with a link (e.g. moved over from another
// scheduler), so they don't depend on the other service later. On a Mac, photos going
// to Instagram are also made Instagram-ready with the built-in `sips` tool: PNG -> JPG,
// and very tall or wide pictures padded to a shape Instagram accepts (4:5 to 1.91:1).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('./config');
const db = require('./db');

const inFlight = new Map();

function sips(args) {
  return execFileSync('sips', args, { stdio: 'pipe' }).toString();
}

function igReady(file) {
  if (process.platform !== 'darwin') return file;
  const full = path.join(config.mediaDir, file);
  const info = sips(['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'format', full]);
  const w = Number((info.match(/pixelWidth: (\d+)/) || [])[1]);
  const h = Number((info.match(/pixelHeight: (\d+)/) || [])[1]);
  const isJpeg = /format: jpeg/.test(info);
  let padW = w, padH = h;
  if (h / w > 1.25) padW = Math.ceil(h / 1.25);
  else if (w / h > 1.91) padH = Math.ceil(w / 1.91);
  if (isJpeg && padW === w && padH === h) return file;
  const out = file.replace(/\.[^.]+$/, '') + '-ig.jpg';
  const outFull = path.join(config.mediaDir, out);
  sips(['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', full, '--out', outFull]);
  if (padW !== w || padH !== h) sips(['--padToHeightWidth', String(padH), String(padW), '--padColor', '000000', outFull]);
  fs.rmSync(full, { force: true });
  return out;
}

async function download(post) {
  const res = await fetch(post.media_source_url);
  if (!res.ok) throw new Error(`Couldn't download the media (HTTP ${res.status}).`);
  const ext = (path.extname(new URL(post.media_source_url).pathname).toLowerCase() || (post.media_type === 'video' ? '.mp4' : '.jpg'))
    .replace('.jpeg', '.jpg');
  let file = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(config.mediaDir, file), Buffer.from(await res.arrayBuffer()));
  const toInstagram = db.prepare(`SELECT 1 FROM post_targets t JOIN accounts a ON a.id=t.account_id
    WHERE t.post_id=? AND a.platform='instagram'`).get(post.id);
  if (post.media_type === 'image' && toInstagram) {
    try { file = igReady(file); } catch (err) { console.error(`[media] couldn't convert ${file} for Instagram: ${err.message}`); }
  }
  db.prepare('UPDATE posts SET media_file=? WHERE id=?').run(file, post.id);
  return file;
}

// Returns the post's local media file, downloading it first if needed.
function ensureMedia(postId) {
  const post = db.prepare('SELECT * FROM posts WHERE id=?').get(postId);
  if (!post || post.media_file || !post.media_source_url) return Promise.resolve(post && post.media_file);
  if (!inFlight.has(postId)) {
    inFlight.set(postId, download(post).finally(() => inFlight.delete(postId)));
  }
  return inFlight.get(postId);
}

// Downloads media for upcoming posts in the background, soonest first.
let busy = false;
async function prefetch(limit = 10) {
  if (busy) return;
  busy = true;
  try {
    const rows = db.prepare(`SELECT id FROM posts WHERE media_file IS NULL AND media_source_url IS NOT NULL
      ORDER BY scheduled_at LIMIT ?`).all(limit);
    for (const r of rows) {
      try { await ensureMedia(r.id); } catch (err) { console.error(`[media] post ${r.id}: ${err.message}`); }
    }
  } finally {
    busy = false;
  }
}

module.exports = { ensureMedia, prefetch, igReady };
