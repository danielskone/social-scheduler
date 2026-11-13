// Facebook and Instagram messages, the chat answer bot, the team tasks board and business templates.
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
      else if (cmd.startsWith('RCPT TO')) { cur.rcpt.push(line.match(/<(.+)>/)[1].toLowerCase()); say('250 OK'); }
      else if (cmd === 'DATA') { data = true; say('354 go'); }
      else if (cmd === 'QUIT') { say('221 bye'); sock.end(); }
      else say(cmd.startsWith('AUTH') ? '235 OK' : '250 OK');
    }
  });
});
const ntfy = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end('{}')); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let root, server;
const OWNER = { Authorization: `Basic ${Buffer.from(':owner-pass-123').toString('base64')}` };
const j = async (p, opts = {}) => {
  const pub = !opts.api && /^\/(chat)(\/|$)/.test(p);
  delete opts.api;
  if (!pub) opts.headers = { ...OWNER, ...(opts.headers || {}) };
  if (opts.json) { opts.body = JSON.stringify(opts.json); opts.headers = { ...(opts.headers || {}), 'Content-Type': 'application/json' }; delete opts.json; }
  const r = await fetch(root + (pub ? p : `/api/crm${p}`), { redirect: 'manual', ...opts });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body, headers: r.headers };
};
test.before(async () => {
  for (const s of [smtp, ntfy]) await new Promise((r) => s.listen(0, '127.0.0.1', r));
  Object.assign(process.env, {
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'next4-')), NTFY_BASE: `http://127.0.0.1:${ntfy.address().port}`, APP_PASSWORD: 'owner-pass-123',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port), SMTP_PASS: 'x',
    EMAIL_FROM: 'daniel@viralattraction.com', EMAIL_FROM_NAME: 'Daniel King', EMAIL_MAILING_ADDRESS: 'PO Box 1, Fuquay-Varina, NC 27526', PUBLIC_BASE_URL: 'https://example.test',
  });
  server = require('../../src/server').listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  root = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { for (const s of [smtp, ntfy, server]) s.close(); });

test('Facebook and Instagram messages: new people become contacts, show in Conversations, answer within 24 hours', async () => {
  const db = require('../../src/db');
  const social = require('../server/social');
  const add = db.prepare("INSERT INTO accounts (platform, external_id, name, username, access_token) VALUES (?,?,?,?,?)");
  const page = add.run('facebook', 'PAGE1', 'Parade Page', null, 'page-token').lastInsertRowid;
  const ig = add.run('instagram', 'IG1', 'Parade IG', 'fvparade', 'page-token').lastInsertRowid;
  const now = Date.now(), iso = (msAgo) => new Date(now - msAgo).toISOString().replace('Z', '+0000');
  const calls = [];
  const graph = async (method, p, params) => {
    calls.push({ method, p, params });
    if (method === 'POST') return { recipient_id: JSON.parse(params.recipient).id, message_id: `m_out_${calls.length}` };
    if (params.platform === 'messenger') return { data: [{ id: 't1', updated_time: iso(60e3), messages: { data: [
      { id: 'm2', message: 'Can my band be in the parade?', created_time: iso(60e3), from: { id: 'U1', name: 'Rosa Diaz', email: 'rosa@band.org' }, to: { data: [{ id: 'PAGE1' }] } },
      { id: 'm1', message: 'Hi!', created_time: iso(2 * 86400e3), from: { id: 'U1', name: 'Rosa Diaz' }, to: { data: [{ id: 'PAGE1' }] } },
    ] } }] };
    return { data: [{ id: 't2', updated_time: iso(30 * 3600e3), messages: { data: [
      { id: 'g2', message: 'Thanks!', created_time: iso(30 * 3600e3), from: { id: 'IG1', username: 'fvparade' }, to: { data: [{ id: 'IGU9', username: 'sam.bakes' }] } },
      { id: 'g1', message: 'Do you need food trucks?', created_time: iso(31 * 3600e3), from: { id: 'IGU9', username: 'sam.bakes' }, to: { data: [{ id: 'IG1' }] } },
    ] } }] };
  };
  const r = await social.check({ graph });
  assert.strictEqual(r.ok, true);
  const rosa = db.prepare("SELECT * FROM contacts WHERE email='rosa@band.org'").get();
  assert.ok(rosa, 'Messenger sender became a contact (with the email Facebook shared)');
  const sam = db.prepare("SELECT * FROM contacts WHERE name='@sam.bakes'").get();
  assert.ok(sam, 'Instagram sender became a contact named by their @username');
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM crm_messages WHERE contact_id=?").get(sam.id).n, 2, 'both sides of the Instagram chat saved');
  // Running again adds nothing twice.
  assert.strictEqual((await social.check({ graph })).added, 0);
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM crm_messages WHERE channel IN ('facebook','instagram')").get().n, 4);

  const list = (await j('/inbox')).body;
  const row = list.conversations.find((c) => c.id === rosa.id);
  assert.strictEqual(row.channel, 'facebook');
  const t = (await j(`/inbox/${rosa.id}`)).body;
  assert.strictEqual(t.social.channel, 'facebook');
  assert.strictEqual(t.social.open, true);
  assert.strictEqual(t.social.account, 'Parade Page');

  // Answer Rosa (inside 24 hours) through the Page.
  await social.reply(rosa.id, 'Yes! Fill out the entry form.', graph);
  const post = calls.find((c) => c.method === 'POST');
  assert.strictEqual(post.p, 'PAGE1/messages');
  assert.strictEqual(JSON.parse(post.params.recipient).id, 'U1');
  assert.strictEqual(post.params.messaging_type, 'RESPONSE');
  // Sam wrote 31 hours ago: Facebook's 24-hour rule.
  await assert.rejects(social.reply(sam.id, 'Yes please', graph), /24 hours/);
  const ts = (await j(`/inbox/${sam.id}`)).body;
  assert.strictEqual(ts.social.channel, 'instagram');
  assert.strictEqual(ts.social.open, false);
  assert.strictEqual(ts.social.account, '@fvparade');

  // Settings: turn one account off, choose the group for new people.
  const st = (await j(`/social/accounts/${ig}`, { method: 'PUT', json: { enabled: false, group_name: 'Vendor' } })).body;
  const igRow = st.accounts.find((a) => a.id === ig);
  assert.strictEqual(igRow.enabled, false);
  assert.strictEqual(igRow.group_name, 'Vendor');
  assert.ok(!('access_token' in igRow), 'tokens never go to the page');
  assert.strictEqual(st.accounts.find((a) => a.id === page).page_id, 'PAGE1');

  // A permission problem gives a plain "reconnect" message.
  const bad = async () => { throw Object.assign(new Error('(#10) needs pages_messaging'), { code: 10 }); };
  await social.check({ graph: bad });
  assert.match((await j('/social')).body.accounts.find((a) => a.id === page).last_error, /Reconnect Facebook and Instagram/);
});

test('website chat answer bot: answers from your list, says a person is coming once, quiet when you are chatting', async () => {
  const s = (await j('/chat/settings', { api: true })).body;
  await j('/chat/settings', { api: true, method: 'PUT', json: { bot_on: true } });
  await j('/chat/faq', { api: true, method: 'POST', json: { question: 'What are your hours?', answer: 'We are open 9 to 5, Monday to Friday.', keywords: 'open, close' } });
  const after = (await j('/chat/faq', { api: true, method: 'POST', json: { question: 'How much does a sponsorship cost?', answer: 'Sponsorships start at $250.', keywords: 'price, sponsor' } })).body;
  assert.strictEqual(after.faq.length, 2);
  assert.strictEqual((await j('/chat/faq', { api: true, method: 'POST', json: { question: 'x' } })).status, 400);
  assert.strictEqual((await j('/chat/faq-test', { api: true, method: 'POST', json: { text: 'when do you open tomorrow?' } })).body.question, 'What are your hours?');
  assert.strictEqual((await j('/chat/faq-test', { api: true, method: 'POST', json: { text: 'what is the price to sponsor?' } })).body.question, 'How much does a sponsorship cost?');
  assert.strictEqual((await j('/chat/faq-test', { api: true, method: 'POST', json: { text: 'Is parking free?' } })).body.answer, null);

  const page = (await j(`/chat/${s.key}`)).body;
  assert.match(page, /What are your hours\?/, 'common questions show as buttons in the bubble');
  const start = (await j(`/chat/${s.key}/start`, { method: 'POST', json: { name: 'Lee Park', email: 'lee@park.com', text: 'What hours are you open?' } })).body;
  let m = (await j(`/chat/${s.key}/poll?token=${start.token}&after=0`)).body.messages;
  assert.deepStrictEqual(m.map((x) => x.me), [true, false]);
  assert.match(m[1].text, /open 9 to 5/);
  m = (await j(`/chat/${s.key}/send`, { method: 'POST', json: { token: start.token, text: 'Is parking free?' } })).body.messages;
  assert.match(m[m.length - 1].text, /A person will answer/);
  m = (await j(`/chat/${s.key}/send`, { method: 'POST', json: { token: start.token, text: 'Hello?' } })).body.messages;
  assert.strictEqual(m.filter((x) => /A person will answer/.test(x.text)).length, 1, 'the "a person is coming" note only comes once');
  // You answer: the bot stays quiet for 30 minutes.
  const lee = require('../../src/db').prepare("SELECT id FROM contacts WHERE email='lee@park.com'").get();
  await j(`/chat/${lee.id}/reply`, { api: true, method: 'POST', json: { text: 'Hi Lee, yes parking is free.' } });
  m = (await j(`/chat/${s.key}/send`, { method: 'POST', json: { token: start.token, text: 'And what hours on Saturday?' } })).body.messages;
  assert.strictEqual(m[m.length - 1].me, true, 'no bot answer while a person is chatting');
  const thread = (await j(`/inbox/${lee.id}`)).body;
  assert.ok(thread.messages.some((x) => x.subject === 'Answer bot'), 'bot answers show in Conversations');
  const faq = (await j('/chat/settings', { api: true })).body.faq;
  assert.strictEqual(faq.find((f) => f.question === 'What are your hours?').hits, 1);
  await j(`/chat/faq/${faq[0].id}`, { api: true, method: 'DELETE' });
  assert.strictEqual((await j('/chat/settings', { api: true })).body.faq.length, 1);
});

test('team tasks board: columns, who it is for, the "new task" email and the 7am email', async () => {
  const member = (await j('/team', { method: 'POST', json: { name: 'Ana Cruz', email: 'ana@team.org', password: 'ana-pass-123', role: 'helper' } })).body;
  mails.length = 0;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const t1 = (await j('/tasks', { method: 'POST', json: { title: 'Call sponsors', due_on: today, assigned_to: member.id, priority: 'on', notes: 'Use the list' } })).body;
  assert.strictEqual(t1.assigned_to, member.id);
  assert.strictEqual(t1.priority, 1);
  await wait(400);
  assert.ok(mails.some((x) => x.rcpt.includes('ana@team.org') && /New task: Call sponsors/.test(x.body)), 'Ana got a "new task" email');
  const t2 = (await j('/tasks', { method: 'POST', json: { title: 'Order banners', due_on: '2026-01-02' } })).body;
  await j(`/tasks/${t2.id}`, { method: 'PUT', json: { status: 'doing' } });
  const board = (await j('/taskboard/board')).body;
  assert.strictEqual(board.tasks.find((t) => t.id === t2.id).status, 'doing');
  assert.strictEqual(board.tasks.find((t) => t.id === t1.id).assigned_name, 'Ana Cruz');
  assert.ok(board.people.some((p) => p.name === 'Ana Cruz'));
  assert.ok(board.summary.late >= 1);
  // "Mine" for the owner = tasks for nobody in particular.
  assert.ok((await j('/taskboard/board?who=me')).body.tasks.every((t) => !t.assigned_to));
  assert.ok((await j(`/taskboard/board?who=${member.id}`)).body.tasks.every((t) => t.assigned_to === member.id));
  // Done moves it to the Done column, and back again.
  await j(`/tasks/${t2.id}`, { method: 'PUT', json: { status: 'done' } });
  let b2 = (await j('/taskboard/board')).body;
  assert.strictEqual(b2.tasks.find((t) => t.id === t2.id).status, 'done');
  await j(`/tasks/${t2.id}`, { method: 'PUT', json: { status: 'todo' } });
  b2 = (await j('/taskboard/board')).body;
  assert.strictEqual(b2.tasks.find((t) => t.id === t2.id).status, 'todo');
  // 7am email: Ana gets hers, the owner gets the late banner task, and only once a day.
  mails.length = 0;
  const r = await require('../server/tasks').sendDaily();
  assert.strictEqual(r.sent, 2);
  const toAna = mails.find((x) => x.rcpt.includes('ana@team.org'));
  assert.match(toAna.body, /\(Important\) Call sponsors, due today/);
  const toMe = mails.find((x) => x.rcpt.includes('daniel@viralattraction.com'));
  assert.match(toMe.body, /Order banners, late since/);
  assert.strictEqual((await require('../server/tasks').sendDaily()).sent, 0, 'one email a day');
  // Turn it off.
  assert.strictEqual((await j('/taskboard/settings', { method: 'PUT', json: { daily: false } })).body.daily, false);
});

test('business templates: save a business, start a new one from a starter or a file, nothing is sent until you publish', async () => {
  const list = (await j('/biztemplates')).body;
  assert.ok(list.filter((t) => t.starter).length >= 3, 'starter templates are there');
  const bizes = (await j('/businesses')).body;
  const parade = bizes.find((b) => b.groups.includes('Parade sponsor'));
  await j(`/pipelines?biz=${parade.id}`, { method: 'POST', json: { name: 'Sponsors 2027', stages: [{ name: 'New', kind: 'open' }, { name: 'Paid', kind: 'won' }, { name: 'No', kind: 'lost' }] } });
  const saved = (await j('/biztemplates/capture', { method: 'POST', json: { business_id: parade.id, name: 'Parade setup' } })).body;
  assert.strictEqual(saved.name, 'Parade setup');
  assert.ok(saved.counts.groups >= 5);
  assert.ok(saved.counts.automations >= 1, 'automations for its groups come along');
  // Start a new business from it: group names already used get the new name after them.
  const madeR = await j('/biztemplates/apply', { method: 'POST', json: { id: saved.id, name: 'Apex Parade' } });
  const made = madeR.body;
  assert.strictEqual(made.business.name, 'Apex Parade');
  assert.ok(made.business.groups.includes('Parade sponsor (Apex Parade)'));
  assert.ok(made.renamed.length >= 5);
  const db = require('../../src/db');
  const autos = db.prepare("SELECT * FROM crm_automations WHERE name LIKE '%(Apex Parade)'").all();
  assert.ok(autos.length >= 1);
  assert.ok(autos.every((a) => a.active === 0), 'copied automations start as Draft');
  assert.ok(autos.every((a) => JSON.parse(a.trigger_json).group.endsWith('(Apex Parade)')));
  // A starter for a brand-new kind of business.
  const autoR = await j('/biztemplates/apply', { method: 'POST', json: { id: 'starter-auto', name: 'Shine Detailing' } });
  const auto = autoR.body;
  assert.deepStrictEqual(auto.business.groups, ['Auto lead', 'Auto customer (Shine Detailing)']);
  assert.strictEqual(auto.made.forms, 1);
  assert.strictEqual(auto.made.booking, 1);
  assert.strictEqual(auto.made.faq, 3);
  assert.strictEqual(db.prepare('SELECT bot_on FROM crm_chat_settings WHERE business_id=?').get(auto.business.id).bot_on, 1);
  const pipes = db.prepare('SELECT * FROM crm_pipelines WHERE business_id=?').all(auto.business.id);
  assert.deepStrictEqual(JSON.parse(pipes[0].stages).map((s) => s.name), ['New', 'Quote sent', 'Booked', 'Done', 'Lost']);
  // Download as a file and load it again (how it moves into a customer's own copy).
  const file = await fetch(`${root}/api/crm/biztemplates/${saved.id}/download`, { headers: OWNER });
  assert.match(file.headers.get('content-disposition'), /parade-setup\.viraltouch\.json/);
  const data = await file.json();
  assert.strictEqual(data.format, 'viral-touch-template');
  const up = (await j('/biztemplates/upload', { method: 'POST', json: { data } })).body;
  assert.strictEqual(up.counts.groups, saved.counts.groups);
  assert.strictEqual((await j('/biztemplates/upload', { method: 'POST', json: { data: { hello: 1 } } })).status, 400);
  await j(`/biztemplates/${up.id}`, { method: 'DELETE' });
  assert.ok(!(await j('/biztemplates')).body.some((t) => t.id === up.id));
});
