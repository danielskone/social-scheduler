// Connects Viral Touch CRM's emails (automations + campaigns) and sends you a test.
//   npm run email-setup
// Easiest: your own website email (Hostinger). Saves the answers in .env; passwords are
// never shown on screen.
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

const PRESETS = {
  1: { label: 'Website email at Hostinger', smtp: 'smtp.hostinger.com', imap: 'imap.hostinger.com', limit: 100 },
  2: { label: 'Gmail', smtp: 'smtp.gmail.com', imap: 'imap.gmail.com', limit: 100 },
};

(async () => {
  console.log('\nConnect your email to Viral Touch CRM\n');
  console.log('  1) My website email at Hostinger (like daniel@viralattraction.com)  <- easiest');
  console.log('  2) Gmail');
  console.log('  3) Another email provider');
  console.log('  4) Brevo (free email service)\n');
  let pick = (await ask('Type 1, 2, 3 or 4: ')) || '1';
  while (!['1', '2', '3', '4'].includes(pick)) pick = (await ask('Just the number please. Type 1, 2, 3 or 4: ')) || '1';
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const env = {};

  if (pick === '4') {
    console.log('\nBrevo: your name at top right > SMTP & API > API keys > Generate a new API key.\n');
    env.BREVO_API_KEY = await ask('Brevo API key (shows as stars): ', true);
    if (!/^xkeysib-[A-Za-z0-9-]{20,}$/.test(env.BREVO_API_KEY)) stop('That does not look like a Brevo API key (it starts with xkeysib-).');
    env.SMTP_HOST = ''; env.SMTP_PASS = '';
    env.EMAIL_FROM = (await ask('Your email (the sender you added in Brevo): ')).toLowerCase();
  } else {
    const p = PRESETS[pick] || {};
    env.EMAIL_FROM = (await ask('Your email address: ')).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.EMAIL_FROM)) stop('That email address does not look right.');
    if (pick === '2') console.log('\nGmail needs an "app password", not your normal password: myaccount.google.com > Security > 2-Step Verification (turn on) > App passwords > create one called Viral Post.\n');
    if (pick === '1') console.log('\nUse the password of that mailbox (Hostinger > Emails > your address > change password if you forgot it).\n');
    env.SMTP_PASS = await ask('Email password (shows as stars): ', true);
    if (env.SMTP_PASS.length < 4) stop('That password looks too short.');
    env.SMTP_HOST = p.smtp || await ask('Outgoing (SMTP) server, e.g. smtp.example.com: ');
    env.SMTP_PORT = '465';
    env.IMAP_HOST = p.imap || await ask('Incoming (IMAP) server, e.g. imap.example.com (Enter to skip): ');
    env.IMAP_PORT = '993';
    env.SMTP_USER = env.EMAIL_FROM;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.EMAIL_FROM)) stop('That email address does not look right.');
  env.EMAIL_FROM_NAME = (await ask('Name people see, e.g. Daniel King: ')) || 'Daniel King';
  console.log('\nThe law (CAN-SPAM) says every email must show a real mailing address.');
  console.log('A PO box or your business address is fine.');
  env.EMAIL_MAILING_ADDRESS = await ask('Mailing address on one line: ');
  if (env.EMAIL_MAILING_ADDRESS.length < 10 || /@|https?:|www\./i.test(env.EMAIL_MAILING_ADDRESS) || !/\d/.test(env.EMAIL_MAILING_ADDRESS)) {
    stop('That needs to be a postal address (street or PO box with the ZIP code), like 123 Main St, Fuquay-Varina, NC 27526. Not an email or website.');
  }

  Object.assign(process.env, env);
  const email = require('../src/email');
  if (email.provider() === 'mailbox') {
    console.log('\nChecking your email password…');
    const v = await email.verify();
    if (!v.ok) stop(`It did not work: ${v.error}`);
  }
  for (const [k, v] of Object.entries(env)) text = setVar(text, k, v);
  fs.writeFileSync(envPath, text, { mode: 0o600 });

  console.log(`Sending a test email to ${env.EMAIL_FROM}…`);
  const r = await email.sendTest();
  if (r.ok) console.log(`\nEMAIL IS SET UP. Check your inbox for the test email.\nNow run: npm run background:on`);
  else console.log(`\nSaved, but the test email did not go out: ${r.error}\nRun \`npm run email-setup\` to try again.`);
  process.exit(0);
})();
