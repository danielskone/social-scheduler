// "Follow faces" framing for Viral Clips.
// Looks at the clip a few times a second, finds faces with a small free face finder that runs
// on this computer (no internet, nothing to pay), and works out where the tall 9:16 frame
// should sit so the person stays in the picture. The frame holds still while the person stays
// inside it and glides over when they move, like a camera operator would.
const path = require('path');
const { spawn } = require('child_process');

const MODEL = path.join(__dirname, '..', 'assets', 'models', 'face-detector-rfb320.onnx');
const IN_W = 320, IN_H = 240;
const SAMPLES_PER_SEC = 3;

let sessionPromise = null;
function session() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = require('onnxruntime-web');
      ort.env.wasm.numThreads = 1;
      ort.env.logLevel = 'error';
      return { ort, s: await ort.InferenceSession.create(MODEL, { logSeverityLevel: 3 }) };
    })().catch((err) => { sessionPromise = null; throw err; });
  }
  return sessionPromise;
}

// The detector's 4420 fixed boxes ("priors"), worked out once.
let priors = null;
function getPriors() {
  if (priors) return priors;
  const steps = [8, 16, 32, 64];
  const sizes = [[10, 16, 24], [32, 48], [64, 96], [128, 192, 256]];
  const out = [];
  steps.forEach((step, k) => {
    const fw = Math.ceil(IN_W / step), fh = Math.ceil(IN_H / step);
    for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) {
      for (const m of sizes[k]) out.push([(i + 0.5) / fw, (j + 0.5) / fh, m / IN_W, m / IN_H]);
    }
  });
  return (priors = out);
}

function iou(a, b) {
  const w = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const h = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = w * h;
  return inter / ((a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter);
}

// Turns the detector's raw output into face boxes (0..1 of the picture).
function decode(scores, boxes, minScore = 0.7) {
  const P = getPriors();
  const found = [];
  const looksBoxed = boxes.length === P.length * 4;
  for (let i = 0; i < P.length; i++) {
    const sc = scores[i * 2 + 1];
    if (sc < minScore) continue;
    let x1, y1, x2, y2;
    if (looksBoxed && boxes[i * 4 + 2] > boxes[i * 4] && boxes[i * 4 + 2] <= 1.2) {
      [x1, y1, x2, y2] = [boxes[i * 4], boxes[i * 4 + 1], boxes[i * 4 + 2], boxes[i * 4 + 3]];
    } else { // raw offsets: decode against the priors
      const p = P[i];
      const cx = p[0] + boxes[i * 4] * 0.1 * p[2], cy = p[1] + boxes[i * 4 + 1] * 0.1 * p[3];
      const w = p[2] * Math.exp(boxes[i * 4 + 2] * 0.2), h = p[3] * Math.exp(boxes[i * 4 + 3] * 0.2);
      [x1, y1, x2, y2] = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
    }
    found.push({ x1, y1, x2, y2, score: sc });
  }
  found.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const f of found) if (!keep.some((k) => iou(k, f) > 0.3)) keep.push(f);
  return keep.slice(0, 8);
}

// Reads small frames of the clip straight out of ffmpeg (no files written).
function readFrames(ffmpeg, source, start, len, onFrame) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-ss', String(start), '-t', String(len), '-i', source,
      '-an', '-vf', `fps=${SAMPLES_PER_SEC},scale=${IN_W}:${IN_H}:flags=bilinear`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-threads', '1', 'pipe:1'];
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const size = IN_W * IN_H * 3;
    let buf = Buffer.alloc(0);
    let n = 0;
    let chain = Promise.resolve();
    let err = '';
    child.stdout.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= size) {
        const frame = buf.subarray(0, size);
        buf = buf.subarray(size);
        const t = n++ / SAMPLES_PER_SEC;
        chain = chain.then(() => onFrame(frame, t));
      }
    });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => chain.then(() => (code === 0 ? resolve(n) : reject(new Error(err.trim() || `ffmpeg ${code}`)))), reject);
  });
}

async function detectFaces(ffmpeg, source, start, len) {
  const { ort, s } = await session();
  const input = new Float32Array(3 * IN_W * IN_H);
  const plane = IN_W * IN_H;
  const samples = [];
  await readFrames(ffmpeg, source, start, len, async (rgb, t) => {
    for (let i = 0; i < plane; i++) {
      input[i] = (rgb[i * 3] - 127) / 128;
      input[plane + i] = (rgb[i * 3 + 1] - 127) / 128;
      input[2 * plane + i] = (rgb[i * 3 + 2] - 127) / 128;
    }
    const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, IN_H, IN_W]) });
    const [scores, boxes] = s.outputNames.map((n) => out[n].data);
    samples.push({ t, faces: decode(scores, boxes) });
  });
  return samples;
}

// Picks who to follow in each moment and returns the wanted middle of the frame (0..1) or null.
// Prefers the biggest face, but sticks with the person already followed unless someone is clearly bigger.
function targets(samples) {
  let last = null;
  return samples.map(({ t, faces }) => {
    const usable = faces.filter((f) => (f.x2 - f.x1) > 0.025);
    if (!usable.length) return { t, x: null };
    const area = (f) => (f.x2 - f.x1) * (f.y2 - f.y1);
    const mid = (f) => (f.x1 + f.x2) / 2;
    let pick = usable.reduce((a, b) => (area(b) > area(a) ? b : a));
    if (last != null) {
      const near = usable.reduce((a, b) => (Math.abs(mid(b) - last) < Math.abs(mid(a) - last) ? b : a));
      if (area(near) * 1.8 > area(pick)) pick = near;
    }
    last = mid(pick);
    return { t, x: last };
  });
}

// Turns the face spots into a smooth camera path for the crop.
// cropFrac = how much of the picture's width the tall frame covers (e.g. 0.316 for 16:9 video).
// Returns keyframes [{t, x}] where x is the left edge of the frame as a share (0..1) of the free room.
function cameraPath(samples, cropFrac) {
  const pts = targets(samples);
  if (!pts.some((p) => p.x != null) || cropFrac >= 0.99) return null;
  // Fill gaps with the nearest seen face, so the frame waits where the person was.
  let prev = null;
  for (const p of pts) { if (p.x != null) prev = p.x; else p.x = prev; }
  let next = null;
  for (let i = pts.length - 1; i >= 0; i--) { if (pts[i].x != null) next = pts[i].x; else pts[i].x = next; }
  // Remove single-frame blips.
  const xs = pts.map((p, i) => [pts[i - 1]?.x ?? p.x, p.x, pts[i + 1]?.x ?? p.x].sort((a, b) => a - b)[1]);
  const room = 1 - cropFrac;
  const leftFor = (cx) => Math.min(1, Math.max(0, (cx - cropFrac / 2) / room));
  // Hold still while the face stays in the middle part of the frame; move when it leaves.
  const dead = cropFrac * 0.18;
  const keys = [];
  let cam = xs[0];
  keys.push({ t: 0, x: leftFor(cam) });
  for (let i = 1; i < xs.length; i++) {
    const want = xs[i];
    const t = pts[i].t;
    if (Math.abs(want - cam) <= dead) continue;
    // Big jump (new shot or another person): cut there at once. Small drift: glide over ~0.7s.
    const jump = Math.abs(want - cam) > cropFrac * 0.9;
    cam = want;
    const x = leftFor(cam);
    const lastKey = keys[keys.length - 1];
    if (Math.abs(x - lastKey.x) < 0.01) continue;
    if (jump) {
      keys.push({ t: Math.max(lastKey.t, t - 0.01), x: lastKey.x }, { t, x });
    } else {
      keys.push({ t: Math.max(lastKey.t, t - 0.7 / 2), x: lastKey.x }, { t: t + 0.7 / 2, x });
    }
  }
  return dedupe(keys);
}

function dedupe(keys) {
  const out = [];
  for (const raw of keys) {
    const k = { t: +raw.t.toFixed(2), x: +raw.x.toFixed(4) };
    const p = out[out.length - 1];
    if (p && k.t <= p.t) { p.x = k.x; continue; }
    out.push(k);
  }
  // Drop middle keys that don't change anything.
  return out.filter((k, i) => i === 0 || i === out.length - 1 || !(k.x === out[i - 1].x && k.x === out[i + 1].x));
}

// An ffmpeg expression (time "t" in seconds) that walks through the keyframes.
function pathExpr(keys) {
  if (!keys.length) return '0.5';
  if (keys.length === 1) return String(keys[0].x);
  let expr = String(keys[keys.length - 1].x);
  for (let i = keys.length - 2; i >= 0; i--) {
    const a = keys[i], b = keys[i + 1];
    const seg = a.x === b.x ? String(a.x) : `${a.x}+(${(b.x - a.x).toFixed(4)})*(t-${a.t})/${(b.t - a.t).toFixed(3)}`;
    expr = `if(lt(t\\,${b.t})\\,${seg}\\,${expr})`;
  }
  return `if(lt(t\\,${keys[0].t})\\,${keys[0].x}\\,${expr})`;
}

// Main entry: returns an ffmpeg expression for the frame's position, or null (use the middle).
async function facePath({ ffmpeg, source, start, len, width, height }) {
  if (!width || !height) return null;
  const cropFrac = Math.min(1, (height * 9 / 16) / width);
  if (cropFrac >= 0.99) return null; // already tall: nothing to follow
  const samples = await detectFaces(ffmpeg, source, start, len);
  const keys = cameraPath(samples, cropFrac);
  if (!keys) return null;
  // ffmpeg expressions can't be endless; very busy clips just use fewer stops.
  let k = keys;
  while (k.length > 160) k = k.filter((_, i) => i % 2 === 0 || i === k.length - 1);
  return { expr: pathExpr(k), keys: k, faces: samples.filter((s) => s.faces.length).length, samples: samples.length };
}

module.exports = { facePath, cameraPath, pathExpr, decode, detectFaces };
