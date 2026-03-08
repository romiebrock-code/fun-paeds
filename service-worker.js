/* service-worker.js */
const CACHE = "fun-paeds-v15";

// Keep this list tight: app-shell essentials only.
// (Anything else can still be cached at runtime.)
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(ASSETS);
      // Activate the new SW immediately
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k))));
      // Take control of all open tabs immediately
      await self.clients.claim();
    })()
  );
});

// Helper: is this a navigation request (loading a page)?
function isNavigationRequest(request) {
  return request.mode === "navigate" || (request.headers.get("accept") || "").includes("text/html");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== "GET") return;

  // 1) NAVIGATION (HTML): Network-first so updates appear quickly.
  if (isNavigationRequest(req)) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put("./index.html", fresh.clone()); // keep app shell updated
          return fresh;
        } catch (err) {
          // Offline fallback
          const cached = await caches.match("./index.html");
          return cached || new Response("Offline", { status: 503, statusText: "Offline" });
        }
      })()
    );
    return;
  }

  // 2) STATIC ASSETS: Cache-first, then update in background (stale-while-revalidate)
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      const cache = await caches.open(CACHE);

      const fetchAndUpdate = fetch(req)
        .then((res) => {
          // Only cache successful, basic responses (avoid opaque junk)
          if (res && res.status === 200 && res.type === "basic") {
            cache.put(req, res.clone());
          }
          return res;
        })
        .catch(() => null);

      // If we have cache, serve it immediately; update in background.
      if (cached) {
        event.waitUntil(fetchAndUpdate);
        return cached;
      }

      // Otherwise try network, and if it fails, give a sensible fallback.
      const fresh = await fetchAndUpdate;
      return fresh || cached || new Response("", { status: 504, statusText: "Gateway Timeout" });
    })()
  );
});