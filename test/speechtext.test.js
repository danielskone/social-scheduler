// Songs: Whisper "hears" music notes and writes broken pieces like "<0xAB>". Those never reach captions.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-'));
const { cleanText, cleanTranscript } = require('../src/speechtext');

test('music-note junk is taken out of words and sentences', () => {
  assert.equal(cleanText('�<0xAB> It\'s a'), "It's a");
  assert.equal(cleanText('♪ Jingle bells ♪'), 'Jingle bells');
  assert.equal(cleanText('<0xE2><0x99><0xAA>'), '');
  const t = cleanTranscript({ loudness: [1], segments: [
    { start: 0, end: 2, text: '�<0xAB> It\'s a beautiful day', words: [
      { text: '�<0xAB>', start: 0, end: 0.5 }, { text: "It's", start: 0.5, end: 1 }, { text: 'a', start: 1, end: 1.2 },
      { text: 'beautiful', start: 1.2, end: 1.7 }, { text: 'day', start: 1.7, end: 2 }] },
    { start: 3, end: 4, text: '♪♪', words: [{ text: '♪♪', start: 3, end: 4 }] },
  ] });
  assert.equal(t.segments.length, 1);
  assert.equal(t.segments[0].text, "It's a beautiful day");
  assert.deepEqual(t.segments[0].words.map((w) => w.text), ["It's", 'a', 'beautiful', 'day']);
  assert.deepEqual(t.loudness, [1]);
});

test('old videos with junk in their captions are cleaned and their clips remade', () => {
  const db = require('../src/db');
  require('../src/clipper'); // makes the tables
  const junk = JSON.stringify({ segments: [{ start: 0, end: 1, text: '�<0xAB> It\'s a', words: [{ text: '�<0xAB>', start: 0, end: 0.4 }, { text: "It's", start: 0.4, end: 0.7 }, { text: 'a', start: 0.7, end: 1 }] }] });
  const job = db.prepare(`INSERT INTO clip_jobs (name, source_file, status, transcript) VALUES ('song', '/x.mp4', 'ready', ?)`).run(junk).lastInsertRowid;
  const clip = db.prepare(`INSERT INTO clips (job_id, n, start, end, text, title, status, file) VALUES (?, 1, 0, 1, ?, ?, 'ready', 'a.mp4')`).run(job, '<0xAB> It\'s a', '<0xAB> It\'s a').lastInsertRowid;
  delete require.cache[require.resolve('../src/clipper')];
  require('../src/clipper'); // the clean-up runs when the app starts
  const c = db.prepare('SELECT * FROM clips WHERE id=?').get(clip);
  assert.equal(c.text, "It's a");
  assert.equal(c.title, "It's a");
  assert.equal(c.status, 'pending');
  assert.doesNotMatch(db.prepare('SELECT transcript FROM clip_jobs WHERE id=?').get(job).transcript, /0xAB|�/);
});
