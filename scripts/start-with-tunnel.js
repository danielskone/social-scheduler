// Runs the scheduler on your own computer with a free Cloudflare quick tunnel, so
// Instagram can download your media. The tunnel address changes every run; this
// script picks it up automatically. Requires `cloudflared` (brew install cloudflared).
require('dotenv').config();
const { spawn } = require('child_process');

const port = process.env.PORT || 3000;
const tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`]);
let started = false;

tunnel.on('error', (err) => {
  console.error(err.code === 'ENOENT'
    ? 'cloudflared is not installed. Run: brew install cloudflared'
    : `Could not start cloudflared: ${err.message}`);
  process.exit(1);
});

function onOutput(chunk) {
  const m = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m && !started) {
    started = true;
    process.env.PUBLIC_BASE_URL = m[0];
    process.env.OAUTH_BASE_URL = process.env.OAUTH_BASE_URL || `http://localhost:${port}`;
    console.log(`Public address for Instagram media: ${m[0]}`);
    require('../src/server').startApp();
  }
}
tunnel.stdout.on('data', onOutput);
tunnel.stderr.on('data', onOutput);
tunnel.on('exit', (code) => { console.error(`Tunnel stopped (code ${code}).`); process.exit(1); });
process.on('SIGINT', () => { tunnel.kill(); process.exit(0); });
