// A Facebook post that fails because the Mac couldn't connect at all (internet hiccup) was never
// sent, so it is tried again by itself. A POST that connected but got no answer is not.
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-'));

test('could not connect = safe to try again; connected then cut off = not', async () => {
  // A port nobody listens on: the connection is refused before anything is sent.
  const free = net.createServer();
  await new Promise((r) => free.listen(0, '127.0.0.1', r));
  const port = free.address().port;
  await new Promise((r) => free.close(r));
  process.env.GRAPH_BASE = `http://127.0.0.1:${port}`;
  const meta = require('../src/meta');
  const err = await meta.call('POST', 'PAGE1/feed', { message: 'hi' }).catch((e) => e);
  assert.equal(err.cause?.code, 'ECONNREFUSED');
  assert.equal(err.safeToRetry, true);
  assert.match(err.message, /hiccup/);

  // A server that accepts the connection and then hangs up without answering.
  const rude = net.createServer((sock) => sock.destroy());
  await new Promise((r) => rude.listen(0, '127.0.0.1', r));
  const err2 = await meta.call('POST', 'PAGE1/feed', { message: 'hi' }, { base: `http://127.0.0.1:${rude.address().port}` }).catch((e) => e);
  rude.close();
  assert.equal(err2.safeToRetry, false);
});
