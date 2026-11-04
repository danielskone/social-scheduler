// npm run password : sets the Viral Post password (needed to open it on your phone).
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const envPath = path.join(__dirname, '..', '.env');
function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Show one star per character, never the text itself (also when a line is redrawn).
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(`\r${question}${'*'.repeat(rl.line.length)}\x1b[K`); else if (s !== '\r\n' && s !== '\n') rl.output.write('*'.repeat([...s].length)); };
    rl.question(question, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

(async () => {
  console.log('\nPick a password for Viral Post (at least 8 characters). Do not use your Facebook or Google password.\n');
  const a = await ask('New password: ');
  const b = await ask('Type it again: ');
  if (a !== b) { console.log('\nThe two did not match. Nothing was saved. Run `npm run password` again.'); process.exit(1); }
  if (a.length < 8 || /[\r\n]/.test(a)) { console.log('\nPlease use at least 8 characters. Nothing was saved.'); process.exit(1); }
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const line = `APP_PASSWORD=${a}`;
  text = /^APP_PASSWORD=.*$/m.test(text) ? text.replace(/^APP_PASSWORD=.*$/m, () => line) : `${text.replace(/\n?$/, '\n')}${line}\n`;
  fs.writeFileSync(envPath, text, { mode: 0o600 });
  console.log('\nPASSWORD SAVED. Now run: npm run background:on');
})();
