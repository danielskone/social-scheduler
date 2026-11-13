// Website chat, products with Buy now links, the customer portal and courses.
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
const stripe = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== 'Bearer rk_test_goodkey1234567') return json(401, { error: { message: 'Invalid API Key provided' } });
    if (req.url === '/v1/account') return json(200, { settings: { dashboard: { display_name: 'Parade Co' } } });
    if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
      const f = new URLSearchParams(b), id = `cs_${sessions.size + 1}`;
      sessions.set(id, { id, client_reference_id: f.get('client_reference_id'), amount: Number(f.get('line_items[0][price_data][unit_amount]')), payment_status: 'unpaid', url: `https://checkout.test/${id}` });
      return json(200, sessions.get(id));
    }
    const m = req.url.match(/^\/v1\/checkout\/sessions\/(\w+)/);
    if (m && sessions.has(m[1])) return json(200, sessions.get(m[1]));
    json(404, { error: { message: 'not found' } });
  });
});
const ntfy = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end('{}')); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const flatMail = (m) => m.body.replace(/=\r?\n/g, '').replace(/=3D/g, '=');

let root, server;
const OWNER = { Authorization: `Basic ${Buffer.from(':owner-pass-123').toString('base64')}` };
const j = async (p, opts = {}) => {
  const pub = !opts.api && /^\/(chat|pay|portal|learn|invoice|s)(\/|$)/.test(p);
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
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'more2-')), NTFY_BASE: `http://127.0.0.1:${ntfy.address().port}`, APP_PASSWORD: 'owner-pass-123',
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

test('website chat: a visitor writes, it lands in Conversations, you answer, they see it (or get it by email)', async () => {
  const s = (await j('/chat/settings', { api: true })).body;
  assert.ok(s.enabled && s.key && s.code.includes(`/chat/widget.js?k=${s.key}`));
  const js = await j(`/chat/widget.js?k=${s.key}`);
  assert.match(js.body, /__vtChat/);
  assert.match((await j(`/chat/${s.key}`)).body, /<form/);
  const bad = await j(`/chat/${s.key}/start`, { method: 'POST', json: { name: '', text: 'hi' } });
  assert.strictEqual(bad.status, 400);
  const st = (await j(`/chat/${s.key}/start`, { method: 'POST', json: { name: 'Vera Visitor', email: 'vera@example.com', text: 'Do you have a red Camry?', page: 'https://site.test/cars' } })).body;
  assert.ok(st.token);
  await j(`/chat/${s.key}/send`, { method: 'POST', json: { token: st.token, text: 'Under 20k please' } });
  const convo = (await j('/inbox')).body;
  const list = convo.conversations || convo;
  const row = list.find((c) => c.name === 'Vera Visitor');
  assert.ok(row, 'chat shows in Conversations');
  assert.strictEqual(row.channel, 'chat');
  const thread = (await j(`/inbox/${row.id}`)).body;
  assert.ok(thread.chat && thread.chat.online, 'they are on the site now');
  const r = (await j(`/chat/${row.id}/reply`, { api: true, method: 'POST', json: { text: 'Yes! Come see it today.' } })).body;
  assert.deepStrictEqual([r.online, r.emailed], [true, false]);
  const polled = (await j(`/chat/${s.key}/poll?token=${encodeURIComponent(st.token)}&after=0`)).body;
  assert.deepStrictEqual(polled.messages.map((m) => [m.me, m.text]), [[true, 'Do you have a red Camry?'], [true, 'Under 20k please'], [false, 'Yes! Come see it today.']]);
  // They left: the answer goes to their email too.
  require('../../src/db').prepare("UPDATE crm_chat_visitors SET last_seen='2020-01-01T00:00:00Z' WHERE token=?").run(st.token);
  mails.length = 0;
  const r2 = (await j(`/chat/${row.id}/reply`, { api: true, method: 'POST', json: { text: 'Still here if you need us.' } })).body;
  assert.deepStrictEqual([r2.online, r2.emailed], [false, true]);
  await wait(200);
  assert.ok(mails.some((m) => m.rcpt.includes('vera@example.com') && /Still here if you need us/.test(flatMail(m))));
  // Turned off: the bubble disappears.
  await j('/chat/settings', { api: true, method: 'PUT', json: { enabled: false } });
  assert.match((await j(`/chat/widget.js?k=${s.key}`)).body, /chat is off/);
  assert.strictEqual((await j(`/chat/${s.key}/start`, { method: 'POST', json: { name: 'X', text: 'y' } })).status, 404);
  await j('/chat/settings', { api: true, method: 'PUT', json: { enabled: true } });
});

test('products: save once, pick on invoices, and a Buy now link that makes a paid invoice', async () => {
  assert.strictEqual((await j('/products', { method: 'POST', json: { name: 'Gold sponsor', price: '' } })).status, 400);
  const p = (await j('/products', { method: 'POST', json: { name: 'Gold sponsor', price: '$1,250', description: 'Logo on the banner', max_qty: 3 } })).body;
  assert.deepStrictEqual([p.price, p.max_qty, p.active], [1250, 3, true]);
  assert.match(p.link, /^https:\/\/example\.test\/pay\//);
  const token = p.link.split('/pay/')[1];
  const page = (await j(`/pay/${token}`)).body;
  assert.match(page, /Gold sponsor/);
  assert.match(page, /not set up yet/, 'no Stripe yet');
  assert.strictEqual((await j(`/pay/${token}`, { form: { name: 'Bo', email: 'bo@example.com' } })).status, 400);
  await j('/invoices/settings', { method: 'PUT', json: { stripeKey: 'rk_test_goodkey1234567' } });
  assert.match((await j(`/pay/${token}`, { form: { name: 'Bo', email: 'nope' } })).body, /type your email/);
  const go = await j(`/pay/${token}`, { form: { name: 'Bo Banner', email: 'Bo@Example.com', qty: '2' } });
  assert.strictEqual(go.status, 303);
  assert.match(go.headers.get('location'), /^https:\/\/checkout\.test\/cs_/);
  const sid = go.headers.get('location').split('/').pop();
  assert.strictEqual(sessions.get(sid).amount, 250000);
  const allInv = (await j('/invoices')).body; const inv = allInv.invoices.find((i) => i.contact && i.contact.name === 'Bo Banner');
  assert.strictEqual(inv.total, 2500);
  assert.strictEqual(inv.contact.email, 'bo@example.com');
  sessions.get(sid).payment_status = 'paid';
  await require('../server/invoices').checkPending();
  assert.strictEqual((await j(`/invoices/${inv.id}`)).body.status, 'paid');
  assert.strictEqual((await j('/products')).body.products[0].sold, 2);
  // Hidden products stop selling.
  await j(`/products/${p.id}`, { method: 'PUT', json: { active: false } });
  assert.strictEqual((await j(`/pay/${token}`)).status, 404);
});

test('customer portal: private link shows their stuff, email sign-in never says who is a customer', async () => {
  const amy = await person('Amy Portal', 'amy@example.com');
  const inv = (await j('/invoices', { method: 'POST', json: { contact_id: amy.id, items: [{ what: 'Detailing', price: 99 }] } })).body;
  await j(`/invoices/${inv.id}/send`, { method: 'POST', json: { by: 'link' } });
  const draft = (await j('/invoices', { method: 'POST', json: { contact_id: amy.id, items: [{ what: 'Secret draft', price: 5 }] } })).body;
  assert.ok(draft.id);
  const link = (await j(`/portal/${amy.id}/link`, { api: true, method: 'POST', json: {} })).body.link;
  assert.match(link, /^https:\/\/example\.test\/portal\/[\w-]{20,}$/);
  const again = (await j(`/portal/${amy.id}/link`, { api: true, method: 'POST', json: {} })).body.link;
  assert.strictEqual(again, link, 'same link while it is fresh');
  const tok = link.split('/portal/')[1];
  const home = (await j(`/portal/${tok}`)).body;
  assert.match(home, /Hi Amy/);
  assert.match(home, /\$99\.00/);
  assert.match(home, /View and pay/);
  assert.doesNotMatch(home, /Secret draft|\$5\.00/);
  assert.strictEqual((await j('/portal/not-a-real-token')).status, 404);
  // Sign-in: same answer for a customer and a stranger. Only the customer gets an email.
  mails.length = 0;
  const a = (await j('/portal', { form: { email: 'AMY@example.com' } })).body;
  const b = (await j('/portal', { form: { email: 'stranger@example.com' } })).body;
  assert.match(a, /Check your email/); assert.match(b, /Check your email/);
  await wait(300);
  assert.deepStrictEqual(mails.map((m) => m.rcpt[0]), ['amy@example.com']);
  assert.ok(flatMail(mails[0]).includes('/portal/'));
  // Expired links stop working.
  require('../../src/db').prepare("UPDATE crm_portal_tokens SET expires_at='2020-01-01T00:00:00Z' WHERE token=?").run(tok);
  assert.match((await j(`/portal/${tok}`)).body, /expired/);
});

test('courses: lessons, free sign-up opens the members area, paid ones open after Stripe, progress', async () => {
  const c = (await j('/courses', { method: 'POST', json: { title: 'Car Care 101', price: 0, intro: 'Keep your car like new.' } })).body;
  assert.strictEqual(c.slug, 'car-care-101');
  const l1 = (await j(`/courses/${c.id}/lessons`, { method: 'POST', json: { title: 'Washing', video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', body: 'Use two buckets.' } })).body;
  const l2 = (await j(`/courses/${c.id}/lessons`, { method: 'POST', json: { title: 'Waxing', video_url: 'vimeo.com/123456789' } })).body;
  assert.strictEqual(l2.video_url, 'https://vimeo.com/123456789');
  const sales = (await j('/learn/car-care-101')).body;
  assert.match(sales, /Car Care 101/); assert.match(sales, /Washing/); assert.match(sales, /Free/);
  // A brand-new person goes straight in.
  const join = await j('/learn/car-care-101', { form: { name: 'Nina New', email: 'nina@example.com' } });
  assert.strictEqual(join.status, 303);
  const loc = join.headers.get('location');
  assert.match(loc, /^\.\.\/portal\/[\w-]+\?course=\d+$/);
  const tok = loc.split('/portal/')[1].split('?')[0];
  let pg = (await j(`/portal/${tok}?course=${c.id}`)).body;
  assert.match(pg, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  assert.match(pg, /0 of 2 lessons done/);
  const done = await j(`/portal/${tok}/done`, { form: { lesson: String(l1.id) } });
  assert.strictEqual(done.status, 303);
  assert.match(done.headers.get('location'), new RegExp(`lesson=${l2.id}`));
  pg = (await j(`/portal/${tok}?course=${c.id}&lesson=${l2.id}`)).body;
  assert.match(pg, /player\.vimeo\.com\/video\/123456789/);
  assert.match(pg, /1 of 2 lessons done/);
  assert.match((await j(`/portal/${tok}`)).body, /Car Care 101/);
  // Someone we already know gets the link by email only (nobody can open another person's account).
  await person('Known Kim', 'kim@example.com');
  mails.length = 0;
  const known = await j('/learn/car-care-101', { form: { name: 'Kim', email: 'kim@example.com' } });
  assert.strictEqual(known.status, 200);
  assert.match(known.body, /Check your email/);
  await wait(300);
  assert.ok(mails.some((m) => m.rcpt.includes('kim@example.com')));
  // Members list with progress.
  const full = (await j(`/courses/${c.id}`)).body;
  assert.deepStrictEqual(full.members.map((m) => [m.name, m.done]).sort(), [['Known Kim', 0], ['Nina New', 1]]);
  // A course they don't have is not shown.
  const paid = (await j('/courses', { method: 'POST', json: { title: 'Pro Detailing', price: 49 } })).body;
  await j(`/courses/${paid.id}/lessons`, { method: 'POST', json: { title: 'Clay bar' } });
  assert.strictEqual((await j(`/portal/${tok}?course=${paid.id}`)).status, 303);
  // Paid: Stripe first, then the course opens and the invoice page has a start button.
  const buy = await j(`/learn/${paid.slug}`, { form: { name: 'Nina New', email: 'nina@example.com' } });
  assert.strictEqual(buy.status, 303);
  const sid = buy.headers.get('location').split('/').pop();
  assert.strictEqual(sessions.get(sid).amount, 4900);
  assert.strictEqual((await j(`/portal/${tok}?course=${paid.id}`)).status, 303, 'not open before paying');
  sessions.get(sid).payment_status = 'paid';
  await require('../server/invoices').checkPending();
  await wait(100);
  assert.strictEqual((await j(`/portal/${tok}?course=${paid.id}`)).status, 200, 'open after paying');
  const inv = (await j('/invoices')).body.invoices.find((i) => i.total === 49);
  assert.match((await j(`/invoice/${inv.token}`)).body, /Start your course: Pro Detailing/);
  // Uploaded videos only play for members.
  const up = await fetch(`${root}/api/crm/courses/upload`, { method: 'POST', headers: { ...OWNER, 'Content-Type': 'video/mp4' }, body: Buffer.from('fake video') });
  const { file } = await up.json();
  assert.match(file, /^[a-f0-9]{16}\.mp4$/);
  await j(`/courses/${paid.id}/lessons`, { method: 'POST', json: { title: 'My video', video_file: file } });
  assert.strictEqual((await j(`/portal/${tok}/media/${file}`)).status, 200);
  const kimTok = (await j(`/portal/${full.members.find((m) => m.name === 'Known Kim').id}/link`, { api: true, method: 'POST', json: {} })).body.link.split('/portal/')[1];
  assert.strictEqual((await j(`/portal/${kimTok}/media/${file}`)).status, 404, 'Kim does not have this course');
  // Give and take access by hand.
  const kimId = full.members.find((m) => m.name === 'Known Kim').id;
  assert.strictEqual((await j(`/courses/${paid.id}/members`, { method: 'POST', json: { contact_id: kimId, email: false } })).body.fresh, true);
  assert.strictEqual((await j(`/portal/${kimTok}/media/${file}`)).status, 200);
  await j(`/courses/${paid.id}/members/${kimId}`, { method: 'DELETE' });
  assert.strictEqual((await j(`/portal/${kimTok}/media/${file}`)).status, 404);
});

test('public pages work through the internet tunnel and inside customer copies', async () => {
  const tunnel = { 'cf-connecting-ip': '1.2.3.4' };
  for (const p of ['/portal', '/learn/car-care-101']) assert.strictEqual((await fetch(root + p, { headers: tunnel })).status, 200, p);
  assert.match(fs.readFileSync(path.join(__dirname, '../../src/saas/gateway.js'), 'utf8'), /chat\|pay\|portal\|learn/);
});
