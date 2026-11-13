// Connects your website's forms to Viral Touch CRM (see crm/website-inbox/README.md).
//   npm run website
// Asks for the Google "Web app URL" and the secret key, checks that they work, and saves them in .env.
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const envPath = path.join(__dirname, '..', '..', '.env');
const ask = (q) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); resolve(a.trim()); });
});
function setVar(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, line) : `${text.replace(/\n?$/, '\n')}${line}\n`;
}

(async () => {
  console.log('\nConnect your website forms to Viral Touch CRM.\n');
  let url = '';
  while (!url) url = await ask('Web app URL (starts with https://script.google.com/ and ends with /exec): ');
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
    console.log('\nThat does not look like the Web app URL. Nothing was saved. Run `npm run website` to try again.');
    process.exit(1);
  }
  let key = '';
  while (!key) key = await ask('Secret key (from the Apps Script log): ');
  if (!/^[a-f0-9]{20,}$/i.test(key)) {
    console.log('\nThat does not look like the secret key. Nothing was saved. Run `npm run website` to try again.');
    process.exit(1);
  }
  console.log('\nChecking...');
  try {
    const res = await fetch(`${url}?key=${encodeURIComponent(key)}&after=999999999`, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const body = await res.json().catch(() => null);
    if (!body) throw new Error('Google did not answer with the inbox. In Apps Script, check Deploy > Manage deployments: "Who has access" must be "Anyone".');
    if (!body.ok) throw new Error(body.error === 'wrong key' ? 'The key is wrong. Run "setup" again in Apps Script and copy the key from the log.' : body.error);
    console.log(`Connected. The inbox has ${Math.max(0, body.last - 1)} sign-up(s) so far.`);
  } catch (e) {
    console.log(`\nNot connected: ${e.message}\nNothing was saved.`);
    process.exit(1);
  }
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  text = setVar(text, 'WEBSITE_INBOX_URL', url);
  text = setVar(text, 'WEBSITE_INBOX_KEY', key);
  fs.writeFileSync(envPath, text, { mode: 0o600 });
  console.log('\nWEBSITE SAVED. Now run: npm run background:on');
  console.log('Then open Viral Post > Contacts > Forms > "Code for your website" to copy the code for your site.');
})();
