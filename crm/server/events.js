// Events and tickets. Make an event (a parade, a class, a car show), add ticket types (free or
// paid, with how many there are), and share its page at /e/<name>. People pick their tickets and
// pay by card with your own Stripe (free tickets need no card). Each ticket is emailed with its
// own QR code. At the door, scan the QR with any phone camera: the ticket opens, type the event's
// door code once, and press Check in. You see who came in the Events tab.
const express = require('express');
const crypto = require('crypto');
const db = require('../../src/db');
const config = require('../../src/config');
const notify = require('../../src/notify');

db.exec(`
CREATE TABLE IF NOT EXISTS crm_events (
  id INTEGER PRIMARY KEY,
  business_id INTEGER,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  starts_at TEXT NOT NULL,         -- local date and time, YYYY-MM-DDTHH:MM
  ends_at TEXT,
  location TEXT,
  cover TEXT,                      -- media/... from the Sites photo upload, or https://
  door_code TEXT NOT NULL,         -- staff type it once on a phone to check people in
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crm_ticket_types (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES crm_events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  capacity INTEGER,                -- empty = no limit
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS crm_tickets (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES crm_events(id) ON DELETE CASCADE,
  type_id INTEGER,
  type_name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  invoice_id INTEGER,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending, valid, canceled
  checked_in_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS crm_tickets_event ON crm_tickets(event_id);
CREATE INDEX IF NOT EXISTS crm_tickets_invoice ON crm_tickets(invoice_id);
`);
const crm = () => require('./crm');
const businesses = () => require('./businesses');
const invoices = () => require('./invoices');
const err = (m, status = 400) => Object.assign(new Error(m), { status });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = (s) => esc(s).replace(/\n/g, '<br>');
const money = (n) => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const round = (n) => Math.round(Number(n) * 100) / 100;
const MAX_PER_ORDER = 10;
const slugify = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 50) || 'event';
function uniqueSlug(want, id = 0) {
  let s = slugify(want), n = 1;
  while (s === 'ticket' || s === 'checkin' || db.prepare('SELECT 1 FROM crm_events WHERE slug=? AND id != ?').get(s, id)) s = `${slugify(want)}-${++n}`;
  return s;
}
const linkFor = (e) => `${config.publicBaseUrl}/e/${e.slug}`;
const ticketLink = (code) => `${config.publicBaseUrl}/e/ticket/${code}`;
const getEvent = (id) => db.prepare('SELECT * FROM crm_events WHERE id=?').get(Number(id));
const typesOf = (eventId) => db.prepare('SELECT * FROM crm_ticket_types WHERE event_id=? ORDER BY sort, id').all(eventId);
// Seats taken: good tickets, plus ones someone is paying for right now (the last 2 hours).
const taken = (typeId) => db.prepare("SELECT COUNT(*) AS n FROM crm_tickets WHERE type_id=? AND (status='valid' OR (status='pending' AND created_at > datetime('now','-2 hours')))").get(typeId).n;
const isoLocal = (s) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(s || '')) ? String(s) : null);
const when = (e) => {
  const d = new Date(`${e.starts_at}:00`);
  const day = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const t = (x) => x.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const end = e.ends_at ? new Date(`${e.ends_at}:00`) : null;
  return `${day} at ${t(d)}${end ? (end.toDateString() === d.toDateString() ? ` to ${t(end)}` : ` to ${end.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} ${t(end)}`) : ''}`;
};
function shape(e, { full = false } = {}) {
  if (!e) return null;
  const types = typesOf(e.id).map((t) => ({ ...t, sold: db.prepare("SELECT COUNT(*) AS n FROM crm_tickets WHERE type_id=? AND status='valid'").get(t.id).n, left: t.capacity ? Math.max(0, t.capacity - taken(t.id)) : null }));
  const counts = db.prepare("SELECT COUNT(*) AS sold, SUM(checked_in_at IS NOT NULL) AS inside, COALESCE(SUM(price),0) AS money FROM crm_tickets WHERE event_id=? AND status='valid'").get(e.id);
  const out = { ...e, active: Boolean(e.active), link: linkFor(e), when: when(e), types, sold: counts.sold || 0, checkedIn: counts.inside || 0, revenue: round(counts.money || 0),
    past: (e.ends_at || e.starts_at) < new Date(Date.now() - 864e5).toISOString().slice(0, 16) };
  if (full) {
    out.tickets = db.prepare(`SELECT t.*, c.name AS contact_name, c.email FROM crm_tickets t LEFT JOIN contacts c ON c.id=t.contact_id
      WHERE t.event_id=? AND t.status<>'pending' ORDER BY c.name COLLATE NOCASE, t.id`).all(e.id);
  }
  return out;
}

// ---------- Making events ----------
function cleanTypes(list) {
  if (!Array.isArray(list) || !list.length) throw err('Add at least one ticket type, like "General" (free) or "VIP" ($25).');
  if (list.length > 12) throw err('That is too many ticket types. Use 12 or fewer.');
  return list.map((t, i) => {
    const name = String(t.name || '').trim().slice(0, 60);
    if (!name) throw err('Give every ticket type a name.');
    const price = round(Number(String(t.price ?? 0).replace(/[$,\s]/g, '')) || 0);
    if (price < 0 || price > 99999) throw err(`Check the price of "${name}".`);
    if (price > 0 && price < 0.5) throw err('Card payments must be at least $0.50.');
    const cap = t.capacity === '' || t.capacity == null ? null : Math.round(Number(t.capacity));
    if (cap != null && !(cap >= 1 && cap <= 100000)) throw err(`How many "${name}" tickets? Use a number, or leave it empty for no limit.`);
    return { id: Number(t.id) || null, name, price, capacity: cap, sort: i };
  });
}
function save(body = {}, id, biz) {
  const old = id ? getEvent(id) : null;
  if (id && !old) throw err('Event not found', 404);
  const title = String(body.title ?? old?.title ?? '').trim().slice(0, 140);
  if (!title) throw err('Give the event a name.');
  const starts = 'starts_at' in body ? isoLocal(body.starts_at) : old?.starts_at;
  if (!starts) throw err('Pick the day and time it starts.');
  const ends = 'ends_at' in body ? (body.ends_at ? isoLocal(body.ends_at) : null) : old?.ends_at ?? null;
  if (ends && ends < starts) throw err('The end must be after the start.');
  const cover = 'cover' in body ? (String(body.cover || '').trim().match(/^(https:\/\/|media\/)\S{1,490}$/) ? String(body.cover).trim() : null) : old?.cover ?? null;
  const row = { title, starts_at: starts, ends_at: ends, cover,
    description: 'description' in body ? String(body.description || '').trim().slice(0, 4000) || null : old?.description ?? null,
    location: 'location' in body ? String(body.location || '').trim().slice(0, 200) || null : old?.location ?? null,
    active: 'active' in body ? (body.active ? 1 : 0) : old ? old.active : 1,
    slug: 'slug' in body && String(body.slug || '').trim() ? uniqueSlug(body.slug, old?.id || 0) : old ? old.slug : uniqueSlug(title),
    door_code: 'door_code' in body && /^\d{4,8}$/.test(String(body.door_code || '').trim()) ? String(body.door_code).trim() : old ? old.door_code : String(crypto.randomInt(1000, 9999)),
    business_id: old ? old.business_id : (businesses().get(biz) ? Number(biz) : businesses().all()[0]?.id || null) };
  if ('door_code' in body && body.door_code && !/^\d{4,8}$/.test(String(body.door_code).trim())) throw err('The door code is 4 to 8 numbers.');
  const types = 'types' in body ? cleanTypes(body.types) : null;
  if (!old && !types) throw err('Add at least one ticket type.');
  const run = db.transaction(() => {
    let eid = old?.id;
    if (old) {
      db.prepare(`UPDATE crm_events SET title=@title, starts_at=@starts_at, ends_at=@ends_at, cover=@cover, description=@description, location=@location,
        active=@active, slug=@slug, door_code=@door_code WHERE id=@id`).run({ ...row, id: old.id });
    } else {
      eid = db.prepare(`INSERT INTO crm_events (title, starts_at, ends_at, cover, description, location, active, slug, door_code, business_id)
        VALUES (@title,@starts_at,@ends_at,@cover,@description,@location,@active,@slug,@door_code,@business_id)`).run(row).lastInsertRowid;
    }
    if (types) {
      const keep = new Set();
      for (const t of types) {
        const mine = t.id && db.prepare('SELECT id FROM crm_ticket_types WHERE id=? AND event_id=?').get(t.id, eid);
        if (mine) { db.prepare('UPDATE crm_ticket_types SET name=?, price=?, capacity=?, sort=? WHERE id=?').run(t.name, t.price, t.capacity, t.sort, mine.id); keep.add(mine.id); }
        else keep.add(db.prepare('INSERT INTO crm_ticket_types (event_id, name, price, capacity, sort) VALUES (?,?,?,?,?)').run(eid, t.name, t.price, t.capacity, t.sort).lastInsertRowid);
      }
      for (const t of typesOf(eid)) {
        if (keep.has(t.id)) continue;
        if (db.prepare("SELECT 1 FROM crm_tickets WHERE type_id=? AND status<>'canceled'").get(t.id)) throw err(`People already have "${t.name}" tickets, so it can't be removed. Set how many to sell to stop new sales.`);
        db.prepare('DELETE FROM crm_ticket_types WHERE id=?').run(t.id);
      }
    }
    return eid;
  });
  return shape(getEvent(run()), { full: true });
}
function list(biz) {
  const rows = db.prepare('SELECT * FROM crm_events ORDER BY starts_at DESC').all()
    .filter((e) => !biz || biz === 'all' || !e.business_id || e.business_id === Number(biz)).map((e) => shape(e));
  const now = new Date().toISOString().slice(0, 16);
  return { events: rows, totals: { upcoming: rows.filter((e) => !e.past && e.starts_at >= now.slice(0, 10)).length, sold: rows.reduce((n, e) => n + e.sold, 0), revenue: round(rows.reduce((n, e) => n + e.revenue, 0)) } };
}
function remove(id) {
  if (db.prepare("SELECT 1 FROM crm_tickets WHERE event_id=? AND status='valid' AND price>0").get(Number(id))) throw err('People paid for tickets to this event. Turn it off instead, so you keep the record.');
  db.prepare('DELETE FROM crm_events WHERE id=?').run(Number(id));
  return { ok: true };
}

// ---------- Getting tickets ----------
function makeTickets(e, contactId, picks, { status, invoiceId = null }) {
  const ins = db.prepare('INSERT INTO crm_tickets (event_id, type_id, type_name, price, contact_id, invoice_id, code, status) VALUES (?,?,?,?,?,?,?,?)');
  const out = [];
  for (const p of picks) for (let i = 0; i < p.qty; i++) {
    const code = crypto.randomBytes(9).toString('base64url');
    ins.run(e.id, p.type.id, p.type.name, p.type.price, contactId, invoiceId, code, status);
    out.push(code);
  }
  return out;
}
async function emailTickets(contactId, eventId, opts = {}) {
  const email = require('./email');
  const c = db.prepare('SELECT * FROM contacts WHERE id=?').get(Number(contactId));
  const e = getEvent(eventId);
  const t = db.prepare("SELECT * FROM crm_tickets WHERE contact_id=? AND event_id=? AND status='valid' ORDER BY id").all(Number(contactId), Number(eventId));
  if (!c || !c.email || !e || !t.length || !email.provider()) return false;
  const b = (e.business_id && businesses().get(e.business_id)) || null;
  await email.sendDirect({ to: c.email, toName: c.name, subject: `Your ticket${t.length > 1 ? 's' : ''}: ${e.title}`,
    text: `Hi ${String(c.name).split(' ')[0]},\n\nYou're in! Here ${t.length > 1 ? `are your ${t.length} tickets` : 'is your ticket'} for ${e.title}.\n\nWhen: ${when(e)}${e.location ? `\nWhere: ${e.location}` : ''}\n\nOpen ${t.length > 1 ? 'each ticket' : 'your ticket'} on your phone at the door. It shows a code to scan:\n${t.map((x, i) => `${t.length > 1 ? `${i + 1}. ${x.type_name}: ` : ''}${ticketLink(x.code)}`).join('\n')}\n\nSee you there!${b ? `\n${b.name}` : ''}` }, opts);
  return true;
}
async function order(slug, body = {}) {
  const e = db.prepare('SELECT * FROM crm_events WHERE slug=? AND active=1').get(String(slug));
  if (!e) throw err('This event is not available.', 404);
  if ((e.ends_at || e.starts_at) < new Date().toISOString().slice(0, 16) && e.starts_at.slice(0, 10) < new Date().toISOString().slice(0, 10)) throw err('This event is over.');
  const picks = typesOf(e.id).map((type) => ({ type, qty: Math.max(0, Math.min(MAX_PER_ORDER, Math.round(Number(body[`qty_${type.id}`]) || 0))) })).filter((p) => p.qty > 0);
  if (!picks.length) throw err('Pick how many tickets you want.');
  const count = picks.reduce((n, p) => n + p.qty, 0);
  if (count > MAX_PER_ORDER) throw err(`You can get up to ${MAX_PER_ORDER} tickets at a time.`);
  for (const p of picks) if (p.type.capacity && taken(p.type.id) + p.qty > p.type.capacity) {
    const left = Math.max(0, p.type.capacity - taken(p.type.id));
    throw err(left ? `Only ${left} "${p.type.name}" ticket${left > 1 ? 's are' : ' is'} left.` : `"${p.type.name}" is sold out.`);
  }
  const total = round(picks.reduce((n, p) => n + p.qty * p.type.price, 0));
  if (total > 0 && !invoices().settings().stripe) throw err('Card payments are not set up yet. Please contact us to get tickets.');
  const what = picks.map((p) => `${p.qty} x ${p.type.name}`).join(', ');
  const products = require('./products');
  const c = products.buyer(body, e.business_id, `${total > 0 ? 'Started buying' : 'Got'} tickets to ${e.title}: ${what}${total ? ` (${money(total)})` : ''}`);
  if (total <= 0) {
    const codes = makeTickets(e, c.id, picks, { status: 'valid' });
    done(e, c, count, 0);
    await emailTickets(c.id, e.id).catch((x) => console.error(`[events] ${x.message}`));
    return { free: true, codes, url: `ticket/${codes[0]}?new=1` };
  }
  // Paid: the tickets wait for the card payment, then turn valid and go out by email.
  const pay = await products.startPayment({ contact: c, items: picks.map((p) => ({ what: `${e.title}: ${p.type.name} ticket`, qty: p.qty, price: p.type.price })), note: `${when(e)}${e.location ? `\n${e.location}` : ''}` });
  makeTickets(e, c.id, picks, { status: 'pending', invoiceId: pay.invoice.id });
  return { url: pay.url, invoice: pay.invoice.id };
}
function done(e, c, count, total) {
  crm().logActivity(c.id, { kind: total ? 'Payment' : 'Note', note: `Has ${count} ticket${count > 1 ? 's' : ''} to ${e.title}` });
  crm().emit('event_registered', { contact: crm().getContact(c.id), form: e.title });
  notify.send(total ? 'Tickets sold' : 'New sign-up', `${c.name} got ${count} ticket${count > 1 ? 's' : ''} to ${e.title}${total ? ` (${money(total)})` : ''}.`, { tags: 'admission_tickets' }).catch(() => {});
}
// Called when any invoice is paid: if it was for tickets, they become good and go out by email.
function onPaid(invoiceId) {
  const t = db.prepare("SELECT * FROM crm_tickets WHERE invoice_id=? AND status='pending'").all(Number(invoiceId));
  if (!t.length) return;
  db.prepare("UPDATE crm_tickets SET status='valid' WHERE invoice_id=? AND status='pending'").run(Number(invoiceId));
  const e = getEvent(t[0].event_id), c = db.prepare('SELECT * FROM contacts WHERE id=?').get(t[0].contact_id);
  if (e && c) {
    done(e, c, t.length, t.reduce((n, x) => n + x.price, 0));
    emailTickets(c.id, e.id).catch((x) => console.error(`[events] ${x.message}`));
  }
}
function invoiceExtra(inv) {
  const t = inv && inv.status === 'paid' && db.prepare("SELECT code FROM crm_tickets WHERE invoice_id=? AND status='valid' ORDER BY id LIMIT 1").get(inv.id);
  return t ? `<a class="pay" style="text-align:center;text-decoration:none" href="../e/ticket/${esc(t.code)}">See your tickets</a>` : '';
}
const forContact = (contactId) => db.prepare(`SELECT t.code, t.type_name, t.checked_in_at, e.title, e.starts_at, e.ends_at, e.location FROM crm_tickets t JOIN crm_events e ON e.id=t.event_id
  WHERE t.contact_id=? AND t.status='valid' AND COALESCE(e.ends_at, e.starts_at) >= ? ORDER BY e.starts_at, t.id`).all(Number(contactId), new Date(Date.now() - 864e5).toISOString().slice(0, 16))
  .map((x) => ({ ...x, link: ticketLink(x.code), when: when(x) }));

// ---------- At the door ----------
function checkIn(code, { undo = false } = {}) {
  const t = db.prepare('SELECT * FROM crm_tickets WHERE code=?').get(String(code));
  if (!t || t.status !== 'valid') throw err('This ticket is not valid.', 404);
  if (undo) { db.prepare('UPDATE crm_tickets SET checked_in_at=NULL WHERE id=?').run(t.id); return { ok: true, already: false }; }
  if (t.checked_in_at) return { ok: true, already: true, at: t.checked_in_at };
  db.prepare('UPDATE crm_tickets SET checked_in_at=? WHERE id=?').run(new Date().toISOString(), t.id);
  return { ok: true, already: false };
}
function cancelTicket(id) {
  const t = db.prepare('SELECT * FROM crm_tickets WHERE id=?').get(Number(id));
  if (!t) throw err('Ticket not found', 404);
  db.prepare("UPDATE crm_tickets SET status='canceled' WHERE id=?").run(t.id);
  if (t.contact_id) crm().logActivity(t.contact_id, { kind: 'Note', note: `A ticket (${t.type_name}) was cancelled${t.price ? '. Refund it in Stripe if needed.' : ''}` });
  return { ok: true };
}
// Add someone by hand (a guest, a volunteer): their ticket is free and emailed if they have an email.
async function addGuest(eventId, { contact_id, type_id, email: send = true } = {}) {
  const e = getEvent(eventId);
  if (!e) throw err('Event not found', 404);
  const c = db.prepare('SELECT * FROM contacts WHERE id=?').get(Number(contact_id));
  if (!c) throw err('Pick a person.');
  const type = typesOf(e.id).find((t) => t.id === Number(type_id)) || typesOf(e.id)[0];
  makeTickets(e, c.id, [{ type: { ...type, price: 0 }, qty: 1 }], { status: 'valid' });
  crm().logActivity(c.id, { kind: 'Note', note: `Added to ${e.title} (${type.name} ticket)` });
  const emailed = send ? await emailTickets(c.id, e.id).catch(() => false) : false;
  return { ...shape(getEvent(e.id), { full: true }), emailed };
}

// ---------- Public pages ----------
function shell(b, title, body, { image } = {}) {
  const color = b?.color || '#4f46e5';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
<style>:root{--c:${esc(color)};--bg:#f5f6fb;--panel:#fff;--text:#171a24;--muted:#6a7184;--line:#e4e7ef}
@media (prefers-color-scheme:dark){:root{--bg:#0f1117;--panel:#181b24;--text:#eceef4;--muted:#9aa1b4;--line:#2a2f3c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:620px;margin:0 auto;padding:24px 16px 50px}.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;overflow:hidden}.in{padding:24px}
.cover{width:100%;aspect-ratio:16/9;object-fit:cover;display:block}.biz{color:var(--muted);font-size:.9rem;font-weight:600}h1{margin:4px 0 10px;font-size:1.6rem;line-height:1.2}
.meta{display:flex;flex-direction:column;gap:6px;margin:6px 0 14px}.meta div{display:flex;gap:10px;align-items:flex-start}.meta b{color:var(--c);min-width:22px}
.desc{color:var(--muted)}.types{border:1px solid var(--line);border-radius:14px;margin:16px 0}.type{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 16px}
.type+.type{border-top:1px solid var(--line)}.type small{display:block;color:var(--muted)}.type select{width:auto;min-width:72px}
label{display:block;font-weight:600;margin:14px 0 6px;font-size:.92rem}input,select{width:100%;font:inherit;color:inherit;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:11px}
button,.btn{display:block;width:100%;margin-top:20px;padding:15px;border:0;border-radius:14px;background:var(--c);color:#fff;font:inherit;font-weight:700;font-size:1.08rem;cursor:pointer;text-align:center;text-decoration:none}
.err{margin:14px 0;padding:12px 14px;border-radius:12px;background:#fdecec;color:#7f1d1d}.ok{margin:14px 0;padding:12px 14px;border-radius:12px;background:#e7f7ec;color:#14532d;font-weight:600}
.muted{color:var(--muted);font-size:.88rem}.hp{position:absolute;left:-9999px}.total{font-weight:800;font-size:1.15rem;margin-top:12px}
.ticket{text-align:center}.ticket svg{width:min(280px,80vw);height:auto;background:#fff;border-radius:12px;padding:6px}.big{font-size:1.4rem;font-weight:800}
.stamp{display:inline-block;padding:6px 14px;border-radius:999px;font-weight:800;margin:8px 0}.stamp.good{background:#e7f7ec;color:#166534}.stamp.used{background:#fef3c7;color:#92400e}.stamp.bad{background:#fdecec;color:#991b1b}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}
const img = (u) => (/^media\//.test(u || '') ? `../s/${u}` : u);
function eventPage(e, { error, values = {} } = {}) {
  const b = (e.business_id && businesses().get(e.business_id)) || businesses().all()[0] || null;
  const s = shape(e);
  const stripeOn = invoices().settings().stripe;
  const anyPaid = s.types.some((t) => t.price > 0);
  const open = s.active && !s.past;
  return shell(b, e.title, `<div class="card">${e.cover ? `<img class="cover" src="${esc(img(e.cover))}" alt="">` : ''}<div class="in">
<div class="biz">${esc(b?.name || '')}</div><h1>${esc(e.title)}</h1>
<div class="meta"><div><b>📅</b><span>${esc(s.when)}</span></div>${e.location ? `<div><b>📍</b><a href="https://maps.google.com/?q=${encodeURIComponent(e.location)}" target="_blank" rel="noopener">${esc(e.location)}</a></div>` : ''}</div>
${e.description ? `<p class="desc">${nl(e.description)}</p>` : ''}
${error ? `<div class="err">${esc(error)}</div>` : ''}
${open ? `<form method="post" id="tf"><div class="types">${s.types.map((t) => `<div class="type"><div><b>${esc(t.name)}</b><small>${t.price ? money(t.price) : 'Free'}${t.left != null ? (t.left ? ` · ${t.left} left` : ' · Sold out') : ''}</small></div>
<select name="qty_${t.id}" aria-label="How many ${esc(t.name)}" data-price="${t.price}" ${t.left === 0 ? 'disabled' : ''}>${Array.from({ length: Math.min(MAX_PER_ORDER, t.left ?? MAX_PER_ORDER) + 1 }, (_, i) => `<option${Number(values[`qty_${t.id}`]) === i || (!values[`qty_${t.id}`] && s.types.length === 1 && i === 1) ? ' selected' : ''}>${i}</option>`).join('')}</select></div>`).join('')}</div>
<div class="total" id="tot"></div>
<label for="n">Your name</label><input id="n" name="name" required maxlength="80" autocomplete="name" value="${esc(values.name)}">
<label for="em">Email <span class="muted">(your tickets go here)</span></label><input id="em" name="email" type="email" required maxlength="200" autocomplete="email" value="${esc(values.email)}">
<label for="p">Phone <span class="muted">(optional)</span></label><input id="p" name="phone" type="tel" maxlength="40" autocomplete="tel" value="${esc(values.phone)}">
<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<button type="submit" id="go"${anyPaid && !stripeOn && !s.types.some((t) => !t.price) ? ' disabled' : ''}>Get tickets</button>
${anyPaid ? `<p class="muted" style="text-align:center">${stripeOn ? '🔒 Paid tickets: you pay on a secure Stripe page.' : 'Card payments are not set up yet.'}</p>` : ''}</form>
<script>(function(){var f=document.getElementById('tf'),t=document.getElementById('tot'),g=document.getElementById('go');function u(){var n=0,s=0;f.querySelectorAll('select[data-price]').forEach(function(x){var q=+x.value;n+=q;s+=q*(+x.dataset.price)});
t.textContent=n?n+' ticket'+(n>1?'s':'')+(s?' · $'+s.toFixed(2):' · Free'):'';g.textContent=s?'Pay $'+s.toFixed(2)+' with card':'Get '+(n>1?'tickets':'my ticket')}f.addEventListener('change',u);u()})();</script>`
    : `<div class="err">${s.past ? 'This event is over. Thanks to everyone who came!' : 'Tickets are not available right now.'}</div>`}
</div></div>`, { image: e.cover ? (/^media\//.test(e.cover) ? `${config.publicBaseUrl}/s/${e.cover}` : e.cover) : '' });
}
async function ticketPage(code, { staff, notice, isNew } = {}) {
  const t = db.prepare('SELECT t.*, c.name AS contact_name FROM crm_tickets t LEFT JOIN contacts c ON c.id=t.contact_id WHERE t.code=?').get(String(code));
  if (!t) return null;
  const e = getEvent(t.event_id);
  const b = (e.business_id && businesses().get(e.business_id)) || businesses().all()[0] || null;
  const QR = require('qrcode');
  const qr = t.status === 'valid' ? await QR.toString(ticketLink(t.code), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : '';
  const others = t.contact_id ? db.prepare("SELECT code, type_name FROM crm_tickets WHERE contact_id=? AND event_id=? AND status='valid' AND id<>? ORDER BY id").all(t.contact_id, e.id, t.id) : [];
  const state = t.status !== 'valid' ? ['bad', t.status === 'pending' ? 'Waiting for payment' : 'Cancelled'] : t.checked_in_at ? ['used', `Checked in ${new Date(t.checked_in_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`] : ['good', 'Valid ticket'];
  return shell(b, `Ticket: ${e.title}`, `<div class="card"><div class="in ticket">
${isNew ? '<div class="ok">You\'re in! We emailed your ticket too.</div>' : ''}${notice ? `<div class="${notice.ok ? 'ok' : 'err'}">${esc(notice.text)}</div>` : ''}
<div class="biz">${esc(b?.name || '')}</div><h1>${esc(e.title)}</h1><div class="muted">${esc(when(e))}${e.location ? `<br>${esc(e.location)}` : ''}</div>
<div class="big" style="margin-top:14px">${esc(t.contact_name || '')}</div><div>${esc(t.type_name)}</div><div class="stamp ${state[0]}">${esc(state[1])}</div>
${qr ? `<div style="margin-top:8px">${qr}</div><p class="muted">Show this at the door.</p>` : ''}
${others.length ? `<p class="muted">Your other tickets: ${others.map((o, i) => `<a href="${esc(o.code)}">${i + 2}. ${esc(o.type_name)}</a>`).join(' · ')}</p>` : ''}
${t.status === 'valid' ? (staff ? `<form method="post" action="${esc(t.code)}/checkin">${t.checked_in_at ? '<input type="hidden" name="undo" value="1"><button type="submit" style="background:#6b7280">Undo check-in</button>' : '<button type="submit">Check in</button>'}</form>`
    : `<details style="margin-top:22px;text-align:left"><summary class="muted">Staff: check in</summary><form method="post" action="${esc(t.code)}/staff"><label for="dc">Door code</label><input id="dc" name="door_code" inputmode="numeric" autocomplete="off" maxlength="8"><button type="submit">Unlock check-in</button></form></details>`) : ''}
</div></div>`);
}

function publicRouter() {
  const r = express.Router();
  r.use(express.urlencoded({ extended: false, limit: '20kb' }));
  const page = (res, html, status = 200) => res.status(status).set('Cache-Control', 'no-store').type('html').send(html);
  const notFound = (res) => page(res, '<meta name="viewport" content="width=device-width, initial-scale=1"><p style="font:18px system-ui;padding:20px">This page is not available.</p>', 404);
  // Staff phones remember the door code for each event in a cookie for 2 days.
  const cookieName = (eventId) => `vt_door_${eventId}`;
  const hasStaff = (req, e) => String(req.headers.cookie || '').split(/;\s*/).some((c) => c === `${cookieName(e.id)}=${crypto.createHash('sha256').update(`${e.id}:${e.door_code}`).digest('hex').slice(0, 24)}`);
  r.get('/ticket/:code', async (req, res) => {
    const t = db.prepare('SELECT event_id FROM crm_tickets WHERE code=?').get(String(req.params.code));
    if (!t) return notFound(res);
    const e = getEvent(t.event_id);
    const n = req.query;
    const notice = n.in ? { ok: true, text: 'Checked in. Welcome!' } : n.again ? { ok: false, text: 'This ticket was ALREADY checked in.' } : n.undone ? { ok: true, text: 'Check-in undone.' }
      : n.unlocked ? { ok: true, text: 'Check-in unlocked on this phone for this event.' } : n.wrong ? { ok: false, text: 'Wrong door code.' } : null;
    page(res, await ticketPage(req.params.code, { staff: hasStaff(req, e), notice, isNew: Boolean(n.new) }));
  });
  r.post('/ticket/:code/staff', (req, res) => {
    const t = db.prepare('SELECT event_id FROM crm_tickets WHERE code=?').get(String(req.params.code));
    if (!t) return notFound(res);
    const e = getEvent(t.event_id), back = `../${encodeURIComponent(req.params.code)}`;
    if (crm().tooMany(String(req.get('cf-connecting-ip') || req.ip))) return res.redirect(303, `${back}?wrong=1`);
    if (String(req.body.door_code || '').trim() !== e.door_code) return res.redirect(303, `${back}?wrong=1`);
    res.set('Set-Cookie', `${cookieName(e.id)}=${crypto.createHash('sha256').update(`${e.id}:${e.door_code}`).digest('hex').slice(0, 24)}; Max-Age=172800; Path=/; HttpOnly; SameSite=Lax`);
    res.redirect(303, `${back}?unlocked=1`);
  });
  r.post('/ticket/:code/checkin', (req, res) => {
    const t = db.prepare('SELECT event_id FROM crm_tickets WHERE code=?').get(String(req.params.code));
    if (!t) return notFound(res);
    const back = `../${encodeURIComponent(req.params.code)}`;
    if (!hasStaff(req, getEvent(t.event_id))) return res.redirect(303, `${back}?wrong=1`);
    try { const out = checkIn(req.params.code, { undo: req.body.undo === '1' }); res.redirect(303, `${back}?${req.body.undo === '1' ? 'undone' : out.already ? 'again' : 'in'}=1`); }
    catch { res.redirect(303, back); }
  });
  r.get('/:slug', (req, res) => {
    const e = db.prepare('SELECT * FROM crm_events WHERE slug=?').get(String(req.params.slug));
    if (!e || (!e.active && !shape(e).past)) return notFound(res);
    page(res, eventPage(e));
  });
  r.post('/:slug', async (req, res) => {
    const e = db.prepare('SELECT * FROM crm_events WHERE slug=?').get(String(req.params.slug));
    if (!e) return notFound(res);
    if (req.body.website) return page(res, eventPage(e));
    if (crm().tooMany(String(req.get('cf-connecting-ip') || req.ip))) return page(res, eventPage(e, { error: 'Too many tries. Please wait a bit.', values: req.body }), 429);
    try { const out = await order(e.slug, { ...req.body, ref: require('./referrals').fromReq(req) }); res.redirect(303, out.url); }
    catch (x) { page(res, eventPage(e, { error: x.message, values: req.body }), x.status || 500); }
  });
  return r;
}

const router = express.Router();
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.get('/', wrap((req) => list(req.query.biz)));
router.get('/:id', wrap((req) => { const e = shape(getEvent(req.params.id), { full: true }); if (!e) throw err('Event not found', 404); return e; }));
router.post('/', wrap((req) => save(req.body || {}, null, req.query.biz)));
router.put('/:id', wrap((req) => save(req.body || {}, Number(req.params.id))));
router.delete('/:id', wrap((req) => remove(req.params.id)));
router.post('/:id/guests', wrap((req) => addGuest(req.params.id, req.body || {})));
router.post('/tickets/:id/checkin', wrap((req) => { const t = db.prepare('SELECT code FROM crm_tickets WHERE id=?').get(Number(req.params.id)); if (!t) throw err('Ticket not found', 404); return checkIn(t.code, { undo: Boolean((req.body || {}).undo) }); }));
router.post('/tickets/:id/cancel', wrap((req) => cancelTicket(req.params.id)));
router.post('/tickets/:id/resend', wrap(async (req) => { const t = db.prepare('SELECT * FROM crm_tickets WHERE id=?').get(Number(req.params.id)); if (!t) throw err('Ticket not found', 404); return { emailed: await emailTickets(t.contact_id, t.event_id) }; }));
router.get('/:id/qr', async (req, res) => {
  const e = getEvent(req.params.id);
  if (!e) return res.status(404).end();
  res.type('svg').send(await require('qrcode').toString(linkFor(e), { type: 'svg', margin: 2 }));
});

module.exports = { save, list, remove, order, onPaid, invoiceExtra, forContact, checkIn, cancelTicket, addGuest, emailTickets, publicRouter, router, when };
