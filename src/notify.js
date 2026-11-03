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
    // JSON publishing keeps titles with spaces and emoji intact.
    const res = await fetch(`${base()}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: t, title, message, priority: { default: 3, high: 4 }[priority] || 3, tags: tags ? tags.split(',') : [] }),
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
    const where = (list) => list.map((r) => `${{ instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' }[r.platform] || 'Facebook'} (${r.account})`).join(', ');
    if (bad.length) {
      await send('Post FAILED', `"${short(rows[0].caption)}"\nFailed on: ${bad.map((r) => `${where([r])}: ${short(r.error, 120)}`).join('\n')}`
        + (ok.length ? `\nPosted on: ${where(ok)}` : ''), { priority: 'high', tags: 'warning' });
    } else {
      const notes = [...new Set(ok.map((r) => r.note).filter(Boolean))];
      await send(notes.length ? 'Action needed' : 'Posted', `"${short(rows[0].caption)}"\nOn: ${where(ok)}${notes.map((n) => `\n${n}`).join('')}`,
        { tags: notes.length ? 'point_right' : 'white_check_mark', priority: notes.length ? 'high' : 'default' });
    }
  }
}

module.exports = { topic, createTopic, send, postResults, topicFile };
