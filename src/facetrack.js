// "Follow faces" framing for Viral Clips.
// Looks at the clip a few times a second, finds faces with a small free face finder that runs
// on this computer (no internet, nothing to pay), and works out where the tall 9:16 frame
// should sit so the person stays in the picture. The frame holds still while the person stays
// inside it and glides over when they move, like a camera operator would.
// When there is more than one person, it follows the one who is talking: it watches whose mouth
// moves while words are being said, and only switches when someone else clearly takes over.
const path = require('path');
const { spawn } = require('child_process');

const MODEL = path.join(__dirname, '..', 'assets', 'models', 'face-detector-rfb320.onnx');
const IN_W = 320, IN_H = 240;
const SAMPLES_PER_SEC = 6; // mouths are checked 6 times a second, faces are found 3 times a second
// Bigger frames for watching mouths: 3x the face finder's size, so small faces (kids on a stage,
// a choir) still show their mouths moving.
const K = 3;
const BIG_W = IN_W * K, BIG_H = IN_H * K;

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
      '-an', '-vf', `fps=${SAMPLES_PER_SEC},scale=${BIG_W}:${BIG_H}:flags=bilinear`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-threads', '1', 'pipe:1'];
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const size = BIG_W * BIG_H * 3;
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

// How much a region of the picture changed since the last look (0..255), on brightness only.
function regionChange(cur, prev, f, fx1, fy1, fx2, fy2) {
  const w = f.x2 - f.x1, h = f.y2 - f.y1;
  const x1 = Math.max(0, Math.floor((f.x1 + w * fx1) * BIG_W)), x2 = Math.min(BIG_W, Math.ceil((f.x1 + w * fx2) * BIG_W));
  const y1 = Math.max(0, Math.floor((f.y1 + h * fy1) * BIG_H)), y2 = Math.min(BIG_H, Math.ceil((f.y1 + h * fy2) * BIG_H));
  let sum = 0, n = 0;
  for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) { const i = y * BIG_W + x; sum += Math.abs(cur[i] - prev[i]); n++; }
  return n ? sum / n : 0;
}

// Mouth movement for one face: change around the mouth, minus change around the eyes
// (so a person turning their head or the camera moving doesn't count as talking).
function mouthMovement(cur, prev, f) {
  if (!prev) return 0;
  const mouth = regionChange(cur, prev, f, 0.25, 0.62, 0.75, 0.98);
  const eyes = regionChange(cur, prev, f, 0.15, 0.2, 0.85, 0.5);
  return Math.max(0, mouth - eyes * 0.8);
}

async function detectFaces(ffmpeg, source, start, len) {
  const { ort, s } = await session();
  const input = new Float32Array(3 * IN_W * IN_H);
  const plane = IN_W * IN_H;
  const samples = [];
  let prevLuma = null;
  let faces = [];
  let n = 0;
  await readFrames(ffmpeg, source, start, len, async (rgb, t) => {
    const luma = new Uint8Array(BIG_W * BIG_H);
    for (let i = 0; i < luma.length; i++) luma[i] = (rgb[i * 3] * 77 + rgb[i * 3 + 1] * 150 + rgb[i * 3 + 2] * 29) >> 8;
    if (n++ % 2 === 0) { // find faces on every other frame (small picture for the face finder)
      for (let y = 0; y < IN_H; y++) for (let x = 0; x < IN_W; x++) {
        const o = y * IN_W + x;
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let dy = 0; dy < K; dy++) for (let dx = 0; dx < K; dx++) sum += rgb[((K * y + dy) * BIG_W + K * x + dx) * 3 + c];
          input[c * plane + o] = (sum / (K * K) - 127) / 128;
        }
      }
      const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, IN_H, IN_W]) });
      const [scores, boxes] = s.outputNames.map((nm) => out[nm].data);
      faces = decode(scores, boxes);
    }
    samples.push({ t, faces: faces.map((f) => ({ ...f, talk: mouthMovement(luma, prevLuma, f) })) });
    prevLuma = luma;
  });
  return samples;
}

// Picks who to follow in each moment and returns the wanted middle of the frame (0..1) or null.
// Faces are tracked as people from moment to moment. With one person, follow them. With more,
// follow the one whose mouth moves while words are being said. Switch to someone else only when
// they have clearly been the one talking for a moment, so the frame doesn't jump back and forth.
// speaking(t) says if someone is talking at time t (from the words heard); no list = always.
function targets(samples, speaking = () => true) {
  const mid = (f) => (f.x1 + f.x2) / 2;
  const area = (f) => (f.x2 - f.x1) * (f.y2 - f.y1);
  let people = [];
  let nextId = 1;
  let cur = null;
  let challenger = null, challengeFor = 0;
  const dt = 1 / SAMPLES_PER_SEC;
  // How much "talking" counts as talking depends on the video: small faces far away (kids on a
  // stage) move fewer pixels than one close-up face. So it's measured against this clip's own
  // busiest mouths instead of a fixed number.
  const all = samples.flatMap((x) => x.faces.map((f) => f.talk || 0)).filter((v) => v > 0).sort((a, b) => a - b);
  const busy = all.length ? all[Math.floor(all.length * 0.9)] : 0;
  const minTalk = Math.max(0.05, Math.min(0.6, busy * 0.35));
  // Who sings or talks most at the start (first 3 seconds), else over the whole clip, so the
  // clip starts on them right away and comes back to them, instead of the biggest face.
  const score = (until) => {
    const sum = {};
    for (const { t, faces } of samples) {
      if (t > until || !speaking(t)) continue;
      for (const f of faces) { const k = Math.round(mid(f) * 20); sum[k] = (sum[k] || 0) + (f.talk || 0); }
    }
    const key = Object.keys(sum).sort((a, b) => sum[b] - sum[a])[0];
    const others = Object.keys(sum).filter((k) => Math.abs(k - key) > 1).map((k) => sum[k]);
    const second = others.length ? Math.max(...others) : 0;
    return key != null && sum[key] > minTalk * 6 && sum[key] > second * 1.3 ? key / 20 : null;
  };
  const firstX = score(3) ?? score(Infinity);
  const out = [];
  samples.forEach(({ t, faces }) => {
    const usable = faces.filter((f) => (f.x2 - f.x1) > 0.025);
    // Match faces to the people seen just before (nearest, not too far away).
    const seen = new Set();
    for (const f of usable.slice().sort((a, b) => area(b) - area(a))) {
      let best = null;
      for (const p of people) {
        if (seen.has(p) || t - p.lastT > 1.5) continue;
        const d = Math.abs(p.x - mid(f));
        if (d < Math.max(0.15, (f.x2 - f.x1) * 2.5) && (!best || d < Math.abs(best.x - mid(f)))) best = p;
      }
      if (!best) { best = { id: nextId++, talk: 0, x: mid(f) }; people.push(best); }
      best.x = mid(f); best.lastT = t; best.size = area(f); best.face = f;
      seen.add(best);
      // How much this person seems to be talking lately (about the last second).
      const now = speaking(t) ? f.talk || 0 : 0;
      best.talk = best.talk * 0.85 + now * 0.15;
    }
    for (const p of people) if (!seen.has(p)) p.talk *= 0.9;
    people = people.filter((p) => t - p.lastT <= 3);
    const here = people.filter((p) => seen.has(p));
    if (!here.length) { out.push({ t, x: null }); return; }
    const loudest = here.reduce((a, b) => (b.talk > a.talk ? b : a));
    const biggest = here.reduce((a, b) => (b.size > a.size ? b : a));
    if (cur && !seen.has(cur) && here.length === 1) {
      cur = here[0]; // only one person in view: it's the one we follow (they moved, or the shot changed)
      challenger = null; challengeFor = 0;
    } else if (!cur && firstX != null) {
      cur = here.reduce((a, b) => (Math.abs(b.x - firstX) < Math.abs(a.x - firstX) ? b : a));
    } else if (!cur || !people.includes(cur) || (t - cur.lastT > 1.5)) {
      // Nobody followed yet (or they left): the one talking, else the biggest face.
      cur = loudest.talk > minTalk ? loudest : biggest;
      challenger = null; challengeFor = 0;
    } else if (loudest !== cur && loudest.talk > minTalk && loudest.talk > cur.talk * 1.6) {
      if (challenger !== loudest) { challenger = loudest; challengeFor = 0; }
      challengeFor += dt;
      if (challengeFor >= 0.8) {
        // They started talking a moment ago: move over from when they started, not late.
        const back = Math.round((challengeFor + 0.4) / dt);
        for (let i = Math.max(0, out.length - back); i < out.length; i++) if (out[i].x != null) out[i].x = loudest.x;
        cur = loudest; challenger = null; challengeFor = 0;
      }
    } else {
      challenger = null; challengeFor = 0;
    }
    out.push({ t, x: seen.has(cur) ? cur.x : null });
  });
  return out;
}

// Turns the face spots into a smooth camera path for the crop.
// cropFrac = how much of the picture's width the tall frame covers (e.g. 0.316 for 16:9 video).
// Returns keyframes [{t, x}] where x is the left edge of the frame as a share (0..1) of the free room.
function cameraPath(samples, cropFrac, speaking) {
  const pts = targets(samples, speaking);
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

function speakingFrom(speech, len) {
  const covered = (speech || []).reduce((sum, [a, b]) => sum + Math.max(0, Math.min(len, b) - Math.max(0, a)), 0);
  return speech && speech.length && covered > len * 0.4 ? (t) => speech.some(([a, b]) => t >= a - 0.2 && t <= b + 0.2) : undefined;
}

// Main entry: returns an ffmpeg expression for the frame's position, or null (use the middle).
// speech: optional list of [start, end] times (from the clip's start) when words are said.
async function facePath({ ffmpeg, source, start, len, width, height, speech }) {
  if (!width || !height) return null;
  const cropFrac = Math.min(1, (height * 9 / 16) / width);
  if (cropFrac >= 0.99) return null; // already tall: nothing to follow
  const samples = await detectFaces(ffmpeg, source, start, len);
  // Words heard tell when someone is talking. In songs the words are often only partly heard,
  // so when they cover little of the clip, every moment counts (the mouths decide).
  const speaking = speakingFrom(speech, len);
  const keys = cameraPath(samples, cropFrac, speaking);
  if (!keys) return null;
  // ffmpeg expressions can't be endless; very busy clips just use fewer stops.
  let k = keys;
  while (k.length > 160) k = k.filter((_, i) => i % 2 === 0 || i === k.length - 1);
  return { expr: pathExpr(k), keys: k, faces: samples.filter((s) => s.faces.length).length, samples: samples.length };
}

module.exports = { speakingFrom, facePath, cameraPath, pathExpr, decode, detectFaces, targets };
