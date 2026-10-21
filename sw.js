// Service worker: la app abre al instante y funciona sin conexión.
var V = 'gastos-v3';
var SHELL = ['./index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(V).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== V; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url), nav = e.request.mode === 'navigate';
  if (e.request.method !== 'GET' || /script\.google(usercontent)?\.com$/.test(u.hostname)) return;
  var font = /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
  if (u.origin !== location.origin && !font) return;
  var key = nav ? './index.html' : e.request;
  e.respondWith(caches.open(V).then(function (c) {
    return c.match(key).then(function (hit) {
      var net = fetch(e.request).then(function (r) { if (r && (r.ok || r.type === 'opaque')) c.put(key, r.clone()); return r; }).catch(function () { return hit; });
      return hit || net;
    });
  }));
});
