// Voice on the lips: a test video flashes white and beeps at the same moments every 5 seconds.
// After making a clip, each flash and its beep must still land together (within a frame).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'));
const clipper = require('../src/clipper');
const FF = clipper.ffmpegPath();
const dir = process.env.DATA_DIR;
const f = (n) => path.join(dir, n);

// Seconds from each flash to the nearest beep (above 0 = the beep comes late).
function offsets(file) {
  const v = execFileSync(FF, ['-hide_banner', '-i', file, '-an', '-vf', 'scale=32:18,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], { maxBuffer: 1 << 26 }).toString();
  const flashes = []; let t = 0, was = false;
  for (const line of v.split('\n')) {
    const m = line.match(/pts_time:([\d.]+)/); if (m) t = +m[1];
    const y = line.match(/YAVG=([\d.]+)/); if (y) { const on = +y[1] > 100; if (on && !was) flashes.push(t); was = on; }
  }
  const a = spawnSync(FF, ['-hide_banner', '-i', file, '-vn', '-af', 'silencedetect=n=-30dB:d=0.05', '-f', 'null', '-']).stderr.toString();
  const beeps = [...a.matchAll(/silence_end: ([\d.]+)/g)].map((x) => +x[1]);
  return flashes.filter((x) => x > 0.5).map((x) => beeps.reduce((b, y) => (Math.abs(y - x) < Math.abs(b) ? y - x : b), 99));
}

test.before(() => {
  execFileSync(FF, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', "color=c=black:s=640x360:r=30000/1001:d=32,format=yuv420p,geq=lum='if(lt(mod(T\\,5)\\,0.1)\\,235\\,16)':cb=128:cr=128",
    '-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t\\,5)\\,0.1)\\,0.8*sin(2*PI*1000*t)\\,0)':s=48000:d=32", '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', f('src.mp4')]);
  // The same video with its sound 0.3 s late (like some phone or downloaded videos).
  execFileSync(FF, ['-loglevel', 'error', '-y', '-i', f('src.mp4'), '-itsoffset', '0.3', '-i', f('src.mp4'), '-map', '0:v', '-map', '1:a', '-c', 'copy', f('late.mp4')]);
});

const make = (source, start, len, audioShift) => {
  const filter = '[0:v]fps=30,scale=360:640,setsar=1,format=yuv420p[v]';
  execFileSync(FF, ['-loglevel', 'error', ...clipper.renderArgs({ source, start, len, filter, file: f('out.mp4'), preview: f('out-small.mp4'), hw: false, audioShift }).slice(1)]);
  return offsets(f('out.mp4'));
};

test('a clip keeps the voice on the lips', () => {
  const d = make(f('src.mp4'), 7.3, 20, 0);
  assert.ok(d.length >= 3);
  for (const x of d) assert.ok(Math.abs(x) < 0.045, `off by ${x}`);
});

test('Sound timing moves late sound back onto the lips, also from the very start', () => {
  const before = make(f('late.mp4'), 7.3, 20, 0);
  for (const x of before) assert.ok(Math.abs(x - 0.3) < 0.045, `came in 0.3 s late (${x})`);
  for (const x of make(f('late.mp4'), 7.3, 20, 0.3)) assert.ok(Math.abs(x) < 0.045, `fixed (${x})`);
  // Sound early, from second 0: the start is padded with silence.
  for (const x of make(f('src.mp4'), 0, 20, -0.25)) assert.ok(Math.abs(x - 0.25) < 0.045, `moved later (${x})`);
  const info = spawnSync(FF, ['-hide_banner', '-i', f('out.mp4')]).stderr.toString();
  assert.match(info, /Duration: 00:00:(19\.9|20\.0)/, 'clip keeps its length');
});
