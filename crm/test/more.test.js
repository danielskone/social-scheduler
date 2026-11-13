// Custom fields, review requests, invoices (with a fake Stripe) and team logins.
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Fake mail server (just enough SMTP for nodemailer).
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
// Fake Stripe: checks the key, makes checkout sessions, and reports them paid once "paid" is set.
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

let base, server, root;
const OWNER = { Authorization: `Basic ${Buffer.from(':owner-pass-123').toString('base64')}` };
const j = async (p, opts = {}) => {
  // Signed in as the owner unless a test passes its own cookie (or the request is a public page).
  if (!opts.headers || !opts.headers.Cookie) opts.headers = { ...OWNER, ...(opts.headers || {}) };
  if (opts.json) { opts.body = JSON.stringify(opts.json); opts.headers = { ...(opts.headers || {}), 'Content-Type': 'application/json' }; delete opts.json; }
  const r = await fetch((p.startsWith('/api') || p.startsWith('/invoice/') || p.startsWith('/r/') || p.startsWith('/login') || p.startsWith('/crm') ? root : base) + p, { redirect: 'manual', ...opts });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body, headers: r.headers };
};
test.before(async () => {
  for (const s of [smtp, stripe, ntfy]) await new Promise((r) => s.listen(0, '127.0.0.1', r));
  Object.assign(process.env, {
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'more-')), NTFY_BASE: `http://127.0.0.1:${ntfy.address().port}`, APP_PASSWORD: 'owner-pass-123',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port), SMTP_PASS: 'x', IMAP_HOST: 'imap.test',
    EMAIL_FROM: 'daniel@viralattraction.com', EMAIL_FROM_NAME: 'Daniel King', EMAIL_MAILING_ADDRESS: 'PO Box 1, Fuquay-Varina, NC 27526',
    STRIPE_API_BASE: `http://127.0.0.1:${stripe.address().port}`, PUBLIC_BASE_URL: 'https://example.test',
  });
  const app = require('../../src/server');
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  root = `http://127.0.0.1:${server.address().port}`;
  base = `${root}/api/crm`;
});
test.after(() => { for (const s of [smtp, stripe, ntfy, server]) s.close(); });

test('custom fields: a business adds its own boxes, answers are checked and fill in messages', async () => {
  const bizes = (await j('/businesses')).body;
  const car = bizes.find((b) => b.groups.includes('Auto customer'));
  const model = (await j(`/fields?biz=${car.id}`, { method: 'POST', json: { label: 'Car model', type: 'text' } })).body;
  const size = (await j('/fields', { method: 'POST', json: { label: 'Shirt size', type: 'choice', options: 'S\nM\nL' } })).body;
  assert.strictEqual(model.business_id, car.id);
  assert.strictEqual(size.business_id, null);
  assert.strictEqual((await j('/fields', { method: 'POST', json: { label: 'Bad', type: 'choice', options: 'Only' } })).status, 400);
  const parade = bizes.find((b) => b.groups.includes('Parade sponsor'));
  assert.deepStrictEqual((await j(`/meta?biz=${parade.id}`)).body.fields.map((f) => f.label), ['Shirt size']);
  assert.deepStrictEqual((await j(`/meta?biz=${car.id}`)).body.fields.map((f) => f.label), ['Car model', 'Shirt size']);
  const c = (await j('/contacts', { method: 'POST', json: { name: 'Sam Lee', group_name: 'Auto customer', custom: { [model.key]: 'Civic', [size.key]: 'M' } } })).body;
  assert.deepStrictEqual(c.custom, { [model.key]: 'Civic', [size.key]: 'M' });
  assert.strictEqual((await j(`/contacts/${c.id}`, { method: 'PUT', json: { name: 'Sam Lee', custom: { [size.key]: 'XXL' } } })).status, 400);
  // Saving the card without the box keeps the old answer; an empty answer clears it.
  const u = (await j(`/contacts/${c.id}`, { method: 'PUT', json: { name: 'Sam Lee', notes: 'hi' } })).body;
  assert.strictEqual(u.custom[model.key], 'Civic');
  const crm = require('../server/crm');
  assert.strictEqual(crm.fillTemplate('Hi {first_name}, how is the {Car model}?', crm.getContact(c.id)), 'Hi Sam, how is the Civic?');
});

test('review requests: needs a review link, emails a tracked link, and counts the click', async () => {
  const bizes = (await j('/businesses')).body;
  const parade = bizes.find((b) => b.groups.includes('Parade sponsor'));
  const amy = (await j('/contacts', { method: 'POST', json: { name: 'Amy Wu', email: 'amy@x.com', phone: '919-555-0100', group_name: 'Parade sponsor', stage: 'Paid / Done' } })).body;
  assert.match((await j(`/reviews/contact/${amy.id}`, { method: 'POST', json: { channel: 'email' } })).body.error, /review link/);
  await j(`/businesses/${parade.id}`, { method: 'PUT', json: { ...parade, review_url: 'g.page/r/parade/review' } });
  assert.ok((await j('/reviews')).body.suggest.some((s) => s.name === 'Amy Wu'), 'won people are suggested');
  const r = (await j(`/reviews/contact/${amy.id}`, { method: 'POST', json: { channel: 'email' } })).body;
  assert.match(r.link, /^https:\/\/example\.test\/r\//);
  assert.deepStrictEqual(mails.at(-1).rcpt, ['amy@x.com']);
  assert.match(mails.at(-1).body.replace(/=\r?\n/g, ''), /Fuquay-Varina Christmas Parade/);
  // Asking again soon is blocked; a text opens Messages.
  assert.strictEqual((await j(`/reviews/contact/${amy.id}`, { method: 'POST', json: { channel: 'text' } })).status, 400);
  const t = (await j(`/reviews/contact/${amy.id}`, { method: 'POST', json: { channel: 'text', force: true } })).body;
  assert.match(t.sms, /^sms:9195550100&body=/);
  const click = await j(`/r/${r.link.split('/r/')[1]}`);
  assert.strictEqual(click.status, 302);
  assert.strictEqual(click.headers.get('location'), 'https://g.page/r/parade/review');
  const o = (await j('/reviews')).body;
  assert.deepStrictEqual([o.totals.sent, o.totals.opened], [2, 1]);
});

test('invoices: make, email, pay online with your own Stripe, and it marks itself paid', async () => {
  const amy = (await j('/contacts?q=amy')).body[0];
  assert.strictEqual((await j('/invoices', { method: 'POST', json: { contact_id: amy.id, items: [] } })).status, 400);
  const inv = (await j('/invoices', { method: 'POST', json: { contact_id: amy.id, items: [{ what: 'Gold sponsorship', qty: 1, price: '$500' }, { what: 'Banner', qty: 2, price: 25 }], tax_rate: 5 } })).body;
  assert.deepStrictEqual([inv.subtotal, inv.tax, inv.total, inv.number, inv.status], [550, 27.5, 577.5, 1001, 'draft']);
  assert.strictEqual((await j(`/invoice/${inv.token}`)).status, 404, 'drafts are private');
  // Without Stripe: no card button, but the "other ways to pay" note shows.
  await j('/invoices/settings', { method: 'PUT', json: { payNote: 'Zelle: pay@parade.org' } });
  const sent = (await j(`/invoices/${inv.id}/send`, { method: 'POST', json: { by: 'email' } })).body;
  assert.strictEqual(sent.status, 'sent');
  assert.match(mails.at(-1).body.replace(/=\r?\n/g, ''), /\/invoice\//);
  let pageHtml = (await j(`/invoice/${inv.token}`)).body;
  assert.match(pageHtml, /Zelle: pay@parade\.org/);
  assert.doesNotMatch(pageHtml, /with card/);
  // A wrong key is refused; the right one is saved and shown masked.
  assert.strictEqual((await j('/invoices/settings', { method: 'PUT', json: { stripeKey: 'rk_test_wrongkey12345' } })).status, 400);
  const st = (await j('/invoices/settings', { method: 'PUT', json: { stripeKey: 'rk_test_goodkey1234567' } })).body;
  assert.deepStrictEqual([st.stripe, st.stripeAccount, st.stripeKey.includes('goodkey')], [true, 'Parade Co', false]);
  pageHtml = (await j(`/invoice/${inv.token}`)).body;
  assert.match(pageHtml, /Pay \$577\.50 with card/);
  const pay = await j(`/invoice/${inv.token}/pay`, { method: 'POST' });
  assert.strictEqual(pay.status, 303);
  assert.match(pay.headers.get('location'), /^https:\/\/checkout\.test\/cs_1/);
  assert.strictEqual(sessions.get('cs_1').amount, 57750);
  assert.strictEqual(await require('../server/invoices').checkPending(), 0, 'not paid yet');
  sessions.get('cs_1').payment_status = 'paid';
  const back = (await j(`/invoice/${inv.token}?paid=1&session=cs_1`)).body;
  assert.match(back, /Your payment went through/);
  const after = (await j(`/invoices/${inv.id}`)).body;
  assert.deepStrictEqual([after.status, after.paid_how], ['paid', 'Card (Stripe)']);
  const list = (await j('/invoices')).body;
  assert.strictEqual(list.totals.paid30, 577.5);
  assert.strictEqual((await j(`/invoices/${inv.id}/status`, { method: 'POST', json: { status: 'void' } })).status, 400, 'paid invoices are not cancelled');
  // Cash: mark paid by hand.
  const two = (await j('/invoices', { method: 'POST', json: { contact_id: amy.id, items: [{ what: 'Booth', price: 40 }] } })).body;
  assert.strictEqual((await j(`/invoices/${two.id}/paid`, { method: 'POST', json: { how: 'Cash' } })).body.status, 'paid');
});

test('team logins: a helper signs in with email, only reaches the CRM, and can be limited to one business', async () => {
  const pw = { Authorization: `Basic ${Buffer.from(':owner-pass-123').toString('base64')}` };
  const bizes = (await j('/api/crm/businesses', { headers: pw })).body;
  const parade = bizes.find((b) => b.groups.includes('Parade sponsor'));
  assert.strictEqual((await j('/api/crm/team', { method: 'POST', headers: pw, json: { name: 'Pat', email: 'pat@x.com', password: 'short' } })).status, 400);
  const pat = (await j('/api/crm/team', { method: 'POST', headers: pw, json: { name: 'Pat', email: 'Pat@X.com', password: 'helper-pass-1', businesses: [parade.id] } })).body;
  assert.strictEqual(pat.email, 'pat@x.com');
  assert.ok(!('password_hash' in pat));
  const bad = await j('/login', { method: 'POST', body: new URLSearchParams({ email: 'pat@x.com', password: 'nope-nope' }) });
  assert.match(bad.headers.get('location'), /error=wrong&team=1/);
  const ok = await j('/login', { method: 'POST', body: new URLSearchParams({ email: 'pat@x.com', password: 'helper-pass-1' }) });
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^vp_team=/);
  const as = { Cookie: cookie };
  assert.strictEqual((await j('/api/crm/me', { headers: as })).body.name, 'Pat');
  // CRM yes; Viral Post's own data no.
  assert.strictEqual((await j('/api/crm/contacts', { headers: as })).status, 200);
  assert.strictEqual((await j('/api/accounts', { headers: as })).status, 401);
  // Limited to the parade: asking for everything still shows only parade people.
  const names = (await j('/api/crm/contacts', { headers: as })).body.map((c) => c.name);
  assert.deepStrictEqual(names, ['Amy Wu']);
  // Helpers can't change the team or payment settings, or delete people.
  assert.strictEqual((await j('/api/crm/team', { headers: as })).status, 403);
  assert.strictEqual((await j('/api/crm/lists/bulk/delete', { method: 'POST', headers: as, json: { ids: [1], confirm: 'DELETE' } })).status, 403);
  assert.strictEqual((await j('/api/crm/invoices/settings', { method: 'PUT', headers: as, json: { payNote: 'x' } })).status, 403);
  const amy = (await j('/api/crm/contacts', { headers: as })).body[0];
  assert.strictEqual((await j(`/api/crm/contacts/${amy.id}`, { method: 'DELETE', headers: as })).status, 403);
  // Changing their password signs them out.
  await j(`/api/crm/team/${pat.id}`, { method: 'PUT', headers: pw, json: { password: 'brand-new-pass' } });
  assert.strictEqual((await j('/api/crm/contacts', { headers: as })).status, 401);
});
