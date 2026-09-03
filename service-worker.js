/* Debe coincidir con `version` de package.json: tests/regression.mjs lo comprueba
   y avisa si se olvida subirlo. Cambiarlo invalida la cache de los clientes. */
const CACHE_VERSION = 'scriptorium-v1.3.0';
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
    './js/field-index.js',
    './js/png-parser.js',
    './js/png-writer.js',
    './js/profiles.js',
    './js/snapshot.js',
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

/* Sin estos la app no arranca sin red. Lo demas (fuentes, iconos) solo la deja
   mas fea, asi que un fallo ahi no debe impedir la instalacion. */
const CRITICAL = new Set(
    APP_SHELL.filter(u => u.endsWith('.js') || u === './index.html' || u === './assets/app.css')
);

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(APP_CACHE);
        /* addAll es atomico: un solo 404 tumbaba la instalacion entera y dejaba
           al usuario sin PWA por un icono renombrado. Se anade de una en una
           para separar lo critico de lo decorativo. */
        const failed = [];
        await Promise.all(APP_SHELL.map(url =>
            cache.add(url).catch(err => {
                failed.push(url);
                console.warn('[SW] sin precachear:', url, err?.message || err);
            })
        ));
        const critical = failed.filter(url => CRITICAL.has(url));
        if (critical.length) {
            // Sin skipWaiting: sigue mandando el worker anterior, que si arranca.
            throw new Error('[SW] faltan ficheros criticos: ' + critical.join(', '));
        }
        await self.skipWaiting();
    })());
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
