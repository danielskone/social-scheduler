// Monthly plans, checkout reminders, contracts to sign, and the blog.
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
  const pub = !opts.api && /^\/(chat|pay|portal|learn|invoice|s|subscribe|sign|blog)(\/|$)/.test(p);
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
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'billing-')), NTFY_BASE: `http://127.0.0.1:${ntfy.address().port}`, APP_PASSWORD: 'owner-pass-123',
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

const SIG = `data:image/png;base64,${'iVBORw0KGgo'.padEnd(800, 'A')}=`;

test('monthly plans: sign up, Stripe charges each month, payments become paid invoices, members cancel from their portal', async () => {
  await j('/invoices/settings', { method: 'PUT', json: { stripeKey: 'rk_test_goodkey1234567' } });
  const courseId = (await j('/courses', { method: 'POST', json: { title: 'Detailing basics', price: 0 } })).body.id;
  const bad = await j('/plans', { method: 'POST', json: { name: 'Nope', amount: '0' } });
  assert.equal(bad.status, 400);
  const plan = (await j('/plans', { method: 'POST', json: { name: 'Car care club', amount: '$29', every: 'month', description: 'Two washes a month', course_id: courseId } })).body;
  assert.equal(plan.amount, 29);
  assert.match(plan.link, /^https:\/\/example\.test\/subscribe\//);
  const token = plan.link.split('/subscribe/')[1];

  const page = await j(`/subscribe/${token}`);
  assert.equal(page.status, 200);
  assert.match(page.body, /Car care club/);
  assert.match(page.body, /a month/);
  assert.match(page.body, /Detailing basics/);

  const go = await form(`/subscribe/${token}`, { name: 'Maria Lopez', email: 'maria@example.com' });
  assert.equal(go.status, 303);
  assert.match(go.headers.get('location'), /^https:\/\/checkout\.test\/cs_/);
  const sess = sessions.get(go.headers.get('location').split('/').pop());
  assert.equal(sess.mode, 'subscription');
  assert.equal(sess.interval, 'month');
  assert.equal(sess.amount, 2900);

  // Not paid yet: the thank-you page waits.
  const subToken = sess.success_url.split('/subscribe/done/')[1].split('?')[0];
  assert.match((await j(`/subscribe/done/${subToken}`)).body, /Almost done/);
  // Stripe says paid.
  const renew = Math.floor(Date.now() / 1000) + 30 * 86400;
  subs.set('sub_1', { id: 'sub_1', status: 'active', cancel_at_period_end: false, current_period_end: renew });
  subInvoices.set('sub_1', [{ id: 'in_1', amount_paid: 2900 }]);
  Object.assign(sess, { status: 'complete', payment_status: 'paid', subscription: 'sub_1' });
  const done = await j(`/subscribe/done/${subToken}`);
  assert.match(done.body, /You are in/);
  assert.match(done.body, /portal\//);

  let list = (await j('/plans')).body;
  assert.equal(list.totals.members, 1);
  assert.equal(list.totals.monthly, 29);
  const sub = list.subscriptions[0];
  assert.equal(sub.status, 'active');
  assert.equal(sub.contact_name, 'Maria Lopez');
  const paid = () => j('/invoices').then((r) => r.body.invoices.filter((i) => i.status === 'paid' && /Car care club/.test(i.items[0].what)));
  assert.equal((await paid()).length, 1);
  // The course comes with the plan.
  const maria = (await j('/contacts')).body.find((c) => c.email === 'maria@example.com');
  const portalLink = (await j(`/portal/${maria.id}/link`, { method: 'POST', json: {}, api: true })).body.link;
  const portalPath = portalLink.replace('https://example.test', '');
  let portal = (await j(portalPath)).body;
  assert.match(portal, /Detailing basics/);
  assert.match(portal, /Your plans/);
  assert.match(portal, /Renews/);

  // Next month: a new payment. Checking twice never makes doubles.
  subInvoices.get('sub_1').unshift({ id: 'in_2', amount_paid: 2900 });
  await j('/plans/sync', { method: 'POST' });
  await j('/plans/sync', { method: 'POST' });
  assert.equal((await paid()).length, 2);

  // A failed card shows.
  subs.get('sub_1').status = 'past_due';
  await j('/plans/sync', { method: 'POST' });
  assert.equal((await j('/plans')).body.totals.pastDue, 1);
  subs.get('sub_1').status = 'active';

  // Maria cancels from her portal: it ends after the time she paid for.
  const cancel = await form(`${portalPath}/cancel`, { sub: String(sub.id) });
  assert.equal(cancel.status, 303);
  assert.ok(stripeLog.some((x) => x.method === 'POST' && x.url === '/v1/subscriptions/sub_1' && /cancel_at_period_end=true/.test(x.body)));
  list = (await j('/plans')).body;
  assert.equal(list.subscriptions[0].status, 'ending');
  portal = (await j(portalPath)).body;
  assert.match(portal, /Ends /);
  assert.doesNotMatch(portal, /Cancel plan/);
  // Someone else's plan id does nothing.
  const other = (await person('Other Person', 'other@example.com'));
  const otherLink = (await j(`/portal/${other.id}/link`, { method: 'POST', json: {}, api: true })).body.link.replace('https://example.test', '');
  const before = stripeLog.length;
  await form(`${otherLink}/cancel`, { sub: String(sub.id) });
  assert.equal(stripeLog.length, before);

  // Can't delete a plan people still pay for. The owner cancels right away; the course goes away.
  assert.equal((await j(`/plans/${plan.id}`, { method: 'DELETE' })).status, 400);
  await j(`/plans/subscriptions/${sub.id}/cancel`, { method: 'POST', json: { now: true } });
  assert.ok(stripeLog.some((x) => x.method === 'DELETE' && x.url === '/v1/subscriptions/sub_1'));
  list = (await j('/plans')).body;
  assert.equal(list.subscriptions[0].status, 'canceled');
  assert.equal(list.totals.members, 0);
  assert.doesNotMatch((await j(portalPath)).body, /Detailing basics/);
  assert.equal((await j(`/plans/${plan.id}`, { method: 'DELETE' })).status, 200);
});

test('checkout reminders: one friendly email to people who start paying and stop', async () => {
  const prod = (await j('/products', { method: 'POST', json: { name: 'Gold sponsorship', price: 500 } })).body;
  const ptoken = prod.link.split('/pay/')[1];
  const go = await form(`/pay/${ptoken}`, { name: 'Sam Rivers', email: 'sam@example.com', qty: '1' });
  assert.equal(go.status, 303);
  const checkouts = require('../server/checkouts');
  assert.equal((await j('/checkouts')).body.on, true);
  mails.length = 0;
  // Not yet: only after an hour.
  assert.equal(await checkouts.run(Date.now()), 0);
  assert.equal(await checkouts.run(Date.now() + 2 * 3600e3), 1);
  await wait(300);
  const m = mails.find((x) => x.rcpt.includes('sam@example.com'));
  assert.ok(m, 'reminder sent');
  assert.match(flatMail(m), /Gold sponsorship/);
  assert.match(flatMail(m), /https:\/\/example\.test\/invoice\//);
  // Only once.
  assert.equal(await checkouts.run(Date.now() + 3 * 3600e3), 0);
  assert.equal((await j('/checkouts')).body.reminded, 1);
  // Settings: off means no reminders; hours must be a choice.
  assert.equal((await j('/checkouts', { method: 'PUT', json: { hours: 5 } })).status, 400);
  const off = (await j('/checkouts', { method: 'PUT', json: { on: false, hours: 3 } })).body;
  assert.equal(off.on, false);
  assert.equal(off.hours, 3);
  await form(`/pay/${ptoken}`, { name: 'Lee Park', email: 'lee@example.com', qty: '1' });
  assert.equal(await checkouts.run(Date.now() + 5 * 3600e3), 0);
  await j('/checkouts', { method: 'PUT', json: { on: true, hours: 1 } });
});

test('contracts: ready-made words, the person signs on their phone, a signed copy, and it can no longer change', async () => {
  const tpls = (await j('/contracts/templates')).body;
  assert.ok(tpls.some((t) => t.key === 'photo'));
  const kim = await person('Kim Nguyen', 'kim@example.com');
  const k = (await j('/contracts', { method: 'POST', json: { contact_id: kim.id, template: 'photo' } })).body;
  assert.equal(k.title, 'Photo and video release');
  assert.equal(k.status, 'draft');
  assert.match(k.body, /\{name\}/);
  // A draft is not public.
  assert.equal((await j(`/sign/${k.token}`)).status, 404);

  mails.length = 0;
  const sent = (await j(`/contracts/${k.id}/send`, { method: 'POST', json: { by: 'email' } })).body;
  assert.equal(sent.status, 'sent');
  assert.match(sent.body, /I, Kim Nguyen, give/);
  await wait(300);
  const invite = mails.find((x) => x.rcpt.includes('kim@example.com'));
  assert.ok(invite);
  assert.match(flatMail(invite), /https:\/\/example\.test\/sign\//);

  const page = await j(`/sign/${k.token}`);
  assert.equal(page.status, 200);
  assert.match(page.body, /I, Kim Nguyen, give/);
  assert.match(page.body, /Sign the contract/);
  assert.ok((await j(`/contracts/${k.id}`)).body.viewed_at);

  // Missing pieces are refused.
  const noSig = await form(`/sign/${k.token}/sign`, { name: 'Kim Nguyen', agree: '1' });
  assert.equal(noSig.status, 303);
  assert.match(noSig.headers.get('location'), /error=/);
  const ok = await form(`/sign/${k.token}/sign`, { name: 'Kim Nguyen', agree: '1', signature: SIG });
  assert.match(ok.headers.get('location'), /signed=1/);
  const signed = (await j(`/contracts/${k.id}`)).body;
  assert.equal(signed.status, 'signed');
  assert.equal(signed.signed_name, 'Kim Nguyen');
  assert.match(signed.signed_hash, /^[0-9a-f]{64}$/);
  const after = (await j(`/sign/${k.token}`)).body;
  assert.match(after, /Signed by Kim Nguyen/);
  assert.doesNotMatch(after, /Sign the contract/);
  // Signing again, changing, or deleting a signed contract is refused.
  assert.match((await form(`/sign/${k.token}/sign`, { name: 'Someone Else', agree: '1', signature: SIG })).headers.get('location'), /error=/);
  assert.equal((await j(`/contracts/${k.id}`, { method: 'PUT', json: { body: 'New words that are long enough here.' } })).status, 400);
  assert.equal((await j(`/contracts/${k.id}`, { method: 'DELETE' })).status, 400);
  await wait(300);
  assert.ok(mails.some((x) => x.rcpt.includes('kim@example.com') && /Signed: Photo and video release/.test(x.body)));
  // Their portal lists it; the contact list filter works.
  assert.equal((await j(`/contracts?contact=${kim.id}`)).body.contracts.length, 1);
  const pl = (await j(`/portal/${kim.id}/link`, { method: 'POST', json: {}, api: true })).body.link.replace('https://example.test', '');
  assert.match((await j(pl)).body, /Photo and video release/);

  // Changing a sent contract puts it back to a draft; words with HTML are shown as text.
  const k2 = (await j('/contracts', { method: 'POST', json: { contact_id: kim.id, title: 'Custom', body: 'Plain words for {name}. <script>alert(1)</script>' } })).body;
  await j(`/contracts/${k2.id}/send`, { method: 'POST', json: { by: 'link' } });
  assert.doesNotMatch((await j(`/sign/${k2.token}`)).body, /<script>alert/);
  assert.equal((await j(`/contracts/${k2.id}`, { method: 'PUT', json: { body: 'Changed words for Kim, long enough.' } })).body.status, 'draft');
  await j(`/contracts/${k2.id}/send`, { method: 'POST', json: { by: 'link' } });
  assert.equal((await j(`/contracts/${k2.id}/status`, { method: 'POST', json: { status: 'void' } })).body.status, 'void');
  assert.match((await j(`/sign/${k2.token}`)).body, /cancelled/);
});

test('blog: drafts stay private, published posts get a page, a list, a feed and a website block', async () => {
  const p = (await j('/blog', { api: true, method: 'POST', json: { title: '5 ways to keep your car shiny', body: '## Wash often\nOnce a week is **best**.\n\n- Use soap\n- Dry it\n\nSee [our prices](https://example.com/prices).\n\n<script>alert(1)</script>' } })).body;
  assert.equal(p.slug, '5-ways-to-keep-your-car-shiny');
  assert.equal(p.published, false);
  assert.equal((await j(`/blog/${p.slug}`)).status, 404);
  assert.equal((await j('/blog', { api: true, method: 'POST', json: { title: 'Empty', body: 'Hi', published: true } })).status, 400);

  await j(`/blog/${p.id}`, { api: true, method: 'PUT', json: { published: true } });
  const page = await j(`/blog/${p.slug}`);
  assert.equal(page.status, 200);
  assert.match(page.body, /<h2>Wash often<\/h2>/);
  assert.match(page.body, /<b>best<\/b>/);
  assert.match(page.body, /<li>Use soap<\/li>/);
  assert.match(page.body, /href="https:\/\/example\.com\/prices"/);
  assert.doesNotMatch(page.body, /<script>alert/);
  assert.match(page.body, /og:title/);

  // /blog goes to /blog/ so the links inside work everywhere.
  const r = await j('/blog');
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), 'blog/');
  const index = (await j('/blog/')).body;
  assert.match(index, /5 ways to keep your car shiny/);
  assert.match(index, /href="5-ways-to-keep-your-car-shiny/);
  const feed = await j('/blog/feed.xml');
  assert.match(feed.headers.get('content-type'), /rss/);
  assert.match(feed.body, /<link>https:\/\/example\.test\/blog\/5-ways-to-keep-your-car-shiny<\/link>/);
  assert.equal((await j('/blog')).status, 301);
  assert.equal((await j(`/blog/${p.id}`, { api: true })).body.views, 1);
  // Same title again gets its own address.
  assert.equal((await j('/blog', { api: true, method: 'POST', json: { title: '5 ways to keep your car shiny' } })).body.slug, '5-ways-to-keep-your-car-shiny-2');

  // The "Latest blog posts" block on a website page.
  const site = (await j('/sites', { method: 'POST', json: { template: 'business' } })).body;
  const sections = [{ type: 'blog', heading: 'From the blog', count: '3' }];
  await j(`/sites/${site.id}`, { method: 'PUT', json: { sections, published: true } });
  const html = (await j(`/s/${site.slug}`)).body;
  assert.match(html, /From the blog/);
  assert.match(html, /href="\.\.\/blog\/5-ways-to-keep-your-car-shiny"/);
  assert.match(html, /See all posts/);
});

test('new public pages pass the tunnel; helpers cannot delete plans or posts', async () => {
  const cf = { 'cf-connecting-ip': '1.2.3.4' };
  assert.equal((await j('/blog/', { headers: cf })).status, 200);
  assert.notEqual((await j('/sign/nope', { headers: cf })).status, 404 + 1);
  assert.match((await j('/sign/nope', { headers: cf })).body, /not available/);
  assert.match((await j('/subscribe/nope', { headers: cf })).body, /not available/);
  const team = require('../server/team');
  const helper = { role: 'helper', businesses: [] };
  assert.equal(team.allowed(helper, { path: '/api/crm/plans/3', method: 'DELETE' }), false);
  assert.equal(team.allowed(helper, { path: '/api/crm/blog/3', method: 'DELETE' }), false);
  assert.equal(team.allowed(helper, { path: '/api/crm/checkouts', method: 'PUT' }), false);
  assert.equal(team.allowed(helper, { path: '/api/crm/contracts', method: 'POST' }), true);
});
