// Custom fields: boxes each business adds to a person's card, like "Car model", "Shirt size"
// or "Birthday". A field with no business is shown for every business.
// Values are saved on the person (contacts.custom, JSON keyed "f<field id>").
const express = require('express');
const db = require('../../src/db');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_fields (
  id INTEGER PRIMARY KEY,
  business_id INTEGER,                     -- empty = every business
  label TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',       -- text, long, number, money, date, choice, yesno, link
  options TEXT NOT NULL DEFAULT '[]',      -- JSON choices for "choice"
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
if (!db.prepare("SELECT 1 FROM pragma_table_info('contacts') WHERE name='custom'").get()) db.exec('ALTER TABLE contacts ADD COLUMN custom TEXT');

const TYPES = ['text', 'long', 'number', 'money', 'date', 'choice', 'yesno', 'link'];
const parse = (f) => (f ? { ...f, key: `f${f.id}`, options: (() => { try { return JSON.parse(f.options) || []; } catch { return []; } })() } : null);
const all = () => db.prepare('SELECT * FROM crm_fields ORDER BY sort, id').all().map(parse);
const get = (id) => parse(db.prepare('SELECT * FROM crm_fields WHERE id=?').get(Number(id)));
const forBiz = (biz) => (biz == null || biz === '' || biz === 'all' ? all() : all().filter((f) => f.business_id == null || f.business_id === Number(biz)));
const err400 = (m) => Object.assign(new Error(m), { status: 400 });

function save(body, id) {
  const old = id ? get(id) : null;
  if (id && !old) throw Object.assign(new Error('Field not found'), { status: 404 });
  const label = String(body.label ?? (old && old.label) ?? '').trim().slice(0, 50);
  if (!label) throw err400('Give the field a name, like "Car model".');
  const type = TYPES.includes(body.type) ? body.type : (old ? old.type : 'text');
  let options = Array.isArray(body.options) ? body.options : typeof body.options === 'string' ? body.options.split(/[\n,]/) : (old ? old.options : []);
  options = [...new Set(options.map((o) => String(o).trim().slice(0, 60)).filter(Boolean))].slice(0, 30);
  if (type === 'choice' && options.length < 2) throw err400('Add at least 2 choices, one per line.');
  let business = old ? old.business_id : null;
  if ('business_id' in body) business = body.business_id === '' || body.business_id == null || body.business_id === 'all' ? null : Number(body.business_id);
  const dup = forBiz(business ?? '').find((f) => f.id !== Number(id) && f.label.toLowerCase() === label.toLowerCase());
  if (dup) throw err400(`There is already a field called "${dup.label}".`);
  if (old) {
    db.prepare('UPDATE crm_fields SET label=?, type=?, options=?, business_id=? WHERE id=?').run(label, type, JSON.stringify(type === 'choice' ? options : []), business, old.id);
    return get(old.id);
  }
  if (all().length >= 60) throw err400('That is a lot of fields. Remove one you don\'t use first.');
  const sort = (db.prepare('SELECT MAX(sort) AS m FROM crm_fields').get().m || 0) + 1;
  return get(db.prepare('INSERT INTO crm_fields (business_id, label, type, options, sort) VALUES (?,?,?,?,?)').run(business, label, type, JSON.stringify(type === 'choice' ? options : []), sort).lastInsertRowid);
}

// Removing a field leaves the saved answers alone (they just stop showing).
function remove(id) { db.prepare('DELETE FROM crm_fields WHERE id=?').run(Number(id)); return { ok: true }; }

function move(id, dir) {
  const list = all(), i = list.findIndex((f) => f.id === Number(id)), j = i + (dir === 'up' ? -1 : 1);
  if (i < 0 || j < 0 || j >= list.length) return { ok: true };
  [list[i], list[j]] = [list[j], list[i]];
  const upd = db.prepare('UPDATE crm_fields SET sort=? WHERE id=?');
  db.transaction(() => list.forEach((f, n) => upd.run(n + 1, f.id)))();
  return { ok: true };
}

const readCustom = (v) => { if (v && typeof v === 'object') return { ...v }; try { return JSON.parse(v || '{}') || {}; } catch { return {}; } };

// Cleans the answers typed on a card and merges them into what was saved before.
function cleanValues(input, existing) {
  const out = readCustom(existing);
  if (!input || typeof input !== 'object') return Object.keys(out).length ? JSON.stringify(out) : null;
  const defs = new Map(all().map((f) => [f.key, f]));
  for (const [k, raw] of Object.entries(input)) {
    const f = defs.get(k);
    if (!f) continue;
    let v = raw == null ? '' : String(raw).trim();
    if (f.type === 'yesno') v = raw === true || v === '1' || v === 'true' || v === 'on' || v === 'yes' ? 'Yes' : v === '' ? '' : 'No';
    if (v === '') { delete out[k]; continue; }
    if (f.type === 'number' || f.type === 'money') {
      const n = Number(v.replace(/[$,\s]/g, ''));
      if (!Number.isFinite(n)) throw err400(`"${f.label}" must be a number.`);
      v = n;
    } else if (f.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw err400(`"${f.label}" must be a date.`);
    } else if (f.type === 'choice') {
      if (!f.options.includes(v)) throw err400(`Pick one of the choices for "${f.label}".`);
    } else if (f.type === 'link') {
      if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
    }
    out[k] = typeof v === 'string' ? v.slice(0, f.type === 'long' ? 5000 : 300) : v;
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

// {Car model} in a message template fills in that person's answer.
function fill(text, contact) {
  const vals = readCustom(contact && contact.custom);
  const byLabel = new Map(all().map((f) => [f.label.toLowerCase(), vals[f.key]]));
  return String(text || '').replace(/\{([^{}]{1,50})\}/g, (m, k) => (byLabel.has(k.trim().toLowerCase()) ? String(byLabel.get(k.trim().toLowerCase()) ?? '') : m));
}

const router = express.Router();
const wrap = (fn) => (req, res) => { try { res.json(fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req) => forBiz(req.query.biz)));
router.post('/', wrap((req) => save({ business_id: req.query.biz, ...(req.body || {}) })));
router.put('/:id', wrap((req) => save(req.body || {}, Number(req.params.id))));
router.post('/:id/move', wrap((req) => move(req.params.id, (req.body || {}).dir)));
router.delete('/:id', wrap((req) => remove(req.params.id)));

module.exports = { TYPES, all, get, forBiz, save, remove, cleanValues, readCustom, fill, router };
