// The sellable version: sign-up, sign-in, each customer's own private copy, trials and Stripe.
// Starts real customer copies of the app, so it checks that customers can't see each other.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createGateway } = require('../src/saas/gateway');
const { createBilling } = require('../src/saas/billing');
const { access } = require('../src/saas/store');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-saas-'));
let g, server, base;
const basePort = 20000 + Math.floor(Math.random() * 20000);

test.before(async () => {
  server = http.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  g = createGateway({
    dir, publicUrl: base,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, SAAS_ADMIN_EMAIL: 'owner@example.com', SAAS_SIGNUP_LIMIT: '100', SAAS_TENANT_PORT: String(basePort), STRIPE_WEBHOOK_SECRET: 'whsec_test', META_APP_ID: 'shared-app', SMTP_PASS: 'owner-secret' },
    log: () => {},
  });
  server.on('request', g.app);
});
test.after(() => { g.tenants.stopAll(); server.close(); });

// A tiny browser: remembers the sign-in cookie.
function browser() {
  let cookie = '';
  return async (p, { method = 'GET', form, json, headers = {} } = {}) => {
    const h = { ...headers, Accept: headers.Accept || (json || method !== 'GET' ? 'application/json' : 'text/html') };
    if (cookie) h.Cookie = cookie;
    let body;
    if (form) { body = new URLSearchParams(form).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; }
    if (json) { body = JSON.stringify(json); h['Content-Type'] = 'application/json'; }
    const res = await fetch(base + p, { method, headers: h, body, redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set) { const m = set.match(/vps=([^;]*)/); if (m) cookie = m[1] ? `vps=${m[1]}` : ''; }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, location: res.headers.get('location'), data, text };
  };
}

const signup = (b, email, password = 'correct-horse-1') => b('/signup', { method: 'POST', form: { name: email.split('@')[0], email, password, terms: '1' } });

test('visitors who are not signed in see the welcome page, never the app', async () => {
  const b = browser();
  const home = await b('/');
  assert.strictEqual(home.status, 302);
  assert.strictEqual(home.location, '/welcome');
  assert.match((await b('/welcome')).text, /Start free trial/);
  assert.strictEqual((await b('/api/accounts', { json: undefined, headers: { Accept: 'application/json' } })).status, 401);
  // Pretending to be signed in with the internal header does nothing.
  assert.strictEqual((await b('/api/accounts', { headers: { Accept: 'application/json', 'x-vp-user': '1', 'x-vp-tenant-key': 'guess' } })).status, 401);
});

test('sign up rejects bad input and duplicate emails', async () => {
  const b = browser();
  let r = await b('/signup', { method: 'POST', form: { name: 'x', email: 'not-an-email', password: 'long-enough-1', terms: '1' } });
  assert.strictEqual(r.status, 400); assert.match(r.text, /real email/);
  r = await b('/signup', { method: 'POST', form: { name: 'x', email: 'x@example.com', password: 'short', terms: '1' } });
  assert.match(r.text, /at least 8/);
  r = await b('/signup', { method: 'POST', form: { name: 'x', email: 'x@example.com', password: 'long-enough-1' } });
  assert.match(r.text, /agree to the Terms/);
  // A form posted from another website is refused.
  r = await b('/signup', { method: 'POST', form: { name: 'x', email: 'x@example.com', password: 'long-enough-1', terms: '1' }, headers: { Origin: 'https://evil.example' } });
  assert.strictEqual(r.status, 403);
});

test('each customer gets a private copy: their own contacts, no Daniel starters, no owner secrets', { timeout: 60000 }, async () => {
  const alice = browser(), bob = browser();
  assert.strictEqual((await signup(alice, 'alice@example.com')).location, '/');
  assert.strictEqual((await signup(bob, 'bob@example.com')).location, '/');
  assert.strictEqual((await signup(browser(), 'ALICE@example.com')).status, 400, 'same email, different case');

  const page = await alice('/');
  assert.strictEqual(page.status, 200);
  assert.match(page.text, /Viral Touch CRM/);

  const added = await alice('/api/crm/contacts', { method: 'POST', json: { name: 'Alice Customer One', email: 'one@alice.test' } });
  assert.strictEqual(added.status, 200, added.text);
  assert.ok((await alice('/api/crm/contacts')).data.some((c) => c.name === 'Alice Customer One'));
  assert.ok(!(await bob('/api/crm/contacts')).data.some((c) => c.name === 'Alice Customer One'), 'Bob must not see Alice\'s contacts');

  // Customers start clean: none of the parade / Viral Attraction forms, emails or booking page.
  assert.deepStrictEqual((await bob('/api/crm/forms')).data, []);
  assert.deepStrictEqual((await bob('/api/crm/booking/pages')).data.pages, []);

  const status = (await alice('/api/status')).data;
  assert.strictEqual(status.saas, true);
  assert.strictEqual(status.publicBaseUrl, `${base}/w/${g.store.getUserByEmail('alice@example.com').id}`);
  assert.strictEqual(status.redirectUri, `${base}/auth/facebook/callback`);
  assert.strictEqual(status.metaConfigured, false, 'only META_APP_ID shared here (no secret), so not configured');

  // Separate folders on disk.
  const a = g.store.getUserByEmail('alice@example.com'), b = g.store.getUserByEmail('bob@example.com');
  assert.ok(fs.existsSync(path.join(dir, 'tenants', String(a.id), 'scheduler.db')));
  assert.ok(fs.existsSync(path.join(dir, 'tenants', String(b.id), 'scheduler.db')));

});

test('copies only answer requests that come through the gateway with their key', { timeout: 30000 }, async () => {
  const a = g.store.getUserByEmail('alice@example.com');
  await g.tenants.start(a.id);
  const direct = (headers = {}) => fetch(`http://127.0.0.1:${basePort + a.id}/api/crm/contacts`, { headers });
  assert.strictEqual((await direct()).status, 404);
  assert.strictEqual((await direct({ 'x-vp-user': '1' })).status, 404);
  assert.strictEqual((await direct({ 'x-vp-user': '1', 'x-vp-tenant-key': 'wrong' })).status, 404);
});

test('public forms of a customer work under /w/<id>/ without signing in', { timeout: 30000 }, async () => {
  const alice = browser();
  await alice('/login', { method: 'POST', form: { email: 'alice@example.com', password: 'correct-horse-1' } });
  const tpl = (await alice('/api/crm/forms/template/contact')).data;
  const saved = await alice('/api/crm/forms', { method: 'POST', json: tpl });
  assert.strictEqual(saved.status, 200, saved.text);
  const id = g.store.getUserByEmail('alice@example.com').id;
  assert.ok(saved.data.url.startsWith(`${base}/w/${id}/f/`), saved.data.url);
  const visitor = browser();
  const pub = await visitor(saved.data.url.slice(base.length));
  assert.strictEqual(pub.status, 200);
  assert.match(pub.text, /<form/);
  // Only public pages are reachable that way, never the app's data.
  assert.strictEqual((await visitor(`/w/${id}/api/crm/contacts`)).status, 404);
  // An unknown customer number is just "not found".
  assert.strictEqual((await visitor('/w/99999/f/abc')).status, 404);
});

test('sign in, wrong password, sign out', async () => {
  const b = browser();
  assert.strictEqual((await b('/login', { method: 'POST', form: { email: 'bob@example.com', password: 'nope-nope-nope' } })).status, 401);
  const ok = await b('/login', { method: 'POST', form: { email: 'Bob@Example.com', password: 'correct-horse-1' } });
  assert.strictEqual(ok.location, '/');
  assert.strictEqual((await b('/account')).status, 200);
  await b('/logout');
  assert.strictEqual((await b('/account')).location, '/login');
});

test('owner page: only the owner sees customers and can make a reset link', async () => {
  const owner = browser();
  await signup(owner, 'owner@example.com', 'owner-password-1');
  const o = g.store.getUserByEmail('owner@example.com');
  assert.strictEqual(o.role, 'admin');
  assert.strictEqual(o.status, 'free');
  const list = await owner('/admin');
  assert.match(list.text, /alice@example\.com/);
  const alice = browser();
  await alice('/login', { method: 'POST', form: { email: 'alice@example.com', password: 'correct-horse-1' } });
  assert.strictEqual((await alice('/admin')).status, 404);

  const a = g.store.getUserByEmail('alice@example.com');
  const r = await owner(`/admin/users/${a.id}`, { method: 'POST', form: { action: 'reset' } });
  const token = r.text.match(/invite\?token=([\w-]+)/)[1];
  const reset = await browser()('/reset', { method: 'POST', form: { token, password: 'brand-new-pass-2' } });
  assert.strictEqual(reset.location, '/login?reset=1');
  // Old sessions were signed out; the new password works; the link can't be reused.
  assert.strictEqual((await alice('/account')).location, '/login');
  assert.strictEqual((await browser()('/login', { method: 'POST', form: { email: 'alice@example.com', password: 'brand-new-pass-2' } })).location, '/');
  assert.strictEqual((await browser()('/reset', { method: 'POST', form: { token, password: 'again-again-3' } })).status, 400);
});

test('when the trial ends the app closes until they pay; owner can give free access', { timeout: 30000 }, async () => {
  const bob = browser();
  await bob('/login', { method: 'POST', form: { email: 'bob@example.com', password: 'correct-horse-1' } });
  const b = g.store.getUserByEmail('bob@example.com');
  g.store.update(b.id, { trial_ends_at: new Date(Date.now() - 1000).toISOString() });
  assert.strictEqual((await bob('/')).location, '/account');
  assert.strictEqual((await bob('/api/crm/contacts', { headers: { Accept: 'application/json' } })).status, 402);
  assert.match((await bob('/account')).text, /trial has ended/);
  // His public pages stop too.
  assert.strictEqual((await browser()(`/w/${b.id}/f/whatever`)).status, 404);

  const owner = browser();
  await owner('/login', { method: 'POST', form: { email: 'owner@example.com', password: 'owner-password-1' } });
  await owner(`/admin/users/${b.id}`, { method: 'POST', form: { action: 'free' } });
  assert.strictEqual((await bob('/api/crm/contacts', { headers: { Accept: 'application/json' } })).status, 200);
});

test('email settings are saved in the customer\'s own folder and never leak the owner\'s', { timeout: 30000 }, async () => {
  const bob = browser();
  await bob('/login', { method: 'POST', form: { email: 'bob@example.com', password: 'correct-horse-1' } });
  const r = await bob('/account/email', { method: 'POST', form: { EMAIL_FROM: 'bob@bobshop.test', EMAIL_FROM_NAME: 'Bob\'s Shop', EMAIL_MAILING_ADDRESS: 'PO Box 1, Town', SMTP_HOST: 'smtp.bobshop.test', SMTP_PORT: '465', SMTP_USER: 'bob@bobshop.test', SMTP_PASS: 'p"w', IMAP_HOST: '', BOOKING_TIMEZONE: 'America/Chicago' } });
  assert.match(r.text, /Email settings saved/);
  const b = g.store.getUserByEmail('bob@example.com');
  const saved = g.tenants.readSettings(b.id);
  assert.strictEqual(saved.SMTP_PASS, 'p"w');
  assert.strictEqual(saved.EMAIL_FROM_NAME, "Bob's Shop");
  // Empty password field keeps the saved one; the page never shows it.
  const again = await bob('/account/email', { method: 'POST', form: { EMAIL_FROM: 'bob@bobshop.test', SMTP_PASS: '' } });
  assert.ok(!again.text.includes('p&quot;w'));
  assert.strictEqual(g.tenants.readSettings(b.id).SMTP_PASS, 'p"w');
  assert.match((await bob('/account/email', { method: 'POST', form: { SMTP_PORT: 'abc' } })).text, /should be a number/);
});

test('Stripe: signed webhooks switch plans on and off; forged ones are refused', async () => {
  const billing = createBilling({ secretKey: 'sk_test', priceId: 'price_1', webhookSecret: 'whsec_test' });
  const c = g.store.getUserByEmail('alice@example.com');
  const sign = (payload, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', 'whsec_test').update(`${t}.${payload}`).digest('hex')}`;
  const send = (obj, sig) => fetch(`${base}/stripe/webhook`, { method: 'POST', body: JSON.stringify(obj), headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig ?? sign(JSON.stringify(obj)) } });

  const paid = { type: 'checkout.session.completed', data: { object: { client_reference_id: String(c.id), customer: 'cus_A', subscription: 'sub_A' } } };
  assert.strictEqual((await send(paid, 't=1,v1=bad')).status, 400);
  assert.strictEqual((await send(paid)).status, 200);
  let u = g.store.getUser(c.id);
  assert.strictEqual(u.status, 'active');
  assert.strictEqual(u.stripe_customer_id, 'cus_A');

  await send({ type: 'customer.subscription.updated', data: { object: { id: 'sub_A', customer: 'cus_A', status: 'past_due', items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) }] } } } });
  u = g.store.getUser(c.id);
  assert.strictEqual(u.status, 'past_due');
  assert.ok(access(u).ok, 'a few days of grace while Stripe retries the card');

  await send({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_A', customer: 'cus_A', status: 'canceled' } } });
  assert.strictEqual(g.store.getUser(c.id).status, 'canceled');
  assert.ok(!access(g.store.getUser(c.id)).ok);

  assert.throws(() => billing.verifyWebhook('{}', sign('{}', Math.floor(Date.now() / 1000) - 3600)), /too old/);
});

test('Stripe checkout sends people to Stripe\'s own page', async () => {
  let seen;
  const fake = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { seen = { path: req.url, body: new URLSearchParams(b), auth: req.headers.authorization }; res.end(JSON.stringify({ url: 'https://checkout.stripe.test/s/1' })); }); });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const billing = createBilling({ secretKey: 'sk_test_1', priceId: 'price_9', apiBase: `http://127.0.0.1:${fake.address().port}` });
  const url = await billing.checkoutUrl({ id: 7, email: 'z@example.com' }, 'https://app.example');
  assert.strictEqual(seen.body.get('subscription_data[trial_end]'), null, 'no trial: pay now');
  // During a free trial, the first payment waits until the trial ends.
  const ends = new Date(Date.now() + 60 * 864e5).toISOString();
  await billing.checkoutUrl({ id: 8, email: 't@example.com', status: 'trialing', trial_ends_at: ends }, 'https://app.example');
  assert.strictEqual(seen.body.get('subscription_data[trial_end]'), String(Math.floor(Date.parse(ends) / 1000)));
  await billing.checkoutUrl({ id: 7, email: 'z@example.com' }, 'https://app.example');
  fake.close();
  assert.strictEqual(url, 'https://checkout.stripe.test/s/1');
  assert.strictEqual(seen.path, '/v1/checkout/sessions');
  assert.strictEqual(seen.auth, 'Bearer sk_test_1');
  assert.strictEqual(seen.body.get('line_items[0][price]'), 'price_9');
  assert.strictEqual(seen.body.get('client_reference_id'), '7');
  assert.strictEqual(seen.body.get('success_url'), 'https://app.example/account?paid=1');
});
