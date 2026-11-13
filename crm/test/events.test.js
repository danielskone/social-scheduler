// Events and tickets: free and paid tickets, QR ticket emails, door check-in, guests, portal.
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
const sessions = new Map();
const stripeLog = [];
const subs = new Map();          // sub id -> subscription
const subInvoices = new Map();   // sub id -> paid invoices
const stripe = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== 'Bearer rk_test_goodkey1234567') return json(401, { error: { message: 'Invalid API Key provided' } });
    stripeLog.push({ method: req.method, url: req.url, body: b });
    if (req.url === '/v1/account') return json(200, { settings: { dashboard: { display_name: 'Parade Co' } } });
    if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
      const f = new URLSearchParams(b), id = `cs_${sessions.size + 1}`;
      sessions.set(id, { id, mode: f.get('mode') || 'payment', interval: f.get('line_items[0][price_data][recurring][interval]'), success_url: f.get('success_url'),
        client_reference_id: f.get('client_reference_id'), amount: Number(f.get('line_items[0][price_data][unit_amount]')), payment_status: 'unpaid', status: 'open', url: `https://checkout.test/${id}` });
      return json(200, sessions.get(id));
    }
    const m = req.url.match(/^\/v1\/checkout\/sessions\/(\w+)/);
    if (m && sessions.has(m[1])) return json(200, sessions.get(m[1]));
    const s = req.url.match(/^\/v1\/subscriptions\/(\w+)$/);
    if (s && subs.has(s[1])) {
      const sub = subs.get(s[1]);
      if (req.method === 'DELETE') sub.status = 'canceled';
      if (req.method === 'POST' && new URLSearchParams(b).get('cancel_at_period_end') === 'true') sub.cancel_at_period_end = true;
      return json(200, sub);
    }
    const inv = req.url.match(/^\/v1\/invoices\?subscription=(\w+)&status=paid/);
    if (inv) return json(200, { data: subInvoices.get(inv[1]) || [] });
    json(404, { error: { message: 'not found' } });
  });
});
const ntfy = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end('{}')); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const flatMail = (m) => m.body.replace(/=\r?\n/g, '').replace(/=3D/g, '=');

let root, server;
const OWNER = { Authorization: `Basic ${Buffer.from(':owner-pass-123').toString('base64')}` };
const j = async (p, opts = {}) => {
  const pub = !opts.api && /^\/(chat|pay|portal|learn|invoice|s|subscribe|sign|blog|e)(\/|$)/.test(p);
  delete opts.api;
  if (!pub) opts.headers = { ...OWNER, ...(opts.headers || {}) };
  if (opts.json) { opts.body = JSON.stringify(opts.json); opts.headers = { ...(opts.headers || {}), 'Content-Type': 'application/json' }; delete opts.json; }
  if (opts.form) { opts.body = new URLSearchParams(opts.form).toString(); opts.headers = { ...(opts.headers || {}), 'Content-Type': 'application/x-www-form-urlencoded' }; delete opts.form; opts.method = 'POST'; }
  const r = await fetch(root + (pub ? p : `/api/crm${p}`), { redirect: 'manual', ...opts });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body, headers: r.headers };
};
test.before(async () => {
  for (const s of [smtp, stripe, ntfy]) await new Promise((r) => s.listen(0, '127.0.0.1', r));
  Object.assign(process.env, {
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'events-')), NTFY_BASE: `http://127.0.0.1:${ntfy.address().port}`, APP_PASSWORD: 'owner-pass-123',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port), SMTP_PASS: 'x',
    EMAIL_FROM: 'daniel@viralattraction.com', EMAIL_FROM_NAME: 'Daniel King', EMAIL_MAILING_ADDRESS: 'PO Box 1, Fuquay-Varina, NC 27526',
    STRIPE_API_BASE: `http://127.0.0.1:${stripe.address().port}`, PUBLIC_BASE_URL: 'https://example.test',
  });
  server = require('../../src/server').listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  root = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { for (const s of [smtp, stripe, ntfy, server]) s.close(); });
const person = async (name, email, group = 'Auto customer') => (await j('/contacts', { method: 'POST', json: { name, email, phone: '919-555-0100', group_name: group } })).body;
const form = async (p, fields, headers = {}) => j(p, { form: fields, headers });


test('events: free tickets, paid tickets through Stripe, QR tickets by email, check-in at the door', async () => {
  await j('/invoices/settings', { method: 'PUT', json: { stripeKey: 'rk_test_goodkey1234567' } });
  assert.equal((await j('/events', { method: 'POST', json: { title: 'No tickets', starts_at: '2030-12-06T18:00' } })).status, 400);
  assert.equal((await j('/events', { method: 'POST', json: { title: 'Bad price', starts_at: '2030-12-06T18:00', types: [{ name: 'A', price: '0.10' }] } })).status, 400);
  const ev = (await j('/events', { method: 'POST', json: { title: 'Christmas Parade Gala', starts_at: '2030-12-06T18:00', ends_at: '2030-12-06T21:00', location: '1 Main St, Fuquay-Varina, NC',
    types: [{ name: 'General', price: 0, capacity: 3 }, { name: 'VIP', price: '$25' }] } })).body;
  assert.equal(ev.slug, 'christmas-parade-gala');
  assert.match(ev.link, /^https:\/\/example\.test\/e\/christmas-parade-gala$/);
  assert.match(ev.door_code, /^\d{4}$/);
  const [gen, vip] = ev.types;

  const page = await j(`/e/${ev.slug}`);
  assert.equal(page.status, 200);
  assert.match(page.body, /Christmas Parade Gala/);
  assert.match(page.body, /3 left/);
  assert.match(page.body, /\$25\.00/);

  // Free: 2 tickets right away, emailed with their links.
  assert.equal((await form(`/e/${ev.slug}`, { name: 'Ann Lee', email: 'ann@example.com' })).status, 400); // picked nothing
  const free = await form(`/e/${ev.slug}`, { name: 'Ann Lee', email: 'ann@example.com', [`qty_${gen.id}`]: '2' });
  assert.equal(free.status, 303);
  const tLink = free.headers.get('location');
  assert.match(tLink, /^ticket\/[\w-]+\?new=1$/);
  const code = tLink.split('/')[1].split('?')[0];
  await wait(300);
  const mail = mails.find((m) => m.rcpt.includes('ann@example.com') && /Your tickets/.test(m.body));
  assert.ok(mail, 'ticket email sent');
  assert.match(flatMail(mail), new RegExp(`https://example\\.test/e/ticket/${code}`));
  const tp = await j(`/e/${tLink}`);
  assert.match(tp.body, /<svg/);
  assert.match(tp.body, /Valid ticket/);
  assert.match(tp.body, /Ann Lee/);

  // Only 1 General left now.
  const over = await form(`/e/${ev.slug}`, { name: 'Bob Ray', email: 'bob@example.com', [`qty_${gen.id}`]: '2' });
  assert.equal(over.status, 400);
  assert.match(over.body, /Only 1 &quot;General&quot; ticket is left/);

  // Paid: goes to Stripe, tickets wait, then become good when paid.
  const paid = await form(`/e/${ev.slug}`, { name: 'Cara Diaz', email: 'cara@example.com', [`qty_${vip.id}`]: '2' });
  assert.equal(paid.status, 303);
  assert.match(paid.headers.get('location'), /^https:\/\/checkout\.test\/cs_/);
  const sess = sessions.get(paid.headers.get('location').split('/').pop());
  assert.equal(sess.amount, 5000);
  let full = (await j(`/events/${ev.id}`)).body;
  assert.equal(full.sold, 2);
  assert.equal(full.tickets.length, 2); // pending ones are hidden from the list
  Object.assign(sess, { status: 'complete', payment_status: 'paid', payment_intent: 'pi_1' });
  const back = new URL(sess.success_url.replace('{CHECKOUT_SESSION_ID}', sess.id));
  const inv = await j(`${back.pathname}${back.search}`);
  assert.match(inv.body, /See your tickets/);
  await wait(300);
  full = (await j(`/events/${ev.id}`)).body;
  assert.equal(full.sold, 4);
  assert.equal(full.revenue, 50);
  assert.ok(mails.some((m) => m.rcpt.includes('cara@example.com') && /Your tickets/.test(m.body)));

  // Door: locked until the door code is typed.
  const locked = await form(`/e/ticket/${code}/checkin`, {});
  assert.match(locked.headers.get('location'), /wrong=1/);
  const wrong = await form(`/e/ticket/${code}/staff`, { door_code: '0000' });
  assert.match(wrong.headers.get('location'), /wrong=1/);
  const ok = await form(`/e/ticket/${code}/staff`, { door_code: ev.door_code });
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.match(ok.headers.get('location'), /unlocked=1/);
  assert.match((await j(`/e/ticket/${code}`, { headers: { Cookie: cookie } })).body, />Check in</);
  assert.match((await form(`/e/ticket/${code}/checkin`, {}, { Cookie: cookie })).headers.get('location'), /in=1/);
  assert.match((await form(`/e/ticket/${code}/checkin`, {}, { Cookie: cookie })).headers.get('location'), /again=1/);
  assert.match((await j(`/e/ticket/${code}?again=1`, { headers: { Cookie: cookie } })).body, /ALREADY checked in/);
  full = (await j(`/events/${ev.id}`)).body;
  assert.equal(full.checkedIn, 1);

  // From the CRM: check in, add a guest, cancel.
  const cara = full.tickets.find((t) => t.contact_name === 'Cara Diaz');
  assert.equal((await j(`/events/tickets/${cara.id}/checkin`, { method: 'POST', json: {} })).body.ok, true);
  const guest = await person('Gus Guest', 'gus@example.com');
  const g = (await j(`/events/${ev.id}/guests`, { method: 'POST', json: { contact_id: guest.id, type_id: vip.id } })).body;
  assert.equal(g.sold, 5);
  assert.equal(g.emailed, true);
  const gt = g.tickets.find((t) => t.contact_name === 'Gus Guest');
  assert.equal(gt.price, 0);
  await j(`/events/tickets/${gt.id}/cancel`, { method: 'POST', json: {} });
  assert.equal((await j(`/events/${ev.id}`)).body.sold, 4);

  // Can't delete an event people paid for, and a ticket type with tickets can't be removed.
  assert.equal((await j(`/events/${ev.id}`, { method: 'DELETE' })).status, 400);
  assert.equal((await j(`/events/${ev.id}`, { method: 'PUT', json: { types: [{ id: gen.id, name: 'General', price: 0 }] } })).status, 400);
  const renamed = (await j(`/events/${ev.id}`, { method: 'PUT', json: { types: [{ id: gen.id, name: 'Free entry', price: 0, capacity: 10 }, { id: vip.id, name: 'VIP', price: 25 }, { name: 'Kids', price: 5 }] } })).body;
  assert.deepEqual(renamed.types.map((t) => t.name), ['Free entry', 'VIP', 'Kids']);

  // The list, and tickets in the customer portal.
  const list = (await j('/events')).body;
  assert.equal(list.totals.sold, 4);
  assert.equal(list.totals.revenue, 50);
  const ann = (await j('/contacts')).body.find((c) => c.email === 'ann@example.com');
  const portal = (await j(`/portal/${ann.id}/link`, { method: 'POST', json: {}, api: true })).body;
  const pp = await j(new URL(portal.link).pathname);
  assert.match(pp.body, /Your tickets/);
  assert.match(pp.body, /Show ticket/);
  // Turned off: page says so, no sales.
  await j(`/events/${ev.id}`, { method: 'PUT', json: { active: false } });
  assert.equal((await j(`/e/${ev.slug}`)).status, 404);
  assert.equal((await j(`/events/${ev.id}/qr`, { raw: true })).status, 200);
});
