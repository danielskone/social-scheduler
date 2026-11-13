// Pipelines: the steps a deal goes through, like "New lead > Contacted > Proposal sent > Won".
// Each business can have its own pipelines with steps it names itself (GoHighLevel calls these
// pipelines and stages). A pipeline with no business is shared by all businesses.
// Each step is "open", "won" (money counts as won) or "lost" (not happening).
// A person with no pipeline is in the first pipeline their business can see.
const express = require('express');
const db = require('../../src/db');
const config = require('../../src/config');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_pipelines (
  id INTEGER PRIMARY KEY,
  business_id INTEGER,                      -- empty = shared by every business
  name TEXT NOT NULL,
  stages TEXT NOT NULL,                     -- JSON [{ name, kind: 'open'|'won'|'lost' }]
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
if (!db.prepare("SELECT 1 FROM pragma_table_info('contacts') WHERE name='pipeline_id'").get()) {
  db.exec('ALTER TABLE contacts ADD COLUMN pipeline_id INTEGER');
}

// Daniel's copy keeps the steps it always had; a customer's copy starts with everyday sales steps.
const OWNER_STEPS = [['New', 'open'], ['Contacted', 'open'], ['Interested', 'open'], ['Committed', 'open'], ['Paid / Done', 'won'], ['Not this year', 'lost']];
const CUSTOMER_STEPS = [['New', 'open'], ['Contacted', 'open'], ['Interested', 'open'], ['Proposal sent', 'open'], ['Won', 'won'], ['Lost', 'lost']];
const KINDS = ['open', 'won', 'lost'];
if (!db.prepare('SELECT 1 FROM crm_pipelines LIMIT 1').get()) {
  const steps = (config.ownerStarters ? OWNER_STEPS : CUSTOMER_STEPS).map(([name, kind]) => ({ name, kind }));
  db.prepare('INSERT INTO crm_pipelines (business_id, name, stages, sort) VALUES (NULL, ?, ?, 1)').run('Sales pipeline', JSON.stringify(steps));
}

const parse = (p) => (p ? { ...p, stages: JSON.parse(p.stages) } : null);
const all = () => db.prepare('SELECT * FROM crm_pipelines ORDER BY sort, id').all().map(parse);
const get = (id) => parse(db.prepare('SELECT * FROM crm_pipelines WHERE id=?').get(Number(id)));
const businesses = () => require('./businesses');

// Pipelines a business can see: its own plus the shared ones. All businesses: every pipeline.
function forBiz(biz) {
  const list = all();
  if (biz == null || biz === '' || biz === 'all') return list;
  return list.filter((p) => p.business_id == null || p.business_id === Number(biz));
}
// The pipeline a person is in.
function ofContact(c) {
  if (c && c.pipeline_id) { const p = get(c.pipeline_id); if (p) return p; }
  const owner = c && c.group_name ? businesses().ownerOf(c.group_name) : null;
  return forBiz(owner ? owner.id : '')[0] || all()[0];
}
const stageNames = (p) => p.stages.map((s) => s.name);
const kindOf = (p, stage) => (p.stages.find((s) => s.name === stage) || {}).kind || 'open';
// Every step name used anywhere (for filters, automations and email segments).
const allStageNames = () => [...new Set(all().flatMap(stageNames))];

const err400 = (m) => Object.assign(new Error(m), { status: 400 });
function cleanStages(list) {
  if (!Array.isArray(list)) throw err400('Add the steps of the pipeline.');
  const out = [];
  for (const s of list) {
    const name = String((s && s.name) || '').trim().slice(0, 40);
    if (!name) continue;
    if (out.some((x) => x.name.toLowerCase() === name.toLowerCase())) throw err400(`"${name}" is in the list twice.`);
    out.push({ name, kind: KINDS.includes(s.kind) ? s.kind : 'open', from: s.from ? String(s.from) : null });
  }
  if (out.length < 2) throw err400('A pipeline needs at least 2 steps.');
  if (out.length > 15) throw err400('Keep it to 15 steps or fewer.');
  if (!out.some((s) => s.kind === 'open')) throw err400('Leave at least one step that is still open.');
  return out;
}

// stages: [{ name, kind, from }] where "from" is the old name when a step is renamed,
// so the people in it move along with it. People in a removed step go to the first step.
function save(body, id) {
  const old = id ? get(id) : null;
  if (id && !old) throw Object.assign(new Error('Pipeline not found'), { status: 404 });
  const name = String(body.name || (old && old.name) || '').trim().slice(0, 60);
  if (!name) throw err400('Give the pipeline a name.');
  const stages = body.stages ? cleanStages(body.stages) : old.stages.map((s) => ({ ...s, from: s.name }));
  let business = old ? old.business_id : null;
  if ('business_id' in body) business = body.business_id === '' || body.business_id == null || body.business_id === 'all' ? null : Number(body.business_id);
  const keep = stages.map(({ name: n, kind }) => ({ name: n, kind }));
  return db.transaction(() => {
    if (old) {
      db.prepare('UPDATE crm_pipelines SET name=?, stages=?, business_id=? WHERE id=?').run(name, JSON.stringify(keep), business, old.id);
      // Move people along with renamed steps; anyone left in a removed step goes to the first step.
      const members = contactsIn(old);
      const renamed = new Map(stages.filter((s) => s.from).map((s) => [s.from, s.name]));
      const upd = db.prepare("UPDATE contacts SET stage=?, updated_at=datetime('now') WHERE id=?");
      for (const c of members) {
        const to = renamed.get(c.stage) || (keep.some((s) => s.name === c.stage) ? c.stage : keep[0].name);
        if (to !== c.stage) upd.run(to, c.id);
      }
      return get(old.id);
    }
    const sort = (db.prepare('SELECT MAX(sort) AS m FROM crm_pipelines').get().m || 0) + 1;
    return get(db.prepare('INSERT INTO crm_pipelines (business_id, name, stages, sort) VALUES (?,?,?,?)').run(business, name, JSON.stringify(keep), sort).lastInsertRowid);
  })();
}

function contactsIn(p) {
  return db.prepare('SELECT id, stage, group_name, pipeline_id FROM contacts').all().filter((c) => ofContact(c).id === p.id);
}

// Removing a pipeline never removes people: they go to the first step of another pipeline.
function remove(id) {
  const p = get(id);
  if (!p) throw Object.assign(new Error('Pipeline not found'), { status: 404 });
  if (all().length < 2) throw err400('You need at least one pipeline.');
  const members = contactsIn(p);
  db.transaction(() => {
    db.prepare('DELETE FROM crm_pipelines WHERE id=?').run(p.id);
    const upd = db.prepare("UPDATE contacts SET pipeline_id=NULL, stage=?, updated_at=datetime('now') WHERE id=?");
    for (const c of members) upd.run(stageNames(ofContact({ ...c, pipeline_id: null }))[0], c.id);
  })();
  return { ok: true, moved: members.length };
}

const router = express.Router();
const wrap = (fn) => (req, res) => { try { res.json(fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req) => forBiz(req.query.biz).map((p) => ({ ...p, people: contactsIn(p).length }))));
router.post('/', wrap((req) => save({ business_id: req.query.biz, ...(req.body || {}) })));
router.put('/:id', wrap((req) => save(req.body || {}, Number(req.params.id))));
router.delete('/:id', wrap((req) => remove(Number(req.params.id))));

module.exports = { all, get, forBiz, ofContact, stageNames, kindOf, allStageNames, save, remove, contactsIn, router };
