// Small helper that lets the site be installed as an app and open its pages when offline.
// Pages and code always come fresh from the internet when it is available; the saved
// copy is only used when there is no connection. Photos and videos are not saved.
const CACHE = "ghumi-shell-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const isShell = request.method === "GET" && url.origin === self.location.origin &&
    /\.(html|css|js|webmanifest|png)$|\/$/.test(url.pathname) && !/\/(wall|images|assets)\//.test(url.pathname);
  if (!isShell) return; // photos, videos and the online API go straight to the network

  event.respondWith(
    fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request, { ignoreSearch: true }))
  );
});
