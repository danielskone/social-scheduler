// Switches on payments for the tester / customer site: npm run stripe-setup
// Asks only for the Stripe secret key (shows as stars). Then it finds the monthly price on the
// Viral Post product, makes the webhook pointing at this site's /stripe/webhook, saves all three
// in .env (never in GitHub), and restarts the apps and the tester site.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');
const { writeEnv } = require('./beta');

// One reader for every question, so nothing typed or pasted ahead is lost.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let hiding = '';
const plainWrite = rl._writeToOutput.bind(rl);
rl._writeToOutput = (s) => {
  if (!hiding) return plainWrite(s);
  if (s.includes(hiding)) rl.output.write(`\r${hiding}${'*'.repeat(rl.line.length)}\x1b[K`);
  else if (s !== '\r\n' && s !== '\n') rl.output.write('*'.repeat([...s].length));
};
function ask(question, hidden = false) {
  return new Promise((resolve) => {
    hiding = hidden ? question : '';
    rl.question(question, (a) => { if (hidden) process.stdout.write('\n'); hiding = ''; resolve(a.trim()); });
  });
}

// .env lines read back, so duplicates added by hand (echo >> .env) are tidied: the last one wins.
function currentEnv() {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) out[m[1]] = m[2];
    }
  } catch { /* no .env */ }
  return out;
}

async function askUntil(question, ok, hint, hidden) {
  for (let i = 0; i < 3; i += 1) {
    const v = await ask(question, hidden);
    if (ok(v)) return v;
    console.log(hint);
  }
  console.log('Nothing was saved. Run npm run stripe-setup to try again.');
  rl.close();
  process.exit(1);
}

const API = (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/$/, '');
async function stripe(key, method, p, pairs) {
  const res = await fetch(`${API}/v1/${p}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: pairs ? new URLSearchParams(pairs).toString() : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Stripe said ${res.status}`);
  return data;
}

const EVENTS = ['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted'];

(async () => {
  const env = currentEnv();
  const site = String(env.SAAS_PUBLIC_URL || '').replace(/^["']|["']$/g, '').replace(/\/$/, '');
  if (!/^https:\/\//.test(site)) {
    console.log('Turn on the beta first (npm run beta), so Stripe has an https address to talk to.');
    rl.close();
    process.exit(1);
  }

  console.log('\nOpen https://dashboard.stripe.com/apikeys , click Reveal next to Secret key, and copy it.\n');
  const key = await askUntil('Paste your Secret key (starts with sk_live_, shows as stars): ', (v) => /^(sk|rk)_(live|test)_\w{10,}$/.test(v), 'That should start with sk_live_ . Try again.', true);

  // 1. Find the monthly price (the one on a product called Viral Post, if there are several).
  let price;
  try {
    const list = (await stripe(key, 'GET', 'prices?active=true&type=recurring&limit=100&expand[]=data.product')).data || [];
    const monthly = list.filter((x) => x.recurring?.interval === 'month');
    const named = monthly.filter((x) => /viral\s*post/i.test(x.product?.name || ''));
    price = (named.length ? named : monthly)[0];
    if (!price) { console.log('\nNo monthly price found. Make one at https://dashboard.stripe.com/products/create (Recurring, Monthly), then run this again.'); rl.close(); process.exit(1); }
    if (named.length > 1 || (!named.length && monthly.length > 1)) console.log(`(Found ${named.length || monthly.length} monthly prices; using the newest one.)`);
  } catch (e) {
    console.log(`\nStripe didn't accept that key: ${e.message}\nNothing was saved. Run npm run stripe-setup to try again.`);
    rl.close();
    process.exit(1);
  }
  const amount = (price.unit_amount / 100).toFixed(price.unit_amount % 100 ? 2 : 0);
  const sign = (price.currency || 'usd').toLowerCase() === 'usd' ? '$' : `${price.currency.toUpperCase()} `;
  const label = `${sign}${amount}/month`;
  console.log(`\nPrice: ${price.product?.name || 'your product'}, ${label}`);

  // 2. Make the webhook so Stripe tells Viral Post about payments (replacing an old one for this address).
  const url = `${site}/stripe/webhook`;
  let hook;
  try {
    const old = (await stripe(key, 'GET', 'webhook_endpoints?limit=100')).data || [];
    for (const w of old.filter((x) => x.url === url)) await stripe(key, 'DELETE', `webhook_endpoints/${w.id}`);
    hook = await stripe(key, 'POST', 'webhook_endpoints', [['url', url], ['description', 'Viral Post payments'], ...EVENTS.map((e) => ['enabled_events[]', e])]);
  } catch (e) {
    console.log(`\nCouldn't make the webhook: ${e.message}\nNothing was saved. Run npm run stripe-setup to try again.`);
    rl.close();
    process.exit(1);
  }
  console.log(`Webhook: ${url}`);

  const tidy = {};
  for (const k of ['SAAS_SIGNUPS', 'SAAS_TRIAL_DAYS']) if (env[k]) tidy[k] = env[k];
  writeEnv({ ...tidy, STRIPE_PRICE_ID: price.id, STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: hook.secret, SAAS_PRICE_LABEL: `"${label}"` });
  rl.close();
  console.log('\nSTRIPE SAVED. Restarting...');
  try { execFileSync(process.execPath, [path.join(__dirname, 'background.js'), 'on'], { stdio: 'inherit' }); } catch { /* shown above */ }
  console.log(`\nPayments are ON${key.startsWith('sk_test_') ? ' in TEST mode (use card 4242 4242 4242 4242)' : ''}. Testers keep their free days, then pay ${label}.`);
})();
