// Clips: picking moments, captions, and the upload -> clips -> schedule flow.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Stands in for the model download so tests never fetch 200 MB, and for Facebook's Graph API.
const graphCalls = [];
let videoBytes = null;
const fake = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/cdn/video.mp4' && videoBytes) { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': videoBytes.length }); return res.end(videoBytes); }
  if (u.pathname.startsWith('/v23.0/')) {
    graphCalls.push(`${u.pathname} ${u.searchParams.get('access_token')}`);
    const base = `http://127.0.0.1:${fake.address().port}`;
    if (u.pathname === '/v23.0/1234567890' && u.searchParams.get('access_token') === 'page-b') return json({ id: '1234567890', title: 'Parade float tour', source: `${base}/cdn/video.mp4` });
    if (u.pathname === '/v23.0/1234567890') return json({ error: { message: 'Unsupported get request', code: 100 } }, 400);
    if (u.pathname === '/v23.0/ig1/media' && !u.searchParams.get('after')) {
      return json({ data: [{ id: 'm1', media_type: 'IMAGE', media_url: 'x', permalink: 'https://www.instagram.com/p/PHOTO1/' }], paging: { cursors: { after: 'c2' }, next: 'more' } });
    }
    if (u.pathname === '/v23.0/ig1/media') return json({ data: [{ id: 'm2', media_type: 'VIDEO', media_url: `${base}/cdn/video.mp4`, permalink: 'https://www.instagram.com/reel/REEL22/', caption: 'Santa is coming to town' }] });
    return json({ error: { message: 'nope', code: 100 } }, 400);
  }
  res.statusCode = 404; res.end();
});
let clipper, db, server, root, dir;
test.before(async () => {
  await new Promise((r) => fake.listen(0, r));
  process.env.CLIPS_MODEL_URL = `http://127.0.0.1:${fake.address().port}`;
  process.env.GRAPH_BASE = `http://127.0.0.1:${fake.address().port}`;
  process.env.GRAPH_VERSION = 'v23.0';
  // Pretend this computer has the Mac's video chip: making clips must still work when it fails.
  process.env.CLIPS_HW = '1';
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-'));
  process.env.DATA_DIR = dir;
  process.env.APP_PASSWORD = '';
  clipper = require('../src/clipper');
  db = require('../src/db');
  server = require('../src/server').listen(0);
  await new Promise((r) => server.once('listening', r));
  root = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); server.closeAllConnections(); fake.close(); fake.closeAllConnections(); });

const seg = (start, end, text) => ({ start, end, text, words: text.split(' ').map((w, i, a) => ({ text: w, start: start + ((end - start) * i) / a.length, end: start + ((end - start) * (i + 1)) / a.length })) });

test('picks complete thoughts of the right length and prefers strong openings', () => {
  const segments = [
    seg(0, 8, 'um so we got here early and set things up.'),
    seg(8.3, 16, 'the weather was fine and people were walking around.'),
    seg(16.5, 24, 'Why does everyone love the parade so much?'),
    seg(24.2, 33, 'Because 5,000 people show up and the floats are incredible!'),
    seg(33.4, 42, 'You have to see the lights at night, it is amazing.'),
    seg(42.5, 50, 'anyway that was the day and then we went home.'),
  ];
  const picks = clipper.pickClips({ segments, loudness: [], duration: 50, length: 'short', count: 2 });
  assert.ok(picks.length >= 1);
  const best = picks[0];
  assert.strictEqual(Math.round(best.start), 16, 'starts on the question');
  assert.ok(best.end - best.start >= 15 && best.end - best.start <= 35);
  assert.match(best.text, /\?$|[.!]$/);
  assert.match(best.title, /^Why does everyone love the parade/);
  for (let i = 1; i < picks.length; i++) assert.ok(picks[i].start >= picks[0].end - 1 || picks[i].end <= picks[0].start + 1, 'no overlap');
});

test('falls back to the most energetic part when nobody talks', () => {
  const loudness = Array.from({ length: 240 }, (_, i) => (i > 150 && i < 200 ? 0.5 : 0.05));
  const picks = clipper.pickClips({ segments: [], loudness, duration: 120, length: 'short', count: 1 });
  assert.strictEqual(picks.length, 1);
  assert.ok(picks[0].start >= 60 && picks[0].start <= 100, `picked ${picks[0].start}`);
});

test('captions follow the voice, and edited words keep the timing', () => {
  const segments = [seg(10, 14, 'hello there my friends'), seg(15, 17, 'welcome back')];
  const words = clipper.captionWords(segments, 10, 17, null);
  assert.deepStrictEqual(words.map((w) => w.text), ['hello', 'there', 'my', 'friends', 'welcome', 'back']);
  assert.strictEqual(words[0].start, 0);
  const edited = clipper.captionWords(segments, 10, 17, 'Hello Fuquay-Varina friends, welcome back!');
  assert.strictEqual(edited.length, 5);
  assert.ok(edited.every((w) => w.start >= 0 && w.end <= 7.01 && w.end >= w.start));
  assert.ok(edited[3].start >= 4.9, 'second sentence starts when the second part is spoken');
  const groups = clipper.groupWords(words);
  assert.ok(groups.every((g) => g.length <= 3));
  const ass = clipper.buildAss(words, 'bold', 7);
  assert.match(ass, /PlayResY: 1920/);
  assert.match(ass, /Dialogue: 0,0:00:00\.00,.*HELLO/);
  assert.ok(!/[{}]/.test(clipper.buildAss([{ text: '{\\pos(1,1)}hi', start: 0, end: 1 }], 'clean', 2).split('[Events]')[1].replace(/Format:.*/, '')), 'no caption code injection');
});

test('upload a video, get vertical clips, and schedule one', { timeout: 180000 }, async () => {
  const src = path.join(dir, 'in.mp4');
  execFileSync(clipper.ffmpegPath(), ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30', '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=44100',
    '-t', '40', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', src]);
  const fd = new FormData();
  fd.set('length', 'short');
  fd.set('count', '2');
  fd.set('video', new Blob([fs.readFileSync(src)], { type: 'video/mp4' }), 'Parade talk.mp4');
  const created = await (await fetch(`${root}/api/clips`, { method: 'POST', body: fd })).json();
  assert.strictEqual(created.name, 'Parade talk');
  let job;
  for (let i = 0; i < 170; i++) {
    job = await (await fetch(`${root}/api/clips/${created.id}`)).json();
    if (job.status === 'failed' || (job.status === 'ready' && job.clips.length && job.clips.every((c) => c.status === 'ready'))) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.strictEqual(job.status, 'ready', job.error || job.step);
  assert.ok(job.note, 'explains why there are no captions');
  assert.ok(job.clips.length >= 1);
  const clip = job.clips[0];
  const res = await fetch(root + clip.url);
  assert.strictEqual(res.status, 200);
  const info = await clipper.probe(path.join(dir, 'clips', String(job.id), path.basename(clip.url)));
  assert.deepStrictEqual([info.width, info.height], [1080, 1920]);
  assert.ok(Math.abs(info.duration - clip.length) < 0.6);
  assert.strictEqual((await fetch(`${root}/clipfile/${job.id}/..%2F..%2Fscheduler.db`)).status, 404);

  // A small copy plays quickly in the app; videos can be streamed in pieces (needed by iPhones).
  assert.match(clip.preview_url, /-small\.mp4$/);
  const small = await clipper.probe(path.join(dir, 'clips', String(job.id), path.basename(clip.preview_url)));
  assert.deepStrictEqual([small.width, small.height], [540, 960]);
  assert.ok(Math.abs(small.duration - clip.length) < 0.6);
  assert.ok(fs.statSync(path.join(dir, 'clips', String(job.id), path.basename(clip.preview_url))).size < clip.size);
  const part = await fetch(root + clip.preview_url, { headers: { Range: 'bytes=0-99' } });
  assert.strictEqual(part.status, 206);
  assert.strictEqual((await part.arrayBuffer()).byteLength, 100);

  const acct = db.prepare(`INSERT INTO accounts (platform, external_id, name, access_token) VALUES ('tiktok','t1','Me','x')`).run().lastInsertRowid;
  const post = new FormData();
  post.set('caption', 'From a clip');
  post.set('scheduledAt', new Date(Date.now() + 864e5).toISOString());
  post.set('accountIds', String(acct));
  post.set('clipId', String(clip.id));
  const made = await fetch(`${root}/api/posts`, { method: 'POST', body: post });
  assert.strictEqual(made.status, 201);
  const p = await made.json();
  assert.strictEqual(p.media_type, 'video');
  assert.ok(fs.existsSync(path.join(dir, 'media', p.media_file)));

  // Deleting the post keeps the clip; deleting the video removes its clips.
  await fetch(`${root}/api/posts/${p.id}`, { method: 'DELETE' });
  assert.strictEqual((await fetch(root + clip.url)).status, 200);
  await fetch(`${root}/api/clips/${job.id}`, { method: 'DELETE' });
  assert.strictEqual((await fetch(root + clip.url)).status, 404);
  assert.ok(!fs.existsSync(path.join(dir, 'clips', String(job.id))));
});

test('reads video links from each platform', () => {
  const { parseLink } = require('../src/linkimport');
  assert.deepStrictEqual(parseLink('https://youtu.be/dQw4w9WgXcQ?si=abc'), { platform: 'youtube', id: 'dQw4w9WgXcQ', url: 'https://youtu.be/dQw4w9WgXcQ?si=abc' });
  assert.strictEqual(parseLink('https://www.youtube.com/shorts/dQw4w9WgXcQ').id, 'dQw4w9WgXcQ');
  assert.strictEqual(parseLink('https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=5').id, 'dQw4w9WgXcQ');
  assert.strictEqual(parseLink('https://www.tiktok.com/@danielkinglife/video/7312345678901234567').id, '7312345678901234567');
  assert.strictEqual(parseLink('https://www.instagram.com/reel/C9xYz_AbC12/?igsh=x').id, 'C9xYz_AbC12');
  assert.strictEqual(parseLink('https://www.instagram.com/king_daniel_st/p/C9xYz_AbC12/').id, 'C9xYz_AbC12');
  assert.strictEqual(parseLink('https://www.facebook.com/MyPage/videos/1234567890123/').id, '1234567890123');
  assert.strictEqual(parseLink('https://www.facebook.com/reel/1234567890123').id, '1234567890123');
  assert.strictEqual(parseLink('https://www.facebook.com/watch/?v=1234567890123').id, '1234567890123');
  assert.strictEqual(parseLink('https://fb.watch/abcDEF/').short, true);
  assert.strictEqual(parseLink('not a link'), null);
});

test('paste a link: brings in your own Facebook and Instagram videos through the official API', { timeout: 180000 }, async () => {
  const src = path.join(dir, 'linked.mp4');
  execFileSync(clipper.ffmpegPath(), ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30', '-t', '20', '-c:v', 'libx264', '-preset', 'ultrafast', src]);
  videoBytes = fs.readFileSync(src);
  db.prepare(`INSERT INTO accounts (platform, external_id, name, access_token) VALUES ('facebook','pa','Page A','page-a'), ('facebook','pb','Page B','page-b'), ('instagram','ig1','Insta','page-b')`).run();
  const post = (url) => fetch(`${root}/api/clips/link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, length: 'short', count: 1 }) });
  const waitReady = async (id) => {
    let job;
    for (let i = 0; i < 170; i++) {
      job = await (await fetch(`${root}/api/clips/${id}`)).json();
      if (job.status === 'failed' || (job.status === 'ready' && job.clips.length && job.clips.every((c) => c.status === 'ready'))) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return job;
  };

  // Facebook: the Page that owns the video gives its file.
  let res = await post('https://www.facebook.com/somepage/videos/1234567890/');
  assert.strictEqual(res.status, 201);
  let made = await res.json();
  assert.strictEqual(made.name, 'Parade float tour');
  assert.strictEqual(made.from, 'Page B');
  let job = await waitReady(made.id);
  assert.strictEqual(job.status, 'ready', job.error);
  assert.ok(Math.abs(job.duration - 20) < 0.5);
  assert.ok(graphCalls.some((c) => c.includes('page-a')) && graphCalls.some((c) => c.includes('page-b')));

  // Instagram: found by looking through the account's posts.
  res = await post('https://www.instagram.com/reel/REEL22/');
  assert.strictEqual(res.status, 201);
  made = await res.json();
  assert.strictEqual(made.name, 'Santa is coming to town');
  job = await waitReady(made.id);
  assert.strictEqual(job.status, 'ready', job.error);

  res = await post('https://www.instagram.com/p/PHOTO1/');
  assert.strictEqual(res.status, 422);
  assert.match((await res.json()).error, /photo/);

  // Someone else's video: refused.
  res = await post('https://www.facebook.com/reel/999999999');
  assert.strictEqual(res.status, 422);
  assert.match((await res.json()).error, /isn't on any of your connected Facebook/);

  // YouTube has no official download, so the official steps are shown...
  res = await post('https://youtu.be/AAAAAAAAAAA');
  assert.strictEqual(res.status, 422);
  const why = await res.json();
  assert.strictEqual(why.platform, 'youtube');
  assert.match(why.error, /doesn't let apps download/);

  // ...unless Viral Post posted that video: then the original file is already here.
  fs.copyFileSync(src, path.join(dir, 'media', 'yt-original.mp4'));
  const yt = db.prepare(`INSERT INTO accounts (platform, external_id, name, access_token) VALUES ('youtube','ch1','My channel','x')`).run().lastInsertRowid;
  const p = db.prepare(`INSERT INTO posts (caption, media_file, media_type, scheduled_at, title) VALUES ('c', 'yt-original.mp4', 'video', '2026-11-01T00:00:00Z', 'Christmas parade recap')`).run().lastInsertRowid;
  db.prepare(`INSERT INTO post_targets (post_id, account_id, status, external_post_id, permalink) VALUES (?, ?, 'published', 'AAAAAAAAAAA', 'https://www.youtube.com/watch?v=AAAAAAAAAAA')`).run(p, yt);
  res = await post('https://www.youtube.com/shorts/AAAAAAAAAAA');
  assert.strictEqual(res.status, 201);
  made = await res.json();
  assert.strictEqual(made.how, 'local');
  assert.strictEqual(made.name, 'Christmas parade recap');
  job = await waitReady(made.id);
  assert.strictEqual(job.status, 'ready', job.error);
});
