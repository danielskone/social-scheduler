// Smart lists and bulk actions for People. A smart list is a saved search (words, group, stage,
// tag, and a quick pick like "Said yes to email" or "Quiet 60+ days"). It always shows who
// matches right now, so new people drop in by themselves. Bulk actions change many people at
// once: add or remove a tag, move to a group or stage, set a follow-up, add a note or a task,
// mark do not contact, export, or delete (owner and admins only).
const express = require('express');
const db = require('../../src/db');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_smart_lists (
  id INTEGER PRIMARY KEY,
  business_id INTEGER,
  name TEXT NOT NULL,
  filters_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
const crm = () => require('./crm');
const businesses = () => require('./businesses');
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const KEYS = ['q', 'group', 'stage', 'due', 'tag', 'show'];
const MAX = 5000;

function cleanFilters(f = {}) {
  const out = {};
  for (const k of KEYS) {
    const v = f[k];
    if (v === undefined || v === null || v === '' || v === false || v === '0') continue;
    if (k === 'due') out.due = '1';
    else if (k === 'show') { if (crm().SHOWS[v]) out.show = v; }
    else out[k] = String(v).trim().slice(0, 100);
  }
  return out;
}
const parse = (r) => r && { id: r.id, business_id: r.business_id, name: r.name, filters: JSON.parse(r.filters_json || '{}') };
function list(biz) {
  return db.prepare('SELECT * FROM crm_smart_lists ORDER BY name COLLATE NOCASE').all()
    .filter((r) => !biz || biz === 'all' || !r.business_id || r.business_id === Number(biz))
    .map(parse).map((l) => ({ ...l, count: crm().listContacts({ ...l.filters, biz }).length }));
}
function save(body = {}, id, biz) {
  const old = id ? db.prepare('SELECT * FROM crm_smart_lists WHERE id=?').get(Number(id)) : null;
  if (id && !old) throw err('List not found', 404);
  const name = String(body.name ?? old?.name ?? '').trim().slice(0, 60);
  if (!name) throw err('Give the list a name.');
  const filters = 'filters' in body ? cleanFilters(body.filters) : JSON.parse(old.filters_json);
  if (!Object.keys(filters).length) throw err('Pick at least one thing to filter by first (a search, group, stage, tag or "Show").');
  if (old) db.prepare('UPDATE crm_smart_lists SET name=?, filters_json=? WHERE id=?').run(name, JSON.stringify(filters), old.id);
  else id = db.prepare('INSERT INTO crm_smart_lists (business_id, name, filters_json) VALUES (?,?,?)')
    .run(businesses().get(biz) ? Number(biz) : null, name, JSON.stringify(filters)).lastInsertRowid;
  return parse(db.prepare('SELECT * FROM crm_smart_lists WHERE id=?').get(Number(id)));
}
// Every tag in use, most used first (only people in the business picked, if one is picked).
function tags(biz) {
  const seen = new Map();
  for (const c of crm().listContacts({ biz })) for (const t of c.tag_list) {
    const k = t.toLowerCase(), cur = seen.get(k);
    if (cur) cur.count++; else seen.set(k, { name: t, count: 1 });
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// ---------- Bulk actions ----------
function pickIds(body, biz) {
  let ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
  // "Everyone who matches" sends the filters instead of a long list of ids.
  if (!ids.length && body.filters) ids = crm().listContacts({ ...cleanFilters(body.filters), biz }).map((c) => c.id);
  if (!ids.length) throw err('Pick at least one person.');
  if (ids.length > MAX) throw err(`That is too many at once. Pick ${MAX} or fewer.`);
  // A helper limited to some businesses can only change people in them.
  if (biz && biz !== 'all') {
    const mine = new Set(crm().listContacts({ biz }).map((c) => c.id));
    ids = ids.filter((i) => mine.has(i));
  }
  return ids;
}
const ACTIONS = {
  tag_add: (c, v) => ({ tags: [...c.tag_list, v] }),
  tag_remove: (c, v) => ({ tags: c.tag_list.filter((t) => t.toLowerCase() !== v.toLowerCase()) }),
  group: (c, v) => ({ group_name: v }),
  stage: (c, v) => ({ stage: v }),
  follow_up: (c, v) => ({ next_follow_up: v || null }),
  dnc: () => ({ do_not_contact: true, email_ok: false }),
};
async function bulk(action, body = {}, biz) {
  const ids = pickIds(body, biz);
  const value = String(body.value ?? '').trim().slice(0, 500);
  if (action === 'delete') {
    if (body.confirm !== 'DELETE') throw err('Type DELETE to confirm.');
    const del = db.prepare('DELETE FROM contacts WHERE id=?');
    db.transaction(() => ids.forEach((i) => del.run(i)))();
    return { done: ids.length };
  }
  if (action === 'export') return { csv: crm().exportCsv({ ids }) };
  if (['tag_add', 'tag_remove'].includes(action) && !value) throw err('Type a tag.');
  if (action === 'group' && !value) throw err('Pick a group.');
  if (action === 'stage' && !crm().STAGES.includes(value)) throw err('Pick a stage.');
  if (action === 'follow_up' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw err('Pick a date.');
  if (action === 'group') businesses().claim(biz, value);
  let done = 0, skipped = 0;
  if (action === 'note' || action === 'task') {
    if (!value) throw err(action === 'note' ? 'Write the note.' : 'Write the task.');
    const due = /^\d{4}-\d{2}-\d{2}$/.test(body.due || '') ? body.due : null;
    db.transaction(() => {
      for (const id of ids) {
        if (action === 'note') crm().logActivity(id, { kind: 'Note', note: value });
        else crm().saveTask({ contact_id: id, title: value, due_on: due });
        done++;
      }
    })();
    return { done, skipped };
  }
  const fn = ACTIONS[action];
  if (!fn) throw err('Unknown action');
  for (const id of ids) {
    const c = crm().getContact(id);
    if (!c) { skipped++; continue; }
    const patch = fn(c, value);
    // A step from another pipeline would not fit: skip those people instead of moving them.
    if (action === 'stage' && !require('./pipelines').stageNames(require('./pipelines').ofContact(c)).includes(value)) { skipped++; continue; }
    try { crm().updateContact(id, patch); done++; } catch { skipped++; }
  }
  if (action === 'dnc') ids.forEach((id) => { try { crm().logActivity(id, { kind: 'Note', note: 'Marked "Do not contact".' }); } catch {} });
  return { done, skipped };
}

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req) => ({ lists: list(req.query.biz), tags: tags(req.query.biz), shows: Object.keys(crm().SHOWS) })));
router.post('/', wrap((req) => save(req.body || {}, null, req.query.biz)));
router.put('/:id', wrap((req) => save(req.body || {}, Number(req.params.id))));
router.delete('/:id', wrap((req) => { db.prepare('DELETE FROM crm_smart_lists WHERE id=?').run(Number(req.params.id)); return { ok: true }; }));
router.post('/bulk/:action', wrap((req) => bulk(req.params.action, req.body || {}, req.query.biz)));

module.exports = { list, save, tags, bulk, cleanFilters, router };
