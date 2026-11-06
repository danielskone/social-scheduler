// Runs on its own (started by clipper.js) so a long transcription never slows down the app
// or the post scheduler, and so a problem in the speech engine can't crash Viral Post.
//
//   node src/speech-worker.js <ffmpeg> <video> <modelDir> <out.json>
//
// Reads the video's sound with ffmpeg, finds the parts where someone is talking, turns each
// part into text with Whisper (runs on this computer, free), and measures how loud each half
// second is. Prints {"at": seconds} lines while it works and writes the result to out.json.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const [ffmpeg, video, modelDir, outFile] = process.argv.slice(2);
const RATE = 16000;
const WINDOW = 512; // what the voice detector expects
const LOUD_STEP = RATE / 2; // loudness is measured every half second

function loadEngine() {
  const m = (f) => path.join(modelDir, 'whisper', f);
  if (!fs.existsSync(m('base.en-encoder.int8.onnx'))) return { reason: 'The speech model is missing.' };
  try {
    const sherpa = require('sherpa-onnx-node');
    const recognizer = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: RATE, featureDim: 80 },
      modelConfig: {
        whisper: { encoder: m('base.en-encoder.int8.onnx'), decoder: m('base.en-decoder.int8.onnx') },
        tokens: m('base.en-tokens.txt'),
        numThreads: 2,
        provider: 'cpu',
        debug: 0,
      },
    });
    const vad = new sherpa.Vad({
      sileroVad: {
        model: path.join(modelDir, 'silero_vad.onnx'),
        threshold: 0.5,
        minSilenceDuration: 0.35,
        minSpeechDuration: 0.25,
        maxSpeechDuration: 15,
        windowSize: WINDOW,
      },
      sampleRate: RATE,
      numThreads: 1,
      debug: 0,
    }, 60);
    return { recognizer, vad };
  } catch (err) {
    return { reason: `The speech engine couldn't start on this computer (${err.message}).` };
  }
}

// Whisper gives the words but not the exact moment of each one, so each word gets a share of
// its sentence's time based on its length. Close enough for captions that follow the voice.
function wordsFromTokens(tokens, text, start, end) {
  const words = [];
  for (const t of tokens || []) {
    if (!words.length || /^\s/.test(t)) words.push(t.trim());
    else words[words.length - 1] += t;
  }
  const list = (words.length ? words : String(text).split(/\s+/)).filter(Boolean);
  const weight = (w) => w.replace(/[^\w]/g, '').length + 2;
  const total = list.reduce((s, w) => s + weight(w), 0) || 1;
  let t = start;
  return list.map((w) => {
    const d = ((end - start) * weight(w)) / total;
    const word = { text: w, start: +t.toFixed(2), end: +(t + d).toFixed(2) };
    t += d;
    return word;
  });
}

const engine = loadEngine();
const segments = [];
const loudness = [];
let sumSq = 0;
let inStep = 0;
let pending = new Float32Array(0);
let heard = 0;

function decode(seg) {
  const start = seg.start / RATE;
  const end = start + seg.samples.length / RATE;
  const stream = engine.recognizer.createStream();
  stream.acceptWaveform({ sampleRate: RATE, samples: seg.samples });
  engine.recognizer.decode(stream);
  const r = engine.recognizer.getResult(stream);
  const text = String(r.text || '').trim();
  // Whisper sometimes "hears" these in music or noise; they aren't real speech.
  if (!text || /^[\s.[\]()♪*-]*$/.test(text) || /^\[.*\]$|^\(.*\)$/.test(text)) return;
  segments.push({ start: +start.toFixed(2), end: +end.toFixed(2), text, words: wordsFromTokens(r.tokens, text, start, end) });
}

function drain() {
  while (engine.vad && !engine.vad.isEmpty()) {
    decode(engine.vad.front(false));
    engine.vad.pop();
  }
}

function accept(chunk) {
  for (let i = 0; i < chunk.length; i++) {
    sumSq += chunk[i] * chunk[i];
    if (++inStep === LOUD_STEP) { loudness.push(+Math.sqrt(sumSq / LOUD_STEP).toFixed(4)); sumSq = 0; inStep = 0; }
  }
  if (!engine.vad) return;
  const all = new Float32Array(pending.length + chunk.length);
  all.set(pending); all.set(chunk, pending.length);
  let i = 0;
  for (; i + WINDOW <= all.length; i += WINDOW) engine.vad.acceptWaveform(all.subarray(i, i + WINDOW));
  pending = all.slice(i);
  drain();
}

const ff = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', video, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 'f32le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
let errText = '';
ff.stderr.on('data', (d) => { errText = (errText + d).slice(-2000); });
let leftover = Buffer.alloc(0);
let lastReport = 0;
ff.stdout.on('data', (buf) => {
  const b = leftover.length ? Buffer.concat([leftover, buf]) : buf;
  const usable = b.length - (b.length % 4);
  leftover = b.subarray(usable);
  const floats = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + usable));
  heard += floats.length;
  accept(floats);
  const at = Math.floor(heard / RATE);
  if (at - lastReport >= 5) { lastReport = at; process.stdout.write(`${JSON.stringify({ at })}\n`); }
});
ff.on('close', (code) => {
  if (code !== 0 && !heard) {
    fs.writeFileSync(outFile, JSON.stringify({ segments: [], loudness: [], noAudio: true, error: errText.trim() }));
    return;
  }
  if (inStep) loudness.push(+Math.sqrt(sumSq / inStep).toFixed(4));
  if (engine.vad) { engine.vad.flush(); drain(); }
  segments.sort((a, b) => a.start - b.start);
  fs.writeFileSync(outFile, JSON.stringify({ segments, loudness, speechReason: engine.reason || null }));
});
