// Phone notifications through ntfy (free app for iPhone/Android, no account needed).
// Turned on by `npm run phone`, which creates a private random topic name in
// data/phone-topic.txt. The phone app subscribes to that topic; the scheduler sends a
// short message there when a post goes out or fails.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const topicFile = path.join(config.dataDir, 'phone-topic.txt');
const base = () => (process.env.NTFY_BASE || 'https://ntfy.sh').replace(/\/$/, '');

function topic() {
  try { return fs.readFileSync(topicFile, 'utf8').trim() || null; } catch { return null; }
}

function createTopic() {
  const existing = topic();
  if (existing) return existing;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const t = `sched-${crypto.randomBytes(12).toString('hex')}`;
  fs.writeFileSync(topicFile, t + '\n');
  return t;
}

async function send(title, message, { priority = 'default', tags = '' } = {}) {
  const t = topic();
  if (!t) return false;
  try {
    const res = await fetch(`${base()}/${t}`, {
      method: 'POST',
      body: message,
      headers: { Title: encodeURIComponent(title), 'X-Title-Encoding': 'uri', Priority: priority, Tags: tags },
    });
    return res.ok;
  } catch (err) {
    console.error(`[notify] ${err.message}`);
    return false;
  }
}

const short = (s, n = 80) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// results: [{ caption, account, platform, ok, error, permalink }] for one publishing run.
async function postResults(results) {
  if (!results.length || !topic()) return;
  const byPost = new Map();
  for (const r of results) {
    if (!byPost.has(r.postId)) byPost.set(r.postId, []);
    byPost.get(r.postId).push(r);
  }
  for (const rows of byPost.values()) {
    const ok = rows.filter((r) => r.ok), bad = rows.filter((r) => !r.ok);
    const where = (list) => list.map((r) => `${r.platform === 'instagram' ? 'Instagram' : 'Facebook'} (${r.account})`).join(', ');
    if (bad.length) {
      await send('Post FAILED', `"${short(rows[0].caption)}"\nFailed on: ${bad.map((r) => `${where([r])}: ${short(r.error, 120)}`).join('\n')}`
        + (ok.length ? `\nPosted on: ${where(ok)}` : ''), { priority: 'high', tags: 'warning' });
    } else {
      await send('Posted', `"${short(rows[0].caption)}"\nOn: ${where(ok)}`, { tags: 'white_check_mark' });
    }
  }
}

module.exports = { topic, createTopic, send, postResults, topicFile };
