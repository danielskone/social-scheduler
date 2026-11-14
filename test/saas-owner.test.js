// The owner's login on the sign-up site opens the owner's real Viral Post and CRM (the Mac's own
// data), runs no background work there (nothing posts twice), and customers still get their own copy.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const real = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-real-'));
execFileSync(process.execPath, ['-e', `
  const db = require('./src/db'); require('./src/server');
  const a = db.prepare("INSERT INTO accounts (platform, external_id, name, access_token) VALUES ('facebook','P1','Parade','t')").run().lastInsertRowid;
  const id = db.prepare('INSERT INTO posts (caption, scheduled_at) VALUES (?,?)').run('REAL PARADE POST', new Date(Date.now() - 6e4).toISOString()).lastInsertRowid;
  db.prepare('INSERT INTO post_targets (post_id, account_id) VALUES (?,?)').run(id, a);
  db.prepare("INSERT INTO contacts (name, email, group_name, stage) VALUES ('Real Person','real@x.com','Parade sponsor','New')").run();
  process.exit(0);`], { cwd: root, env: { ...process.env, DATA_DIR: real, APP: '', TENANT_KEY: '' }, stdio: 'ignore' });

let gw, srv, base;
test.before(async () => {
  const { createGateway } = require('../src/saas/gateway');
  const env = { DATA_DIR: real, SAAS_ADMIN_EMAIL: 'boss@example.com', SAAS_SIGNUPS: 'open', SAAS_TENANT_PORT: '4960', NTFY_BASE: 'http://127.0.0.1:9', PATH: process.env.PATH, HOME: process.env.HOME };
  srv = require('http').createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  gw = createGateway({ env: { ...env, SAAS_PUBLIC_URL: base }, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'owner-gw-')), log: () => {} });
  srv.on('request', gw.app);
});
test.after(async () => { gw.tenants.stopAll(); srv.close(); await new Promise((r) => setTimeout(r, 500)); });

const signup = async (email) => {
  const r = await fetch(`${base}/signup`, { method: 'POST', redirect: 'manual', headers: { Origin: base, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ name: 'X', email, password: 'a-long-pass-123', terms: '1' }) });
  return { Cookie: r.headers.get('set-cookie').split(';')[0], Origin: base };
};
const get = async (h, p) => {
  for (let i = 0; i < 60; i++) { const r = await fetch(base + p, { headers: h }); if (r.status !== 502) return r.json(); await new Promise((x) => setTimeout(x, 250)); }
  throw new Error('copy did not start');
};

test('the boss sees the real posts and CRM; customers do not; nothing posts twice', async () => {
  const boss = await signup('boss@example.com');
  assert.ok(JSON.stringify(await get(boss, '/api/posts?from=2026-01-01&to=2030-01-01')).includes('REAL PARADE POST'));
  assert.ok(JSON.stringify(await get(boss, '/api/crm/contacts?lite=1')).includes('Real Person'));
  assert.strictEqual((await get(boss, '/api/tutorial')).saas, false, 'no first-time tour in the real copy');
  const cust = await signup('cust@example.com');
  assert.ok(!JSON.stringify(await get(cust, '/api/posts?from=2026-01-01&to=2030-01-01')).includes('REAL PARADE POST'));
  await new Promise((r) => setTimeout(r, 2500));
  const db = require('better-sqlite3')(path.join(real, 'scheduler.db'), { readonly: true });
  assert.strictEqual(db.prepare('SELECT status FROM post_targets').get().status, 'scheduled', 'the owner copy must not publish');
  db.close();
});
