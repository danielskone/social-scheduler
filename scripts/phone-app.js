// npm run phone-app : shows the address to open Viral Post on your iPhone (same Wi-Fi).
const os = require('os');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const port = process.env.PORT || 3000;
const isPrivate = (a) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
// Wi-Fi / Ethernet first (en0, en1...), skipping VPN and virtual adapters.
const found = Object.entries(os.networkInterfaces())
  .flatMap(([name, list]) => (list || []).map((n) => ({ name, ...n })))
  .filter((n) => n.family === 'IPv4' && !n.internal && isPrivate(n.address))
  .sort((a, b) => (b.name.startsWith('en') - a.name.startsWith('en')) || a.name.localeCompare(b.name));
if (!process.env.APP_PASSWORD) console.log('\nFirst set a password: npm run password   (then npm run background:on)');
if (!found.length) { console.log('\nThis Mac is not connected to Wi-Fi or a home network right now.'); process.exit(0); }
console.log('\nOn your iPhone (on the same Wi-Fi as this Mac), open Safari and type:\n');
console.log(`    http://${found[0].address}:${port}\n`);
if (found.length > 1) console.log(`If that doesn't open, try: ${found.slice(1).map((n) => `http://${n.address}:${port}`).join('  or  ')}\n`);
