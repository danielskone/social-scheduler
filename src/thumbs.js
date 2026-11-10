// Small preview pictures for the calendar and analytics, so the phone doesn't download
// full-size photos and videos just to show a little square. Made once, then reused.
// On a Mac this uses the built-in `sips` (photos) and `qlmanage` (videos); elsewhere photos
// fall back to the original file and videos get no preview.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const config = require('./config');

const thumbDir = path.join(config.dataDir, 'thumbs');
const SIZE = 480;
const isMac = process.platform === 'darwin';
const VIDEO = /\.(mp4|mov|m4v)$/i;
const inFlight = new Map();
let running = 0;
const waiting = [];

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 30000 }, (err) => (err ? reject(err) : resolve()));
});

// At most two previews are made at the same time, so a full calendar doesn't slow the Mac down.
async function limited(fn) {
  if (running >= 2) await new Promise((r) => waiting.push(r));
  running++;
  try { return await fn(); } finally { running--; waiting.shift()?.(); }
}

async function make(src, out) {
  fs.mkdirSync(thumbDir, { recursive: true });
  if (VIDEO.test(src)) {
    const tmp = fs.mkdtempSync(path.join(thumbDir, 'q-'));
    try {
      await run('qlmanage', ['-t', '-s', String(SIZE), '-o', tmp, src]);
      const png = fs.readdirSync(tmp).find((f) => f.endsWith('.png'));
      if (!png) throw new Error('no preview');
      await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '70', path.join(tmp, png), '--out', out]);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  } else {
    await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '72', '-Z', String(SIZE), src, '--out', out]);
  }
}

// Returns the path of a preview file to send, or null if there is none.
async function thumbFor(file) {
  if (!/^[\w.-]+$/.test(file)) return null;
  const src = path.join(config.mediaDir, file);
  if (!fs.existsSync(src)) return null;
  const out = path.join(thumbDir, `${file}.jpg`);
  if (fs.existsSync(out)) return out;
  if (!isMac) return VIDEO.test(file) ? null : src;
  if (!inFlight.has(file)) {
    inFlight.set(file, limited(() => make(src, out)).then(() => out, () => null).finally(() => inFlight.delete(file)));
  }
  const made = await inFlight.get(file);
  return made || (VIDEO.test(file) ? null : src);
}

// Makes the previews for posts around today ahead of time (a few at a time, in the
// background), so the calendar opens with its pictures ready instead of making them while you wait.
let warming = false;
async function warm(db, limit = 12) {
  if (warming || !isMac) return 0;
  warming = true;
  let made = 0;
  try {
    const now = Date.now();
    const rows = db.prepare(`SELECT media_file FROM posts WHERE media_file IS NOT NULL AND scheduled_at BETWEEN ? AND ?
      ORDER BY ABS(julianday(scheduled_at) - julianday(?))`).all(new Date(now - 45 * 864e5).toISOString(), new Date(now + 75 * 864e5).toISOString(), new Date(now).toISOString());
    for (const { media_file: file } of rows) {
      if (made >= limit) break;
      if (!/^[\w.-]+$/.test(file) || fs.existsSync(path.join(thumbDir, `${file}.jpg`))) continue;
      if (!fs.existsSync(path.join(config.mediaDir, file))) continue;
      await thumbFor(file);
      made++;
    }
  } finally {
    warming = false;
  }
  return made;
}

module.exports = { thumbFor, warm };
