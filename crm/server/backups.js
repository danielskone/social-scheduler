// Backups: every night at 2:30 the CRM saves a full copy of its data in data/backups and keeps
// the last 14 nights. You can also make one now, download any of them (to keep on a USB stick or
// in iCloud Drive), and put one back.
//
// Putting a backup back only touches the CRM (people, deals, tasks, forms, invoices and the rest).
// Viral Post's posts and connected accounts stay as they are, so nothing gets posted twice.
// Before it puts one back, it saves a copy of how things are right now, so it can be undone.
const express = require('express');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const db = require('../../src/db');
const config = require('../../src/config');

const KEEP = 14;
const dir = () => { const d = path.join(config.dataDir, 'backups'); fs.mkdirSync(d, { recursive: true }); return d; };
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const NAME_RE = /^[\w-]+\.db$/;
const stamp = (d = new Date()) => d.toISOString().slice(0, 23).replace(/[:T.]/g, '-');
// The CRM's own tables (Viral Post's tables are left alone when restoring).
const isCrmTable = (t) => /^crm_/.test(t) || ['contacts', 'contact_activities', 'website_inbox', 'gcal_bookings', 'gcal_state'].includes(t);

function list() {
  return fs.readdirSync(dir()).filter((f) => NAME_RE.test(f)).map((f) => {
    const st = fs.statSync(path.join(dir(), f));
    return { name: f, size: st.size, at: st.mtime.toISOString(), kind: f.startsWith('nightly-') ? 'Nightly' : f.startsWith('before-restore-') ? 'Before a restore' : f.startsWith('uploaded-') ? 'Loaded from a file' : 'Made by you' };
  }).sort((a, b) => b.at.localeCompare(a.at));
}

async function make(kind = 'manual') {
  const file = path.join(dir(), `${kind}-${stamp()}.db`);
  await db.backup(file);
  if (kind === 'nightly') {
    const old = list().filter((b) => b.name.startsWith('nightly-')).slice(KEEP);
    for (const b of old) fs.rmSync(path.join(dir(), b.name), { force: true });
  }
  // Only a few "before a restore" copies are kept too.
  for (const b of list().filter((x) => x.name.startsWith('before-restore-')).slice(5)) fs.rmSync(path.join(dir(), b.name), { force: true });
  const st = fs.statSync(file);
  return { name: path.basename(file), size: st.size, at: st.mtime.toISOString() };
}
async function nightly() { return make('nightly'); }

const fileOf = (name) => {
  if (!NAME_RE.test(String(name || ''))) throw err('Backup not found', 404);
  const f = path.join(dir(), name);
  if (!fs.existsSync(f)) throw err('Backup not found', 404);
  return f;
};

// Checks a file really is a backup of this app, and says what is in it.
function inspect(file) {
  const head = Buffer.alloc(16);
  const fd = fs.openSync(file, 'r'); fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd);
  if (head.toString('latin1') !== 'SQLite format 3\0') throw err('That file is not a Viral Touch backup.');
  const src = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const tables = src.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    if (!tables.includes('contacts')) throw err('That file is not a Viral Touch backup.');
    const n = (t) => (tables.includes(t) ? src.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n : 0);
    return { people: n('contacts'), tasks: n('crm_tasks'), invoices: n('crm_invoices'), appointments: n('crm_appointments') };
  } finally { src.close(); }
}

// Puts a backup's CRM tables back, inside the live database (so every open program sees it at once).
async function restore(name) {
  const file = fileOf(name);
  const what = inspect(file);
  const safety = await make('before-restore');
  db.prepare('ATTACH DATABASE ? AS src').run(file);
  try {
    const srcTables = new Set(db.prepare("SELECT name FROM src.sqlite_master WHERE type='table'").all().map((r) => r.name));
    const mine = db.prepare("SELECT name FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name).filter(isCrmTable);
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        for (const t of mine) {
          db.prepare(`DELETE FROM main."${t}"`).run();
          if (!srcTables.has(t)) continue;
          const cols = db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all().map((r) => r.name);
          const have = new Set(db.prepare(`SELECT name FROM src.pragma_table_info('${t}')`).all().map((r) => r.name));
          const both = cols.filter((c) => have.has(c)).map((c) => `"${c}"`).join(',');
          if (both) db.prepare(`INSERT INTO main."${t}" (${both}) SELECT ${both} FROM src."${t}"`).run();
        }
      })();
    } finally { db.pragma('foreign_keys = ON'); }
  } finally { db.prepare('DETACH DATABASE src').run(); }
  return { ok: true, restored: what, undo: safety.name };
}

// A backup file you downloaded earlier, sent back from your computer.
async function upload(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 100) throw err('Pick a backup file first.');
  const name = `uploaded-${stamp()}.db`, file = path.join(dir(), name);
  fs.writeFileSync(file, buf);
  try { return { name, ...inspect(file) }; } catch (e) { fs.rmSync(file, { force: true }); throw e; }
}
function remove(name) { fs.rmSync(fileOf(name), { force: true }); return { ok: true }; }

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap(() => ({ backups: list(), keep: KEEP, folder: dir() })));
router.post('/', wrap(() => make('manual')));
router.post('/upload', wrap((req) => upload(req.body)));
router.post('/:name/restore', wrap((req) => restore(req.params.name)));
router.get('/:name/check', wrap((req) => inspect(fileOf(req.params.name))));
router.delete('/:name', wrap((req) => remove(req.params.name)));
router.get('/:name/download', (req, res) => {
  try { res.download(fileOf(req.params.name), `viral-touch-${req.params.name}`); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

module.exports = { list, make, nightly, restore, upload, inspect, isCrmTable, router };
