// Viral Clips shapes: tall 9:16 (Reels, TikTok, Shorts) and wide 16:9 (YouTube, Facebook).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shape-'));
const clipper = require('../src/clipper');
const FF = clipper.ffmpegPath();
const f = (n) => path.join(process.env.DATA_DIR, n);
const size = (file) => {
  const m = spawnSync(FF, ['-hide_banner', '-i', file]).stderr.toString().match(/Video:.*?(\d{3,4})x(\d{3,4})/);
  return `${m[1]}x${m[2]}`;
};
const make = (src, framing, shape, out) => {
  const [w, h] = src === 'wide' ? [1280, 720] : [720, 1280];
  const filter = clipper.videoFilter({ width: w, height: h }, framing, null, {}, shape);
  execFileSync(FF, ['-loglevel', 'error', ...clipper.renderArgs({ source: f(`${src}.mp4`), start: 0, len: 2, filter, file: f(`${out}.mp4`), preview: f(`${out}-small.mp4`), hw: false, shape }).slice(1)]);
  return [size(f(`${out}.mp4`)), size(f(`${out}-small.mp4`))];
};

test.before(() => {
  for (const [n, s] of [['wide', '1280x720'], ['tall', '720x1280']]) {
    execFileSync(FF, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=${s}:r=30:d=3`, '-f', 'lavfi', '-i', 'sine=d=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', f(`${n}.mp4`)]);
  }
});

test('a wide video makes 16:9 clips (and a 16:9 preview)', () => {
  assert.deepStrictEqual(make('wide', 'center', 'wide', 'w1'), ['1920x1080', '960x540']);
});

test('a tall phone video made wide keeps the whole picture over a blurred copy', () => {
  assert.deepStrictEqual(make('tall', 'face', 'wide', 'w2'), ['1920x1080', '960x540']);
  assert.match(clipper.videoFilter({ width: 720, height: 1280 }, 'center', null, {}, 'wide'), /boxblur/);
});

test('tall stays the default 9:16', () => {
  assert.deepStrictEqual(make('wide', 'center', 'tall', 't1'), ['1080x1920', '540x960']);
});

test('wide captions use a 16:9 canvas with smaller words near the bottom', () => {
  const words = [{ text: 'Hello', start: 0, end: 0.5 }, { text: 'there', start: 0.5, end: 1 }];
  const wide = clipper.buildAss(words, 'bold', 2, 'wide');
  assert.match(wide, /PlayResX: 1920\nPlayResY: 1080/);
  assert.match(wide, /Style: Cap,Archivo Black,72,.*,160,160,110,1/);
  assert.match(clipper.buildAss(words, 'bold', 2), /PlayResX: 1080\nPlayResY: 1920/);
});
