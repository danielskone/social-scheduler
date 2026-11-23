// Posts Claude prepares go straight onto the calendar, so nobody has to click Import posts.
// A post bundle (same format as Calendar > Import posts, see importer.js) put in the imports/
// folder of the app reaches the Mac with the next automatic update. When Viral Post starts on
// the Mac it imports each bundle there once, skips posts whose time has already passed, and
// buzzes the phone with how many posts were added. Bundles already imported are remembered by
// name, so they are never added twice (the importer also skips posts that already exist).
const fs = require('fs');
const path = require('path');
const db = require('./db');

db.exec(`CREATE TABLE IF NOT EXISTS auto_imports (
  name TEXT PRIMARY KEY,
  added INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const folder = () => path.join(__dirname, '..', 'imports');

// One pass over the folder. Returns what happened to each bundle (for tests and the log).
async function run({ dir = folder(), notify = require('./notify'), importBundle = require('./importer').importBundle, now = Date.now() } = {}) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(); } catch { return []; }
  const done = new Set(db.prepare('SELECT name FROM auto_imports').all().map((r) => r.name));
  const out = [];
  for (const name of names) {
    if (done.has(name)) continue;
    let bundle;
    try { bundle = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch (err) {
      out.push({ name, error: `could not read it: ${err.message}` });
      continue;
    }
    const posts = (bundle.posts || []).filter((p) => Date.parse(p.when) > now + 2 * 60e3);
    let added = 0;
    if (posts.length) {
      const r = importBundle({ ...bundle, posts }, { now });
      if (r.error) {
        out.push({ name, error: r.error });
        console.error(`[auto-import] ${name}: ${r.error}`);
        await notify.send('Posts could not be added', `${name}\n${String(r.error).slice(0, 300)}`, { tags: 'warning' }).catch(() => {});
        continue;
      }
      added = r.imported;
    }
    db.prepare('INSERT OR REPLACE INTO auto_imports (name, added) VALUES (?, ?)').run(name, added);
    out.push({ name, added });
    console.log(`[auto-import] ${name}: added ${added} posts`);
    if (added) await notify.send('New posts added', `${added} posts were added to your Viral Post calendar (${name.replace(/\.json$/, '')}).`, { tags: 'calendar' }).catch(() => {});
  }
  return out;
}

function start() {
  setTimeout(() => run().catch((err) => console.error('[auto-import]', err.message)), 20e3).unref();
}

module.exports = { run, start, folder };
