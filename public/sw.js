// Pure network passthrough — no caching, so we can never serve a stale shell
// or cache auth. This exists only because Chrome's automatic "Install app"
// eligibility check on Android looks for *a* fetch handler to be present at
// all (it doesn't care whether it actually caches anything); without one,
// Chrome silently downgrades "Add to Home Screen" to a plain bookmark
// shortcut, which is why the URL bar was still showing up even though the
// manifest itself was already correct.
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// Background push: fires even when the app is fully closed.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Cadence", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Cadence";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag || undefined,
      data: { url: data.url || "/app" },
      requireInteraction: false,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/app";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if (c.url.includes("/app") && "focus" in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })()
  );
});
