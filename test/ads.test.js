// Viral Ads Studio: script writing, on-screen words, and the full
// details -> script -> video (every shape) -> schedule flow.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

let ads, db, server, root, dir, ffmpeg;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ads-'));
  process.env.DATA_DIR = dir;
  process.env.APP_PASSWORD = '';
  ads = require('../src/ads');
  db = require('../src/db');
  ffmpeg = require('../src/clipper').ffmpegPath();
  server = require('../src/server').listen(0);
  await new Promise((r) => server.once('listening', r));
  root = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); server.closeAllConnections(); });

const details = {
  name: 'Fuquay-Varina Christmas Parade',
  about: 'The biggest holiday parade in Wake County returns downtown. Floats, bands and Santa!',
  points: 'Over 100 floats and bands\nFree for the whole family\nSanta arrives at the end',
  offer: 'Saturday, December 13 at 2 PM',
  cta: 'Become a sponsor',
  website: 'https://fuquayvarinachristmasparade.org',
};

test('every recipe writes an opening, the selling points and a call to action', () => {
  for (const recipe of ['hook', 'reasons', 'question', 'offer', 'event']) {
    const scenes = ads.writeScript(details, { recipe, length: 30, seed: 3 });
    assert.ok(scenes.length >= 3, recipe);
    assert.ok(scenes.every((s) => s.say && s.say.length < 400), recipe);
    const last = scenes[scenes.length - 1];
    assert.match(last.say, /Become a sponsor at fuquayvarinachristmasparade dot org/, recipe);
    assert.equal(last.headline, 'Become a sponsor', recipe);
  }
  const reasons = ads.writeScript(details, { recipe: 'reasons', length: 30 });
  assert.match(reasons[0].say, /3 reasons/);
  assert.match(reasons[1].say, /^One: Over 100 floats/);
  // 15 seconds keeps it short.
  assert.ok(ads.writeScript(details, { recipe: 'hook', length: 15 }).length <= 4);
});

test('a pasted script is used as written, in short scenes, with a call to action added', () => {
  const script = 'Tired of boring weekends? We have the fix. This December, downtown Fuquay-Varina turns into a winter wonderland with floats, music, lights and more than ten thousand neighbors. Bring the kids and see Santa.';
  const scenes = ads.splitScript(script, { cta: 'Learn more', website: 'example.org' });
  assert.ok(scenes.length >= 3);
  assert.ok(scenes.every((s) => s.say.split(' ').length <= 30));
  assert.equal(scenes.map((s) => s.say).slice(0, -1).join(' '), script);
  assert.equal(scenes[scenes.length - 1].say, 'Learn more at example dot org.');
});

test('captions follow the voice and the headline uses the brand colour', () => {
  const ass = ads.buildSceneAss({ W: 1080, H: 1920, look: 'bold', color: '#E11D48', headline: 'Save the date', say: 'Mark your calendar for the parade!', voiceStart: 0.15, voiceEnd: 2.5, len: 3 });
  assert.match(ass, /PlayResX: 1080\nPlayResY: 1920/);
  assert.match(ass, /}SAVE THE DATE\n/);
  assert.match(ass, /\{\\c&H481DE1&/);
  assert.match(ass, /&H00481DE1/); // #E11D48 in subtitle colour order
  const caps = ass.split('\n').filter((l) => l.includes(',Cap,'));
  assert.ok(caps.length >= 5);
  assert.match(caps[0], /^Dialogue: 0,0:00:00\.15/);
  const wide = ads.buildSceneAss({ W: 1920, H: 1080, look: 'clean', headline: 'Hi', say: 'Hello there', voiceStart: 0, voiceEnd: 1, len: 1.5 });
  assert.match(wide, /PlayResX: 1920/);
  assert.doesNotMatch(wide, /HELLO/);
  const t = ads.timeWords('One, two three.', 0, 3);
  assert.equal(t.length, 3);
  assert.ok(t[0].end - t[0].start > t[1].end - t[1].start); // pause after the comma
});

function fixture(name, args) {
  const f = path.join(dir, name);
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args, f]);
  return f;
}

test('details -> ad video in two shapes -> scheduled post', { timeout: 240000 }, async () => {
  const photo = fixture('photo.jpg', ['-f', 'lavfi', '-i', 'testsrc2=s=1600x1000', '-frames:v', '1']);
  const video = fixture('video.mp4', ['-f', 'lavfi', '-i', 'testsrc=s=1280x720:d=4', '-f', 'lavfi', '-i', 'sine=f=440:d=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
  const logo = fixture('logo.png', ['-f', 'lavfi', '-i', 'color=c=red:s=400x200', '-frames:v', '1']);
  const fd = new FormData();
  for (const [f, type] of [[photo, 'image/jpeg'], [video, 'video/mp4'], [logo, 'image/png']]) fd.append('files', new Blob([fs.readFileSync(f)], { type }), path.basename(f));
  const up = await fetch(`${root}/api/ads/media`, { method: 'POST', body: fd });
  assert.equal(up.status, 201);
  const media = await up.json();
  assert.deepEqual(media.map((m) => m.kind), ['image', 'video', 'image']);

  const brand = await (await fetch(`${root}/api/ads/brands`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Parade', color: '#16A34A', website: 'fuquayvarinachristmasparade.org', cta: 'Become a sponsor', logo: media[2].file }) })).json();
  assert.equal(brand.logo, media[2].file);

  const res = await fetch(`${root}/api/ads`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ details: { ...details, cta: '', website: '' }, recipe: 'event', look: 'bold', length: 15, formats: ['9x16', '16x9'], brand_id: brand.id, media: [media[0].file, media[1].file] }) });
  assert.equal(res.status, 201);
  let ad = await res.json();
  assert.equal(ad.details.cta, 'Become a sponsor'); // from the brand
  assert.ok(ad.scenes.length >= 3);
  assert.ok(ad.scenes[ad.scenes.length - 1].endCard);
  assert.match(ad.caption, /👉 Become a sponsor: fuquayvarinachristmasparade\.org/);
  assert.equal(ad.status, 'draft');

  // Keep the test quick: three short scenes, one using the video's own sound.
  const scenes = [
    { ...ad.scenes[0], seconds: 2 },
    { say: '', headline: 'Floats!', media: media[1].file, sound: 'video', seconds: 2 },
    { ...ad.scenes[ad.scenes.length - 1], seconds: 2 },
  ];
  ad = await (await fetch(`${root}/api/ads/${ad.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenes }) })).json();
  assert.equal(ad.scenes[1].sound, 'video');
  await fetch(`${root}/api/ads/${ad.id}/render`, { method: 'POST' });
  for (let i = 0; i < 200 && !['ready', 'failed'].includes(ad.status); i++) {
    await new Promise((r) => setTimeout(r, 1000));
    ad = await (await fetch(`${root}/api/ads/${ad.id}`)).json();
  }
  assert.equal(ad.status, 'ready', ad.error);
  assert.deepEqual(Object.keys(ad.outputs).sort(), ['16x9', '9x16']);
  const tall = path.join(dir, 'ads', String(ad.id), ad.outputs['9x16'].file);
  const info = execFileSync(ffmpeg, ['-hide_banner', '-i', tall, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
    + (() => { try { execFileSync(ffmpeg, ['-hide_banner', '-i', tall]); } catch (e) { return String(e.stderr); } return ''; })();
  assert.match(info, /1080x1920/);
  assert.match(info, /Audio: aac/);
  assert.ok(Math.abs(ad.outputs['9x16'].duration - 6) < 0.6, String(ad.outputs['9x16'].duration));
  assert.equal((await fetch(`${root}${ad.outputs['16x9'].url}`)).status, 200);

  // Presenters: named from the file, renamed, and the ad's voiceover can be saved.
  const pf = new FormData();
  pf.append('files', new Blob([fs.readFileSync(photo)], { type: 'image/jpeg' }), '17_Malik.jpg');
  const [pr] = await (await fetch(`${root}/api/ads/presenters`, { method: 'POST', body: pf })).json();
  assert.equal(pr.presenter, 'Malik');
  assert.equal((await (await fetch(`${root}/api/ads/presenters/${pr.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'malik j' }) })).json()).presenter, 'Malik j');
  assert.deepEqual((await (await fetch(`${root}/api/ads/presenters`)).json()).map((m) => m.presenter), ['Malik j']);
  const vo = await fetch(`${root}/api/ads/${ad.id}/voiceover`);
  assert.equal(vo.status, 200);
  assert.match(vo.headers.get('content-disposition'), /voiceover\.m4a/);
  assert.ok((await vo.arrayBuffer()).byteLength > 5000);

  // Presenter first: a new ad with a presenter and no photos shows them in every talking scene.
  const withP = await (await fetch(`${root}/api/ads`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ details, recipe: 'hook', length: 15, presenter: pr.file }) })).json();
  assert.equal(withP.presenter.presenter, 'Malik j');
  assert.ok(withP.scenes.filter((x) => !x.endCard).every((x) => x.media === pr.file));
  assert.notEqual(withP.scenes[withP.scenes.length - 1].media, pr.file);
  const cleared = await (await fetch(`${root}/api/ads/${withP.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ presenter: '' }) })).json();
  assert.equal(cleared.presenter, null);

  // Schedule it.
  const out = await (await fetch(`${root}/api/ads/${ad.id}/out/16x9`)).json();
  assert.equal(out.ref, `${ad.id}:16x9`);
  db.prepare("INSERT INTO accounts (platform, external_id, name, access_token) VALUES ('facebook','p1','Page','t')").run();
  const acct = db.prepare('SELECT id FROM accounts').get().id;
  const post = new FormData();
  post.set('caption', out.caption);
  post.set('accountIds', String(acct));
  post.set('scheduledAt', new Date(Date.now() + 864e5).toISOString());
  post.set('adRef', out.ref);
  const p = await fetch(`${root}/api/posts`, { method: 'POST', body: post });
  assert.equal(p.status, 201, await p.clone().text());
  const saved = await p.json();
  assert.equal(saved.media_type, 'video');
  assert.ok(fs.existsSync(path.join(dir, 'media', saved.media_file)));

  // Deleting the ad keeps the scheduled post's copy.
  await fetch(`${root}/api/ads/${ad.id}`, { method: 'DELETE' });
  assert.ok(fs.existsSync(path.join(dir, 'media', saved.media_file)));
  assert.ok(!fs.existsSync(path.join(dir, 'ads', String(ad.id))));
});
