// Service worker: permite usar Escucha sin conexión tras la primera visita.
// Instalación: guarda todos los archivos de la compilación.
// Navegación: primero red, después caché. Recursos estáticos: primero caché.

// scripts/precache-sw.mjs sustituye la versión y la lista al compilar.
const CACHE = 'escucha-dev';
const PRECACHE = [/* __PRECACHE__ */];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // `reload` evita la caché HTTP de GitHub Pages: el índice y los recursos llegan de la misma versión.
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Solo una respuesta correcta de la propia app sustituye la copia sin conexión.
          const isShell = new URL(request.url).pathname === new URL('./', self.location).pathname;
          if (response.ok && isShell) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put('./', copy)));
          }
          return response;
        })
        .catch(() => caches.match('./').then((cached) => cached ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
