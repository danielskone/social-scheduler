// Publishes due posts and refreshes stats. Runs inside the web server process.
const cron = require('node-cron');
const db = require('./db');
const meta = require('./meta');
const media = require('./mediafetch');
const notify = require('./notify');

const youtube = require('./youtube');
const tiktok = require('./tiktok');
const crm = require('./crm');

const publishers = { facebook: meta.publishFacebook, instagram: meta.publishInstagram, youtube: youtube.publishYouTube, tiktok: tiktok.publishTikTok };
const postStats = { facebook: meta.facebookPostStats, instagram: meta.instagramPostStats, youtube: youtube.videoStats, tiktok: tiktok.videoStats };
const followers = { facebook: meta.followerCount, instagram: meta.followerCount, youtube: youtube.subscriberCount, tiktok: tiktok.followerCount };
let running = false;

async function publishDue(now = new Date()) {
  if (running) return; // don't overlap if a slow video upload is still going
  running = true;
  try {
    const due = db.prepare(`
      SELECT t.id AS target_id, p.*, a.platform, a.external_id, a.access_token, a.name AS account_name, a.username AS account_username
      FROM post_targets t
      JOIN posts p ON p.id = t.post_id
      JOIN accounts a ON a.id = t.account_id
      WHERE t.status = 'scheduled' AND p.scheduled_at <= ?
      ORDER BY p.scheduled_at`).all(now.toISOString());
    const results = [];

    for (const row of due) {
      db.prepare(`UPDATE post_targets SET status='publishing', error=NULL WHERE id=?`).run(row.target_id);
      const account = { platform: row.platform, external_id: row.external_id, access_token: row.access_token, username: row.account_username };
      try {
        if (row.media_source_url && !row.media_file) row.media_file = await media.ensureMedia(row.id);
        const res = await publishers[row.platform](account, row);
        db.prepare(`UPDATE post_targets SET status='published', external_post_id=?, permalink=?, published_at=? WHERE id=?`)
          .run(res.id, res.permalink, new Date().toISOString(), row.target_id);
        console.log(`[publish] post ${row.id} -> ${row.platform} ${row.account_name}: ${res.id}`);
        results.push({ postId: row.id, caption: row.caption, platform: row.platform, account: row.account_name, ok: true, note: res.note || null });
      } catch (err) {
        const why = err.cause ? `${err.message} (${[err.cause.code, err.cause.message].filter(Boolean).join(': ')})` : String(err.message || err);
        db.prepare(`UPDATE post_targets SET status='failed', error=? WHERE id=?`).run(why, row.target_id);
        console.error(`[publish] post ${row.id} -> ${row.platform} failed: ${err.message}`);
        results.push({ postId: row.id, caption: row.caption, platform: row.platform, account: row.account_name, ok: false, error: String(err.message || err) });
      }
    }
    await notify.postResults(results);
  } finally {
    running = false;
  }
}

async function refreshStats({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const rows = db.prepare(`
    SELECT t.id, t.external_post_id, a.platform, a.external_id, a.access_token, a.username
    FROM post_targets t JOIN accounts a ON a.id = t.account_id
    WHERE t.status='published' AND t.published_at >= ?`).all(since);
  for (const r of rows) {
    try {
      const s = await postStats[r.platform](r, r.external_post_id);
      db.prepare(`UPDATE post_targets SET likes=?, comments=?, shares=?, views=?, stats_updated_at=? WHERE id=?`)
        .run(s.likes, s.comments, s.shares, s.views, new Date().toISOString(), r.id);
    } catch (err) {
      console.error(`[stats] target ${r.id}: ${err.message}`);
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  for (const a of db.prepare('SELECT * FROM accounts').all()) {
    try {
      const n = await followers[a.platform](a);
      if (n != null) {
        db.prepare(`INSERT INTO follower_snapshots (account_id, followers, taken_on) VALUES (?,?,?)
                    ON CONFLICT(account_id, taken_on) DO UPDATE SET followers=excluded.followers`).run(a.id, n, today);
      }
    } catch (err) {
      console.error(`[stats] followers for ${a.name}: ${err.message}`);
    }
  }
}

function start() {
  // A post left "publishing" after a crash may or may not have gone out, so flag it
  // rather than retrying and risking a double post.
  db.prepare(`UPDATE post_targets SET status='failed', error='App restarted while publishing. Check the platform, then retry if it did not post.' WHERE status='publishing'`).run();
  cron.schedule('* * * * *', () => publishDue().catch((e) => console.error(e)));
  cron.schedule('*/2 * * * *', () => media.prefetch().catch((e) => console.error(e)));
  // Contacts: one phone alert at 8am (Eastern unless BOOKING_TIMEZONE says otherwise) with today's appointments, tasks and follow-ups.
  cron.schedule('0 8 * * *', () => crm.sendFollowUpReminder().catch((e) => console.error(e)), { timezone: process.env.BOOKING_TIMEZONE || 'America/New_York' });
  cron.schedule('17 */3 * * *', () => refreshStats().catch((e) => console.error(e)));
}

module.exports = { start, publishDue, refreshStats };
