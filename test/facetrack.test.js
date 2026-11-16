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
