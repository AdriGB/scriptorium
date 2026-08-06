const CACHE_VERSION = 'scriptorium-v1.2.3';
const APP_CACHE = `${CACHE_VERSION}-app`;

const APP_SHELL = [
    './',
    './index.html',
    './manifest.webmanifest',
    './assets/app.css',
    './assets/fontawesome/css/all.min.css',
    './assets/fontawesome/webfonts/fa-brands-400.ttf',
    './assets/fontawesome/webfonts/fa-brands-400.woff2',
    './assets/fontawesome/webfonts/fa-regular-400.ttf',
    './assets/fontawesome/webfonts/fa-regular-400.woff2',
    './assets/fontawesome/webfonts/fa-solid-900.ttf',
    './assets/fontawesome/webfonts/fa-solid-900.woff2',
    './assets/fontawesome/webfonts/fa-v4compatibility.ttf',
    './assets/fontawesome/webfonts/fa-v4compatibility.woff2',

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
        url.hostname.includes('translate.google.com')
    ) {
        return;
    }

    // Navigation: red primero sin modificar la cache versionada. Esto evita
    // guardar HTML nuevo dentro de una cache perteneciente a un worker viejo.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request, { cache: 'no-store' })
                .catch(() => caches.match('./index.html'))
        );
        return;
    }

    if (url.origin !== self.location.origin) return;

    // Codigo y manifiesto: red primero, shell precargado como respaldo offline.
    const isApplicationFile =
        url.pathname.endsWith('.js') ||
        url.pathname.endsWith('.css') ||
        url.pathname.endsWith('.webmanifest');

    if (isApplicationFile) {
        event.respondWith(
            fetch(request, { cache: 'no-store' })
                .catch(() => caches.match(request))
        );
        return;
    }

    // Recursos estaticos versionados: cache primero.
    event.respondWith(
        caches.match(request).then(cached => cached || fetch(request))
    );
});
