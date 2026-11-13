// Conversations: emails from people in the CRM come into the inbox, and you answer from the CRM.
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A tiny fake mail server (just enough SMTP for nodemailer).
const mails = [];
const smtp = net.createServer((sock) => {
  let data = false, buf = '', cur = { rcpt: [], body: '' };
  const say = (l) => sock.write(l + '\r\n');
  say('220 fake ESMTP');
  sock.on('data', (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (data) { if (line === '.') { data = false; mails.push(cur); cur = { rcpt: [], body: '' }; say('250 OK'); } else cur.body += line + '\n'; continue; }
      const cmd = line.toUpperCase();
      if (cmd.startsWith('EHLO')) sock.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (cmd.startsWith('AUTH')) say('235 OK');
      else if (cmd.startsWith('RCPT TO')) { cur.rcpt.push(line.match(/<(.+)>/)[1]); say('250 OK'); }
      else if (cmd === 'DATA') { data = true; say('354 go'); }
      else if (cmd === 'QUIT') { say('221 bye'); sock.end(); }
      else say('250 OK');
    }
  });
});
const pings = [];
const ntfy = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { pings.push(b); res.end('{}'); }); });

// A stand-in mailbox with three emails: one from a person in the CRM, one stranger, one newsletter.
const raw = (from, subject, body, id, extra = '') => Buffer.from(`From: ${from}\r\nTo: daniel@viralattraction.com\r\nSubject: ${subject}\r\nMessage-ID: ${id}\r\nDate: Fri, 13 Nov 2026 15:00:00 +0000\r\n${extra}Content-Type: text/plain; charset=utf-8\r\n\r\n${body}`);
const inboxMsgs = [
  { from: 'amy@shop.com', name: 'Amy Wu', src: raw('Amy Wu <amy@shop.com>', 'Sponsorship question', 'Hi Daniel,\r\nIs the gold level still open?\r\n\r\nOn Thu, Nov 12, 2026 at 9:00 AM Daniel King <daniel@viralattraction.com> wrote:\r\n> Thanks for your interest\r\n', '<m1@shop.com>') },
  { from: 'random@spam.com', name: 'Spam', src: raw('random@spam.com', 'You won', 'Click here', '<m2@spam.com>') },
  { from: 'amy@shop.com', name: 'Amy Wu', src: raw('Amy Wu <amy@shop.com>', 'Re: Sponsorship question', 'Also, can we pay by check?', '<m3@shop.com>', 'In-Reply-To: <m1@shop.com>\r\n') },
];
const client = (list) => ({
  connect: async () => {}, logout: async () => {},
  getMailboxLock: async () => ({ release() {} }),
  search: async () => list.map((_, i) => i + 1),
  fetch: async function* (uids) {
    for (const u of uids) {
      const m = list[u - 1];
      const mid = m.src.toString().match(/Message-ID: (\S+)/)[1];
      yield { uid: u, envelope: { from: [{ address: m.from, name: m.name }], subject: 'x', messageId: mid }, source: m.src, internalDate: new Date() };
    }
  },
});

let inbox, base, server;
const j = async (p, opts = {}) => {
  if (opts.json) { opts.body = JSON.stringify(opts.json); opts.headers = { 'Content-Type': 'application/json' }; delete opts.json; }
  const r = await fetch(base + p, opts);
  return { status: r.status, body: await r.json() };
};
test.before(async () => {
  await new Promise((r) => smtp.listen(0, r));
  await new Promise((r) => ntfy.listen(0, r));
  Object.assign(process.env, {
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-')), NTFY_BASE: `http://127.0.0.1:${ntfy.address().port}`, APP_PASSWORD: '',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port), SMTP_PASS: 'secret', IMAP_HOST: 'imap.test',
    EMAIL_FROM: 'daniel@viralattraction.com', EMAIL_FROM_NAME: 'Daniel King', EMAIL_MAILING_ADDRESS: 'PO Box 1, Fuquay-Varina, NC 27526',
  });
  const app = require('../../src/server');
  inbox = require('../server/inbox');
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/crm`;
  await j('/phone-alerts', { method: 'POST' }); // turn on phone alerts
});
test.after(() => { smtp.close(); ntfy.close(); server.close(); });

test('keeps only their new words, not the quoted older email', () => {
  assert.strictEqual(inbox.newPart('Yes!\n\nOn Fri, Nov 13 Daniel <\nd@x.com> wrote:\n> old'), 'Yes!');
  assert.strictEqual(inbox.newPart('Sure\n\nFrom: Daniel\nSent: Friday\n\nold'), 'Sure');
  assert.strictEqual(inbox.newPart('> only quoted\nreal line'), 'real line');
});

test('emails from people in the CRM come in once; strangers stay out', async () => {
  const amy = (await j('/contacts', { method: 'POST', json: { name: 'Amy Wu', email: 'Amy@Shop.com', group_name: 'Parade sponsor' } })).body;
  const r = await inbox.check({ client: client(inboxMsgs) });
  assert.deepStrictEqual(r, { ok: true, added: 2 });
  assert.deepStrictEqual(await inbox.check({ client: client(inboxMsgs) }), { ok: true, added: 0 }, 'no doubles');
  const list = (await j('/inbox')).body;
  assert.strictEqual(list.conversations.length, 1);
  assert.strictEqual(list.conversations[0].name, 'Amy Wu');
  assert.strictEqual(list.unread, 2);
  assert.match(list.conversations[0].snippet, /pay by check/);
  // Only her business sees it.
  const bizes = (await j('/businesses')).body;
  const va = bizes.find((b) => b.groups.includes('Viral Attraction lead'));
  assert.strictEqual((await j(`/inbox?biz=${va.id}`)).body.conversations.length, 0);
  // Opening it marks it read and shows her words without the quote.
  const t = (await j(`/inbox/${amy.id}`)).body;
  assert.deepStrictEqual(t.messages.map((m) => m.body), ['Hi Daniel,\nIs the gold level still open?', 'Also, can we pay by check?']);
  assert.strictEqual(t.messages[0].more, true);
  assert.strictEqual((await j('/inbox/unread')).body.unread, 0);
  // It's on her card, and the phone buzzed.
  assert.match((await j(`/contacts/${amy.id}`)).body.activities.map((a) => a.note).join('|'), /Wrote to you: "Sponsorship question"/);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(pings.some((p) => /Email from Amy Wu/.test(p)));
});

test('you answer from the CRM, threaded under their last email, from your own address', async () => {
  const amy = (await j('/contacts?q=amy')).body[0];
  const r = await j(`/inbox/${amy.id}/reply`, { method: 'POST', json: { text: 'Yes, a check is fine.' } });
  assert.strictEqual(r.status, 200);
  const sent = mails.at(-1);
  assert.deepStrictEqual(sent.rcpt.map((x) => x.toLowerCase()), ['amy@shop.com']);
  assert.match(sent.body, /Subject: Re: Sponsorship question/);
  assert.match(sent.body, /In-Reply-To: <m3@shop.com>/);
  assert.match(sent.body, /Yes, a check is fine\./);
  assert.strictEqual(r.body.messages.at(-1).direction, 'out');
  assert.strictEqual((await j('/inbox')).body.conversations[0].direction, 'out');
  assert.strictEqual((await j(`/inbox/${amy.id}/reply`, { method: 'POST', json: { text: '  ' } })).status, 400);
  // Someone marked "Do not contact" who never wrote can't be emailed from here.
  const bo = (await j('/contacts', { method: 'POST', json: { name: 'Bo', email: 'bo@x.com', do_not_contact: true } })).body;
  assert.strictEqual((await j(`/inbox/${bo.id}/reply`, { method: 'POST', json: { text: 'Hi' } })).status, 400);
});
