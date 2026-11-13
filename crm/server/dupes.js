// Find duplicates: the same person entered twice (same email, same phone number, or the same name).
// Merging keeps one card and moves everything from the others onto it: notes, emails, chats, tasks,
// deals, appointments, invoices, tickets, gift cards and points. Empty boxes on the kept card are
// filled in from the others. "Not the same person" hides a pair for good.
const express = require('express');
const db = require('../../src/db');

db.exec('CREATE TABLE IF NOT EXISTS crm_not_dupes (a INTEGER NOT NULL, b INTEGER NOT NULL, PRIMARY KEY (a, b))');
const crm = () => require('./crm');
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const normName = (n) => String(n || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const pairKey = (x, y) => [Math.min(x, y), Math.max(x, y)];

function find({ biz } = {}) {
  const f = require('./businesses').filter(biz, 'group_name');
  const rows = db.prepare(`SELECT id, name, company, email, phone, group_name, stage, created_at FROM contacts${f.sql ? ` WHERE ${f.sql}` : ''} ORDER BY id`).all(...f.args);
  const ignored = new Set(db.prepare('SELECT a, b FROM crm_not_dupes').all().map((r) => `${r.a}:${r.b}`));
  // Union-find over people who share an email, a phone or a name.
  const parent = new Map(rows.map((r) => [r.id, r.id]));
  const root = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const why = new Map();
  const link = (a, b, reason) => {
    const [x, y] = pairKey(a, b);
    if (ignored.has(`${x}:${y}`)) return;
    const ra = root(a), rb = root(b);
    if (ra !== rb) parent.set(rb, ra);
    why.set(`${x}:${y}`, reason);
  };
  for (const [key, reason] of [[(r) => String(r.email || '').toLowerCase().trim(), 'Same email'], [(r) => (digits(r.phone).length === 10 ? digits(r.phone) : ''), 'Same phone'], [(r) => (normName(r.name).includes(' ') ? normName(r.name) : ''), 'Same name']]) {
    const seen = new Map();
    for (const r of rows) {
      const k = key(r);
      if (!k) continue;
      if (seen.has(k)) link(seen.get(k), r.id, reason); else seen.set(k, r.id);
    }
  }
  const groups = new Map();
  for (const r of rows) { const g = root(r.id); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
  const count = db.prepare('SELECT COUNT(*) AS n FROM contact_activities WHERE contact_id=?');
  return [...groups.values()].filter((g) => g.length > 1).map((people) => {
    const reasons = new Set();
    for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) { const [x, y] = pairKey(people[i].id, people[j].id); if (why.has(`${x}:${y}`)) reasons.add(why.get(`${x}:${y}`)); }
    return { reasons: [...reasons], people: people.map((p) => ({ ...p, notes: count.get(p.id).n })) };
  }).sort((a, b) => b.people.length - a.people.length);
}

// Every place in the database that points at a person.
function references() {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'contacts'").all().map((r) => r.name);
  const out = [];
  for (const t of tables) {
    const fks = db.prepare(`SELECT "from" AS col FROM pragma_foreign_key_list('${t}') WHERE "table"='contacts'`).all().map((r) => r.col);
    const cols = db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all().map((r) => r.name);
    for (const c of new Set([...fks, ...(cols.includes('contact_id') ? ['contact_id'] : [])])) out.push([t, c]);
  }
  return out;
}

function merge(keepId, otherIds) {
  const keep = db.prepare('SELECT * FROM contacts WHERE id=?').get(Number(keepId));
  if (!keep) throw err('Pick the card to keep.', 404);
  const others = [...new Set((otherIds || []).map(Number))].filter((id) => id !== keep.id).map((id) => db.prepare('SELECT * FROM contacts WHERE id=?').get(id)).filter(Boolean);
  if (!others.length) throw err('Pick at least one other card to merge in.');
  const ids = others.map((o) => o.id);
  const cols = db.prepare("SELECT name FROM pragma_table_info('contacts')").all().map((r) => r.name).filter((c) => !['id', 'created_at', 'updated_at'].includes(c));
  db.transaction(() => {
    // Move everything that points at the other cards (rows that would clash stay and go with the card).
    const inIds = `IN (${ids.map(() => '?').join(',')})`;
    for (const [t, c] of references()) {
      db.prepare(`UPDATE OR IGNORE "${t}" SET "${c}"=? WHERE "${c}" ${inIds}`).run(keep.id, ...ids);
      db.prepare(`DELETE FROM "${t}" WHERE "${c}" ${inIds}`).run(...ids); // only rows the kept card already has
    }
    db.prepare(`DELETE FROM contacts WHERE id ${inIds}`).run(...ids);
    // Fill empty boxes on the kept card.
    const patch = {};
    for (const c of cols) {
      if (keep[c] != null && keep[c] !== '') continue;
      const v = others.map((o) => o[c]).find((x) => x != null && x !== '');
      if (v !== undefined) patch[c] = v;
    }
    const tagsOf = (x) => String(x || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (cols.includes('tags')) { const all = [...new Set([keep, ...others].flatMap((x) => tagsOf(x.tags)))]; if (all.length) patch.tags = all.join(', '); }
    if (cols.includes('notes')) { const n = [keep, ...others].map((x) => String(x.notes || '').trim()).filter(Boolean); if (n.length > 1) patch.notes = [...new Set(n)].join('\n\n'); }
    // Safest choice for email: "Do not contact" wins if any card had it.
    if (cols.includes('do_not_contact') && others.some((o) => o.do_not_contact)) patch.do_not_contact = 1;
    if (cols.includes('email_ok') && !keep.email_ok && !patch.do_not_contact && !keep.do_not_contact) {
      const ok = others.find((o) => o.email_ok && (!patch.email || o.email === patch.email || o.email === keep.email));
      if (ok) Object.assign(patch, { email_ok: 1, email_ok_source: ok.email_ok_source, ...(cols.includes('email_ok_at') ? { email_ok_at: ok.email_ok_at } : {}) });
    }
    if (cols.includes('custom')) {
      const parse = (x) => { try { return JSON.parse(x || '{}') || {}; } catch { return {}; } };
      const merged = Object.assign({}, ...others.map((o) => parse(o.custom)).reverse(), parse(keep.custom));
      if (Object.keys(merged).length) patch.custom = JSON.stringify(merged);
    }
    if (Object.keys(patch).length) db.prepare(`UPDATE contacts SET ${Object.keys(patch).map((k) => `"${k}"=@${k}`).join(', ')} WHERE id=@id`).run({ ...patch, id: keep.id });
    db.prepare(`DELETE FROM crm_not_dupes WHERE a IN (${ids.map(() => '?').join(',')}) OR b IN (${ids.map(() => '?').join(',')})`).run(...ids, ...ids);
  })();
  crm().logActivity(keep.id, { kind: 'Note', note: `Merged in ${others.map((o) => `${o.name}${o.email ? ` (${o.email})` : ''}`).join(', ')}.` });
  return crm().getContact(keep.id);
}

function notSame(ids) {
  ids = [...new Set((ids || []).map(Number))].filter(Boolean);
  if (ids.length < 2) throw err('Pick two or more people.');
  const add = db.prepare('INSERT OR IGNORE INTO crm_not_dupes (a, b) VALUES (?,?)');
  db.transaction(() => { for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) add.run(...pairKey(ids[i], ids[j])); })();
  return { ok: true };
}

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req) => ({ groups: find(req.query) })));
router.post('/merge', wrap((req) => merge((req.body || {}).keep, (req.body || {}).merge)));
router.post('/not-same', wrap((req) => notSame((req.body || {}).ids)));

module.exports = { find, merge, notSame, references, router };
