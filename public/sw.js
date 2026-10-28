/**
 * SARA AI - Service Worker (Phase 2C App Shell & Safe Caching)
 *
 * Provides offline app-shell availability and static asset caching.
 * CRITICAL SECURITY GUARANTEE:
 * Private API endpoints (/api/*) and mutating requests are NEVER cached.
 */

const CACHE_NAME = 'sara-app-shell-v1';

// Static, public application-shell resources strictly verified to exist
const APP_SHELL_URLS = [
  '/',
  '/manifest.json',
  '/static/styles.css',
  '/static/app.js',
  '/static/commands/commandEngine.js',
  '/static/commands/parser.js',
  '/static/commands/registry.js',
  '/static/commands/handlers/uiHandler.js',
  '/static/commands/handlers/webHandler.js',
  '/static/commands/handlers/youtubeHandler.js',
  '/icons/sara-192.png',
  '/icons/sara-512.png',
  '/icons/sara-512-maskable.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon.png'
];

// Install: Pre-cache verified public app-shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const url of APP_SHELL_URLS) {
        try {
          await cache.add(url);
        } catch (err) {
          console.warn('[SARA SW] Failed to pre-cache app shell asset:', url, err);
        }
      }
    })
  );
});

// Activate: Prune outdated SARA shell caches and claim clients safely
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (cacheNames) => {
      const deletionPromises = cacheNames.map((name) => {
        if (name.startsWith('sara-app-shell-') && name !== CACHE_NAME) {
          console.log('[SARA SW] Removing outdated cache:', name);
          return caches.delete(name);
        }
        return Promise.resolve(false);
      });
      await Promise.all(deletionPromises);
      return self.clients.claim();
    })
  );
});

// Fetch: Strict security and routing boundary
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 1. Never cache non-GET requests (POST, PUT, DELETE, etc.)
  if (req.method !== 'GET') {
    return;
  }

  const url = new URL(req.url);

  // 2. Never intercept cross-origin requests (CDNs, Google, YouTube, etc.)
  if (url.origin !== self.location.origin) {
    return;
  }

  // 3. CRITICAL SECURITY: Never cache private / dynamic API endpoints
  if (url.pathname.startsWith('/api/')) {
    return; // Pass through directly to network
  }

  // 4. HTML Navigation: Network-First with cached app-shell fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return networkRes;
        })
        .catch(() => {
          // Offline fallback: serve cached root app shell
          return caches.match('/').then((cached) => {
            return cached || new Response('Offline: App shell unavailable', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' }
            });
          });
        })
    );
    return;
  }

  // 5. Same-Origin Static App-Shell Assets: Cache-First with network fallback
  event.respondWith(
    caches.match(req).then((cachedRes) => {
      if (cachedRes) {
        return cachedRes;
      }
      return fetch(req).then((networkRes) => {
        // Cache valid same-origin static assets on the fly
        if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return networkRes;
      });
    })
  );
});

// Controlled message listener for safe update transitions
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});
