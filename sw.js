// ============================================================
// AURIS360 Service Worker — PWA offline support
// Cache-first for static assets, network-first for API calls
// ============================================================

const CACHE_NAME = 'auris360-v14';
const STATIC_CACHE = 'auris360-static-v14';
const API_CACHE = 'auris360-api-v14';

// Assets to cache on install (app shell)
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/safety-engagement.css',
  '/safety-engagement.js',
  '/bbs-observations.css',
  '/bbs-observations.js',
  '/noise-management.css',
  '/noise-management-map-config.css',
  '/noise-management.js',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css',
];

// ── Install: pre-cache the app shell ────────────────────────────────────────
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache) {
      return cache.addAll([
        '/',
        '/index.html',
        '/safety-engagement.css',
        '/safety-engagement.js',
        '/bbs-observations.css',
        '/bbs-observations.js',
        '/noise-management.css',
        '/noise-management-map-config.css',
        '/noise-management.js',
      ]).catch(function(err) {
        console.warn('AURIS360 SW: Pre-cache partial failure', err);
      });
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// ── Activate: clean up old caches ────────────────────────────────────────────
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          return key !== STATIC_CACHE && key !== API_CACHE;
        }).map(function(key) {
          console.log('AURIS360 SW: Deleting old cache', key);
          return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── Fetch: smart caching strategy ───────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // Never cache: Supabase API calls, Anthropic API calls, auth requests
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('anthropic.com') ||
      url.pathname.includes('/auth/') ||
      event.request.method !== 'GET') {
    return; // Let it go to network normally
  }

  // CDN assets (Tabler icons, Chart.js etc.) — cache first, long TTL
  if (url.hostname.includes('cdn.jsdelivr.net') ||
      url.hostname.includes('cdnjs.cloudflare.com') ||
      url.hostname.includes('unpkg.com')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(function(cache) {
        return cache.match(event.request).then(function(cached) {
          if (cached) return cached;
          return fetch(event.request).then(function(response) {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          }).catch(function() {
            return new Response('Offline', { status: 503 });
          });
        });
      })
    );
    return;
  }

  // index.html — network first, fall back to cache
  if (url.origin === self.location.origin &&
      (url.pathname === '/safety-engagement.css' || url.pathname === '/safety-engagement.js' ||
       url.pathname === '/bbs-observations.css' || url.pathname === '/bbs-observations.js' ||
       url.pathname === '/noise-management.css' || url.pathname === '/noise-management-map-config.css' || url.pathname === '/noise-management.js')) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response.ok) {
          caches.open(STATIC_CACHE).then(function(cache) { cache.put(event.request, response.clone()); });
        }
        return response;
      }).catch(function() { return caches.match(event.request); })
    );
    return;
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response.ok) {
          caches.open(STATIC_CACHE).then(function(cache) {
            cache.put(event.request, response.clone());
          });
        }
        return response;
      }).catch(function() {
        return caches.match('/index.html').then(function(cached) {
          return cached || new Response(
            '<html><body style="font-family:sans-serif;text-align:center;padding:40px">' +
            '<h2 style="color:#1D9E75">AURIS360</h2>' +
            '<p>You are offline. Please reconnect to continue.</p>' +
            '</body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          );
        });
      })
    );
    return;
  }
});

// ── Background sync for offline incident reports ─────────────────────────────
self.addEventListener('sync', function(event) {
  if (event.tag === 'sync-incidents') {
    event.waitUntil(syncPendingData('auris360-pending-incidents'));
  }
  if (event.tag === 'sync-inspections') {
    event.waitUntil(syncPendingData('auris360-pending-inspections'));
  }
});

async function syncPendingData(storeName) {
  // Notify the app that sync is running
  const clients = await self.clients.matchAll();
  clients.forEach(function(client) {
    client.postMessage({ type: 'SYNC_STATUS', store: storeName, status: 'syncing' });
  });
}

// ── Push notifications (future) ──────────────────────────────────────────────
self.addEventListener('push', function(event) {
  if (!event.data) return;
  var data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'AURIS360 Alert', {
      body: data.body || '',
      icon: '/assets/brand/auris360-icon-192.png',
      badge: '/assets/brand/auris360-icon-192.png',
      tag: data.tag || 'auris360',
      data: data,
      actions: data.actions || [],
      requireInteraction: data.urgent || false
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(function(clients) {
      for (var c of clients) {
        if (c.url === url && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
