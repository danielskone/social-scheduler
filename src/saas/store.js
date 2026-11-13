// Customer accounts for the sellable version of Viral Post (see src/saas/gateway.js).
// One small database holds who can sign in, their plan, and their sign-in sessions. Each
// customer's posts, CRM and files live in their own folder (tenants/<id>/), never here.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function open(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, 'accounts.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
    -- trialing: free trial; active: paying; past_due/canceled: payment problem or ended;
    -- free: given free access by the owner; disabled: blocked by the owner.
    status TEXT NOT NULL DEFAULT 'trialing',
    trial_ends_at TEXT,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    current_period_end TEXT,
    accepted_terms_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `);
  return db;
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');
const iso = (ms) => new Date(ms).toISOString();

// Passwords are never stored, only a slow one-way scramble (scrypt) with a random salt.
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
function checkPassword(password, stored) {
  const [kind, salt, key] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !key) return false;
  const want = Buffer.from(key, 'base64');
  const got = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), want.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(want, got);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function passwordProblem(p) {
  if (typeof p !== 'string' || p.length < 8) return 'Please use a password with at least 8 characters.';
  if (p.length > 200) return 'That password is too long.';
  return '';
}

function createStore(dir, { trialDays = 14, adminEmail = '' } = {}) {
  const db = open(dir);
  const q = {
    byEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    byId: db.prepare('SELECT * FROM users WHERE id = ?'),
  };

  const store = {
    db,
    trialDays,
    getUser: (id) => q.byId.get(id),
    getUserByEmail: (email) => q.byEmail.get(String(email || '').trim()),
    listUsers: () => db.prepare('SELECT * FROM users ORDER BY id').all(),

    createUser({ email, name, password, acceptedTerms }) {
      email = String(email || '').trim();
      if (!EMAIL_RE.test(email) || email.length > 200) throw new Error('Please enter a real email address.');
      const problem = passwordProblem(password);
      if (problem) throw new Error(problem);
      if (!acceptedTerms) throw new Error('Please agree to the Terms and Privacy Policy.');
      if (q.byEmail.get(email)) throw new Error('That email already has an account. Try signing in.');
      const role = adminEmail && email.toLowerCase() === adminEmail.toLowerCase() ? 'admin' : 'customer';
      const status = role === 'admin' ? 'free' : 'trialing';
      const info = db.prepare(`INSERT INTO users (email, name, password_hash, role, status, trial_ends_at, accepted_terms_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`).run(email, String(name || '').trim().slice(0, 100), hashPassword(password), role, status, iso(Date.now() + trialDays * 864e5));
      return q.byId.get(info.lastInsertRowid);
    },

    verifyLogin(email, password) {
      const u = q.byEmail.get(String(email || '').trim());
      // Check a dummy hash when the email is unknown so both cases take the same time.
      const ok = checkPassword(password, u ? u.password_hash : 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==');
      if (!u || !ok) return null;
      db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(u.id);
      return u;
    },

    setPassword(userId, password) {
      const problem = passwordProblem(password);
      if (problem) throw new Error(problem);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), userId);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId); // sign out everywhere
    },

    // ---- sessions (the browser keeps a random token; only its fingerprint is stored) ----
    createSession(userId, days = 30) {
      const t = token();
      db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha(t), userId, iso(Date.now() + days * 864e5));
      return t;
    },
    userForSession(t) {
      if (!t) return null;
      const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha(t));
      if (!s) return null;
      if (s.expires_at < iso(Date.now())) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(s.token_hash); return null; }
      return q.byId.get(s.user_id) || null;
    },
    endSession: (t) => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(t || '')),

    // ---- forgotten passwords: one-time link that works for 1 hour ----
    createReset(userId, ms = 3600e3) {
      const t = token();
      db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha(t), userId, iso(Date.now() + ms));
      return t;
    },
    // Is this invite or reset link still good? Returns its person, or null.
    resetUser(t) {
      const r = db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND used = 0').get(sha(t || ''));
      return r && r.expires_at >= iso(Date.now()) ? q.byId.get(r.user_id) || null : null;
    },

    // ---- beta testers: the owner adds them; they pick their own password from a link ----
    inviteUser({ email, name, status = 'free' }) {
      email = String(email || '').trim();
      if (!EMAIL_RE.test(email) || email.length > 200) throw new Error('Please enter a real email address.');
      if (q.byEmail.get(email)) throw new Error('That email already has an account. Use "Make reset link" on their row instead.');
      // A random password nobody knows, until they pick their own from the invite link.
      const info = db.prepare(`INSERT INTO users (email, name, password_hash, role, status, trial_ends_at)
        VALUES (?, ?, ?, 'customer', ?, ?)`).run(email, String(name || '').trim().slice(0, 100), hashPassword(token()), status, iso(Date.now() + trialDays * 864e5));
      const user = q.byId.get(info.lastInsertRowid);
      return { user, token: store.createReset(user.id, 14 * 864e5) };
    },
    acceptTerms: (userId) => db.prepare("UPDATE users SET accepted_terms_at = datetime('now') WHERE id = ? AND accepted_terms_at IS NULL").run(userId),
    useReset(t, password) {
      const r = db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND used = 0').get(sha(t || ''));
      if (!r || r.expires_at < iso(Date.now())) throw new Error('That reset link has expired. Ask for a new one.');
      store.setPassword(r.user_id, password);
      db.prepare('UPDATE password_resets SET used = 1 WHERE token_hash = ?').run(r.token_hash);
      return q.byId.get(r.user_id);
    },

    // ---- plans ----
    update(userId, fields) {
      const allowed = ['name', 'status', 'trial_ends_at', 'stripe_customer_id', 'stripe_subscription_id', 'current_period_end', 'role'];
      const keys = Object.keys(fields).filter((k) => allowed.includes(k));
      if (!keys.length) return q.byId.get(userId);
      db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...Object.fromEntries(keys.map((k) => [k, fields[k] ?? null])), id: userId });
      return q.byId.get(userId);
    },
    byStripeCustomer: (id) => db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?').get(id),
  };
  return store;
}

// Can this person use the app right now? Returns { ok, reason }.
function access(user, { now = Date.now() } = {}) {
  if (!user) return { ok: false, reason: 'signed-out' };
  if (user.status === 'disabled') return { ok: false, reason: 'disabled' };
  if (user.role === 'admin' || user.status === 'free' || user.status === 'active') return { ok: true };
  if (user.status === 'trialing' && user.trial_ends_at && Date.parse(user.trial_ends_at) > now) return { ok: true };
  // Stripe keeps retrying a failed card for a while; keep the app on for 3 days meanwhile.
  if (user.status === 'past_due' && user.current_period_end && Date.parse(user.current_period_end) + 3 * 864e5 > now) return { ok: true };
  return { ok: false, reason: user.status === 'trialing' ? 'trial-ended' : 'unpaid' };
}

module.exports = { createStore, access, hashPassword, checkPassword };
