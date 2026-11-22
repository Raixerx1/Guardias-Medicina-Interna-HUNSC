const shellCache = 'guardia-shell-v2';
self.addEventListener('install',event => {
  event.waitUntil(caches.open(shellCache).then(cache => cache.addAll(['/','/app.js','/ocr.js','/style.css','/icon.svg','/manifest.webmanifest'])));
});
self.addEventListener('activate',event => {
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key==='guardia-shell-v1').map(key=>caches.delete(key)))));
});
self.addEventListener('fetch',event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).catch(async () => (await caches.open(shellCache)).match(event.request)));
});
