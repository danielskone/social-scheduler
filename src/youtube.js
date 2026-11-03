// YouTube: connect a channel with Google sign-in, upload videos, read stats.
// Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (run `npm run youtube-keys`).
// The account's access_token column holds the Google *refresh* token; short-lived
// access tokens are fetched from it when needed.
const fs = require('fs');
const path = require('path');
const config = require('./config');

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];
const apiBase = () => (process.env.GOOGLE_API_BASE || 'https://www.googleapis.com').replace(/\/$/, '');
const tokenUrl = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const clientId = () => process.env.GOOGLE_CLIENT_ID || '';
const clientSecret = () => process.env.GOOGLE_CLIENT_SECRET || '';

class YouTubeError extends Error {}

const configured = () => Boolean(clientId() && clientSecret());
const redirectUri = () => `${config.oauthBaseUrl}/auth/youtube/callback`;

function loginUrl(state) {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', clientId());
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES.join(' '));
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent select_account');
  u.searchParams.set('state', state);
  return u.toString();
}

function explain(data, status) {
  const e = data && data.error;
  const reason = e?.errors?.[0]?.reason || (typeof e === 'string' ? e : '');
  if (reason === 'invalid_grant') return 'YouTube sign-in has expired. Go to Accounts and click "Connect YouTube" again.';
  if (reason === 'quotaExceeded') return 'YouTube daily upload limit for this app reached. It resets at midnight Pacific time; use Retry tomorrow.';
  if (reason === 'uploadLimitExceeded') return 'This YouTube channel has hit its daily upload limit. Try again tomorrow.';
  return (e?.message || data?.error_description || reason || `HTTP ${status}`) + (reason && e?.message ? ` (${reason})` : '');
}

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new YouTubeError(explain(data, res.status));
  return data;
}

async function tokenRequest(params) {
  return json(await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), ...params }),
  }));
}

const cache = new Map(); // refresh token -> { token, exp }
async function accessToken(refreshToken) {
  const hit = cache.get(refreshToken);
  if (hit && hit.exp > Date.now() + 60e3) return hit.token;
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  cache.set(refreshToken, { token: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1000 });
  return t.access_token;
}

async function get(p, params, token) {
  const u = new URL(`${apiBase()}/youtube/v3/${p}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return json(await fetch(u, { headers: { Authorization: `Bearer ${token}` } }));
}

function channelToAccount(c, refreshToken) {
  return {
    platform: 'youtube',
    external_id: c.id,
    name: c.snippet?.title || 'YouTube channel',
    username: (c.snippet?.customUrl || '').replace(/^@/, '') || null,
    picture_url: c.snippet?.thumbnails?.default?.url || null,
    access_token: refreshToken,
  };
}

async function accountsFromCode(code) {
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });
  if (!t.refresh_token) throw new YouTubeError('Google did not return a sign-in key. Remove this app at myaccount.google.com/permissions and connect again.');
  cache.set(t.refresh_token, { token: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1000 });
  const ch = await get('channels', { part: 'snippet', mine: 'true' }, t.access_token);
  if (!ch.items?.length) throw new YouTubeError('That Google account has no YouTube channel. Pick the account (or brand account) that owns the channel.');
  return ch.items.map((c) => channelToAccount(c, t.refresh_token));
}

// Title: max 100 characters, no < or >. Defaults to the caption's first line without hashtags.
function titleFor(post) {
  let t = String(post.title || '').trim();
  if (!t) {
    const line = String(post.caption || '').split('\n').find((l) => l.replace(/#\w+/g, '').trim()) || '';
    t = line.replace(/#\w+/g, '').replace(/\s+/g, ' ').trim();
  }
  t = t.replace(/[<>]/g, '');
  if (t.length > 100) t = t.slice(0, 99).replace(/\s+\S*$/, '') + '…';
  return t || 'New video';
}

async function publishYouTube(account, post) {
  if (post.media_type !== 'video' || !post.media_file) throw new YouTubeError('YouTube posts need a video.');
  const token = await accessToken(account.access_token);
  const file = path.join(config.mediaDir, post.media_file);
  const buf = await fs.promises.readFile(file);
  const type = /\.mov$/i.test(file) ? 'video/quicktime' : 'video/mp4';
  const body = {
    snippet: { title: titleFor(post), description: String(post.caption || '').replace(/[<>]/g, '').slice(0, 5000), categoryId: '22' },
    status: { privacyStatus: process.env.YOUTUBE_PRIVACY || 'public', selfDeclaredMadeForKids: false },
  };
  const start = await fetch(`${apiBase()}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(buf.length),
      'X-Upload-Content-Type': type,
    },
    body: JSON.stringify(body),
  });
  if (!start.ok) await json(start);
  const session = start.headers.get('location');
  if (!session) throw new YouTubeError('YouTube did not accept the upload. Please retry.');
  const video = await json(await fetch(session, { method: 'PUT', headers: { 'Content-Type': type }, body: buf }));
  return { id: video.id, permalink: `https://www.youtube.com/watch?v=${video.id}` };
}

async function videoStats(account, videoId) {
  const d = await get('videos', { part: 'statistics', id: videoId }, await accessToken(account.access_token));
  const s = d.items?.[0]?.statistics || {};
  const n = (v) => (v === undefined ? null : Number(v));
  return { likes: n(s.likeCount), comments: n(s.commentCount), shares: null, views: n(s.viewCount) };
}

async function subscriberCount(account) {
  const d = await get('channels', { part: 'statistics', id: account.external_id }, await accessToken(account.access_token));
  const s = d.items?.[0]?.statistics;
  return s && !s.hiddenSubscriberCount ? Number(s.subscriberCount) : null;
}

module.exports = { configured, redirectUri, loginUrl, accountsFromCode, publishYouTube, videoStats, subscriberCount, titleFor, YouTubeError };
