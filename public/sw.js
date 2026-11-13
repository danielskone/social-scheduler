// Keeps Viral Post quick and usable on the phone with a weak signal: the page itself always comes
// fresh from the Mac (so updates show on the first load), with the saved copy as a fallback; previews are kept; data always comes fresh from the Mac
// (or, if the signal is gone, the last copy is shown).
const SHELL = 'vp-shell-v3';
const PICS = 'vp-pics-v1';
const DATA = 'vp-data-v1';
const SHELL_FILES = ['/', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, PICS, DATA].includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const good = (res) => res && res.ok && !res.redirected && res.type === 'basic';

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/login') || url.pathname.startsWith('/media/') || url.pathname.startsWith('/clipfile/')) return;

  // Previews never change: keep them.
  if (url.pathname.startsWith('/thumb/')) {
    e.respondWith(caches.open(PICS).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (good(res)) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // Data: fresh from the Mac; the last copy if there's no signal.
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(req).then((res) => {
      if (good(res)) {
        const copy = res.clone();
        caches.open(DATA).then(async (c) => {
          await c.put(req, copy);
          const keys = await c.keys(); // keep only the latest 60 answers, so the saved copy stays small
          keys.slice(0, Math.max(0, keys.length - 60)).forEach((k) => c.delete(k));
        });
      }
      return res;
    }).catch(async () => (await caches.match(req)) || Response.error()));
    return;
  }

  // App files named with a fingerprint (app.js?v=1a2b3c) never change: use the saved copy, which
  // opens instantly. An update gives them a new fingerprint, so the new version is fetched.
  if (url.searchParams.has('v')) {
    e.respondWith(caches.open(SHELL).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (good(res)) {
        c.put(req, res.clone());
        // Forget older versions of the same file.
        (await c.keys()).filter((k) => { const u = new URL(k.url); return u.pathname === url.pathname && u.search !== url.search; }).forEach((k) => c.delete(k));
      }
      return res;
    }));
    return;
  }

  // App files: fresh from the Mac so updates show right away; the saved copy if there's no signal.
  const key = req.mode === 'navigate' && url.pathname === '/' ? '/' : req;
  e.respondWith(fetch(req).then((res) => {
    if (good(res)) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(key, copy)); }
    return res;
  }).catch(async () => (await caches.match(key)) || (req.mode === 'navigate' && !url.pathname.startsWith('/f/') && !url.pathname.startsWith('/book/') && (await caches.match('/'))) || Response.error()));
});
