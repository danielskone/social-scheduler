// Thin client for the Meta Graph API: login, Facebook Page posts, Instagram posts, stats.
const fs = require('fs');
const path = require('path');
const config = require('./config');

const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'read_insights',
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_insights',
  'business_management',
  // Read the comments on your own posts and who wrote them (Analytics). Needs a reconnect.
  'pages_read_user_content',
  'instagram_manage_comments',
];

// safeToRetry = Facebook/Instagram answered with an error, so nothing was posted and trying
// again can't make a double post. Errors about sign-in or permissions never fix themselves.
class GraphError extends Error {
  constructor(message, { code, transient, safeToRetry = true } = {}) {
    super(message);
    this.code = code;
    this.transient = Boolean(transient);
    this.safeToRetry = safeToRetry && !(code === 190 || code === 10 || code === 368 || (code >= 200 && code < 300));
  }
}

function graphUrl(p, base = config.graphBase) {
  return `${base}/${config.graphVersion}/${p.replace(/^\//, '')}`;
}

async function call(method, p, params = {}, { base, body } = {}) {
  const url = new URL(graphUrl(p, base));
  let init = { method };
  if (method === 'GET') {
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  } else if (body) {
    init.body = body; // FormData
  } else {
    init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    init.body = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined));
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    // No answer at all: for a POST we can't be sure whether it went through, so never auto-retry it.
    throw Object.assign(new GraphError(`Could not reach Facebook: ${e.message}`, { safeToRetry: method === 'GET' }), { cause: e.cause });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data.error ? `${data.error.message} (code ${data.error.code})` : `HTTP ${res.status}`;
    throw new GraphError(msg, { code: data.error && data.error.code, transient: data.error && data.error.is_transient });
  }
  return data;
}

// ---------- Login ----------

function redirectUri() {
  return `${config.oauthBaseUrl}/auth/facebook/callback`;
}

function loginUrl(state) {
  const u = new URL(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`);
  u.searchParams.set('client_id', config.metaAppId);
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('state', state);
  if (config.metaLoginConfigId) u.searchParams.set('config_id', config.metaLoginConfigId);
  else u.searchParams.set('scope', SCOPES.join(','));
  u.searchParams.set('response_type', 'code');
  return u.toString();
}

// Exchanges the login code for a long-lived user token, then returns every Page
// (with its never-expiring Page token) and any Instagram account linked to it.
async function connectedAccountsFromCode(code) {
  const short = await call('GET', 'oauth/access_token', {
    client_id: config.metaAppId,
    client_secret: config.metaAppSecret,
    redirect_uri: redirectUri(),
    code,
  });
  const long = await call('GET', 'oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: config.metaAppId,
    client_secret: config.metaAppSecret,
    fb_exchange_token: short.access_token,
  });
  return accountsForUserToken(long.access_token);
}

const PAGE_FIELDS = 'id,name,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}';

// Pages that live in a business portfolio (which linking Instagram can cause) may
// be missing from me/accounts, so also look them up through the user's businesses.
async function listPages(userToken) {
  const byId = new Map();
  const pages = await call('GET', 'me/accounts', { access_token: userToken, fields: PAGE_FIELDS, limit: 100 });
  for (const p of pages.data || []) byId.set(p.id, p);
  try {
    const biz = await call('GET', 'me/businesses', {
      access_token: userToken,
      fields: `owned_pages.limit(100){${PAGE_FIELDS}},client_pages.limit(100){${PAGE_FIELDS}}`,
      limit: 50,
    });
    for (const b of biz.data || []) {
      for (const p of [...(b.owned_pages?.data || []), ...(b.client_pages?.data || [])]) {
        if (!byId.has(p.id) && p.access_token) byId.set(p.id, p);
      }
    }
  } catch { /* no business access; me/accounts is enough */ }
  return [...byId.values()];
}

async function accountsForUserToken(userToken) {
  const out = [];
  for (const p of await listPages(userToken)) {
    out.push({
      platform: 'facebook',
      external_id: p.id,
      name: p.name,
      username: null,
      picture_url: p.picture?.data?.url || null,
      access_token: p.access_token,
    });
    const ig = p.instagram_business_account;
    if (ig) {
      out.push({
        platform: 'instagram',
        external_id: ig.id,
        name: ig.name || ig.username,
        username: ig.username,
        picture_url: ig.profile_picture_url || null,
        // Instagram calls are made with the linked Page's token.
        access_token: p.access_token,
      });
    }
  }
  return out;
}

// ---------- Publishing ----------

function mediaPublicUrl(file) {
  return `${config.publicBaseUrl}/media/${encodeURIComponent(file)}`;
}

async function fileBlob(file) {
  const buf = await fs.promises.readFile(path.join(config.mediaDir, file));
  return new Blob([buf]);
}

async function publishFacebook(account, post) {
  const token = account.access_token;
  let result;
  if (!post.media_file) {
    result = await call('POST', `${account.external_id}/feed`, { message: post.caption, access_token: token });
  } else if (post.media_type === 'image') {
    const form = new FormData();
    form.set('access_token', token);
    form.set('caption', post.caption);
    form.set('source', await fileBlob(post.media_file), post.media_file);
    result = await call('POST', `${account.external_id}/photos`, {}, { body: form });
  } else {
    const form = new FormData();
    form.set('access_token', token);
    form.set('description', post.caption);
    form.set('source', await fileBlob(post.media_file), post.media_file);
    result = await call('POST', `${account.external_id}/videos`, {}, { body: form, base: config.graphVideoBase });
  }
  const id = result.post_id || result.id;
  let permalink = null;
  try {
    permalink = (await call('GET', id, { fields: 'permalink_url', access_token: token })).permalink_url || null;
    // Reels come back as "/reel/123/" without the site; make it a full link.
    if (permalink && permalink.startsWith('/')) permalink = `https://www.facebook.com${permalink}`;
  } catch { /* video posts may not expose this right away */ }
  return { id, permalink };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reachable(url) {
  if (process.env.SKIP_MEDIA_CHECK) return true;
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
    return res.ok;
  } catch { return false; }
}

// Instagram can't take a file upload for photos: it downloads them from a link. The Mac's own
// public link (a quick tunnel) is what made posts fail with "unknown error (code 1)", so instead
// the photo is first uploaded to the linked Facebook Page as a hidden, unpublished photo (it never
// shows on the Page), and Instagram downloads it from Facebook's servers. It's removed afterwards.
async function hostOnFacebook(token, file) {
  const page = await call('GET', 'me', { fields: 'id', access_token: token });
  const form = new FormData();
  form.set('access_token', token);
  form.set('published', 'false');
  form.set('source', await fileBlob(file), file);
  const photo = await call('POST', `${page.id}/photos`, {}, { body: form });
  const info = await call('GET', photo.id, { fields: 'images', access_token: token });
  const best = (info.images || []).slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  if (!best || !best.source) throw new GraphError('Facebook did not return a link for the uploaded photo.');
  return { url: best.source, remove: () => call('DELETE', photo.id, { access_token: token }).catch(() => {}) };
}

// Videos are sent straight to Instagram ("resumable upload"), so nothing has to be downloaded
// from this Mac either.
async function uploadReel(account, post) {
  const token = account.access_token;
  const container = await call('POST', `${account.external_id}/media`, { media_type: 'REELS', upload_type: 'resumable', caption: post.caption, access_token: token });
  const buf = await fs.promises.readFile(path.join(config.mediaDir, post.media_file));
  const uri = container.uri || `${config.igUploadBase}/ig-api-upload/${config.graphVersion}/${container.id}`;
  let res;
  try {
    res = await fetch(uri, { method: 'POST', headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(buf.length) }, body: buf });
  } catch (e) {
    throw new GraphError(`Could not send the video to Instagram: ${e.message}`); // nothing is posted until media_publish
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error || data.success === false) {
    const err = data.error || data.debug_info || {};
    throw new GraphError(`Instagram didn't accept the video upload: ${err.message || `HTTP ${res.status}`}`, { code: err.code });
  }
  return container;
}

async function publishInstagram(account, post, { pollMs = 5000, maxPolls = 60 } = {}) {
  if (!post.media_file) throw new GraphError('Instagram posts need a photo or video.');
  const token = account.access_token;
  let container, hosted = null;

  if (post.media_type === 'image') {
    let imageUrl;
    try {
      hosted = await hostOnFacebook(token, post.media_file);
      imageUrl = hosted.url;
    } catch (e) {
      // Fall back to the Mac's public link.
      console.error(`[instagram] couldn't stage the photo on Facebook (${e.message}); using this Mac's link instead`);
      imageUrl = await macLink(post.media_file);
    }
    container = await call('POST', `${account.external_id}/media`, { caption: post.caption, image_url: imageUrl, access_token: token });
  } else {
    try {
      container = await uploadReel(account, post);
    } catch (e) {
      if (e.code === 190 || e.code === 10 || (e.code >= 200 && e.code < 300)) throw e;
      console.error(`[instagram] direct video upload failed (${e.message}); using this Mac's link instead`);
      container = await call('POST', `${account.external_id}/media`, { caption: post.caption, media_type: 'REELS', video_url: await macLink(post.media_file), access_token: token });
    }
  }

  try {
    // Media has to finish processing on Instagram's side before it can be published.
    for (let i = 0; i < maxPolls; i++) {
      const s = await call('GET', container.id, { fields: 'status_code,status', access_token: token });
      if (s.status_code === 'FINISHED') break;
      if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') {
        throw new GraphError(`Instagram couldn't process the media: ${s.status || s.status_code}`);
      }
      if (i === maxPolls - 1) throw new GraphError('Timed out waiting for Instagram to process the media.');
      await sleep(pollMs);
    }
    const published = await call('POST', `${account.external_id}/media_publish`, { creation_id: container.id, access_token: token });
    let permalink = null;
    try {
      permalink = (await call('GET', published.id, { fields: 'permalink', access_token: token })).permalink || null;
    } catch { /* not critical */ }
    return { id: published.id, permalink };
  } finally {
    if (hosted) await hosted.remove();
  }
}

// The old way: Instagram downloads the file from this Mac's public link.
async function macLink(file) {
  if (!/^https:\/\//.test(config.publicBaseUrl)) {
    throw new GraphError('Instagram needs PUBLIC_BASE_URL to be a public https address so it can download your media.');
  }
  const url = mediaPublicUrl(file);
  if (!(await reachable(url))) {
    throw new GraphError("Instagram can't reach your Mac's public link right now, so it couldn't download the media. Will try again.");
  }
  return url;
}

// Quick check that a Facebook/Instagram connection still works (used for the heads-up check).
async function tokenWorks(account) {
  try {
    await call('GET', 'me', { fields: 'id', access_token: account.access_token });
    return { ok: true };
  } catch (e) {
    // Only a clear "signed out / no permission" answer counts; a network blip isn't a problem.
    return { ok: !(e.code === 190 || e.code === 10 || (e.code >= 200 && e.code < 300)), error: e.message };
  }
}

// ---------- Stats ----------

async function facebookPostStats(account, postId) {
  // Regular posts have reactions; reels/videos only have likes. Comments need an extra
  // permission on some Pages, so fall back to fewer fields instead of failing.
  const attempts = [
    'reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares',
    'reactions.summary(total_count).limit(0),shares',
    'likes.summary(true).limit(0),comments.summary(true).limit(0)',
    'likes.summary(true).limit(0)',
  ];
  let lastErr;
  for (const fields of attempts) {
    try {
      const d = await call('GET', postId, { fields, access_token: account.access_token });
      return {
        likes: (d.reactions || d.likes)?.summary?.total_count ?? null,
        comments: d.comments?.summary?.total_count ?? null,
        shares: d.shares?.count ?? (fields.includes('shares') ? 0 : null),
        views: await facebookViews(account, postId),
      };
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

// Facebook renamed its "how many people saw it" numbers over the years. Try the current name
// first and remember which one this Page answers to. Never fails: no number is just null.
const FB_VIEW_METRICS = ['post_media_view', 'post_video_views', 'post_impressions'];
let fbViewMetric = null;
async function facebookViews(account, postId) {
  const list = fbViewMetric ? [fbViewMetric, ...FB_VIEW_METRICS.filter((m) => m !== fbViewMetric)] : FB_VIEW_METRICS;
  for (const metric of list) {
    try {
      const ins = await call('GET', `${postId}/insights`, { metric, access_token: account.access_token });
      const row = ins.data?.[0];
      const v = row?.values?.[0]?.value ?? row?.total_value?.value;
      if (typeof v === 'number') { fbViewMetric = metric; return v; }
    } catch { /* this metric isn't available for this post type */ }
  }
  return null;
}

// ---------- Comments (who commented and what they said) ----------

const COMMENT_LIMIT = 50;
const noPermission = (e) => e && (e.code === 10 || (e.code >= 200 && e.code < 300));

async function facebookComments(account, postId) {
  // Facebook only shares a commenter's name with apps allowed to read Page user content;
  // without it the comments still come back, just unnamed.
  const base = 'id,message,created_time,like_count,comment_count,attachment{type,media{image{src}}}';
  const shape = (c) => ({
    id: c.id,
    name: c.from?.name || null,
    picture: c.from?.picture?.data?.url || null,
    text: c.message || (c.attachment ? '(photo or sticker)' : ''),
    time: c.created_time,
    likes: c.like_count ?? 0,
    replies: (c.comments?.data || []).map(shape),
  });
  let lastErr;
  for (const fields of [`${base},from{id,name,picture},comments.limit(10){id,message,created_time,like_count,from{id,name,picture}}`, base]) {
    try {
      const d = await call('GET', `${postId}/comments`, { fields, filter: 'toplevel', order: 'reverse_chronological', limit: COMMENT_LIMIT, access_token: account.access_token });
      const comments = (d.data || []).map(shape);
      return { comments, namesHidden: comments.length > 0 && comments.every((c) => !c.name), more: Boolean(d.paging?.next) };
    } catch (e) { lastErr = e; }
  }
  if (noPermission(lastErr)) return { comments: [], needsReconnect: true };
  throw lastErr;
}

async function instagramComments(account, mediaId) {
  try {
    const d = await call('GET', `${mediaId}/comments`, {
      fields: 'id,text,username,timestamp,like_count,replies{id,text,username,timestamp,like_count}',
      limit: COMMENT_LIMIT, access_token: account.access_token,
    });
    const shape = (c) => ({ id: c.id, name: c.username ? `@${c.username}` : null, username: c.username || null, text: c.text || '', time: c.timestamp, likes: c.like_count ?? 0, replies: (c.replies?.data || []).map(shape) });
    // Instagram lists oldest first; newest first is easier to read.
    const comments = (d.data || []).map(shape).sort((a, b) => String(b.time).localeCompare(String(a.time)));
    return { comments, more: Boolean(d.paging?.next) };
  } catch (e) {
    if (noPermission(e)) return { comments: [], needsReconnect: true };
    throw e;
  }
}

async function instagramPostStats(account, mediaId) {
  const d = await call('GET', mediaId, { fields: 'like_count,comments_count', access_token: account.access_token });
  let views = null;
  try {
    const ins = await call('GET', `${mediaId}/insights`, { metric: 'views', access_token: account.access_token });
    views = ins.data?.[0]?.values?.[0]?.value ?? ins.data?.[0]?.total_value?.value ?? null;
  } catch { /* insights aren't available for every media type */ }
  return { likes: d.like_count ?? null, comments: d.comments_count ?? null, shares: null, views };
}

async function followerCount(account) {
  const d = await call('GET', account.external_id, { fields: 'followers_count', access_token: account.access_token });
  return d.followers_count ?? null;
}

module.exports = {
  SCOPES,
  GraphError,
  loginUrl,
  redirectUri,
  connectedAccountsFromCode,
  accountsForUserToken,
  publishFacebook,
  publishInstagram,
  tokenWorks,
  facebookPostStats,
  instagramPostStats,
  facebookComments,
  instagramComments,
  followerCount,
};
