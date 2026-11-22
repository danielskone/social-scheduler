// "Fix words": one fix ("can you can't lay" -> "Candy Cane Lane") fixes a video everywhere.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wordfix-'));
const db = require('../src/db');
const wordfix = require('../src/wordfix');

test('finds the wrong words whatever the capitals and commas between them', () => {
  const r = wordfix.fixText("Take a trip down, can you can't lay with me?", "trip down can you can't lay", 'trip down Candy Cane Lane');
  assert.deepEqual(r, { text: 'Take a trip down Candy Cane Lane with me?', count: 1 });
  assert.equal(wordfix.fixText("CAN YOU CAN’T LAY", "can you can't lay", 'Candy Cane Lane').text, 'Candy Cane Lane');
  // Only whole words: "lay" is not changed inside "player".
  assert.equal(wordfix.fixText('the player', 'lay', 'Lane').count, 0);
  assert.equal(wordfix.fixText('x', '  ,, ', 'y').count, 0);
});

test('the transcript keeps the timing, so captions still follow the voice', () => {
  const w = (text, start, end) => ({ text, start, end });
  const transcript = { segments: [
    { start: 0, end: 2, text: 'Take a trip down, can you', words: [w('Take', 0, 0.3), w('a', 0.3, 0.4), w('trip', 0.4, 0.8), w('down,', 0.8, 1.2), w('can', 1.2, 1.6), w('you', 1.6, 2)] },
    { start: 2, end: 4, text: "can't lay with me?", words: [w("can't", 2, 2.5), w('lay', 2.5, 3), w('with', 3, 3.5), w('me?', 3.5, 4)] },
  ] };
  assert.equal(wordfix.fixTranscript(transcript, "can you can't lay", 'Candy Cane Lane'), 1);
  const words = transcript.segments.flatMap((s) => s.words);
  assert.deepEqual(words.map((x) => x.text), ['Take', 'a', 'trip', 'down,', 'Candy', 'Cane', 'Lane', 'with', 'me?']);
  const lane = words[6];
  assert.ok(words[4].start === 1.2 && lane.end === 3, 'the new words take the time the wrong ones took');
  assert.equal(transcript.segments[0].text, 'Take a trip down, Candy Cane Lane');
  assert.equal(transcript.segments[1].text, 'with me?');
});

test('remembered fixes are used on new videos', () => {
  wordfix.remember("can you can't lay", 'Candy Cane Lane');
  wordfix.remember("Can you can't lay", 'Candy Cane Lane'); // same fix again: kept once
  assert.equal(wordfix.list().length, 1);
  const t = { segments: [{ start: 0, end: 2, text: "can you can't lay", words: "can you can't lay".split(' ').map((text, i) => ({ text, start: i * 0.5, end: i * 0.5 + 0.5 })) }] };
  assert.equal(wordfix.applySaved(t), 1);
  assert.equal(t.segments[0].text, 'Candy Cane Lane');
  wordfix.forget(wordfix.list()[0].id);
  assert.equal(wordfix.list().length, 0);
});

test('Fix words in Viral Clips fixes every clip and the posts not sent yet', async () => {
  const express = require('express');
  const clipper = require('../src/clipper');
  const app = express();
  app.use(express.json());
  app.use('/api/clips', clipper.router);
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const root = `http://127.0.0.1:${server.address().port}`;
  const words = (s, a) => s.split(' ').map((text, i) => ({ text, start: a + i * 0.5, end: a + i * 0.5 + 0.5 }));
  const transcript = { segments: [{ start: 0, end: 4, text: "Take a trip down, can you can't lay with me?", words: words("Take a trip down, can you can't lay with me?", 0) }], loudness: [] };
  const job = db.prepare(`INSERT INTO clip_jobs (name, source_file, settings, status, transcript) VALUES ('Elves','/nope.mp4','{}','ready',?)`).run(JSON.stringify(transcript)).lastInsertRowid;
  const clip = (title, text) => db.prepare(`INSERT INTO clips (job_id, n, start, end, score, title, text, status) VALUES (?,1,0,4,1,?,?,'ready')`).run(job, title, text).lastInsertRowid;
  const c1 = clip("Take a trip down, can you can't lay with me?", "Take a trip down, can you can't lay with me?");
  const c2 = clip('The leaders of', 'Something else');
  const acct = db.prepare(`INSERT INTO accounts (platform, external_id, name, access_token) VALUES ('facebook','P9','Page','t')`).run().lastInsertRowid;
  const post = (status, clipId) => {
    const id = db.prepare(`INSERT INTO posts (caption, title, scheduled_at, clip_id) VALUES (?,?,?,?)`).run("Take a trip down, can you can't lay with me?", "Can you can't lay", new Date().toISOString(), clipId).lastInsertRowid;
    db.prepare('INSERT INTO post_targets (post_id, account_id, status) VALUES (?,?,?)').run(id, acct, status);
    return id;
  };
  const waiting = post('scheduled', c1), sent = post('published', null);
  const failedToo = post('published', null);
  db.prepare(`INSERT INTO post_targets (post_id, account_id, status) VALUES (?,?,'failed')`).run(failedToo, acct);

  const bad = await fetch(`${root}/api/clips/${job}/fix-words`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wrong: '', right: 'x' }) });
  assert.equal(bad.status, 400);
  const r = await (await fetch(`${root}/api/clips/${job}/fix-words`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wrong: "can you can't lay", right: 'Candy Cane Lane' }) })).json();
  assert.equal(r.clips, 2, 'the second clip is remade too: its captions come from the fixed transcript');
  assert.equal(r.transcript, 1);
  assert.equal(r.fixed, 2, 'the waiting post and the partly-sent post with a failed account');
  assert.equal(r.alreadyOut, 2);
  const got = db.prepare('SELECT title, text FROM clips WHERE id=?').get(c1);
  assert.equal(got.text, 'Take a trip down, Candy Cane Lane with me?');
  assert.equal(got.title, 'Take a trip down, Candy Cane Lane with me?');
  assert.equal(db.prepare('SELECT caption FROM posts WHERE id=?').get(waiting).caption, 'Take a trip down, Candy Cane Lane with me?');
  assert.equal(db.prepare('SELECT title FROM posts WHERE id=?').get(failedToo).title, 'Candy Cane Lane');
  assert.match(db.prepare('SELECT caption FROM posts WHERE id=?').get(sent).caption, /can you can't lay/, 'a post fully sent is left as it went out');
  assert.equal(JSON.parse(db.prepare('SELECT transcript FROM clip_jobs WHERE id=?').get(job).transcript).segments[0].text, 'Take a trip down, Candy Cane Lane with me?');
  assert.equal(wordfix.list().length, 1, 'remembered for new videos');
  const saved = await (await fetch(`${root}/api/clips/word-fixes`)).json();
  assert.equal(saved[0].right, 'Candy Cane Lane');
  server.close();
});

test('a remade clip replaces the video in its posts that have not gone out', () => {
  const config = require('../src/config');
  const clipper = require('../src/clipper');
  const job = db.prepare(`INSERT INTO clip_jobs (name, source_file, settings, status) VALUES ('V','','{}','ready')`).run().lastInsertRowid;
  fs.mkdirSync(path.join(config.dataDir, 'clips', String(job)), { recursive: true });
  fs.writeFileSync(path.join(config.dataDir, 'clips', String(job), 'clip-1-ab.mp4'), 'new video');
  const clip = db.prepare(`INSERT INTO clips (job_id, n, start, end, score, title, text, status, file) VALUES (?,1,0,4,1,'t','x','ready','clip-1-ab.mp4')`).run(job).lastInsertRowid;
  fs.writeFileSync(path.join(config.mediaDir, 'old.mp4'), 'old video');
  fs.writeFileSync(path.join(config.mediaDir, 'out.mp4'), 'old video');
  const acct = db.prepare('SELECT id FROM accounts LIMIT 1').get().id;
  const mk = (file, status) => {
    const id = db.prepare(`INSERT INTO posts (caption, media_file, media_type, scheduled_at, clip_id) VALUES ('c',?,'video',?,?)`).run(file, new Date().toISOString(), clip).lastInsertRowid;
    db.prepare('INSERT INTO post_targets (post_id, account_id, status) VALUES (?,?,?)').run(id, acct, status);
    return id;
  };
  const waiting = mk('old.mp4', 'scheduled'), out = mk('out.mp4', 'published');
  clipper.refreshPosts(clip);
  const f = db.prepare('SELECT media_file FROM posts WHERE id=?').get(waiting).media_file;
  assert.notEqual(f, 'old.mp4');
  assert.equal(fs.readFileSync(path.join(config.mediaDir, f), 'utf8'), 'new video');
  assert.ok(!fs.existsSync(path.join(config.mediaDir, 'old.mp4')), 'the old copy is cleaned up');
  assert.equal(db.prepare('SELECT media_file FROM posts WHERE id=?').get(out).media_file, 'out.mp4');
});

test('the Candy Cane Lane fix runs by itself once, then buzzes the phone when the clips are made', async () => {
  const clipper = require('../src/clipper');
  const words = (s) => s.split(' ').map((text, i) => ({ text, start: i * 0.5, end: i * 0.5 + 0.5 }));
  const transcript = { segments: [{ start: 0, end: 5, text: "Take a trip down can you can't lay with me", words: words("Take a trip down can you can't lay with me") }] };
  const job = db.prepare(`INSERT INTO clip_jobs (name, source_file, settings, status, transcript) VALUES ('Elves 2','/nope.mp4','{}','ready',?)`).run(JSON.stringify(transcript)).lastInsertRowid;
  const clip = db.prepare(`INSERT INTO clips (job_id, n, start, end, score, title, text, status) VALUES (?,1,0,5,1,'Elves',?,'ready')`).run(job, "Take a trip down can you can't lay with me").lastInsertRowid;
  const acct = db.prepare('SELECT id FROM accounts LIMIT 1').get().id;
  const pid = db.prepare(`INSERT INTO posts (caption, scheduled_at) VALUES (?, ?)`).run("Candy can't lane with me!", new Date(Date.now() + 864e5).toISOString()).lastInsertRowid;
  db.prepare('INSERT INTO post_targets (post_id, account_id, status) VALUES (?,?,?)').run(pid, acct, 'scheduled');

  assert.ok(clipper.applyStarterFixes() >= 1);
  assert.equal(clipper.applyStarterFixes(), 0, 'only once');
  const c = db.prepare('SELECT text, status FROM clips WHERE id=?').get(clip);
  assert.equal(c.text, 'Take a trip down Candy Cane Lane with me');
  assert.equal(c.status, 'pending', 'made again');
  assert.equal(db.prepare('SELECT caption FROM posts WHERE id=?').get(pid).caption, 'Candy Cane Lane with me!');
  assert.ok(wordfix.list().some((f) => f.wrong === "can you can't lay"), 'remembered for new videos');

  // The buzz waits for the clip, then goes once.
  const sent = [];
  const notify = require('../src/notify');
  const orig = notify.send;
  notify.send = async (title, msg) => { sent.push(`${title}: ${msg}`); return true; };
  await clipper.checkFixRuns();
  assert.equal(sent.length, 0, 'clip still being made');
  db.prepare(`UPDATE clips SET status='ready' WHERE id=?`).run(clip);
  await clipper.checkFixRuns();
  await clipper.checkFixRuns();
  notify.send = orig;
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Candy Cane Lane/);
  assert.match(sent[0], /post/);
});
