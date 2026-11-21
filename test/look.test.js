// Hollywood look + "Remove words on screen": real ffmpeg and the real text finder, on small files.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'look-'));
const config = require('../src/config');
const db = require('../src/db');
const look = require('../src/look');
const textremove = require('../src/textremove');
const { importBundle } = require('../src/importer');
const { ffmpegPath } = require('../src/clipper');
const { execFileSync } = require('node:child_process');

const WORDS = path.join(__dirname, 'fixtures', 'words.jpg');
const tmp = (name) => path.join(process.env.DATA_DIR, name);

// Average brightness of a strip of a picture (0..255), read through ffmpeg.
function stripStats(file, y, h) {
  const raw = execFileSync(ffmpegPath(), ['-loglevel', 'error', '-i', file, '-vf', `scale=480:270,crop=480:${h}:0:${y},format=gray`, '-f', 'rawvideo', 'pipe:1']);
  let sum = 0, sq = 0;
  for (const v of raw) { sum += v; sq += v * v; }
  const mean = sum / raw.length;
  return { mean, spread: Math.sqrt(sq / raw.length - mean * mean) };
}

test('the text finder finds the words on a picture, and only there', async () => {
  const { W, H } = textremove.detSize(480, 270);
  assert.equal(W % 32, 0); assert.equal(H % 32, 0);
  const r = await textremove.removalFilters({ ffmpeg: ffmpegPath(), source: WORDS, width: 480, height: 270, image: {} });
  assert.ok(r.spots.length >= 1, 'found the line of words');
  const b = r.spots[0].box;
  assert.ok(b.y1 > 0.65 && b.y2 < 1, `words are at the bottom (${b.y1.toFixed(2)}-${b.y2.toFixed(2)})`);
  assert.ok(b.x1 < 0.2 && b.x2 > 0.8, 'covers the whole line');
  assert.match(r.filters[0], /^delogo=x=\d+:y=\d+:w=\d+:h=\d+$/);
});

test('words are removed from a photo and the Hollywood look is added', async () => {
  const out = tmp('after.jpg');
  const r = await look.render({ source: WORDS, dest: out, type: 'image', look: 'hollywood', removeText: true });
  assert.equal(r.note, null);
  const before = stripStats(WORDS, 200, 50), after = stripStats(out, 200, 50);
  assert.ok(after.spread < before.spread * 0.6, `the words' sharp edges are gone (${before.spread.toFixed(1)} -> ${after.spread.toFixed(1)})`);
  // The top of the picture (no words) gets the look: more contrast, not darker.
  const top0 = stripStats(WORDS, 0, 150), top1 = stripStats(out, 0, 150);
  assert.ok(top1.mean >= top0.mean - 2, 'not darker');
});

test('time plan: one line of lyrics becomes one spot, from just before it shows to just after', () => {
  const line = { x1: 0.1, y1: 0.7, x2: 0.9, y2: 0.76 };
  const word = { x1: 0.1, y1: 0.7, x2: 0.4, y2: 0.76 }; // the line grows word by word
  const title = { x1: 0.2, y1: 0.05, x2: 0.8, y2: 0.12 };
  const samples = [
    { t: 0, boxes: [] }, { t: 0.5, boxes: [word] }, { t: 1, boxes: [line] }, { t: 1.5, boxes: [line] },
    { t: 2, boxes: [] }, { t: 2.5, boxes: [title] }, { t: 3, boxes: [title] },
  ];
  const spots = textremove.plan(samples, 0.5);
  assert.equal(spots.length, 2);
  assert.deepEqual([spots[0].start, spots[0].end], [0, 2]);
  assert.ok(spots[0].box.x2 >= 0.9, 'covers the full line');
  assert.deepEqual([spots[1].start, spots[1].end], [2, 3.5]);
  const f = textremove.filters(spots, 1080, 1920);
  assert.match(f[0], /enable='between\(t,0\.00,2\.00\)'/);
  // Spots at the very edge stay one pixel inside the picture (ffmpeg needs that).
  const edge = textremove.filters([{ box: { x1: 0, y1: 0, x2: 1, y2: 0.1 }, start: 0, end: 1 }], 100, 100, { still: true })[0];
  assert.equal(edge, 'delogo=x=1:y=1:w=97:h=10');
});

test('phone photos stored sideways are read the right way up', () => {
  // A tiny JPEG header with an Exif "rotate 90" note (orientation 6).
  const tiff = Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([0, tiff.length + 8]), Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const file = tmp('sideways.jpg');
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xd8]), app1, Buffer.from([0xff, 0xd9])]));
  assert.equal(look.jpegOrientation(file), 6);
  assert.equal(look.jpegOrientation(WORDS), 1);
});

test('a short video gets the look, keeps its sound and size', async () => {
  const src = tmp('clip.mp4');
  execFileSync(ffmpegPath(), ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x568:rate=25:duration=1.5',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src]);
  const out = tmp('clip-look.mp4');
  await look.render({ source: src, dest: out, type: 'video', look: 'hollywood', removeText: false });
  const info = await look.probe(out);
  assert.equal(info.width, 320); assert.equal(info.height, 568);
  assert.equal(info.audio, 'aac');
  assert.ok(info.duration > 1.3);
});

test('settings, picking a look, and making each finished copy only once', async () => {
  assert.deepEqual(look.settings(), { look: 'hollywood', removeText: false });
  assert.deepEqual(look.pick(undefined, undefined), { look: 'hollywood', removeText: 0 });
  assert.deepEqual(look.pick('off', 'true'), { look: null, removeText: 1 });
  look.saveSettings({ look: 'light' });
  assert.equal(look.pick().look, 'light');
  look.saveSettings({ look: 'hollywood' });

  fs.copyFileSync(WORDS, path.join(config.mediaDir, 'a.jpg'));
  fs.linkSync(path.join(config.mediaDir, 'a.jpg'), path.join(config.mediaDir, 'b.jpg')); // shared by two imported posts
  const soon = new Date(Date.now() + 3600e3).toISOString();
  const acct = db.prepare(`INSERT INTO accounts (platform, external_id, name, access_token) VALUES ('facebook','P1','Page','t')`).run().lastInsertRowid;
  const mk = (file) => {
    const id = db.prepare(`INSERT INTO posts (caption, media_file, media_type, scheduled_at, look) VALUES ('x',?,'image',?,'hollywood')`).run(file, soon).lastInsertRowid;
    db.prepare('INSERT INTO post_targets (post_id, account_id) VALUES (?,?)').run(id, acct);
    return db.prepare('SELECT * FROM posts WHERE id=?').get(id);
  };
  const p1 = mk('a.jpg'), p2 = mk('b.jpg');
  assert.equal(look.keyFor(p1), look.keyFor(p2));
  assert.deepEqual(look.mediaFor(p1), { wait: true });
  assert.equal(look.statusFor(p1).status, 'waiting');
  await look.work();
  const m1 = look.mediaFor(p1), m2 = look.mediaFor(p2);
  assert.match(m1.file, /^look-[0-9a-f]+\.jpg$/);
  assert.equal(m1.file, m2.file);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM media_looks').get().n, 1);
  assert.equal(look.statusFor(p1).status, 'ready');
  // A post with no look posts its own file.
  assert.deepEqual(look.mediaFor({ ...p1, look: null, remove_text: 0 }), { file: 'a.jpg' });
  // Not ready long after its time: the original goes out rather than waiting forever.
  const late = { ...p1, look: 'light', scheduled_at: new Date(Date.now() - 3600e3).toISOString() };
  assert.deepEqual(look.mediaFor(late), { file: 'a.jpg' });
});

test('a file that cannot be made into a finished copy posts the original', async () => {
  fs.writeFileSync(path.join(config.mediaDir, 'broken.jpg'), 'not a picture');
  const post = { id: 99, media_file: 'broken.jpg', media_type: 'image', look: 'hollywood', remove_text: 0, scheduled_at: new Date().toISOString() };
  const row = await look.prepare(post);
  assert.equal(row.status, 'failed');
  assert.deepEqual(look.mediaFor(post), { file: 'broken.jpg' });
});

test('imports pick up the look from the bundle, the post, or the saved default', () => {
  const data = fs.readFileSync(WORDS).toString('base64');
  const when = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  const r = importBundle({ look: 'light', posts: [
    { caption: 'bundle look', when: when(2), accounts: [{ platform: 'facebook', name: 'Page' }], media: { name: 'a.jpg', data } },
    { caption: 'own look', when: when(3), accounts: [{ platform: 'facebook', name: 'Page' }], media: { name: 'a.jpg', data }, look: 'off', removeText: true },
    { caption: 'text only', when: when(4), accounts: [{ platform: 'facebook', name: 'Page' }] },
  ] });
  assert.equal(r.imported, 3, JSON.stringify(r));
  const get = (c) => db.prepare('SELECT look, remove_text FROM posts WHERE caption=?').get(c);
  assert.deepEqual({ ...get('bundle look') }, { look: 'light', remove_text: 0 });
  assert.deepEqual({ ...get('own look') }, { look: null, remove_text: 1 });
  assert.deepEqual({ ...get('text only') }, { look: null, remove_text: 0 });
});
