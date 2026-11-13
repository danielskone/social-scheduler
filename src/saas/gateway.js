// The sellable version of Viral Post: start with `npm run saas` on a server.
//
// This front door handles everything about customers: creating an account, signing in and
// out, forgotten passwords, the free trial, payments (Stripe), and the owner's Customers page.
// Once someone is signed in, every click is passed on to their own private copy of the app
// (see tenants.js), so each customer only ever sees their own posts, CRM and files.
//
// Your personal Mac setup (`npm start` / background:on) does not use any of this.
//
// Settings (server .env, never in GitHub):
//   SAAS_PUBLIC_URL        https://app.yourdomain.com  (the address customers open)
//   SAAS_ADMIN_EMAIL       your email: signing up with it makes you the owner (free, sees Customers)
//   SAAS_PORT              default 3000
//   SAAS_DIR               where accounts and customer folders are kept (default ./saas-data)
//   SAAS_TRIAL_DAYS        default 14
//   SAAS_PRICE_LABEL       shown on the site, e.g. "$29/month"
//   SAAS_SIGNUPS           "open" (default) or "closed" (default "closed" in beta)
//   SAAS_BETA              1 = beta test: invite only, testers get free access (npm run beta)
//   SAAS_YOUTUBE / SAAS_TIKTOK  "on" lets customers connect YouTube / TikTok (default off; the
//                          funnel address must be added in Google's / TikTok's settings first)
//   SAAS_META_LIVE         "on" once the Meta app passed App Review and is Live: anyone can connect
//                          Facebook and Instagram (until then only people added as Testers can)
//   SAAS_APPS              which apps customers get: "all" (default) or e.g. "scheduler" for Viral Post
//                          on its own, or "scheduler,crm" (crm, clips)
//   SAAS_SMTP_HOST/PORT/USER/PASS, SAAS_EMAIL_FROM  to email password-reset links (optional)
//   STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET  to switch payments on (optional)
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const express = require('express');
const { createStore, access } = require('./store');
const { createBilling } = require('./billing');
const { createTenants, TENANT_SETTINGS } = require('./tenants');
const pages = require('./pages');

function createGateway(opts = {}) {
  const env = opts.env || process.env;
  const publicUrl = (opts.publicUrl || env.SAAS_PUBLIC_URL || `http://localhost:${env.SAAS_PORT || 3000}`).replace(/\/$/, '');
  const dir = opts.dir || env.SAAS_DIR || path.join(__dirname, '..', '..', 'saas-data');
  const trialDays = Number(opts.trialDays ?? env.SAAS_TRIAL_DAYS ?? 14);
  const priceLabel = env.SAAS_PRICE_LABEL || '$29/month';
  const beta = /^(1|on|yes|true)$/i.test(String(env.SAAS_BETA || ''));
  const signupsOpen = (env.SAAS_SIGNUPS || (beta ? 'closed' : 'open')) !== 'closed';
  const adminEmail = String(env.SAAS_ADMIN_EMAIL || '').trim().toLowerCase();
  const secure = publicUrl.startsWith('https://');

  const store = opts.store || createStore(dir, { trialDays, adminEmail: env.SAAS_ADMIN_EMAIL || '' });
  const billing = opts.billing || createBilling({ secretKey: env.STRIPE_SECRET_KEY, priceId: env.STRIPE_PRICE_ID, webhookSecret: env.STRIPE_WEBHOOK_SECRET, apiBase: env.STRIPE_API_BASE });
  const tenants = opts.tenants || createTenants({ dir: path.join(dir, 'tenants'), basePort: Number(env.SAAS_TENANT_PORT || 4100), publicBaseUrl: publicUrl, env, log: opts.log });
  const mailer = opts.mailer || makeMailer(env);

  const app = express();
  app.disable('x-powered-by');
  // The server's web front (Caddy) passes on the visitor's real address.
  app.set('trust proxy', 'loopback');
  app.use((req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });

  // ---- helpers ----
  const cookieVal = (req, name) => { const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)); return m ? decodeURIComponent(m[1]) : ''; };
  const setSession = (res, t) => res.append('Set-Cookie', `vps=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 864e2}${secure ? '; Secure' : ''}`);
  const clearSession = (res) => res.append('Set-Cookie', `vps=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);
  const currentUser = (req) => store.userForSession(cookieVal(req, 'vps'));
  const wantsHtml = (req) => req.method === 'GET' && (req.headers.accept || '').includes('text/html');
  const form = express.urlencoded({ extended: false, limit: '20kb' });

  // Forms on this site may only be sent from this site (stops other sites from acting for you).
  const sameSite = (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && origin !== 'null' && origin !== publicUrl && origin !== `${req.protocol}://${req.get('host')}`) return res.status(403).send('Please use the Viral Post site.');
    next();
  };

  // Very simple "too many tries" guard per visitor address.
  const hits = new Map();
  const tooMany = (key, max, windowMs) => {
    const now = Date.now();
    const h = hits.get(key) || { n: 0, reset: now + windowMs };
    if (now > h.reset) { h.n = 0; h.reset = now + windowMs; }
    h.n += 1;
    hits.set(key, h);
    if (hits.size > 10000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    return h.n > max;
  };

  // ---- Stripe tells us about payments here (needs the untouched message to check it) ----
  app.post('/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    let event;
    try { event = billing.verifyWebhook(req.body.toString('utf8'), req.headers['stripe-signature']); } catch (e) { return res.status(400).send(e.message); }
    const user = billing.applyEvent(store, event);
    if (user) syncTenant(user);
    res.json({ received: true });
  });

  app.get('/healthz', (req, res) => res.json({ ok: true }));
  const docs = path.join(__dirname, '..', '..', 'docs');
  app.get('/terms', (req, res) => res.sendFile(path.join(docs, 'terms.html')));
  app.get('/privacy', (req, res) => res.sendFile(path.join(docs, 'privacy.html')));
  app.use('/icons', express.static(path.join(__dirname, '..', '..', 'public', 'icons'), { maxAge: '7d' }));

  // ---- Public links of each customer: pictures for Instagram, sign-up forms, booking pages, invoices, review links ----
  app.use('/w/:id', (req, res, next) => {
    const id = Number(req.params.id);
    const m = req.url.match(/^\/(media|f|book|invoice|r)(\/.*)?$/);
    const owner = id && store.getUser(id);
    if (!m || !owner || !access(owner).ok) return res.status(404).send('Not found');
    tenants.proxy(id, req, res, { pathOverride: req.url, publicIp: req.ip }).catch(next);
  });

  // ---- Sign up / sign in / sign out ----
  // When sign-ups are closed (the beta), only the owner can make an account here, at
  // /signup?owner=1. Testers get an invite link from the owner instead.
  const ownerSignup = (req) => !signupsOpen && (req.query.owner === '1' || req.body?.owner === '1') && adminEmail && !store.listUsers().some((u) => u.role === 'admin');
  app.get('/signup', (req, res) => res.send(pages.signup({ trialDays: beta ? 0 : trialDays, signupsOpen: signupsOpen || ownerSignup(req), owner: ownerSignup(req) })));
  app.post('/signup', sameSite, form, (req, res) => {
    const owner = ownerSignup(req);
    if (!signupsOpen && !owner) return res.status(403).send(pages.signup({ signupsOpen }));
    if (owner && String(req.body.email || '').trim().toLowerCase() !== adminEmail) {
      return res.status(400).send(pages.signup({ error: 'Use the owner email that is saved in Viral Post\'s settings.', values: { name: req.body.name, email: req.body.email }, signupsOpen: true, owner: true }));
    }
    if (tooMany(`signup:${req.ip}`, Number(env.SAAS_SIGNUP_LIMIT || 5), 3600e3)) return res.status(429).send(pages.signup({ error: 'Too many new accounts from here. Please try again later.', values: req.body, trialDays, signupsOpen }));
    try {
      const user = store.createUser({ email: req.body.email, name: req.body.name, password: req.body.password, acceptedTerms: req.body.terms === '1' });
      setSession(res, store.createSession(user.id));
      tenants.start(user.id).catch(() => {});
      res.redirect(303, '/');
    } catch (e) {
      res.status(400).send(pages.signup({ error: e.message, values: { name: req.body.name, email: req.body.email }, trialDays, signupsOpen: true, owner }));
    }
  });

  app.get(['/login', '/login.html'], (req, res) => {
    if (currentUser(req)) return res.redirect('/');
    res.send(pages.login({ signupsOpen, ok: req.query.reset ? 'Password saved. Please sign in.' : '' }));
  });
  app.post('/login', sameSite, form, (req, res) => {
    const email = String(req.body.email || '').trim();
    if (tooMany(`login:${req.ip}`, 10, 15 * 60e3) || tooMany(`login:${email.toLowerCase()}`, 10, 15 * 60e3)) {
      return res.status(429).send(pages.login({ error: 'Too many tries. Please wait 15 minutes.', email, signupsOpen }));
    }
    const user = store.verifyLogin(email, req.body.password);
    if (!user) return res.status(401).send(pages.login({ error: 'That email and password don\'t match.', email, signupsOpen }));
    setSession(res, store.createSession(user.id));
    if (access(user).ok) tenants.start(user.id).catch(() => {});
    res.redirect(303, '/');
  });
  app.all('/logout', (req, res) => {
    store.endSession(cookieVal(req, 'vps'));
    clearSession(res);
    res.redirect(303, '/login');
  });

  app.get('/forgot', (req, res) => res.send(pages.forgot({ canEmail: Boolean(mailer) })));
  app.post('/forgot', sameSite, form, async (req, res) => {
    const ok = 'If that email has an account, a reset link is on its way. Check your inbox (and spam).';
    if (!mailer) return res.send(pages.forgot({ canEmail: false }));
    if (tooMany(`forgot:${req.ip}`, 5, 3600e3)) return res.status(429).send(pages.forgot({ error: 'Too many tries. Please try again later.', canEmail: true }));
    const user = store.getUserByEmail(req.body.email);
    if (user && user.status !== 'disabled') {
      const link = `${publicUrl}/reset?token=${store.createReset(user.id)}`;
      mailer({ to: user.email, subject: 'Reset your Viral Post password', text: `Hi${user.name ? ` ${user.name}` : ''},\n\nTo pick a new Viral Post password, open this link within 1 hour:\n${link}\n\nIf you didn't ask for this, you can ignore this email.` })
        .catch((e) => console.error('[reset email]', e.message));
    }
    res.send(pages.forgot({ ok, canEmail: true }));
  });
  // Invite links (from the owner's Customers page): pick a password and you're in.
  app.get('/invite', (req, res) => {
    const user = store.resetUser(req.query.token);
    res.status(user ? 200 : 400).send(pages.invite({ token: req.query.token || '', user, beta, error: user ? '' : 'This link has expired or was already used. Ask for a new one.' }));
  });
  app.post('/invite', sameSite, form, (req, res) => {
    const user = store.resetUser(req.body.token);
    if (!user) return res.status(400).send(pages.invite({ token: '', user: null, beta, error: 'This link has expired or was already used. Ask for a new one.' }));
    if (!user.accepted_terms_at && req.body.terms !== '1') return res.status(400).send(pages.invite({ token: req.body.token, user, beta, error: 'Please agree to the Terms and Privacy Policy.' }));
    try {
      store.useReset(req.body.token, req.body.password);
      store.acceptTerms(user.id);
      if (req.body.name && !user.name) store.update(user.id, { name: String(req.body.name).trim().slice(0, 100) });
      setSession(res, store.createSession(user.id));
      const owner = ownerOf(store.getUser(user.id));
      if (access(owner).ok) tenants.start(owner.id).catch(() => {});
      res.redirect(303, '/');
    } catch (e) {
      res.status(400).send(pages.invite({ token: req.body.token, user, beta, error: e.message }));
    }
  });

  app.get('/reset', (req, res) => res.send(pages.reset({ token: req.query.token || '' })));
  app.post('/reset', sameSite, form, (req, res) => {
    try {
      store.useReset(req.body.token, req.body.password);
      res.redirect(303, '/login?reset=1');
    } catch (e) {
      res.status(400).send(pages.reset({ token: req.body.token, error: e.message }));
    }
  });

  // ---- Everything below needs a signed-in person ----
  const needUser = (req, res, next) => {
    const user = currentUser(req);
    if (!user) return wantsHtml(req) ? res.redirect(req.path === '/' ? '/welcome' : '/login') : res.status(401).json({ error: 'Please sign in again.' });
    req.user = user;
    next();
  };
  const needAdmin = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(404).send('Not found'));

  app.get('/welcome', (req, res) => res.send(pages.welcome({ priceLabel, trialDays, signupsOpen, beta })));

  // A teammate uses their team owner's app copy and plan.
  const ownerOf = (u) => (u && u.team_of ? store.getUser(u.team_of) : u);
  const accountPage = (req, res, extra = {}) => {
    const owner = ownerOf(req.user);
    if (req.user.team_of) return res.send(pages.account({ user: req.user, owner, access: access(owner), teammate: true, ...extra }));
    const settings = tenants.readSettings(req.user.id);
    res.send(pages.account({ user: req.user, access: access(req.user), billingEnabled: billing.enabled, priceLabel, settings, isAdmin: req.user.role === 'admin', team: store.teamOf(req.user.id), ok: req.query.paid ? 'Payment received. Thank you!' : '', ...extra }));
  };
  const notTeammate = (req, res, next) => (req.user.team_of ? res.redirect(303, '/account') : next());
  // Add a teammate: they get an invite link to pick their own password.
  app.post('/account/team', sameSite, needUser, notTeammate, form, (req, res) => {
    try {
      const { user, token } = store.inviteTeammate(req.user.id, { email: req.body.email, name: req.body.name });
      const link = `${publicUrl}/invite?token=${token}`;
      if (mailer) mailer({ to: user.email, subject: `${req.user.name || req.user.email} added you to their team`, text: pages.inviteText({ name: user.name, link }) }).catch((e) => console.error('[team invite]', e.message));
      accountPage(req, res, { teamInvite: { user, link, emailed: Boolean(mailer) } });
    } catch (e) { accountPage(req, res, { error: e.message }); }
  });
  app.post('/account/team/:id/remove', sameSite, needUser, notTeammate, (req, res) => {
    store.removeTeammate(req.user.id, Number(req.params.id));
    res.redirect(303, '/account');
  });
  app.get('/account', needUser, (req, res) => accountPage(req, res));

  app.post('/account/email', sameSite, needUser, notTeammate, form, async (req, res) => {
    const current = tenants.readSettings(req.user.id);
    const next = { ...current };
    for (const k of TENANT_SETTINGS) {
      if (!(k in req.body)) continue;
      const v = String(req.body[k] || '').trim().slice(0, 300);
      if (k === 'SMTP_PASS' && !v) continue; // empty = keep the saved password
      next[k] = v;
    }
    if (next.SMTP_PORT && !/^\d{2,5}$/.test(next.SMTP_PORT)) return accountPage(req, res, { error: 'The SMTP port should be a number like 465 or 587.' });
    if (next.BOOKING_TIMEZONE) { try { new Intl.DateTimeFormat('en-US', { timeZone: next.BOOKING_TIMEZONE }); } catch { return accountPage(req, res, { error: 'That time zone isn\'t recognised. Try something like America/New_York.' }); } }
    try {
      await tenants.saveSettings(req.user.id, next);
      accountPage(req, res, { ok: 'Email settings saved.' });
    } catch (e) {
      accountPage(req, res, { error: e.message });
    }
  });

  app.post('/account/password', sameSite, needUser, form, (req, res) => {
    if (!store.verifyLogin(req.user.email, req.body.current)) return accountPage(req, res, { error: 'Your current password is not right.' });
    try {
      store.setPassword(req.user.id, req.body.password);
      setSession(res, store.createSession(req.user.id));
      accountPage(req, res, { ok: 'Password changed. Other devices were signed out.' });
    } catch (e) {
      accountPage(req, res, { error: e.message });
    }
  });

  app.post('/billing/checkout', sameSite, needUser, notTeammate, async (req, res) => {
    if (!billing.enabled) return res.redirect(303, '/account');
    try { res.redirect(303, await billing.checkoutUrl(req.user, publicUrl)); } catch (e) { accountPage(req, res, { error: `Couldn't open the payment page: ${e.message}` }); }
  });
  app.post('/billing/portal', sameSite, needUser, async (req, res) => {
    if (!billing.enabled || !req.user.stripe_customer_id) return res.redirect(303, '/account');
    try { res.redirect(303, await billing.portalUrl(req.user, publicUrl)); } catch (e) { accountPage(req, res, { error: `Couldn't open billing: ${e.message}` }); }
  });

  // ---- Owner's Customers page ----
  const adminPage = (res, extra = {}) => res.send(pages.admin({ users: store.listUsers(), running: tenants.isRunning, billingEnabled: billing.enabled, beta, ...extra }));
  app.get('/admin', needUser, needAdmin, (req, res) => adminPage(res));
  // Add a beta tester: makes their login and an invite link (good for 14 days) to send them.
  app.post('/admin/invite', sameSite, needUser, needAdmin, form, (req, res) => {
    try {
      const { user, token } = store.inviteUser({ email: req.body.email, name: req.body.name, status: beta || req.body.free === '1' ? 'free' : 'trialing' });
      const link = `${publicUrl}/invite?token=${token}`;
      if (mailer) {
        mailer({ to: user.email, subject: 'You\'re invited to test Viral Post', text: pages.inviteText({ name: user.name, link }) })
          .catch((e) => console.error('[invite email]', e.message));
      }
      adminPage(res, { invite: { user, link, emailed: Boolean(mailer) } });
    } catch (e) {
      res.status(400);
      adminPage(res, { error: e.message, values: req.body });
    }
  });
  app.post('/admin/users/:id', sameSite, needUser, needAdmin, form, (req, res) => {
    const u = store.getUser(Number(req.params.id));
    if (!u || u.role === 'admin') return res.redirect(303, '/admin');
    let notice = '';
    const a = req.body.action;
    if (a === 'free') store.update(u.id, { status: 'free' });
    else if (a === 'trial') store.update(u.id, { status: 'trialing', trial_ends_at: new Date(Math.max(Date.now(), Date.parse(u.trial_ends_at || 0) || 0) + 14 * 864e5).toISOString() });
    else if (a === 'disable') store.update(u.id, { status: 'disabled' });
    else if (a === 'enable') store.update(u.id, { status: u.stripe_subscription_id ? 'active' : 'trialing' });
    else if (a === 'reset') {
      const link = `${publicUrl}/invite?token=${store.createReset(u.id, 3 * 864e5)}`;
      notice = `Password link for ${pages.esc(u.email)} (works for 3 days, send it to them): <br><code style="word-break:break-all">${pages.esc(link)}</code>`;
    }
    syncTenant(store.getUser(u.id));
    if (notice) return adminPage(res, { notice });
    res.redirect(303, '/admin');
  });

  // ---- The app itself: passed on to this customer's own copy ----
  app.use(needUser, (req, res, next) => {
    const owner = ownerOf(req.user);
    const ok = access(owner);
    if (!owner || !ok.ok) return wantsHtml(req) ? res.redirect('/account') : res.status(402).json({ error: 'Your Viral Post plan needs attention. Open Account to continue.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return sameSite(req, res, () => tenants.proxy(owner.id, req, res, { signedIn: true }).catch(next));
    tenants.proxy(owner.id, req, res, { signedIn: true }).catch(next);
  });

  app.use((err, req, res, next) => {
    console.error('[gateway]', err);
    if (res.headersSent) return res.destroy();
    res.status(500).send('Something went wrong. Please try again.');
  });

  // Keep each customer's copy running only while their plan allows it.
  function syncTenant(user) {
    if (!user || user.team_of) return; // teammates use their owner's copy
    if (access(user).ok) tenants.start(user.id).catch((e) => console.error(`[customer ${user.id}]`, e.message));
    else tenants.stop(user.id);
  }
  function syncAll() { store.listUsers().forEach(syncTenant); }

  return { app, store, billing, tenants, syncAll, publicUrl };
}

function makeMailer(env) {
  if (!env.SAAS_SMTP_HOST) return null;
  const nodemailer = require('nodemailer');
  const t = nodemailer.createTransport({
    host: env.SAAS_SMTP_HOST,
    port: Number(env.SAAS_SMTP_PORT || 465),
    secure: Number(env.SAAS_SMTP_PORT || 465) === 465,
    auth: { user: env.SAAS_SMTP_USER || env.SAAS_EMAIL_FROM, pass: env.SAAS_SMTP_PASS },
  });
  return (m) => t.sendMail({ from: `Viral Post <${env.SAAS_EMAIL_FROM || env.SAAS_SMTP_USER}>`, ...m });
}

if (require.main === module) {
  const g = createGateway();
  const port = Number(process.env.SAAS_PORT || 3000);
  g.syncAll();
  setInterval(g.syncAll, 10 * 60e3).unref(); // trials that end, payments that fail
  const server = g.app.listen(port, process.env.SAAS_HOST || '127.0.0.1', () => console.log(`Viral Post (customer version) at ${g.publicUrl} (port ${port})`));
  const bye = () => { g.tenants.stopAll(); server.close(); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', bye);
  process.on('SIGINT', bye);
  if (!fs.existsSync(path.join(__dirname, '..', '..', '.env'))) console.log('Tip: settings go in .env (see setup guide).');
}

module.exports = { createGateway };
