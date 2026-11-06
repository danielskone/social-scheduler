// Viral Ads Studio: turns a short description (or a script you paste) into a finished video ad
// for Reels, TikTok, YouTube Shorts, the Facebook feed and YouTube. It all runs on this computer
// for free:
//   - the script is written from ready-made ad recipes (hook, selling points, offer, call to action)
//   - the voiceover uses the Mac's own built-in voices (the "say" command)
//   - ffmpeg (installed with the app) puts your photos, videos, logo, captions and voice together
//   - one ad can be made in several shapes at once: 9:16, 4:5, 1:1 and 16:9
// Ads are made one at a time at low priority, so the Mac and the post scheduler stay quick.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const express = require('express');
const multer = require('multer');
const config = require('./config');
const db = require('./db');
const { ffmpegPath, groupWords } = require('./clipper');

const adsDir = path.join(config.dataDir, 'ads');
const libDir = path.join(adsDir, 'library');
const fontsDir = path.join(__dirname, '..', 'assets', 'fonts');
fs.mkdirSync(libDir, { recursive: true });

db.exec(`
CREATE TABLE IF NOT EXISTS ad_brands (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  website TEXT, cta TEXT, color TEXT NOT NULL DEFAULT '#FFD60A',
  logo TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ad_products (
  id INTEGER PRIMARY KEY,
  brand_id INTEGER REFERENCES ad_brands(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  about TEXT, points TEXT, offer TEXT, link TEXT,
  photos TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ad_media (
  id INTEGER PRIMARY KEY,
  file TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,              -- image, video, audio
  name TEXT, width INTEGER, height INTEGER, duration REAL, has_audio INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ads (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  recipe TEXT NOT NULL DEFAULT 'hook',
  look TEXT NOT NULL DEFAULT 'bold',
  voice TEXT, pace TEXT NOT NULL DEFAULT 'normal',
  length INTEGER NOT NULL DEFAULT 30,
  formats TEXT NOT NULL DEFAULT '["9x16"]',
  brand_id INTEGER REFERENCES ad_brands(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES ad_products(id) ON DELETE SET NULL,
  media TEXT NOT NULL DEFAULT '[]',
  music TEXT,
  scenes TEXT NOT NULL DEFAULT '[]',
  caption TEXT,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft, queued, working, ready, failed
  step TEXT, progress INTEGER NOT NULL DEFAULT 0, error TEXT, note TEXT,
  outputs TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------- Choices ----------
const FORMATS = {
  '9x16': { w: 1080, h: 1920, label: 'Vertical 9:16', for: 'Reels, TikTok, Shorts, Stories' },
  '4x5': { w: 1080, h: 1350, label: 'Portrait 4:5', for: 'Facebook and Instagram feed' },
  '1x1': { w: 1080, h: 1080, label: 'Square 1:1', for: 'Facebook and Instagram feed' },
  '16x9': { w: 1920, h: 1080, label: 'Wide 16:9', for: 'YouTube and Facebook video' },
};
const LOOKS = ['bold', 'clean', 'cinematic'];
const RECIPES = {
  hook: 'Stop the scroll',
  reasons: '3 reasons why',
  question: 'Question hook',
  offer: 'Big offer',
  event: 'Event promo',
  script: 'Use my script as written',
};
const PACES = { calm: 170, normal: 188, fast: 205 };
const LENGTHS = [15, 30, 60];
const CTAS = ['Learn more', 'Shop now', 'Sign up', 'Book a call', 'Get a quote', 'Register', 'Donate', 'Visit our website', 'Call us today'];

// ---------- Small helpers ----------
function run(cmd, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    try { os.setPriority(child.pid, 10); } catch {}
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    child.stdout.on('data', () => {});
    child.on('error', (e) => reject(e.code === 'ENOENT' && cmd === ffmpegPath()
      ? new Error('The video tool (ffmpeg) is missing. In Terminal run: cd ~/social-scheduler && npm run update && npm run background:on') : e));
    child.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(err.trim().split('\n').slice(-3).join(' ') || `${cmd} stopped (${code})`))));
  });
}

async function probeAny(file) {
  const out = await new Promise((resolve) => {
    execFile(ffmpegPath(), ['-hide_banner', '-i', file], { maxBuffer: 1 << 20 }, (err, stdout, stderr) => resolve(String(stderr)));
  });
  const d = out.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const v = out.match(/Stream #.*Video:.*?(\d{2,5})x(\d{2,5})/);
  const rot = out.match(/rotation of (-?\d+)|rotate\s*:\s*(-?\d+)/);
  let width = v ? Number(v[1]) : null, height = v ? Number(v[2]) : null;
  if (v && rot && Math.abs(Number(rot[1] || rot[2])) % 180 === 90) [width, height] = [height, width];
  return {
    duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null,
    width, height,
    hasVideo: Boolean(v), hasAudio: /Stream #.*Audio:/.test(out),
  };
}

const clean = (s, max = 400) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const lines = (s) => String(s || '').split(/\n|•|;/).map((x) => x.replace(/^[\s\-*–✅✔️0-9.)]+/, '').trim()).filter(Boolean);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const endDot = (s) => (s && !/[.!?]$/.test(s) ? `${s}.` : s);
const noDot = (s) => String(s || '').replace(/[.!]+$/, '');
const words = (s) => String(s || '').split(/\s+/).filter(Boolean);
const short = (s, n = 5) => { const w = words(noDot(s)); return w.length > n ? `${w.slice(0, n).join(' ')}…` : w.join(' '); };
const site = (u) => String(u || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
function pick(list, seed, salt = 0) { return list[Math.abs(seed + salt * 7) % list.length]; }

// ---------- Writing the script ----------
// "Visit example.org" is read out as "example dot org".
const sayCta = (cta, web) => { const host = String(web || '').split('/')[0]; return `${cta}${host ? ` at ${host.replace(/\./g, ' dot ')}` : ''}.`; };

// The details: what is being promoted, a description, selling points, an offer or date, a call
// to action and a website. Each recipe turns them into scenes: what the voice says, and a few
// big words on screen. Every scene can be changed by hand afterwards.
function writeScript(d, { recipe = 'hook', length = 30, seed = 0 } = {}) {
  const name = clean(d.name, 80) || 'this';
  const about = clean(d.about, 600);
  const offer = clean(d.offer, 160);
  const cta = clean(d.cta, 40) || 'Learn more';
  const web = site(d.website);
  let points = lines(d.points).map((p) => clean(p, 160));
  if (!points.length && about) points = (about.match(/[^.!?]+[.!?]?/g) || []).map((s) => s.trim()).filter((s) => words(s).length >= 3).slice(1, 4);
  const maxPoints = length <= 15 ? 1 : length <= 30 ? 3 : 5;
  points = points.slice(0, maxPoints);
  const intro = about ? endDot(cap((about.match(/^[^.!?]+[.!?]?/) || [about])[0].trim())) : '';
  const scenes = [];
  const add = (say, headline, endCard = false) => scenes.push({ say: cap(clean(say, 400)), headline: cap(clean(headline, 60)), endCard });
  const end = () => add(sayCta(cta, web), cta, true);

  if (recipe === 'script') return splitScript(about || name, { cta, website: web });

  if (recipe === 'reasons') {
    const n = Math.max(2, Math.min(3, points.length || 3));
    add(pick([`${n} reasons to choose ${name}.`, `Here are ${n} reasons people love ${name}.`, `Why ${name}? Here are ${n} reasons.`], seed),
      `${n} reasons to choose ${name}`);
    const ps = points.length ? points.slice(0, n) : [intro || `It's made for you`, 'It is easy to get started', 'People keep coming back'];
    ps.forEach((p, i) => add(`${['One', 'Two', 'Three'][i] || i + 1}: ${endDot(p)}`, `${i + 1}. ${short(p, 5)}`));
    if (offer && length > 15) add(endDot(offer), short(offer, 6));
    end();
  } else if (recipe === 'question') {
    const q = points[0] ? `Want ${noDot(points[0]).replace(/^(you |we |it )/i, '').toLowerCase()}?` : `Looking for ${name}?`;
    add(pick([q, `What if ${name} could change everything?`, `Did you know about ${name}?`], seed), short(q, 6));
    if (intro) add(intro, name);
    points.slice(1).forEach((p) => add(endDot(p), short(p)));
    if (offer) add(endDot(offer), short(offer, 6));
    end();
  } else if (recipe === 'offer') {
    const big = offer || `Something special from ${name}`;
    add(pick([`Don't miss this. ${endDot(big)}`, `Big news. ${endDot(big)}`, `Heads up! ${endDot(big)}`], seed), short(big, 6));
    if (intro && length > 15) add(intro, name);
    points.forEach((p) => add(endDot(p), short(p)));
    add(pick(['But hurry, it will not last long.', "Don't wait, this won't last.", 'Act fast before it is gone.'], seed), 'Limited time');
    end();
  } else if (recipe === 'event') {
    add(pick([`Save the date! ${name} is coming.`, `Mark your calendar for ${name}!`, `You're invited to ${name}!`], seed), 'Save the date');
    if (offer) add(endDot(offer), short(offer, 6));
    if (intro) add(intro, name);
    points.forEach((p) => add(endDot(p), short(p)));
    add(pick(['Bring the whole family.', 'Bring your friends and family.', "You won't want to miss it."], seed), "Don't miss it");
    end();
  } else { // hook: stop the scroll
    add(pick([`Stop scrolling! You need to see ${name}.`, `This is your sign to check out ${name}.`, `You haven't seen ${name} like this before.`, `Wait! Have you heard about ${name}?`], seed),
      pick(['Stop scrolling', 'This is your sign', `Meet ${name}`, 'Wait for it'], seed));
    if (intro) add(intro, name);
    points.forEach((p) => add(endDot(p), short(p)));
    if (offer) add(endDot(offer), short(offer, 6));
    end();
  }
  // A 15 second ad keeps just the strongest parts: the opening, one point and the call to action.
  if (length <= 15 && scenes.length > 4) return [scenes[0], scenes[1], scenes[scenes.length - 1]];
  return scenes.slice(0, 10);
}

// A script you paste is used as written: split into scenes of a sentence or two, plus an end
// card with the call to action if the script doesn't already end with it.
function splitScript(text, { cta, website } = {}) {
  const paras = String(text || '').split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);
  const pieces = [];
  for (const p of paras) {
    const sentences = p.match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g) || [p];
    let cur = '';
    for (const s of sentences.map((x) => x.trim()).filter(Boolean)) {
      if (cur && words(cur).length + words(s).length > 22) { pieces.push(cur); cur = ''; }
      cur = cur ? `${cur} ${s}` : s;
    }
    if (cur) pieces.push(cur);
  }
  const scenes = pieces.slice(0, 12).map((say, i) => ({ say: clean(say, 400), headline: i === 0 ? short(say, 5) : '' }));
  const last = scenes[scenes.length - 1]?.say || '';
  if (cta && !last.toLowerCase().includes(cta.toLowerCase()) && !(website && last.toLowerCase().includes(String(website).toLowerCase().split('/')[0]))) {
    scenes.push({ say: sayCta(cta, site(website)), headline: cta, endCard: true });
  }
  return scenes;
}

// The words for the post itself (caption), written from the same details.
function writeCaption(d, scenes) {
  const name = clean(d.name, 80);
  const first = scenes[0]?.say || name;
  const points = lines(d.points).slice(0, 4);
  const tags = [...new Set(words(`${name} ${clean(d.tags, 120)}`).map((w) => w.replace(/[^\w]/g, '')).filter((w) => w.length > 2 && !/^(the|and|for|with|our|your|you)$/i.test(w)))]
    .slice(0, 5).map((w) => `#${w.toLowerCase()}`);
  const parts = [first];
  if (d.about && !String(first).includes(clean(d.about, 60))) parts.push(clean(d.about, 300));
  if (points.length) parts.push(points.map((p) => `✅ ${p}`).join('\n'));
  if (d.offer) parts.push(`🎉 ${clean(d.offer, 160)}`);
  parts.push(`👉 ${clean(d.cta, 40) || 'Learn more'}${d.website ? `: ${clean(d.website, 200)}` : ''}`);
  if (tags.length) parts.push(tags.join(' '));
  return parts.join('\n\n').slice(0, 2100);
}

// ---------- Voice ----------
// Uses the Mac's built-in voices. Better-sounding voices (marked "Enhanced" or "Premium") can be
// added for free in System Settings → Accessibility → Spoken Content → System voice → Manage Voices.
const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Junior|Ralph|Kathy|Fred|Grandma|Grandpa|Rocko|Sandy|Shelley|Eddy|Flo|Reed)\b/;
let voiceCache = null;
function ttsEngine() {
  if (process.env.ADS_TTS === 'off') return null;
  if (process.platform === 'darwin') return 'say';
  return ['/usr/bin/espeak-ng', '/usr/local/bin/espeak-ng', '/usr/bin/espeak'].find((p) => fs.existsSync(p)) || null;
}

async function listVoices() {
  if (voiceCache) return voiceCache;
  const engine = ttsEngine();
  if (engine !== 'say') {
    voiceCache = engine ? [{ id: 'en-us', name: 'Computer voice', lang: 'en_US' }] : [];
    return voiceCache;
  }
  const out = await new Promise((resolve) => execFile('say', ['-v', '?'], (err, stdout) => resolve(String(stdout || ''))));
  const list = out.split('\n').map((l) => l.match(/^(.+?)\s{2,}([a-z]{2,3}[_-][A-Za-z]{2,4})\s+#/)).filter(Boolean)
    .map((m) => ({ id: m[1].trim(), name: m[1].trim(), lang: m[2].replace('-', '_') }))
    .filter((v) => v.lang.startsWith('en_') && !NOVELTY.test(v.name));
  const rank = (v) => (/Premium/.test(v.name) ? 0 : /Enhanced/.test(v.name) ? 1 : 2) * 10 + (v.lang === 'en_US' ? 0 : 1);
  list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  voiceCache = list;
  setTimeout(() => { voiceCache = null; }, 10 * 60e3).unref?.(); // notice newly added voices
  return list;
}

// Says the words into a sound file. Returns null when this computer has no voice.
async function speak(text, { voice, pace = 'normal' } = {}, outBase) {
  const engine = ttsEngine();
  if (!engine || !clean(text)) return null;
  const txt = `${outBase}.txt`;
  fs.writeFileSync(txt, clean(text, 1000));
  const rate = PACES[pace] || PACES.normal;
  try {
    if (engine === 'say') {
      const out = `${outBase}.aiff`;
      const voices = await listVoices();
      const v = voices.find((x) => x.id === voice) || voices[0];
      await run('say', [...(v ? ['-v', v.id] : []), '-r', String(rate), '-o', out, '-f', txt]);
      return out;
    }
    const out = `${outBase}.wav`;
    await run(engine, ['-v', 'en-us', '-s', String(Math.round(rate * 0.9)), '-w', out, '-f', txt]);
    return out;
  } finally { fs.rmSync(txt, { force: true }); }
}

// ---------- On-screen words ----------
const assTime = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
const assText = (s) => String(s).replace(/[{}\\]/g, '');
function assColor(hex, alpha = 0) {
  const m = String(hex || '').match(/^#?([0-9a-f]{6})$/i);
  const h = m ? m[1] : 'FFD60A';
  return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}
function isLight(hex) {
  const m = String(hex || '').match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return true;
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

// Spreads the scene's words over the time the voice is talking (a little longer for commas
// and full stops, where the voice pauses).
function timeWords(text, start, end) {
  const ws = words(text);
  const weight = (w) => w.replace(/[^\w]/g, '').length + 2 + (/[,;:]$/.test(w) ? 3 : /[.!?]$/.test(w) ? 5 : 0);
  const total = ws.reduce((t, w) => t + weight(w), 0) || 1;
  let used = 0;
  return ws.map((w) => {
    const a = start + (used / total) * (end - start);
    used += weight(w);
    return { text: w, start: a, end: start + (used / total) * (end - start) };
  });
}

function wrap(text, maxChars) {
  const out = [];
  let cur = '';
  for (const w of words(text)) {
    if (cur && (cur + ' ' + w).length > maxChars) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out.slice(0, 3);
}

// One scene's on-screen words as an .ass subtitle file: a big headline (in the brand colour) and
// captions that follow the voice.
function buildSceneAss({ W, H, look = 'bold', color = '#FFD60A', headline = '', say = '', voiceStart = 0, voiceEnd = 0, len, endCard = false, website = '', captions = true }) {
  const u = Math.min(W, H) / 1080;
  const vertical = H / W > 1.3;
  const wide = W / H > 1.3;
  const bold = look === 'bold';
  const cine = look === 'cinematic';
  const capSize = Math.round((cine ? 58 : bold ? (vertical ? 86 : 70) : (vertical ? 70 : 60)) * u);
  const capMargin = Math.round(H * (vertical ? 0.22 : wide ? 0.09 : 0.12));
  const headSize = Math.round((endCard ? 104 : cine ? 76 : 90) * u * (wide ? 0.9 : 1));
  const boxText = isLight(color) ? '&H00111111' : '&H00FFFFFF';
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Archivo Black,${capSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H78000000,0,0,0,0,100,100,0,0,1,${Math.round((bold ? 7 : cine ? 2 : 5) * u)},${Math.round((cine ? 1 : 3) * u)},2,${Math.round(W * 0.07)},${Math.round(W * 0.07)},${capMargin},1
Style: Box,Archivo Black,${headSize},${bold || endCard ? boxText : '&H00FFFFFF'},&H00FFFFFF,${bold || endCard ? assColor(color) : '&H00000000'},&H64000000,0,0,0,0,100,100,0,0,${bold || endCard ? 3 : 1},${Math.round((bold || endCard ? 20 : 5) * u)},${bold || endCard ? 0 : Math.round(3 * u)},5,${Math.round(W * 0.06)},${Math.round(W * 0.06)},0,1
Style: Sub,Archivo Black,${Math.round(54 * u)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,${Math.round(4 * u)},${Math.round(2 * u)},5,${Math.round(W * 0.06)},${Math.round(W * 0.06)},0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const ev = [];
  const maxChars = vertical ? 13 : wide ? 26 : 16;
  if (headline) {
    const text = wrap(bold || endCard ? headline.toUpperCase() : headline, maxChars).map(assText).join('\\N');
    const y = endCard ? H * 0.5 : cine ? H * 0.5 : H * (vertical ? 0.17 : 0.15);
    const until = endCard || !say || cine ? len : Math.min(len, Math.max(2.2, voiceStart + (voiceEnd - voiceStart) * 0.6));
    const pop = cine ? '\\fad(350,250)' : '\\fad(120,150)\\fscx70\\fscy70\\t(0,180,\\fscx106\\fscy106)\\t(180,260,\\fscx100\\fscy100)';
    ev.push(`Dialogue: 1,${assTime(0.05)},${assTime(until)},Box,,0,0,0,,{\\pos(${Math.round(W / 2)},${Math.round(y)})${pop}}${text}`);
    if (endCard && website) {
      ev.push(`Dialogue: 1,${assTime(0.25)},${assTime(len)},Sub,,0,0,0,,{\\pos(${Math.round(W / 2)},${Math.round(H * 0.5 + headSize * (text.split('\\N').length * 0.7 + 0.9))})\\fad(200,0)}${assText(site(website))}`);
    }
  }
  if (captions && say && !endCard && voiceEnd > voiceStart) {
    const ws = timeWords(say, voiceStart, voiceEnd);
    const groups = groupWords(ws);
    groups.forEach((g, gi) => {
      const groupEnd = Math.min(len, gi + 1 < groups.length ? groups[gi + 1][0].start : g[g.length - 1].end + 0.4);
      g.forEach((w, wi) => {
        const a = wi === 0 ? g[0].start : w.start;
        const b = wi + 1 < g.length ? g[wi + 1].start : groupEnd;
        if (b - a < 0.02) return;
        const text = g.map((x, xi) => {
          const t = assText(bold ? x.text.toUpperCase() : x.text);
          return bold && xi === wi ? `{\\c${assColor(color).replace('&H00', '&H')}&\\fscx108\\fscy108}${t}{\\c&HFFFFFF&\\fscx100\\fscy100}` : t;
        }).join(' ');
        ev.push(`Dialogue: 0,${assTime(a)},${assTime(b)},Cap,,0,0,0,,${text}`);
      });
    });
  }
  return head + ev.join('\n') + '\n';
}

// ---------- Making the video ----------
const RENDER_THREADS = Math.max(1, Math.floor((os.cpus()?.length || 2) / 2));
const even = (n) => Math.round(n / 2) * 2;
const libPath = (file) => path.join(libDir, path.basename(String(file || '')));
const getMedia = (file) => (file ? db.prepare('SELECT * FROM ad_media WHERE file=?').get(path.basename(file)) : null);

// The picture part of a scene: a photo that slowly drifts, a video, or a moving colour background.
function visualFilter({ W, H, media, framing, look, n, len, color }) {
  const W2 = media?.kind === 'image' ? even(W * 1.1) : W;
  const H2 = media?.kind === 'image' ? even(H * 1.1) : H;
  let f;
  if (!media) {
    f = '[0:v]';
  } else {
    const aspect = media.width && media.height ? (media.width / media.height) / (W / H) : 1;
    const fit = framing === 'fit' || (framing !== 'fill' && (aspect > 1.5 || aspect < 1 / 1.5));
    f = fit
      ? `[0:v]split=2[va][vb];[va]scale=${W2}:${H2}:force_original_aspect_ratio=increase,crop=${W2}:${H2},boxblur=30:3,eq=brightness=-0.12[bg];` +
        `[vb]scale=${even(W2 * 0.94)}:${even(H2 * 0.94)}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`
      : `[0:v]scale=${W2}:${H2}:force_original_aspect_ratio=increase,crop=${W2}:${H2}`;
    if (media.kind === 'image') {
      // Slow drift, in a different direction each scene.
      const p = `(t/${len.toFixed(2)})`;
      const [x, y] = [[`(iw-ow)*${p}`, '(ih-oh)/2'], [`(iw-ow)*(1-${p})`, '(ih-oh)/2'], ['(iw-ow)/2', `(ih-oh)*${p}`], ['(iw-ow)/2', `(ih-oh)*(1-${p})`]][n % 4];
      f += `,crop=${W}:${H}:x='${x}':y='${y}'`;
    }
    f += ',';
  }
  const grade = look === 'cinematic' ? 'eq=contrast=1.08:saturation=0.88,vignette=PI/4.5,' : look === 'bold' && media ? 'eq=saturation=1.12:contrast=1.04,' : '';
  return `${f}${grade}setsar=1,fps=30,format=yuv420p`;
}

async function renderScene({ ad, brand, scene, n, total, fmt, work, voiceFile, voiceLen }) {
  const { w: W, h: H } = FORMATS[fmt];
  const look = ad.look;
  const color = brand?.color || '#FFD60A';
  const media = getMedia(scene.media);
  const useVideoSound = scene.sound === 'video' && media?.kind === 'video' && media.has_audio;
  const voiceStart = voiceFile ? 0.15 : 0;
  let len = Number(scene.seconds) > 0 ? Number(scene.seconds)
    : voiceFile ? voiceStart + voiceLen + 0.35
    : useVideoSound ? Math.min(media.duration || 6, 10)
    : Math.max(2.4, words(scene.say).length / 2.6 + 0.8);
  if (scene.endCard && !voiceFile) len = Math.max(len, 3);
  len = Math.max(1.5, Math.min(60, len));
  const voiceEnd = voiceFile ? voiceStart + voiceLen : useVideoSound ? 0 : len - 0.3;

  const inputs = [];
  if (!media) {
    const c0 = (color.replace('#', '') || 'FFD60A');
    inputs.push('-f', 'lavfi', '-i', `gradients=s=${W}x${H}:c0=0x${c0}:c1=0x111827:c2=0x1f2937:n=3:speed=0.012:r=30:d=${len.toFixed(2)}`);
  } else if (media.kind === 'image') {
    inputs.push('-loop', '1', '-framerate', '30', '-t', len.toFixed(2), '-i', libPath(media.file));
  } else {
    const start = Math.max(0, Number(scene.start) || 0);
    inputs.push('-stream_loop', '-1', '-ss', String(start), '-t', len.toFixed(2), '-i', libPath(media.file));
  }
  let ai = 1;
  if (voiceFile) inputs.push('-i', voiceFile);
  else if (!useVideoSound) inputs.push('-f', 'lavfi', '-t', len.toFixed(2), '-i', 'anullsrc=r=44100:cl=stereo');
  else ai = 0;
  const logo = brand?.logo && fs.existsSync(libPath(brand.logo)) ? libPath(brand.logo) : null;
  const logoIdx = logo ? (ai === 0 ? 1 : 2) : -1;
  if (logo) inputs.push('-i', logo);

  let filter = visualFilter({ W, H, media, framing: scene.framing, look, n, len, color });
  // On the end card the background is darkened so the call to action stands out.
  if (scene.endCard && media) filter += ',boxblur=18:2,eq=brightness=-0.18';
  filter += '[v0]';
  let last = 'v0';
  if (logo) {
    const big = scene.endCard;
    const lw = even(Math.min(W, H) * (big ? 0.34 : 0.15));
    const m = Math.round(Math.min(W, H) * 0.045);
    filter += `;[${logoIdx}:v]scale=${lw}:-1,format=rgba,colorchannelmixer=aa=${big ? 1 : 0.9}[lg];[${last}][lg]overlay=${big ? '(W-w)/2' : `W-w-${m}`}:${big ? `H*0.5-h-${Math.round(H * 0.1)}` : m}[v1]`;
    last = 'v1';
  }
  const ass = buildSceneAss({
    W, H, look, color, headline: scene.headline, say: scene.say, voiceStart, voiceEnd, len,
    endCard: scene.endCard, website: brand?.website || ad.detailsObj.website, captions: ad.captions !== false,
  });
  const assFile = `s${n}-${fmt}.ass`;
  fs.writeFileSync(path.join(work, assFile), ass);
  const escFonts = fontsDir.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const withAss = `${filter};[${last}]ass=filename=${assFile}:fontsdir='${escFonts}'[v]`;
  const audio = `;[${ai}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo${voiceFile ? `,adelay=${Math.round(voiceStart * 1000)}|${Math.round(voiceStart * 1000)}` : ''},apad,atrim=0:${len.toFixed(2)}[a]`;
  const out = `s${n}-${fmt}.mp4`;
  const args = (f) => ['-hide_banner', '-y', ...inputs, '-filter_complex', f + audio, '-map', '[v]', '-map', '[a]',
    '-t', len.toFixed(2), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
    '-threads', String(RENDER_THREADS), '-filter_complex_threads', String(RENDER_THREADS), out];
  let note = null;
  try {
    await run(ffmpegPath(), args(withAss), { cwd: work });
  } catch (err) {
    // If the words can't be drawn on this computer, still make the scene without them.
    await run(ffmpegPath(), args(`${filter};[${last}]null[v]`), { cwd: work });
    note = 'The on-screen words could not be added on this computer.';
  }
  return { file: out, len, note };
}

async function renderAd(ad, step) {
  const brand = ad.brand_id ? db.prepare('SELECT * FROM ad_brands WHERE id=?').get(ad.brand_id) : null;
  const scenes = JSON.parse(ad.scenes || '[]').filter((s) => clean(s.say) || clean(s.headline) || s.media);
  if (!scenes.length) throw new Error('Add at least one scene first.');
  const formats = JSON.parse(ad.formats || '["9x16"]').filter((f) => FORMATS[f]);
  if (!formats.length) formats.push('9x16');
  ad.detailsObj = JSON.parse(ad.details || '{}');
  const dir = path.join(adsDir, String(ad.id));
  const work = path.join(dir, `work-${crypto.randomBytes(3).toString('hex')}`);
  fs.mkdirSync(work, { recursive: true });
  const notes = new Set();
  try {
    // 1. The voice, once for all shapes.
    const voices = [];
    const engine = ttsEngine();
    if (!engine && scenes.some((s) => s.sound !== 'video' && clean(s.say))) notes.add('No voice is available on this computer, so the ad has captions only.');
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      step(`Recording the voiceover · scene ${i + 1} of ${scenes.length}…`, Math.round((i / scenes.length) * 15));
      let file = null, len = 0;
      if (s.sound !== 'video' && clean(s.say) && engine) {
        try {
          file = await speak(s.say, { voice: ad.voice, pace: ad.pace }, path.join(work, `voice-${i}`));
          len = file ? (await probeAny(file)).duration || 0 : 0;
          if (!len) file = null;
        } catch (err) { notes.add(`The voice didn't work (${err.message}), so some scenes have captions only.`); file = null; }
      }
      voices.push({ file, len });
    }
    // 2. Each shape: every scene, then joined, then the sound is evened out (and music added).
    const outputs = {};
    const old = JSON.parse(ad.outputs || '{}');
    const totalSteps = formats.length * (scenes.length + 1);
    let done = 0;
    for (const fmt of formats) {
      const parts = [];
      for (let i = 0; i < scenes.length; i++) {
        step(`Making the ${FORMATS[fmt].label.toLowerCase()} version · scene ${i + 1} of ${scenes.length}…`, 15 + Math.round((done / totalSteps) * 83));
        const r = await renderScene({ ad, brand, scene: scenes[i], n: i, total: scenes.length, fmt, work, voiceFile: voices[i].file, voiceLen: voices[i].len });
        if (r.note) notes.add(r.note);
        parts.push(r);
        done++;
      }
      step(`Finishing the ${FORMATS[fmt].label.toLowerCase()} version…`, 15 + Math.round((done / totalSteps) * 83));
      fs.writeFileSync(path.join(work, `list-${fmt}.txt`), parts.map((p) => `file '${p.file}'`).join('\n'));
      await run(ffmpegPath(), ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', `list-${fmt}.txt`, '-c', 'copy', `joined-${fmt}.mp4`], { cwd: work });
      const total = parts.reduce((t, p) => t + p.len, 0);
      const tag = crypto.randomBytes(3).toString('hex');
      const file = `ad-${fmt}-${tag}.mp4`;
      const poster = `ad-${fmt}-${tag}.jpg`;
      const music = ad.music && fs.existsSync(libPath(ad.music)) ? libPath(ad.music) : null;
      const fadeAt = Math.max(0, total - 1.5).toFixed(2);
      const mixArgs = music
        ? ['-stream_loop', '-1', '-i', music, '-filter_complex',
          `[1:a]aresample=44100,aformat=channel_layouts=stereo,volume=0.13,afade=t=in:d=0.6,afade=t=out:st=${fadeAt}:d=1.5[m];[0:a][m]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100[a]`,
          '-map', '0:v', '-map', '[a]']
        : ['-filter_complex', '[0:a]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100[a]', '-map', '0:v', '-map', '[a]'];
      await run(ffmpegPath(), ['-hide_banner', '-y', '-i', path.join(work, `joined-${fmt}.mp4`), ...mixArgs, '-t', total.toFixed(2),
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', path.join(dir, file)]);
      await run(ffmpegPath(), ['-hide_banner', '-y', '-ss', String(Math.min(1.2, total / 3)), '-i', path.join(dir, file), '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', path.join(dir, poster)]).catch(() => {});
      outputs[fmt] = { file, poster: fs.existsSync(path.join(dir, poster)) ? poster : null, duration: +total.toFixed(1) };
      done++;
    }
    // Old versions are removed once the new ones are ready.
    for (const o of Object.values(old)) [o.file, o.poster].filter(Boolean).forEach((f) => fs.rmSync(path.join(dir, f), { force: true }));
    return { outputs, note: [...notes].join(' ') || null };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ---------- The work queue ----------
const getAd = (id) => db.prepare('SELECT * FROM ads WHERE id=?').get(id);
const setAd = (id, fields) => {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE ads SET ${keys.map((k) => `${k}=@${k}`).join(', ')} WHERE id=@id`).run({ ...fields, id });
};
let busy = false;
async function work() {
  if (busy) return;
  busy = true;
  try {
    let ad;
    while ((ad = db.prepare(`SELECT * FROM ads WHERE status IN ('queued','working') ORDER BY updated_at, id LIMIT 1`).get())) {
      const id = ad.id;
      const stamp = ad.updated_at;
      setAd(id, { status: 'working', error: null, step: 'Getting started…', progress: 1 });
      try {
        const out = await renderAd(ad, (text, progress) => { if (getAd(id)) setAd(id, { step: text, progress }); });
        const now = getAd(id);
        if (!now) continue;
        // If the ad was changed while it was being made, make it again with the changes.
        if (now.status === 'queued' && now.updated_at !== stamp) {
          setAd(id, { outputs: JSON.stringify(out.outputs) });
          continue;
        }
        setAd(id, { status: 'ready', step: null, progress: 100, outputs: JSON.stringify(out.outputs), note: out.note });
      } catch (err) {
        console.error('[ads]', err);
        if (getAd(id)) setAd(id, { status: 'failed', step: null, error: String(err.message).slice(0, 500) });
      }
    }
  } finally { busy = false; }
}

function start() {
  db.prepare(`UPDATE ads SET status='queued' WHERE status='working'`).run();
  fs.readdirSync(adsDir).forEach((d) => {
    const full = path.join(adsDir, d);
    if (/^\d+$/.test(d)) fs.readdirSync(full).filter((x) => x.startsWith('work-')).forEach((x) => fs.rmSync(path.join(full, x), { recursive: true, force: true }));
  });
  work();
}

// ---------- Output for the page ----------
const mediaOut = (m) => m && ({
  id: m.id, file: m.file, kind: m.kind, name: m.name, width: m.width, height: m.height, duration: m.duration, has_audio: Boolean(m.has_audio),
  url: `/adlib/${m.file}`, thumb_url: m.kind === 'video' ? `/adlib/${m.file.replace(/\.[^.]+$/, '')}.thumb.jpg` : m.kind === 'image' ? `/adlib/${m.file}` : null,
});
const brandOut = (b) => b && ({ ...b, logo_url: b.logo ? `/adlib/${b.logo}` : null });
const productOut = (p) => p && ({ ...p, photos: JSON.parse(p.photos || '[]') });
function adOut(a) {
  const outputs = JSON.parse(a.outputs || '{}');
  return {
    id: a.id, name: a.name, details: JSON.parse(a.details || '{}'), recipe: a.recipe, look: a.look, voice: a.voice, pace: a.pace,
    length: a.length, formats: JSON.parse(a.formats || '[]'), brand_id: a.brand_id, product_id: a.product_id,
    media: JSON.parse(a.media || '[]').map(getMedia).filter(Boolean).map(mediaOut),
    music: a.music ? mediaOut(getMedia(a.music)) : null,
    scenes: JSON.parse(a.scenes || '[]'), caption: a.caption,
    status: a.status, step: a.step, progress: a.progress, error: a.error, note: a.note,
    created_at: a.created_at, updated_at: a.updated_at,
    outputs: Object.fromEntries(Object.entries(outputs).map(([f, o]) => [f, {
      ...o, format: f, label: FORMATS[f]?.label, for: FORMATS[f]?.for,
      url: `/adfile/${a.id}/${o.file}`, poster_url: o.poster ? `/adfile/${a.id}/${o.poster}` : null,
    }])),
  };
}

// Details for a new ad: what was typed, filled in from the chosen brand and product.
function mergeDetails(body) {
  const brand = body.brand_id ? db.prepare('SELECT * FROM ad_brands WHERE id=?').get(body.brand_id) : null;
  const product = body.product_id ? db.prepare('SELECT * FROM ad_products WHERE id=?').get(body.product_id) : null;
  const d = body.details || {};
  return {
    name: clean(d.name, 80) || product?.name || brand?.name || '',
    about: String(d.about || '').trim().slice(0, 3000) || product?.about || '',
    points: String(d.points || '').trim().slice(0, 1000) || product?.points || '',
    offer: clean(d.offer, 160) || product?.offer || '',
    cta: clean(d.cta, 40) || brand?.cta || 'Learn more',
    website: clean(d.website, 200) || product?.link || brand?.website || '',
    tags: clean(d.tags, 120),
  };
}

// Puts the ad's photos and videos into the scenes, in turn (the end card gets the logo).
function placeMedia(scenes, media) {
  let k = 0;
  return scenes.map((s, i) => {
    const isEnd = Boolean(s.endCard) && scenes.length > 1;
    const m = media.length ? media[isEnd ? 0 : k++ % media.length] : null;
    return { say: s.say, headline: s.headline, media: m?.file || null, sound: 'voice', framing: 'auto', seconds: null, endCard: isEnd };
  });
}

// ---------- API (/api/ads) ----------
const router = express.Router();
const upload = multer({
  storage: multer.diskStorage({
    destination: libDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${(path.extname(file.originalname) || '').toLowerCase().replace(/[^.\w]/g, '').slice(0, 6)}`),
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^(image|video|audio)\//.test(file.mimetype) || /\.(jpe?g|png|webp|heic|mp4|mov|m4v|webm|mp3|m4a|wav|aac)$/i.test(file.originalname)),
});

router.get('/options', async (req, res) => {
  res.json({
    formats: Object.entries(FORMATS).map(([id, f]) => ({ id, ...f })),
    looks: LOOKS, recipes: RECIPES, paces: Object.keys(PACES), lengths: LENGTHS, ctas: CTAS,
    voices: await listVoices().catch(() => []),
    voiceEngine: ttsEngine() === 'say' ? 'mac' : ttsEngine() ? 'basic' : 'none',
  });
});

// A few seconds of the chosen voice, to hear it before making the ad.
router.post('/voices/preview', async (req, res) => {
  const base = path.join(os.tmpdir(), `vp-${crypto.randomBytes(4).toString('hex')}`);
  try {
    const file = await speak(clean(req.body?.text, 200) || 'Hi! This is how your ad will sound.', { voice: req.body?.voice, pace: req.body?.pace }, base);
    if (!file) return res.status(400).json({ error: 'There is no voice on this computer.' });
    const mp3 = `${base}.m4a`;
    await run(ffmpegPath(), ['-hide_banner', '-y', '-i', file, '-c:a', 'aac', '-b:a', '96k', mp3]);
    res.type('audio/mp4').send(fs.readFileSync(mp3));
    [file, mp3].forEach((f) => fs.rmSync(f, { force: true }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Library: photos, videos, logos and music added to the studio.
router.get('/media', (req, res) => res.json(db.prepare('SELECT * FROM ad_media ORDER BY id DESC').all().map(mediaOut)));
router.post('/media', upload.array('files', 30), async (req, res) => {
  const out = [];
  for (const f of req.files || []) {
    const info = await probeAny(f.path);
    let kind = /^image\//.test(f.mimetype) || /\.(jpe?g|png|webp|heic)$/i.test(f.originalname) ? 'image'
      : /^audio\//.test(f.mimetype) || /\.(mp3|m4a|wav|aac)$/i.test(f.originalname) ? 'audio' : 'video';
    if (kind === 'video' && !info.hasVideo && info.hasAudio) kind = 'audio';
    if ((kind !== 'audio' && !info.width) || (kind === 'audio' && !info.hasAudio)) { fs.rmSync(f.path, { force: true }); continue; }
    // Photos are turned into JPGs (iPhone HEIC photos included) so every tool can read them.
    let file = f.filename;
    if (kind === 'image' && !/\.(jpe?g|png)$/i.test(file)) {
      const jpg = file.replace(/\.[^.]*$/, '') + '.jpg';
      try { await run(ffmpegPath(), ['-hide_banner', '-y', '-i', f.path, '-q:v', '3', path.join(libDir, jpg)]); fs.rmSync(f.path, { force: true }); file = jpg; } catch {}
    }
    if (kind === 'video') {
      await run(ffmpegPath(), ['-hide_banner', '-y', '-ss', String(Math.min(1, (info.duration || 2) / 3)), '-i', f.path, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5',
        path.join(libDir, `${file.replace(/\.[^.]+$/, '')}.thumb.jpg`)]).catch(() => {});
    }
    const { lastInsertRowid } = db.prepare('INSERT INTO ad_media (file, kind, name, width, height, duration, has_audio) VALUES (?,?,?,?,?,?,?)')
      .run(file, kind, clean(f.originalname, 120), info.width, info.height, info.duration, info.hasAudio ? 1 : 0);
    out.push(mediaOut(db.prepare('SELECT * FROM ad_media WHERE id=?').get(lastInsertRowid)));
  }
  if (!out.length) return res.status(400).json({ error: 'Those files could not be read. Use JPG, PNG or HEIC photos, MP4 or MOV videos, or MP3/M4A music.' });
  res.status(201).json(out);
});
router.delete('/media/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM ad_media WHERE id=?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM ad_media WHERE id=?').run(m.id);
  fs.rmSync(libPath(m.file), { force: true });
  fs.rmSync(libPath(`${m.file.replace(/\.[^.]+$/, '')}.thumb.jpg`), { force: true });
  res.json({ ok: true });
});

// Brands: name, logo, colour, website and the usual call to action.
router.get('/brands', (req, res) => res.json(db.prepare('SELECT * FROM ad_brands ORDER BY name').all().map(brandOut)));
function brandFields(b, old = {}) {
  return {
    name: clean(b.name ?? old.name, 80),
    website: clean(b.website ?? old.website, 200) || null,
    cta: clean(b.cta ?? old.cta, 40) || null,
    color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : old.color || '#FFD60A',
    logo: b.logo !== undefined ? (getMedia(b.logo)?.file || null) : old.logo || null,
  };
}
router.post('/brands', (req, res) => {
  const f = brandFields(req.body || {});
  if (!f.name) return res.status(400).json({ error: 'Give the brand a name.' });
  const { lastInsertRowid } = db.prepare('INSERT INTO ad_brands (name, website, cta, color, logo) VALUES (@name,@website,@cta,@color,@logo)').run(f);
  res.status(201).json(brandOut(db.prepare('SELECT * FROM ad_brands WHERE id=?').get(lastInsertRowid)));
});
router.patch('/brands/:id', (req, res) => {
  const old = db.prepare('SELECT * FROM ad_brands WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const f = brandFields(req.body || {}, old);
  if (!f.name) return res.status(400).json({ error: 'Give the brand a name.' });
  db.prepare('UPDATE ad_brands SET name=@name, website=@website, cta=@cta, color=@color, logo=@logo WHERE id=@id').run({ ...f, id: old.id });
  res.json(brandOut(db.prepare('SELECT * FROM ad_brands WHERE id=?').get(old.id)));
});
router.delete('/brands/:id', (req, res) => {
  db.prepare('UPDATE ads SET brand_id=NULL WHERE brand_id=?').run(req.params.id);
  db.prepare('UPDATE ad_products SET brand_id=NULL WHERE brand_id=?').run(req.params.id);
  db.prepare('DELETE FROM ad_brands WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Products (or services, events, causes): what is being promoted.
router.get('/products', (req, res) => res.json(db.prepare('SELECT * FROM ad_products ORDER BY name').all().map(productOut)));
function productFields(b, old = {}) {
  const photos = Array.isArray(b.photos) ? b.photos.map((f) => getMedia(f)?.file).filter(Boolean) : JSON.parse(old.photos || '[]');
  return {
    name: clean(b.name ?? old.name, 80),
    brand_id: b.brand_id !== undefined ? (Number(b.brand_id) || null) : old.brand_id ?? null,
    about: String(b.about ?? old.about ?? '').trim().slice(0, 1500) || null,
    points: String(b.points ?? old.points ?? '').trim().slice(0, 1000) || null,
    offer: clean(b.offer ?? old.offer, 160) || null,
    link: clean(b.link ?? old.link, 200) || null,
    photos: JSON.stringify(photos),
  };
}
router.post('/products', (req, res) => {
  const f = productFields(req.body || {});
  if (!f.name) return res.status(400).json({ error: 'Give it a name.' });
  const { lastInsertRowid } = db.prepare('INSERT INTO ad_products (name, brand_id, about, points, offer, link, photos) VALUES (@name,@brand_id,@about,@points,@offer,@link,@photos)').run(f);
  res.status(201).json(productOut(db.prepare('SELECT * FROM ad_products WHERE id=?').get(lastInsertRowid)));
});
router.patch('/products/:id', (req, res) => {
  const old = db.prepare('SELECT * FROM ad_products WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'Not found' });
  const f = productFields(req.body || {}, old);
  if (!f.name) return res.status(400).json({ error: 'Give it a name.' });
  db.prepare('UPDATE ad_products SET name=@name, brand_id=@brand_id, about=@about, points=@points, offer=@offer, link=@link, photos=@photos WHERE id=@id').run({ ...f, id: old.id });
  res.json(productOut(db.prepare('SELECT * FROM ad_products WHERE id=?').get(old.id)));
});
router.delete('/products/:id', (req, res) => {
  db.prepare('UPDATE ads SET product_id=NULL WHERE product_id=?').run(req.params.id);
  db.prepare('DELETE FROM ad_products WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Ads
router.get('/', (req, res) => res.json(db.prepare('SELECT * FROM ads ORDER BY id DESC').all().map(adOut)));
router.get('/:id', (req, res) => { const a = getAd(req.params.id); a ? res.json(adOut(a)) : res.status(404).json({ error: 'Not found' }); });

function settingsFrom(b, old = {}) {
  const formats = Array.isArray(b.formats) ? b.formats.filter((f) => FORMATS[f]) : JSON.parse(old.formats || '["9x16"]');
  return {
    recipe: RECIPES[b.recipe] ? b.recipe : old.recipe || 'hook',
    look: LOOKS.includes(b.look) ? b.look : old.look || 'bold',
    voice: b.voice !== undefined ? clean(b.voice, 80) || null : old.voice ?? null,
    pace: PACES[b.pace] ? b.pace : old.pace || 'normal',
    length: LENGTHS.includes(Number(b.length)) ? Number(b.length) : old.length || 30,
    formats: JSON.stringify(formats.length ? [...new Set(formats)] : ['9x16']),
    brand_id: b.brand_id !== undefined ? (Number(b.brand_id) || null) : old.brand_id ?? null,
    product_id: b.product_id !== undefined ? (Number(b.product_id) || null) : old.product_id ?? null,
    music: b.music !== undefined ? (getMedia(b.music)?.kind === 'audio' ? getMedia(b.music).file : null) : old.music ?? null,
  };
}

// New ad: writes the script and caption from the details. It is not made into a video until
// "Make my video" is pressed, so the script can be checked first.
router.post('/', (req, res) => {
  const b = req.body || {};
  const s = settingsFrom(b);
  const details = mergeDetails({ ...b, brand_id: s.brand_id, product_id: s.product_id });
  if (!details.name && !details.about) return res.status(400).json({ error: 'Describe your ad or paste a script first.' });
  let recipe = s.recipe;
  if (b.recipe === undefined || b.recipe === 'auto') recipe = words(details.about).length >= 35 ? 'script' : 'hook';
  const product = s.product_id ? db.prepare('SELECT * FROM ad_products WHERE id=?').get(s.product_id) : null;
  let mediaFiles = (Array.isArray(b.media) ? b.media : []).map((f) => getMedia(f)).filter((m) => m && m.kind !== 'audio').map((m) => m.file);
  if (!mediaFiles.length && product) mediaFiles = JSON.parse(product.photos || '[]');
  const media = mediaFiles.map(getMedia).filter(Boolean);
  const scenes = placeMedia(writeScript(details, { recipe, length: s.length, seed: Date.now() % 97 }), media);
  const name = cap(clean(b.name, 80) || clean(details.name, 60) || short(details.about, 6)) || 'New ad';
  const { lastInsertRowid } = db.prepare(`INSERT INTO ads (name, details, recipe, look, voice, pace, length, formats, brand_id, product_id, media, music, scenes, caption)
    VALUES (@name,@details,@recipe,@look,@voice,@pace,@length,@formats,@brand_id,@product_id,@media,@music,@scenes,@caption)`).run({
    ...s, recipe, name, details: JSON.stringify(details), media: JSON.stringify(mediaFiles), scenes: JSON.stringify(scenes), caption: writeCaption(details, scenes),
  });
  res.status(201).json(adOut(getAd(lastInsertRowid)));
});

function cleanScenes(list) {
  return (Array.isArray(list) ? list : []).slice(0, 15).map((s) => ({
    say: String(s.say || '').trim().slice(0, 400),
    headline: clean(s.headline, 60),
    media: getMedia(s.media)?.kind && getMedia(s.media).kind !== 'audio' ? getMedia(s.media).file : null,
    sound: s.sound === 'video' ? 'video' : 'voice',
    framing: ['fill', 'fit'].includes(s.framing) ? s.framing : 'auto',
    seconds: Number(s.seconds) > 0 ? Math.min(60, Math.max(1.5, Number(s.seconds))) : null,
    start: Number(s.start) > 0 ? Number(s.start) : 0,
    endCard: Boolean(s.endCard),
  }));
}

router.patch('/:id', (req, res) => {
  const a = getAd(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const s = settingsFrom(b, a);
  const fields = { ...s, updated_at: new Date().toISOString() };
  if (typeof b.name === 'string' && clean(b.name)) fields.name = clean(b.name, 80);
  if (typeof b.caption === 'string') fields.caption = b.caption.slice(0, 2200);
  if (b.details) fields.details = JSON.stringify({ ...JSON.parse(a.details || '{}'), ...mergeDetails({ details: b.details }) });
  if (Array.isArray(b.media)) fields.media = JSON.stringify(b.media.map((f) => getMedia(f)).filter((m) => m && m.kind !== 'audio').map((m) => m.file));
  if (Array.isArray(b.scenes)) fields.scenes = JSON.stringify(cleanScenes(b.scenes));
  setAd(a.id, fields);
  res.json(adOut(getAd(a.id)));
});

// Write the script again (a different version each time).
router.post('/:id/rewrite', (req, res) => {
  const a = getAd(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const recipe = RECIPES[req.body?.recipe] ? req.body.recipe : a.recipe;
  const details = JSON.parse(a.details || '{}');
  const media = JSON.parse(a.media || '[]').map(getMedia).filter(Boolean);
  const scenes = placeMedia(writeScript(details, { recipe, length: a.length, seed: Math.floor(Math.random() * 1000) }), media);
  setAd(a.id, { recipe, scenes: JSON.stringify(scenes), caption: writeCaption(details, scenes), updated_at: new Date().toISOString() });
  res.json(adOut(getAd(a.id)));
});

router.post('/:id/render', (req, res) => {
  const a = getAd(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (!JSON.parse(a.scenes || '[]').length) return res.status(400).json({ error: 'Add at least one scene first.' });
  setAd(a.id, { status: 'queued', error: null, note: null, step: 'Waiting its turn…', progress: 0, updated_at: new Date().toISOString() });
  work();
  res.json(adOut(getAd(a.id)));
});

router.post('/:id/copy', (req, res) => {
  const a = getAd(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const { lastInsertRowid } = db.prepare(`INSERT INTO ads (name, details, recipe, look, voice, pace, length, formats, brand_id, product_id, media, music, scenes, caption)
    SELECT name || ' (copy)', details, recipe, look, voice, pace, length, formats, brand_id, product_id, media, music, scenes, caption FROM ads WHERE id=?`).run(a.id);
  res.status(201).json(adOut(getAd(lastInsertRowid)));
});

router.delete('/:id', (req, res) => {
  const a = getAd(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM ads WHERE id=?').run(a.id);
  fs.rmSync(path.join(adsDir, String(a.id)), { recursive: true, force: true });
  res.json({ ok: true });
});

// For the New post page: one finished shape of an ad.
router.get('/:id/out/:format', (req, res) => {
  const a = getAd(req.params.id);
  const o = a && adOut(a).outputs[req.params.format];
  if (!o) return res.status(404).json({ error: 'That version of the ad is not ready yet.' });
  res.json({ ref: `${a.id}:${req.params.format}`, title: a.name, caption: a.caption, url: o.url, poster_url: o.poster_url, length: o.duration, label: o.label });
});

// ---------- Files (signed-in users only) ----------
function serveAdFile(req, res) {
  const { id, file } = req.params;
  if (!/^\d+$/.test(id) || !/^ad-\w+-[0-9a-f]+\.(mp4|jpg)$/.test(file)) return res.status(404).end();
  const full = path.join(adsDir, id, file);
  if (!fs.existsSync(full)) return res.status(404).end();
  if (req.query.download) {
    const a = getAd(id);
    res.attachment(`${clean(a?.name || 'ad', 60).replace(/[^\w -]/g, '') || 'ad'} ${file.split('-')[1]}${path.extname(file)}`);
  }
  res.sendFile(full, { maxAge: '7d' });
}
function serveLibFile(req, res) {
  const file = path.basename(req.params.file);
  if (!/^[\w.-]+$/.test(file)) return res.status(404).end();
  const full = libPath(file);
  if (!fs.existsSync(full)) return res.status(404).end();
  res.sendFile(full, { maxAge: '30d' });
}

// Copies a finished ad into the post media folder (deleting the post never deletes the ad).
function copyAdToMedia(ref) {
  const [id, fmt] = String(ref || '').split(':');
  const a = getAd(Number(id));
  const o = a && JSON.parse(a.outputs || '{}')[fmt];
  if (!o || !fs.existsSync(path.join(adsDir, String(a.id), o.file))) return null;
  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.mp4`;
  fs.copyFileSync(path.join(adsDir, String(a.id), o.file), path.join(config.mediaDir, name));
  return name;
}

module.exports = { router, serveAdFile, serveLibFile, copyAdToMedia, start, work, writeScript, splitScript, writeCaption, buildSceneAss, timeWords, FORMATS };
