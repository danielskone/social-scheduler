// Beta test mode (npm run beta): invite only, the owner makes each tester's login, testers
// pick a password from their link and get their own private, empty copy of the app.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createGateway } = require('../src/saas/gateway');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-beta-'));
let g, server, base;
const basePort = 20000 + Math.floor(Math.random() * 20000);

test.before(async () => {
  server = http.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  g = createGateway({
    dir, publicUrl: base,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, SAAS_BETA: '1', SAAS_ADMIN_EMAIL: 'daniel@example.com', SAAS_TENANT_PORT: String(basePort), META_APP_ID: 'a', META_APP_SECRET: 'b', GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'g', TIKTOK_CLIENT_KEY: 'tiktokkey', TIKTOK_CLIENT_SECRET: 't' },
    log: () => {},
  });
  server.on('request', g.app);
});
test.after(() => { g.tenants.stopAll(); server.close(); });

function browser() {
  let cookie = '';
  return async (p, { method = 'GET', form, headers = {} } = {}) => {
    const h = { Accept: method === 'GET' ? 'text/html' : 'application/json', ...headers };
    if (cookie) h.Cookie = cookie;
    let body;
    if (form) { body = new URLSearchParams(form).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; }
    const res = await fetch(base + p, { method, headers: h, body, redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set) { const m = set.match(/vps=([^;]*)/); if (m) cookie = m[1] ? `vps=${m[1]}` : ''; }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, location: res.headers.get('location'), data, text };
  };
}

const owner = browser();

test('beta is invite only: no public sign-up, only the owner can make the first account', async () => {
  const v = browser();
  assert.match((await v('/welcome')).text, /invite only/);
  assert.doesNotMatch((await v('/welcome')).text, /Start free trial/);
  assert.match((await v('/signup')).text, /Sign-ups are closed/);
  assert.strictEqual((await v('/signup', { method: 'POST', form: { name: 's', email: 'stranger@example.com', password: 'long-enough-1', terms: '1' } })).status, 403);
  // Even with the owner link, only the owner email works.
  assert.match((await v('/signup?owner=1')).text, /owner account/);
  assert.strictEqual((await v('/signup', { method: 'POST', form: { owner: '1', name: 's', email: 'stranger@example.com', password: 'long-enough-1', terms: '1' } })).status, 400);
  const r = await owner('/signup', { method: 'POST', form: { owner: '1', name: 'Daniel', email: 'daniel@example.com', password: 'owner-pass-123', terms: '1' } });
  assert.strictEqual(r.location, '/');
  assert.strictEqual(g.store.getUserByEmail('daniel@example.com').role, 'admin');
  // Once the owner exists, the owner link is closed too.
  assert.match((await browser()('/signup?owner=1')).text, /Sign-ups are closed/);
});

test('owner adds a tester; tester sets a password from the link and gets a private, free copy', { timeout: 60000 }, async () => {
  const made = await owner('/admin/invite', { method: 'POST', form: { name: 'Tess Tester', email: 'tess@example.com' } });
  assert.strictEqual(made.status, 200, made.text);
  assert.match(made.text, /tess@example\.com can now sign in/);
  const token = made.text.match(/invite\?token=([\w-]+)/)[1];
  assert.strictEqual((await owner('/admin/invite', { method: 'POST', form: { email: 'tess@example.com' } })).status, 400, 'no duplicates');
  // Nobody can sign in before they pick a password.
  assert.strictEqual((await browser()('/login', { method: 'POST', form: { email: 'tess@example.com', password: '' } })).status, 401);

  const tess = browser();
  assert.match((await tess(`/invite?token=${token}`)).text, /Welcome, Tess/);
  assert.match((await tess('/invite', { method: 'POST', form: { token, password: 'tess-pass-123' } })).text, /agree to the Terms/);
  const done = await tess('/invite', { method: 'POST', form: { token, password: 'tess-pass-123', terms: '1' } });
  assert.strictEqual(done.location, '/');
  const t = g.store.getUserByEmail('tess@example.com');
  assert.strictEqual(t.status, 'free');
  assert.ok(t.accepted_terms_at);
  assert.strictEqual((await tess('/')).status, 200);
  // The link works only once.
  assert.strictEqual((await browser()(`/invite?token=${token}`)).status, 400);
  assert.strictEqual((await browser()('/login', { method: 'POST', form: { email: 'tess@example.com', password: 'tess-pass-123' } })).location, '/');

  // YouTube and TikTok stay off for testers until switched on; Facebook is shared.
  const status = (await tess('/api/status', { headers: { Accept: 'application/json' } })).data;
  assert.strictEqual(status.metaConfigured, true);
  assert.strictEqual(status.youtubeConfigured, false);
  assert.strictEqual(status.tiktokConfigured, false);
  assert.ok(fs.existsSync(path.join(dir, 'tenants', String(t.id), 'scheduler.db')));
  // Testers can't see the tester list.
  assert.strictEqual((await tess('/admin')).status, 404);
  assert.strictEqual((await tess('/admin/invite', { method: 'POST', form: { email: 'x@example.com' } })).status, 404);
});
