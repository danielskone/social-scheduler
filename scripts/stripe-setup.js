// Switches on payments for the tester / customer site: npm run stripe-setup
// Asks for the Stripe price ID, secret key and webhook signing secret (secrets show as stars),
// saves them in .env (never in GitHub), then restarts the apps and the tester site.
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

(async () => {
  console.log('\nPaste each value from your Stripe dashboard, then press Return.\n');
  const price = await askUntil('Price ID (starts with price_): ', (v) => /^price_\w+$/.test(v), 'That should start with price_ . Try again.');
  const secret = await askUntil('Secret key (starts with sk_live_ or sk_test_, shows as stars): ', (v) => /^(sk|rk)_(live|test)_\w{10,}$/.test(v), 'That should start with sk_live_ . Try again.', true);
  const hook = await askUntil('Webhook signing secret (starts with whsec_, shows as stars): ', (v) => /^whsec_\w{10,}$/.test(v), 'That should start with whsec_ . Try again.', true);
  let label = await ask('Price people see, for example $19/month: ');
  label = label.replace(/["'\\\r\n]/g, '').trim() || '$19/month';

  const env = currentEnv();
  const tidy = {};
  for (const k of ['SAAS_SIGNUPS', 'SAAS_TRIAL_DAYS']) if (env[k]) tidy[k] = env[k];
  writeEnv({ ...tidy, STRIPE_PRICE_ID: price, STRIPE_SECRET_KEY: secret, STRIPE_WEBHOOK_SECRET: hook, SAAS_PRICE_LABEL: `"${label}"` });
  rl.close();
  console.log('\nSTRIPE SAVED. Restarting...');
  try { execFileSync(process.execPath, [path.join(__dirname, 'background.js'), 'on'], { stdio: 'inherit' }); } catch { /* shown above */ }
  console.log(`\nPayments are ON${secret.startsWith('sk_test_') ? ' in TEST mode (use card 4242 4242 4242 4242)' : ''}. Testers keep their free days and pay ${label} after.`);
})();
