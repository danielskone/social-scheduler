// Sending from your own mailbox (SMTP, e.g. Hostinger) instead of Brevo: automations,
// campaigns paced and spread over days, and "unsubscribe" replies read from the inbox.
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A tiny fake mail server (just enough SMTP for nodemailer).
const mails = [];
let rejectAuth = false;
const smtp = net.createServer((sock) => {
  let data = false, buf = '', cur = { rcpt: [] };
  const say = (l) => sock.write(l + '\r\n');
  say('220 fake ESMTP');
  sock.on('data', (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (data) {
        if (line === '.') { data = false; mails.push(cur); cur = { rcpt: [] }; say('250 OK queued'); } else cur.body = (cur.body || '') + line + '\n';
        continue;
      }
      const cmd = line.toUpperCase();
      if (cmd.startsWith('EHLO')) { sock.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n'); }
      else if (cmd.startsWith('AUTH')) say(rejectAuth ? '535 5.7.8 Authentication failed' : '235 OK');
      else if (cmd.startsWith('MAIL FROM')) { cur.from = line; say('250 OK'); }
      else if (cmd.startsWith('RCPT TO')) { cur.rcpt.push(line.match(/<(.+)>/)[1]); say('250 OK'); }
      else if (cmd === 'DATA') { data = true; say('354 go'); }
      else if (cmd === 'QUIT') { say('221 bye'); sock.end(); }
      else say('250 OK');
    }
  });
});
const ntfy = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end('{}')); });

let crm, camp, email, auto, db;
const until = async (fn, ms = 3000) => { for (let t = 0; t < ms && !fn(); t += 25) await new Promise((r) => setTimeout(r, 25)); };
test.before(async () => {
  await new Promise((r) => smtp.listen(0, r));
  await new Promise((r) => ntfy.listen(0, r));
  Object.assign(process.env, {
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'mbox-')), NTFY_BASE: `http://127.0.0.1:${ntfy.address().port}`,
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port), SMTP_PASS: 'secret', IMAP_HOST: 'imap.test',
    EMAIL_FROM: 'daniel@viralattraction.com', EMAIL_FROM_NAME: 'Daniel King', EMAIL_MAILING_ADDRESS: 'PO Box 1, Fuquay-Varina, NC 27526',
    EMAIL_GAP_MS: '0', BREVO_API_BASE: 'http://127.0.0.1:1',
  });
  crm = require('../server/crm');
  auto = require('../server/automations');
  camp = require('../server/campaigns');
  email = require('../server/email');
  db = require('../../src/db');
});
test.after(() => { smtp.close(); ntfy.close(); });

test('your own mailbox is used (no Brevo needed) and the password is checked', async () => {
  assert.strictEqual(email.provider(), 'mailbox');
  assert.strictEqual(email.ready(), true);
  assert.deepStrictEqual(await email.verify(), { ok: true });
});

test('welcome email goes out from your mailbox with address and unsubscribe', async () => {
  crm.submitForm({ title: 'viralattraction.com: Contact', group_name: 'Viral Attraction lead' }, { name: 'Ava Stone', email: 'ava@shop.com', message: 'Hi' });
  await until(() => mails.length);
  const m = mails[0];
  assert.deepStrictEqual(m.rcpt, ['ava@shop.com']);
  assert.match(m.from, /daniel@viralattraction.com/);
  assert.match(m.body, /Subject: Thanks for reaching out to Viral Attraction!/);
  assert.match(m.body, /List-Unsubscribe: <mailto:daniel@viralattraction.com\?subject=unsubscribe>/);
  assert.match(m.body, /PO Box 1, Fuquay-Varina, NC 27526/);
  assert.match(m.body, /text\/html/);
});

test('campaign is sent one by one from your mailbox, personalized, never twice', async () => {
  mails.length = 0;
  for (const [n, e] of [['Ann Lee', 'ann@x.com'], ['Bo Ray', 'bo@x.com'], ['Cy Old', 'cy@x.com']])
    crm.createContact({ name: n, email: e, group_name: 'Volunteer', email_ok: true, email_ok_source: 'signed up' }, { source: 'import' });
  const tpl = crm.saveTemplate({ name: 'News', channel: 'email', subject: 'News for {first_name}', body: 'Hi {first_name}!', heading: 'Parade news' });
  const seg = camp.saveSegment({ name: 'Volunteers', groups: ['Volunteer'] });
  const c = camp.saveCampaign({ name: 'Volunteer news', template_id: tpl.id, segment_id: seg.id });
  const out = await camp.sendCampaign(c.id);
  assert.strictEqual(out.status, 'sending');
  await until(() => camp.getCampaign(c.id).status === 'sent');
  const got = camp.getCampaign(c.id);
  assert.strictEqual(got.status, 'sent');
  assert.deepStrictEqual(got.mailbox, { sent: 3, failed: 0 });
  assert.deepStrictEqual(mails.map((m) => m.rcpt[0]).sort(), ['ann@x.com', 'bo@x.com', 'cy@x.com']);
  assert.ok(mails.some((m) => /Subject: News for Bo/.test(m.body)));
  await camp.runMailboxCampaigns();
  assert.strictEqual(mails.length, 3, 'nobody gets it twice');
});

test('over the daily limit: carries on the next day by itself', async () => {
  mails.length = 0;
  const sentSoFar = email.status().sentToday;
  process.env.EMAIL_DAILY_LIMIT = String(sentSoFar + 1);
  const tpl = db.prepare("SELECT id FROM crm_templates WHERE name='News'").get().id;
  const seg = db.prepare("SELECT id FROM crm_segments WHERE name='Volunteers'").get().id;
  const c = await camp.sendCampaign(camp.saveCampaign({ name: 'Big one', template_id: tpl, segment_id: seg }).id);
  await until(() => mails.length >= 1);
  await camp.runMailboxCampaigns();
  assert.strictEqual(mails.length, 1);
  assert.strictEqual(camp.getCampaign(c.id).status, 'sending');
  // "Next day": the limit has room again.
  process.env.EMAIL_DAILY_LIMIT = '1000';
  await camp.runMailboxCampaigns();
  assert.strictEqual(mails.length, 3);
  assert.strictEqual(camp.getCampaign(c.id).status, 'sent');
  delete process.env.EMAIL_DAILY_LIMIT;
});

test('scheduled campaign waits for its time', async () => {
  mails.length = 0;
  const tpl = db.prepare("SELECT id FROM crm_templates WHERE name='News'").get().id;
  const seg = db.prepare("SELECT id FROM crm_segments WHERE name='Volunteers'").get().id;
  const when = new Date(Date.now() + 3600e3).toISOString();
  const c = await camp.sendCampaign(camp.saveCampaign({ name: 'Later', template_id: tpl, segment_id: seg, send_at: when }).id);
  assert.strictEqual(c.status, 'scheduled');
  await camp.runMailboxCampaigns();
  assert.strictEqual(mails.length, 0);
  await camp.runMailboxCampaigns({ gapMs: 0, now: new Date(Date.now() + 2 * 3600e3) });
  assert.strictEqual(mails.length, 3);
});

test('a wrong password stops the campaign with a clear message', async () => {
  rejectAuth = true;
  const tpl = db.prepare("SELECT id FROM crm_templates WHERE name='News'").get().id;
  const seg = db.prepare("SELECT id FROM crm_segments WHERE name='Volunteers'").get().id;
  process.env.SMTP_PASS = 'wrong'; // new password -> new connection
  const c = await camp.sendCampaign(camp.saveCampaign({ name: 'Bad pass', template_id: tpl, segment_id: seg }).id);
  await until(() => camp.getCampaign(c.id).status === 'failed');
  assert.match(camp.getCampaign(c.id).error, /password is wrong/);
  rejectAuth = false; process.env.SMTP_PASS = 'secret';
});

test('"unsubscribe" replies in your inbox become Do not contact (quoted footers ignored)', async () => {
  const msgs = [
    { from: 'ann@x.com', subject: 'unsubscribe', body: '' },
    { from: 'bo@x.com', subject: 'Re: News for Bo', body: 'Thanks, see you there!\n\n> Don\'t want emails from us? reply "unsubscribe"' },
    { from: 'cy@x.com', subject: 'Re: News for Cy', body: 'STOP\n\n> old message' },
  ];
  const client = {
    connect: async () => {}, logout: async () => {},
    getMailboxLock: async () => ({ release() {} }),
    search: async () => msgs.map((_, i) => i + 1),
    fetch: async function* (uids) {
      for (const u of uids) {
        const m = msgs[u - 1];
        yield { envelope: { from: [{ address: m.from }], subject: m.subject }, source: Buffer.from(`Subject: ${m.subject}\r\nContent-Type: text/plain\r\n\r\n${m.body}`) };
      }
    },
  };
  const n = await camp.syncUnsubscribes({ client });
  assert.strictEqual(n, 2);
  const dnc = (e) => crm.listContacts({ q: e })[0].do_not_contact;
  assert.strictEqual(dnc('ann@x.com'), 1);
  assert.strictEqual(dnc('bo@x.com'), 0);
  assert.strictEqual(dnc('cy@x.com'), 1);
  assert.match(crm.getContact(crm.listContacts({ q: 'ann@x.com' })[0].id).activities.map((a) => a.note).join('|'), /replied "unsubscribe"/);
});
