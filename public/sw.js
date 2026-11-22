self.addEventListener('install',event => {
  event.waitUntil(caches.open('guardia-shell-v1').then(cache => cache.addAll(['/','/app.js','/style.css','/icon.svg','/manifest.webmanifest'])));
});
self.addEventListener('fetch',event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
