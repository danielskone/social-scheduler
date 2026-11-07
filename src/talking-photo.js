// Makes a still photo talk, free and offline: the jaw and lips move with the voice, the eyes
// blink and the head sways a little. The face points come from the browser (MediaPipe, Google's
// free face finder, run on this Mac); this file draws every frame and hands them to ffmpeg.
//
// Run as its own process so the server stays quick while it draws:
//   node src/talking-photo.js job.json   (job: { ffmpeg, photo, audio, out, face, width, height })
const fs = require('fs');
const { spawn } = require('child_process');

const FPS = 30;
// MediaPipe face mesh point numbers.
const UP_IN = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308];
const LO_IN = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308];
const LO_OUT = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291];
const EYES = [[[159, 158, 157, 160, 161], [145, 153, 154, 144, 163]], [[386, 385, 384, 387, 388], [374, 380, 381, 373, 390]]];
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function readAll(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let err = '';
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(err.trim().split('\n').pop() || `ffmpeg stopped (${code})`))));
  });
}

// How open the mouth is in each frame, from how loud the speech is.
function mouthTrack(pcm) {
  const hop = Math.round(16000 / FPS);
  const n = Math.floor(pcm.length / hop);
  const db = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = i * hop; k < (i + 1) * hop; k++) s += pcm[k] * pcm[k];
    db[i] = 10 * Math.log10(s / hop + 1e-9);
  }
  const sorted = Array.from(db).sort((a, b) => a - b);
  const pct = (q) => sorted[Math.min(n - 1, Math.max(0, Math.round((q / 100) * (n - 1))))];
  const lo = pct(15), hi = pct(97);
  const o = Array.from(db, (d) => clamp((d - lo - 4) / Math.max(1, hi - lo - 4), 0, 1) ** 0.8);
  // Opens quickly, closes a little slower, and moves one frame before the sound (as real mouths do).
  const out = new Float64Array(n);
  let v = 0;
  for (let i = 0; i < n; i++) {
    const t = o[Math.min(n - 1, i + 1)];
    v += (t - v) * (t > v ? 0.65 : 0.45);
    out[i] = v;
  }
  return out;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function smoothNoise(rand, n, scale, width) {
  const raw = Array.from({ length: n + width * 2 }, () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand()));
  const k = Array.from({ length: width }, (_, i) => Math.exp(-(((i / (width - 1)) * 6 - 3) ** 2)));
  const ks = k.reduce((a, b) => a + b, 0);
  return Array.from({ length: n }, (_, i) => {
    let s = 0;
    for (let j = 0; j < width; j++) s += raw[i + (width >> 1) + j] * k[j];
    return (s / ks) * scale * Math.sqrt(width);
  });
}

// Bowyer-Watson Delaunay triangulation: returns triangles as point-number triples.
function triangulate(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const d = Math.max(maxX - minX, maxY - minY) * 20, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const P = pts.concat([[cx - d, cy - d], [cx + d, cy - d], [cx, cy + d]]);
  const N = pts.length;
  const circ = (a, b, c) => {
    const [ax, ay] = P[a], [bx, by] = P[b], [cx2, cy2] = P[c];
    const D = 2 * (ax * (by - cy2) + bx * (cy2 - ay) + cx2 * (ay - by));
    const ux = ((ax * ax + ay * ay) * (by - cy2) + (bx * bx + by * by) * (cy2 - ay) + (cx2 * cx2 + cy2 * cy2) * (ay - by)) / D;
    const uy = ((ax * ax + ay * ay) * (cx2 - bx) + (bx * bx + by * by) * (ax - cx2) + (cx2 * cx2 + cy2 * cy2) * (bx - ax)) / D;
    return { a, b, c, x: ux, y: uy, r: (ax - ux) ** 2 + (ay - uy) ** 2 };
  };
  let tris = [circ(N, N + 1, N + 2)];
  for (let i = 0; i < N; i++) {
    const [px, py] = P[i];
    const bad = [], keep = [];
    for (const t of tris) ((px - t.x) ** 2 + (py - t.y) ** 2 < t.r ? bad : keep).push(t);
    const edges = new Map();
    for (const t of bad) for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
      const key = u < v ? `${u},${v}` : `${v},${u}`;
      edges.set(key, edges.has(key) ? null : [u, v]);
    }
    for (const e of edges.values()) if (e) keep.push(circ(e[0], e[1], i));
    tris = keep;
  }
  return tris.filter((t) => t.a < N && t.b < N && t.c < N).map((t) => [t.a, t.b, t.c]);
}

function bilinear(src, W, H, x, y, out, o) {
  x = clamp(x, 0, W - 1.001); y = clamp(y, 0, H - 1.001);
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
  const i00 = (y0 * W + x0) * 3, i10 = i00 + 3, i01 = i00 + W * 3, i11 = i01 + 3;
  for (let c = 0; c < 3; c++) {
    out[o + c] = (src[i00 + c] * (1 - fx) + src[i10 + c] * fx) * (1 - fy) + (src[i01 + c] * (1 - fx) + src[i11 + c] * fx) * fy + 0.5;
  }
}

// Soft-edged coverage of a polygon at (x, y): 1 inside, 0 outside, a smooth edge `feather` px wide.
function coverage(poly, x, y, feather) {
  let inside = false, best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    const dx = xj - xi, dy = yj - yi, L = dx * dx + dy * dy || 1;
    const t = clamp(((x - xi) * dx + (y - yi) * dy) / L, 0, 1);
    best = Math.min(best, (x - xi - t * dx) ** 2 + (y - yi - t * dy) ** 2);
  }
  const d = Math.sqrt(best) / feather;
  return inside ? clamp(0.5 + d, 0, 1) : clamp(0.5 - d, 0, 1);
}

// Everything that stays the same for every frame: which points move with the jaw, the mesh, colours.
function setup(face, W, H, img) {
  const P = face.map(([x, y]) => [x * W, y * H]);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const faceH = dist(P[152], P[10]);
  const mouthW = dist(P[291], P[61]);
  const mc = [(P[13][0] + P[14][0]) / 2, (P[13][1] + P[14][1]) / 2];
  const chin = P[152];
  const fc = P.reduce((s, p) => [s[0] + p[0] / P.length, s[1] + p[1] / P.length], [0, 0]);
  const wt = P.map((p) => {
    const below = p[1] - mc[1];
    if (below <= 0) return 0;
    const side = Math.max(0, 1 - (Math.abs(p[0] - mc[0]) / (mouthW * 1.4)) ** 2);
    return side * Math.min(1, 0.45 + below / (chin[1] - mc[1] + 1e-6));
  });
  for (const i of [...LO_IN, ...LO_OUT, 14, 87, 317, 178, 402, 17]) {
    wt[i] = Math.max(wt[i], Math.max(0.15, 1 - (Math.abs(P[i][0] - mc[0]) / (mouthW * 0.55)) ** 2));
  }
  for (const i of [61, 291, 78, 308]) wt[i] = 0.12; // the corners barely move
  // Anchors that never move: the photo's edges and a ring around the face, so the background stays still.
  const anchors = [];
  for (let k = 0; k < 6; k++) { const x = (k * (W - 1)) / 5, y = (k * (H - 1)) / 5; anchors.push([x, 0], [x, H - 1]); if (k > 0 && k < 5) anchors.push([0, y], [W - 1, y]); }
  for (const i of OVAL) anchors.push([fc[0] + (P[i][0] - fc[0]) * 1.35, fc[1] + (P[i][1] - fc[1]) * 1.35]);
  const all = P.concat(anchors);
  const weight = wt.concat(anchors.map(() => 0));
  const tris = triangulate(all);
  // Mouth colours come from the lips in this photo.
  const lip = [0, 0, 0]; let cnt = 0;
  const lipPoly = [...LO_OUT.map((i) => P[i]), ...LO_IN.slice().reverse().map((i) => P[i])];
  const xs = lipPoly.map((p) => p[0]), ys = lipPoly.map((p) => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
    for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H || coverage(lipPoly, x, y, 1) < 0.5) continue;
      const o = (y * W + x) * 3; lip[0] += img[o]; lip[1] += img[o + 1]; lip[2] += img[o + 2]; cnt++;
    }
  }
  const lipC = cnt ? lip.map((v) => v / cnt) : [150, 70, 70];
  return {
    P, all, weight, tris, faceH, mouthW, mc, chin, fc,
    jaw: 0.055 * faceH,
    // A photo with the mouth already open (a big smile) shows its own teeth: stretch those instead of drawing new ones.
    restGap: P[14][1] - P[13][1],
    paint: clamp((0.12 - (P[14][1] - P[13][1]) / mouthW) / 0.08, 0, 1),
    dark: lipC.map((v) => v * 0.28),
    teeth: [212, 207, 200].map((v, c) => v * 0.72 + lipC[c] * 0.1),
  };
}

function drawFrame(S, img, W, H, open, blink, head, warped, out) {
  const { P, all, weight, tris, jaw, mc, mouthW } = S;
  const n = all.length;
  const dx = new Float64Array(n), dy = new Float64Array(n);
  for (let i = 0; i < n; i++) dy[i] = weight[i] * open * jaw;
  for (const i of [61, 78, 291, 308]) dx[i] += (mc[0] - P[i][0]) * 0.06 * open; // lips narrow a little
  for (const i of [...UP_IN, 0, 37, 267, 39, 269]) dy[i] -= open * jaw * 0.08;
  for (const [up, lo] of EYES) up.forEach((u, k) => { dy[u] += (P[lo[k]][1] - P[u][1]) * 0.9 * blink; });

  img.copy(warped);
  // Redraw only the triangles that move: each destination pixel reads back from the photo.
  for (const [a, b, c] of tris) {
    if (!dx[a] && !dy[a] && !dx[b] && !dy[b] && !dx[c] && !dy[c]) continue;
    const ax = all[a][0] + dx[a], ay = all[a][1] + dy[a], bx = all[b][0] + dx[b], by = all[b][1] + dy[b], cx = all[c][0] + dx[c], cy = all[c][1] + dy[c];
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const l0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den;
        const l1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den;
        const l2 = 1 - l0 - l1;
        if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
        bilinear(img, W, H, l0 * all[a][0] + l1 * all[b][0] + l2 * all[c][0], l0 * all[a][1] + l1 * all[b][1] + l2 * all[c][1], warped, (y * W + x) * 3);
      }
    }
  }

  // The open mouth: dark inside, with the upper teeth showing under the top lip.
  const at = (i) => [P[i][0] + dx[i], P[i][1] + dy[i]];
  const top = at(13), gap = at(14)[1] - top[1];
  if (S.paint > 0 && gap - S.restGap > 1.5) {
    const upper = UP_IN.map(at);
    const poly = [...upper, ...LO_IN.slice().reverse().map(at)];
    const th = Math.min(gap * 0.42, mouthW * 0.1);
    const band = [...upper.map(([x, y]) => [x, y - 2]), ...upper.slice().reverse().map(([x, y]) => [x, y + th])];
    const fm = Math.max(1.2, gap * 0.2), ft = Math.max(1.3, gap * 0.22);
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys) - 3)); y <= Math.min(H - 1, Math.ceil(Math.max(...ys) + 3)); y++) {
      const ry = (y - top[1]) / gap;
      const shade = clamp(1 - 0.45 * ry, 0.5, 1);
      for (let x = Math.max(0, Math.floor(Math.min(...xs) - 3)); x <= Math.min(W - 1, Math.ceil(Math.max(...xs) + 3)); x++) {
        const m = coverage(poly, x, y, fm) * S.paint;
        if (m <= 0) continue;
        const t = coverage(band, x, y, ft) * clamp(1.3 - (Math.abs(x - top[0]) / (mouthW * 0.42)) ** 2, 0, 1) * 0.92;
        const o = (y * W + x) * 3;
        for (let c = 0; c < 3; c++) {
          const inner = S.dark[c] * shade * (1 - t) + S.teeth[c] * t;
          warped[o + c] = warped[o + c] * (1 - m) + inner * m + 0.5;
        }
      }
    }
  }

  // A small, natural head movement around the neck (the whole picture turns very slightly).
  const cx0 = S.fc[0], cy0 = S.chin[1], sc = 1.035;
  const cos = Math.cos(-head.angle), sin = Math.sin(-head.angle);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ux = (x - cx0 - head.x) / sc, uy = (y - cy0 - head.y) / sc;
      bilinear(warped, W, H, cx0 + cos * ux - sin * uy, cy0 + sin * ux + cos * uy, out, (y * W + x) * 3);
    }
  }
}

async function makeTalking({ ffmpeg, photo, audio, out, face, width, height, seed = 7, onProgress = () => {} }) {
  if (!Array.isArray(face) || face.length < 468) throw new Error('No face points.');
  const W = Math.min(1080, Math.round(width / 2) * 2) || 1080;
  const H = Math.round((W * height) / width / 2) * 2;
  const img = await readAll(ffmpeg, ['-v', 'error', '-i', photo, '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  if (img.length !== W * H * 3) throw new Error('Could not read the photo.');
  const raw = await readAll(ffmpeg, ['-v', 'error', '-i', audio, '-ac', '1', '-ar', '16000', '-af', 'highpass=f=200,lowpass=f=3500', '-f', 's16le', '-']);
  const pcm = new Float32Array(raw.length >> 1);
  for (let i = 0; i < pcm.length; i++) pcm[i] = raw.readInt16LE(i * 2) / 32768;
  const open = mouthTrack(pcm);
  const n = open.length;
  if (n < 5) throw new Error('The voiceover is empty.');

  const S = setup(face, W, H, img);
  const rand = rng(seed);
  const yaw = smoothNoise(rand, n, 0.35, 45), pitch = smoothNoise(rand, n, 0.25, 45), rot = smoothNoise(rand, n, 0.3, 61);
  const blink = new Float64Array(n);
  for (let t = Math.round(30 + rand() * 40); t < n; t += Math.round(70 + rand() * 80)) {
    [0.5, 1, 1, 0.6, 0.25].forEach((f, k) => { if (t + k < n) blink[t + k] = Math.max(blink[t + k], f); });
  }

  const enc = spawn(ffmpeg, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-', '-i', audio,
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out],
  { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  enc.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
  const done = new Promise((resolve, reject) => {
    enc.on('error', reject);
    enc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `ffmpeg stopped (${code})`))));
  });
  const warped = Buffer.alloc(W * H * 3);
  for (let f = 0; f < n; f++) {
    const frame = Buffer.alloc(W * H * 3);
    const deg = rot[f] + 0.4 * open[f] * Math.sin(f / 7);
    drawFrame(S, img, W, H, open[f], blink[f], { angle: (deg * Math.PI) / 180, x: yaw[f] * 6, y: pitch[f] * 5 - open[f] * 2 }, warped, frame);
    if (!enc.stdin.write(frame)) await new Promise((r) => enc.stdin.once('drain', r));
    if (f % 15 === 0) onProgress(f / n);
  }
  enc.stdin.end();
  await done;
  return { frames: n, width: W, height: H, open };
}

module.exports = { makeTalking, mouthTrack, triangulate, FPS };

if (require.main === module) {
  const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  makeTalking({ ...job, onProgress: (p) => process.stdout.write(`${JSON.stringify({ at: +p.toFixed(3) })}\n`) })
    .then((r) => { process.stdout.write(`${JSON.stringify({ done: true, frames: r.frames })}\n`); })
    .catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
}
