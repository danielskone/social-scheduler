// Sets up automatic welcome emails (sent through Brevo's free plan) and sends you a test.
//   npm run email-setup
// Saves the answers in .env. The API key is never shown on screen.
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const envPath = path.join(__dirname, '..', '.env');

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(`\r${question}${'*'.repeat(rl.line.length)}\x1b[K`); else if (s !== '\r\n' && s !== '\n') rl.output.write('*'.repeat([...s].length)); };
    }
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); });
  });
}
function setVar(text, key, value) {
  const line = `${key}=${String(value).replace(/\n/g, ' ')}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, () => line) : `${text.replace(/\n?$/, '\n')}${line}\n`;
}
const stop = (msg) => { console.log(`\n${msg}\nNothing was saved. Run \`npm run email-setup\` to try again.`); process.exit(1); };

(async () => {
  console.log('\nAutomatic welcome emails (free, through Brevo)\n');
  console.log('You need: a free Brevo account, your email added as a sender there, and an API key');
  console.log('(Brevo > your name at top right > SMTP & API > API keys > Generate a new API key).\n');
  const key = await ask('Brevo API key (shows as stars): ', true);
  if (!/^xkeysib-[A-Za-z0-9-]{20,}$/.test(key)) stop('That does not look like a Brevo API key (it starts with xkeysib-).');
  const from = (await ask('Your email (the sender you added in Brevo): ')).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) stop('That email address does not look right.');
  const name = (await ask('Name people see, e.g. Daniel King: ')) || 'Daniel King';
  console.log('\nThe law (CAN-SPAM) says every email must show a real mailing address.');
  console.log('A PO box or your business address is fine.');
  const address = await ask('Mailing address on one line: ');
  if (address.length < 10) stop('Please enter a full mailing address.');

  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  text = setVar(text, 'BREVO_API_KEY', key);
  text = setVar(text, 'EMAIL_FROM', from);
  text = setVar(text, 'EMAIL_FROM_NAME', name);
  text = setVar(text, 'EMAIL_MAILING_ADDRESS', address);
  fs.writeFileSync(envPath, text, { mode: 0o600 });
  Object.assign(process.env, { BREVO_API_KEY: key, EMAIL_FROM: from, EMAIL_FROM_NAME: name, EMAIL_MAILING_ADDRESS: address });

  console.log(`\nSending a test email to ${from}…`);
  const r = await require('../src/email').sendTest();
  if (r.ok) console.log(`\nEMAIL IS SET UP. Check your inbox for the test email.\nNow run: npm run background:on`);
  else console.log(`\nSaved, but the test email did not go out: ${r.error}\nIf Brevo says the sender is not valid, add and confirm ${from} under Brevo > Senders, then run this again.`);
})();
