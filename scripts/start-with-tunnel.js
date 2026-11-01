// Runs the scheduler on your own computer with a free Cloudflare quick tunnel, so
// Instagram can download your media. The tunnel address changes every run; this
// script picks it up automatically. Requires `cloudflared`.
//
// The app starts right away (Facebook posting and the dashboard don't need the tunnel).
// If the tunnel fails or drops, it is retried in the background and the new address is
// used for Instagram from then on.
require('dotenv').config();
const port = process.env.PORT || 3000;
process.env.OAUTH_BASE_URL = process.env.OAUTH_BASE_URL || `http://localhost:${port}`;

const { spawn } = require('child_process');
const config = require('../src/config');

// Quick-tunnel addresses look like https://some-random-words.trycloudflare.com.
// cloudflared also logs https://api.trycloudflare.com, which is not a tunnel address.
const TUNNEL_URL = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/;

let tunnel = null;
let attempt = 0;
let stopping = false;

function startTunnel() {
  attempt += 1;
  let found = false;
  let recent = [];
  tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`]);

  tunnel.on('error', (err) => {
    console.error(err.code === 'ENOENT'
      ? 'cloudflared is not installed, so Instagram posts will not work. Facebook still works.'
      : `Could not start cloudflared: ${err.message}`);
  });

  const onOutput = (chunk) => {
    const text = String(chunk);
    recent = recent.concat(text.split('\n').filter(Boolean)).slice(-5);
    const m = text.match(TUNNEL_URL);
    if (m && !found) {
      found = true;
      attempt = 0;
      config.publicBaseUrl = m[0];
      console.log(`Public address for Instagram media: ${m[0]}`);
    }
  };
  tunnel.stdout.on('data', onOutput);
  tunnel.stderr.on('data', onOutput);

  tunnel.on('exit', (code) => {
    if (stopping) return;
    config.publicBaseUrl = `http://localhost:${port}`;
    const wait = Math.min(60, 5 * attempt);
    console.error(`Instagram tunnel stopped (code ${code}). Retrying in ${wait} seconds. The app is still running.`);
    if (!found && recent.length) console.error(`  cloudflared said: ${recent[recent.length - 1]}`);
    setTimeout(startTunnel, wait * 1000);
  });
}

require('../src/server').startApp();
startTunnel();

function shutdown() {
  stopping = true;
  if (tunnel) tunnel.kill();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
