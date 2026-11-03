// TikTok: connect an account, send scheduled videos, read stats.
// Needs TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET (run `npm run tiktok-keys`).
//
// Two ways to post (TIKTOK_MODE):
//   draft  (default) the video is sent to your TikTok inbox at the scheduled time; TikTok
//          notifies you and you tap Post. Works right away, and posts can be public.
//   direct the video is posted by itself. TikTok keeps these PRIVATE until the app
//          passes TikTok's audit, so switch to this only after the audit.
//
// TikTok only allows https sign-in return addresses, so sign-in comes back through a tiny
// page on GitHub Pages (docs/tiktok-callback.html) that forwards to http://localhost:3000.
// The account's access_token column holds JSON: { refresh, access, exp, username }.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');

const SCOPES = ['user.info.basic', 'user.info.stats', 'video.upload', 'video.publish', 'video.list'];
const apiBase = () => (process.env.TIKTOK_API_BASE || 'https://open.tiktokapis.com').replace(/\/$/, '');
const clientKey = () => process.env.TIKTOK_CLIENT_KEY || '';
const clientSecret = () => process.env.TIKTOK_CLIENT_SECRET || '';
const mode = () => (process.env.TIKTOK_MODE === 'direct' ? 'direct' : 'draft');
const redirectUri = () => process.env.TIKTOK_REDIRECT_URI || 'https://danielskone.github.io/social-scheduler/tiktok-callback.html';
const configured = () => Boolean(clientKey() && clientSecret());

class TikTokError extends Error {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loginUrl(state) {
  const u = new URL('https://www.tiktok.com/v2/auth/authorize/');
  u.searchParams.set('client_key', clientKey());
  u.searchParams.set('scope', SCOPES.join(','));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('state', state);
  return u.toString();
}

function explain(data, status) {
  const e = data?.error;
  const code = typeof e === 'string' ? e : e?.code;
  if (code === 'invalid_grant' || code === 'access_token_invalid') return 'TikTok sign-in has expired. Go to Accounts and click "Connect TikTok" again.';
  if (code === 'spam_risk_too_many_posts') return 'TikTok says this account has posted too much today. Retry tomorrow.';
  if (code === 'unaudited_client_can_only_post_to_private_accounts') return 'TikTok only lets unreviewed apps post to PRIVATE accounts. Use draft mode (the default) or make the TikTok account private.';
  if (code === 'scope_not_authorized') return 'TikTok permission missing. In the TikTok developer site, add the scopes from the setup guide, then Connect TikTok again.';
  return [typeof e === 'object' ? e?.message : data?.error_description, code].filter(Boolean).join(' ') || `HTTP ${status}`;
}

async function json(res) {
  const raw = await res.text().catch(() => '');
  let data = {};
  try { data = JSON.parse(raw); } catch { /* keep {} */ }
  Object.defineProperty(data, 'raw', { value: raw }); // video ids are too big for JS numbers
  const err = data.error;
  if (!res.ok || (typeof err === 'string' && err) || (err && err.code && err.code !== 'ok')) throw new TikTokError(explain(data, res.status));
  return data;
}

async function tokenRequest(params) {
  return json(await fetch(`${apiBase()}/v2/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: clientKey(), client_secret: clientSecret(), ...params }),
  }));
}

const readTok = (account) => { try { return JSON.parse(account.access_token); } catch { return { refresh: account.access_token }; } };

// Access tokens last a day; refresh tokens a year, and TikTok may hand out a new one.
async function accessToken(account) {
  const t = readTok(account);
  if (t.access && t.exp > Date.now() + 120e3) return t.access;
  const r = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh });
  const next = { ...t, refresh: r.refresh_token || t.refresh, access: r.access_token, exp: Date.now() + (r.expires_in || 86400) * 1000 };
  account.access_token = JSON.stringify(next);
  db.prepare("UPDATE accounts SET access_token=? WHERE platform='tiktok' AND external_id=?").run(account.access_token, account.external_id);
  return next.access;
}

async function call(method, p, token, body) {
  return json(await fetch(`${apiBase()}${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }));
}

async function accountsFromCode(code) {
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });
  const info = await call('GET', '/v2/user/info/?fields=open_id,display_name,avatar_url', t.access_token);
  const u = info.data?.user || {};
  let username = null;
  try { // needs the user.info.profile scope; fine if missing
    username = (await call('GET', '/v2/user/info/?fields=username', t.access_token)).data?.user?.username || null;
  } catch { /* optional */ }
  return [{
    platform: 'tiktok',
    external_id: t.open_id || u.open_id,
    name: u.display_name || username || 'TikTok account',
    username,
    picture_url: u.avatar_url || null,
    access_token: JSON.stringify({ refresh: t.refresh_token, access: t.access_token, exp: Date.now() + (t.expires_in || 86400) * 1000 }),
  }];
}

// Chunks: 5–64 MB each (last one may be bigger, up to 128 MB); small files go in one piece.
function chunking(size) {
  const MB = 1024 * 1024;
  if (size <= 64 * MB) return { chunkSize: size, count: 1 };
  const chunkSize = 10 * MB;
  return { chunkSize, count: Math.floor(size / chunkSize) };
}

async function publishTikTok(account, post, { pollMs = 5000, maxPolls = 60 } = {}) {
  if (post.media_type !== 'video' || !post.media_file) throw new TikTokError('TikTok posts need a video.');
  const token = await accessToken(account);
  const file = path.join(config.mediaDir, post.media_file);
  const buf = await fs.promises.readFile(file);
  const type = /\.mov$/i.test(file) ? 'video/quicktime' : 'video/mp4';
  const { chunkSize, count } = chunking(buf.length);
  const source_info = { source: 'FILE_UPLOAD', video_size: buf.length, chunk_size: chunkSize, total_chunk_count: count };

  let init;
  const direct = mode() === 'direct';
  if (direct) {
    const creator = (await call('POST', '/v2/post/publish/creator_info/query/', token, {})).data || {};
    const opts = creator.privacy_level_options || [];
    const wanted = process.env.TIKTOK_PRIVACY || 'PUBLIC_TO_EVERYONE';
    const privacy = opts.includes(wanted) ? wanted : (opts.includes('SELF_ONLY') ? 'SELF_ONLY' : opts[0] || 'SELF_ONLY');
    init = await call('POST', '/v2/post/publish/video/init/', token, {
      post_info: { title: String(post.caption || '').slice(0, 2200), privacy_level: privacy, disable_comment: false, disable_duet: false, disable_stitch: false },
      source_info,
    });
  } else {
    init = await call('POST', '/v2/post/publish/inbox/video/init/', token, { source_info });
  }
  const { publish_id: publishId, upload_url: uploadUrl } = init.data || {};
  if (!publishId || !uploadUrl) throw new TikTokError('TikTok did not accept the upload. Please retry.');

  for (let i = 0; i < count; i++) {
    const start = i * chunkSize;
    const end = i === count - 1 ? buf.length : start + chunkSize;
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end - 1}/${buf.length}` },
      body: buf.subarray(start, end),
    });
    if (!res.ok) throw new TikTokError(`TikTok upload failed (HTTP ${res.status}). Please retry.`);
  }

  for (let i = 0; i < maxPolls; i++) {
    const resp = await call('POST', '/v2/post/publish/status/fetch/', token, { publish_id: publishId });
    const s = resp.data || {};
    if (s.status === 'FAILED') throw new TikTokError(`TikTok couldn't post it: ${s.fail_reason || 'unknown reason'}`);
    if (!direct && s.status === 'SEND_TO_USER_INBOX') {
      // Inbox uploads don't carry a caption, so the alert includes it to copy and paste.
      const caption = String(post.caption || '').trim();
      return { id: publishId, permalink: null, note: `TikTok: open the TikTok app and tap the notification to finish posting.${caption ? `\nCaption to copy:\n${caption.slice(0, 2200)}` : ''}` };
    }
    if (direct && s.status === 'PUBLISH_COMPLETE') {
      const vid = (resp.raw.match(/publicl?a?l?y_available_post_id"\s*:\s*\[\s*"?(\d+)/) || [])[1];
      const user = readTok(account).username || account.username;
      return {
        id: vid ? String(vid) : publishId,
        permalink: vid && user ? `https://www.tiktok.com/@${user}/video/${vid}` : null,
        note: vid ? null : 'Posted as private (TikTok keeps posts private until the app is approved).',
      };
    }
    await sleep(pollMs);
  }
  throw new TikTokError('TikTok is still processing the video. Check the TikTok app before retrying, so it is not posted twice.');
}

async function videoStats(account, videoId) {
  if (!/^\d+$/.test(String(videoId))) return { likes: null, comments: null, shares: null, views: null }; // drafts have no public id
  const d = await call('POST', '/v2/video/query/?fields=id,like_count,comment_count,share_count,view_count', await accessToken(account), { filters: { video_ids: [String(videoId)] } });
  const v = d.data?.videos?.[0] || {};
  return { likes: v.like_count ?? null, comments: v.comment_count ?? null, shares: v.share_count ?? null, views: v.view_count ?? null };
}

async function followerCount(account) {
  const d = await call('GET', '/v2/user/info/?fields=follower_count', await accessToken(account));
  return d.data?.user?.follower_count ?? null;
}

module.exports = { configured, mode, redirectUri, loginUrl, accountsFromCode, publishTikTok, videoStats, followerCount, chunking, TikTokError };
