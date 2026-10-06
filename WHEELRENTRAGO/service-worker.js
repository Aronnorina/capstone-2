// WheelRentraGo — Service Worker
// Minimal offline-first cache for the app shell.
//
// v2 — IMPORTANT FIX: v1 served app.js/HTML/CSS "cache-first", which meant
// that once a browser had cached them, code fixes shipped afterward were
// silently ignored (the browser kept running the OLD cached app.js forever,
// since the service worker file itself hadn't changed and so was never
// treated as "updated"). That is fixed here two ways:
//   1. CACHE_NAME is bumped (v1 -> v2) — changing this file's bytes forces
//      the browser to recognize a new SW version, install it, and drop the
//      old cache in `activate` below.
//   2. The fetch strategy for app logic (HTML/JS/CSS) is now NETWORK-FIRST,
//      not cache-first — the network response always wins when available,
//      and cache is only a fallback for true offline use. Only truly static
//      assets (icons) stay cache-first, since those essentially never change.

const CACHE_NAME = 'wrg-shell-v3';

const APP_SHELL = [
  'index.html',
  'fleet.html',
  'wallet.html',
  'account.html',
  'login.html',
  'recommend.html',
  'support.html',
  'tracking.html',
  'verification.html',
  'app.js',
  'style.build.css',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

// Only these are safe to serve cache-first — static images that don't
// change during active development.
const STATIC_ASSETS = ['icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-32.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) =>
        // addAll() is all-or-nothing — one missing/failed file (e.g. an
        // icon that wasn't dropped into the project yet) fails the WHOLE
        // install. Cache each resource independently instead, so a single
        // missing file just gets skipped instead of breaking everything.
        Promise.all(APP_SHELL.map((path) =>
          cache.add(path).catch((err) => console.warn('[SW] Skipped caching', path, err))
        ))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never intercept Supabase API calls — those must always hit the network.
  if (url.hostname.endsWith('supabase.co')) return;

  // Static, rarely-changing assets: cache-first is safe and fast.
  if (STATIC_ASSETS.some((path) => req.url.endsWith(path))) {
    event.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
    return;
  }

  // Everything else (HTML pages, app.js, CSS) — network-first, so code
  // fixes and content changes always show up immediately. Cache is only
  // a fallback when there's genuinely no network (offline use).
  event.respondWith(
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        // Keep the offline fallback cache reasonably fresh too.
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});

// ── Push notifications ──────────────────────────────────────────────────
// Fired when the send-push Edge Function delivers a message to this
// browser's subscription. The payload shape is set in send-push/index.ts:
// { title, body, type, relatedId }.
self.addEventListener('push', (event) => {
  let data = { title: 'WheelRentraGo', body: 'You have a new update.' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (err) {
    console.warn('[SW] push payload was not JSON', err);
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      data: { type: data.type, relatedId: data.relatedId }
    })
  );
});

// Route the notification click to a sensible page inside the app instead
// of just focusing whatever tab happens to be open.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const type = (event.notification.data && event.notification.data.type) || '';
  const target = type.startsWith('verification_') ? 'verification.html'
    : type.startsWith('booking_') ? 'bookings.html'
    : type.startsWith('review_') ? 'account.html'
    : 'dashboard.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.endsWith(target) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});