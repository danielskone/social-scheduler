// "Hollywood look" for Viral Post: makes photos and videos sharper, a little brighter, with more
// contrast and a soft movie-style color grade (cool shadows, warm highlights, richer colors that
// keep skin natural). Optional "Remove words on screen" (see textremove.js).
// Everything runs on this computer with ffmpeg. Free, no internet, nothing to pay.
//
// How it fits in: each post remembers its look. A few minutes ahead of time the Mac makes a
// finished copy of the photo or video (the original file is never changed), and that copy is
// what gets posted. The same file used by many posts is only made once.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const config = require('./config');
const db = require('./db');
const textremove = require('./textremove');

db.exec(`
CREATE TABLE IF NOT EXISTS media_looks (
  key TEXT PRIMARY KEY,                 -- which file + which look
  out TEXT,                             -- finished copy, in the media folder
  status TEXT NOT NULL DEFAULT 'working', -- working, ready, failed
  error TEXT, note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS post_settings (key TEXT PRIMARY KEY, value TEXT);
`);
const postCols = db.prepare('PRAGMA table_info(posts)').all().map((c) => c.name);
if (!postCols.includes('look')) db.exec('ALTER TABLE posts ADD COLUMN look TEXT');
if (!postCols.includes('remove_text')) db.exec('ALTER TABLE posts ADD COLUMN remove_text INTEGER NOT NULL DEFAULT 0');

const LOOK_NAMES = ['off', 'light', 'hollywood'];

// The looks, as ffmpeg filters. Kept gentle on purpose so faces never look overdone.
//  - hqdn3d: removes a little grain first, so sharpening doesn't make it worse
//  - unsharp: sharpens the details (brightness only, so colors don't get crunchy edges)
//  - curves: a soft "S": deeper shadows, brighter middle, highlights that roll off like film
//  - eq: a touch more contrast and brightness
//  - colorbalance: cool blue-green shadows and warm highlights (the classic movie grade)
//  - vibrance: richer colors, boosting dull colors more than ones that are already strong (skin)
const LOOKS = {
  light: ['unsharp=5:5:0.5:5:5:0', 'eq=contrast=1.04:brightness=0.01:saturation=1.04', 'vibrance=intensity=0.08'],
  hollywood: [
    'hqdn3d=1:1:2:2',
    'unsharp=5:5:0.8:5:5:0',
    "curves=master='0/0.015 0.25/0.235 0.5/0.53 0.75/0.8 1/0.985'",
    'eq=contrast=1.06:brightness=0.012',
    'colorbalance=rs=-0.03:gs=-0.005:bs=0.04:rh=0.012:gh=0.004:bh=-0.008',
    'vibrance=intensity=0.12',
  ],
};

function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { const p = require('ffmpeg-static'); if (p && fs.existsSync(p)) return p; } catch {}
  return 'ffmpeg';
}

// Which filters this computer's ffmpeg has (a missing one is skipped, never an error).
let filterList = null;
function availableFilters() {
  if (filterList) return Promise.resolve(filterList);
  return new Promise((resolve) => {
    execFile(ffmpegPath(), ['-hide_banner', '-filters'], { maxBuffer: 8 << 20 }, (err, stdout) => {
      filterList = new Set(String(stdout || '').split('\n').map((l) => l.trim().split(/\s+/)[1]).filter(Boolean));
      resolve(filterList);
    });
  });
}
async function lookFilters(look) {
  const have = await availableFilters();
  return (LOOKS[look] || []).filter((f) => !have.size || have.has(f.split('=')[0]));
}

function run(args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    try { os.setPriority(child.pid, 10); } catch {}
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').slice(-2).join(' ') || `ffmpeg stopped (${code})`))));
  });
}

// What ffmpeg says about a file: size as shown (turned upright), length, sound, HDR.
function probe(file) {
  return new Promise((resolve) => {
    execFile(ffmpegPath(), ['-hide_banner', '-i', file], { maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      const out = String(stderr);
      const d = out.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      const v = out.match(/Stream #.*Video:.*?(\d{2,5})x(\d{2,5})/);
      if (!v) return resolve(null);
      let width = Number(v[1]), height = Number(v[2]);
      const rot = out.match(/rotation of (-?[\d.]+)|rotate\s*:\s*(-?\d+)/);
      if (rot && Math.abs(Math.round(Number(rot[1] || rot[2]))) % 180 === 90) [width, height] = [height, width];
      resolve({
        width, height,
        duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0,
        audio: (out.match(/Stream #.*Audio:\s*(\w+)/) || [])[1] || null,
        hdr: /arib-std-b67|smpte2084/.test(out),
      });
    });
  });
}

// Photos from phones are often stored sideways with a note saying "turn me". Different ffmpeg
// versions treat that note differently, so the note is read here and the turn is done by us.
function jpegOrientation(file) {
  let buf;
  try { const fd = fs.openSync(file, 'r'); buf = Buffer.alloc(128 * 1024); fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd); } catch { return 1; }
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 < buf.length && buf[i] === 0xff) {
    const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (marker === 0xe1 && buf.toString('latin1', i + 4, i + 10) === 'Exif\0\0') {
      const t = i + 10;
      const le = buf.toString('latin1', t, t + 2) === 'II';
      const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
      const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
      const ifd = t + u32(t + 4);
      const n = u16(ifd);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (e + 12 > buf.length) break;
        if (u16(e) === 0x0112) return u16(e + 8) || 1;
      }
      return 1;
    }
    if (marker === 0xda) break;
    i += 2 + len;
  }
  return 1;
}
const ORIENT = { 2: 'hflip', 3: 'hflip,vflip', 4: 'vflip', 5: 'transpose=0', 6: 'transpose=1', 7: 'transpose=3', 8: 'transpose=2' };

// iPhone HDR videos look washed out once made into a normal video, unless they're toned down first.
async function hdrFilters(info) {
  if (!info.hdr) return [];
  const have = await availableFilters();
  if (!have.has('zscale') || !have.has('tonemap')) return null; // can't do it well here: leave the video as it is
  return ['zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=tv', 'format=yuv420p'];
}

const THREADS = String(Math.max(1, Math.floor((os.cpus()?.length || 2) / 2)));

// Makes the finished copy of one photo or video. Returns { note } (a note says what was skipped).
async function render({ source, dest, type, look, removeText, onProgress }) {
  const ff = ffmpegPath();
  const info = await probe(source);
  if (!info) throw new Error("This file couldn't be read.");
  const notes = [];
  if (type === 'image') {
    const rotate = /\.jpe?g$/i.test(source) ? ORIENT[jpegOrientation(source)] : null;
    const chain = rotate ? [rotate] : [];
    const w = rotate && /transpose/.test(rotate) ? info.height : info.width;
    const h = rotate && /transpose/.test(rotate) ? info.width : info.height;
    if (removeText) {
      const r = await textremove.removalFilters({ ffmpeg: ff, source, width: w, height: h, image: { rotate } });
      chain.push(...r.filters);
      if (!r.spots.length) notes.push('No words were found on this photo.');
    }
    chain.push(...(await lookFilters(look)));
    // Very big photos are brought down to 4096 pixels on the long side (more than any app shows).
    if (Math.max(w, h) > 4096) chain.push(w >= h ? 'scale=4096:-2:flags=lanczos' : 'scale=-2:4096:flags=lanczos');
    chain.push('format=yuvj444p');
    await run(['-hide_banner', '-y', '-noautorotate', '-i', source, '-vf', chain.join(','), '-frames:v', '1', '-q:v', '2', dest]);
    return { note: notes.join(' ') || null };
  }
  const hdr = await hdrFilters(info);
  const chain = [];
  if (hdr === null) {
    if (!removeText) throw Object.assign(new Error('This is an HDR video and this computer can\'t grade it safely, so the original is used.'), { keepOriginal: true });
    notes.push('HDR video: only the words were removed, colors left as they were.');
  } else chain.push(...hdr);
  if (removeText) {
    const r = await textremove.removalFilters({ ffmpeg: ff, source, width: info.width, height: info.height, duration: info.duration,
      onProgress: (p) => onProgress?.(p * 0.6) });
    chain.push(...r.filters);
    if (!r.spots.length) notes.push('No words were found on this video.');
  }
  if (hdr !== null) chain.push(...(await lookFilters(look)));
  chain.push('format=yuv420p');
  // The filter list can be long (one entry per line of lyrics), so it goes in a small file.
  const script = `${dest}.filters.txt`;
  fs.writeFileSync(script, chain.join(',\n'));
  try {
    // Same quality settings as Viral Clips: sharp, and small enough for every app's upload limit.
    await run(['-hide_banner', '-y', '-i', source, '-filter_script:v', script, '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-maxrate', '12M', '-bufsize', '20M', '-profile:v', 'high',
      ...(info.audio === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k']),
      '-movflags', '+faststart', '-threads', THREADS, dest]);
  } finally {
    fs.rmSync(script, { force: true });
  }
  return { note: notes.join(' ') || null };
}

// ---------- Settings ----------
function settings() {
  const rows = Object.fromEntries(db.prepare('SELECT key, value FROM post_settings').all().map((r) => [r.key, r.value]));
  return { look: LOOK_NAMES.includes(rows.look) ? rows.look : 'hollywood', removeText: rows.remove_text === '1' };
}
function saveSettings({ look, removeText }) {
  const set = db.prepare('INSERT INTO post_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  if (LOOK_NAMES.includes(look)) set.run('look', look);
  if (removeText !== undefined) set.run('remove_text', removeText ? '1' : '0');
  return settings();
}
// Cleans up what a form or import file said about the look. Missing = the saved default.
function pick(look, removeText) {
  const d = settings();
  const l = LOOK_NAMES.includes(String(look)) ? String(look) : d.look;
  const rt = removeText === undefined || removeText === null || removeText === '' ? d.removeText
    : removeText === true || removeText === 1 || /^(1|true|on|yes)$/i.test(String(removeText));
  return { look: l === 'off' ? null : l, removeText: rt ? 1 : 0 };
}

// ---------- Finished copies ----------
// The same picture file (also when shared by many imported posts) + the same look = one copy.
function keyFor(post) {
  if (!post.media_file || (!post.look && !post.remove_text)) return null;
  let st;
  try { st = fs.statSync(path.join(config.mediaDir, post.media_file)); } catch { return null; }
  return `${st.dev}:${st.ino}:${st.size}:${Math.round(st.mtimeMs)}|${post.look || 'off'}|${post.remove_text ? 1 : 0}`;
}
const progress = new Map(); // key -> 0..1 while working

const inflight = new Map(); // key -> the copy being made right now
function prepare(post) {
  const key = keyFor(post);
  if (!key) return Promise.resolve(null);
  if (inflight.has(key)) return inflight.get(key); // already being made: wait for that one
  const row = db.prepare('SELECT * FROM media_looks WHERE key=?').get(key);
  if (row && row.status !== 'working') return Promise.resolve(row);
  const job = make(post, key).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

async function make(post, key) {
  const ext = post.media_type === 'image' ? '.jpg' : '.mp4';
  const out = `look-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}${ext}`;
  db.prepare(`INSERT INTO media_looks (key, out, status) VALUES (?,?,'working')
              ON CONFLICT(key) DO UPDATE SET status='working', error=NULL, out=excluded.out`).run(key, out);
  progress.set(key, 0);
  const dest = path.join(config.mediaDir, out);
  const tmp = dest.replace(/(\.\w+)$/, '.part$1');
  try {
    const r = await render({ source: path.join(config.mediaDir, post.media_file), dest: tmp, type: post.media_type,
      look: post.look, removeText: Boolean(post.remove_text), onProgress: (p) => progress.set(key, p) });
    fs.renameSync(tmp, dest);
    db.prepare(`UPDATE media_looks SET status='ready', note=?, error=NULL WHERE key=?`).run(r.note, key);
    console.log(`[look] post ${post.id}: ${post.look || 'no look'}${post.remove_text ? ' + words removed' : ''} -> ${out}`);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    db.prepare(`UPDATE media_looks SET status='failed', error=? WHERE key=?`).run(String(err.message || err).slice(0, 500), key);
    console.error(`[look] post ${post.id}: ${err.message}`);
  } finally {
    progress.delete(key);
  }
  return db.prepare('SELECT * FROM media_looks WHERE key=?').get(key);
}

// The status shown on a post: null (no look), or { status, note, error, progress }.
function statusFor(post) {
  const key = keyFor(post);
  if (!key) return null;
  const row = db.prepare('SELECT status, note, error, out FROM media_looks WHERE key=?').get(key);
  if (!row) return { status: 'waiting' };
  return { status: row.status, note: row.note, error: row.error, progress: progress.has(key) ? Math.round(progress.get(key) * 100) : null,
    url: row.status === 'ready' ? `/media/${row.out}` : null };
}

// Used when publishing: which file to post.
//  { file } = post this file;  { wait: true } = the finished copy is still being made.
// If the copy can't be made, or isn't ready 30 minutes after the post time, the original is posted.
const WAIT_MINUTES = 30;
function mediaFor(post, now = new Date()) {
  const key = keyFor(post);
  if (!key) return { file: post.media_file };
  const row = db.prepare('SELECT * FROM media_looks WHERE key=?').get(key);
  if (row?.status === 'ready' && fs.existsSync(path.join(config.mediaDir, row.out))) return { file: row.out };
  if (row?.status === 'failed') return { file: post.media_file };
  if (now - new Date(post.scheduled_at) > WAIT_MINUTES * 60e3) return { file: post.media_file };
  return { wait: true };
}

// Background work: makes the finished copies for upcoming posts, soonest first, one at a time.
let busy = false;
async function work() {
  if (busy) return;
  busy = true;
  try {
    const since = new Date(Date.now() - WAIT_MINUTES * 60e3).toISOString();
    const until = new Date(Date.now() + 14 * 864e5).toISOString(); // two weeks ahead is plenty
    const posts = db.prepare(`
      SELECT DISTINCT p.* FROM posts p JOIN post_targets t ON t.post_id = p.id
      WHERE t.status = 'scheduled' AND p.media_file IS NOT NULL AND (p.look IS NOT NULL OR p.remove_text = 1)
        AND p.scheduled_at BETWEEN ? AND ? ORDER BY p.scheduled_at`).all(since, until);
    for (const p of posts) {
      const key = keyFor(p);
      if (!key) continue;
      const row = db.prepare('SELECT status FROM media_looks WHERE key=?').get(key);
      if (row && row.status !== 'working') continue;
      await prepare(p);
    }
  } finally {
    busy = false;
  }
}

// Finished copies nobody needs any more (posted more than 3 days ago, or the post was removed).
function cleanUp() {
  const needed = new Set();
  const since = new Date(Date.now() - 3 * 864e5).toISOString();
  for (const p of db.prepare(`SELECT * FROM posts WHERE media_file IS NOT NULL AND (look IS NOT NULL OR remove_text = 1) AND scheduled_at >= ?`).all(since)) {
    const k = keyFor(p);
    if (k) needed.add(k);
  }
  let removed = 0;
  for (const row of db.prepare(`SELECT key, out FROM media_looks WHERE created_at < datetime('now', '-1 day')`).all()) {
    if (needed.has(row.key) || progress.has(row.key)) continue;
    if (row.out) fs.rmSync(path.join(config.mediaDir, row.out), { force: true });
    db.prepare('DELETE FROM media_looks WHERE key=?').run(row.key);
    removed++;
  }
  return removed;
}

// Before/after preview in New post: the app sends one picture (a photo, or one frame of the
// video) and gets it back with the look (and words removed, if asked).
async function preview(file, { look, removeText }) {
  const dest = `${file}-after.jpg`;
  await render({ source: file, dest, type: 'image', look: look === 'off' ? null : look, removeText });
  return dest;
}

module.exports = { LOOKS, LOOK_NAMES, settings, saveSettings, pick, prepare, statusFor, mediaFor, work, cleanUp, preview, render, probe, jpegOrientation, keyFor };
