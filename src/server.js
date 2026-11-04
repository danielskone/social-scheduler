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

const app = express();
app.use(express.json());

// Media must stay public (no password) so Instagram can download it when publishing.
app.use('/media', express.static(config.mediaDir, { fallthrough: false }));

// ---------- Password protection ----------
app.use((req, res, next) => {
  if (!config.appPassword) return next();
  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const pass = Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':');
    const a = Buffer.from(pass), b = Buffer.from(config.appPassword);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Viral Post"').status(401).send('Password required');
});

app.use(express.static(path.join(__dirname, '..', 'public')));

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
  post.media_url = post.media_file ? `/media/${post.media_file}` : post.media_source_url || null;
  return post;
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
  const mediaType = req.file ? (req.file.mimetype.startsWith('video') ? 'video' : 'image') : null;
  let error = validatePost({ caption, scheduledAt: req.body.scheduledAt, accountIds, mediaType });
  if (!error && req.file?.mimetype === 'image/png' && accountIds.length &&
      db.prepare(`SELECT 1 FROM accounts WHERE platform='instagram' AND id IN (${accountIds.map(() => '?').join(',')})`).get(...accountIds)) {
    error = 'Instagram only accepts JPG photos. Please save the image as a JPG.';
  }
  if (error) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error });
  }
  const id = db.transaction(() => {
    const { lastInsertRowid } = db.prepare('INSERT INTO posts (caption, media_file, media_type, scheduled_at, title) VALUES (?,?,?,?,?)')
      .run(caption, req.file?.filename || null, mediaType, new Date(req.body.scheduledAt).toISOString(), (req.body.title || '').trim() || null);
    const ins = db.prepare('INSERT INTO post_targets (post_id, account_id) VALUES (?,?)');
    accountIds.forEach((a) => ins.run(lastInsertRowid, a));
    return lastInsertRowid;
  })();
  res.status(201).json(loadPost(id));
});

api.get('/posts', (req, res) => {
  const from = req.query.from || new Date(Date.now() - 31 * 864e5).toISOString();
  const to = req.query.to || new Date(Date.now() + 62 * 864e5).toISOString();
  const ids = db.prepare('SELECT id FROM posts WHERE scheduled_at BETWEEN ? AND ? ORDER BY scheduled_at').all(from, to);
  res.json(ids.map((r) => loadPost(r.id)));
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
  db.prepare(`UPDATE post_targets SET status='scheduled', error=NULL WHERE post_id=? AND status='failed'`).run(req.params.id);
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
  const posts = db.prepare(`
    SELECT t.*, p.caption, p.media_type, p.media_file, a.platform, a.name AS account_name
    FROM post_targets t JOIN posts p ON p.id=t.post_id JOIN accounts a ON a.id=t.account_id
    WHERE t.status='published' AND t.published_at >= ? ORDER BY t.published_at DESC`).all(since);
  const followers = db.prepare(`
    SELECT a.id AS account_id, a.platform, a.name, f.taken_on, f.followers
    FROM follower_snapshots f JOIN accounts a ON a.id=f.account_id
    WHERE f.taken_on >= ? ORDER BY f.taken_on`).all(since.slice(0, 10));
  res.json({ posts, followers });
});

api.post('/analytics/refresh', async (req, res) => {
  await scheduler.refreshStats();
  res.json({ ok: true });
});

app.use('/api', api);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

function startApp() {
  scheduler.start();
  app.listen(config.port, () => console.log(`Scheduler running at http://localhost:${config.port}`));
}

if (require.main === module) startApp();

module.exports = app;
module.exports.startApp = startApp;
