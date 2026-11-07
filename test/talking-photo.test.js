// Talking photo (built in): the mesh, the mouth following the voice, and a full video.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ffmpeg = require('ffmpeg-static');
const { makeTalking, mouthTrack, triangulate, FPS } = require('../src/talking-photo');

test('the face mesh covers a grid of points with triangles', () => {
  const pts = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) pts.push([x * 10, y * 10]);
  const tris = triangulate(pts);
  assert.equal(tris.length, 8);
  const area = tris.reduce((s, [a, b, c]) => s + Math.abs((pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[c][0] - pts[a][0]) * (pts[b][1] - pts[a][1])) / 2, 0);
  assert.equal(area, 400);
});

test('the mouth opens while the voice is loud and closes in the pauses', () => {
  const pcm = new Float32Array(16000 * 3);
  for (let i = 16000; i < 32000; i++) pcm[i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / 16000);
  for (let i = 0; i < pcm.length; i++) pcm[i] += (Math.random() - 0.5) * 0.002;
  const open = mouthTrack(pcm);
  assert.equal(open.length, 3 * FPS);
  const avg = (a, b) => open.slice(a, b).reduce((s, v) => s + v, 0) / (b - a);
  assert.ok(avg(5, 25) < 0.1, `quiet ${avg(5, 25)}`);
  assert.ok(avg(35, 55) > 0.8, `loud ${avg(35, 55)}`);
  assert.ok(avg(70, 90) < 0.1, `quiet again ${avg(70, 90)}`);
});

test('a photo becomes a talking video as long as its voiceover', { timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-'));
  const photo = path.join(dir, 'p.png'), audio = path.join(dir, 'v.wav'), out = path.join(dir, 'talk.mp4');
  const W = 360, H = 640;
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=c=0xd8a888:s=${W}x${H}`, '-frames:v', '1', photo]);
  // 1 s quiet, 1 s "speech", 1 s quiet.
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', "aevalsrc='if(between(t,1,2),0.5*sin(2*PI*300*t),0.0005*random(0))':s=44100:d=3", audio]);
  const face = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'face-points.json'), 'utf8'));
  const r = await makeTalking({ ffmpeg, photo, audio, out, face, width: W, height: H });
  assert.ok(Math.abs(r.frames - 90) <= 1, `frames ${r.frames}`);
  // Frame at 0.5 s (quiet) vs 1.5 s (talking): the mouth area changes, the forehead hardly does.
  const frame = (t) => execFileSync(ffmpeg, ['-v', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  const a = frame(0.5), b = frame(1.5);
  const diff = (cx, cy, rw, rh) => {
    let s = 0, n = 0;
    for (let y = Math.round((cy - rh) * H); y < Math.round((cy + rh) * H); y++) {
      for (let x = Math.round((cx - rw) * W); x < Math.round((cx + rw) * W); x++) { s += Math.abs(a[y * W + x] - b[y * W + x]); n++; }
    }
    return s / n;
  };
  const m = face[13], f = face[10];
  const mouth = diff(m[0], m[1] + 0.01, 0.04, 0.02), forehead = diff(f[0], f[1] + 0.03, 0.04, 0.02);
  assert.ok(mouth > 5 && mouth > forehead * 5 + 1, `mouth ${mouth} forehead ${forehead}`);
  fs.rmSync(dir, { recursive: true, force: true });
});
