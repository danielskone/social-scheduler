// "Remove words on screen" for Viral Post.
// Finds words burned into a video or photo (lyrics, titles, captions) with a small free text
// finder that runs on this computer (PaddleOCR's text detector, Apache 2.0, no internet, nothing
// to pay), then has ffmpeg paint over each spot with the colors around it (its "delogo" filter),
// only while the words are on screen.
// Honest limits: on plain or soft backgrounds the spot blends in well. On busy backgrounds
// (faces, patterns, a crowd) a soft smudge can be seen where the words were. Words that are part
// of the scene (a sign, a T-shirt) are found too and get smoothed over the same way.
const path = require('path');
const { spawn } = require('child_process');

const MODEL = path.join(__dirname, '..', 'assets', 'models', 'text-detector-ppocrv4.onnx');
const MAX_SIDE = 736;           // frames are shrunk to this size for the text finder (fast, still finds captions)
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

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

// Size of the small frames the text finder looks at (both sides a multiple of 32, as it needs).
function detSize(width, height) {
  const s = Math.min(1, MAX_SIDE / Math.max(width, height));
  const r32 = (v) => Math.max(32, Math.round((v * s) / 32) * 32);
  return { W: r32(width), H: r32(height) };
}

// Turns the text finder's "is this a letter?" map into boxes (0..1 of the picture).
// Neighbouring letter pixels are grouped, weak or tiny groups are dropped, and each box is grown
// a little (the finder marks the middle of the letters, not their edges).
function boxesFromMap(prob, W, H, { thresh = 0.3, minScore = 0.55 } = {}) {
  const seen = new Uint8Array(W * H);
  const out = [];
  const stack = [];
  for (let start = 0; start < W * H; start++) {
    if (seen[start] || prob[start] < thresh) continue;
    let x1 = W, y1 = H, x2 = 0, y2 = 0, sum = 0, n = 0;
    stack.push(start); seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      const x = i % W, y = (i - x) / W;
      sum += prob[i]; n++;
      if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
      if (x > 0 && !seen[i - 1] && prob[i - 1] >= thresh) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < W - 1 && !seen[i + 1] && prob[i + 1] >= thresh) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && !seen[i - W] && prob[i - W] >= thresh) { seen[i - W] = 1; stack.push(i - W); }
      if (y < H - 1 && !seen[i + W] && prob[i + W] >= thresh) { seen[i + W] = 1; stack.push(i + W); }
    }
    const w = x2 - x1 + 1, h = y2 - y1 + 1;
    if (n < 6 || w < 3 || h < 3 || sum / n < minScore) continue;
    const grow = (w * h * 1.6) / (2 * (w + h)) + 1; // like the finder's own "unclip" step
    out.push({
      x1: Math.max(0, (x1 - grow) / W), y1: Math.max(0, (y1 - grow) / H),
      x2: Math.min(1, (x2 + 1 + grow) / W), y2: Math.min(1, (y2 + 1 + grow) / H),
      score: sum / n,
    });
  }
  return out;
}

// Looks at one small frame (rgb24 bytes, W x H) and returns the boxes with words in them.
async function findText(rgb, W, H) {
  const { ort, s } = await session();
  const plane = W * H;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    // The finder was trained on pictures in blue-green-red order.
    input[i] = (rgb[i * 3 + 2] / 255 - MEAN[0]) / STD[0];
    input[plane + i] = (rgb[i * 3 + 1] / 255 - MEAN[1]) / STD[1];
    input[2 * plane + i] = (rgb[i * 3] / 255 - MEAN[2]) / STD[2];
  }
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, H, W]) });
  return boxesFromMap(out[s.outputNames[0]].data, W, H);
}

// Reads small frames out of ffmpeg (no files written). fps = null reads a single picture.
function readFrames(ffmpeg, source, { W, H, fps, isImage }, onFrame) {
  return new Promise((resolve, reject) => {
    const vf = `${fps ? `fps=${fps},` : ''}scale=${W}:${H}:flags=bilinear`;
    const args = ['-hide_banner', '-loglevel', 'error', ...(isImage ? ['-noautorotate'] : []), '-i', source,
      '-an', '-vf', isImage && isImage.rotate ? `${isImage.rotate},${vf}` : vf,
      ...(fps ? [] : ['-frames:v', '1']), '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-threads', '1', 'pipe:1'];
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const size = W * H * 3;
    let buf = Buffer.alloc(0);
    let n = 0;
    let chain = Promise.resolve();
    let err = '';
    child.stdout.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= size) {
        const frame = Buffer.from(buf.subarray(0, size));
        buf = buf.subarray(size);
        const t = fps ? n / fps : 0;
        n++;
        chain = chain.then(() => onFrame(frame, t));
      }
    });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => chain.then(() => (code === 0 ? resolve(n) : reject(new Error(err.trim() || `ffmpeg ${code}`))), reject));
  });
}

const area = (b) => (b.x2 - b.x1) * (b.y2 - b.y1);
function overlap(a, b) {
  const w = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const h = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  return (w * h) / Math.min(area(a), area(b)); // 1 = one box sits inside the other
}
const union = (a, b) => ({ x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) });

// Follows each piece of text from look to look, so one line of lyrics becomes one spot to paint
// over (from just before it appears until just after it goes), not dozens of tiny ones.
// samples: [{ t, boxes }] in time order; dt: seconds between looks.
function plan(samples, dt) {
  const tracks = [];
  for (const { t, boxes } of samples) {
    for (const b of boxes) {
      const live = tracks.filter((tr) => t - tr.last <= dt * 1.6 && overlap(tr.box, b) > 0.35);
      if (live.length) {
        const tr = live[0];
        tr.box = union(tr.box, b); tr.last = t;
        for (const other of live.slice(1)) { // two tracks turned out to be the same words
          tr.box = union(tr.box, other.box); tr.first = Math.min(tr.first, other.first);
          tracks.splice(tracks.indexOf(other), 1);
        }
      } else {
        tracks.push({ box: { ...b }, first: t, last: t });
      }
    }
  }
  // From just before the words were first seen to just after they were last seen.
  let spots = tracks.map((tr) => ({ box: tr.box, start: Math.max(0, tr.first - dt), end: tr.last + dt }));
  // Spots that sit on top of each other and are on screen at the same time become one.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const a = spots[i], b = spots[j];
        if (a.start <= b.end && b.start <= a.end && overlap(a.box, b.box) > 0.5) {
          spots[i] = { box: union(a.box, b.box), start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
          spots.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  // Very long videos with words everywhere: keep the filter list a sensible size.
  if (spots.length > 400) spots = spots.sort((a, b) => area(b.box) * (b.end - b.start) - area(a.box) * (a.end - a.start)).slice(0, 400);
  return spots.sort((a, b) => a.start - b.start);
}

// The ffmpeg filters that paint over each spot (in the picture's real pixels).
// still = a photo (no times needed).
function filters(spots, width, height, { still = false } = {}) {
  const parts = [];
  for (const s of spots) {
    // delogo needs a 1-pixel border of real picture around the spot to borrow colors from.
    const pad = 0.006;
    const x = Math.max(1, Math.floor((s.box.x1 - pad) * width));
    const y = Math.max(1, Math.floor((s.box.y1 - pad) * height));
    const x2 = Math.min(width - 2, Math.ceil((s.box.x2 + pad) * width));
    const y2 = Math.min(height - 2, Math.ceil((s.box.y2 + pad) * height));
    if (x2 - x < 2 || y2 - y < 2) continue;
    const when = still ? '' : `:enable='between(t,${s.start.toFixed(2)},${s.end.toFixed(2)})'`;
    parts.push(`delogo=x=${x}:y=${y}:w=${x2 - x}:h=${y2 - y}${when}`);
  }
  return parts;
}

// Finds the words in a whole video (or a photo) and returns the ffmpeg filters to remove them.
// info: { width, height, duration } of the picture as shown (already turned upright).
async function removalFilters({ ffmpeg, source, width, height, duration = 0, image = null, onProgress }) {
  const { W, H } = detSize(width, height);
  if (image) {
    let boxes = [];
    await readFrames(ffmpeg, source, { W, H, fps: null, isImage: image }, async (rgb) => { boxes = await findText(rgb, W, H); });
    const spots = boxes.map((b) => ({ box: b, start: 0, end: 0 }));
    return { spots, filters: filters(spots, width, height, { still: true }) };
  }
  // 3 looks a second for songs up to 3 minutes, 2 a second for longer videos.
  const fps = duration > 180 ? 2 : 3;
  const samples = [];
  await readFrames(ffmpeg, source, { W, H, fps }, async (rgb, t) => {
    samples.push({ t, boxes: await findText(rgb, W, H) });
    if (onProgress && duration) onProgress(Math.min(1, t / duration));
  });
  const spots = plan(samples, 1 / fps);
  return { spots, filters: filters(spots, width, height) };
}

module.exports = { removalFilters, boxesFromMap, plan, filters, detSize, findText, MODEL };
