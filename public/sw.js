// Keeps Viral Post usable on the phone with a weak signal: the app's own files always come
// fresh from the Mac (so updates show on the first load), with the saved copy as a fallback; previews are kept; data always comes fresh from the Mac
// (or, if the signal is gone, the last copy is shown).
const SHELL = 'vp-shell-v2';
const PICS = 'vp-pics-v1';
const SHELL_FILES = ['/', '/app.js', '/style.css', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, PICS].includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const good = (res) => res && res.ok && !res.redirected && res.type === 'basic';

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/login') || url.pathname.startsWith('/media/')) return;

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
      if (good(res)) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
      return res;
    }).catch(async () => (await caches.match(req)) || Response.error()));
    return;
  }

  // App files: fresh from the Mac so updates show right away; the saved copy if there's no signal.
  const key = req.mode === 'navigate' && url.pathname === '/' ? '/' : req;
  e.respondWith(fetch(req).then((res) => {
    if (good(res)) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(key, copy)); }
    return res;
  }).catch(async () => (await caches.match(key)) || (req.mode === 'navigate' && !url.pathname.startsWith('/f/') && !url.pathname.startsWith('/book/') && (await caches.match('/'))) || Response.error()));
});
