// Funnels, coupons, referral partners and the course community.
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
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'growth-')), NTFY_BASE: `http://127.0.0.1:${ntfy.address().port}`, APP_PASSWORD: 'owner-pass-123',
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

test('funnels: ready-made pages in order, #next buttons and forms lead to the next step, visit counts', async () => {
  await j('/invoices/settings', { method: 'PUT', json: { stripeKey: 'rk_test_goodkey1234567' } });
  const prod = (await j('/products', { method: 'POST', json: { name: 'Starter kit', price: 100 } })).body;
  const f = (await j('/funnels', { method: 'POST', json: { name: 'Spring sale', template: 'sale' } })).body;
  assert.strictEqual(f.steps.length, 2);
  const [offer, thanks] = f.steps;
  const offerHtml = (await j(`/s/${offer.slug}`)).body;
  assert.match(offerHtml, new RegExp(`\\.\\./pay/${prod.link.split('/pay/')[1]}`), 'the Buy block links to the product');
  assert.match(offerHtml, /\$100\.00/);
  const leads = (await j('/funnels', { method: 'POST', json: { name: 'Free guide', template: 'leads' } })).body;
  const p1 = (await j(`/s/${leads.steps[0].slug}`)).body;
  assert.match(p1, new RegExp(`vtf-done[\\s\\S]*\\.\\./s/${leads.steps[1].slug}`), 'after the form, go to step 2');
  // Step 2 is last: #next has nowhere to go until a step is added.
  assert.match((await j(`/s/${leads.steps[1].slug}`)).body, /href="#">See how/);
  const more = (await j(`/funnels/${leads.id}/steps`, { api: true, method: 'POST', json: {} })).body;
  assert.strictEqual(more.steps.length, 3);
  assert.match((await j(`/s/${leads.steps[1].slug}`)).body, new RegExp(`href="\\.\\./s/${more.steps[2].slug}">See how`));
  // A page can only be in one funnel.
  assert.strictEqual((await j(`/funnels/${f.id}/steps`, { api: true, method: 'POST', json: { site_id: leads.steps[0].site_id } })).status, 400);
  // Reorder and visit counts.
  const flipped = (await j(`/funnels/${leads.id}/order`, { api: true, method: 'POST', json: { ids: [more.steps[1].id, more.steps[0].id, more.steps[2].id] } })).body;
  assert.deepStrictEqual(flipped.steps.map((s) => s.site_id), [more.steps[1].site_id, more.steps[0].site_id, more.steps[2].site_id]);
  const again = (await j(`/funnels/${leads.id}`, { api: true })).body;
  assert.ok(again.steps[0].views >= 1);
  // The form's thank-you tells the page to move on.
  assert.match(fs.readFileSync(path.join(__dirname, '../server/forms.js'), 'utf8'), /postMessage\('vtf-done'/);
  // Deleting the funnel keeps its pages.
  await j(`/funnels/${f.id}`, { api: true, method: 'DELETE' });
  assert.strictEqual((await j(`/s/${offer.slug}`)).status, 200);
});

test('coupons: percent and dollar off, limits, end dates, and free after a coupon', async () => {
  const prod = (await j('/products', { method: 'POST', json: { name: 'Window tint', price: 200 } })).body;
  const token = prod.link.split('/pay/')[1];
  assert.doesNotMatch((await j(`/pay/${token}`)).body, /Coupon code/, 'no field until a coupon exists');
  assert.strictEqual((await j('/coupons', { method: 'POST', json: { code: 'x', value: 10 } })).status, 400);
  const c = (await j('/coupons', { method: 'POST', json: { code: 'save20', value: 20, kind: 'percent', max_uses: 2 } })).body;
  assert.deepStrictEqual([c.code, c.label, c.state], ['SAVE20', '20% off', 'live']);
  assert.match((await j(`/pay/${token}`)).body, /Coupon code/);
  const bad = await form(`/pay/${token}`, { name: 'Cal', email: 'cal@example.com', coupon: 'NOPE' });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.body, /not valid/);
  const ok = await form(`/pay/${token}`, { name: 'Cal', email: 'cal@example.com', coupon: 'save20' });
  assert.strictEqual(ok.status, 303);
  assert.strictEqual(sessions.get(ok.headers.get('location').split('/').pop()).amount, 16000);
  await form(`/pay/${token}`, { name: 'Dee', email: 'dee@example.com', coupon: 'SAVE20' });
  const used = (await j('/coupons')).body.coupons.find((x) => x.code === 'SAVE20');
  assert.deepStrictEqual([used.uses, used.state], [2, 'used up']);
  assert.strictEqual((await form(`/pay/${token}`, { name: 'Eve', email: 'eve@example.com', coupon: 'SAVE20' })).status, 400);
  // $ off and courses only.
  await j('/coupons', { method: 'POST', json: { code: 'TEN', value: 10, kind: 'amount', applies: 'courses' } });
  assert.strictEqual((await form(`/pay/${token}`, { name: 'Eve', email: 'eve@example.com', coupon: 'TEN' })).status, 400, 'courses only');
  // Ended yesterday.
  await j('/coupons', { method: 'POST', json: { code: 'OLD', value: 50, ends_on: '2020-01-01' } });
  assert.strictEqual((await form(`/pay/${token}`, { name: 'Eve', email: 'eve@example.com', coupon: 'OLD' })).status, 400);
  // 100% off: no card needed, the invoice is paid.
  await j('/coupons', { method: 'POST', json: { code: 'FREEBIE', value: 100 } });
  const free = await form(`/pay/${token}`, { name: 'Fay', email: 'fay@example.com', coupon: 'FREEBIE' });
  assert.match(free.headers.get('location'), /^\.\.\/invoice\/[\w-]+\?paid=1$/);
  const inv = (await j('/invoices')).body.invoices.find((i) => i.contact && i.contact.email === 'fay@example.com');
  assert.deepStrictEqual([inv.status, inv.paid_how, inv.total], ['paid', 'Coupon', 0]);
  // A course with the $10 code.
  const course = (await j('/courses', { method: 'POST', json: { title: 'Tint 101', price: 30 } })).body;
  assert.match((await j(`/learn/${course.slug}`)).body, /Coupon code/);
  const buy = await form(`/learn/${course.slug}`, { name: 'Gus', email: 'gus@example.com', coupon: 'ten' });
  assert.strictEqual(sessions.get(buy.headers.get('location').split('/').pop()).amount, 2000);
});

test('referral partners: link remembers who sent them, sales earn a percent, partner sees it in the portal', async () => {
  const pat = await person('Pat Partner', 'pat@example.com');
  const site = (await j('/sites', { method: 'POST', json: { template: 'business' } })).body;
  await j(`/sites/${site.id}`, { method: 'PUT', json: { published: true, slug: 'shop' } });
  assert.strictEqual((await j('/referrals/settings', { api: true, method: 'PUT', json: { landing: '/nope' } })).status, 400);
  await j('/referrals/settings', { method: 'PUT', json: { landing: '/s/shop', percent: 15 } });
  const p = (await j('/referrals', { method: 'POST', json: { contact_id: pat.id } })).body;
  assert.deepStrictEqual([p.code, p.percent], ['PAT', 15]);
  assert.strictEqual(p.link, 'https://example.test/s/shop?ref=PAT');
  // A visitor opens the link: we remember the partner in a cookie.
  const visit = await j('/s/shop?ref=PAT');
  const cookie = visit.headers.get('set-cookie');
  assert.match(cookie, /vt_ref=PAT/);
  const jar = { Cookie: cookie.split(';')[0] };
  // They buy with that cookie.
  const prod = (await j('/products', { method: 'POST', json: { name: 'Ceramic coat', price: 400 } })).body;
  const go = await form(`/pay/${prod.link.split('/pay/')[1]}`, { name: 'Quinn Buyer', email: 'quinn@example.com' }, jar);
  const sid = go.headers.get('location').split('/').pop();
  let list = (await j('/referrals')).body.partners;
  assert.deepStrictEqual([list[0].clicks, list[0].people, list[0].sales], [1, 1, 0]);
  sessions.get(sid).payment_status = 'paid';
  await require('../server/invoices').checkPending();
  list = (await j('/referrals')).body.partners;
  assert.deepStrictEqual([list[0].sales, list[0].sold, list[0].owed], [1, 400, 60]);
  // The partner can't earn from themself.
  require('../server/referrals').attach({ id: pat.id }, 'PAT');
  // Their portal shows the link and what they earned.
  const tok = (await j(`/portal/${pat.id}/link`, { api: true, method: 'POST', json: {} })).body.link.split('/portal/')[1];
  const home = (await j(`/portal/${tok}`)).body;
  assert.match(home, /Share and earn/); assert.match(home, /s\/shop\?ref=PAT/); assert.match(home, /\$60\.00/);
  // You pay them.
  const paid = (await j(`/referrals/${p.id}/paid`, { method: 'POST' })).body;
  assert.deepStrictEqual([paid.owed, paid.paid], [0, 60]);
  // Form sign-ups are connected too.
  const formDef = (await j('/forms', { method: 'POST', json: { title: 'Interest', active: 1, fields: [{ type: 'name', label: 'Name', required: true }, { type: 'email', label: 'Email', required: true }] } })).body;
  const fresh = await fetch(`${root}/f/${formDef.slug}?ref=PAT`);
  const c2 = fresh.headers.get('set-cookie').split(';')[0];
  const fields = formDef.fields;
  const fd = new FormData(); fd.set(fields[0].id, 'Rae Lead'); fd.set(fields[1].id, 'rae@example.com');
  const sub = await fetch(`${root}/f/${formDef.slug}`, { method: 'POST', body: fd, headers: { Cookie: c2 } });
  assert.strictEqual(sub.status, 200);
  assert.strictEqual((await j('/referrals')).body.partners[0].people, 2);
});

test('community: members post and comment in the portal, you reply, pin and remove', async () => {
  const course = (await j('/courses', { method: 'POST', json: { title: 'Club', price: 0 } })).body;
  const ann = await person('Ann Member', 'ann@example.com');
  const bob = await person('Bob Outsider', 'bob@example.com');
  await j(`/courses/${course.id}/members`, { method: 'POST', json: { contact_id: ann.id, email: false } });
  const link = async (id) => (await j(`/portal/${id}/link`, { api: true, method: 'POST', json: {} })).body.link.split('/portal/')[1];
  const at = await link(ann.id), bt = await link(bob.id);
  const page = (await j(`/portal/${at}?course=${course.id}&tab=talk`)).body;
  assert.match(page, /Share a question or a win/);
  const posted = await form(`/portal/${at}/post`, { course: String(course.id), body: 'Hi all! Excited to start.' });
  assert.strictEqual(posted.status, 303);
  await form(`/portal/${bt}/post`, { course: String(course.id), body: 'Sneaky post' });
  let posts = (await j(`/community/${course.id}`, { api: true })).body.posts;
  assert.deepStrictEqual(posts.map((p) => p.body), ['Hi all! Excited to start.'], 'non-members cannot post');
  await form(`/portal/${at}/comment`, { course: String(course.id), post: String(posts[0].id), body: 'Me too' });
  posts = (await j(`/community/posts/${posts[0].id}/comments`, { api: true, method: 'POST', json: { body: 'Welcome Ann!' } })).body.posts;
  assert.deepStrictEqual(posts[0].comments.map((c) => [c.name || 'you', c.body]), [['Ann Member', 'Me too'], ['you', 'Welcome Ann!']]);
  posts = (await j(`/community/${course.id}`, { api: true, method: 'POST', json: { body: 'Live call Friday at noon' } })).body.posts;
  posts = (await j(`/community/posts/${posts.find((p) => !p.contact_id).id}`, { api: true, method: 'PUT', json: { pinned: true } })).body.posts;
  assert.strictEqual(posts[0].body, 'Live call Friday at noon', 'pinned goes first');
  const view = (await j(`/portal/${at}?course=${course.id}&tab=talk`)).body;
  assert.match(view, /Live call Friday/); assert.match(view, /Pinned/); assert.match(view, /Me too/);
  assert.doesNotMatch(view, /<script>alert/);
  // Ann deletes her own post; she can't delete yours.
  await form(`/portal/${at}/unpost`, { course: String(course.id), post: String(posts[0].id) });
  await form(`/portal/${at}/unpost`, { course: String(course.id), post: String(posts[1].id) });
  posts = (await j(`/community/${course.id}`, { api: true })).body.posts;
  assert.deepStrictEqual(posts.map((p) => p.body), ['Live call Friday at noon']);
});
