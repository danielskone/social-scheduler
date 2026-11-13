// Publishes due posts and refreshes stats. Runs inside the web server process.
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const config = require('./config');
const db = require('./db');
const meta = require('./meta');
const media = require('./mediafetch');
const notify = require('./notify');

const youtube = require('./youtube');
const tiktok = require('./tiktok');
const crm = require('../crm/server/crm');
const website = require('../crm/server/website');
const automations = require('../crm/server/automations');
const campaigns = require('../crm/server/campaigns');
const gcal = require('../crm/server/gcal');
const thumbs = require('./thumbs');

const publishers = { facebook: meta.publishFacebook, instagram: meta.publishInstagram, youtube: youtube.publishYouTube, tiktok: tiktok.publishTikTok };
const postStats = { facebook: meta.facebookPostStats, instagram: meta.instagramPostStats, youtube: youtube.videoStats, tiktok: tiktok.videoStats };
const followers = { facebook: meta.followerCount, instagram: meta.followerCount, youtube: youtube.subscriberCount, tiktok: tiktok.followerCount };
let running = false;

// A post that fails for a temporary reason (Instagram "unknown error", the Mac's link not
// ready, a busy server) is tried again by itself: after 5, 20 and 60 minutes. Only if it
// still fails does it show as Failed and buzz your phone. It's only retried when we know
// nothing was posted, so a retry can never make a double post.
const RETRY_MINUTES = [5, 20, 60];
// TikTok (until the app is approved) puts each video in your TikTok inbox, and refuses new ones while
// too many are waiting there, or after too many posts in a day. Then the TikTok part waits and is
// tried again every 6 hours, for up to 3 days, instead of failing right away. Your phone gets one
// buzz telling you to clear the TikTok inbox. Nothing was uploaded, so it can't post twice.
const TIKTOK_WAIT_HOURS = 6;
const TIKTOK_MAX_WAITS = 12; // 12 x 6 hours = 3 days
const whenText = (d) => d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

function retryable(err, platform) {
  if (err.safeToRetry === false) return false;
  if (err.safeToRetry === true) return true; // Facebook/Instagram said no; nothing was posted
  // Downloading the media for an imported post failed before anything was sent.
  return err.stage === 'media';
}

async function publishDue(now = new Date()) {
  if (running) return; // don't overlap if a slow video upload is still going
  running = true;
  try {
    const due = db.prepare(`
      SELECT t.id AS target_id, t.account_id AS target_account, p.*, a.platform, a.external_id, a.access_token, a.name AS account_name, a.username AS account_username
      FROM post_targets t
      JOIN posts p ON p.id = t.post_id
      JOIN accounts a ON a.id = t.account_id
      WHERE t.status = 'scheduled' AND p.scheduled_at <= ? AND (t.retry_at IS NULL OR t.retry_at <= ?)
      ORDER BY p.scheduled_at`).all(now.toISOString(), now.toISOString());
    const results = [];
    const tiktokFull = new Map(); // account id -> TikTok's "come back later" error, for this run

    for (const row of due) {
      if (tiktokFull.has(row.target_account)) { // TikTok just said it's full: don't knock again this run
        holdTikTok(row, tiktokFull.get(row.target_account), now, false);
        continue;
      }
      db.prepare(`UPDATE post_targets SET status='publishing', error=NULL WHERE id=?`).run(row.target_id);
      const account = { platform: row.platform, external_id: row.external_id, access_token: row.access_token, username: row.account_username };
      try {
        if (row.media_source_url && !row.media_file) {
          row.media_file = await media.ensureMedia(row.id).catch((e) => { throw Object.assign(e, { stage: 'media' }); });
        }
        const res = await publishers[row.platform](account, row);
        db.prepare(`UPDATE post_targets SET status='published', external_post_id=?, permalink=?, published_at=?, retry_at=NULL WHERE id=?`)
          .run(res.id, res.permalink, new Date().toISOString(), row.target_id);
        console.log(`[publish] post ${row.id} -> ${row.platform} ${row.account_name}: ${res.id}`);
        results.push({ postId: row.id, caption: row.caption, platform: row.platform, account: row.account_name, ok: true, note: res.note || null });
      } catch (err) {
        const why = err.cause ? `${err.message} (${[err.cause.code, err.cause.message].filter(Boolean).join(': ')})` : String(err.message || err);
        const tries = db.prepare('SELECT attempts FROM post_targets WHERE id=?').get(row.target_id).attempts;
        if (row.platform === 'tiktok' && err.tiktokWait && tries < TIKTOK_MAX_WAITS) {
          tiktokFull.set(row.target_account, err);
          holdTikTok(row, err, now, true);
          continue;
        }
        if (row.platform !== 'youtube' && row.platform !== 'tiktok' && tries < RETRY_MINUTES.length && retryable(err, row.platform)) {
          const at = new Date(now.getTime() + RETRY_MINUTES[tries] * 60e3);
          db.prepare(`UPDATE post_targets SET status='scheduled', attempts=attempts+1, retry_at=?, error=? WHERE id=?`)
            .run(at.toISOString(), `Trying again at ${at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} (try ${tries + 2} of ${RETRY_MINUTES.length + 1}). Last error: ${why}`, row.target_id);
          console.error(`[publish] post ${row.id} -> ${row.platform} will retry in ${RETRY_MINUTES[tries]} min: ${err.message}`);
          continue; // no phone alert yet
        }
        db.prepare(`UPDATE post_targets SET status='failed', error=?, retry_at=NULL WHERE id=?`).run(tries ? `${why} (tried ${tries + 1} times)` : why, row.target_id);
        console.error(`[publish] post ${row.id} -> ${row.platform} failed: ${err.message}`);
        results.push({ postId: row.id, caption: row.caption, platform: row.platform, account: row.account_name, ok: false, error: String(err.message || err) });
      }
    }
    await notify.postResults(results);
  } finally {
    running = false;
  }
}

function holdTikTok(row, err, now, alert) {
  const tries = db.prepare('SELECT attempts FROM post_targets WHERE id=?').get(row.target_id).attempts;
  if (tries >= TIKTOK_MAX_WAITS) { // waited 3 days already: give up and show it as failed
    db.prepare(`UPDATE post_targets SET status='failed', error=?, retry_at=NULL WHERE id=?`)
      .run(`${err.message} (waited 3 days; clear the TikTok inbox, then click Retry)`, row.target_id);
    return;
  }
  const at = new Date(now.getTime() + TIKTOK_WAIT_HOURS * 3600e3);
  db.prepare(`UPDATE post_targets SET status='scheduled', attempts=attempts+1, retry_at=?, error=? WHERE id=?`)
    .run(at.toISOString(), `Waiting on TikTok. ${err.message} Viral Post will try again by itself ${whenText(at)}.`, row.target_id);
  console.error(`[publish] post ${row.id} -> tiktok waiting until ${at.toISOString()}: ${err.message}`);
  if (alert && tries === 0) {
    notify.send('TikTok inbox is full', `"${String(row.caption || '').slice(0, 60)}" is waiting.\n${err.message}\nViral Post will try again ${whenText(at)}.`,
      { priority: 'high', tags: 'point_right' }).catch(() => {});
  }
}

// Heads-up check: looks at the posts coming up in the next 3 hours and buzzes your phone early if
// one of them is going to fail (picture missing, Facebook/Instagram signed out), so there is time
// to fix it before it's due. Each problem is only reported once.
const warned = new Set();
async function headsUp(now = new Date()) {
  const soon = new Date(now.getTime() + 3 * 3600e3).toISOString();
  const rows = db.prepare(`
    SELECT t.id AS target_id, p.id AS post_id, p.caption, p.scheduled_at, p.media_file, p.media_source_url,
           a.id AS account_id, a.platform, a.access_token, a.name AS account_name
    FROM post_targets t JOIN posts p ON p.id = t.post_id JOIN accounts a ON a.id = t.account_id
    WHERE t.status = 'scheduled' AND p.scheduled_at <= ? ORDER BY p.scheduled_at`).all(soon);
  const tokenOk = new Map();
  const problems = [];
  for (const r of rows) {
    if (warned.has(r.target_id)) continue;
    let problem = null;
    if (r.media_file && !fs.existsSync(path.join(config.mediaDir, r.media_file))) problem = 'its picture/video file is missing';
    else if (!r.media_file && r.media_source_url) {
      try { await media.ensureMedia(r.post_id); } catch (e) { problem = `its picture/video couldn't be downloaded (${e.message})`; }
    }
    if (!problem && (r.platform === 'facebook' || r.platform === 'instagram')) {
      if (!tokenOk.has(r.account_id)) tokenOk.set(r.account_id, await meta.tokenWorks(r));
      if (!tokenOk.get(r.account_id).ok) problem = `${r.account_name} needs to be reconnected (Accounts page)`;
    }
    if (problem) {
      warned.add(r.target_id);
      const when = new Date(r.scheduled_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: process.env.BOOKING_TIMEZONE || 'America/New_York' });
      problems.push(`${when} ${r.platform} "${String(r.caption || '').slice(0, 40)}": ${problem}`);
    }
  }
  if (problems.length) {
    await notify.send('Heads up: fix before it posts', problems.join('\n'), { priority: 'high', tags: 'warning' }).catch(() => {});
  }
  return problems;
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
  cron.schedule('*/2 * * * *', () => media.prefetch().then(() => thumbs.warm(db)).catch((e) => console.error(e)));
  cron.schedule('7-59/15 * * * *', () => headsUp().catch((e) => console.error(e)));
  cron.schedule('17 */3 * * *', () => refreshStats().catch((e) => console.error(e)));
}

// Viral Touch CRM's background work (its own program on the Mac; see src/apps.js).
function startCrm() {
  // Contacts: one phone alert at 8am (Eastern unless BOOKING_TIMEZONE says otherwise) with today's appointments, tasks and follow-ups.
  cron.schedule('0 8 * * *', () => crm.sendFollowUpReminder().catch((e) => console.error(e)), { timezone: process.env.BOOKING_TIMEZONE || 'America/New_York' });
  // Website sign-ups (e.g. viralattraction.com) -> Contacts, every 2 minutes.
  cron.schedule('1-59/2 * * * *', () => website.check().catch((e) => console.error(e)));
  website.check().catch(() => {});
  // CRM automations: carry on the ones whose "wait" is over.
  cron.schedule('* * * * *', () => { try { automations.runWaiting(); } catch (e) { console.error(e); } });
  // Email campaigns: read opens/clicks from Brevo and mark anyone who unsubscribed as "Do not contact".
  cron.schedule('41 * * * *', () => campaigns.hourly().catch((e) => console.error(e)));
  // Campaigns sent from your own mailbox go out a few at a time (and pick up again after a restart).
  cron.schedule('* * * * *', () => campaigns.runMailboxCampaigns().catch((e) => console.error(e)));
  // Invoices paid online with Stripe get marked paid (checks every 10 minutes, no webhooks needed).
  cron.schedule('*/10 * * * *', () => require('../crm/server/invoices').checkPending().catch((e) => console.error(e)));
  // Monthly payments: ask Stripe for new payments, cancels and failed cards.
  cron.schedule('3,13,23,33,43,53 * * * *', () => require('../crm/server/plans').syncAll().catch((e) => console.error(e)));
  // One friendly reminder to people who started paying and stopped.
  cron.schedule('*/15 * * * *', () => require('../crm/server/checkouts').run().catch((e) => console.error(e)));
  // Conversations: new emails from people in the CRM, every 2 minutes.
  cron.schedule('*/2 * * * *', () => require('../crm/server/inbox').check().catch((e) => console.error(e)));
  // Conversations: new Facebook and Instagram messages on your connected Pages, every 2 minutes.
  cron.schedule('1-59/2 * * * *', () => require('../crm/server/social').check().catch((e) => console.error(e)));
  // Google Calendar bookings (the website's "Book a free call" page) -> Contacts + Appointments.
  cron.schedule('*/5 * * * *', () => gcal.check().catch((e) => console.error(e)));
  gcal.check().catch(() => {});
  // Appointment reminder emails (a set number of hours before), every 15 minutes.
  cron.schedule('3-59/15 * * * *', () => require('../crm/server/booking').sendReminders().catch((e) => console.error(e)));
  // Team tasks: at 7am each person gets one email with their tasks due today or late.
  cron.schedule('0 7 * * *', () => require('../crm/server/tasks').sendDaily().catch((e) => console.error(e)), { timezone: process.env.BOOKING_TIMEZONE || 'America/New_York' });
  // Monthly reports: on the 1st at 8am, last month's numbers go to each business that asked for them.
  cron.schedule('0 8 1 * *', () => require('../crm/server/reports').sendMonthly().catch((e) => console.error(e)), { timezone: process.env.BOOKING_TIMEZONE || 'America/New_York' });
}

module.exports = { start, startCrm, publishDue, refreshStats, headsUp };
