// AURIS360 service worker — generated app-shell caching and partial offline support.
importScripts('/sw-assets.js');

const ASSET_MANIFEST = self.AURIS_SW_ASSET_MANIFEST || { version: 'development', assets: ['/', '/index.html'] };
const CACHE_PREFIX = 'auris360-';
const STATIC_CACHE = `${CACHE_PREFIX}static-${ASSET_MANIFEST.version}`;
const REQUIRED_SHELL = ['/', '/index.html', '/manifest.json'];
const OPTIONAL_ASSETS = ASSET_MANIFEST.assets.filter((asset) => !REQUIRED_SHELL.includes(asset));

async function cacheRequiredShell(cache) { await cache.addAll(REQUIRED_SHELL); }

async function cacheOptionalAssets(cache) {
  // A missing optional asset must not prevent installation of the current shell.
  await Promise.allSettled(OPTIONAL_ASSETS.map(async (asset) => {
    const response = await fetch(asset, { cache: 'reload' });
    if (!response.ok) throw new Error(`${asset}: ${response.status}`);
    await cache.put(asset, response);
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cacheRequiredShell(cache);
    await cacheOptionalAssets(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== STATIC_CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

function isPrivateOrApiRequest(url, request) {
  return request.method !== 'GET' ||
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('anthropic.com') ||
    url.pathname.includes('/auth/') ||
    url.pathname.startsWith('/api/');
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put('/index.html', response.clone());
    return response;
  } catch (error) {
    return (await cache.match('/index.html')) || new Response(
      '<!doctype html><html><body><h1>AURIS360</h1><p>You are offline. Reconnect to continue.</p></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (isPrivateOrApiRequest(url, event.request)) return;
  if (event.request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }
  if (url.origin === self.location.origin && ASSET_MANIFEST.assets.includes(url.pathname)) {
    event.respondWith(cacheFirstAsset(event.request));
  }
});

// Background sync remains intentionally limited to workflows with an IndexedDB queue.
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-incidents') event.waitUntil(syncPendingData('auris360-pending-incidents'));
  if (event.tag === 'sync-inspections') event.waitUntil(syncPendingData('auris360-pending-inspections'));
});

async function syncPendingData(storeName) {
  const clients = await self.clients.matchAll();
  clients.forEach((client) => client.postMessage({ type: 'SYNC_STATUS', store: storeName, status: 'syncing' }));
}

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(self.registration.showNotification(data.title || 'AURIS360 Alert', {
    body: data.body || '', icon: '/assets/brand/auris360-icon-192.png',
    badge: '/assets/brand/auris360-icon-192.png', tag: data.tag || 'auris360',
    data, actions: data.actions || [], requireInteraction: data.urgent || false
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then((clients) => {
    for (const client of clients) {
      if (client.url === targetUrl && 'focus' in client) return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
  }));
});
