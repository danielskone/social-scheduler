// "Fix words": one correction ("can you can't lay" -> "Candy Cane Lane") fixes a video everywhere.
// Whisper sometimes mishears song lyrics and names. Instead of fixing every clip by hand, the
// wrong words are replaced in the video's transcript (keeping each word's timing, so captions
// still pop up with the voice), in every clip's words and name, and in the captions and titles of
// posts in Viral Post that haven't gone out yet. Fixes can be remembered and are then used on
// every new video too.
const db = require('./db');

db.exec(`CREATE TABLE IF NOT EXISTS word_fixes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wrong TEXT NOT NULL UNIQUE COLLATE NOCASE,
  right TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
// Each fix is followed until its clips are made again, then the phone gets a buzz.
db.exec(`CREATE TABLE IF NOT EXISTS word_fix_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wrong TEXT NOT NULL, right TEXT NOT NULL,
  clip_ids TEXT NOT NULL DEFAULT '[]', posts_fixed INTEGER NOT NULL DEFAULT 0, already_out INTEGER NOT NULL DEFAULT 0,
  starter TEXT, notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
if (!db.prepare('PRAGMA table_info(posts)').all().some((c) => c.name === 'clip_id')) db.exec('ALTER TABLE posts ADD COLUMN clip_id INTEGER');

const words = (s) => String(s || '').split(/\s+/).map((w) => w.trim()).filter(Boolean);
const plain = (w) => String(w).toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}']/gu, '').replace(/^'+|'+$/g, '');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The wrong words as a search that ignores capitals and the commas, dots and spaces between words.
function phrase(wrong) {
  const list = words(wrong).map(plain).filter(Boolean);
  if (!list.length) return null;
  const word = (w) => esc(w).replace(/'/g, "['’‘]");
  return new RegExp(`(?<![\\p{L}\\p{N}'’])${list.map(word).join("[^\\p{L}\\p{N}'’]+")}(?![\\p{L}\\p{N}'’])`, 'giu');
}

// Replaces the wrong words in a piece of text. Returns { text, count }.
function fixText(text, wrong, right) {
  const re = phrase(wrong);
  if (!re || text == null) return { text, count: 0 };
  let count = 0;
  const out = String(text).replace(re, () => { count++; return right; });
  return { text: out, count };
}

// Replaces the wrong words in a transcript ({ segments: [{ start, end, text, words: [{text,start,end}] }] }).
// The new words share the time the wrong words took, so captions stay in time with the voice.
function fixTranscript(transcript, wrong, right) {
  const want = words(wrong).map(plain).filter(Boolean);
  const put = words(right);
  if (!want.length || !put.length || !transcript?.segments?.length) return 0;
  let count = 0;
  // Every word, with the sentence it belongs to (the wrong words can run over two sentences).
  const all = [];
  transcript.segments.forEach((s, si) => (s.words || []).forEach((w, wi) => all.push({ si, wi, w })));
  const live = all.filter((x) => plain(x.w.text));
  const touched = new Set();
  for (let i = 0; i + want.length <= live.length; i++) {
    if (!want.every((w, k) => plain(live[i + k].w.text) === w)) continue;
    const run = live.slice(i, i + want.length);
    const a = run[0].w.start, b = run[run.length - 1].w.end;
    const total = put.reduce((t, w) => t + w.length + 2, 0);
    let used = 0;
    const fresh = put.map((text) => {
      const s = a + ((b - a) * used) / total;
      used += text.length + 2;
      return { text, start: +s.toFixed(3), end: +(a + ((b - a) * used) / total).toFixed(3) };
    });
    // Keep punctuation that was on the last wrong word ("lay?" -> "Lane?").
    const tail = (run[run.length - 1].w.text.match(/[.,!?;:]+$/) || [''])[0];
    if (tail && !/[.,!?;:]$/.test(fresh[fresh.length - 1].text)) fresh[fresh.length - 1].text += tail;
    run.forEach((x, k) => { x.w.gone = k > 0; touched.add(x.si); });
    Object.assign(run[0].w, { replaceWith: fresh });
    count++;
    i += want.length - 1;
  }
  if (!count) return 0;
  for (const si of touched) {
    const seg = transcript.segments[si];
    seg.words = seg.words.flatMap((w) => (w.replaceWith ? w.replaceWith : w.gone ? [] : [w]));
  }
  // The sentence text: a straight swap when the wrong words sit inside one sentence; otherwise
  // the sentence is rebuilt from its words.
  for (const seg of transcript.segments) {
    const r = fixText(seg.text, wrong, right);
    if (r.count) seg.text = r.text;
    else if (touched.has(transcript.segments.indexOf(seg))) seg.text = seg.words.map((w) => w.text).join(' ');
  }
  return count;
}

// Fixes the app ships with. Each one runs by itself once on the Mac (all videos, clips and posts
// not sent yet), then is remembered for new videos. Daniel's elves song first:
// "Take a trip down Candy Cane Lane with me" was heard as "can you can't lay".
const STARTER_FIXES = [
  ["can you can't lay", 'Candy Cane Lane'],
  ["can you can't lane", 'Candy Cane Lane'],
  ["candy can't lane", 'Candy Cane Lane'],
  ["candy can't lay", 'Candy Cane Lane'],
  ['candy can lane', 'Candy Cane Lane'],
  ['candy cane lay', 'Candy Cane Lane'],
  ['can you can lay', 'Candy Cane Lane'],
  ['can you cane lane', 'Candy Cane Lane'],
];

// Saved fixes, used on every new video.
const list = () => db.prepare('SELECT id, wrong, right FROM word_fixes ORDER BY id').all();
function remember(wrong, right) {
  db.prepare(`INSERT INTO word_fixes (wrong, right) VALUES (?, ?) ON CONFLICT(wrong) DO UPDATE SET right=excluded.right`).run(wrong.trim(), right.trim());
}
const forget = (id) => db.prepare('DELETE FROM word_fixes WHERE id=?').run(id);
function applySaved(transcript) {
  let n = 0;
  for (const f of list()) n += fixTranscript(transcript, f.wrong, f.right);
  return n;
}

// Posts in Viral Post that still have an account to go to (waiting or failed): their caption and
// title are fixed. Accounts it already went to can't be changed from here (Facebook and Instagram
// keep their own copy), so those are counted to tell the person.
function fixPosts(wrong, right, { clipIds = [] } = {}) {
  const re = phrase(wrong);
  if (!re) return { fixed: 0, alreadyOut: 0 };
  const posts = db.prepare(`SELECT p.id, p.caption, p.title,
      SUM(t.status IN ('scheduled','failed')) AS waiting, SUM(t.status IN ('published','publishing')) AS out
    FROM posts p JOIN post_targets t ON t.post_id=p.id GROUP BY p.id`).all();
  const linked = new Set(clipIds.length ? db.prepare(`SELECT id FROM posts WHERE clip_id IN (${clipIds.map(() => '?').join(',')})`).all(...clipIds).map((r) => r.id) : []);
  let fixed = 0, alreadyOut = 0;
  const upd = db.prepare('UPDATE posts SET caption=?, title=? WHERE id=?');
  for (const p of posts) {
    const c = fixText(p.caption, wrong, right), t = fixText(p.title, wrong, right);
    if (!c.count && !t.count) { if (linked.has(p.id) && p.out) alreadyOut++; continue; }
    if (p.waiting) { upd.run(c.text, t.text, p.id); fixed++; }
    if (p.out) alreadyOut++;
  }
  return { fixed, alreadyOut };
}

// How many places the wrong words show up (for the live count in the Fix words box).
function countIn(texts, wrong) {
  const re = phrase(wrong);
  if (!re) return 0;
  return texts.reduce((n, t) => n + ((String(t || '').match(re) || []).length), 0);
}

module.exports = { STARTER_FIXES, phrase, fixText, fixTranscript, fixPosts, countIn, list, remember, forget, applySaved, plain };
