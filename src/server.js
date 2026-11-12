const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const config = require('./config');
const db = require('./db');
const meta = require('./meta');
const youtube = require('./youtube');
const tiktok = require('./tiktok');
const scheduler = require('./scheduler');
const { importBundle } = require('./importer');
const crm = require('./crm');
const forms = require('./forms');
const booking = require('./booking');
const website = require('./website');
const automations = require('./automations');
const campaigns = require('./campaigns');
const gcal = require('./gcal');
const clipper = require('./clipper');
const ads = require('./ads');
const compression = require('compression');
const { thumbFor } = require('./thumbs');
const apps = require('./apps');

const app = express();
const appsOn = apps.enabledApps();
const appsOnKeys = new Set(appsOn.map((a) => a.key));
// On the Mac each app is its own program (APP=crm ...) on its own port; see src/apps.js.
const ownApp = apps.own();
// Customer copy behind the sign-up gateway (src/saas/): only the gateway may talk to it, and
// the gateway marks which requests come from a signed-in customer.
const fromGateway = (req) => Boolean(config.tenantKey) && same(req.headers['x-vp-tenant-key'] || '', config.tenantKey);
if (config.tenantKey) {
  app.use((req, res, next) => (fromGateway(req) ? next() : res.status(404).send('Not found')));
}
app.use(express.json());
// Private app: ask search engines never to list it.
app.use((req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });

// The Cloudflare tunnel exists only so Instagram can download media. Anything else that
// arrives through it (it adds a cf-connecting-ip header) is refused, so the dashboard is
// never reachable from the open internet. Phones reach it over home Wi-Fi or Tailscale.
// The CRM's public sign-up forms (/f/...) and booking pages (/book/...) are the other exceptions: they are meant to be shared.
const viaTunnel = (req) => Boolean(req.headers['cf-connecting-ip']);
app.use((req, res, next) => {
  if (viaTunnel(req) && !req.path.startsWith('/media/') && !req.path.startsWith('/f/') && !req.path.startsWith('/book/')) return res.status(404).send('Not found');
  next();
});

// Media must stay public (no password) so Instagram can download it when publishing.
// File names never change, so phones may keep them for a month.
app.use('/media', express.static(config.mediaDir, { fallthrough: false, maxAge: '30d', immutable: true }));

// Pages and data are squeezed before they're sent, which matters a lot on cellular.
app.use(compression({ filter: (req, res) => !req.path.startsWith('/thumb/') && compression.filter(req, res) }));

// Public sign-up forms from the Contacts tab. No password, so anyone with the link can fill one in.
app.use('/f', forms.publicForms);
app.use('/book', booking.publicBooking);

// ---------- Password protection ----------
// On this Mac (localhost) the password is optional. From a phone or any other device a
// password is required. Phones sign in once on /login and stay signed in (cookie).
const PUBLIC_FILES = new Set(['/login', '/login.html', '/manifest.webmanifest', '/style.css', '/sw.js', ...apps.APPS.map((a) => `/manifest-${a.key}.webmanifest`)]);
const isLocal = (req) => !viaTunnel(req) && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const loginToken = () => crypto.createHmac('sha256', config.appPassword).update('viral-post-login').digest('hex');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function cookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : '';
}
function signedIn(req) {
  if (config.tenantKey) return fromGateway(req) && req.headers['x-vp-user'] === '1';
  if (!config.appPassword) return isLocal(req);
  if (cookie(req, 'vp_login') && same(cookie(req, 'vp_login'), loginToken())) return true;
  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const pass = Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':');
    return same(pass, config.appPassword);
  }
  return false;
}

const failed = new Map(); // ip -> { n, until }
app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  const ip = req.socket.remoteAddress;
  const f = failed.get(ip) || { n: 0, until: 0 };
  const next = apps.APPS.some((a) => a.path !== '/' && a.path === req.body.next) ? `&next=${encodeURIComponent(req.body.next)}` : '';
  if (f.until > Date.now()) return res.redirect(`/login.html?error=wait${next}`);
  if (config.appPassword && same(req.body.password || '', config.appPassword)) {
    failed.delete(ip);
    res.set('Set-Cookie', `vp_login=${loginToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 365}`);
    if (ownApp) return res.redirect(`/#${ownApp.home}`);
    const back = apps.APPS.find((a) => a.path === req.body.next);
    return res.redirect(back ? `${back.path}#${back.home}` : '/#calendar');
  }
  f.n += 1;
  if (f.n >= 5) { f.n = 0; f.until = Date.now() + 15 * 60 * 1000; }
  failed.set(ip, f);
  res.redirect(`/login.html?error=wrong${next}`);
});

app.use((req, res, next) => {
  if (PUBLIC_FILES.has(req.path) || req.path.startsWith('/icons/') || signedIn(req)) return next();
  if (config.tenantKey) return res.status(401).json({ error: 'Please sign in again.' });
  if (!config.appPassword) {
    return res.status(403).send('<meta name="viewport" content="width=device-width, initial-scale=1"><p style="font:18px system-ui;padding:20px">To open Viral Post on your phone, first set a password on your Mac. In Terminal run: <b>npm run password</b></p>');
  }
  if (req.method === 'GET' && (req.headers.accept || '').includes('text/html')) {
    const from = apps.APPS.find((a) => a.path !== '/' && (req.path === a.path || req.path + '/' === a.path));
    return res.redirect(from ? `/login.html?next=${encodeURIComponent(from.path)}` : '/login.html');
  }
  res.status(401).json({ error: 'Please sign in again.' });
});

// An app that is switched off (APPS in .env) is closed: its pages and data can't be reached (nothing is deleted).
for (const a of apps.APPS) {
  if (appsOnKeys.has(a.key)) continue;
  for (const p of a.apis || []) app.use(p, (req, res) => res.status(404).json({ error: `${a.name} is not part of this plan.` }));
}

// Small previews for the calendar (see thumbs.js).
app.get('/thumb/:file', async (req, res) => {
  const file = await thumbFor(req.params.file);
  if (!file) return res.status(404).end();
  res.sendFile(file, { maxAge: '30d', immutable: true });
});

// Finished clips from the Clips tab (only for signed-in users).
app.get('/clipfile/:job/:file', clipper.serveFile);
// Finished ads and the Ads Studio library (photos, videos, logos, music).
app.get('/adfile/:id/:file', ads.serveAdFile);
app.get('/adlib/:file', ads.serveLibFile);

// The free face finder (Google's MediaPipe) that runs in the browser for talking photos.
app.use('/vendor/face', express.static(path.join(__dirname, '..', 'node_modules', '@mediapipe', 'tasks-vision'), { maxAge: '7d' }));
// The app's own files: the page names each file with a fingerprint of its contents
// (app.js?v=1a2b3c), so the browser and phone keep them and don't ask the Mac again on every
// open. After an update the fingerprint changes, so the new version still loads right away.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const fingerprints = new Map();
function fingerprint(file) {
  if (!fingerprints.has(file)) {
    let v = '0';
    try { v = crypto.createHash('sha1').update(fs.readFileSync(path.join(PUBLIC_DIR, file))).digest('hex').slice(0, 10); } catch { /* missing file */ }
    fingerprints.set(file, v);
  }
  return fingerprints.get(file);
}
// Each app (Viral Post, Viral Touch CRM, Viral Clips, Viral Ads Studio) has its own address,
// name, icon and menu. They share one page file; the server fills in which app it is.
let indexHtml = null;
const appPages = new Map();
function appPage(a) {
  if (!indexHtml || process.env.NODE_ENV === 'development') {
    fingerprints.clear();
    appPages.clear();
    indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
      .replace(/(src|href)="\/([\w.-]+\.(?:js|css))"/g, (m, attr, file) => `${attr}="/${file}?v=${fingerprint(file)}"`);
  }
  if (!appPages.has(a.key)) {
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    const icon = a.icon === 'icon' ? '/icons/icon-192.png' : `/icons/${a.icon}-192.png`;
    const info = JSON.stringify({ app: a.key, apps: apps.publicInfo(appsOn, Boolean(ownApp)) }).replace(/</g, '\\u003c');
    appPages.set(a.key, indexHtml
      .replace('<title>Viral Post</title>', `<title>${esc(a.name)}</title>`)
      .replace('content="Viral Post">', `content="${esc(a.short)}">`)
      .replace('href="/manifest.webmanifest"', `href="${a.key === 'scheduler' ? '/manifest.webmanifest' : `/manifest-${a.key}.webmanifest`}"`)
      .replace('href="/icons/apple-touch-icon.png"', `href="${apps.touchIcon(a)}"`)
      .replace(/src="\/icons\/icon-192\.png"/g, `src="${icon}"`)
      .replace(/<span class="app-name">Viral Post<\/span>/g, `<span class="app-name">${esc(a.name)}</span>`)
      .replace('<body>', `<body data-app="${a.key}">\n  <script>window.VP_APPS = ${info};</script>`));
  }
  return appPages.get(a.key);
}
const otherAppUrl = (req, a) => `${req.protocol}://${req.hostname}:${apps.portOf(a)}/`;
for (const a of apps.APPS) {
  const paths = a.path === '/' ? ['/', '/index.html'] : [a.path, a.path.slice(0, -1)];
  if (ownApp) {
    // This program is one app: its page is at '/'. Old links to another app go to that app's program.
    if (a.path === '/') continue;
    app.get(paths, (req, res) => res.redirect(a.key !== ownApp.key && appsOnKeys.has(a.key) ? otherAppUrl(req, a) : '/'));
    continue;
  }
  app.get(paths, (req, res) => {
    if (!appsOnKeys.has(a.key)) return res.redirect('/');
    if (a.path !== '/' && req.path === a.path.slice(0, -1)) return res.redirect(a.path);
    res.set('Cache-Control', 'no-cache').type('html').send(appPage(a));
  });
}
if (ownApp) app.get(['/', '/index.html'], (req, res) => res.set('Cache-Control', 'no-cache').type('html').send(appPage(ownApp)));
for (const a of apps.APPS) {
  if (a.key !== 'scheduler') {
    app.get(`/manifest-${a.key}.webmanifest`, (req, res) => res.type('application/manifest+json').json(apps.manifest(a, Boolean(ownApp))));
  }
}
// The sign-in page shows the name and icon of the app you're signing in to.
if (ownApp && ownApp.key !== 'scheduler') {
  app.get('/login.html', (req, res) => {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'login.html'), 'utf8')
      .replace(/<title>Viral Post<\/title>/, `<title>${ownApp.name}</title>`)
      .replace('<h1>Viral Post</h1>', `<h1>${ownApp.name}</h1>`)
      .replace('content="Viral Post">', `content="${ownApp.short}">`)
      .replace(/\/icons\/apple-touch-icon\.png/g, apps.touchIcon(ownApp))
      .replace('href="/manifest.webmanifest"', `href="/manifest-${ownApp.key}.webmanifest"`);
    res.set('Cache-Control', 'no-cache').type('html').send(html);
  });
}
app.use(express.static(PUBLIC_DIR, {
  setHeaders(res) { if (res.req.query.v) res.set('Cache-Control', 'public, max-age=31536000, immutable'); },
}));

// ---------- Connecting Facebook / Instagram ----------
const loginStates = new Set();

app.get('/auth/facebook', (req, res) => {
  if (!config.metaAppId || !config.metaAppSecret) {
    return res.status(500).send('Set META_APP_ID and META_APP_SECRET in .env first.');
  }
  const state = crypto.randomBytes(16).toString('hex');
  loginStates.add(state);
  res.redirect(meta.loginUrl(state));
});

app.get('/auth/facebook/callback', async (req, res) => {
  const { code, state, error_description } = req.query;
  if (error_description) return res.redirect(`/#accounts?error=${encodeURIComponent(error_description)}`);
  if (!state || !loginStates.delete(state)) return res.status(400).send('Login expired, please try again.');
  try {
    const accounts = await meta.connectedAccountsFromCode(code);
    saveAccounts(accounts);
    res.redirect(`/#accounts?connected=${accounts.length}`);
  } catch (err) {
    console.error('[connect]', err);
    res.redirect(`/#accounts?error=${encodeURIComponent(errText(err))}`);
  }
});

app.get('/auth/youtube', (req, res) => {
  if (!youtube.configured()) {
    return res.status(500).send('Add your Google keys first: in Terminal run "npm run youtube-keys", then "npm run background:on".');
  }
  const state = crypto.randomBytes(16).toString('hex');
  loginStates.add(state);
  res.redirect(youtube.loginUrl(state));
});

app.get('/auth/youtube/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect(`/#accounts?error=${encodeURIComponent(error === 'access_denied' ? 'Google sign-in was cancelled.' : error)}`);
  if (!state || !loginStates.delete(state)) return res.status(400).send('Login expired, please try again.');
  try {
    const accounts = await youtube.accountsFromCode(code);
    saveAccounts(accounts);
    res.redirect(`/#accounts?connected=${accounts.length}`);
  } catch (err) {
    console.error('[connect]', err);
    res.redirect(`/#accounts?error=${encodeURIComponent(errText(err))}`);
  }
});

app.get('/auth/tiktok', (req, res) => {
  if (!tiktok.configured()) {
    return res.status(500).send('Add your TikTok keys first: in Terminal run "npm run tiktok-keys", then "npm run background:on".');
  }
  const state = crypto.randomBytes(16).toString('hex');
  loginStates.add(state);
  res.redirect(tiktok.loginUrl(state));
});

app.get('/auth/tiktok/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) return res.redirect(`/#accounts?error=${encodeURIComponent(error_description || error)}`);
  if (!state || !loginStates.delete(state)) return res.status(400).send('Login expired, please try again.');
  try {
    const accounts = await tiktok.accountsFromCode(code);
    saveAccounts(accounts);
    res.redirect(`/#accounts?connected=${accounts.length}`);
  } catch (err) {
    console.error('[connect]', err);
    res.redirect(`/#accounts?error=${encodeURIComponent(errText(err))}`);
  }
});

// "fetch failed" alone says nothing; add the network reason (e.g. ENOTFOUND, certificate).
function errText(err) {
  const c = err && err.cause;
  return c ? `${err.message} (${[c.code, c.message].filter(Boolean).join(': ')})` : String(err.message || err);
}

function saveAccounts(accounts) {
  const upsert = db.prepare(`
    INSERT INTO accounts (platform, external_id, name, username, picture_url, access_token)
    VALUES (@platform, @external_id, @name, @username, @picture_url, @access_token)
    ON CONFLICT(platform, external_id) DO UPDATE SET
      name=excluded.name, username=excluded.username, picture_url=excluded.picture_url, access_token=excluded.access_token`);
  db.transaction((list) => list.forEach((a) => upsert.run(a)))(accounts);
}

// ---------- API ----------
const api = express.Router();

api.get('/status', (req, res) => {
  res.json({
    metaConfigured: Boolean(config.metaAppId && config.metaAppSecret),
    saas: Boolean(config.tenantKey), // a customer's copy: show Account / Sign out
    publicBaseUrl: config.publicBaseUrl,
    instagramReady: config.publicBaseUrl.startsWith('https://'),
    redirectUri: meta.redirectUri(),
    youtubeConfigured: youtube.configured(),
    youtubeRedirectUri: youtube.redirectUri(),
    tiktokConfigured: tiktok.configured(),
    tiktokRedirectUri: tiktok.redirectUri(),
    tiktokMode: tiktok.mode(),
  });
});

api.get('/accounts', (req, res) => {
  res.json(db.prepare('SELECT id, platform, external_id, name, username, picture_url FROM accounts ORDER BY platform, name').all());
});

api.delete('/accounts/:id', (req, res) => {
  db.prepare('DELETE FROM accounts WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: config.mediaDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^(image\/(jpeg|png)|video\/(mp4|quicktime))$/.test(file.mimetype)),
});

function loadPost(id) {
  const post = db.prepare('SELECT * FROM posts WHERE id=?').get(id);
  if (!post) return null;
  post.targets = db.prepare(`
    SELECT t.*, a.platform, a.name AS account_name, a.username
    FROM post_targets t JOIN accounts a ON a.id=t.account_id WHERE t.post_id=?`).all(id);
  return Object.assign(post, mediaUrls(post));
}
function mediaUrls(post) {
  const media_url = post.media_file ? `/media/${post.media_file}` : post.media_source_url || null;
  return { media_url, thumb_url: post.media_file ? `/thumb/${post.media_file}` : media_url };
}

function validatePost({ caption, scheduledAt, accountIds, mediaType }) {
  if (!scheduledAt || isNaN(Date.parse(scheduledAt))) return 'Pick a date and time.';
  if (!accountIds.length) return 'Pick at least one account.';
  const accts = db.prepare(`SELECT * FROM accounts WHERE id IN (${accountIds.map(() => '?').join(',')})`).all(...accountIds);
  if (accts.length !== accountIds.length) return 'Unknown account.';
  if (accts.some((a) => a.platform === 'instagram') && !mediaType) return 'Instagram posts need a photo or video.';
  if (!caption && !mediaType) return 'Write something or add media.';
  if (caption && caption.length > 2200 && accts.some((a) => a.platform === 'instagram')) return 'Instagram captions are limited to 2,200 characters.';
  if (accts.some((a) => a.platform === 'youtube') && mediaType !== 'video') return 'YouTube posts need a video.';
  if (accts.some((a) => a.platform === 'tiktok') && mediaType !== 'video') return 'TikTok posts need a video.';
  return null;
}

api.post('/posts', upload.single('media'), (req, res) => {
  const caption = (req.body.caption || '').trim();
  const accountIds = [].concat(req.body.accountIds || []).flatMap((v) => String(v).split(',')).filter(Boolean).map(Number);
  // A clip from the Clips tab can be used instead of an uploaded file.
  // ...and so can a finished ad from Viral Ads Studio.
  const clipFile = req.file ? null
    : req.body.clipId ? clipper.copyClipToMedia(Number(req.body.clipId))
    : req.body.adRef ? ads.copyAdToMedia(req.body.adRef) : null;
  if (!req.file && (req.body.clipId || req.body.adRef) && !clipFile) return res.status(400).json({ error: `That ${req.body.adRef ? 'ad' : 'clip'} is not ready yet. Try again in a minute.` });
  const mediaType = req.file ? (req.file.mimetype.startsWith('video') ? 'video' : 'image') : clipFile ? 'video' : null;
  let error = validatePost({ caption, scheduledAt: req.body.scheduledAt, accountIds, mediaType });
  if (!error && req.file?.mimetype === 'image/png' && accountIds.length &&
      db.prepare(`SELECT 1 FROM accounts WHERE platform='instagram' AND id IN (${accountIds.map(() => '?').join(',')})`).get(...accountIds)) {
    error = 'Instagram only accepts JPG photos. Please save the image as a JPG.';
  }
  if (error) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    if (clipFile) fs.rmSync(path.join(config.mediaDir, clipFile), { force: true });
    return res.status(400).json({ error });
  }
  const id = db.transaction(() => {
    const { lastInsertRowid } = db.prepare('INSERT INTO posts (caption, media_file, media_type, scheduled_at, title) VALUES (?,?,?,?,?)')
      .run(caption, req.file?.filename || clipFile || null, mediaType, new Date(req.body.scheduledAt).toISOString(), (req.body.title || '').trim() || null);
    const ins = db.prepare('INSERT INTO post_targets (post_id, account_id) VALUES (?,?)');
    accountIds.forEach((a) => ins.run(lastInsertRowid, a));
    return lastInsertRowid;
  })();
  res.status(201).json(loadPost(id));
});

api.get('/posts', (req, res) => {
  const from = req.query.from || new Date(Date.now() - 31 * 864e5).toISOString();
  const to = req.query.to || new Date(Date.now() + 62 * 864e5).toISOString();
  // Two queries for the whole range (not two per post), so a busy month opens quickly.
  const posts = db.prepare('SELECT * FROM posts WHERE scheduled_at BETWEEN ? AND ? ORDER BY scheduled_at').all(from, to);
  const byId = new Map(posts.map((p) => [p.id, Object.assign(p, mediaUrls(p), { targets: [] })]));
  for (const t of db.prepare(`
    SELECT t.*, a.platform, a.name AS account_name, a.username
    FROM post_targets t JOIN accounts a ON a.id=t.account_id JOIN posts p ON p.id=t.post_id
    WHERE p.scheduled_at BETWEEN ? AND ? ORDER BY t.id`).all(from, to)) byId.get(t.post_id)?.targets.push(t);
  res.json(posts);
});

api.get('/posts/:id', (req, res) => {
  const post = loadPost(req.params.id);
  post ? res.json(post) : res.status(404).json({ error: 'Not found' });
});

// Reschedule or edit caption. Only touches targets that haven't gone out yet.
api.patch('/posts/:id', (req, res) => {
  const post = loadPost(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  if (post.targets.some((t) => t.status === 'published' || t.status === 'publishing')) {
    return res.status(409).json({ error: 'Already published to at least one account, so it can no longer be edited.' });
  }
  const { caption, scheduledAt, title } = req.body;
  if (scheduledAt !== undefined && isNaN(Date.parse(scheduledAt))) return res.status(400).json({ error: 'Invalid date.' });
  db.prepare('UPDATE posts SET caption=COALESCE(?, caption), scheduled_at=COALESCE(?, scheduled_at) WHERE id=?')
    .run(caption ?? null, scheduledAt ? new Date(scheduledAt).toISOString() : null, post.id);
  if (title !== undefined) db.prepare('UPDATE posts SET title=? WHERE id=?').run(String(title).trim() || null, post.id);
  res.json(loadPost(post.id));
});

api.post('/posts/:id/retry', (req, res) => {
  db.prepare(`UPDATE post_targets SET status='scheduled', error=NULL, attempts=0, retry_at=NULL WHERE post_id=? AND status='failed'`).run(req.params.id);
  db.prepare(`UPDATE posts SET scheduled_at=? WHERE id=?`).run(new Date().toISOString(), req.params.id);
  scheduler.publishDue().catch(() => {});
  res.json(loadPost(req.params.id));
});

api.delete('/posts/:id', (req, res) => {
  const post = loadPost(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM posts WHERE id=?').run(post.id);
  if (post.media_file) fs.rmSync(path.join(config.mediaDir, post.media_file), { force: true });
  res.json({ ok: true });
});

const bundleUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });
api.post('/import', bundleUpload.single('bundle'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Pick a post bundle file first.' });
  const result = importBundle(req.file.buffer.toString('utf8'));
  if (result.error) return res.status(400).json(result);
  scheduler.publishDue().catch(() => {});
  res.json(result);
});

api.get('/analytics', (req, res) => {
  const days = Number(req.query.days || 30);
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const before = new Date(Date.now() - 2 * days * 864e5).toISOString();
  const rows = (from, to) => db.prepare(`
    SELECT t.*, p.caption, p.title, p.media_type, p.media_file, p.media_source_url, p.scheduled_at, a.platform, a.name AS account_name
    FROM post_targets t JOIN posts p ON p.id=t.post_id JOIN accounts a ON a.id=t.account_id
    WHERE t.status='published' AND t.published_at >= ? AND t.published_at < ? ORDER BY t.published_at DESC`).all(from, to);
  const withMedia = (p) => ({ ...p, media_url: p.media_file ? `/media/${p.media_file}` : p.media_source_url || null, thumb_url: p.media_file ? `/thumb/${p.media_file}` : p.media_source_url || null });
  const posts = rows(since, '9999').map(withMedia);
  const previous = rows(before, since).map(({ platform, likes, comments, shares, views }) => ({ platform, likes, comments, shares, views }));
  const failed = db.prepare(`SELECT COUNT(*) AS n FROM post_targets t JOIN posts p ON p.id=t.post_id
    WHERE t.status='failed' AND p.scheduled_at >= ?`).get(since).n;
  const followers = db.prepare(`
    SELECT a.id AS account_id, a.platform, a.name, a.picture_url, f.taken_on, f.followers
    FROM follower_snapshots f JOIN accounts a ON a.id=f.account_id
    WHERE f.taken_on >= ? ORDER BY f.taken_on`).all(before.slice(0, 10));
  res.json({ days, posts, previous, failed, followers, since });
});

// Who commented on one published post, and what they said. Official APIs only; TikTok
// doesn't let apps read comments, so it just points to the post.
api.get('/analytics/comments/:targetId', async (req, res) => {
  const t = db.prepare(`SELECT t.id, t.external_post_id, t.permalink, t.comments AS count, a.platform, a.name AS account_name,
    a.external_id, a.access_token, a.username FROM post_targets t JOIN accounts a ON a.id=t.account_id
    WHERE t.id=? AND t.status='published'`).get(req.params.targetId);
  if (!t) return res.status(404).json({ error: 'That post is not published (or was removed).' });
  const out = { platform: t.platform, account: t.account_name, permalink: t.permalink, count: t.count };
  try {
    let r;
    if (t.platform === 'facebook') r = await meta.facebookComments(t, t.external_post_id);
    else if (t.platform === 'instagram') r = await meta.instagramComments(t, t.external_post_id);
    else if (t.platform === 'youtube') r = await youtube.videoComments(t, t.external_post_id);
    else r = { comments: [], note: "TikTok doesn't let apps read comments. Tap \"Open post\" to see them in TikTok." };
    if (r.needsReconnect) r.note = `${t.platform === 'facebook' ? 'Facebook' : 'Instagram'} needs one more permission to show comments. Go to Accounts and click "Connect Facebook & Instagram" again, then come back.`;
    else if (r.namesHidden) r.note = 'Facebook hid the names of the people who commented. Reconnect Facebook & Instagram in Accounts to allow names.';
    res.json({ ...out, ...r });
  } catch (e) {
    res.json({ ...out, comments: [], note: `Couldn't load comments right now: ${e.message}` });
  }
});

api.post('/analytics/refresh', async (req, res) => {
  await scheduler.refreshStats();
  res.json({ ok: true });
});

app.use('/api/clips', clipper.router);
app.use('/api/ads', ads.router);
app.use('/api/crm/forms', forms.router);
app.use('/api/crm/booking', booking.router);
app.use('/api/crm/automations', automations.router);
app.use('/api/crm/email', campaigns.router);
// Website sign-ups (see website.js): status for the Forms tab, and a "check now" button.
app.get('/api/crm/website', (req, res) => res.json({ ...website.status(), calendar: gcal.status() }));
app.post('/api/crm/website/check', async (req, res) => {
  const [w, g] = await Promise.all([website.check(), gcal.check()]);
  res.json({ ...w, booked: g.added || 0, error: w.error || g.error, ...website.status(), calendar: gcal.status() });
});
app.use('/api/crm', crm.router);
app.use('/api', api);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// Each app runs its own background work: Viral Post publishes posts, Viral Touch CRM runs
// follow-ups, automations and emails, Viral Clips and Viral Ads Studio make videos.
// One program with no APP (customer copies) runs all of it.
function startApp() {
  const runs = (key) => !ownApp || ownApp.key === key;
  if (runs('scheduler')) scheduler.start();
  if (runs('crm') && appsOnKeys.has('crm')) scheduler.startCrm();
  if (runs('clips') && appsOnKeys.has('clips')) clipper.start();
  if (runs('ads') && appsOnKeys.has('ads')) ads.start();
  const port = ownApp && !process.env.PORT ? apps.portOf(ownApp) : config.port;
  const args = config.host ? [port, config.host] : [port];
  app.listen(...args, () => console.log(`${ownApp ? ownApp.name : 'Viral Post'} running at http://localhost:${port}`));
}

if (require.main === module) startApp();

module.exports = app;
module.exports.startApp = startApp;
