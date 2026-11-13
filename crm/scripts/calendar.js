// Connects your Google Calendar booking page to Viral Touch CRM (read-only).
//   npm run calendar
// Paste your calendar's "Secret address in iCal format" (Google Calendar > Settings >
// your name under "Settings for my calendars" > Integrate calendar).
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
  console.log('\nConnect your Google Calendar bookings to Viral Touch CRM.\n');
  let url = '';
  while (!url) url = await ask('Secret address in iCal format (ends with .ics): ');
  if (!/^https:\/\/calendar\.google\.com\/calendar\/ical\/[^\s]+\/private-[^\s]+\.ics$/.test(url)) {
    console.log('\nThat does not look like the SECRET iCal address (it has "private-" in it and ends with .ics). Nothing was saved. Run `npm run calendar` to try again.');
    process.exit(1);
  }
  console.log('\nChecking...');
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    if (!res.ok || !text.includes('BEGIN:VCALENDAR')) throw new Error(`Google did not send the calendar (status ${res.status}).`);
    const n = (text.match(/BEGIN:VEVENT/g) || []).length;
    console.log(`Connected. Your calendar has ${n} event(s).`);
  } catch (e) {
    console.log(`\nNot connected: ${e.message}\nNothing was saved.`);
    process.exit(1);
  }
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  text = setVar(text, 'GCAL_ICS_URL', url);
  fs.writeFileSync(envPath, text, { mode: 0o600 });
  console.log('\nCALENDAR SAVED. Now run: npm run background:on');
})();
