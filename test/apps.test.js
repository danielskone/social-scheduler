// Viral Post, Viral Touch CRM, Viral Clips and Viral Ads Studio are separate apps in one install.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const apps = require('../src/apps');

test('APPS picks which apps are on; Viral Post is always on', () => {
  const keys = (env) => apps.enabledApps(env).map((a) => a.key);
  assert.deepStrictEqual(keys({}), ['scheduler', 'crm', 'clips', 'ads']);
  assert.deepStrictEqual(keys({ APPS: 'all' }), ['scheduler', 'crm', 'clips', 'ads']);
  assert.deepStrictEqual(keys({ APPS: 'scheduler' }), ['scheduler']);
  assert.deepStrictEqual(keys({ APPS: 'crm, ads' }), ['scheduler', 'crm', 'ads']);
  // every page of the old single app belongs to exactly one app
  const views = apps.APPS.flatMap((a) => a.views);
  assert.strictEqual(new Set(views).size, views.length);
  for (const v of ['calendar', 'compose', 'analytics', 'accounts', 'contacts', 'clips', 'ads']) assert.ok(views.includes(v), v);
});

test('each app manifest has its own name, address and icon', () => {
  const m = apps.manifest(apps.byKey('crm'));
  assert.strictEqual(m.name, 'Viral Touch CRM');
  assert.strictEqual(m.start_url, '/crm/#contacts');
  assert.strictEqual(m.scope, '/crm/');
  for (const a of apps.APPS) {
    for (const i of apps.manifest(a).icons) assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', i.src)), i.src);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', apps.touchIcon(a))));
  }
});

// Runs the real server in its own process so APPS can differ between runs.
async function withServer(env, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apps-'));
  const port = 4600 + Math.floor(Math.random() * 300);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1', APP_PASSWORD: '', META_APP_ID: '', ...env },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 100; i++) {
      try { await fetch(`${base}/login.html`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    await fn(base);
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('each app opens at its own address with its own name and icon', async () => {
  await withServer({}, async (base) => {
    const home = await (await fetch(`${base}/`)).text();
    assert.match(home, /<title>Viral Post<\/title>/);
    assert.match(home, /data-app="scheduler"/);
    assert.match(home, /href="\/manifest\.webmanifest"/);

    const crm = await (await fetch(`${base}/crm/`)).text();
    assert.match(crm, /<title>Viral Touch CRM<\/title>/);
    assert.match(crm, /data-app="crm"/);
    assert.match(crm, /href="\/manifest-crm\.webmanifest"/);
    assert.match(crm, /href="\/icons\/crm-touch\.png"/);
    assert.match(crm, /<span class="app-name">Viral Touch CRM<\/span>/);
    const info = JSON.parse(crm.match(/window\.VP_APPS = (.*?);<\/script>/)[1]);
    assert.strictEqual(info.app, 'crm');
    assert.deepStrictEqual(info.apps.map((a) => a.key), ['scheduler', 'crm', 'clips', 'ads']);

    assert.match(await (await fetch(`${base}/clips/`)).text(), /<title>Viral Clips<\/title>/);
    assert.match(await (await fetch(`${base}/ads/`)).text(), /<title>Viral Ads Studio<\/title>/);

    const noSlash = await fetch(`${base}/crm`, { redirect: 'manual' });
    assert.strictEqual(noSlash.status, 302);
    assert.strictEqual(noSlash.headers.get('location'), '/crm/');

    const man = await (await fetch(`${base}/manifest-ads.webmanifest`)).json();
    assert.strictEqual(man.name, 'Viral Ads Studio');
    assert.strictEqual(man.start_url, '/ads/#ads');

    // all apps still share the same data
    assert.strictEqual((await fetch(`${base}/api/crm/meta`)).status, 200);
    assert.strictEqual((await fetch(`${base}/api/clips`)).status, 200);
  });
});

test('Viral Post can run on its own (APPS=scheduler)', async () => {
  await withServer({ APPS: 'scheduler' }, async (base) => {
    const home = await (await fetch(`${base}/`)).text();
    const info = JSON.parse(home.match(/window\.VP_APPS = (.*?);<\/script>/)[1]);
    assert.deepStrictEqual(info.apps.map((a) => a.key), ['scheduler']);
    const crm = await fetch(`${base}/crm/`, { redirect: 'manual' });
    assert.strictEqual(crm.status, 302);
    assert.strictEqual(crm.headers.get('location'), '/');
    assert.strictEqual((await fetch(`${base}/api/crm/meta`)).status, 404);
    assert.strictEqual((await fetch(`${base}/api/clips`)).status, 404);
    assert.strictEqual((await fetch(`${base}/api/ads/brands`)).status, 404);
    assert.strictEqual((await fetch(`${base}/api/posts`)).status, 200);
  });
});
