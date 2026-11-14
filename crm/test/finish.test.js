// Team booking pages, backups, duplicates and activity history.
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mails = [];
const smtp = net.createServer((sock) => {
  let data = false, buf = '', cur = { rcpt: [], body: '' };
  const say = (l) => sock.write(l + '\r\n');
  say('220 fake ESMTP');
  sock.on('data', (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (data) { if (line === '.') { data = false; mails.push(cur); cur = { rcpt: [], body: '' }; say('250 OK'); } else cur.body += line + '\n'; continue; }
      const cmd = line.toUpperCase();
      if (cmd.startsWith('EHLO')) sock.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (cmd.startsWith('RCPT TO')) { cur.rcpt.push(line.match(/<(.+)>/)[1].toLowerCase()); say('250 OK'); }
      else if (cmd === 'DATA') { data = true; say('354 go'); }
      else if (cmd === 'QUIT') { say('221 bye'); sock.end(); }
      else say(cmd.startsWith('AUTH') ? '235 OK' : '250 OK');
    }
  });
});
const ntfy = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end('{}')); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let root, server;
const OWNER = { Authorization: `Basic ${Buffer.from(':owner-pass-123').toString('base64')}` };
const j = async (p, opts = {}) => {
  const pub = !opts.api && /^\/(chat)(\/|$)/.test(p);
  delete opts.api;
  if (!pub) opts.headers = { ...OWNER, ...(opts.headers || {}) };
  if (opts.json) { opts.body = JSON.stringify(opts.json); opts.headers = { ...(opts.headers || {}), 'Content-Type': 'application/json' }; delete opts.json; }
  const r = await fetch(root + (pub ? p : `/api/crm${p}`), { redirect: 'manual', ...opts });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body, headers: r.headers };
};
test.before(async () => {
  for (const s of [smtp, ntfy]) await new Promise((r) => s.listen(0, '127.0.0.1', r));
  Object.assign(process.env, {
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'finish-')), NTFY_BASE: `http://127.0.0.1:${ntfy.address().port}`, APP_PASSWORD: 'owner-pass-123',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port), SMTP_PASS: 'x',
    EMAIL_FROM: 'daniel@viralattraction.com', EMAIL_FROM_NAME: 'Daniel King', EMAIL_MAILING_ADDRESS: 'PO Box 1, Fuquay-Varina, NC 27526', PUBLIC_BASE_URL: 'https://example.test',
  });
  server = require('../../src/server').listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  root = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { for (const s of [smtp, ntfy, server]) s.close(); });

const login = async (email, password) => {
  const r = await fetch(`${root}/login`, { method: 'POST', body: new URLSearchParams({ email, password }), redirect: 'manual' });
  return { Cookie: r.headers.get('set-cookie').split(';')[0] };
};

test('team booking pages take turns between people, each with their own hours', async () => {
  const booking = require('../server/booking');
  const ana = (await j('/team', { method: 'POST', json: { name: 'Ana Cruz', email: 'ana@team.org', password: 'ana-pass-123', role: 'helper', hours_days: '1,2,3,4,5', hours_start: '09:00', hours_end: '12:00' } })).body;
  const jay = (await j('/team', { method: 'POST', json: { name: 'Jay Patel', email: 'jay@team.org', password: 'jay-pass-123', role: 'helper' } })).body;
  assert.strictEqual(ana.hours_end, '12:00');
  assert.strictEqual((await j(`/team/${jay.id}`, { method: 'PUT', json: { hours_start: '15:00', hours_end: '10:00' } })).status, 400);
  const pg = (await j('/booking/pages', { method: 'POST', json: { title: 'Free estimate', group_name: 'Auto customer', minutes: 60, days: '1,2,3,4,5', start_time: '09:00', end_time: '17:00', days_ahead: 14, notice_hours: 0, team: [ana.id, jay.id] } })).body;
  assert.deepStrictEqual(JSON.parse(pg.team), [ana.id, jay.id]);
  const now = new Date();
  const anaSlots = booking.staffSlots(pg, ana.id, now), jaySlots = booking.staffSlots(pg, jay.id, now);
  const hour = (iso) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date(iso)));
  assert.ok(anaSlots.every((t) => hour(t) >= 9 && hour(t) < 12), "Ana's own hours: mornings only");
  assert.ok(jaySlots.some((t) => hour(t) >= 14), 'Jay uses the page hours');
  const both = anaSlots.find((t) => jaySlots.includes(t));
  // Two people book the same time: one goes to each, then the time is full.
  const r1 = booking.book(pg, { name: 'Lee One', email: 'lee1@x.com', t: both }, now);
  const r2 = booking.book(pg, { name: 'Lee Two', email: 'lee2@x.com', t: both }, now);
  assert.deepStrictEqual([r1.appointment.staff_id, r2.appointment.staff_id].sort(), [ana.id, jay.id].sort());
  assert.throws(() => booking.book(pg, { name: 'Lee Three', email: 'lee3@x.com', t: both }, now), /just taken/);
  // The owner's own calendar is not blocked by team bookings.
  const mine = (await j('/booking/pages', { method: 'POST', json: { title: 'Owner call', group_name: 'Auto customer', minutes: 60, days: '1,2,3,4,5', start_time: '09:00', end_time: '17:00', days_ahead: 14, notice_hours: 0 } })).body;
  assert.strictEqual(mine.team, null);
  assert.ok(booking.slotsFor(mine, now).includes(both));
  const list = (await j('/booking/appointments')).body;
  assert.ok(list.some((a) => a.staff_name === 'Ana Cruz'));
  await wait(300);
  assert.ok(mails.some((m) => m.rcpt.includes('ana@team.org') && /New booking/.test(m.body)) || mails.some((m) => m.rcpt.includes('jay@team.org') && /New booking/.test(m.body)), 'the team member got a "new booking" email');
});

test('backups: make one, download it, put it back (CRM only), and load a file', async () => {
  const db = require('../../src/db');
  const keep = (await j('/contacts', { method: 'POST', json: { name: 'Keep Me', email: 'keep@x.com', group_name: 'Auto customer' } })).body;
  db.prepare("INSERT INTO posts (caption, scheduled_at) VALUES ('Post A', '2026-12-01T15:00:00Z')").run();
  const made = (await j('/backups', { method: 'POST' })).body;
  assert.match(made.name, /^manual-.*\.db$/);
  const dl = await fetch(`${root}/api/crm/backups/${made.name}/download`, { headers: OWNER });
  const file = Buffer.from(await dl.arrayBuffer());
  assert.strictEqual(file.subarray(0, 15).toString(), 'SQLite format 3');
  // Things change after the backup...
  await j(`/contacts/${keep.id}`, { method: 'DELETE' });
  await j('/contacts', { method: 'POST', json: { name: 'Added Later', email: 'later@x.com', group_name: 'Auto customer' } });
  db.prepare("INSERT INTO posts (caption, scheduled_at) VALUES ('Post B', '2026-12-02T15:00:00Z')").run();
  // ...and putting the backup back brings the CRM back, but leaves Viral Post's posts alone.
  const r = (await j(`/backups/${made.name}/restore`, { method: 'POST' })).body;
  assert.ok(r.ok);
  assert.match(r.undo, /^before-restore-/);
  assert.ok(db.prepare("SELECT 1 FROM contacts WHERE email='keep@x.com'").get());
  assert.ok(!db.prepare("SELECT 1 FROM contacts WHERE email='later@x.com'").get());
  assert.ok(db.prepare("SELECT 1 FROM posts WHERE caption='Post B'").get(), 'Viral Post posts are not touched');
  // Undo works the same way.
  await j(`/backups/${r.undo}/restore`, { method: 'POST' });
  assert.ok(db.prepare("SELECT 1 FROM contacts WHERE email='later@x.com'").get());
  // A downloaded file can be loaded again; other files are refused.
  const up = await fetch(`${root}/api/crm/backups/upload`, { method: 'POST', headers: { ...OWNER, 'Content-Type': 'application/octet-stream' }, body: file });
  const ub = await up.json();
  assert.match(ub.name, /^uploaded-/);
  assert.ok(ub.people >= 1);
  const bad = await fetch(`${root}/api/crm/backups/upload`, { method: 'POST', headers: { ...OWNER, 'Content-Type': 'application/octet-stream' }, body: Buffer.alloc(500, 1) });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual((await j('/backups/..%2Fapp.db/download')).status, 404);
  // Nightly backups keep 14.
  const backups = require('../server/backups');
  for (let i = 0; i < 3; i++) await backups.nightly();
  assert.ok((await j('/backups')).body.backups.some((b) => b.kind === 'Nightly'));
});

test('find duplicates and merge them, keeping everything', async () => {
  const db = require('../../src/db');
  const a = (await j('/contacts', { method: 'POST', json: { name: 'Rita Gomez', email: 'rita@gomezlaw.com', group_name: 'Auto customer', tags: 'VIP' } })).body;
  const b = (await j('/contacts', { method: 'POST', json: { name: 'Rita  gomez', phone: '(919) 555-0142', company: 'Gomez Law', group_name: 'Auto customer', tags: 'Gala 2026' } })).body;
  const c = (await j('/contacts', { method: 'POST', json: { name: 'R. Gomez', email: 'RITA@gomezlaw.com', group_name: 'Auto customer', do_not_contact: true } })).body;
  const solo = (await j('/contacts', { method: 'POST', json: { name: 'Sam Lee', email: 'sam@lee.org', group_name: 'Auto customer' } })).body;
  await j('/tasks', { method: 'POST', json: { title: 'Call Rita', contact_id: b.id } });
  const g = (await j('/duplicates')).body.groups.find((x) => x.people.some((p) => p.id === a.id));
  assert.deepStrictEqual(g.people.map((p) => p.id).sort((x, y) => x - y), [a.id, b.id, c.id]);
  assert.ok(g.reasons.includes('Same email') && g.reasons.includes('Same name'));
  assert.ok(!(await j('/duplicates')).body.groups.some((x) => x.people.some((p) => p.id === solo.id)));
  const kept = (await j('/duplicates/merge', { method: 'POST', json: { keep: a.id, merge: [b.id, c.id] } })).body;
  assert.strictEqual(kept.company, 'Gomez Law', 'empty boxes filled in');
  assert.strictEqual(kept.phone, '(919) 555-0142');
  assert.match(kept.tags, /VIP/); assert.match(kept.tags, /Gala 2026/);
  assert.strictEqual(kept.do_not_contact, 1, '"Do not contact" wins');
  assert.ok(db.prepare("SELECT 1 FROM crm_tasks WHERE contact_id=? AND title='Call Rita'").get(a.id), 'tasks moved');
  assert.ok(!db.prepare('SELECT 1 FROM contacts WHERE id IN (?,?)').get(b.id, c.id));
  // "Not the same person" hides a pair.
  const x = (await j('/contacts', { method: 'POST', json: { name: 'Chris Park', email: 'c1@x.com', group_name: 'Auto customer' } })).body;
  const y = (await j('/contacts', { method: 'POST', json: { name: 'Chris Park', email: 'c2@x.com', group_name: 'Auto customer' } })).body;
  assert.ok((await j('/duplicates')).body.groups.some((gr) => gr.people.some((p) => p.id === x.id)));
  await j('/duplicates/not-same', { method: 'POST', json: { ids: [x.id, y.id] } });
  assert.ok(!(await j('/duplicates')).body.groups.some((gr) => gr.people.some((p) => p.id === x.id)));
});

test('activity history: who changed what, admins only', async () => {
  await j('/team', { method: 'POST', json: { name: 'Pat Helper', email: 'pat@team.org', password: 'pat-pass-123', role: 'helper' } });
  const pat = await login('pat@team.org', 'pat-pass-123');
  const r = await fetch(`${root}/api/crm/contacts`, { method: 'POST', headers: { ...pat, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Walk In', group_name: 'Auto customer' }) });
  assert.strictEqual(r.status, 200);
  await j('/tasks', { method: 'POST', json: { title: 'Order cones' } });
  await wait(100);
  const h = (await j('/audit')).body;
  const byPat = h.rows.find((x) => x.who === 'Pat Helper');
  assert.strictEqual(byPat.action, 'Added a person');
  assert.strictEqual(byPat.detail, 'Walk In');
  assert.ok(h.rows.some((x) => x.who === 'Owner' && x.action === 'Added a task' && x.detail === 'Order cones'));
  assert.ok(h.people.some((p) => p.who === 'Pat Helper'));
  // Helpers can't read it, make backups or merge people.
  assert.strictEqual((await fetch(`${root}/api/crm/audit`, { headers: pat })).status, 403);
  assert.strictEqual((await fetch(`${root}/api/crm/backups`, { headers: pat })).status, 403);
  assert.strictEqual((await fetch(`${root}/api/crm/duplicates/merge`, { method: 'POST', headers: pat })).status, 403);
  assert.strictEqual(require('../server/audit').describe('POST', '/invoices/4/send'), 'Sent an invoice');
  // Changes inside the smaller routers (team, backups) are named too.
  assert.ok(h.rows.some((x) => x.action === 'Added a team member' && x.detail === 'Pat Helper'));
});

test('big lists stay quick: light people lists and the fast pipeline lookup give the same answers', async () => {
  const crm = require('../server/crm'), pipes = require('../server/pipelines');
  await j('/contacts', { method: 'POST', json: { name: 'Light Test', email: 'light@x.com', group_name: 'Auto customer', notes: 'Long private notes' } });
  const full = crm.listContacts({}), lite = (await j('/contacts?lite=1')).body;
  assert.strictEqual(full.length, lite.length);
  const row = lite.find((c) => c.email === 'light@x.com');
  assert.strictEqual(row.notes, undefined, 'notes are left out of light lists');
  assert.ok(row.name && row.stage && Array.isArray(row.tag_list) && row.pipeline);
  const of = pipes.resolver();
  for (const c of full) assert.strictEqual(of(c).id, pipes.ofContact(c).id);
  assert.ok(crm.summary('').moved >= 0);
});
