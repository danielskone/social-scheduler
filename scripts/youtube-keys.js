// Saves your Google (YouTube) keys into .env without showing the secret on screen.
//   npm run youtube-keys
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const envPath = path.join(__dirname, '..', '.env');

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
  console.log('\nPaste the two values from Google Cloud > Clients > your client.\n');
  const id = await ask('Client ID (ends with .apps.googleusercontent.com): ');
  if (!/\.apps\.googleusercontent\.com$/.test(id)) {
    console.log('\nThat does not look like a Client ID. Nothing was saved. Run `npm run youtube-keys` to try again.');
    process.exit(1);
  }
  const secret = await ask('Client secret (it will show as stars): ', true);
  if (secret.length < 10) {
    console.log('\nThat secret looks too short. Nothing was saved. Run `npm run youtube-keys` to try again.');
    process.exit(1);
  }
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  text = setVar(text, 'GOOGLE_CLIENT_ID', id);
  text = setVar(text, 'GOOGLE_CLIENT_SECRET', secret);
  fs.writeFileSync(envPath, text, { mode: 0o600 });
  console.log('\nYOUTUBE KEYS SAVED. Now run: npm run background:on');
})();
