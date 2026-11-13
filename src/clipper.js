// Clips: turns a long video into short vertical clips (for Reels, Shorts and TikTok) with
// captions, ready to schedule. Everything runs on this computer for free:
//   - ffmpeg (installed with the app) cuts, reframes to 9:16 and burns in the captions
//   - Whisper (a free speech-to-text model, downloaded once, ~200 MB) writes the captions
//   - the best moments are picked from what is said and how it's said (see pickClips)
// Videos are processed one at a time, at low priority, so the Mac and the scheduler stay quick.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const express = require('express');
const multer = require('multer');
const config = require('./config');
const db = require('./db');
const linkimport = require('./linkimport');

const clipsDir = path.join(config.dataDir, 'clips');
const modelDir = path.join(config.dataDir, 'models');
const fontsDir = path.join(__dirname, '..', 'assets', 'fonts');
fs.mkdirSync(clipsDir, { recursive: true });

function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { const p = require('ffmpeg-static'); if (p && fs.existsSync(p)) return p; } catch {}
  return 'ffmpeg'; // one installed on the computer, if any
}

db.exec(`
CREATE TABLE IF NOT EXISTS clip_jobs (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  source_file TEXT NOT NULL,
  duration REAL, width INTEGER, height INTEGER,
  settings TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',   -- queued, working, ready, failed
  step TEXT, progress INTEGER NOT NULL DEFAULT 0, error TEXT, note TEXT,
  transcript TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS clips (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES clip_jobs(id) ON DELETE CASCADE,
  n INTEGER NOT NULL,
  start REAL NOT NULL, end REAL NOT NULL,
  score INTEGER, reason TEXT, title TEXT,
  text TEXT, text_edited INTEGER NOT NULL DEFAULT 0,
  framing TEXT NOT NULL DEFAULT 'center',
  captions TEXT NOT NULL DEFAULT 'bold',
  file TEXT, poster TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, rendering, ready, failed
  error TEXT
);
`);

// Added later: a small, light copy of each clip for watching in the app (fast on a phone or a
// slow connection). The full-quality file is still used for saving and posting.
if (!db.prepare('PRAGMA table_info(clips)').all().some((c) => c.name === 'preview')) {
  db.exec('ALTER TABLE clips ADD COLUMN preview TEXT');
}

const LENGTHS = { short: [15, 35], medium: [30, 60], long: [55, 90] };
const FRAMINGS = ['center', 'left', 'right', 'fit'];
const CAPTIONS = ['bold', 'clean', 'none'];

// ---------- Small helpers ----------
function run(cmd, args, { cwd, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    try { os.setPriority(child.pid, 10); } catch {}
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); onStderr?.(String(d)); });
    child.stdout.on('data', () => {});
    child.on('error', (err) => reject(err.code === 'ENOENT' && cmd === ffmpegPath() ? new Error('The video tool (ffmpeg) is missing. In Terminal run: cd ~/social-scheduler && npm run update && npm run background:on') : err));
    child.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(err.trim().split('\n').slice(-3).join(' ') || `${cmd} stopped (${code})`))));
  });
}

// Length and size of a video, read from ffmpeg's own description of the file.
async function probe(file) {
  const out = await new Promise((resolve) => {
    execFile(ffmpegPath(), ['-hide_banner', '-i', file], { maxBuffer: 1 << 20 }, (err, stdout, stderr) => resolve(String(stderr)));
  });
  const d = out.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const v = out.match(/Stream #.*Video:.*?(\d{2,5})x(\d{2,5})/);
  const rot = out.match(/rotation of (-?\d+)|rotate\s*:\s*(-?\d+)/);
  if (!d || !v) return null;
  let width = Number(v[1]), height = Number(v[2]);
  if (rot && Math.abs(Number(rot[1] || rot[2])) % 180 === 90) [width, height] = [height, width];
  return { duration: Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]), width, height, hasAudio: /Stream #.*Audio:/.test(out) };
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
}

// The speech model is downloaded once from the speech engine's own public releases.
const MODEL_URL = process.env.CLIPS_MODEL_URL || 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models';
async function ensureModels(setStep) {
  const whisper = path.join(modelDir, 'whisper');
  const need = ['base.en-encoder.int8.onnx', 'base.en-decoder.int8.onnx', 'base.en-tokens.txt'];
  fs.mkdirSync(whisper, { recursive: true });
  if (!fs.existsSync(path.join(modelDir, 'silero_vad.onnx'))) {
    await download(`${MODEL_URL}/silero_vad.onnx`, path.join(modelDir, 'silero_vad.onnx'));
  }
  if (need.every((f) => fs.existsSync(path.join(whisper, f)))) return;
  setStep('Downloading the free speech-to-text model (one time only, about 200 MB)…');
  const archive = path.join(modelDir, 'whisper-base.en.tar.bz2');
  await download(`${MODEL_URL}/sherpa-onnx-whisper-base.en.tar.bz2`, archive);
  setStep('Unpacking the speech-to-text model…');
  const tmp = fs.mkdtempSync(path.join(modelDir, 'unpack-'));
  try {
    await run('tar', ['-xjf', archive, '-C', tmp, ...need.map((f) => `sherpa-onnx-whisper-base.en/${f}`)]);
    for (const f of need) fs.renameSync(path.join(tmp, 'sherpa-onnx-whisper-base.en', f), path.join(whisper, f));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(archive, { force: true });
  }
}

function transcribe(video, onAt = () => {}, out = path.join(path.dirname(video), 'speech.json')) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'speech-worker.js'), ffmpegPath(), video, modelDir, out], { stdio: ['ignore', 'pipe', 'pipe'] });
    try { os.setPriority(child.pid, 10); } catch {}
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d).slice(-3000); });
    child.stdout.on('data', (d) => String(d).split('\n').forEach((l) => { try { const m = JSON.parse(l); if (m.at != null) onAt(m.at); } catch {} }));
    child.on('error', reject);
    child.on('close', () => {
      try { resolve(JSON.parse(fs.readFileSync(out, 'utf8'))); }
      catch { reject(new Error(`Couldn't listen to the video. ${err.trim().split('\n').slice(-2).join(' ')}`)); }
    });
  });
}

// ---------- Picking the best moments ----------
// No paid AI: each possible clip gets points for things that make short videos work.
const HOOKS = /\b(how|why|what|who|when|imagine|secret|mistake|never|always|stop|best|worst|biggest|first|last|only|truth|actually|honestly|crazy|insane|amazing|incredible|love|hate|need|must|free|money|win|everyone|nobody|here's|this is|listen|watch|look|remember|don't|you)\b/gi;
const STRONG_START = /^(how|why|what|who|imagine|here's|this is|the (secret|truth|reason|best|biggest)|stop|never|if you|you|did you|have you|do you|listen|look|watch|so here's)\b/i;
const FILLER = /^(um+|uh+|so|and|but|like|yeah|okay|ok|well)\b[,\s]*/i;

function clipText(segments, start, end) {
  return segments.filter((s) => s.end > start + 0.2 && s.start < end - 0.2).map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
}

function firstSentence(text, max = 100) {
  const s = String(text || '').replace(FILLER, '').trim();
  const m = s.match(/^.{12,}?[.!?](\s|$)/);
  let out = (m ? m[0] : s).trim();
  if (out.length > max) out = `${out.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

function pickClips({ segments = [], loudness = [], duration, length = 'medium', count = 8 }) {
  const [minLen, maxLen] = LENGTHS[length] || LENGTHS.medium;
  const avgLoud = loudness.length ? loudness.reduce((a, b) => a + b, 0) / loudness.length : 0;
  const loudAt = (a, b) => {
    const xs = loudness.slice(Math.floor(a * 2), Math.ceil(b * 2));
    return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
  };
  const candidates = [];

  if (segments.length) {
    for (let i = 0; i < segments.length; i++) {
      // Start on a sentence, not in the middle of someone's thought.
      if (i > 0 && !/[.!?]["']?$/.test(segments[i - 1].text) && segments[i].start - segments[i - 1].end < 1.2) continue;
      for (let j = i; j < segments.length; j++) {
        const start = Math.max(0, segments[i].start - 0.25);
        const end = Math.min(duration, segments[j].end + 0.35);
        const len = end - start;
        if (len > maxLen) break;
        if (len < minLen) continue;
        const parts = segments.slice(i, j + 1);
        const text = parts.map((s) => s.text).join(' ');
        const words = text.split(/\s+/).filter(Boolean).length;
        const talking = parts.reduce((s, p) => s + (p.end - p.start), 0);
        let gaps = 0;
        for (let k = i + 1; k <= j; k++) gaps = Math.max(gaps, segments[k].start - segments[k - 1].end);
        const reasons = [];
        let score = 40;
        const first = parts[0].text.replace(FILLER, '');
        if (STRONG_START.test(first) || /\?$/.test(parts[0].text)) { score += 14; reasons.push('Strong opening line'); }
        const hooks = (text.match(HOOKS) || []).length;
        score += Math.min(14, hooks * 1.2);
        if (hooks >= 6) reasons.push('Grabby words');
        const qs = (text.match(/[?!]/g) || []).length;
        score += Math.min(8, qs * 2.5);
        if (qs >= 2) reasons.push('Questions and big moments');
        if (/\d/.test(text)) { score += 4; reasons.push('Specific numbers'); }
        const wps = words / len;
        if (wps > 2.2) { score += 8; reasons.push('Fast, lively delivery'); } else if (wps < 1.3) score -= 10;
        if (talking / len > 0.85) score += 6; else if (talking / len < 0.6) score -= 10;
        if (gaps > 2.5) score -= 8;
        if (avgLoud && loudAt(start, end) > avgLoud * 1.15) { score += 6; reasons.push('High energy'); }
        if (/[.!?]["']?$/.test(parts[parts.length - 1].text)) { score += 6; reasons.push('Ends on a full thought'); } else score -= 6;
        candidates.push({ start, end, score, reasons, text });
      }
    }
  }

  // No talking (music, b-roll): use the most energetic stretches instead.
  if (!candidates.length && duration) {
    const len = Math.min(maxLen, Math.max(minLen, Math.round((minLen + maxLen) / 2)), duration);
    for (let s = 0; s + len <= duration + 0.01; s += Math.max(2, len / 4)) {
      const e = loudAt(s, s + len);
      candidates.push({ start: s, end: s + len, score: 50 + (avgLoud ? Math.round(Math.min(20, ((e / avgLoud) - 1) * 40)) : 0), reasons: ['Most energetic part'], text: '' });
    }
    if (!candidates.length) candidates.push({ start: 0, end: Math.min(duration, maxLen), score: 50, reasons: ['Whole video'], text: '' });
  }

  candidates.sort((a, b) => b.score - a.score || a.start - b.start);
  const picked = [];
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (picked.some((p) => c.start < p.end - 1 && c.end > p.start + 1)) continue;
    picked.push(c);
  }
  return picked.map((c) => ({
    start: +c.start.toFixed(2),
    end: +c.end.toFixed(2),
    score: Math.max(1, Math.min(99, Math.round(c.score))),
    reason: c.reasons.slice(0, 3).join(' · ') || 'Good flow',
    text: c.text.trim(),
    title: firstSentence(c.text) || 'Clip',
  }));
}

// ---------- Captions ----------
// Words for a clip, with times starting at 0. If the words were edited by hand, the new words
// are spread over the times when someone is talking.
function captionWords(segments, start, end, editedText) {
  const inClip = segments.filter((s) => s.end > start && s.start < end);
  if (editedText == null) {
    return inClip.flatMap((s) => s.words || []).filter((w) => w.end > start && w.start < end)
      .map((w) => ({ text: w.text, start: Math.max(0, w.start - start), end: Math.min(end, w.end) - start }));
  }
  const words = String(editedText).split(/\s+/).filter(Boolean);
  const spans = inClip.length ? inClip.map((s) => [Math.max(s.start, start) - start, Math.min(s.end, end) - start]) : [[0, end - start]];
  const total = spans.reduce((t, [a, b]) => t + (b - a), 0) || 1;
  const weight = (w) => w.replace(/[^\w]/g, '').length + 2;
  const wTotal = words.reduce((t, w) => t + weight(w), 0) || 1;
  const out = [];
  let used = 0;
  for (const w of words) {
    const a = (used / wTotal) * total;
    used += weight(w);
    const b = (used / wTotal) * total;
    const toTime = (x) => { // position in "talking time" -> time in the clip
      for (const [s, e] of spans) { if (x < e - s) return s + x; x -= e - s; }
      return spans[spans.length - 1][1];
    };
    out.push({ text: w, start: toTime(a), end: toTime(b) });
  }
  return out;
}

// Short groups of words (2-4) that pop up in time with the voice.
function groupWords(words) {
  const groups = [];
  let cur = [];
  for (const w of words) {
    const len = cur.map((x) => x.text).join(' ').length;
    const gap = cur.length ? w.start - cur[cur.length - 1].end : 0;
    if (cur.length && (cur.length >= 3 || len + w.text.length > 16 || gap > 0.6 || /[.!?,]$/.test(cur[cur.length - 1].text))) {
      groups.push(cur); cur = [];
    }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);
  return groups;
}

const assTime = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
const assText = (s) => String(s).replace(/[{}]/g, '').replace(/\\/g, '');

function buildAss(words, style, clipLen) {
  const bold = style === 'bold';
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Archivo Black,${bold ? 92 : 74},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,${bold ? 7 : 5},${bold ? 3 : 2},2,70,70,${bold ? 560 : 300},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = [];
  const groups = groupWords(words);
  groups.forEach((g, gi) => {
    const groupEnd = Math.min(clipLen, gi + 1 < groups.length ? Math.min(groups[gi + 1][0].start, g[g.length - 1].end + 0.7) : g[g.length - 1].end + 0.7);
    g.forEach((w, wi) => {
      const a = wi === 0 ? g[0].start : w.start;
      const b = wi + 1 < g.length ? g[wi + 1].start : groupEnd;
      if (b - a < 0.02) return;
      // Bold: every word in capitals, the word being said in yellow and a little bigger.
      const text = g.map((x, xi) => {
        const t = assText(bold ? x.text.toUpperCase() : x.text);
        return bold && xi === wi ? `{\\c&H00E6FF&\\fscx108\\fscy108}${t}{\\c&HFFFFFF&\\fscx100\\fscy100}` : t;
      }).join(' ');
      lines.push(`Dialogue: 0,${assTime(a)},${assTime(b)},Cap,,0,0,0,,${text}`);
    });
  });
  return head + lines.join('\n') + '\n';
}

// ---------- Making a clip ----------
// fps=30 comes first, so a 60 fps phone video only has half the frames to crop and resize.
function videoFilter({ width, height }, framing) {
  const W = 1080, H = 1920;
  if (framing === 'fit') {
    return `[0:v]fps=30,split=2[a][b];[a]scale=${W}:${H}:force_original_aspect_ratio=increase:flags=bilinear,crop=${W}:${H},boxblur=28:3,eq=brightness=-0.08[bg];` +
      `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]`;
  }
  const pos = { left: 0.15, center: 0.5, right: 0.85 }[framing] ?? 0.5;
  const cropW = `min(iw\\,ih*9/16)`;
  const cropH = `min(ih\\,iw*16/9)`;
  return `[0:v]fps=30,crop=${cropW}:${cropH}:(iw-${cropW})*${pos}:(ih-${cropH})/2,scale=${W}:${H},setsar=1,format=yuv420p[v]`;
}

// The full clip and its small preview are made in one go: the video is read once and the
// picture is split in two at the end.
const withPreview = (filter) => `${filter.replace(/\[v\]$/, '[vv]')};[vv]split=2[v][pv0];[pv0]scale=540:960:flags=bilinear[pv]`;

const RENDER_THREADS = Math.max(1, Math.floor((os.cpus()?.length || 2) / 2));
const escFilterPath = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

// Macs have a built-in video chip (VideoToolbox) that makes MP4s several times faster than the
// processor alone. If this Mac's ffmpeg can use it, it does; if it ever fails, the normal way is used.
let hwEncoder = null;
function hasHardwareEncoder() {
  if (hwEncoder !== null) return Promise.resolve(hwEncoder);
  if (process.env.CLIPS_HW === '1') return Promise.resolve((hwEncoder = true)); // tests: pretend it's there
  if (process.platform !== 'darwin' || process.env.CLIPS_HW === '0') return Promise.resolve((hwEncoder = false));
  return new Promise((resolve) => {
    execFile(ffmpegPath(), ['-hide_banner', '-encoders'], { maxBuffer: 4 << 20 }, (err, stdout) => resolve((hwEncoder = !err && /h264_videotoolbox/.test(String(stdout)))));
  });
}

// Size caps keep files small enough to play and save quickly, even over a phone connection,
// while staying sharp for Reels, Shorts and TikTok (all re-compress uploads anyway).
const fullVideo = (hw) => (hw
  ? ['-c:v', 'h264_videotoolbox', '-b:v', '5M', '-maxrate', '6M', '-bufsize', '10M', '-profile:v', 'high', '-allow_sw', '1']
  : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-maxrate', '6M', '-bufsize', '10M', '-profile:v', 'high', '-level', '4.1']);
const smallVideo = (hw) => (hw
  ? ['-c:v', 'h264_videotoolbox', '-b:v', '900k', '-maxrate', '1200k', '-bufsize', '2M', '-profile:v', 'main', '-allow_sw', '1']
  : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-maxrate', '1200k', '-bufsize', '2M', '-profile:v', 'main']);

function renderArgs({ source, start, len, filter, file, preview, hw }) {
  return ['-hide_banner', '-y', '-ss', String(start), '-t', String(len.toFixed(2)), '-i', source,
    '-filter_complex', withPreview(filter),
    '-map', '[v]', '-map', '0:a?', ...fullVideo(hw), '-pix_fmt', 'yuv420p', '-g', '60',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', file,
    '-map', '[pv]', '-map', '0:a?', ...smallVideo(hw), '-pix_fmt', 'yuv420p', '-g', '60',
    '-c:a', 'aac', '-b:a', '64k', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', preview,
    // Use only half of the Mac's processor so everything else stays smooth while clips are made.
    '-threads', String(RENDER_THREADS), '-filter_complex_threads', String(RENDER_THREADS)];
}

async function renderClip(job, clip, transcript) {
  const dir = path.join(clipsDir, String(job.id));
  const tag = crypto.randomBytes(3).toString('hex');
  const file = `clip-${clip.n}-${tag}.mp4`;
  const preview = `clip-${clip.n}-${tag}-small.mp4`;
  const poster = `clip-${clip.n}-${tag}.jpg`;
  const len = clip.end - clip.start;
  const plain = videoFilter(job, clip.framing);
  let filter = plain;
  let assFile = null;
  if (clip.captions !== 'none' && transcript.segments.length) {
    const words = captionWords(transcript.segments, clip.start, clip.end, clip.text_edited ? clip.text : null);
    if (words.length) {
      assFile = `clip-${clip.n}-${tag}.ass`;
      fs.writeFileSync(path.join(dir, assFile), buildAss(words, clip.captions, len));
      filter = filter.replace(/\[v\]$/, `[pre];[pre]ass=filename='${assFile}':fontsdir='${escFilterPath(fontsDir)}'[v]`);
    }
  }
  const hw = await hasHardwareEncoder();
  const make = (f, useHw) => run(ffmpegPath(), renderArgs({ source: job.source_file, start: clip.start, len, filter: f, file, preview, hw: useHw }), { cwd: dir });
  // Try the fast way first; if anything goes wrong, the slower ways that always work.
  const tries = [[filter, hw], ...(hw ? [[filter, false]] : []), ...(assFile ? [[plain, false]] : [])];
  try {
    for (let i = 0; i < tries.length; i++) {
      try {
        await make(...tries[i]);
        if (tries[i][0] === plain && assFile) clip.captionNote = 'Captions could not be added on this computer.';
        if (hw && !tries[i][1]) hwEncoder = false; // the video chip didn't work here: don't try it again
        break;
      } catch (err) {
        if (i === tries.length - 1) throw err;
      }
    }
  } finally {
    if (assFile) fs.rmSync(path.join(dir, assFile), { force: true });
  }
  await run(ffmpegPath(), ['-hide_banner', '-y', '-ss', String(Math.min(1, len / 3)), '-i', file, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', poster], { cwd: dir }).catch(() => {});
  return {
    file,
    preview: fs.existsSync(path.join(dir, preview)) ? preview : null,
    poster: fs.existsSync(path.join(dir, poster)) ? poster : null,
  };
}

// Clips made before previews existed get a small copy made from the finished clip.
async function makeMissingPreviews() {
  const rows = db.prepare(`SELECT * FROM clips WHERE status='ready' AND file IS NOT NULL AND preview IS NULL ORDER BY id DESC LIMIT 50`).all();
  for (const c of rows) {
    const dir = path.join(clipsDir, String(c.job_id));
    if (!fs.existsSync(path.join(dir, c.file))) continue;
    const preview = c.file.replace(/\.mp4$/, '-small.mp4');
    try {
      await run(ffmpegPath(), ['-hide_banner', '-y', '-i', c.file, '-vf', 'scale=540:960:flags=bilinear', ...smallVideo(false), '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-threads', String(RENDER_THREADS), preview], { cwd: dir });
      db.prepare('UPDATE clips SET preview=? WHERE id=? AND file=?').run(preview, c.id, c.file);
    } catch (err) {
      console.error(`[clips] preview for clip ${c.id}: ${err.message}`);
      db.prepare(`UPDATE clips SET preview='' WHERE id=?`).run(c.id); // don't keep trying
    }
  }
}

// ---------- The work queue ----------
const getJob = (id) => db.prepare('SELECT * FROM clip_jobs WHERE id=?').get(id);
const setJob = (id, fields) => {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE clip_jobs SET ${keys.map((k) => `${k}=@${k}`).join(', ')} WHERE id=@id`).run({ ...fields, id });
};
let busy = false;

async function processJob(job) {
  const settings = JSON.parse(job.settings || '{}');
  const step = (text, progress) => setJob(job.id, progress == null ? { step: text } : { step: text, progress });
  let transcript = job.transcript ? JSON.parse(job.transcript) : null;
  if (!transcript && settings.link && !fs.existsSync(job.source_file)) {
    // A video from a link: get it first (official ways only, see linkimport.js).
    step('Getting the video from your account…', 1);
    const found = await linkimport.findVideo(settings.link);
    if (found.kind === 'none') throw new Error(found.why);
    await linkimport.saveVideo(found, job.source_file, (f) => step(`Getting the video from ${found.from || 'your account'}… ${Math.round(f * 100)}%`, 1));
  }
  if (!transcript) {
    step('Checking the video…', 2);
    const info = await probe(job.source_file);
    if (!info) throw new Error("This file doesn't look like a video ffmpeg can read.");
    Object.assign(job, info);
    setJob(job.id, { duration: info.duration, width: info.width, height: info.height });
    let note = null;
    if (info.hasAudio) {
      try { await ensureModels((t) => step(t)); } catch (err) { note = `Couldn't download the speech model (${err.message}). Clips were picked without listening.`; }
    }
    step('Listening to the video and writing down every word…', 5);
    transcript = info.hasAudio
      ? await transcribe(job.source_file, (at) => step(`Listening… ${fmtDur(at)} of ${fmtDur(info.duration)}`, 5 + Math.round((at / info.duration) * 55)))
      : { segments: [], loudness: [] };
    if (!info.hasAudio) note = 'This video has no sound, so clips were picked without captions.';
    else if (transcript.speechReason) note = `${transcript.speechReason} Clips were picked by energy, without captions.`;
    else if (!transcript.segments.length) note = note || 'No talking was found, so clips were picked by energy, without captions.';
    setJob(job.id, { transcript: JSON.stringify(transcript), note });
  }

  if (!db.prepare('SELECT 1 FROM clips WHERE job_id=?').get(job.id)) {
    step('Finding the best moments…', 62);
    const picks = pickClips({ ...transcript, duration: job.duration, length: settings.length, count: settings.count });
    const ins = db.prepare(`INSERT INTO clips (job_id, n, start, end, score, reason, title, text, framing, captions)
      VALUES (@job_id, @n, @start, @end, @score, @reason, @title, @text, @framing, @captions)`);
    db.transaction(() => picks.forEach((p, i) => ins.run({ ...p, job_id: job.id, n: i + 1, framing: settings.framing || 'center', captions: settings.captions || 'bold' })))();
  }
  setJob(job.id, { status: 'ready', step: null, progress: 100 });
}

async function renderPending(jobId) {
  const job = getJob(jobId);
  const transcript = JSON.parse(job.transcript || '{"segments":[]}');
  const list = () => db.prepare(`SELECT * FROM clips WHERE job_id=? AND status IN ('pending','rendering') ORDER BY n`).all(jobId);
  let clip;
  const total = db.prepare('SELECT COUNT(*) AS n FROM clips WHERE job_id=?').get(jobId).n;
  while ((clip = list()[0])) {
    const done = total - list().length;
    setJob(jobId, { step: `Making clip ${done + 1} of ${total}…` });
    db.prepare(`UPDATE clips SET status='rendering', error=NULL WHERE id=?`).run(clip.id);
    try {
      const old = [clip.file, clip.poster, clip.preview].filter(Boolean);
      const out = await renderClip(job, clip, transcript);
      const still = db.prepare('SELECT id FROM clips WHERE id=?').get(clip.id);
      if (!still) continue;
      db.prepare(`UPDATE clips SET status='ready', file=?, poster=?, preview=?, error=? WHERE id=? AND status='rendering'`).run(out.file, out.poster, out.preview, clip.captionNote || null, clip.id);
      if (db.prepare('SELECT status FROM clips WHERE id=?').get(clip.id).status === 'ready') {
        old.forEach((f) => fs.rmSync(path.join(clipsDir, String(jobId), f), { force: true }));
      }
    } catch (err) {
      db.prepare(`UPDATE clips SET status='failed', error=? WHERE id=?`).run(String(err.message).slice(0, 500), clip.id);
    }
  }
  setJob(jobId, { step: null });
}

async function work() {
  if (busy) return;
  busy = true;
  try {
    for (;;) {
      const job = db.prepare(`SELECT * FROM clip_jobs WHERE status IN ('queued','working') ORDER BY id LIMIT 1`).get()
        || db.prepare(`SELECT j.* FROM clip_jobs j WHERE j.status='ready' AND EXISTS (SELECT 1 FROM clips c WHERE c.job_id=j.id AND c.status IN ('pending','rendering')) ORDER BY j.id LIMIT 1`).get();
      if (!job) { await makeMissingPreviews().catch((e) => console.error('[clips] previews', e.message)); break; }
      try {
        if (job.status !== 'ready') {
          setJob(job.id, { status: 'working', error: null });
          await processJob(job);
        }
        if (getJob(job.id)) await renderPending(job.id);
      } catch (err) {
        console.error('[clips]', err);
        if (getJob(job.id)) setJob(job.id, { status: 'failed', error: String(err.message).slice(0, 500), step: null });
      }
    }
  } finally { busy = false; }
}

function fmtDur(s) {
  s = Math.round(s || 0);
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- API (/api/clips) ----------
const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(clipsDir, `upload-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `source${(path.extname(file.originalname) || '.mp4').toLowerCase().replace(/[^.\w]/g, '')}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^video\//.test(file.mimetype) || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.originalname)),
});

const fileSize = (f) => { try { return fs.statSync(f).size; } catch { return null; } };
function clipOut(c) {
  const base = `/clipfile/${c.job_id}/`;
  return {
    id: c.id, job_id: c.job_id, n: c.n, start: c.start, end: c.end, length: +(c.end - c.start).toFixed(1),
    score: c.score, reason: c.reason, title: c.title, caption: firstSentence(c.text, 300) || c.title, text: c.text, text_edited: Boolean(c.text_edited),
    framing: c.framing, captions: c.captions, status: c.status, error: c.error,
    url: c.file ? base + c.file : null, poster_url: c.poster ? base + c.poster : null,
    preview_url: c.preview ? base + c.preview : (c.file ? base + c.file : null),
    size: c.file ? fileSize(path.join(clipsDir, String(c.job_id), c.file)) : null,
  };
}

function jobOut(j) {
  return {
    id: j.id, name: j.name, duration: j.duration, width: j.width, height: j.height,
    settings: JSON.parse(j.settings || '{}'), status: j.status, step: j.step, progress: j.progress, error: j.error, note: j.note, created_at: j.created_at,
    clips: db.prepare('SELECT * FROM clips WHERE job_id=? ORDER BY score DESC, n').all(j.id).map(clipOut),
  };
}

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM clip_jobs ORDER BY id DESC').all().map(jobOut));
});

router.post('/', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Pick a video file first (MP4, MOV, M4V, WebM or MKV).' });
  const settings = readSettings(req.body);
  const name = String(req.body.name || path.parse(req.file.originalname).name || 'Video').trim().slice(0, 120);
  const { lastInsertRowid: id } = db.prepare('INSERT INTO clip_jobs (name, source_file, settings) VALUES (?,?,?)').run(name, '', JSON.stringify(settings));
  const dir = path.join(clipsDir, String(id));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(req.file.destination, dir);
  db.prepare('UPDATE clip_jobs SET source_file=? WHERE id=?').run(path.join(dir, req.file.filename), id);
  work();
  res.status(201).json(jobOut(getJob(id)));
});

const readSettings = (b = {}) => ({
  length: LENGTHS[b.length] ? b.length : 'medium',
  framing: FRAMINGS.includes(b.framing) ? b.framing : 'center',
  captions: CAPTIONS.includes(b.captions) ? b.captions : 'bold',
  count: Math.max(1, Math.min(20, Number(b.count) || 8)),
});

// A video from a link to your own post (see linkimport.js for which links work and why).
router.post('/link', async (req, res) => {
  const link = String(req.body?.url || '').trim().slice(0, 2000);
  if (!link) return res.status(400).json({ error: 'Paste a link first.' });
  let found;
  try { found = await linkimport.findVideo(link); } catch (err) { return res.status(502).json({ error: `Couldn't check that link right now (${err.message}). Try again in a minute.` }); }
  if (found.kind === 'none') return res.status(422).json({ error: found.why, platform: found.platform });
  const settings = { ...readSettings(req.body), link };
  const name = String(req.body?.name || found.name || `${{ youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' }[found.platform] || 'Linked'} video`).trim().slice(0, 120);
  const { lastInsertRowid: id } = db.prepare('INSERT INTO clip_jobs (name, source_file, settings) VALUES (?,?,?)').run(name, '', JSON.stringify(settings));
  const dir = path.join(clipsDir, String(id));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const source = path.join(dir, `source${path.extname(found.file || '').toLowerCase() || '.mp4'}`);
  db.prepare('UPDATE clip_jobs SET source_file=? WHERE id=?').run(source, id);
  if (found.kind === 'local') {
    try { await linkimport.saveVideo(found, source); } catch { /* the worker tries again */ }
  }
  work();
  res.status(201).json({ ...jobOut(getJob(id)), how: found.kind === 'local' ? 'local' : 'api', from: found.from || null });
});

router.get('/clip/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM clips WHERE id=?').get(req.params.id);
  c ? res.json(clipOut(c)) : res.status(404).json({ error: 'Clip not found.' });
});

router.get('/:id', (req, res) => {
  const j = getJob(req.params.id);
  j ? res.json({ ...jobOut(j), transcript: JSON.parse(j.transcript || '{"segments":[]}').segments }) : res.status(404).json({ error: 'Not found' });
});

router.delete('/:id', (req, res) => {
  const j = getJob(req.params.id);
  if (!j) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM clips WHERE job_id=?').run(j.id);
  db.prepare('DELETE FROM clip_jobs WHERE id=?').run(j.id);
  fs.rmSync(path.join(clipsDir, String(j.id)), { recursive: true, force: true });
  res.json({ ok: true });
});

// Change a clip (start/end, framing, captions, words) and make it again.
router.patch('/clip/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM clips WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Clip not found.' });
  const job = getJob(c.job_id);
  const transcript = JSON.parse(job.transcript || '{"segments":[]}');
  const b = req.body || {};
  const start = b.start != null ? Number(b.start) : c.start;
  const end = b.end != null ? Number(b.end) : c.end;
  if (!(start >= 0) || !(end > start) || (job.duration && end > job.duration + 0.5)) return res.status(400).json({ error: 'Check the start and end times.' });
  if (end - start < 3) return res.status(400).json({ error: 'A clip needs to be at least 3 seconds long.' });
  if (end - start > 180) return res.status(400).json({ error: 'Keep clips to 3 minutes or less (YouTube Shorts limit).' });
  const timesChanged = start !== c.start || end !== c.end;
  let text = c.text, edited = c.text_edited;
  if (typeof b.text === 'string' && b.text.trim() !== (c.text || '').trim()) { text = b.text.trim(); edited = 1; }
  else if (timesChanged && !c.text_edited) text = clipText(transcript.segments, start, end);
  db.prepare(`UPDATE clips SET start=?, end=?, text=?, text_edited=?, framing=?, captions=?, title=?, status='pending', error=NULL WHERE id=?`).run(
    start, end, text, edited,
    FRAMINGS.includes(b.framing) ? b.framing : c.framing,
    CAPTIONS.includes(b.captions) ? b.captions : c.captions,
    typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, 100) : c.title,
    c.id,
  );
  work();
  res.json(clipOut(db.prepare('SELECT * FROM clips WHERE id=?').get(c.id)));
});

router.delete('/clip/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM clips WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Clip not found.' });
  db.prepare('DELETE FROM clips WHERE id=?').run(c.id);
  [c.file, c.poster, c.preview].filter(Boolean).forEach((f) => fs.rmSync(path.join(clipsDir, String(c.job_id), f), { force: true }));
  res.json({ ok: true });
});

router.post('/:id/retry', (req, res) => {
  const j = getJob(req.params.id);
  if (!j) return res.status(404).json({ error: 'Not found' });
  if (j.status === 'failed') setJob(j.id, { status: 'queued', error: null, progress: 0 });
  db.prepare(`UPDATE clips SET status='pending' WHERE job_id=? AND status='failed'`).run(j.id);
  work();
  res.json(jobOut(getJob(j.id)));
});

// Finished clip files and their preview pictures (signed-in users only).
function serveFile(req, res) {
  const { job, file } = req.params;
  if (!/^\d+$/.test(job) || !/^clip-\d+-[0-9a-f]+(-small)?\.(mp4|jpg)$/.test(file)) return res.status(404).end();
  const full = path.join(clipsDir, job, file);
  if (!fs.existsSync(full)) return res.status(404).end();
  if (req.query.download) res.attachment(file);
  // Every new version of a clip gets a new file name, so the browser may keep each file.
  res.sendFile(full, { maxAge: '30d', immutable: true });
}

// For the composer: copies a finished clip into the post media folder (so deleting the post
// never deletes the clip) and returns the new file name.
function copyClipToMedia(clipId) {
  const c = db.prepare('SELECT * FROM clips WHERE id=?').get(clipId);
  if (!c || c.status !== 'ready' || !c.file) return null;
  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.mp4`;
  fs.copyFileSync(path.join(clipsDir, String(c.job_id), c.file), path.join(config.mediaDir, name));
  return name;
}

// Pick up where it left off after the Mac restarts.
function start() {
  db.prepare(`UPDATE clips SET status='pending' WHERE status='rendering'`).run();
  fs.readdirSync(clipsDir).filter((d) => d.startsWith('upload-')).forEach((d) => fs.rmSync(path.join(clipsDir, d), { recursive: true, force: true }));
  work();
}

module.exports = { router, serveFile, copyClipToMedia, start, work, pickClips, captionWords, groupWords, buildAss, firstSentence, probe, ffmpegPath, ensureModels, transcribe };
