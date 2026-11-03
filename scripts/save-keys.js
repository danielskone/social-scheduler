// Saves sign-in keys into .env without showing the secret on screen.
//   npm run youtube-keys     (Google Cloud Client ID + Client secret)
//   npm run tiktok-keys      (TikTok Client key + Client secret)
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const envPath = path.join(__dirname, '..', '.env');
const KINDS = {
  youtube: {
    where: 'Google Cloud > Clients > your client',
    id: ['GOOGLE_CLIENT_ID', 'Client ID (ends with .apps.googleusercontent.com)', (v) => /\.apps\.googleusercontent\.com$/.test(v)],
    secret: 'GOOGLE_CLIENT_SECRET',
  },
  tiktok: {
    where: 'TikTok for Developers > your app > App details',
    id: ['TIKTOK_CLIENT_KEY', 'Client key', (v) => /^[A-Za-z0-9]{8,}$/.test(v)],
    secret: 'TIKTOK_CLIENT_SECRET',
  },
};

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); else if (s !== '\r\n' && s !== '\n') rl.output.write('*'); };
    }
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); });
  });
}

function setVar(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, line) : `${text.replace(/\n?$/, '\n')}${line}\n`;
}

(async () => {
  const name = process.argv[2];
  const kind = KINDS[name];
  if (!kind) return console.log('Use: npm run youtube-keys  or  npm run tiktok-keys');
  const cmd = `npm run ${name}-keys`;
  console.log(`\nPaste the two values from ${kind.where}.\n`);
  const [idVar, idLabel, idOk] = kind.id;
  const id = await ask(`${idLabel}: `);
  if (!idOk(id)) {
    console.log(`\nThat does not look right. Nothing was saved. Run \`${cmd}\` to try again.`);
    process.exit(1);
  }
  const secret = await ask('Client secret (it will show as stars): ', true);
  if (secret.length < 10) {
    console.log(`\nThat secret looks too short. Nothing was saved. Run \`${cmd}\` to try again.`);
    process.exit(1);
  }
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  text = setVar(text, idVar, id);
  text = setVar(text, kind.secret, secret);
  fs.writeFileSync(envPath, text, { mode: 0o600 });
  console.log(`\n${name.toUpperCase()} KEYS SAVED. Now run: npm run background:on`);
})();
