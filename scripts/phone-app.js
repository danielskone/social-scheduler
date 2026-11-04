// npm run phone-app : shows the address to open Viral Post on your iPhone (same Wi-Fi).
const os = require('os');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const port = process.env.PORT || 3000;
const ips = Object.values(os.networkInterfaces()).flat()
  .filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
if (!process.env.APP_PASSWORD) console.log('\nFirst set a password: npm run password   (then npm run background:on)');
if (!ips.length) { console.log('\nThis Mac is not on a network right now.'); process.exit(0); }
console.log('\nOn your iPhone (on the same Wi-Fi as this Mac), open Safari and type:\n');
console.log(`    http://${ips[0]}:${port}\n`);
