// Keeps posts apart: no account gets two posts at (nearly) the same time.
// "Schedule all" in Viral Clips used to plan each video on its own, so clips from different
// videos landed on the same hours (several 2 PM and 3 PM posts on one day). This moves the
// extra posts to the next free time that day (8 AM to 9:30 PM, Mac time), keeping at least an
// hour between posts on each account. If a day is full it uses the next day. The post that was
// on the calendar first keeps its time. Posts that have gone out (or are about to) never move.
const db = require('./db');

const GAP = 60 * 60e3;          // at least an hour between two posts on one account
const STEP = 15 * 60e3;         // times are tried every 15 minutes
const DAY_START = 8 * 60;       // 8:00 AM
const DAY_END = 21 * 60 + 30;   // 9:30 PM
const LOCKED_WITHIN = 15 * 60e3; // posts due in the next 15 minutes stay put

const minutesOf = (t) => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
function nextMorning(t) {
  const d = new Date(t);
  d.setDate(d.getDate() + 1);
  d.setHours(Math.floor(DAY_START / 60), DAY_START % 60, 0, 0);
  return d.getTime();
}
// The time itself if it is inside the posting hours, else the next time that is.
function inHours(t) {
  const m = minutesOf(t);
  if (m > DAY_END) return nextMorning(t);
  if (m < DAY_START) { const d = new Date(t); d.setHours(Math.floor(DAY_START / 60), DAY_START % 60, 0, 0); return d.getTime(); }
  return t;
}

// Works out the moves. Returns [{ id, from, to }] (ISO times). Changes nothing.
function plan({ now = Date.now() } = {}) {
  const rows = db.prepare(`SELECT p.id, p.scheduled_at, t.account_id, t.status
    FROM posts p JOIN post_targets t ON t.post_id=p.id
    WHERE p.scheduled_at >= ? ORDER BY p.scheduled_at, p.id`).all(new Date(now - 864e5).toISOString());
  const posts = new Map();
  for (const r of rows) {
    if (!posts.has(r.id)) posts.set(r.id, { id: r.id, at: Date.parse(r.scheduled_at), accounts: [], waiting: true });
    const p = posts.get(r.id);
    p.accounts.push(r.account_id);
    if (r.status !== 'scheduled') p.waiting = false;
  }
  const all = [...posts.values()];
  const movable = (p) => p.waiting && p.at > now + LOCKED_WITHIN;
  const taken = new Map(); // account -> times
  const take = (p, at) => p.accounts.forEach((a) => (taken.get(a) || taken.set(a, []).get(a)).push(at));
  const clash = (p, at) => p.accounts.some((a) => (taken.get(a) || []).some((t) => Math.abs(t - at) < GAP));
  all.filter((p) => !movable(p)).forEach((p) => take(p, p.at));
  const moves = [];
  for (const p of all.filter(movable)) {
    let at = p.at;
    if (clash(p, at)) {
      at = inHours(at);
      const limit = p.at + 14 * 864e5;
      while (clash(p, at) && at < limit) at = inHours(at + STEP);
      if (clash(p, at)) at = p.at; // nowhere free in two weeks: leave it
    }
    take(p, at);
    if (at !== p.at) moves.push({ id: p.id, from: new Date(p.at).toISOString(), to: new Date(at).toISOString() });
  }
  return moves;
}

function run(opts) {
  const moves = plan(opts);
  const upd = db.prepare('UPDATE posts SET scheduled_at=? WHERE id=?');
  db.transaction(() => moves.forEach((m) => upd.run(m.to, m.id)))();
  if (moves.length) console.log(`[spread] moved ${moves.length} posts so no account has two at the same time`);
  return moves;
}

// Once on the Mac, for the posts already on the calendar.
db.exec("CREATE TABLE IF NOT EXISTS spread_runs (name TEXT PRIMARY KEY, moved INTEGER NOT NULL DEFAULT 0, done_at TEXT NOT NULL DEFAULT (datetime('now')))");
async function runOnce(name, { notify = require('./notify'), ...opts } = {}) {
  if (db.prepare('SELECT 1 FROM spread_runs WHERE name=?').get(name)) return null;
  const moves = run(opts);
  db.prepare('INSERT INTO spread_runs (name, moved) VALUES (?, ?)').run(name, moves.length);
  if (moves.length) await notify.send('Posts spread out', `${moves.length} post${moves.length === 1 ? ' was' : 's were'} moved so no account gets two posts at the same time. Posts on each account are at least an hour apart now.`, { tags: 'calendar' }).catch(() => {});
  return moves;
}

module.exports = { plan, run, runOnce, GAP };
