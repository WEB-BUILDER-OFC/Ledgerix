
// Handle SKIP_WAITING message from page — activates new SW immediately on deploy
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/**
 * Ledgerix - Service Worker
 * Offline-first PWA cache strategy.
 *
 * Strategy:
 *   - App shell (HTML, CSS, core JS) → Cache First
 *   - CDN resources (Chart.js, jsPDF, fonts) → Network First with cache fallback
 *   - Tesseract → NOT cached (lazy-loaded, too large, user-initiated)
 *
 * Stability priority: if anything fails, the app continues to work online.
 * Cache is best-effort and never breaks the application.
 */

'use strict';

const CACHE_NAME     = 'ledgerix-v2.11-shell';
const CDN_CACHE_NAME = 'ledgerix-v2.11-cdn';

// App shell — served from cache first
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/css/main.css',
  './assets/js/app.js',
  './config/app.config.js',
  './assets/js/core/state.js',
  './assets/js/core/storage.js',
  './assets/js/core/security.js',
  './assets/js/ui/navigation.js',
  './assets/js/ui/theme.js',
  './assets/js/ui/toast.js',
  './assets/js/utils/helpers.js',
  './assets/js/modules/dashboard.js',
  './assets/js/modules/invoice.js',
  './assets/js/modules/clients.js',
  './assets/js/modules/products.js',
  './assets/js/modules/notifications.js',
  './assets/js/modules/gst.js',
  './assets/js/modules/reports.js',
  './assets/js/modules/analytics.js',
  './assets/js/modules/pdf.js',
  './assets/js/modules/profile.js',
  './assets/js/modules/settings.js',
  './assets/js/modules/search.js',
  './assets/js/modules/backup.js',
  './assets/js/modules/ocr.js',
  './assets/js/modules/tabHandlers.js',
];

// CDN resources — network first, cache fallback
// Tesseract is intentionally excluded (lazy, large, user-initiated only)
const CDN_PREFETCH = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.1/jspdf.plugin.autotable.min.js',
  'https://cdn.jsdelivr.net/npm/qrcode.js@1.0.0/qrcode.min.js',
];

// ── Install: cache app shell ──────────────────────────────────────────────────

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Shell cache install error:', err))
  );
});

// ── Activate: clean up old caches ─────────────────────────────────────────────

self.addEventListener('activate', event => {
  const validCaches = new Set([CACHE_NAME, CDN_CACHE_NAME]);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !validCaches.has(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: cache strategy ─────────────────────────────────────────────────────

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Skip Tesseract — always fetch from network (user-initiated, large)
  if (url.href.includes('tesseract')) return;

  // CDN resources: network first, cache fallback
  if (url.origin !== self.location.origin) {
    event.respondWith(networkFirstCDN(request));
    return;
  }

  // App shell: cache first, network fallback
  event.respondWith(cacheFirstShell(request));
});

async function cacheFirstShell(request) {
  try {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Offline fallback for navigation requests
    if (request.mode === 'navigate') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }
    throw e;
  }
}

async function networkFirstCDN(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CDN_CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    const cached = await caches.match(request, { cacheName: CDN_CACHE_NAME });
    if (cached) return cached;
    throw e;
  }
}
