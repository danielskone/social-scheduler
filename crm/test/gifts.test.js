// Gift cards and loyalty points.
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
  const pub = !opts.api && /^\/(chat|pay|portal|learn|invoice|s|subscribe|sign|blog|gift)(\/|$)/.test(p);
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
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'gifts-')), NTFY_BASE: `http://127.0.0.1:${ntfy.address().port}`, APP_PASSWORD: 'owner-pass-123',
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


const inv = async (contact, price) => {
  const i = (await j('/invoices', { method: 'POST', json: { contact_id: contact.id, items: [{ what: 'Detail', qty: 1, price }] } })).body;
  await j(`/invoices/${i.id}/send`, { method: 'POST', json: { by: 'link' } });
  return (await j(`/invoices/${i.id}`)).body;
};

test('gift cards: buy one for someone, pay by card, they get the code and spend it across invoices', async () => {
  await j('/invoices/settings', { method: 'PUT', json: { stripeKey: 'rk_test_goodkey1234567' } });
  await j('/loyalty/settings', { method: 'PUT', json: { on: true, per_dollar: 2, reward_points: 100, reward_value: 10, welcome: 5 } });
  const page = await j('/gift');
  assert.equal(page.status, 200);
  assert.match(page.body, /Give a gift card/);
  assert.match(page.body, /\$50/);
  // Bad amount, missing recipient.
  assert.equal((await form('/gift', { amount: 'other', other: '3', name: 'Ann Lee', email: 'ann@example.com' })).status, 400);
  assert.equal((await form('/gift', { amount: '50', for: 'someone', name: 'Ann Lee', email: 'ann@example.com' })).status, 400);
  const go = await form('/gift', { amount: '50', for: 'someone', to_name: 'Bo Ray', to_email: 'bo@example.com', message: 'Happy birthday!', name: 'Ann Lee', email: 'ann@example.com' });
  assert.equal(go.status, 303);
  const sess = sessions.get(go.headers.get('location').split('/').pop());
  assert.equal(sess.amount, 5000);
  assert.equal((await j('/giftcards')).body.cards.length, 0); // waiting for payment
  Object.assign(sess, { status: 'complete', payment_status: 'paid' });
  const back = new URL(sess.success_url.replace('{CHECKOUT_SESSION_ID}', sess.id));
  await j(`${back.pathname}${back.search}`);
  await wait(300);
  const list = (await j('/giftcards')).body;
  assert.equal(list.cards.length, 1);
  const card = list.cards[0];
  assert.match(card.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(card.balance, 50);
  assert.equal(card.owner_name, 'Bo Ray');
  assert.equal(list.totals.sold, 50);
  const mail = mails.find((m) => m.rcpt.includes('bo@example.com'));
  assert.ok(mail, 'gift card emailed to Bo');
  assert.match(flatMail(mail), new RegExp(card.code));
  assert.match(flatMail(mail), /Ann Lee sent you/);
  // Buying a gift card earns no points (no going in circles).
  const ann = (await j('/contacts')).body.find((c) => c.email === 'ann@example.com');
  assert.equal((await j(`/loyalty/contacts/${ann.id}`)).body.points, 0);
  // The card page shows the balance.
  assert.match((await j(`/gift/card/${card.code}`)).body, /\$50\.00 left to spend/);

  // Bo spends $30 on one invoice: fully paid by the card.
  const bo = (await j('/contacts')).body.find((c) => c.email === 'bo@example.com');
  const i1 = await inv(bo, 30);
  assert.match((await j(`/invoice/${i1.token}`)).body, /Have a gift card/);
  assert.match((await form(`/invoice/${i1.token}/gift`, { code: 'nope-nope-nope' })).headers.get('location'), /error=/);
  const used1 = await form(`/invoice/${i1.token}/gift`, { code: card.code.toLowerCase().replace(/-/g, ' ') });
  assert.match(used1.headers.get('location'), /paid=1/);
  const p1 = (await j(`/invoices/${i1.id}`)).body;
  assert.equal(p1.status, 'paid');
  assert.equal(p1.paid_how, 'Gift card');
  // Then $45 on another: the card pays $20, $25 is left for Stripe.
  const i2 = await inv(bo, 45);
  await form(`/invoice/${i2.token}/gift`, { code: card.code });
  const p2 = (await j(`/invoices/${i2.id}`)).body;
  assert.equal(p2.gift_paid, 20);
  assert.equal(p2.due, 25);
  assert.match((await j(`/invoice/${i2.token}`)).body, /Left to pay/);
  const pay = await form(`/invoice/${i2.token}/pay`, {});
  const s2 = sessions.get(pay.headers.get('location').split('/').pop());
  assert.equal(s2.amount, 2500);
  assert.equal((await j(`/giftcards/${card.id}`)).body.balance, 0);
  assert.equal((await form(`/invoice/${i2.token}/gift`, { code: card.code })).headers.get('location').includes('nothing'), true);
  // Paying the rest by card earns points on the $25 only (2 per $1 + 5 welcome).
  Object.assign(s2, { status: 'complete', payment_status: 'paid' });
  const b2 = new URL(s2.success_url.replace('{CHECKOUT_SESSION_ID}', s2.id));
  await j(`${b2.pathname}${b2.search}`);
  assert.equal((await j(`/loyalty/contacts/${bo.id}`)).body.points, 55);

  // Cancelling an invoice puts gift card money back.
  const card2 = (await j('/giftcards', { method: 'POST', json: { contact_id: bo.id, amount: 15, send: false } })).body;
  assert.equal(card2.source, 'given');
  const i3 = await inv(bo, 100);
  await form(`/invoice/${i3.token}/gift`, { code: card2.code });
  assert.equal((await j(`/giftcards/${card2.id}`)).body.balance, 0);
  await j(`/invoices/${i3.id}/status`, { method: 'POST', json: { status: 'void' } });
  assert.equal((await j(`/giftcards/${card2.id}`)).body.balance, 15);
  // A cancelled card stops working.
  await j(`/giftcards/${card2.id}/void`, { method: 'POST' });
  const i4 = await inv(bo, 10);
  assert.match((await form(`/invoice/${i4.token}/gift`, { code: card2.code })).headers.get('location'), /error=/);
  assert.equal((await j(`/giftcards/lookup?code=${card.code}`)).body.id, card.id);
});

test('Buy now pages take a gift card code', async () => {
  const prod = (await j('/products', { method: 'POST', json: { name: 'Wash', price: 20 } })).body;
  const cust = await person('Cy Day', 'cy@example.com');
  const card = (await j('/giftcards', { method: 'POST', json: { contact_id: cust.id, amount: 25, send: false } })).body;
  const token = prod.link.split('/pay/')[1];
  assert.match((await j(`/pay/${token}`)).body, /Gift card code/);
  assert.equal((await form(`/pay/${token}`, { name: 'Cy Day', email: 'cy@example.com', gift: 'BADC-ODEB-ADCO' })).status, 400);
  const r = await form(`/pay/${token}`, { name: 'Cy Day', email: 'cy@example.com', gift: card.code });
  assert.equal(r.status, 303);
  assert.match(r.headers.get('location'), /invoice\/.+\?paid=1/);
  assert.equal((await j(`/giftcards/${card.id}`)).body.balance, 5);
});

test('loyalty points: earn, adjust by hand, turn into a gift card from the portal', async () => {
  const dee = await person('Dee Fox', 'dee@example.com');
  const i = await inv(dee, 60);
  await j(`/invoices/${i.id}/paid`, { method: 'POST', json: { how: 'Cash' } });
  assert.equal((await j(`/loyalty/contacts/${dee.id}`)).body.points, 125); // 5 welcome + 120
  assert.equal((await j(`/loyalty/contacts/${dee.id}`, { method: 'POST', json: { points: -500 } })).status, 400);
  await j(`/loyalty/contacts/${dee.id}`, { method: 'POST', json: { points: -20, note: 'Fix' } });
  const ov = (await j('/loyalty')).body;
  assert.equal(ov.people.find((p) => p.id === dee.id).points, 105);
  assert.ok(ov.people.find((p) => p.id === dee.id).ready);
  const link = (await j(`/portal/${dee.id}/link`, { method: 'POST', json: {}, api: true })).body.link;
  const path_ = new URL(link).pathname;
  const pp = await j(path_);
  assert.match(pp.body, /Your points/);
  assert.match(pp.body, /Get my \$10\.00 gift card/);
  const red = await form(`${path_}/redeem`, {});
  assert.match(red.headers.get('location'), /reward=1/);
  assert.equal((await j(`/loyalty/contacts/${dee.id}`)).body.points, 5);
  const after = await j(`${path_}?reward=1`);
  assert.match(after.body, /Your gift cards/);
  assert.match(after.body, /\$10\.00 left/);
  assert.match((await form(`${path_}/redeem`, {})).headers.get('location'), /rerr=/);
  assert.equal((await j('/giftcards')).body.cards.filter((c) => c.source === 'points').length, 1);
  // Settings check their numbers.
  assert.equal((await j('/loyalty/settings', { method: 'PUT', json: { reward_points: 2 } })).status, 400);
  assert.equal((await j('/giftcards/settings', { method: 'PUT', json: { amounts: 'abc' } })).status, 400);
});
