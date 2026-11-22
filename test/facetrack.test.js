const test = require('node:test');
const assert = require('node:assert');
const { cameraPath, pathExpr } = require('../src/facetrack');

const face = (cx) => ({ x1: cx - 0.05, y1: 0.3, x2: cx + 0.05, y2: 0.5, score: 0.9 });
const crop = (1080 * 9 / 16) / 1920; // tall frame over 16:9 video

test('Follow faces: frame starts on the person and stays still while they stand still', () => {
  const samples = Array.from({ length: 12 }, (_, i) => ({ t: i / 3, faces: [face(0.2)] }));
  const keys = cameraPath(samples, crop);
  assert.ok(keys.length <= 2);
  const left = keys[0].x * (1 - crop);
  assert.ok(left < 0.2 && left + crop > 0.2, 'face is inside the frame');
});

test('Follow faces: frame moves over when the person walks across, and waits when no face is seen', () => {
  const samples = [];
  for (let i = 0; i < 30; i++) samples.push({ t: i / 3, faces: i >= 12 && i < 15 ? [] : [face(i < 15 ? 0.2 : 0.8)] });
  const keys = cameraPath(samples, crop);
  assert.ok(keys[0].x < 0.2 && keys[keys.length - 1].x > 0.8);
  assert.ok(keys.every((k, i) => i === 0 || k.t > keys[i - 1].t), 'times go forward');
});

test('Follow faces: no faces at all means the normal middle crop', () => {
  assert.strictEqual(cameraPath([{ t: 0, faces: [] }, { t: 1, faces: [] }], crop), null);
});

test('Follow faces: ffmpeg position expression walks through the stops', () => {
  const expr = pathExpr([{ t: 0, x: 0.1 }, { t: 2, x: 0.1 }, { t: 3, x: 0.9 }]);
  const evalAt = (t) => Function('t', `const lt=(a,b)=>a<b?1:0; const iff=(c,a,b)=>c?a:b; return ${expr.replace(/\\,/g, ',').replace(/if\(/g, 'iff(')};`)(t);
  assert.strictEqual(evalAt(1), 0.1);
  assert.ok(Math.abs(evalAt(2.5) - 0.5) < 1e-6);
  assert.strictEqual(evalAt(5), 0.9);
});

test('Follow faces: with two people, follows the one talking and switches when the other talks', () => {
  const { targets } = require('../src/facetrack');
  const samples = [];
  for (let i = 0; i < 72; i++) { // 12 seconds, 6 looks a second
    const t = i / 6;
    const leftTalks = t < 6;
    samples.push({ t, faces: [
      { x1: 0.15, y1: 0.3, x2: 0.22, y2: 0.45, score: 0.9, talk: leftTalks ? 6 : 0.3 },
      { x1: 0.75, y1: 0.2, x2: 0.85, y2: 0.4, score: 0.9, talk: leftTalks ? 0.3 : 6 }, // bigger face, quiet at first
    ] });
  }
  const pts = targets(samples);
  assert.ok(pts[0].x < 0.3, 'starts on the person talking, not the bigger face');
  assert.ok(pts.filter((p) => p.t > 1 && p.t < 5.5).every((p) => p.x < 0.3), 'stays on them while they talk');
  assert.ok(pts.filter((p) => p.t > 7.5).every((p) => p.x > 0.7), 'moves to the other person once they talk');
  const switches = pts.filter((p, i) => i && (p.x > 0.5) !== (pts[i - 1].x > 0.5)).length;
  assert.strictEqual(switches, 1, 'no jumping back and forth');
});

test('Follow faces: kids on a stage, small faces: follows the one singing, not the biggest face', () => {
  const { targets } = require('../src/facetrack');
  const samples = [];
  for (let i = 0; i < 90; i++) { // 15 seconds
    const t = i / 6;
    const wobble = 0.03 * Math.sin(i); // head bobbing and camera noise
    samples.push({ t, faces: [
      { x1: 0.10, y1: 0.30, x2: 0.20, y2: 0.50, score: 0.9, talk: 0.05 + Math.abs(wobble) }, // closest kid, not singing
      { x1: 0.47, y1: 0.35, x2: 0.53, y2: 0.45, score: 0.9, talk: 0.25 + wobble },           // the singer with the mic (small, far)
      { x1: 0.80, y1: 0.36, x2: 0.86, y2: 0.46, score: 0.9, talk: 0.06 },
    ] });
  }
  const pts = targets(samples);
  assert.ok(pts.every((p) => p.x > 0.4 && p.x < 0.6), 'stays on the singer the whole time');
});

test('Follow faces: in a song with few words heard, mouths still decide', async () => {
  const ft = require('../src/facetrack');
  // Two people; the right one sings. Only one short word was heard, at the very start.
  const samples = [];
  for (let i = 0; i < 60; i++) samples.push({ t: i / 6, faces: [
    { x1: 0.10, y1: 0.3, x2: 0.2, y2: 0.5, score: 0.9, talk: 0.04 },
    { x1: 0.80, y1: 0.3, x2: 0.88, y2: 0.45, score: 0.9, talk: 0.3 },
  ] });
  const speaking = ft.speakingFrom([[0, 0.3]], 10);
  assert.equal(speaking, undefined, 'too few words heard: every moment counts');
  assert.equal(typeof ft.speakingFrom([[0, 6]], 10), 'function', 'talking video: words decide');
  const pts = ft.targets(samples, speaking);
  assert.ok(pts.slice(6).every((p) => p.x > 0.7));
});
