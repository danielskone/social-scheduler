// Businesses (like GoHighLevel's "sub-accounts"): one CRM can hold several businesses,
// for example Viral Attraction and the Fuquay-Varina Christmas Parade.
//
// A business owns a list of contact groups. A person belongs to the business that owns their
// group, so everything that already sets a group (forms, booking pages, website sign-ups,
// Google Calendar bookings, imports) lands in the right business by itself. Groups that no
// business lists belong to the first business. "All businesses" (biz empty) shows everything.
const express = require('express');
const db = require('../../src/db');
const config = require('../../src/config');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_businesses (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#4f46e5',
  phone TEXT, email TEXT, website TEXT, address TEXT,
  groups TEXT NOT NULL DEFAULT '[]',     -- JSON list of contact groups this business owns
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const COLORS = ['#4f46e5', '#dc2626', '#0d9488', '#d97706', '#db2777', '#2563eb', '#16a34a', '#9333ea'];

if (!db.prepare('SELECT 1 FROM crm_businesses LIMIT 1').get()) {
  const add = db.prepare('INSERT INTO crm_businesses (name, color, website, groups, sort) VALUES (?,?,?,?,?)');
  db.transaction(() => {
    if (config.ownerStarters) {
      add.run('Viral Attraction', '#4f46e5', 'https://viralattraction.com', JSON.stringify(['Viral Attraction lead', 'Other']), 1);
      add.run('Fuquay-Varina Christmas Parade', '#dc2626', 'https://fuquayvarinachristmasparade.org', JSON.stringify(['Parade sponsor', 'Donor', 'Parade entry', 'Volunteer', 'Vendor']), 2);
      add.run('Daniel King Automotive', '#0d9488', null, JSON.stringify(['Auto customer']), 3);
    } else {
      add.run('My business', '#4f46e5', null, JSON.stringify([]), 1);
    }
  })();
}

const parse = (b) => (b ? { ...b, groups: (() => { try { return JSON.parse(b.groups) || []; } catch { return []; } })() } : null);
const all = () => db.prepare('SELECT * FROM crm_businesses ORDER BY sort, id').all().map(parse);
const get = (id) => parse(db.prepare('SELECT * FROM crm_businesses WHERE id=?').get(Number(id)));
const usedGroups = () => db.prepare(`SELECT group_name AS g FROM contacts UNION SELECT group_name FROM crm_forms UNION SELECT group_name FROM crm_booking_pages`)
  .all().map((r) => r.g).filter(Boolean);

// The business a group belongs to (the first business when nobody lists it).
function ownerOf(group) {
  const list = all();
  return list.find((b) => b.groups.includes(group)) || list[0] || null;
}

// Every group shown for a business: the ones it lists, plus (for the first business) any group nobody lists.
function groupsOf(id, extra = []) {
  const list = all();
  const b = list.find((x) => x.id === Number(id));
  if (!b) return null;
  const claimed = new Set(list.flatMap((x) => x.groups));
  const loose = b === list[0] ? [...new Set([...extra, ...usedGroups()])].filter((g) => !claimed.has(g)) : [];
  return [...new Set([...b.groups, ...loose])];
}

// Turns ?biz= into a SQL filter on a group column. Empty biz (All businesses) filters nothing.
function filter(biz, col = 'group_name') {
  if (biz == null || biz === '' || biz === 'all') return { sql: '', args: [] };
  const groups = groupsOf(biz);
  if (!groups) return { sql: '', args: [] };
  if (!groups.length) return { sql: '0', args: [] };
  return { sql: `${col} IN (${groups.map(() => '?').join(',')})`, args: groups };
}
const inBiz = (biz, group) => { const f = filter(biz); return !f.sql || f.args.includes(group); };

// A brand-new group typed while a business is picked becomes that business's group.
function claim(biz, group) {
  group = String(group || '').trim();
  if (!group || biz == null || biz === '' || biz === 'all') return;
  const b = get(biz);
  if (!b || b.groups.includes(group)) return;
  if (all().some((x) => x.groups.includes(group))) return; // another business already has it
  db.prepare('UPDATE crm_businesses SET groups=? WHERE id=?').run(JSON.stringify([...b.groups, group]), b.id);
}

const err400 = (m) => Object.assign(new Error(m), { status: 400 });
function save(body, id) {
  const s = (k, n = 200) => (body[k] == null ? null : String(body[k]).trim().slice(0, n) || null);
  const old = id ? get(id) : null;
  if (id && !old) throw Object.assign(new Error('Business not found'), { status: 404 });
  const name = s('name', 80) || (old && old.name);
  if (!name) throw err400('Give the business a name.');
  const color = /^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color : (old ? old.color : COLORS[all().length % COLORS.length]);
  let website = s('website');
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  const email = s('email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err400('That email address does not look right.');
  let groups = old ? old.groups : [];
  if (Array.isArray(body.groups)) {
    groups = [...new Set(body.groups.map((g) => String(g).trim().slice(0, 60)).filter(Boolean))];
    // A group can only belong to one business: take it away from the others.
    for (const other of all()) {
      if (other.id === Number(id)) continue;
      const left = other.groups.filter((g) => !groups.includes(g));
      if (left.length !== other.groups.length) db.prepare('UPDATE crm_businesses SET groups=? WHERE id=?').run(JSON.stringify(left), other.id);
    }
  }
  const row = { name, color, phone: s('phone', 40), email, website, address: s('address', 300), groups: JSON.stringify(groups) };
  if (old) {
    db.prepare('UPDATE crm_businesses SET name=@name, color=@color, phone=@phone, email=@email, website=@website, address=@address, groups=@groups WHERE id=@id').run({ ...row, id: old.id });
    return get(old.id);
  }
  const sort = (db.prepare('SELECT MAX(sort) AS m FROM crm_businesses').get().m || 0) + 1;
  const r = db.prepare('INSERT INTO crm_businesses (name, color, phone, email, website, address, groups, sort) VALUES (@name,@color,@phone,@email,@website,@address,@groups,@sort)').run({ ...row, sort });
  return get(r.lastInsertRowid);
}

// Removing a business never removes people: its groups move to the first business.
function remove(id) {
  const list = all();
  if (list.length < 2) throw err400('You need at least one business.');
  const b = list.find((x) => x.id === Number(id));
  if (!b) throw Object.assign(new Error('Business not found'), { status: 404 });
  const keep = list.find((x) => x.id !== b.id);
  db.transaction(() => {
    db.prepare('UPDATE crm_businesses SET groups=? WHERE id=?').run(JSON.stringify([...new Set([...keep.groups, ...b.groups])]), keep.id);
    db.prepare('DELETE FROM crm_businesses WHERE id=?').run(b.id);
    // Its own pipelines move to the business that takes over its people.
    try { db.prepare('UPDATE crm_pipelines SET business_id=? WHERE business_id=?').run(keep.id, b.id); } catch { /* no pipelines table yet */ }
  })();
  return { ok: true, movedTo: keep.name };
}

function listWithCounts() {
  return all().map((b) => {
    const f = filter(b.id);
    const n = f.sql ? db.prepare(`SELECT COUNT(*) AS n FROM contacts WHERE ${f.sql}`).get(...f.args).n : 0;
    return { ...b, allGroups: groupsOf(b.id), contacts: n };
  });
}

const router = express.Router();
const wrap = (fn) => (req, res) => { try { res.json(fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap(() => listWithCounts()));
router.post('/', wrap((req) => save(req.body || {})));
router.put('/:id', wrap((req) => save(req.body || {}, Number(req.params.id))));
router.delete('/:id', wrap((req) => remove(Number(req.params.id))));

module.exports = { all, get, ownerOf, groupsOf, filter, inBiz, claim, save, remove, listWithCounts, router };
