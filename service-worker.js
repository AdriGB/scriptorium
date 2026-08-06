const CACHE_VERSION = 'scriptorium-v1.2.1';
const APP_CACHE = `${CACHE_VERSION}-app`;

const APP_SHELL = [
    './',
    './index.html',
    './manifest.webmanifest',
    './assets/app.css',

    './js/app.js',
    './js/chara-card.js',
    './js/editor.js',
    './js/export.js',
    './js/png-parser.js',
    './js/png-writer.js',
    './js/profiles.js',
    './js/state.js',
    './js/storage.js',
    './js/translator.js',
    './js/ui.js',
    './js/utils.js',
    './js/vault.js',

    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-512.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(APP_CACHE)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys =>
                Promise.all(
                    keys
                        .filter(key => key.startsWith('scriptorium-') && key !== APP_CACHE)
                        .map(key => caches.delete(key))
                )
            )
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // No cache external services
    if (
        url.hostname.includes('translate.googleapis.com') ||
        url.hostname.includes('translate.google.com') ||
        url.hostname.includes('fonts.googleapis.com') ||
        url.hostname.includes('fonts.gstatic.com') ||
        url.hostname.includes('cdnjs.cloudflare.com')
    ) {
        return;
    }

    // Navigation: network first, fallback to cache
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then(response => {
                    const copy = response.clone();
                    caches.open(APP_CACHE)
                        .then(cache => cache.put('./index.html', copy));
                    return response;
                })
                .catch(() => caches.match('./index.html'))
        );
        return;
    }

    // Same-origin: cache first, fallback to network
    if (url.origin === self.location.origin) {
        event.respondWith(
            caches.match(request).then(cached => {
                if (cached) return cached;
                return fetch(request).then(response => {
                    if (!response || !response.ok) return response;
                    const copy = response.clone();
                    caches.open(APP_CACHE)
                        .then(cache => cache.put(request, copy));
                    return response;
                });
            })
        );
    }
});
