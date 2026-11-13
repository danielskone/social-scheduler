// "Paste a link" in Viral Clips: brings in a video from a link, but only in ways the platforms
// allow, so no account is ever put at risk:
//   1. A video Viral Post posted itself: the original file is already on this Mac.
//   2. Facebook: a video on one of your connected Pages, through Facebook's official Graph API.
//   3. Instagram: a video on one of your connected Instagram accounts, through the same official API.
// YouTube and TikTok have no official way for apps to download a video (not even your own), so
// for those the app shows the official download steps instead.
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const config = require('./config');
const db = require('./db');

const GRAPH = () => `${config.graphBase}/${config.graphVersion}`;

// Works out which platform a link is from and the video's id on it.
function parseLink(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.replace(/^(www|m|mobile|web|business)\./, '').toLowerCase();
  const p = url.pathname;
  let m;
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) {
    const id = host === 'youtu.be' ? p.slice(1, 12)
      : url.searchParams.get('v') || ((m = p.match(/^\/(?:shorts|live|embed|v)\/([\w-]{11})/)) && m[1]) || ((m = p.match(/^\/video\/([\w-]{11})/)) && m[1]);
    return { platform: 'youtube', id: /^[\w-]{11}$/.test(id || '') ? id : null, url: url.href };
  }
  if (/(^|\.)tiktok\.com$/.test(host)) {
    m = p.match(/\/video\/(\d+)/);
    return { platform: 'tiktok', id: m ? m[1] : null, url: url.href };
  }
  if (/(^|\.)instagram\.com$/.test(host)) {
    m = p.match(/^\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/([\w-]+)/);
    return { platform: 'instagram', id: m ? m[1] : null, url: url.href };
  }
  if (/(^|\.)facebook\.com$|^fb\.watch$|^fb\.com$/.test(host)) {
    const id = url.searchParams.get('v') || url.searchParams.get('video_id')
      || ((m = p.match(/\/(?:videos|reel|reels)\/(?:[\w.-]+\/)?(\d{6,})/)) && m[1]) || null;
    return { platform: 'facebook', id, url: url.href, short: !id && (host === 'fb.watch' || /^\/share\//.test(p)) };
  }
  return { platform: 'other', id: null, url: url.href };
}

// 1. Did Viral Post post this video? Then the original file is on this Mac.
function postedByUs(link) {
  if (!link.id) return null;
  const rows = db.prepare(`SELECT p.media_file, p.title, p.caption FROM post_targets t
      JOIN posts p ON p.id = t.post_id JOIN accounts a ON a.id = t.account_id
      WHERE a.platform = ? AND p.media_type = 'video' AND p.media_file IS NOT NULL
        AND (t.external_post_id = ? OR t.permalink LIKE ?)
      ORDER BY t.id DESC LIMIT 5`).all(link.platform, link.id, `%${link.id}%`);
  for (const r of rows) {
    const file = path.join(config.mediaDir, r.media_file);
    if (fs.existsSync(file)) return { kind: 'local', file, name: nameFrom(r.title || r.caption) };
  }
  return null;
}

async function graph(p, params) {
  const url = new URL(`${GRAPH()}/${p}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data;
}

// 2. Facebook: the video's file, if it's on one of your connected Pages.
async function fromFacebook(link) {
  const pages = db.prepare(`SELECT name, access_token FROM accounts WHERE platform='facebook'`).all();
  for (const page of pages) {
    try {
      const v = await graph(link.id, { fields: 'source,title,description', access_token: page.access_token });
      if (v.source) return { kind: 'remote', url: v.source, name: nameFrom(v.title || v.description), from: page.name };
    } catch { /* not this Page's video */ }
  }
  return null;
}

// 3. Instagram: looks through your connected accounts' posts for this one (newest first).
async function fromInstagram(link, { maxPages = 12 } = {}) {
  const accounts = db.prepare(`SELECT name, username, external_id, access_token FROM accounts WHERE platform='instagram'`).all();
  const wanted = `/${link.id}`;
  for (const a of accounts) {
    let after = null;
    try {
      for (let i = 0; i < maxPages; i++) {
        const page = await graph(`${a.external_id}/media`, { fields: 'id,media_type,media_url,permalink,caption', limit: '50', access_token: a.access_token, ...(after ? { after } : {}) });
        const hit = (page.data || []).find((m) => String(m.permalink || '').includes(wanted));
        if (hit) {
          if (hit.media_type !== 'VIDEO' || !hit.media_url) return { kind: 'notvideo' };
          return { kind: 'remote', url: hit.media_url, name: nameFrom(hit.caption), from: a.username ? `@${a.username}` : a.name };
        }
        after = page.paging?.cursors?.after;
        if (!page.paging?.next || !after) break;
      }
    } catch { /* try the next account */ }
  }
  return null;
}

function nameFrom(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > 60 ? `${s.slice(0, 59).replace(/\s+\S*$/, '')}…` : s;
}

const PLATFORM_NAMES = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };
const hasAccount = (platform) => Boolean(db.prepare('SELECT 1 FROM accounts WHERE platform=? LIMIT 1').get(platform));

// Finds the video for a link. Returns { kind: 'local'|'remote', ... } or { kind: 'none', why }.
async function findVideo(raw) {
  const link = parseLink(raw);
  if (!link) return { kind: 'none', platform: 'other', why: "That doesn't look like a web link. Copy the whole link, starting with https." };
  const name = PLATFORM_NAMES[link.platform];
  if (link.platform === 'other') return { kind: 'none', platform: 'other', why: 'Links from YouTube, TikTok, Instagram and Facebook can be used here. For other videos, use the file itself.' };
  if (link.platform === 'facebook' && link.short) {
    return { kind: 'none', platform: 'facebook', why: 'This is a short share link. Open it, then copy the full address from the top of the page (it has /videos/ or /reel/ in it) and paste that here.' };
  }
  if (!link.id) return { kind: 'none', platform: link.platform, why: `That ${name} link doesn't point to one video. Open the video itself and copy its link.` };

  const local = postedByUs(link);
  if (local) return { ...local, platform: link.platform };

  if (link.platform === 'facebook' || link.platform === 'instagram') {
    if (!hasAccount(link.platform)) return { kind: 'none', platform: link.platform, why: `Connect your ${name} account in Viral Post first, then try again. Videos can only be brought in from your own connected accounts.` };
    const found = link.platform === 'facebook' ? await fromFacebook(link) : await fromInstagram(link);
    if (found?.kind === 'notvideo') return { kind: 'none', platform: link.platform, why: 'That post is a photo, not a video.' };
    if (found) return { ...found, platform: link.platform };
    return { kind: 'none', platform: link.platform, why: `This video isn't on any of your connected ${name} accounts, so it can't be brought in. Only use videos you own or have permission to use.` };
  }
  // YouTube and TikTok: no official download for apps.
  return { kind: 'none', platform: link.platform, why: `${name} doesn't let apps download videos, not even your own, so Viral Clips can't fetch it without breaking ${name}'s rules. Here's the official way to get your file:` };
}

// Saves the video into dest. onProgress(fraction) while downloading.
async function saveVideo(found, dest, onProgress = () => {}) {
  if (found.kind === 'local') {
    try { fs.linkSync(found.file, dest); } catch { fs.copyFileSync(found.file, dest); }
    return;
  }
  const res = await fetch(found.url);
  if (!res.ok || !res.body) throw new Error(`Couldn't get the video from ${PLATFORM_NAMES[found.platform] || 'the link'} (HTTP ${res.status}). Try again in a minute.`);
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0, last = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    got += chunk.length;
    if (total && Date.now() - last > 1000) { last = Date.now(); onProgress(got / total); }
  });
  const tmp = `${dest}.part`;
  await pipeline(body, fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
}

module.exports = { parseLink, findVideo, saveVideo };
