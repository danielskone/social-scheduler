// The sign-up, sign-in, account and owner pages of the sellable version. Plain HTML, no
// build step, works on phones.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSS = `
:root{--bg:#f6f7fb;--card:#fff;--text:#111827;--muted:#6b7280;--line:#e5e7eb;--brand:#7c3aed;--brand2:#db2777;--bad:#b91c1c;--good:#047857}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d12;--card:#151821;--text:#f3f4f6;--muted:#9ca3af;--line:#262a36}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:var(--brand)}main{max-width:440px;margin:0 auto;padding:32px 16px}main.wide{max-width:960px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;margin-bottom:16px}
.logo{display:flex;align-items:center;gap:10px;font-weight:700;font-size:20px;margin-bottom:20px;text-decoration:none;color:var(--text)}
.logo img{width:40px;height:40px;border-radius:10px}
h1{font-size:24px;margin:0 0 6px}h2{font-size:18px;margin:0 0 10px}p{margin:0 0 12px}.muted{color:var(--muted)}.small{font-size:14px}
label{display:block;font-weight:600;font-size:14px;margin:14px 0 4px}
input[type=text],input[type=email],input[type=password],input[type=number],select{width:100%;font:inherit;padding:11px 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--text)}
.check{display:flex;gap:8px;align-items:flex-start;font-weight:400;font-size:14px}.check input{margin-top:4px}
.btn{display:inline-block;font:inherit;font-weight:600;padding:11px 18px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--text);cursor:pointer;text-decoration:none}
.btn.primary{background:linear-gradient(90deg,var(--brand),var(--brand2));border:0;color:#fff}.btn.full{width:100%;margin-top:18px}
.err{color:var(--bad);font-weight:600}.ok{color:var(--good);font-weight:600}
.pill{display:inline-block;padding:2px 10px;border-radius:99px;font-size:13px;font-weight:600;background:var(--line)}
.pill.good{background:#d1fae5;color:#065f46}.pill.bad{background:#fee2e2;color:#991b1b}
.hero{text-align:center;padding:24px 0}.hero h1{font-size:34px}.row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:16px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
.scroll{overflow-x:auto}td form{display:inline}td .btn{padding:5px 10px;font-size:13px;margin:2px 0}
.top{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
`;

function layout(title, body, { wide = false } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)} · Viral Post</title>
<link rel="icon" href="/icons/icon-192.png"><style>${CSS}</style></head>
<body><main class="${wide ? 'wide' : ''}"><a class="logo" href="/"><img src="/icons/icon-192.png" alt="">Viral Post</a>${body}</main></body></html>`;
}

const msg = (error, ok) => `${error ? `<p class="err">${esc(error)}</p>` : ''}${ok ? `<p class="ok">${esc(ok)}</p>` : ''}`;

function welcome({ priceLabel, trialDays, signupsOpen }) {
  return layout('Schedule your social posts', `
<div class="hero">
  <h1>Plan a month of posts in one sitting</h1>
  <p class="muted">Schedule to Facebook, Instagram, TikTok and YouTube, track what works, and keep your contacts in a simple CRM.</p>
  <p><b>${esc(priceLabel)}</b>${trialDays ? ` · ${trialDays}-day free trial` : ''}</p>
  <div class="row">${signupsOpen ? '<a class="btn primary" href="/signup">Start free trial</a>' : ''}<a class="btn" href="/login">Sign in</a></div>
</div>
<p class="muted small" style="text-align:center"><a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></p>`);
}

function signup({ error = '', values = {}, trialDays, signupsOpen }) {
  if (!signupsOpen) return layout('Sign up', '<div class="card"><h1>Sign-ups are closed</h1><p class="muted">New accounts are not open right now. If you already have one, <a href="/login">sign in</a>.</p></div>');
  return layout('Create your account', `
<form class="card" method="post" action="/signup">
  <h1>Create your account</h1>
  <p class="muted">${trialDays ? `Free for ${trialDays} days. No card needed to start.` : 'Takes less than a minute.'}</p>
  ${msg(error)}
  <label for="name">Your name</label><input id="name" type="text" name="name" autocomplete="name" value="${esc(values.name)}" required maxlength="100">
  <label for="email">Email</label><input id="email" type="email" name="email" autocomplete="email" value="${esc(values.email)}" required maxlength="200">
  <label for="password">Password (8 or more characters)</label><input id="password" type="password" name="password" autocomplete="new-password" minlength="8" required>
  <label class="check"><input type="checkbox" name="terms" value="1" required> I agree to the <a href="/terms" target="_blank">Terms</a> and <a href="/privacy" target="_blank">Privacy Policy</a>.</label>
  <button class="btn primary full" type="submit">Create account</button>
  <p class="muted small" style="margin-top:14px">Already have an account? <a href="/login">Sign in</a></p>
</form>`);
}

function login({ error = '', ok = '', email = '', signupsOpen }) {
  return layout('Sign in', `
<form class="card" method="post" action="/login">
  <h1>Sign in</h1>
  ${msg(error, ok)}
  <label for="email">Email</label><input id="email" type="email" name="email" autocomplete="username" value="${esc(email)}" required autofocus>
  <label for="password">Password</label><input id="password" type="password" name="password" autocomplete="current-password" required>
  <button class="btn primary full" type="submit">Sign in</button>
  <p class="muted small" style="margin-top:14px"><a href="/forgot">Forgot your password?</a>${signupsOpen ? ' · <a href="/signup">Create an account</a>' : ''}</p>
</form>`);
}

function forgot({ error = '', ok = '', canEmail }) {
  return layout('Forgot password', `
<form class="card" method="post" action="/forgot">
  <h1>Forgot your password?</h1>
  ${msg(error, ok)}
  ${canEmail ? `<p class="muted">Type your email and we'll send you a link to pick a new password.</p>
  <label for="email">Email</label><input id="email" type="email" name="email" autocomplete="email" required>
  <button class="btn primary full" type="submit">Send reset link</button>` : '<p class="muted">Email the person who gave you Viral Post and they can send you a reset link.</p>'}
  <p class="muted small" style="margin-top:14px"><a href="/login">Back to sign in</a></p>
</form>`);
}

function reset({ token, error = '' }) {
  return layout('Pick a new password', `
<form class="card" method="post" action="/reset">
  <h1>Pick a new password</h1>
  ${msg(error)}
  <input type="hidden" name="token" value="${esc(token)}">
  <label for="password">New password (8 or more characters)</label><input id="password" type="password" name="password" autocomplete="new-password" minlength="8" required autofocus>
  <button class="btn primary full" type="submit">Save new password</button>
</form>`);
}

const STATUS = {
  trialing: ['Free trial', ''], active: ['Paid', 'good'], free: ['Free access', 'good'],
  past_due: ['Payment problem', 'bad'], canceled: ['Ended', 'bad'], disabled: ['Turned off', 'bad'],
};
const statusPill = (s) => { const [t, c] = STATUS[s] || [s, '']; return `<span class="pill ${c}">${esc(t)}</span>`; };
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

function account({ user, access, billingEnabled, priceLabel, settings, error = '', ok = '', isAdmin }) {
  const trialLeft = user.trial_ends_at ? Math.ceil((Date.parse(user.trial_ends_at) - Date.now()) / 864e5) : 0;
  let plan = '';
  if (user.status === 'trialing') plan = trialLeft > 0 ? `<p>Your free trial has <b>${trialLeft} day${trialLeft === 1 ? '' : 's'}</b> left (until ${day(user.trial_ends_at)}).</p>` : '<p class="err">Your free trial has ended. Subscribe to keep posting.</p>';
  else if (user.status === 'active') plan = `<p>Thanks for being a customer!${user.current_period_end ? ` Next payment around ${day(user.current_period_end)}.` : ''}</p>`;
  else if (user.status === 'past_due') plan = '<p class="err">Your last payment didn\'t go through. Please update your card.</p>';
  else if (user.status === 'canceled') plan = '<p class="err">Your subscription has ended. Subscribe again to keep posting.</p>';
  else if (user.status === 'free') plan = '<p>You have free access.</p>';
  else if (user.status === 'disabled') plan = '<p class="err">This account has been turned off. Please contact support.</p>';

  let buttons = '';
  if (billingEnabled && user.status !== 'free' && user.status !== 'disabled') {
    if (user.stripe_customer_id && ['active', 'past_due'].includes(user.status)) buttons = '<form method="post" action="/billing/portal"><button class="btn" type="submit">Change card, receipts or cancel</button></form>';
    else buttons = `<form method="post" action="/billing/checkout"><button class="btn primary" type="submit">Subscribe · ${esc(priceLabel)}</button></form>`;
  } else if (!billingEnabled && !access.ok && user.status !== 'disabled') {
    buttons = '<p class="muted">Payments are not switched on yet. Please contact support to keep using Viral Post.</p>';
  }

  const s = settings || {};
  const field = (k, label, type = 'text', ph = '') => `<label for="${k}">${label}</label><input id="${k}" type="${type}" name="${k}" value="${type === 'password' ? '' : esc(s[k])}" placeholder="${esc(type === 'password' && s[k] ? '(saved, leave empty to keep)' : ph)}" autocomplete="off">`;

  return layout('Your account', `
<div class="top"><h1>Your account</h1><div>${access.ok ? '<a class="btn primary" href="/">Open Viral Post</a> ' : ''}${isAdmin ? '<a class="btn" href="/admin">Customers</a> ' : ''}<a class="btn" href="/logout">Sign out</a></div></div>
${msg(error, ok)}
<div class="card"><h2>Plan ${statusPill(user.status)}</h2>${plan}${buttons}</div>
<form class="card" method="post" action="/account/email">
  <h2>Email sending (for CRM emails)</h2>
  <p class="muted small">Viral Post sends your CRM emails from <b>your own</b> mailbox (for example your Hostinger, Google Workspace or Outlook email). Your provider shows these settings under "SMTP" or "mail apps". Every email includes your mailing address and an unsubscribe line, as US law (CAN-SPAM) requires.</p>
  ${field('EMAIL_FROM', 'Your email address', 'email', 'you@yourbusiness.com')}
  ${field('EMAIL_FROM_NAME', 'Name people see', 'text', 'Your Business')}
  ${field('EMAIL_MAILING_ADDRESS', 'Mailing address (required by law, a PO box is fine)', 'text', 'PO Box 123, Town, ST 12345')}
  ${field('SMTP_HOST', 'Outgoing mail server (SMTP)', 'text', 'smtp.hostinger.com')}
  ${field('SMTP_PORT', 'SMTP port', 'number', '465')}
  ${field('SMTP_USER', 'Mailbox login (usually your email)', 'text')}
  ${field('SMTP_PASS', 'Mailbox password', 'password')}
  ${field('IMAP_HOST', 'Incoming mail server (IMAP, for unsubscribe replies)', 'text', 'imap.hostinger.com')}
  ${field('BOOKING_TIMEZONE', 'Your time zone', 'text', 'America/New_York')}
  <button class="btn primary full" type="submit">Save email settings</button>
</form>
<form class="card" method="post" action="/account/password">
  <h2>Change password</h2>
  <label for="current">Current password</label><input id="current" type="password" name="current" autocomplete="current-password" required>
  <label for="password">New password</label><input id="password" type="password" name="password" autocomplete="new-password" minlength="8" required>
  <button class="btn full" type="submit">Change password</button>
</form>
<p class="muted small">Signed in as ${esc(user.email)} · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></p>`);
}

function admin({ users, running, billingEnabled, notice = '' }) {
  const rows = users.map((u) => `<tr>
<td>${u.id}</td><td><b>${esc(u.name || '-')}</b><br><span class="muted">${esc(u.email)}</span></td>
<td>${statusPill(u.status)}${u.role === 'admin' ? ' <span class="pill">owner</span>' : ''}${u.status === 'trialing' ? `<br><span class="muted">until ${day(u.trial_ends_at)}</span>` : ''}</td>
<td>${day(u.created_at)}<br><span class="muted">${u.last_login_at ? `last in ${day(u.last_login_at)}` : 'never signed in'}</span></td>
<td>${running(u.id) ? '<span class="pill good">running</span>' : '<span class="pill">stopped</span>'}</td>
<td>${u.role === 'admin' ? '' : ['free:Give free access', 'trial:Add 14 trial days', 'disable:Turn off', 'enable:Turn back on', 'reset:Make reset link']
    .map((a) => { const [act, label] = a.split(':'); return `<form method="post" action="/admin/users/${u.id}"><input type="hidden" name="action" value="${act}"><button class="btn" type="submit">${label}</button></form>`; }).join(' ')}</td>
</tr>`).join('');
  return layout('Customers', `
<div class="top"><h1>Customers (${users.length})</h1><div><a class="btn primary" href="/">Open Viral Post</a> <a class="btn" href="/account">Your account</a></div></div>
${notice ? `<div class="card"><p class="ok">${notice}</p></div>` : ''}
<p class="muted">${billingEnabled ? 'Payments: Stripe is ON.' : 'Payments: OFF (new customers get the free trial; add your Stripe keys to switch payments on).'}</p>
<div class="card scroll"><table><tr><th>#</th><th>Customer</th><th>Plan</th><th>Joined</th><th>App</th><th></th></tr>${rows}</table></div>`, { wide: true });
}

module.exports = { layout, welcome, signup, login, forgot, reset, account, admin, esc };
