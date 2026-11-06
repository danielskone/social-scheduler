// Makes Viral Post open instantly on the phone: the app's own files are kept on the phone
// and refreshed in the background; previews are kept; data always comes fresh from the Mac
// (or, if the signal is gone, the last copy is shown).
const SHELL = 'vp-shell-v1';
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

  // App files: show the saved copy right away, update it in the background.
  const key = req.mode === 'navigate' ? '/' : req;
  e.respondWith(caches.open(SHELL).then(async (c) => {
    const hit = await c.match(key);
    const update = fetch(req).then((res) => { if (good(res)) c.put(key, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(update); return hit; }
    return (await update) || Response.error();
  }));
});
