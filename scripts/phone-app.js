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
// Tailscale gives this Mac a private 100.x address that works from anywhere.
const tailscale = Object.values(os.networkInterfaces()).flat()
  .filter((n) => n && n.family === 'IPv4' && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(n.address));
if (tailscale.length) {
  console.log('\nFROM ANYWHERE (Tailscale on, on your iPhone too), open Safari and type:\n');
  console.log(`    http://${tailscale[0].address}:${port}\n`);
}
if (!process.env.APP_PASSWORD) console.log('\nFirst set a password: npm run password   (then npm run background:on)');
if (!found.length) { if (!tailscale.length) console.log('\nThis Mac is not connected to Wi-Fi or a home network right now.'); process.exit(0); }
console.log('\nAT HOME (same Wi-Fi as this Mac), open Safari and type:\n');
console.log(`    http://${found[0].address}:${port}\n`);
if (found.length > 1) console.log(`If that doesn't open, try: ${found.slice(1).map((n) => `http://${n.address}:${port}`).join('  or  ')}\n`);
